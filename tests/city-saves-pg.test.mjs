import test from 'node:test';import assert from 'node:assert/strict';
import {createRequire} from 'node:module';import {readFile} from 'node:fs/promises';import {resolve} from 'node:path';import {fileURLToPath} from 'node:url';import {randomBytes} from 'node:crypto';
import {createSaveService} from '../server/city-saves/service.mjs';import {createPgSaveStore} from '../server/city-saves/pg-store.mjs';
const enabled=process.env.CITY_SAVE_TEST_PG==='1';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('isolated PostgreSQL enforces save protocol and append-only snapshots',{skip:!enabled},async()=>{
 const require=createRequire(process.env.CITY_SAVE_TEST_PG_PACKAGE);const {Pool}=require('pg');
 const config={host:'127.0.0.1',port:56439,user:'city_save_test',database:'postgres',ssl:false};
 const bootstrap=new Pool(config);let pool;
 try {
  const dir=(await bootstrap.query('SHOW data_directory')).rows[0].data_directory;
  assert.equal(resolve(dir).toLowerCase(),resolve(fileURLToPath(new URL('../validation/city-save-pg',import.meta.url))).toLowerCase(),'refuse non-test cluster');
  const database=`city_save_ci_${randomBytes(8).toString('hex')}`;
  const db=await bootstrap.query('SELECT 1 FROM pg_database WHERE datname=$1',[database]);assert.equal(db.rowCount,0,'refuse existing test database');
  await bootstrap.query(`CREATE DATABASE "${database}"`);
  pool=new Pool({...config,database,options:'-c search_path=city_save_ci'});
  await pool.query('CREATE SCHEMA city_save_ci');await pool.query('CREATE TABLE accounts(id uuid PRIMARY KEY)');
  await pool.query(await readFile(new URL('../server/city-saves/migration.sql',import.meta.url),'utf8'));
  await pool.query('INSERT INTO accounts(id) VALUES($1),($2)',[id(1),id(2)]);
  const tx=async work=>{const c=await pool.connect();try{await c.query('BEGIN');const out=await work(c);await c.query('COMMIT');return out;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}};
  const svc=createSaveService(createPgSaveStore({pool,tx})), meta={name:'City',population:0,tick:1},raw='{ "version":999 }', city=id(11);
  const create={action:'create',cityId:city,slot:1,raw,metadata:meta};
  assert.deepEqual(await svc.mutate(id(1),id(20),create),await svc.mutate(id(1),id(20),create));
  assert.equal((await svc.read(id(1),city)).raw,raw);await assert.rejects(svc.read(id(2),city),/save-not-found/);
  const save={action:'save',cityId:city,expectedRevision:1,raw:'{"version":999,"next":true}',metadata:meta};
  const results=await Promise.allSettled([svc.mutate(id(1),id(21),save),svc.mutate(id(1),id(22),save)]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.match(String(results.find(x=>x.status==='rejected').reason),/save-conflict/);
  await assert.rejects(pool.query('UPDATE city_save_snapshots SET raw=$1 WHERE instance_id=$2',['{}',city]),/append-only/);
  await assert.rejects(pool.query('DELETE FROM city_save_snapshots WHERE instance_id=$1',[city]),/append-only/);
  await svc.mutate(id(1),id(23),{action:'delete',cityId:city,expectedRevision:2});
  await svc.mutate(id(1),id(24),{...create,cityId:id(12)});
  await assert.rejects(svc.mutate(id(1),id(25),save),/save-conflict/);
  assert.equal((await svc.read(id(1),id(12))).raw,raw);
  assert.equal((await pool.query('SELECT count(*)::integer AS n FROM city_save_snapshots WHERE instance_id=$1',[city])).rows[0].n,3);
 }finally{if(pool)await pool.end();await bootstrap.end();}
});
