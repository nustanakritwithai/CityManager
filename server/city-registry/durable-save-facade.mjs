import {createHash} from 'node:crypto';
import {createServerCityService} from '../city-saves/service.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex');
const uuid=s=>typeof s==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(s);
const fail=(code='intent-authority-denied')=>Object.assign(Error(code),{status:409});
const same=(a,b)=>a&&b&&a.name===b.name&&a.population===b.population&&a.tick===b.tick;
// The adapter and authenticator are trusted host dependencies, captured in the
// closure. Never pass the facade a route-controlled adapter or authenticator.
export function createDurableSaveFacade({adapter,authenticate}){
 if(!adapter||typeof adapter.transaction!=='function'||typeof authenticate!=='function')throw Error('missing-dependency');
 return Object.freeze({async attempt(request,intent){
  if(!intent||typeof intent!=='object')throw fail();
  const candidate=Object.freeze({requestId:intent.requestId,cityId:intent.cityId,expectedRevision:intent.expectedRevision,body:intent.body});
  const context=await authenticate(request);
  if(!context)throw fail();
  const {ownerId:owner,sessionBinding}=context;
  if(!uuid(owner)||typeof sessionBinding!=='string'||sessionBinding.length<32||sessionBinding.length>512||!uuid(candidate.requestId)||!uuid(candidate.cityId)||!Number.isSafeInteger(candidate.expectedRevision)||candidate.expectedRevision<1||typeof candidate.body!=='string'||Buffer.byteLength(candidate.body)>6*8*1024*1024+16384)throw fail();
  const outcome=await adapter.transaction(owner,async tx=>{
   const row=await tx.activeIntent();
   if(!row||row.owner!==owner)throw fail();
   if(row.sessionHash!==hash(sessionBinding))throw fail('session-reconciliation-required');
   if(!['pending','applied'].includes(row.state))throw fail();
   const revealed=await tx.revealIntent(row);
   if(!revealed||revealed.body!==candidate.body||row.requestId!==candidate.requestId||row.cityId!==candidate.cityId||row.expectedRevision!==candidate.expectedRevision||row.bodyHash!==hash(candidate.body))throw fail();
   let body;try{body=JSON.parse(candidate.body);}catch{throw fail();}
   if(!body||Object.keys(body).sort().join(',')!=='action,cityId,expectedRevision,metadata,raw'||body.action!=='save'||body.cityId!==row.cityId||body.expectedRevision!==row.expectedRevision||typeof body.raw!=='string'||row.payloadHash!==hash(JSON.stringify(body))||row.rawHash!==hash(body.raw))throw fail();
   const city=await tx.lockInstance(row.cityId);if(!city||city.owner!==owner||city.cityId!==row.cityId||city.retired){await tx.markManual(row.requestId,'city-lifecycle-changed');return {error:'city-lifecycle-changed'};}
   const db=await tx.citySaveStore(row.cityId);await tx.savepoint();
   try{
    const service=createServerCityService({transaction:(_owner,fn)=>fn(db)});
    const ack=await service.mutate(owner,row.requestId,body);
    if(ack.owner!==owner||ack.cityId!==row.cityId||ack.revision!==row.expectedRevision+1||ack.raw!==body.raw||ack.rawHash!==row.rawHash||!same(ack.metadata,body.metadata))throw Error('invalid-save-ack');
    await tx.markApplied(row.requestId,ack.revision,ack.rawHash);await tx.releaseSavepoint();
    return {ack:{cityId:ack.cityId,revision:ack.revision,raw:ack.raw,rawHash:ack.rawHash,metadata:ack.metadata}};
   }catch(e){
    if(e?.status!==409)throw e;
    await tx.rollbackSavepoint();await tx.releaseSavepoint();
    const allowed=new Set(['legacy-receipt-reconciliation-required','save-conflict','idempotency-mismatch','city-lifecycle-changed','market-identity-mismatch','market-journal-frozen','revision-exhausted']);
    const code=allowed.has(e.message)?e.message:'save-reconciliation-required';await tx.markManual(row.requestId,code);return {error:code};
   }
  });
  if(outcome.error)throw fail(outcome.error);return outcome.ack;
 }});
}
