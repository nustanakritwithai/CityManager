import { fail, payloadHash } from './security.js';

export async function lockTradeKey(c,account,key){await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['citymanager:recovery:'+account+':'+key]);}
export async function getTradeRejection(c,account,key,kind,payload){
  const r=await c.query('SELECT r.kind,r.payload_hash,r.response,(EXISTS(SELECT 1 FROM idempotency_keys i WHERE i.account_id=r.account_id AND i.key=r.operation_key) OR EXISTS(SELECT 1 FROM trade_cancel_results x WHERE x.account_id=r.account_id AND x.operation_key=r.operation_key)) AS has_success FROM trade_rejections r WHERE r.account_id=$1 AND r.operation_key=$2',[account,key]);if(!r.rowCount)return null;if(r.rows[0].has_success)throw fail(409,'operation requires reconciliation');
  if(r.rows[0].kind!==kind||r.rows[0].payload_hash!==payloadHash(payload))throw fail(409,'idempotency key payload mismatch');
  return r.rows[0].response;
}
export async function assertNoCancelResult(c,account,key){if((await c.query('SELECT 1 FROM trade_cancel_results WHERE account_id=$1 AND operation_key=$2',[account,key])).rowCount)throw fail(409,'idempotency key payload mismatch');}
export async function getCancelResult(c,account,key,payload){
  const prior=await c.query('SELECT payload_hash,response FROM trade_cancel_results WHERE account_id=$1 AND operation_key=$2',[account,key]);
  if((await c.query('SELECT 1 FROM idempotency_keys WHERE account_id=$1 AND key=$2',[account,key])).rowCount)throw fail(409,'idempotency key payload mismatch');
  if(!prior.rowCount)return null;if(prior.rows[0].payload_hash!==payloadHash(payload))throw fail(409,'idempotency key payload mismatch');return prior.rows[0].response;
}
export async function saveCancelResult(c,account,key,payload,response){await c.query('INSERT INTO trade_cancel_results(account_id,operation_key,payload_hash,response) VALUES($1,$2,$3,$4)',[account,key,payloadHash(payload),response]);}
export async function saveTradeRejection(c,account,key,kind,payload,reason){
  const response={error:reason,code:'trade_rejected',state:'rejected',committed:false,guest_id:account,kind,key,payload};
  await c.query('INSERT INTO trade_rejections(account_id,operation_key,kind,payload_hash,response) VALUES($1,$2,$3,$4,$5)',[account,key,kind,payloadHash(payload),response]);return response;
}
