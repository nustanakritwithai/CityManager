import {createHash} from 'node:crypto';
import {createDurableSaveFacade} from '../city-registry/durable-save-facade.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH=/^[0-9a-f]{64}$/;
// PostgreSQL returns UUIDs lowercase; require canonical form for exact AAD and receipts.
const uuid=x=>typeof x==='string'&&UUID.test(x)&&x===x.toLowerCase();
const hash=x=>createHash('sha256').update(x).digest('hex');
const fail=(code,status=409)=>Object.assign(Error(code),{status,code});
const metadata=m=>!!m&&typeof m==='object'&&!Array.isArray(m)&&Object.keys(m).sort().join(',')==='name,population,tick'&&typeof m.name==='string'&&m.name.length<=120&&Number.isSafeInteger(m.population)&&m.population>=0&&Number.isSafeInteger(m.tick)&&m.tick>=0;
const sameMeta=(a,b)=>metadata(a)&&metadata(b)&&a.name===b.name&&a.population===b.population&&a.tick===b.tick;
function auth(context){
 if(!context)throw fail('authentication-required',401);
 const {ownerId,sessionBinding}=context;
 if(!uuid(ownerId)||typeof sessionBinding!=='string'||sessionBinding.length<32||sessionBinding.length>512)throw fail('authentication-required',401);
 return {owner:ownerId,sessionBinding,sessionHash:hash(sessionBinding)};
}
function command(intent){
 if(!intent||Object.keys(intent).sort().join(',')!=='body,cityId,expectedRevision,requestId'||!uuid(intent.requestId)||!uuid(intent.cityId)||!Number.isSafeInteger(intent.expectedRevision)||intent.expectedRevision<1||typeof intent.body!=='string'||Buffer.byteLength(intent.body)>6*8*1024*1024+16384)throw fail('invalid-intent',400);
 let body;try{body=JSON.parse(intent.body);}catch{throw fail('invalid-intent',400);}
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).sort().join(',')!=='action,cityId,expectedRevision,metadata,raw'||body.action!=='save'||body.cityId!==intent.cityId||body.expectedRevision!==intent.expectedRevision||typeof body.raw!=='string'||!body.raw.length||Buffer.byteLength(body.raw)>8*1024*1024||!metadata(body.metadata))throw fail('invalid-intent',400);
 let raw;try{raw=JSON.parse(body.raw);}catch{throw fail('invalid-intent',400);}
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||raw.market&&(typeof raw.market!=='object'||raw.market.cityId!==intent.cityId))throw fail('invalid-intent',400);
 return body;
}
const input=(row)=>({requestId:row.requestId,cityId:row.cityId,expectedRevision:row.expectedRevision,body:row.body});
const bound=(row,a)=>{if(row.sessionHash!==a.sessionHash)throw fail('session-reconciliation-required');};
function exact(row,intent){return row.requestId===intent.requestId&&row.cityId===intent.cityId&&row.expectedRevision===intent.expectedRevision&&(row.state==='completed'&&row.body===null||row.body===intent.body)&&row.bodyHash===hash(intent.body);}
const publicStatus=row=>({intent:input(row),state:row.state==='manual'?'manual':'pending'});
function validateHead(head,owner,cityId){return head&&head.owner===owner&&head.cityId===cityId&&Number.isSafeInteger(head.revision)&&head.revision>0&&typeof head.raw==='string'&&HASH.test(head.rawHash)&&hash(head.raw)===head.rawHash&&metadata(head.metadata);}
function verifyAck(ack,a,row,body){
 if(!validateHead(ack,a.owner,row.cityId)||ack.revision!==row.expectedRevision+1||ack.raw!==body.raw||ack.rawHash!==row.rawHash||!sameMeta(ack.metadata,body.metadata))throw Error('invalid-save-ack');
}
const manualCodes=new Set(['legacy-receipt-reconciliation-required','save-conflict','idempotency-mismatch','city-lifecycle-changed','market-identity-mismatch','market-journal-frozen','revision-exhausted','save-reconciliation-required']);

// Recheck under the same owner transaction; no writer is obtained here.
async function completedReplay(adapter,a,intent,body){
 return adapter.transaction(a.owner,async tx=>{
  const active=await tx.activeIntent(),row=await tx.findIntent(intent.requestId);
  if(row?.state==='completed'){
   if(row.owner!==a.owner)throw fail('intent-mismatch');bound(row,a);
   if(!exact(row,intent)||row.payloadHash!==hash(JSON.stringify(body)))throw fail('intent-mismatch');
   const city=await tx.lockInstance(row.cityId);if(!city||city.owner!==a.owner||city.cityId!==row.cityId||city.retired)throw fail('city-lifecycle-changed');
   const receipt=await tx.readIntentReceipt(row.cityId,row.requestId);if(!receipt||receipt.payloadHash!==row.payloadHash)throw Error('invalid-save-receipt');
   const ack={...receipt.response,raw:body.raw};verifyAck(ack,a,row,body);if(ack.revision!==row.ackRevision||ack.rawHash!==row.ackHash)throw Error('invalid-save-receipt');
   return {kind:'ack',ack:{cityId:ack.cityId,revision:ack.revision,rawHash:ack.rawHash,raw:ack.raw,metadata:ack.metadata}};
  }
  if(active){
   if(active.owner!==a.owner)throw fail('intent-mismatch');bound(active,a);
   if(active.state==='manual'){
    const revealed=await tx.revealIntent(active);
    if(!exact(revealed,intent)||revealed.payloadHash!==hash(JSON.stringify(body)))throw fail('intent-mismatch');
    return {kind:'manual',code:revealed.manualCode};
   }
   return {kind:'active'};
  }
  return {kind:'missing'};
 });
}

/** Isolated server-only intent protocol. All tx methods must share team 1's
 * owner lock + save transaction. `authenticate` is a host concern. */
export function createDurableIntentService(adapter){
 if(!adapter||typeof adapter.transaction!=='function')throw Error('missing-adapter');
 // The facade and adapter stay inside the composition closure. The gateway
 // supplies an already-authenticated frozen context; never expose the facade.
 const facade=createDurableSaveFacade({adapter,authenticate:async context=>context});
 const service={
  async current(context){const a=auth(context);return adapter.transaction(a.owner,async tx=>{let row=await tx.activeIntent();if(!row)return {intent:null};bound(row,a);row=await tx.revealIntent(row);return {intent:publicStatus(row)};});},
  async prepare(context,intent){
   const a=auth(context),body=command(intent),parsed=JSON.parse(body.raw);
   if(parsed.market&&parsed.market.guestId!==null&&parsed.market.guestId!==a.owner)throw fail('invalid-intent',400);
   intent=Object.freeze({requestId:intent.requestId,cityId:intent.cityId,expectedRevision:intent.expectedRevision,body:intent.body});
   return adapter.transaction(a.owner,async tx=>{
    let active=await tx.activeIntent();if(active){bound(active,a);active=await tx.revealIntent(active);if(!exact(active,intent))throw fail('pending-intent-conflict');if(active.state==='manual')throw fail(active.manualCode);return {requestId:active.requestId,state:'pending'};}
    const prior=await tx.findIntent(intent.requestId);if(prior){bound(prior,a);if(prior.state==='completed'&&exact(prior,intent)&&prior.payloadHash===hash(JSON.stringify(body)))return {requestId:prior.requestId,state:'pending'};throw fail('intent-id-not-reusable');}
    const count=await tx.intentCount();if(!Number.isSafeInteger(count)||count<0)throw Error('invalid-intent-count');if(count>=100000)throw fail('intent-capacity',413);
    const city=await tx.lockInstance(intent.cityId);if(!city||city.owner!==a.owner||city.cityId!==intent.cityId||city.retired)throw fail('city-not-found',404);
    const save=await tx.lockSave(intent.cityId);if(!validateHead(save,a.owner,intent.cityId))throw fail('save-unavailable',503);
    const row={...intent,owner:a.owner,sessionHash:a.sessionHash,bodyHash:hash(intent.body),payloadHash:hash(JSON.stringify(body)),rawHash:hash(body.raw)};
    await tx.insertIntent(row);return {requestId:intent.requestId,state:'pending'};
   });
  },
  async attempt(context,intent){
   const a=auth(context),body=command(intent);
   context=Object.freeze({ownerId:a.owner,sessionBinding:a.sessionBinding});
   intent=Object.freeze({requestId:intent.requestId,cityId:intent.cityId,expectedRevision:intent.expectedRevision,body:intent.body});
   const active=await service.current(context);
   if(active.intent){
    // Exact prepare preserves the persisted manual code without exposing a store.
    try{await service.prepare(context,intent);}catch(error){
     if(error?.code!=='pending-intent-conflict')throw error;
     const replay=await completedReplay(adapter,a,intent,body);if(replay.kind==='ack')return replay.ack;
     throw fail('intent-mismatch');
    }
    try{return await facade.attempt(context,intent);}catch(error){
     if(error?.status!==409)throw error;
     if(error.message==='intent-authority-denied'){
      const replay=await completedReplay(adapter,a,intent,body);
      if(replay.kind==='ack')return replay.ack;
      if(replay.kind==='manual')throw fail(replay.code);
     }
     throw fail(manualCodes.has(error.message)?error.message:'intent-mismatch');
    }
   }
   // Completed replay is deliberately read-only and cannot call publish/record.
   const replay=await completedReplay(adapter,a,intent,body);
   if(replay.kind==='ack')return replay.ack;
   if(replay.kind==='manual')throw fail(replay.code);
   throw fail(replay.kind==='active'?'pending-intent-conflict':'intent-not-found');
  },
  async complete(context,requestId){
   const a=auth(context);if(!uuid(requestId))throw fail('invalid-intent',400);
   const result=await adapter.transaction(a.owner,async tx=>{
    const row=await tx.findIntent(requestId);if(!row)throw fail('intent-not-found');bound(row,a);
    if(row.state==='completed')return {requestId,completed:true};
    if(row.state!=='applied')throw fail('intent-not-completable');
    const revealed=await tx.revealIntent(row),body=command(input(revealed)), city=await tx.lockInstance(row.cityId);
    if(!city||city.owner!==a.owner||city.cityId!==row.cityId||city.retired){await tx.markManual(requestId,'city-lifecycle-changed');return {error:'city-lifecycle-changed'};}
    let receipt;
    try{receipt=await tx.readIntentReceipt(row.cityId,row.requestId);}catch(error){if(error?.status!==409)throw error;const code=manualCodes.has(error.message)?error.message:'save-reconciliation-required';await tx.markManual(requestId,code);return {error:code};}
    const head=await tx.lockSave(row.cityId),ack=receipt?.response;
    if(!receipt||receipt.payloadHash!==row.payloadHash||!ack||ack.owner!==a.owner||ack.cityId!==row.cityId||ack.revision!==row.ackRevision||ack.rawHash!==row.ackHash||row.ackHash!==row.rawHash||row.ackRevision!==row.expectedRevision+1||!sameMeta(ack.metadata,body.metadata)||!validateHead(head,a.owner,row.cityId)||head.revision<row.ackRevision||head.revision===row.ackRevision&&(head.rawHash!==row.ackHash||!sameMeta(head.metadata,ack.metadata))){await tx.markManual(requestId,'intent-not-completable');return {error:'intent-not-completable'};}
    await tx.markCompleted(requestId);return {requestId,completed:true};
   });
   if(result.error)throw fail(result.error);return result;
  }
 };
 return Object.freeze(service);
}
