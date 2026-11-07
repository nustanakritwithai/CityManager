import {legacySource} from './legacy-source.mjs';
// Uses only columns observed in installed source; no original row is modified.
export function legacyBundleHost(q,owner){
 const snapshot=r=>({owner:r.account_id,cityId:r.city_id,revision:Number(r.revision),raw:r.raw,rawHash:r.raw_hash,metadataJson:r.metadata_json});
 const receipt=r=>({owner:r.account_id,requestId:r.request_id,payloadHash:r.payload_hash,responseJson:r.response_json});
 return {
  async verifyActiveMetadata(head){const r=await q.query('SELECT metadata = $4::jsonb AS matches FROM city_server_snapshots WHERE account_id=$1 AND city_id=$2 AND revision=$3',[owner,head.cityId,head.revision,JSON.stringify(head.metadata)]);return r.rows.length===1&&r.rows[0].matches===true;},
  async lockLegacyBundle(){
   const head=await legacySource(q,owner).lockLegacySave();if(!head)return null;
   const snapshots=(await q.query('SELECT account_id,city_id,revision,raw,raw_hash,metadata::text AS metadata_json FROM city_server_snapshots WHERE account_id=$1 ORDER BY revision FOR UPDATE',[owner])).rows.map(snapshot);
   const receipts=(await q.query('SELECT account_id,request_id,payload_hash,response::text AS response_json FROM city_server_requests WHERE account_id=$1 ORDER BY request_id FOR UPDATE',[owner])).rows.map(receipt);
   return {owner,head,snapshots,receipts};
  },
  async copyLegacyBundle(bundle){
   for(const s of bundle.snapshots)await q.query('INSERT INTO city_registry.save_history(owner_id,city_id,revision,raw,raw_hash,metadata) VALUES($1,$2,$3,$4,$5,$6::jsonb)',[owner,s.cityId,s.revision,s.raw,s.rawHash,s.metadataJson]);
   const h=bundle.head;await q.query('INSERT INTO city_registry.save_heads(owner_id,city_id,revision,raw,raw_hash,metadata) VALUES($1,$2,$3,$4,$5,$6)',[owner,h.cityId,h.revision,h.raw,h.rawHash,JSON.stringify(h.metadata)]);
   for(const r of bundle.receipts)await q.query('INSERT INTO city_registry.legacy_receipt_archive(owner_id,request_id,payload_hash,response) VALUES($1,$2,$3,$4::jsonb)',[owner,r.requestId,r.payloadHash,r.responseJson]);
  },
  async readCopiedBundle(cityId){
   const h=(await q.query('SELECT owner_id,city_id,revision,raw,raw_hash,metadata FROM city_registry.save_heads WHERE owner_id=$1 AND city_id=$2',[owner,cityId])).rows[0];if(!h)return null;
   const head={owner:h.owner_id,cityId:h.city_id,revision:Number(h.revision),raw:h.raw,rawHash:h.raw_hash,metadata:h.metadata};
   const snapshots=(await q.query('SELECT owner_id AS account_id,city_id,revision,raw,raw_hash,metadata::text AS metadata_json FROM city_registry.save_history WHERE owner_id=$1 ORDER BY revision',[owner])).rows.map(snapshot);
   const receipts=(await q.query('SELECT owner_id AS account_id,request_id,payload_hash,response::text AS response_json FROM city_registry.legacy_receipt_archive WHERE owner_id=$1 ORDER BY request_id',[owner])).rows.map(receipt);
   return {owner,head,snapshots,receipts};
  }
 };
}
