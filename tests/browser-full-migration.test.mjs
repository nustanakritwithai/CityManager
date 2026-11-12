import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createCity, step, bulldoze, buildPark, GATEWAY, deserialize, serialize, expandValidatedCity, adoptSavedEducation } from '../src/sim.ts';
import { createParkRuntime, advanceParkRuntime, serializeParkSession, deserializeParkSession } from '../src/park-runtime.ts';
import { createPanelServerFixture } from './panel-server-entry-fixture.mjs';
import { loadedTrafficSession } from './traffic-server-entry-fixture.mjs';

const url='http://127.0.0.1:4173/CityManager/';
const request=(method,command,key=randomUUID())=>({requestId:randomUUID(),request:{url:'http://127.0.0.1:4173/citymanager-api/v1/city-save',method,headers:{'Idempotency-Key':key},...(command?{postData:JSON.stringify(command)}:{})}});
const body=p=>JSON.parse(Buffer.from(p.body,'base64').toString());
function fractionalSession() {
 const city=createCity(61025);for(let i=0;i<45;i++)step(city);
 for(let i=0;i<city.cells.length;i++)if(city.cells[i].road&&i!==GATEWAY)bulldoze(city,i);
 assert.equal(buildPark(city,16*24+12).ok,true);
 const expanded=expandValidatedCity(deserialize(serialize(city)));step(expanded);
 const runtime=createParkRuntime(expanded);
 for(let minute=0;minute<1200;minute++){
  advanceParkRuntime(expanded,runtime,1,()=>step(expanded));
  if(runtime.activity.visitors.some(v=>v.phase==='sit'||v.phase==='meet')&&Object.keys(runtime.recreation.citizens).length)break;
 }
 assert.ok(runtime.activity.visitors.length>0);assert.ok(Object.keys(runtime.recreation.citizens).length>0);
 return serializeParkSession(expanded,runtime);
}

test('fractional park session: exact ACK, retry, conflict, failed save and authenticated service read',async()=>{
 const raw=fractionalSession(),server=createPanelServerFixture(url),ack=await server.seed(raw),responses=[];
 const send=async(_method,payload)=>responses.push(payload);
 assert.equal(ack.revision,1);assert.equal(ack.raw,raw);
 const session=loadedTrafficSession(raw);assert.equal(serializeParkSession(session.city,session.runtime),raw);
 const command={action:'save',cityId:ack.cityId,expectedRevision:1,raw,metadata:ack.metadata};
 const key=randomUUID(),save=request('POST',command,key);
 await server.intercept(save,send);assert.equal(responses.at(-1).responseCode,200);const saved=body(responses.at(-1));assert.equal(saved.revision,2);assert.equal(saved.raw,raw);
 await server.intercept(save,send);assert.deepEqual(body(responses.at(-1)),saved);assert.deepEqual(server.active,saved,'Idempotent retry preserves exact revision');
 await server.intercept(request('POST',command),send);assert.equal(responses.at(-1).responseCode,409);assert.equal(body(responses.at(-1)).error,'save-conflict');assert.deepEqual(server.active,saved,'Stale revision does not overwrite');
 const invalid={...command,expectedRevision:2,raw:'not-json'};
 await server.intercept(request('POST',invalid),send);assert.equal(responses.at(-1).responseCode,400);assert.equal(body(responses.at(-1)).error,'invalid-save');assert.deepEqual(server.active,saved,'Rejected write cannot replace the head');
 await server.intercept(request('GET'),send);assert.equal(responses.at(-1).responseCode,200);assert.deepEqual(body(responses.at(-1)),saved,'Service read restores exact ACK and revision');
 const corrupt=JSON.parse(raw);corrupt.parkRuntime.recreation.minute++;
 assert.throws(()=>deserializeParkSession(JSON.stringify(corrupt)),/sidecar clock mismatch/);assert.deepEqual(server.active,saved,'Decoder rejection cannot change the durable head');
});

test('historical v1 scenario retains original bytes and complete city across validated migration',()=>{
 const raw=readFileSync(new URL('./fixtures/legacy-v1-day65.json',import.meta.url),'utf8');
 assert.equal(createHash('sha256').update(raw).digest('hex'),'4e358e66acdfb55dcfd434aaf67be51ccea99c69fc5a2b9b44343035c16166d0');
 const old=JSON.parse(raw),legacy=deserialize(raw);for(const key of ['accounts','ledger','goodsLedger','goods'])assert.deepEqual(legacy[key],old[key]);for(const key of ['seed','rng','tick','nextId'])assert.equal(legacy[key],old[key]);
 const migrated=loadedTrafficSession(serialize(legacy)).city,expected=expandValidatedCity(legacy);adoptSavedEducation(expected);if(!migrated.education)adoptSavedEducation(migrated);
 assert.deepEqual(migrated,expected);assert.equal(migrated.cells.length,672);assert.equal(createHash('sha256').update(raw).digest('hex'),'4e358e66acdfb55dcfd434aaf67be51ccea99c69fc5a2b9b44343035c16166d0');
});

test('browser scenario retains native UI and exact server checks rather than removed local save controls',()=>{
 const source=readFileSync(new URL('./browser-smoke.mjs',import.meta.url),'utf8');
 for(const item of ['createFeedbackServerFixture','trafficHttpHandler','server.seed(raw)','server.enter({evaluate, button})','server.assertNoCityWrites(evaluate)','server.assertDurable','reloadAcknowledged','sidecar clock mismatch','save-management-cancel','feedback.setFault(true)','feedback.assertRetry','desktop-disconnected.png','desktop-park.png','mobile-inspector.png','mobile-ledger.png','mobile-firm.png','mobile-park-recreation.png','dispatchTouchEvent','interceptions.settle()'])assert.ok(source.includes(item),item);
 assert.doesNotMatch(source,/localStorage\.setItem|Storage\.prototype\.setItem|button\(['"]#load['"]\)/);
});
test('browser harness records every advisor and provider attempt',()=>{
 const source=readFileSync(new URL('./browser-smoke.mjs',import.meta.url),'utf8');
 assert.match(source,/isPanelProviderRequest\(u\)/);assert.match(source,/assert\.deepEqual\(providerRequests,\s*\[\]/);
});
