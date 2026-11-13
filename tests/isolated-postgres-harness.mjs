// Explicit, disposable local CI database only. Never reads DATABASE_URL.
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {isAbsolute,basename} from 'node:path';
import {postgresIntegration} from '../server/city-registry/postgres-integration.mjs';
import {privateSaveHost} from '../server/city-registry/postgres-private-host.mjs';
import {createRegistryIntegration,createPerCitySaveService} from '../server/city-registry/integration.mjs';
import {createLegacyMigration} from '../server/city-registry/legacy-migration.mjs';
import {legacyBundleHost} from '../server/city-registry/legacy-bundle-host.mjs';
import {intentHost} from '../server/save-slots/postgres-intent-host.mjs';
import {createIntentCipher} from '../server/save-slots/intent-cipher.mjs';
import {createDurableIntentService} from '../server/save-slots/durable-intents.mjs';
const port=Number(process.argv[2]);
if(!Number.isInteger(port)||port<20000||port>65535||port===55432)throw Error('explicit isolated port 20000..65535 required; 55432 forbidden');
const packagePath=process.argv[3];
if(packagePath && (!isAbsolute(packagePath)||basename(packagePath)!=='package.json'))throw Error('explicit pg package.json must be an absolute path');
let pg;try{pg=packagePath?createRequire(packagePath)('./'):await import('pg');}catch{console.error('SKIP: pg package could not be resolved; no PostgreSQL tests ran');process.exit(77);}
pg=pg.default??pg;
if(typeof pg.Pool!=='function')throw Error('invalid-pg-package');
if(process.argv[4]==='--resolve-only'){console.log('PASS: explicit pg package resolved; no database connection attempted');process.exit(0);}
const marker=process.argv[4];if(typeof marker!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(marker))throw Error('per-run disposable marker required');
const pool=new pg.Pool({host:'127.0.0.1',port,user:'city_registry_ci',password:'',database:'city_registry_disposable_test',max:8,connectionTimeoutMillis:3000,ssl:false});
const id=n=>`00000000-0000-4000-8000-${n.toString(16).padStart(12,'0')}`;
const owner=id(1),legacyId=id(2),raw='{"version":23} ',metadata={name:'A',population:1,tick:1},hash=s=>createHash('sha256').update(s).digest('hex');
try{
 const verify=await pool.query("SELECT current_database() AS db,current_user AS usr,inet_server_addr()::text AS address");
 const v=verify.rows[0];if(v.db!=='city_registry_disposable_test'||v.usr!=='city_registry_ci')throw Error('unsafe-database-identity');
 const mark=await pool.query('SELECT token::text AS token FROM public.ci_instance_marker');if(mark.rows.length!==1||mark.rows[0].token!==marker)throw Error('unsafe-instance-marker');
 const existing=await pool.query("SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp_%' AND c.relkind IN ('r','p','v','m','S')");
 if(existing.rows[0].n!==1)throw Error('database-not-empty');
 // Tentative test fixture only: the installed legacy DDL was not found.
 await pool.query(`CREATE TABLE accounts(id uuid PRIMARY KEY); CREATE TABLE city_server_heads(account_id uuid PRIMARY KEY,city_id uuid,revision bigint,deleted boolean,archive_hash text); CREATE TABLE city_server_snapshots(account_id uuid,city_id uuid,revision bigint,raw text,raw_hash text,metadata jsonb); CREATE TABLE city_server_archives(account_id uuid,raw_hash text,raw text); CREATE TABLE city_server_requests(account_id uuid,request_id uuid,payload_hash text,response jsonb);`);
 for(const name of ['001_registry.sql','002_legacy_marker.sql','003_private_saves.sql','004_legacy_receipt_archive.sql']) await pool.query(await readFile(new URL(`../server/city-registry/migrations/${name}`,import.meta.url),'utf8'));
 await pool.query(await readFile(new URL('../server/save-slots/migrations/005_durable_intents.sql',import.meta.url),'utf8'));
 await pool.query('INSERT INTO accounts(id) VALUES($1),($2),($3)',[owner,id(3),id(4)]);
 await pool.query('INSERT INTO city_server_snapshots(account_id,city_id,revision,raw,raw_hash,metadata) VALUES($1,$2,$3,$4,$5,$6)',[owner,legacyId,7,raw,hash(raw),metadata]);
 await pool.query('INSERT INTO city_server_snapshots(account_id,city_id,revision,raw,raw_hash,metadata) VALUES($1,$2,$3,$4,$5,$6::jsonb)',[owner,legacyId,6,raw,hash(raw),'{"nested":{"big":9007199254740993,"decimal":1.000000000000000001}}']);
 await pool.query('INSERT INTO city_server_requests(account_id,request_id,payload_hash,response) VALUES($1,$2,$3,$4::jsonb)',[owner,id(40),'legacy-hash','{"nested":[9007199254740993,1.000000000000000001]}']);
 // Synthetic-only cutover assumption and fixed test cipher key; neither is production evidence.
 const privateHost=privateSaveHost({cutoverReady:async()=>true});
 const baseHost=(q,o)=>({...privateHost(q,o),...legacyBundleHost(q,o)});
 const codec=createIntentCipher({currentKeyId:'synthetic-test',getKey:()=>Buffer.alloc(32,7)});
 const adapter=postgresIntegration(pool,intentHost(baseHost,codec)),registry=createRegistryIntegration(adapter),saves=createPerCitySaveService(adapter);
 await pool.query('INSERT INTO city_server_snapshots(account_id,city_id,revision,raw,raw_hash,metadata) VALUES($1,$2,$3,$4,$5,$6::jsonb)',[id(4),id(5),1,raw,hash(raw),'{"name":"A","population":1.000000000000000001,"tick":1}']);
 await assert.rejects(createLegacyMigration(adapter).copyToSlot1(id(4)),/legacy-head-mismatch/);assert.equal((await pool.query('SELECT count(*)::int AS n FROM city_registry.legacy_markers WHERE owner_id=$1',[id(4)])).rows[0].n,0);
 await createLegacyMigration(adapter).copyToSlot1(owner);const original=await saves.read(owner,legacyId);assert.equal(original.raw,raw);assert.equal(original.revision,7);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM city_server_snapshots WHERE account_id=$1',[owner])).rows[0].n,2);assert.equal((await pool.query('SELECT count(*)::int AS n FROM city_server_requests WHERE account_id=$1',[owner])).rows[0].n,1);
 const equality=await pool.query('SELECT (SELECT metadata FROM city_server_snapshots WHERE account_id=$1 AND revision=6)=(SELECT metadata FROM city_registry.save_history WHERE owner_id=$1 AND city_id=$2 AND revision=6) AS meta_ok,(SELECT response FROM city_server_requests WHERE account_id=$1 AND request_id=$3)=(SELECT response FROM city_registry.legacy_receipt_archive WHERE owner_id=$1 AND request_id=$3) AS receipt_ok',[owner,legacyId,id(40)]);assert.equal(equality.rows[0].meta_ok,true);assert.equal(equality.rows[0].receipt_ok,true);
 await assert.rejects(saves.mutate(owner,id(40),{action:'save',cityId:legacyId,expectedRevision:7,raw,metadata}),/legacy-receipt-reconciliation-required/);
 await assert.rejects(registry.create(owner,id(40),{cityId:id(23),slot:2,raw,metadata}),/legacy-receipt-reconciliation-required/);
 const attempts=await Promise.allSettled([registry.create(owner,id(10),{cityId:id(20),slot:2,raw,metadata}),registry.create(owner,id(11),{cityId:id(21),slot:3,raw,metadata}),registry.create(owner,id(12),{cityId:id(22),slot:3,raw,metadata})]);
 assert.equal(attempts.filter(x=>x.status==='fulfilled').length,2);
 const body={action:'save',cityId:legacyId,expectedRevision:7,raw:raw+' ',metadata};const ack=await saves.mutate(owner,id(30),body);assert.equal(ack.revision,8);assert.equal((await saves.mutate(owner,id(30),body)).revision,8);
 await assert.rejects(saves.mutate(owner,id(31),body),/save-conflict/);
 await assert.rejects(adapter.transaction(id(3),async tx=>{await tx.insertInstance({owner:id(3),cityId:id(99),slot:1});throw Error('forced-rollback');}),/forced-rollback/);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM city_registry.instances WHERE city_id=$1',[id(99)])).rows[0].n,0);
 // Exercise the same durable lifecycle as the sealed Team 6 candidate against real PG.
 const durable=createDurableIntentService(adapter),principal={ownerId:id(3),sessionBinding:'synthetic-session-binding-0123456789abcdef'},newCity=id(60);
 await registry.create(id(3),id(61),{cityId:newCity,slot:1,raw,metadata});
 const exact={requestId:id(62),cityId:newCity,expectedRevision:1,body:JSON.stringify({action:'save',cityId:newCity,expectedRevision:1,raw:raw+' ',metadata})};
 await durable.prepare(principal,exact);const first=await durable.attempt(principal,exact);
 assert.deepEqual(await durable.attempt(principal,exact),first);await durable.complete(principal,exact.requestId);
 assert.deepEqual(await durable.attempt(principal,exact),first);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM city_registry.save_receipts WHERE owner_id=$1 AND city_id=$2 AND request_id=$3',[id(3),newCity,exact.requestId])).rows[0].n,1);
 const stored=await saves.read(id(3),newCity);assert.equal(stored.raw,raw+' ');assert.equal(stored.revision,2);
 await assert.rejects(saves.read(owner,newCity));
 console.log('PASS: synthetic durable prepare, exact replay, completion and cross-owner check');
 const racing=[id(70),id(71)].map(requestId=>saves.mutate(id(3),requestId,{action:'save',cityId:newCity,expectedRevision:2,raw:raw+'  ',metadata}));
 const raced=await Promise.allSettled(racing);
 assert.equal(raced.filter(x=>x.status==='fulfilled').length,1);
 assert.equal(raced.filter(x=>x.status==='rejected'&&x.reason?.message==='save-conflict').length,1);
 assert.equal((await saves.read(id(3),newCity)).revision,3);
 const ownCities=attempts.filter(x=>x.status==='fulfilled').map(x=>x.value.cityId);
 const sameOwner=await Promise.all(ownCities.map((cityId,i)=>saves.mutate(owner,id(72+i),{action:'save',cityId,expectedRevision:1,raw:raw+' ',metadata})));
 assert.ok(sameOwner.every(x=>x.revision===2));
 const independent=await Promise.all([
  saves.mutate(owner,id(74),{action:'save',cityId:legacyId,expectedRevision:8,raw:raw+'  ',metadata}),
  saves.mutate(id(3),id(75),{action:'save',cityId:newCity,expectedRevision:3,raw:raw+'   ',metadata})
 ]);
 assert.equal(independent[0].revision,9);assert.equal(independent[1].revision,4);
 assert.equal((await saves.read(owner,legacyId)).raw,raw+'  ');
 assert.equal((await saves.read(id(3),newCity)).raw,raw+'   ');
 console.log('PASS: synthetic concurrent CAS, same-account city saves and distinct-account saves');
 console.log('PASS: isolated PostgreSQL candidate checks; disposable database retained for explicit teardown');
} finally {await pool.end();}
