import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
const hash=s=>createHash('sha256').update(s).digest('hex');
const fail=code=>Object.assign(Error(code),{status:409});
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
function readable(h,owner){
 const m=h.metadata;if(!uuid(h.cityId)||!m||typeof m!=='object'||Array.isArray(m)||Object.keys(m).sort().join(',')!=='name,population,tick'||typeof m.name!=='string'||m.name.length>120||!Number.isSafeInteger(m.population)||m.population<0||!Number.isSafeInteger(m.tick)||m.tick<0||Buffer.byteLength(h.raw)>8*1024*1024)return false;
 let v;try{v=JSON.parse(h.raw);}catch{return false;}
 if(!v||typeof v!=='object'||Array.isArray(v))return false;
 const market=v.market;if(!market)return true;
 return market.version===10&&market.cityId===h.cityId&&(market.guestId===null||market.guestId===owner)&&Array.isArray(market.operations)&&Array.isArray(market.escrow)&&!!market.receipts&&typeof market.receipts==='object'&&!Array.isArray(market.receipts)&&!(market.guestId===null&&(market.operations.length||market.escrow.length||Object.keys(market.receipts).length));
}
// The host must lock account and all legacy writers, then keep the original
// records untouched. All operations below run in one rollback-safe transaction.
export function createLegacyMigration(adapter){return {
 async copyToSlot1(owner){return adapter.transaction(owner,async tx=>{
  if(typeof tx.activeIntent!=='function')throw fail('intent-fence-unavailable');
  if(await tx.activeIntent()!==null)throw fail('pending-intent-conflict');
  if(await tx.cutoverReady()!==true)throw fail('legacy-cutover-unverified');
  const marker=await tx.lockLegacyMarker();if(marker!==null)throw fail('migration-already-marked');
  const bundle=await tx.lockLegacyBundle();
  if(!bundle || bundle.owner!==owner || !bundle.head || bundle.head.owner!==owner || bundle.head.deleted || !Array.isArray(bundle.snapshots) || !Array.isArray(bundle.receipts))throw fail('legacy-invalid');
  const {head,snapshots,receipts}=bundle;
  if(typeof head.raw!=='string' || !head.raw.length || hash(head.raw)!==head.rawHash || !Number.isSafeInteger(head.revision)||head.revision<1 || snapshots.length===0 || !readable(head,owner))throw fail('legacy-invalid');
  if(snapshots.some(s=>s.owner!==owner||s.cityId!==head.cityId||typeof s.raw!=='string'||hash(s.raw)!==s.rawHash||typeof s.metadataJson!=='string'||!Number.isSafeInteger(s.revision)||s.revision<1))throw fail('legacy-invalid');
  if(snapshots.some(s=>s.revision>head.revision)||new Set(snapshots.map(s=>s.revision)).size!==snapshots.length)throw fail('legacy-history-conflict');
  const active=snapshots.find(s=>s.revision===head.revision&&s.raw===head.raw&&s.rawHash===head.rawHash);
  if(!active || await tx.verifyActiveMetadata(head)!==true)throw fail('legacy-head-mismatch');
  if(receipts.some(r=>r.owner!==owner || typeof r.requestId!=='string' || typeof r.payloadHash!=='string' || typeof r.responseJson!=='string'))throw fail('legacy-receipt-invalid');
  if((await tx.listInstances()).some(c=>!c.retired))throw fail('legacy-slot-occupied');
  await tx.insertInstance({owner,cityId:head.cityId,slot:1});
  await tx.copyLegacyBundle(bundle);
  const copy=await tx.readCopiedBundle(head.cityId);
  // Host returns deterministic, owner-scoped data including every snapshot and receipt.
  if(!isDeepStrictEqual(copy,bundle))throw fail('migration-verification-failed');
  await tx.recordLegacyMarker(head.cityId);
  return {owner,cityId:head.cityId,slot:1,revision:head.revision,rawHash:head.rawHash,snapshots:snapshots.length,receipts:receipts.length};
 });}
};}
