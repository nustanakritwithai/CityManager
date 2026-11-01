// Source-derived READ ONLY adapter for installed pg-store.mjs contract.
// Call only within host transaction. Does not establish cutover or writer fence.
const currentSQL=`SELECT h.account_id,h.city_id,h.revision,h.deleted,h.archive_hash,s.raw,s.raw_hash,s.metadata FROM city_server_heads h LEFT JOIN city_server_snapshots s ON s.account_id=h.account_id AND s.revision=h.revision WHERE h.account_id=$1
 UNION ALL SELECT s.account_id,s.city_id,s.revision,false AS deleted,NULL AS archive_hash,s.raw,s.raw_hash,s.metadata FROM city_server_snapshots s WHERE s.account_id=$1 AND NOT EXISTS(SELECT 1 FROM city_server_heads h WHERE h.account_id=$1) ORDER BY revision DESC LIMIT 1`;
export function legacySource(client,owner) {
 return {async lockLegacySave(){
  const lock=await client.query('SELECT id FROM accounts WHERE id=$1 FOR UPDATE',[owner]);
  if(lock.rowCount!==1) throw Error('legacy-owner-unverified');
  const rows=(await client.query(currentSQL,[owner])).rows;
  if(rows.length===0)return null;
  if(rows.length!==1)throw Error('legacy-ambiguous');
  const r=rows[0], revision=Number(r.revision);
  if(r.account_id!==owner || r.deleted!==false || typeof r.raw!=='string' || !Number.isSafeInteger(revision) || revision<1) throw Error('legacy-state-unverified');
  return {owner:r.account_id,cityId:r.city_id,revision,raw:r.raw,rawHash:r.raw_hash,metadata:r.metadata};
 }};
}
