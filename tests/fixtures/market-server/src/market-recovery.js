import { Router } from 'express';
import { fail, payloadHash } from './security.js';

const isUuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const exact=(o,k)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).sort().join(',')===k.sort().join(',');
const positive=(v,max)=>Number.isSafeInteger(v)&&v>0&&v<=max;
const items=new Set(['crop:rice','crop:vegetables','crop:sugarcane','product:milled-rice','product:canned-food','product:sugar']);
const listingItems=new Set([...items,'wood','stone','iron']);

export function normalizeRecovery(kind,key,payload){
  if(!['buy','listing','cancel','deposit'].includes(kind)||typeof key!=='string'||key.length<1||key.length>128)throw fail(400,'invalid operation identity');
  if(kind==='buy'){
    if(!exact(payload,['listing_id','quantity'])||!isUuid(payload.listing_id)||!positive(payload.quantity,1000000))throw fail(400,'invalid recovery payload');
    return {kind,key,payload:{listing_id:payload.listing_id,quantity:payload.quantity}};
  }
  if(kind==='cancel'){
    if(!exact(payload,['listing_id'])||!isUuid(payload.listing_id))throw fail(400,'invalid recovery payload');
    return {kind,key,payload:{listing_id:payload.listing_id}};
  }
  if(kind==='deposit'){
    if(!exact(payload,['opId','itemId','qty'])||!isUuid(payload.opId)||!isUuid(key)||payload.opId.toLowerCase()!==key.toLowerCase()||!items.has(payload.itemId)||!positive(payload.qty,1000000))throw fail(400,'invalid recovery payload');
    return {kind,key:key.toLowerCase(),payload:{opId:payload.opId,itemId:payload.itemId,qty:payload.qty}};
  }
  const hasExpiry=Object.hasOwn(payload??{},'expires_at');
  if(!exact(payload,hasExpiry?['item_code','unit_price','quantity','expires_at']:['item_code','unit_price','quantity'])||!listingItems.has(payload.item_code)||!positive(payload.unit_price,1000000)||!positive(payload.quantity,1000000)||BigInt(payload.unit_price)*BigInt(payload.quantity)>9000000000000000n||(hasExpiry&&payload.expires_at!==null&&(typeof payload.expires_at!=='string'||payload.expires_at.length>64||!Number.isFinite(Date.parse(payload.expires_at)))))throw fail(400,'invalid recovery payload');
  return {kind,key,payload:{item_code:payload.item_code,unit_price:payload.unit_price,quantity:payload.quantity,expires_at:payload.expires_at||null}};
}
const mismatch=()=>{throw fail(409,'operation-payload-mismatch');};
const shapeDone=(kind,response,http_status)=>({state:'done',kind,http_status,response});

async function lock(c,account,key,kind){
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['citymanager:recovery:'+account+':'+key]);
  if(kind==='deposit')await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['citymanager:deposit:'+key.toLowerCase()]);
}

// Caller owns the transaction and the account/key lock. These tables are only
// consulted while the feature is enabled; no historical operation is rewritten.
async function lookupLocked(c,account,operation){
  const {kind,key,payload}=operation,digest=payloadHash(payload);
  const result=await c.query('SELECT kind,payload_hash,http_status,response FROM market_recovery_results WHERE account_id=$1 AND key=$2',[account,key]);
  const fence=await c.query('SELECT kind,payload_hash FROM market_recovery_fences WHERE account_id=$1 AND key=$2',[account,key]);
  if(result.rowCount&&fence.rowCount)return {state:'reconciliation_required'};
  if(result.rowCount){const row=result.rows[0];if(row.kind!==kind||row.payload_hash!==digest)mismatch();return shapeDone(kind,row.response,Number(row.http_status));}
  if(fence.rowCount){const row=fence.rows[0];if(row.kind!==kind||row.payload_hash!==digest)mismatch();return {state:'fenced',kind,committed:false};}
  const legacy=await c.query(`SELECT k.payload_hash,k.response,
    EXISTS(SELECT 1 FROM purchases p WHERE p.operation_id=k.operation_id AND p.buyer_id=k.account_id) AS is_buy,
    EXISTS(SELECT 1 FROM listings l WHERE l.id=k.operation_id AND l.seller_id=k.account_id) AS is_listing
    FROM idempotency_keys k WHERE k.account_id=$1 AND k.key=$2`,[account,key]);
  if(legacy.rowCount){const row=legacy.rows[0];if(row.is_buy===row.is_listing)return {state:'reconciliation_required'};const actual=row.is_buy?'buy':'listing';if(actual!==kind||row.payload_hash!==digest)mismatch();return shapeDone(kind,row.response,201);}
  if(isUuid(key)){
    const dep=await c.query('SELECT op_id,item_code,quantity,payload_hash,state,seq FROM deposit_operations WHERE op_id=$1 AND account_id=$2',[key,account]);
    if(dep.rowCount){const row=dep.rows[0];if(kind!=='deposit'||row.payload_hash!==digest)mismatch();if(row.state!=='done')return {state:'reconciliation_required'};return shapeDone('deposit',{depositId:row.op_id,itemId:row.item_code,qty:Number(row.quantity),seq:String(row.seq),state:row.state,idempotent:true},201);}
  }
  return {state:'unknown'};
}

export async function beginRecovery(c,account,kind,key,payload){
  const operation=normalizeRecovery(kind,key,payload);await lock(c,account,operation.key,operation.kind);
  const current=await lookupLocked(c,account,operation);
  if(current.state==='fenced')throw fail(409,'operation fenced');
  if(current.state==='reconciliation_required')throw fail(409,'operation requires reconciliation');
  return {operation,current};
}
export async function recordRecovery(c,account,operation,status,response){
  await c.query('INSERT INTO market_recovery_results(account_id,key,kind,payload_hash,http_status,response) VALUES($1,$2,$3,$4,$5,$6)',[account,operation.key,operation.kind,payloadHash(operation.payload),status,response]);
}

export function marketRecoveryRouter({tx,guest,csrf,strictCancel=false}){
  const router=Router();router.use((_req,res,next)=>{res.set('Cache-Control','no-store');next();});router.use(guest,csrf);
  for(const action of ['status','fence'])router.post('/'+action,async(req,res,next)=>{try{
    if(!exact(req.body,['kind','key','payload']))throw fail(400,'invalid recovery request');
    if(action==='fence'&&req.body.kind==='deposit'&&process.env.MARKET_ALLOW_DEPOSITS!=='true')throw fail(403,'policy-disabled');
    if(action==='fence'&&req.body.kind==='cancel'&&!strictCancel)throw fail(409,'keyed cancellation enforcement required');
    const operation=normalizeRecovery(req.body.kind,req.body.key,req.body.payload);
    const result=await tx(async c=>{
      await lock(c,req.account.id,operation.key,operation.kind);const current=await lookupLocked(c,req.account.id,operation);
      if(action==='status'||current.state!=='unknown')return current;
      if(operation.kind==='cancel'){
        const row=await c.query('SELECT status FROM listings WHERE id=$1 AND seller_id=$2',[operation.payload.listing_id,req.account.id]);
        if(row.rows[0]?.status==='cancelled')return {state:'reconciliation_required'};
      }
      if(operation.kind==='deposit'){
        const dep=await c.query('SELECT account_id FROM deposit_operations WHERE op_id=$1',[operation.key]);if(dep.rowCount&&dep.rows[0].account_id!==req.account.id)throw fail(409,'op-unavailable');
        const cancellation=await c.query('SELECT account_id FROM deposit_cancellations WHERE op_id=$1',[operation.key]);if(cancellation.rowCount&&cancellation.rows[0].account_id!==req.account.id)throw fail(409,'op-unavailable');
        if(!cancellation.rowCount)await c.query('INSERT INTO deposit_cancellations(op_id,account_id) VALUES($1,$2)',[operation.key,req.account.id]);
      }
      await c.query('INSERT INTO market_recovery_fences(account_id,key,kind,payload_hash) VALUES($1,$2,$3,$4)',[req.account.id,operation.key,operation.kind,payloadHash(operation.payload)]);
      return {state:'fenced',kind:operation.kind,committed:false};
    });res.json(result);
  }catch(e){next(e);}});
  return router;
}
