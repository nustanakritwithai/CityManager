import { createHash } from 'node:crypto';
import { createServerCityService } from '../city-saves/service.mjs';

const uuid = v => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const digest = raw => createHash('sha256').update(raw).digest('hex');
const conflict = code => Object.assign(Error(code), {status:409});
const requireNoPending = async tx => {if(typeof tx.activeIntent!=='function')throw conflict('intent-fence-unavailable');if(await tx.activeIntent()!==null)throw conflict('pending-intent-conflict');};
const validIdentity = (owner, cityId) => { if (!uuid(owner) || !uuid(cityId)) throw Error('invalid-identity'); };
const validSave = (s, owner, cityId) => s && s.owner === owner && s.cityId === cityId && Number.isSafeInteger(s.revision) && s.revision > 0 && typeof s.raw === 'string' && s.rawHash === digest(s.raw);
const sameMetadata = (a,b) => !!a && !!b && a.name===b.name && a.population===b.population && a.tick===b.tick && typeof a.name==='string' && a.name.length<=120 && Number.isSafeInteger(a.population) && a.population>=0 && Number.isSafeInteger(a.tick) && a.tick>=0;
function journalClear(save) {
 let value; try { value=JSON.parse(save.raw); } catch { return false; }
 if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
 const m=value.market; if (!m) return true;
 return m.cityId===save.cityId && (m.guestId===null || m.guestId===save.owner) && Array.isArray(m.operations) && Array.isArray(m.escrow) && m.receipts && typeof m.receipts==='object' && !Array.isArray(m.receipts) && m.operations.every(o=>o && o.state==='confirmed') && m.escrow.every(e=>e && ['confirmed','cancelled'].includes(e.state)) && Object.values(m.receipts).every(r=>r && r.state==='delivered');
}

// All adapter callbacks below execute within a single owner-serialized DB
// transaction, with the save head locked against concurrent writers. Throwing
// must roll back every write. Missing capabilities fail closed.
export function createRegistryIntegration(adapter) {
 return {
  async create(owner, requestId, input) {
   validIdentity(owner,input?.cityId);
   if (!uuid(requestId) || !Number.isInteger(input.slot) || input.slot < 1 || input.slot > 3) throw Error('invalid-create');
   const {cityId,slot,raw,metadata}=input;
   const payloadHash=digest(JSON.stringify({cityId,slot,raw,metadata}));
   return adapter.transaction(owner, async tx => {
    await requireNoPending(tx);
    // A marker is durable cutover evidence, not a frozen current revision.
    // All legacy writers must participate in this lock and respect the marker.
    const marker=await tx.lockLegacyMarker();
    if (marker === null) {
     const legacy=await tx.lockLegacySave();
     if (legacy === undefined) throw conflict('legacy-invalid');
     if (legacy !== null) throw conflict('legacy-backfill-required');
     await tx.recordLegacyMarker(null);
    } else {
     if (!marker || !Object.hasOwn(marker,'cityId') || !(marker.cityId===null || uuid(marker.cityId))) throw conflict('legacy-invalid');
     if (marker.cityId!==null) {
      const bound=await tx.lockInstance(marker.cityId);
      if (!bound || bound.owner!==owner || bound.cityId!==marker.cityId || bound.slot!==1) throw conflict('legacy-conflict');
     }
    }
    const prior=await tx.createReceipt(requestId);
    if (prior) {
     if (prior.payloadHash!==payloadHash) throw conflict('idempotency-mismatch');
     const city=await tx.lockInstance(prior.cityId);
     if (!city || city.retired) throw conflict('city-lifecycle-changed');
     return prior.result;
    }
    const cities=await tx.listInstances();
    if (cities.filter(c=>!c.retired).length>=3) throw conflict('city-limit');
    if (cities.some(c=>!c.retired && c.slot===slot)) throw conflict('slot-occupied');
    await tx.insertInstance({owner,cityId,slot});
    const db=await tx.citySaveStore(cityId);
    if (await db.current()) throw conflict('city-identity-mismatch');
    const service=createServerCityService({transaction:(_owner,fn)=>fn(db)});
    const saved=await service.mutate(owner,requestId,{action:'create',cityId,raw,metadata});
    const result={owner,cityId,slot,revision:saved.revision,rawHash:saved.rawHash};
    await tx.recordCreateReceipt(requestId,payloadHash,cityId,result);
    return result;
   });
  },
  async backfillLegacy(owner) {
   if (!uuid(owner)) throw Error('invalid-owner');
   return adapter.transaction(owner, async tx => {
    await requireNoPending(tx);
    const marker=await tx.lockLegacyMarker();
    if (marker !== null) {
     if (!marker || !Object.hasOwn(marker,'cityId') || !(marker.cityId===null || uuid(marker.cityId))) throw conflict('legacy-invalid');
     if (marker.cityId===null) return null;
     const city=await tx.lockInstance(marker.cityId);
     if (!city || city.owner!==owner || city.cityId!==marker.cityId || city.slot!==1) throw conflict('legacy-conflict');
     return city;
    }
    const legacy = await tx.lockLegacySave();
    if (legacy === null) { await tx.recordLegacyMarker(null); return null; }
    if (!legacy || !validSave(legacy, owner, legacy.cityId) || !sameMetadata(legacy.metadata,legacy.metadata)) throw conflict('legacy-invalid');
    const existing = await tx.listInstances();
    const matching = existing.find(c => c.cityId === legacy.cityId);
    if (matching) {
     if (matching.owner !== owner || matching.slot !== 1 || matching.retired) throw conflict('legacy-conflict');
     const current = await tx.lockSave(legacy.cityId);
     if (!validSave(current,owner,legacy.cityId) || current.revision !== legacy.revision || current.raw !== legacy.raw || current.rawHash !== legacy.rawHash || !sameMetadata(current.metadata,legacy.metadata)) throw conflict('legacy-conflict');
     await tx.recordLegacyMarker(legacy.cityId);
     return matching;
    }
    if (existing.some(c => !c.retired)) throw conflict('legacy-slot-occupied');
    // Copies or references exact legacy state atomically, without changing it.
    const city = await tx.insertInstance({owner,cityId:legacy.cityId,slot:1});
    await tx.bindLegacySaveUnchanged(legacy);
    const bound = await tx.lockSave(legacy.cityId);
    if (!validSave(bound,owner,legacy.cityId) || bound.raw !== legacy.raw || bound.rawHash !== legacy.rawHash || bound.revision !== legacy.revision || !sameMetadata(bound.metadata,legacy.metadata)) throw conflict('legacy-copy-mismatch');
    await tx.recordLegacyMarker(legacy.cityId);
    return city;
   });
  },
  async writeSummary(owner, summary) {
   validIdentity(owner, summary?.cityId);
   if (!Number.isSafeInteger(summary.revision) || summary.revision < 1 || !/^[a-f0-9]{64}$/.test(summary.rawHash) || typeof summary.name !== 'string' || summary.name.length > 120 || !Number.isSafeInteger(summary.population) || summary.population < 0 || !Number.isSafeInteger(summary.tick) || summary.tick < 0) throw Error('invalid-summary');
   return adapter.transaction(owner, async tx => {
    await requireNoPending(tx);
    const city = await tx.lockInstance(summary.cityId);
    if (!city || city.owner !== owner || city.cityId !== summary.cityId || city.retired) throw conflict('city-not-found');
    const save = await tx.lockSave(summary.cityId);
    if (!validSave(save,owner,summary.cityId) || save.revision !== summary.revision || save.rawHash !== summary.rawHash || !save.metadata || save.metadata.name !== summary.name || save.metadata.population !== summary.population || save.metadata.tick !== summary.tick) throw conflict('stale-summary');
    // Adapter must persist only this allowlist in the same transaction.
    await tx.putSummary({cityId:summary.cityId,revision:summary.revision,rawHash:summary.rawHash,name:summary.name,population:summary.population,tick:summary.tick});
   });
  },
  async retire(owner, cityId, expectedRevision) {
   validIdentity(owner,cityId);
   if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw Error('invalid-revision');
   return adapter.transaction(owner, async tx => {
    await requireNoPending(tx);
    const city = await tx.lockInstance(cityId), save = await tx.lockSave(cityId);
    if (!city || city.owner !== owner || city.cityId !== cityId || city.retired || !validSave(save,owner,cityId) || save.revision !== expectedRevision) throw conflict('save-conflict');
    // This must be authoritative and locked/transactionally coordinated with
    // obligation creation, even if trading is closed. Unknown is not clear.
    if (!journalClear(save) || await tx.obligationsClear(cityId) !== true) throw conflict('market-reconciliation-required');
    await tx.archiveSaveUnchanged(save);
    await tx.retireInstance(cityId);
    return {owner,cityId,revision:save.revision,archiveHash:save.rawHash};
   });
  }
 };
}

// Reuses existing save validation, journal freeze, idempotency and ACK logic.
// Adapter must scope every db method, receipt, deletion fence and archive to
// (owner,cityId), and serialize with registry/summary/retirement transactions.
// Not mounted to the existing endpoint. No implicit current-city pointer.
export function createPerCitySaveService(adapter) {
 return {
  async read(owner, cityId) {
   validIdentity(owner,cityId);
   return adapter.transaction(owner,async tx=>{
    const city=await tx.lockInstance(cityId);
    if (!city || city.owner!==owner || city.cityId!==cityId || city.retired) throw conflict('city-not-found');
    const value=await tx.lockSave(cityId);
    if (!validSave(value,owner,cityId)) throw conflict('city-identity-mismatch');
    return value;
   });
  },
  async mutate(owner, requestId, body) {
   validIdentity(owner,body?.cityId);
   if (body.action === 'delete') throw conflict('use-reconciled-retirement');
   const cityId=body.cityId;
   const service=createServerCityService({transaction:(_owner,fn)=>adapter.transaction(owner,async tx=>{
    await requireNoPending(tx);
    const city=await tx.lockInstance(cityId);
    if (!city || city.owner!==owner || city.cityId!==cityId || city.retired) throw conflict('city-not-found');
    const db=await tx.citySaveStore(cityId);
    const current=await db.current();
    if (current && (current.owner!==owner || current.cityId!==cityId)) throw conflict('city-identity-mismatch');
    return fn(db);
   })});
   return service.mutate(owner,requestId,body);
  }
 };
}
