// Standalone schema host. No deletion, archive migration or obligation support.
// `cutoverReady` must establish actual old-writer fencing, not merely a config flag.
export function privateSaveHost({cutoverReady}) {
 if(typeof cutoverReady!=='function') throw Error('missing-cutover-verifier');
 return (q,owner)=>{
  const rejectLegacyKey=async id=>{const r=await q.query('SELECT 1 FROM city_registry.legacy_receipt_archive WHERE owner_id=$1 AND request_id=$2',[owner,id]);if(r.rowCount>0)throw Object.assign(Error('legacy-receipt-reconciliation-required'),{status:409});};
  const row=r=>r&&({owner:r.owner_id,cityId:r.city_id,revision:Number(r.revision),raw:r.raw,rawHash:r.raw_hash,metadata:r.metadata});
  const lockSave=async cityId=>{if(await cutoverReady(q,owner)!==true)throw Error('legacy-cutover-unverified');return row((await q.query('SELECT * FROM city_registry.save_heads WHERE owner_id=$1 AND city_id=$2 FOR UPDATE',[owner,cityId])).rows[0]);};
  const publish=async v=>{
   if(v.owner!==owner)throw Error('owner-mismatch');
   await q.query('INSERT INTO city_registry.save_history(owner_id,city_id,revision,raw,raw_hash,metadata) VALUES($1,$2,$3,$4,$5,$6)',[owner,v.cityId,v.revision,v.raw,v.rawHash,JSON.stringify(v.metadata)]);
   await q.query('INSERT INTO city_registry.save_heads(owner_id,city_id,revision,raw,raw_hash,metadata) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(owner_id,city_id) DO UPDATE SET revision=EXCLUDED.revision,raw=EXCLUDED.raw,raw_hash=EXCLUDED.raw_hash,metadata=EXCLUDED.metadata',[owner,v.cityId,v.revision,v.raw,v.rawHash,JSON.stringify(v.metadata)]);
  };
  return {cutoverReady:()=>cutoverReady(q,owner),lockSave,
   bindLegacySaveUnchanged:async legacy=>{if(await lockSave(legacy.cityId))throw Error('save-already-bound');await publish(legacy);},
   createReceipt:async id=>{await rejectLegacyKey(id);const r=(await q.query('SELECT payload_hash,city_id,result FROM city_registry.atomic_create_receipts WHERE owner_id=$1 AND request_id=$2',[owner,id])).rows[0];return r&&{payloadHash:r.payload_hash,cityId:r.city_id,result:r.result};},
   recordCreateReceipt:async(id,h,cityId,result)=>{await rejectLegacyKey(id);return q.query('INSERT INTO city_registry.atomic_create_receipts(owner_id,request_id,city_id,payload_hash,result) VALUES($1,$2,$3,$4,$5)',[owner,id,cityId,h,JSON.stringify(result)]);},
   citySaveStore:async cityId=>({
    current:()=>lockSave(cityId), deletionFence:async()=>0, wasRetired:async()=>false,
    requestCount:async()=>Number((await q.query('SELECT count(*) AS count FROM city_registry.save_receipts WHERE owner_id=$1 AND city_id=$2',[owner,cityId])).rows[0].count),
    request:async id=>{await rejectLegacyKey(id);const r=(await q.query('SELECT payload_hash,response FROM city_registry.save_receipts WHERE owner_id=$1 AND city_id=$2 AND request_id=$3',[owner,cityId,id])).rows[0];return r&&{payloadHash:r.payload_hash,response:r.response};},
    record:async(id,h,response)=>{await rejectLegacyKey(id);const {raw,...receipt}=response;return q.query('INSERT INTO city_registry.save_receipts(owner_id,city_id,request_id,payload_hash,response) VALUES($1,$2,$3,$4,$5)',[owner,cityId,id,h,JSON.stringify(receipt)]);},
    // Includes legacy bytes conservatively; missing legacy tables fail closed.
    bytes:async()=>Number((await q.query('SELECT COALESCE((SELECT sum(octet_length(raw)) FROM city_registry.save_history WHERE owner_id=$1),0)+COALESCE((SELECT sum(octet_length(raw)) FROM city_server_snapshots WHERE account_id=$1),0)+COALESCE((SELECT sum(octet_length(raw)) FROM city_server_archives WHERE account_id=$1),0) AS bytes',[owner])).rows[0].bytes),
    publish:async v=>{if(v.cityId!==cityId)throw Error('city-mismatch');await publish(v);}
   })
  };
 };
}
