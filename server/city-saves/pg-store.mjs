function instance(row) {
  if (!row) return null;
  const revision = Number(row.revision);
  if (!Number.isSafeInteger(revision) || revision < 1) throw Error('invalid stored save revision');
  return { cityId: row.id, slot: Number(row.slot), revision, deleted: row.deleted };
}

// tx must wrap callback and COMMIT before resolving; pool is the existing backend pool.
export function createPgSaveStore({ tx, pool }) {
  return {
    transaction(owner, work) {
      return tx(async client => {
        const ownerRow = await client.query('SELECT id FROM accounts WHERE id=$1 FOR UPDATE', [owner]);
        if (!ownerRow.rowCount) throw Object.assign(Error('guest-required'), { status: 401 });
        const db = {
          async request(id) { const r = await client.query('SELECT payload_hash,response FROM city_save_requests WHERE account_id=$1 AND request_id=$2', [owner,id]); const row = r.rows[0]; return row && { payloadHash: row.payload_hash, response: row.response }; },
          async record(id, hash, response) { await client.query('INSERT INTO city_save_requests(account_id,request_id,payload_hash,response) VALUES($1,$2,$3,$4)', [owner,id,hash,JSON.stringify(response)]); },
          async activeSlot(slot) { const r = await client.query('SELECT id FROM city_save_instances WHERE account_id=$1 AND slot=$2 AND NOT deleted', [owner,slot]); return !!r.rowCount; },
          async instance(id) { const r = await client.query('SELECT id,slot,revision,deleted FROM city_save_instances WHERE account_id=$1 AND id=$2', [owner,id]); return instance(r.rows[0]); },
          async create(v) { const r = await client.query('INSERT INTO city_save_instances(id,account_id,slot,revision,deleted) VALUES($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING RETURNING id', [v.cityId,owner,v.slot,v.revision,v.deleted]); if (!r.rowCount) throw Object.assign(Error('city-id-unavailable'), { status:409 }); },
          async update(v) { const r = await client.query('UPDATE city_save_instances SET slot=$3,revision=$4,deleted=$5,updated_at=now() WHERE account_id=$1 AND id=$2', [owner,v.cityId,v.slot,v.revision,v.deleted]); if (r.rowCount !== 1) throw Error('city save invariant'); },
          async snapshot(id, revision, raw, metadata) { await client.query('INSERT INTO city_save_snapshots(instance_id,revision,raw,metadata) VALUES($1,$2,$3,$4)', [id,revision,raw,JSON.stringify(metadata)]); },
          async latestSnapshot(id) { const r = await client.query('SELECT raw,metadata FROM city_save_snapshots WHERE instance_id=$1 ORDER BY revision DESC LIMIT 1', [id]); return r.rows[0] ?? null; }
        };
        return work(db);
      });
    },
    async list(owner) {
      const r = await pool.query('SELECT i.id,i.slot,i.revision,i.deleted,i.updated_at,s.metadata FROM city_save_instances i JOIN city_save_snapshots s ON s.instance_id=i.id AND s.revision=i.revision WHERE i.account_id=$1 ORDER BY i.slot,i.deleted,i.updated_at DESC', [owner]);
      return r.rows.map(row => ({ ...instance(row), metadata: row.metadata, updatedAt: row.updated_at }));
    },
    async read(owner, cityId) {
      const r = await pool.query('SELECT i.id,i.slot,i.revision,i.deleted,i.updated_at,s.raw,s.metadata FROM city_save_instances i JOIN city_save_snapshots s ON s.instance_id=i.id AND s.revision=i.revision WHERE i.account_id=$1 AND i.id=$2', [owner,cityId]);
      const row = r.rows[0]; if (!row) throw Object.assign(Error('save-not-found'), {status:404});
      return { ...instance(row), raw: row.raw, metadata: row.metadata, updatedAt: row.updated_at };
    }
  };
}
