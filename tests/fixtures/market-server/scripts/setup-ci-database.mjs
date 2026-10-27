// Dedicated disposable CI database only; never point this at a deployed DB.
import fs from 'node:fs/promises';

const connectionString=process.env.DATABASE_URL;
const schema=process.env.DATABASE_SCHEMA;
let uri;
try { uri=new URL(connectionString); } catch { throw new Error('CI DATABASE_URL required'); }
if (!['postgres:','postgresql:'].includes(uri.protocol) || !['127.0.0.1','localhost'].includes(uri.hostname) || uri.pathname!=='/citymanager_ci' || uri.search || uri.hash || !/^ci_market_[a-f0-9]{16}$/.test(schema || ''))
  throw new Error('A loopback citymanager_ci database and fresh ci_market_<16 hex> schema are required');

const {pool,migrate}=await import('../src/db.js');
try {
  const existing=await pool.query('SELECT 1 FROM pg_namespace WHERE nspname=$1',[schema]);
  if (existing.rowCount) throw new Error('CI schema already exists; refusing overwrite');
  await migrate();
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    for (const name of ['pages-auth-candidate.sql','trade-rejections-candidate.sql'])
      await client.query(await fs.readFile(new URL(`../db/${name}`,import.meta.url),'utf8'));
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
  console.log('Disposable CI schema initialized; guarded protocol v1 installed');
} finally { await pool.end(); }

