// Wrap team 1's privateSaveHost on the SAME q/transaction. Never open a second
// connection here. Team 1 postgresIntegration must lock account + owner first.
export function intentHost(baseHost,codec) {
 if(typeof baseHost!=='function'||!codec||typeof codec.seal!=='function'||typeof codec.open!=='function') throw Error('missing-host');
 return async (q,owner)=>{
  const base=await baseHost(q,owner);if(!base||typeof base!=='object')throw Error('invalid-base-host');
  const map=r=>{if(!r)return r;const i={owner:r.owner_id,requestId:r.request_id,cityId:r.city_id,sessionHash:r.session_hash,expectedRevision:Number(r.expected_revision),bodyHash:r.body_hash,payloadHash:r.payload_hash,rawHash:r.raw_hash,state:r.state,manualCode:r.manual_code,ackRevision:r.ack_revision===null?null:Number(r.ack_revision),ackHash:r.ack_hash};return {...i,...(r.state==='completed'?{body:null}:{sealed:{keyId:r.key_id,nonce:r.body_nonce,tag:r.body_tag,ciphertext:r.body_cipher}})};};
  // A query with no rows represents absence; malformed results are not absence.
  const one=result=>{
   if(!result||!Array.isArray(result.rows)||result.rows.length>1)throw Error('invalid-intent-query-result');
   if(result.rows.length===0)return null;
   const row=result.rows[0];if(!row||typeof row!=='object'||Array.isArray(row))throw Error('invalid-intent-query-result');return row;
  };
  const intent=(result,allowed)=>{const row=one(result);if(row===null)return null;if(row.owner_id!==owner||!allowed.includes(row.state))throw Error('invalid-intent-row');return map(row);};
  return {...base,
   async activeIntent(){return intent(await q.query("SELECT * FROM city_registry.save_intents WHERE owner_id=$1 AND state<>'completed' FOR UPDATE",[owner]),['pending','applied','manual']);},
   async findIntent(id){return intent(await q.query('SELECT * FROM city_registry.save_intents WHERE owner_id=$1 AND request_id=$2 FOR UPDATE',[owner,id]),['pending','applied','manual','completed']);},
   async revealIntent(i){return i.state==='completed'?i:{...i,body:codec.open(i,i.sealed)};},
   async intentCount(){return Number((await q.query('SELECT count(*) AS count FROM city_registry.save_intents WHERE owner_id=$1',[owner])).rows[0].count);},
   async readIntentReceipt(cityId,requestId){
    const legacy=await q.query('SELECT 1 FROM city_registry.legacy_receipt_archive WHERE owner_id=$1 AND request_id=$2',[owner,requestId]);
    if(legacy.rowCount>0)throw Object.assign(Error('legacy-receipt-reconciliation-required'),{status:409});
    const r=one(await q.query('SELECT payload_hash,response FROM city_registry.save_receipts WHERE owner_id=$1 AND city_id=$2 AND request_id=$3',[owner,cityId,requestId]));
    return r?{payloadHash:r.payload_hash,response:r.response}:null;
   },
   async insertIntent(i){if(i.owner!==owner)throw Error('owner-mismatch');const sealed=codec.seal(i);await q.query('INSERT INTO city_registry.save_intents(owner_id,request_id,city_id,session_hash,expected_revision,body_cipher,body_nonce,body_tag,key_id,body_hash,payload_hash,raw_hash,state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',[owner,i.requestId,i.cityId,i.sessionHash,i.expectedRevision,sealed.ciphertext,sealed.nonce,sealed.tag,sealed.keyId,i.bodyHash,i.payloadHash,i.rawHash,'pending']);},
   async markManual(id,code){await q.query("UPDATE city_registry.save_intents SET state='manual',manual_code=$3,updated_at=now() WHERE owner_id=$1 AND request_id=$2",[owner,id,code]);},
   async markApplied(id,revision,hash){await q.query("UPDATE city_registry.save_intents SET state='applied',ack_revision=$3,ack_hash=$4,updated_at=now() WHERE owner_id=$1 AND request_id=$2",[owner,id,revision,hash]);},
   async markCompleted(id){await q.query("UPDATE city_registry.save_intents SET state='completed',body_cipher=NULL,body_nonce=NULL,body_tag=NULL,key_id=NULL,updated_at=now() WHERE owner_id=$1 AND request_id=$2",[owner,id]);},
   async savepoint(){await q.query('SAVEPOINT intent_attempt');},
   async rollbackSavepoint(){await q.query('ROLLBACK TO SAVEPOINT intent_attempt');},
   async releaseSavepoint(){await q.query('RELEASE SAVEPOINT intent_attempt');}
  };
 };
}
