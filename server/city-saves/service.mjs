import { createHash } from 'node:crypto';

const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const fail = (status, message) => Object.assign(new Error(message), { status });
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const validSlot = n => Number.isInteger(n) && n >= 1 && n <= 3;
const validRevision = n => Number.isSafeInteger(n) && n > 0;
function validateSnapshot(raw, metadata, cityId, owner) {
  // Match the existing application limit in UTF-16 code units while bounding
  // the UTF-8 storage independently. Do not reject valid older large cities.
  if (typeof raw !== 'string' || raw.length > 12_000_000 || Buffer.byteLength(raw, 'utf8') > 48_000_000 || !raw.length) throw fail(400, 'invalid-save');
  // Preserve the original string, including unknown schemas; do not reserialize it.
  let parsed; try { parsed = JSON.parse(raw); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error(); } catch { throw fail(400, 'invalid-save'); }
  if (parsed.market) {
    const m = parsed.market;
    if (m.version !== 10 || m.cityId !== cityId || (m.guestId != null && m.guestId !== owner) || !Array.isArray(m.operations) || !Array.isArray(m.escrow) || !m.receipts || typeof m.receipts !== 'object' || Array.isArray(m.receipts) || (m.guestId == null && (m.operations.length || m.escrow.length || Object.keys(m.receipts).length))) throw fail(409, 'market-identity-mismatch');
  }
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata) || Object.keys(metadata).some(k => !['name', 'population', 'tick'].includes(k)) || typeof metadata.name !== 'string' || metadata.name.length > 120 || !Number.isSafeInteger(metadata.population) || metadata.population < 0 || !Number.isSafeInteger(metadata.tick) || metadata.tick < 0) throw fail(400, 'invalid-metadata');
}

// store.transaction serializes mutations for the authenticated owner and commits
// both the mutation and its idempotency receipt atomically.
export function createSaveService(store) {
  async function mutate(owner, requestId, body) {
    if (!uuid(owner) || !uuid(requestId) || !body || typeof body !== 'object' || Array.isArray(body)) throw fail(400, 'invalid-request');
    const { action, slot, cityId, expectedRevision, raw, metadata } = body;
    if (!['create', 'save', 'delete', 'restore'].includes(action)) throw fail(400, 'invalid-action');
    const permitted = action === 'create' ? ['action','slot','cityId','raw','metadata'] : action === 'save' ? ['action','cityId','expectedRevision','raw','metadata'] : action === 'delete' ? ['action','cityId','expectedRevision'] : ['action','cityId','expectedRevision','slot'];
    if (Object.keys(body).some(key => !permitted.includes(key))) throw fail(400, 'invalid-request');
    if ((action === 'create' || action === 'restore') && !validSlot(slot)) throw fail(400, 'invalid-slot');
    if (!uuid(cityId) || (action !== 'create' && !validRevision(expectedRevision))) throw fail(400, 'invalid-revision');
    if (action === 'create' || action === 'save') validateSnapshot(raw, metadata, cityId, owner);
    const payloadHash = digest(body);
    return store.transaction(owner, async db => {
      const previous = await db.request(requestId);
      if (previous) { if (previous.payloadHash !== payloadHash) throw fail(409, 'idempotency-mismatch'); return previous.response; }
      let result;
      if (action === 'create') {
        if (await db.activeSlot(slot)) throw fail(409, 'slot-occupied');
        const instance = { cityId, slot, revision: 1, deleted: false };
        await db.create(instance); await db.snapshot(instance.cityId, 1, raw, metadata);
        result = { ...instance };
      } else {
        const instance = await db.instance(cityId);
        if (!instance || instance.revision !== expectedRevision || (action === 'restore' ? !instance.deleted : instance.deleted)) throw fail(409, 'save-conflict');
        if (action === 'restore' && await db.activeSlot(slot)) throw fail(409, 'slot-occupied');
        if (instance.revision >= Number.MAX_SAFE_INTEGER) throw fail(409, 'revision-exhausted');
        const next = { ...instance, revision: instance.revision + 1, deleted: action === 'delete', slot: action === 'restore' ? slot : instance.slot };
        if (action === 'save') await db.snapshot(cityId, next.revision, raw, metadata);
        else { const prior = await db.latestSnapshot(cityId); if (!prior) throw fail(500, 'snapshot-missing'); await db.snapshot(cityId, next.revision, prior.raw, prior.metadata); }
        await db.update(next); result = next;
      }
      await db.record(requestId, payloadHash, result);
      return result;
    });
  }
  return { mutate, list(owner) { if (!uuid(owner)) throw fail(400, 'invalid-owner'); return store.list(owner); }, read(owner, cityId) { if (!uuid(owner) || !uuid(cityId)) throw fail(400, 'invalid-request'); return store.read(owner, cityId); } };
}
