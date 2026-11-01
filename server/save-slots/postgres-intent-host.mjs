// Wrap team 1's privateSaveHost on the SAME q/transaction. Never open a second
// connection here. Team 1 postgresIntegration must lock account + owner first.
export function intentHost(baseHost,codec) {
 if(typeof baseHost!=='function'||!codec||typeof codec.seal!=='function'||typeof codec.open!=='function') throw Error('missing-host');
 return async (q,owner)=>{
  const base=await baseHost(q,owner);if(!base||typeof base!=='object')throw Error('invalid-base-host');
  const map=r=>{if(!r)return r;const i={owner:r.owner_id,requestId:r.request_id,cityId:r.city_id,sessionHash:r.session_hash,expectedRevision:Number(r.expected_revision),bodyHash:r.body_hash,payloadHash:r.payload_hash,rawHash:r.raw_hash,state:r.state,manualCode:r.manual_code,ackRevision:r.ack_revision===null?null:Number(r.ack_revision),ackHash:r.ack_hash};return {...i,...(r.state==='completed'?{body:null}:{sealed:{keyId:r.key_id,nonce:r.body_nonce,tag:r.body_tag,ciphertext:r.body_cipher}})};};
  return {...base,
   async activeIntent(){return map((await q.query("SELECT * FROM city_registry.save_intents WHERE owner_id=$1 AND state<>'completed' FOR UPDATE",[owner])).rows[0]);},
   async findIntent(id){return map((await q.query('SELECT * FROM city_registry.save_intents WHERE owner_id=$1 AND request_id=$2 FOR UPDATE',[owner,id])).rows[0]);},
   async revealIntent(i){return i.state==='completed'?i:{...i,body:codec.open(i,i.sealed)};},
   async intentCount(){return Number((await q.query('SELECT count(*) AS count FROM city_registry.save_intents WHERE owner_id=$1',[owner])).rows[0].count);},
   async readIntentReceipt(cityId,requestId){
    const legacy=await q.query('SELECT 1 FROM city_registry.legacy_receipt_archive WHERE owner_id=$1 AND request_id=$2',[owner,requestId]);
    if(legacy.rowCount>0)throw Object.assign(Error('legacy-receipt-reconciliation-required'),{status:409});
    const r=(await q.query('SELECT payload_hash,response FROM city_registry.save_receipts WHERE owner_id=$1 AND city_id=$2 AND request_id=$3',[owner,cityId,requestId])).rows[0];
    return r&&{payloadHash:r.payload_hash,response:r.response};
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
