import test from 'node:test';
import assert from 'node:assert/strict';
import { createCity, step, serialize, deserialize, summary, MAX_CITY_HOUSEHOLDS, type City } from '../src/sim.ts';
import { populationFixture as fixture } from './population-capacity-fixture.ts';
import { saveStoredCity, SAVE_KEY, POPULATION_BACKUP_KEY, populationBackupKeys, readStoredCity } from '../src/save-storage.ts';
import { createParkRuntime, serializeParkSession, deserializeParkSession } from '../src/park-runtime.ts';

test('the 129th household requires actual funded jobs and housing; funding is recorded once',()=>{
  const c=fixture(128);const old=serialize(c);assert.equal(JSON.parse(old).version,22);assert.deepEqual(deserialize(old),c);
  const before=c.accounts.outside;step(c);
  assert.equal(c.households.length,129);assert.equal(c.populationCapacityVersion,1);
  const arrivals=c.ledger.filter(e=>e.tick===c.tick&&e.reason==='New household arrival savings');assert.equal(arrivals.length,1);assert.equal(arrivals[0].amount,150000);
  assert.equal(c.accounts.outside,before-150000);assert.equal(Object.values(c.accounts).reduce((a,b)=>a+b,0),0);
  assert.equal(JSON.parse(serialize(c)).version,22);assert.equal(c.populationCapacityVersion,1);assert.deepEqual(deserialize(serialize(c)),c);
  for(const change of [(v:City)=>{v.utilities.outside={power:20,water:20};},(v:City)=>{v.firms=[];},(v:City)=>{const empty=v.buildings.find(b=>b.zone==='R'&&!v.households.some(h=>h.home===b.id))!;v.buildings=v.buildings.filter(b=>b.id!==empty.id);v.cells[empty.cell].building=null;}]){
    const blocked=fixture(128);change(blocked);step(blocked);assert.equal(blocked.households.length,128);
  }
});

test('1000+ actual people and more than 256 job allocations survive complete reconciliation and save/load',t=>{
  const c=fixture(334,true);const start=performance.now();step(c);
  assert.ok(summary(c).population>=1002);assert.ok(c.employment.length>256);
  assert.equal(Object.values(c.accounts).reduce((a,b)=>a+b,0),0);
  const raw=serialize(c);assert.deepEqual(deserialize(raw),c);
  const park=createParkRuntime(c),session=serializeParkSession(c,park);assert.deepEqual(deserializeParkSession(session).city,c);
  const bad=JSON.parse(raw);bad.version=19;bad.rulesVersion='chain-14';delete bad.populationCapacityVersion;assert.throws(()=>deserialize(JSON.stringify(bad)));
  const corrupt=JSON.parse(raw);corrupt.accounts.treasury++;assert.throws(()=>deserialize(JSON.stringify(corrupt)));
  t.diagnostic(`Synthetic 1000-person snapshot + tick + reconciliation: ${(performance.now()-start).toFixed(1)}ms; ${raw.length} chars. Not a mobile FPS or natural-growth measurement.`);
});

test('population envelope preserves road topology and requires matching version marker',()=>{
  const c=fixture(129);c.roadTopology={version:1,blocked:[],oneWay:{}};const raw=serialize(c);
  assert.deepEqual(deserialize(raw),c);
  for(const edit of [(v:any)=>v.populationCapacityVersion=2,(v:any)=>v.rulesVersion='chain-15',(v:any)=>v.roadTopology.version=2]){const bad=JSON.parse(raw);edit(bad);assert.throws(()=>deserialize(JSON.stringify(bad)));}
  const tooMany=fixture(129,false,false);tooMany.households=Array(MAX_CITY_HOUSEHOLDS+1).fill(tooMany.households[0]);assert.throws(()=>deserialize(serialize(tooMany)));
});

test('old bytes backed up before large-population save; full/quota backups preserve old primary',()=>{
  const smaller=fixture(128),larger=fixture(129);delete smaller.education;delete larger.education;const old=serialize(smaller),next=serialize(larger);
  const data=new Map<string,string>([[SAVE_KEY,old]]),storage={getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v);}};
  saveStoredCity(storage,next,null);assert.equal(data.get(POPULATION_BACKUP_KEY),old);assert.equal(data.get(SAVE_KEY),next);assert.equal(readStoredCity(storage,'backup')?.raw,old);
  saveStoredCity(storage,next,null);assert.equal(data.get(POPULATION_BACKUP_KEY),old);
  const full=new Map<string,string>([[SAVE_KEY,old],...populationBackupKeys().map((k,i)=>[k,`prior${i}`] as [string,string])]);
  assert.throws(()=>saveStoredCity({getItem:k=>full.get(k)??null,setItem:(k,v)=>{full.set(k,v);}},next,null),/backups full/);assert.equal(full.get(SAVE_KEY),old);
  assert.throws(()=>saveStoredCity({getItem:k=>k===SAVE_KEY?old:null,setItem:()=>{throw Error('quota');}},next,null),/quota/);
});

test('large-city daily and payroll boundaries stay deterministic with balanced accounts', t=>{
  const a=fixture(334,true), b=deserialize(serialize(a)); const durations:number[]=[];
  for(let day=0;day<21;day++){
    const start=performance.now();step(a);durations.push(performance.now()-start);step(b);
    assert.equal(Object.values(a.accounts).reduce((x,y)=>x+y,0),0);
  }
  assert.deepEqual(a,b);assert.deepEqual(deserialize(serialize(a)),a);
  const sorted=[...durations].sort((x,y)=>x-y);
  t.diagnostic(`Synthetic 1000-person city: 21 daily steps including payroll; median ${sorted[10].toFixed(1)}ms, max ${sorted.at(-1)!.toFixed(1)}ms. Cloud CPU only, not frame-time or Android benchmark.`);
});
