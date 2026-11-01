// Prototype transaction adapter. Host supplies all save/legacy/obligation methods
// bound to the SAME client and transaction. No deployed schema is assumed.
import {legacySource} from './legacy-source.mjs';
const map = r => r && ({owner:r.owner_id,cityId:r.city_id,slot:r.slot,retired:r.retired_at!==null});
export function postgresIntegration(pool, host) {
 if (!pool || typeof pool.connect!=='function' || typeof host!=='function') throw Error('missing-dependency');
 return { async transaction(owner,fn) {
  const q=await pool.connect();
  try {
   await q.query('BEGIN');
   // Legacy pg-store takes this lock first; all new writers must do likewise.
   const account=await q.query('SELECT id FROM accounts WHERE id=$1 FOR UPDATE',[owner]);
   if(account.rowCount!==1) throw Error('legacy-owner-unverified');
   await q.query('INSERT INTO city_registry.owner_locks(owner_id) VALUES($1) ON CONFLICT DO NOTHING',[owner]);
   await q.query('SELECT owner_id FROM city_registry.owner_locks WHERE owner_id=$1 FOR UPDATE',[owner]);
   const delegated=await host(q,owner);
   if (!delegated || typeof delegated!=='object') throw Error('missing-host-adapter');
   const cutover=async()=>{if(typeof delegated.cutoverReady!=='function'||await delegated.cutoverReady()!==true)throw Error('legacy-cutover-unverified');};
   const tx={...delegated,...legacySource(q,owner),
    // Installed resetAllowed permits some unacknowledged receipts. It is not
    // sufficient evidence for retirement; authoritative coordination is absent.
    obligationsClear:async()=>false,
    lockLegacyMarker:async()=>{await cutover();const r=(await q.query('SELECT city_id FROM city_registry.legacy_markers WHERE owner_id=$1 FOR UPDATE',[owner])).rows[0];return r?{cityId:r.city_id}:null;},
    recordLegacyMarker:async cityId=>{await cutover();await q.query('INSERT INTO city_registry.legacy_markers(owner_id,city_id) VALUES($1,$2)',[owner,cityId]);},
    listInstances:async()=> (await q.query('SELECT * FROM city_registry.instances WHERE owner_id=$1 ORDER BY slot, created_at',[owner])).rows.map(map),
    lockInstance:async cityId=>map((await q.query('SELECT * FROM city_registry.instances WHERE owner_id=$1 AND city_id=$2 FOR UPDATE',[owner,cityId])).rows[0]),
    insertInstance:async c=>{if(c.owner!==owner) throw Error('owner-mismatch');return map((await q.query('INSERT INTO city_registry.instances(owner_id,city_id,slot) VALUES($1,$2,$3) RETURNING *',[owner,c.cityId,c.slot])).rows[0]);}
   };
   const result=await fn(tx);await q.query('COMMIT');return result;
  } catch(e) {try {await q.query('ROLLBACK');} catch {} throw e;} finally {q.release();}
 }};
}

// Only cooperative legacy writers using this boundary are fenced. `write` must
// perform its entire legacy mutation through the supplied transaction client.
export async function runLegacyWriter(adapter, owner, write) {
 if (!adapter || typeof adapter.transaction!=='function' || typeof write!=='function') throw Error('missing-dependency');
 return adapter.transaction(owner,async tx=>{
  const marker=await tx.lockLegacyMarker();
  if (marker !== null) throw Object.assign(Error('legacy-writer-fenced'),{status:409});
  return write(tx);
 });
}
