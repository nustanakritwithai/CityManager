import test from 'node:test';
import assert from 'node:assert/strict';
import { MarketClient, MARKET_SAVE_KEY } from '../src/market-client.ts';
import { createCity, deserialize, serialize, step } from '../src/sim.ts';
import { SAVE_KEY } from '../src/save-storage.ts';

const guest = '00000000-0000-4000-8000-000000000003', receipt = '00000000-0000-4000-8000-000000000004', claim = '00000000-0000-4000-8000-000000000005';
async function environment(run: (store: Map<string, string>) => Promise<void>) {
  const names = ['window', 'navigator', 'document', 'localStorage'] as const, before = names.map(name => Object.getOwnPropertyDescriptor(globalThis, name)), oldFetch = globalThis.fetch, store = new Map<string, string>();
  let held = false;
  const locks = { async request<T>(_name: string, _options: unknown, callback: (lock: unknown | null) => Promise<T>) { if (held) return callback(null); held = true; try { return await callback({}); } finally { held = false; } } };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} }); Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks } }); Object.defineProperty(globalThis, 'document', { configurable: true, value: { cookie: 'cm_csrf=test' } }); Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } } });
  try { await run(store); } finally { globalThis.fetch = oldFetch; names.forEach((name, i) => before[i] ? Object.defineProperty(globalThis, name, before[i]!) : Reflect.deleteProperty(globalThis, name)); }
}
function seeded(store: Map<string, string>) { const c = new MarketClient(() => createCity(1, { starter: false }), 'http://127.0.0.1:4317'); c.journal.guestId = guest; store.set(MARKET_SAVE_KEY, JSON.stringify(c.journal)); }

test('disabled market never accesses unavailable browser storage', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'); Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('denied'); } });
  try { const client = new MarketClient(() => createCity(1, { starter: false })); assert.equal(client.enabled, false); assert.equal(await client.resume(), null); } finally { if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else Reflect.deleteProperty(globalThis, 'localStorage'); }
});

test('loading an old city never erases a pending market operation or changes the city', async () => environment(async store => {
  seeded(store); const seed = new MarketClient(() => createCity(1, { starter: false }), 'http://127.0.0.1:4317'); seed.journal.operations.push({ opId: '00000000-0000-4000-8000-000000000006', guestId: guest, cityId: seed.journal.cityId, kind: 'buy', payload: { listing_id: 'listing', quantity: 1 }, state: 'pending', createdAt: '2026-10-27T00:00:00.000Z' }); store.set(MARKET_SAVE_KEY, JSON.stringify(seed.journal));
  const client = new MarketClient(() => createCity(1, { starter: false }), 'http://127.0.0.1:4317'), before = store.get(MARKET_SAVE_KEY), old = { ...client.exportSave(), operations: [] }; let applied = false;
  await assert.rejects(client.bindLoadedCity(old, () => { applied = true; }), /saved-market-reconciliation-required/); await assert.rejects(client.bindLoadedCity(undefined, () => { applied = true; }), /saved-market-reconciliation-required/); assert.equal(applied, false); assert.equal(store.get(MARKET_SAVE_KEY), before); assert.equal(client.journal.operations[0].opId, '00000000-0000-4000-8000-000000000006');
  await client.bindLoadedCity(client.exportSave(), () => { applied = true; }); assert.equal(applied, true);
}));

test('two tabs cannot send concurrently or overwrite a newer journal', async () => environment(async store => {
  seeded(store); const a = new MarketClient(() => createCity(1, { starter: false }), 'http://127.0.0.1:4317'), b = new MarketClient(() => createCity(1, { starter: false }), 'http://127.0.0.1:4317'); let calls = 0, signal!: () => void, release!: () => void; const started = new Promise<void>(r => { signal = r; }), wait = new Promise<void>(r => { release = r; });
  globalThis.fetch = async () => { calls++; signal(); await wait; return new Response('{}', { status: 200 }); };
  const first = a.buy('00000000-0000-4000-8000-000000000008', 1); await started; await assert.rejects(b.buy('00000000-0000-4000-8000-000000000009', 1), /market-writer-busy/); release(); await first; await assert.rejects(b.buy('00000000-0000-4000-8000-000000000009', 1), /market-state-changed-reload/); let overwroteCity = false; await assert.rejects(b.saveLocalCity(() => { overwroteCity = true; }), /market-state-changed-reload/); assert.equal(overwroteCity, false); assert.equal(calls, 1); const saved = JSON.parse(store.get(MARKET_SAVE_KEY)!); assert.equal(saved.operations.length, 1); assert.equal(saved.operations[0].state, 'confirmed');
}));

test('missing browser lock support blocks real client mutations before writing or sending', async () => environment(async store => {
  seeded(store); const before = store.get(MARKET_SAVE_KEY), client = new MarketClient(() => createCity(1, { starter: false }), 'http://127.0.0.1:4317'); Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} }); let sends = 0; globalThis.fetch = async () => { sends++; return new Response('{}'); };
  await assert.rejects(client.buy('one', 1), /market-writer-lock-unavailable/); assert.equal(sends, 0); assert.equal(store.get(MARKET_SAVE_KEY), before);
}));

test('starting a new city does not silently discard the current guest journal', async () => environment(async store => {
  seeded(store); const before = store.get(MARKET_SAVE_KEY), client = new MarketClient(() => createCity(1, { starter: false }), 'http://127.0.0.1:4317'); await assert.rejects(client.resetCity(), /market-city-reset-requires-reconciliation/); assert.equal(store.get(MARKET_SAVE_KEY), before); assert.equal(client.guestId, guest);
}));

test('409 and unknown remain pending until an explicit durable fence; ambiguous retries keep the original key', async () => environment(async store => {
  seeded(store); const client = new MarketClient(() => createCity(1, { starter: false }), 'http://127.0.0.1:4317', { recoveryEnabled: true }); let mode = 'listing', firstKey = '', retryKey = '';
  globalThis.fetch = async (url, init) => { const key = new Headers(init?.headers).get('Idempotency-Key')!; if (String(url).endsWith('/v1/recovery/status')) { assert.deepEqual(JSON.parse(String(init?.body)).payload, { item_code: 'crop:rice', unit_price: 10, quantity: 1, expires_at: null }); return new Response(JSON.stringify({ state: 'unknown' }), { status: 200 }); } if (String(url).endsWith('/v1/recovery/fence')) return new Response(JSON.stringify({ state: 'fenced', kind: 'listing', committed: false }), { status: 200 }); if (mode === 'listing') return new Response(JSON.stringify({ error: 'insufficient inventory' }), { status: 409 }); if (mode === 'lost') { firstKey = key; throw new Error('response lost'); } retryKey = key; return new Response(JSON.stringify({ error: 'listing unavailable' }), { status: 409 }); };
  await assert.rejects(client.list('crop:rice', 10, 1), /insufficient inventory/); const listing = client.journal.operations[0]; assert.equal(listing.state, 'pending'); await client.reconcileOperation(listing.opId, 'status'); assert.equal(listing.state, 'pending'); await client.reconcileOperation(listing.opId, 'fence'); assert.equal(listing.state, 'quarantined');
  mode = 'lost'; await assert.rejects(client.buy('00000000-0000-4000-8000-000000000008', 1), /response lost/); const op = client.journal.operations[1]; mode = 'retry'; await assert.rejects(client.retry(op.opId), /listing unavailable/); assert.equal(op.state, 'pending'); assert.equal(firstKey, retryKey); assert.equal(firstKey, op.opId);
}));

test('committed buy recovery does not pretend to resolve an unproven wallet sequence', async () => environment(async store => {
  seeded(store); const client = new MarketClient(() => createCity(1, { starter: false }), 'http://127.0.0.1:4317', { recoveryEnabled: true }), listing = '00000000-0000-4000-8000-000000000008';
  globalThis.fetch = async url => { if (String(url).endsWith('/v1/recovery/status')) return new Response(JSON.stringify({ state: 'done', kind: 'buy', http_status: 201, response: { operation_id: '00000000-0000-4000-8000-000000000009', listing_id: listing, quantity: 1 } }), { status: 200 }); throw new Error('response lost'); };
  await assert.rejects(client.buy(listing, 1), /response lost/); const op = client.journal.operations[0], status = await client.reconcileOperation(op.opId, 'status'); assert.equal(status.state, 'done'); assert.equal(op.state, 'pending'); assert.equal(client.journal.seq, '0');
}));

test('keyed cancel repeats the original key after a lost response and never credits an offline city', async () => environment(async store => {
  seeded(store); const city = createCity(1, { starter: false }), before = serialize(city), listing = '00000000-0000-4000-8000-000000000008', keys: string[] = []; let client = new MarketClient(() => city, 'http://127.0.0.1:4317', { recoveryEnabled: true });
  globalThis.fetch = async (_url, init) => { keys.push(new Headers(init?.headers).get('Idempotency-Key') ?? ''); if (keys.length === 1) throw new Error('response lost'); return new Response(JSON.stringify({ id: listing, status: 'cancelled', returned_quantity: 3 }), { status: 200 }); };
  await assert.rejects(client.cancelListing(listing), /response lost/); const op = client.journal.operations[0]; assert.equal(op.payload.recovery_keyed, true); client = new MarketClient(() => city, 'http://127.0.0.1:4317', { recoveryEnabled: true }); await client.retry(op.opId); await client.cancelListing(listing);
  assert.equal(keys.length, 3); assert.equal(keys[0], op.opId); assert.equal(keys[1], op.opId); assert.notEqual(keys[2], op.opId); assert.equal(serialize(city), before, 'neither a replay nor a different cancel key refunds an offline city');
}));

test('legacy unkeyed cancel cannot be fenced under a newly assigned key', async () => environment(async store => {
  seeded(store); let client = new MarketClient(() => createCity(1, { starter: false }), 'http://127.0.0.1:4317', { recoveryEnabled: true }); const id = '00000000-0000-4000-8000-000000000008', opId = '00000000-0000-4000-8000-000000000009';
  client.journal.operations.push({ opId, guestId: guest, cityId: client.journal.cityId, kind: 'cancel', payload: { listing_id: id }, state: 'pending', createdAt: '2026-10-27T00:00:00.000Z' }); store.set(MARKET_SAVE_KEY, JSON.stringify(client.journal)); client = new MarketClient(() => createCity(1, { starter: false }), 'http://127.0.0.1:4317', { recoveryEnabled: true }); let calls = 0, header: string | null = 'unset'; globalThis.fetch = async (_url, init) => { calls++; header = new Headers(init?.headers).get('Idempotency-Key'); return new Response('{}', { status: 200 }); };
  await assert.rejects(client.reconcileOperation(opId, 'fence'), /legacy-cancel-reconciliation-required/); assert.equal(calls, 0); assert.equal(client.journal.operations[0].state, 'pending'); await client.retry(opId); assert.equal(header, null);
}));

test('ACK requires the matching durable city and receipt before network access', async () => environment(async store => {
  seeded(store); let city = createCity(1, { starter: false }), sends = 0; const client = new MarketClient(() => city, 'http://127.0.0.1:4317'); client.journal.receipts[receipt] = { claimId: claim, state: 'applied', firmId: 2, itemId: 'crop:rice', quantity: 1 }; const saved = serialize(city, client.exportSave()); store.set(SAVE_KEY, saved); globalThis.fetch = async () => { sends++; return new Response('{}', { status: 200 }); };
  city = createCity(2, { starter: false }); await assert.rejects(client.ack(receipt), /saved-city-recovery-required/); assert.equal(sends, 0); city = deserialize(saved); await client.ack(receipt); assert.equal(sends, 1); assert.equal(client.journal.receipts[receipt].state, 'delivered');
}));

test('real city save reload recovers a lost ACK without applying the crop twice', async () => environment(async store => {
  seeded(store); let city = createCity(61025, { starter: true }); for (let i = 0; i < 360 && !city.firms.some(f=>f.zone==='C'&&f.owner!==null); i++) step(city); const target = city.firms.find(f=>f.zone==='C'&&f.owner!==null); assert.ok(target, 'seeded engine city must contain an owned commercial business');
  let client = new MarketClient(() => city, 'http://127.0.0.1:4317'), ackCalls = 0; const r = { receipt_id: receipt, item_code: 'crop:rice', quantity: 1 }; const before = target.crops.rice;
  globalThis.fetch = async url => { if (String(url).endsWith('/claim')) return new Response('{}', { status: 200 }); if (String(url).endsWith('/ack')) { ackCalls++; if (ackCalls === 1) throw new Error('ack response lost'); return new Response('{}', { status: 200 }); } throw new Error('unexpected request'); };
  const save = () => { const market = client.exportSave(); store.set(SAVE_KEY, serialize(city, market)); city.market = market; };
  await client.claim(receipt); await assert.rejects(client.applyAndAck(r, save, target.id), /ack response lost/); assert.equal(target.crops.rice, before + 1);
  const saved = deserialize(store.get(SAVE_KEY)!); city = createCity(1, { starter: false }); client = new MarketClient(() => city, 'http://127.0.0.1:4317'); const ackId = client.journal.operations.find(o => o.kind === 'ack' && o.state === 'pending')!.opId;
  const wrongCity = { ...saved.market!, cityId: '00000000-0000-4000-8000-000000000008' }; await assert.rejects(client.bindLoadedCity(wrongCity, () => { city = saved; }), /invalid market journal|saved-market-reconciliation-required/i); assert.equal(city.seed, 1);
  await client.bindLoadedCity(saved.market, () => { city = saved; }); assert.equal(client.journal.operations.find(o => o.kind === 'ack' && o.state === 'pending')?.opId, ackId); const loaded = city.firms.find(f => f.id === target.id)!; assert.equal(loaded.crops.rice, before + 1); await client.retry(ackId, save); assert.equal(loaded.crops.rice, before + 1); assert.equal(client.journal.receipts[receipt].state, 'delivered'); assert.equal(ackCalls, 2);
}));
