import test from 'node:test';
import assert from 'node:assert/strict';
import {createCity,step} from '../src/sim.ts';
import {createParkRuntime,serializeParkSession} from '../src/park-runtime.ts';
import {restoreStartupCity} from '../src/startup-save.ts';
import {loadLocalCitySession} from '../src/local-city-save.ts';
import {SAVE_KEY,AUTOSAVE_CHECKPOINT_KEY,readStoredCity} from '../src/save-storage.ts';
import {decodeSaveCopy} from '../src/save-copy-codec.ts';
const fresh=()=>createCity(61025,{starter:true});
const snapshot=(city:ReturnType<typeof fresh>)=>serializeParkSession(city,createParkRuntime(city));
const memory=()=>{const data=new Map<string,string>();return{data,getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v);}};};

test('interrupted primary write reproduces startup lock with two valid intact saves; explicit choice preserves both',async()=>{
 for(const source of ['current','checkpoint'] as const){
  const s=memory(),city=fresh(),old=snapshot(city);s.setItem(SAVE_KEY,old);s.setItem(AUTOSAVE_CHECKPOINT_KEY,old);
  let failPrimary=true;
  const storage={getItem:s.getItem,setItem:(key:string,value:string)=>{if(key===SAVE_KEY&&failPrimary)throw Error('synthetic primary write interruption');s.setItem(key,value);}};
  const session=restoreStartupCity(storage,fresh);assert.equal(session.restored,true);
  step(city);const next=snapshot(city);
  assert.throws(()=>session.guard.write(next,null),/synthetic primary write interruption/);
  assert.equal(s.getItem(SAVE_KEY),old);assert.equal(decodeSaveCopy(s.getItem(AUTOSAVE_CHECKPOINT_KEY)),next);
  failPrimary=false;const before=[...s.data],resumed=restoreStartupCity(storage,fresh);
  assert.match(resumed.error!,/สำเนาอัตโนมัติต่างกัน/);assert.equal(resumed.guard.armed,false);assert.equal(resumed.restored,false);
  assert.equal(resumed.city.tick,0);assert.deepEqual([...s.data],before);
  assert.throws(()=>resumed.guard.write(snapshot(resumed.city),null),/ยังไม่ได้โหลดเซฟเดิม/);
  const chosen=readStoredCity(storage,source)!;let applied='';
  await loadLocalCitySession(chosen.raw,undefined,resumed.guard,loaded=>{applied=snapshot(loaded.city);});
  assert.deepEqual([...s.data],before,'Explicit Load is read-only');assert.equal(resumed.guard.armed,true);
  assert.equal(applied,source==='current'?old:next);
  resumed.guard.write(applied,null);
  const retained=[...s.data.values()].map(raw=>decodeSaveCopy(raw));
  assert.ok(retained.includes(old));assert.ok(retained.includes(next));assert.equal(s.getItem(SAVE_KEY),applied);
  assert.equal(restoreStartupCity(storage,fresh).error,null);
 }
});

test('startup error categories preserve original bytes, and a valid ordinary save never locks',()=>{
 const valid=snapshot(fresh());
 for(const [name,raw,checkpoint] of [
  ['valid',valid,null],['invalid JSON','{broken',null],
  ['unsupported schema',JSON.stringify({version:999,tick:65}),null],
  ['bad recovery codec',valid,'cm-copy-lz1:broken'],
 ] as const){
  const s=memory();s.setItem(SAVE_KEY,raw);if(checkpoint)s.setItem(AUTOSAVE_CHECKPOINT_KEY,checkpoint);const before=[...s.data];
  const loaded=restoreStartupCity(s,fresh);assert.deepEqual([...s.data],before,name);
  assert.equal(loaded.guard.armed,name==='valid',name);assert.equal(loaded.restored,name==='valid',name);
  assert.equal(loaded.error===null,name==='valid',name);
 }
 const s=memory();s.setItem(SAVE_KEY,valid);const loaded=restoreStartupCity({getItem:()=>{throw Error('synthetic storage access denied');},setItem:s.setItem},fresh);
 assert.match(loaded.error!,/storage access denied/);assert.equal(loaded.guard.armed,false);assert.equal(s.getItem(SAVE_KEY),valid);
});

test('local Guest recovery and Save need no login network or Web Locks when no financial journal exists',async()=>{
 const {MarketClient,marketJournalForTest,MARKET_SAVE_KEY}=await import('../src/market-client.ts');
 const {saveLocalCitySession}=await import('../src/local-city-save.ts');
 const keys=['window','navigator','localStorage','fetch'] as const;
 const descriptors=keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)] as const);
 const s=memory();let requests=0;
 try{
  Object.defineProperty(globalThis,'window',{configurable:true,value:{}});
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{}});
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:s});
  Object.defineProperty(globalThis,'fetch',{configurable:true,value:()=>{requests++;throw Error('synthetic login server outage');}});
  const journal=marketJournalForTest(null);journal.guestId='00000000-0000-4000-8000-000000000001';
  s.setItem(MARKET_SAVE_KEY,JSON.stringify(journal));
  const saved=fresh();saved.market=structuredClone(journal);const raw=snapshot(saved);s.setItem(SAVE_KEY,raw);
  step(saved);const checkpoint=snapshot(saved);s.setItem(AUTOSAVE_CHECKPOINT_KEY,checkpoint);
  const startup=restoreStartupCity(s,fresh);assert.ok(startup.error);
  let city=startup.city,runtime=startup.runtime;
  const client=new MarketClient(()=>city,'/citymanager-api'),before=[...s.data];
  await loadLocalCitySession(raw,client,startup.guard,loaded=>{city=loaded.city;runtime=loaded.runtime;});
  assert.deepEqual([...s.data],before);assert.equal(startup.guard.armed,true);
  await saveLocalCitySession(city,runtime,client,value=>startup.guard.write(value,null));
  assert.equal(requests,0);assert.equal(client.guestId,journal.guestId);assert.equal(city.market!.guestId,journal.guestId);
  assert.equal(s.getItem(MARKET_SAVE_KEY),JSON.stringify(journal));assert.equal(s.getItem(SAVE_KEY),raw);
  assert.ok([...s.data.values()].map(decodeSaveCopy).includes(checkpoint));
 }finally{for(const [key,descriptor] of descriptors){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}}
});
