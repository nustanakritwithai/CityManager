import { createHash } from 'node:crypto';
const uuid = v => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
export const MAX_SAVE_BYTES=8*1024*1024;
export const MAX_OWNER_BYTES=512*1024*1024;
export const hash = raw => createHash('sha256').update(raw).digest('hex');
const fail = (status, code) => Object.assign(Error(code), {status});
function rawValue(raw) {
 if(typeof raw!=='string'||!raw.length||raw.length>MAX_SAVE_BYTES||Buffer.byteLength(raw)>MAX_SAVE_BYTES)throw fail(400,'invalid-save');
 let value;try{value=JSON.parse(raw);}catch{throw fail(400,'invalid-save');}
 if(!value||typeof value!=='object'||Array.isArray(value))throw fail(400,'invalid-save');return value;
}
function metadataValue(m){if(!m||Object.keys(m).sort().join(',')!=='name,population,tick'||typeof m.name!=='string'||m.name.length>120||!Number.isSafeInteger(m.population)||m.population<0||!Number.isSafeInteger(m.tick)||m.tick<0)throw fail(400,'invalid-metadata');}
function marketValue(value,owner,cityId){const m=value.market;if(!m)return; if(m.version!==10||m.cityId!==cityId||(m.guestId!==null&&m.guestId!==owner)||!Array.isArray(m.operations)||!Array.isArray(m.escrow)||!m.receipts||typeof m.receipts!=='object'||Array.isArray(m.receipts)||(m.guestId===null&&(m.operations.length||m.escrow.length||Object.keys(m.receipts).length)))throw fail(409,'market-identity-mismatch');}
const checkOwner=owner=>{if(!uuid(owner))throw fail(401,'guest-required');};
/** Host transaction resolves only after COMMIT, including the idempotency record. */
export function createServerCityService(store){return {
 async read(owner){checkOwner(owner);return store.read(owner);},
 async mutate(owner,requestId,body){
  checkOwner(owner);if(!uuid(requestId)||!body||typeof body!=='object'||Array.isArray(body))throw fail(400,'invalid-request');
  const {action,cityId,expectedRevision,raw,metadata}=body;
  const keys=action==='create'?'action,cityId,metadata,raw':'action,cityId,expectedRevision,metadata,raw';
  if(!['create','save'].includes(action)||Object.keys(body).sort().join(',')!==keys||!uuid(cityId)||(action==='save'&&(!Number.isSafeInteger(expectedRevision)||expectedRevision<1)))throw fail(400,'invalid-request');
  const value=rawValue(raw);metadataValue(metadata);marketValue(value,owner,cityId);const payloadHash=hash(JSON.stringify(body));
  return store.transaction(owner,async db=>{
   const oldRequest=await db.request(requestId);if(oldRequest){if(oldRequest.payloadHash!==payloadHash)throw fail(409,'idempotency-mismatch');return {...oldRequest.response,raw};}
   if(await db.requestCount()>=100_000)throw fail(413,'request-receipt-capacity');
   const current=await db.current();
   if(action==='create'?current!==null:!current||current.cityId!==cityId||current.revision!==expectedRevision)throw fail(409,'save-conflict');
   if(current&&JSON.stringify(rawValue(current.raw).market)!==JSON.stringify(value.market))throw fail(409,'market-journal-frozen');
   const revision=current?current.revision+1:1;if(!Number.isSafeInteger(revision))throw fail(409,'revision-exhausted');
   const result={owner,cityId,revision,raw,rawHash:hash(raw),metadata};
   if(await db.bytes()+Buffer.byteLength(raw)>MAX_OWNER_BYTES)throw fail(413,'owner-save-capacity');
   await db.publish(result);await db.record(requestId,payloadHash,result);return result;
  });
 },
 async archive(owner,body){checkOwner(owner);if(!body||Object.keys(body).sort().join(',')!=='raw,source'||typeof body.source!=='string'||!body.source.length||body.source.length>512)throw fail(400,'invalid-archive');rawValue(body.raw);const rawHash=hash(body.raw);return store.transaction(owner,async db=>{if(!(await db.hasArchive(rawHash))&&await db.bytes()+Buffer.byteLength(body.raw)>MAX_OWNER_BYTES)throw fail(413,'owner-save-capacity');await db.archive(rawHash,body.raw,body.source);return {hash:rawHash,rawHash};});},
 async listArchives(owner){checkOwner(owner);return store.listArchives(owner);},
 async readArchive(owner,id){checkOwner(owner);if(!/^[a-f0-9]{64}$/.test(id))throw fail(400,'invalid-archive-id');const result=await store.readArchive(owner,id);if(!result)throw fail(404,'archive-not-found');return result;}
};}
