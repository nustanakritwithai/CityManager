import assert from 'node:assert/strict';
import test from 'node:test';
import {createCity} from '../src/sim.ts';
import {createParkRuntime,serializeParkSession} from '../src/park-runtime.ts';
import {restoreStartupCity} from '../src/startup-save.ts';
import {createSaveGuard} from '../src/save-guard.ts';
import {loadLocalCitySession,saveLocalCitySession} from '../src/local-city-save.ts';
import {createAutosave,installAutosave} from '../src/autosave.ts';
import {MarketClient,marketJournalForTest,MARKET_SAVE_KEY} from '../src/market-client.ts';
import {SAVE_KEY,AUTOSAVE_CHECKPOINT_KEY} from '../src/save-storage.ts';

const memory=()=>{const data=new Map<string,string>();return {data,getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{data.set(key,value);},removeItem:(key:string)=>{data.delete(key);}};};
const snapshot=(city:ReturnType<typeof createCity>)=>serializeParkSession(city,createParkRuntime(city));

test('rejected guest Load never arms periodic or lifecycle saves over the preserved city',async()=>{
 const storage=memory(),prior=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:storage});
 try{
  const journal=marketJournalForTest(null);journal.guestId='00000000-0000-4000-8000-000000000001';
  storage.setItem(MARKET_SAVE_KEY,JSON.stringify(journal));
  const original=createCity(3);original.market={...structuredClone(journal),guestId:'00000000-0000-4000-8000-000000000002'};
  const raw=snapshot(original),newer=structuredClone(original);newer.lastEvent='newer checkpoint';
  storage.setItem(SAVE_KEY,raw);storage.setItem(AUTOSAVE_CHECKPOINT_KEY,snapshot(newer));
  const startup=restoreStartupCity(storage,()=>createCity(61025));
  assert.ok(startup.error);assert.equal(startup.guard.armed,false);
  let city=startup.city,runtime=startup.runtime;
  const client=new MarketClient(()=>city,'/citymanager-api'),before=[...storage.data];
  await assert.rejects(loadLocalCitySession(raw,client,startup.guard,restored=>{city=restored.city;runtime=restored.runtime;}),/guest identity mismatch/);
  const hooks=new Map<string,()=>void>();
  const auto=createAutosave({tick:()=>city.tick,canSave:()=>startup.guard.armed,save:()=>saveLocalCitySession(city,runtime,client,value=>startup.guard.write(value,null)),onResult:()=>{}});
  const listen={addEventListener:(event:string,fn:()=>void)=>{hooks.set(event,fn);}};
  installAutosave(listen,{...listen,setInterval:fn=>{hooks.set('timer',fn);}},auto,()=>true);
  for(const event of ['timer','visibilitychange','pagehide','beforeunload'])hooks.get(event)!();
  await auto.run(true);
  assert.deepEqual([...storage.data],before,'failed Load must preserve every original save, copy and journal byte');
  assert.equal(startup.guard.armed,false);
  assert.equal(city,startup.city);
 }finally{if(prior)Object.defineProperty(globalThis,'localStorage',prior);else Reflect.deleteProperty(globalThis,'localStorage');}
});

test('pending market binding blocks writes and a rejected bind leaves them blocked',async()=>{
 const storage=memory(),city=createCity(3),journal=marketJournalForTest(null);
 journal.receipts['00000000-0000-4000-8000-000000000003']={claimId:'00000000-0000-4000-8000-000000000004',state:'claimed'};
 city.market=journal;const raw=snapshot(city);storage.setItem(SAVE_KEY,raw);
 const guard=createSaveGuard(storage);guard.acceptLoaded(raw);const oldGeneration=guard.generation;
 const client=new MarketClient(()=>city,'/citymanager-api');
 let reject!:(error:Error)=>void;
 client.bindLoadedCity=async()=>new Promise<void>((_resolve,fail)=>{reject=fail;});
 const before=[...storage.data],pending=loadLocalCitySession(raw,client,guard,()=>assert.fail('rejected load applied'));
 assert.equal(guard.armed,false);
 assert.throws(()=>guard.write(raw,null,oldGeneration));
 reject(Error('synthetic bind rejection'));await assert.rejects(pending,/synthetic bind rejection/);
 assert.equal(guard.armed,false);assert.deepEqual([...storage.data],before);
});

test('successful load authorizes only its committed city and remains read-only until Save',async()=>{
 const storage=memory(),old=snapshot(createCity(3)),next=snapshot(createCity(4));storage.setItem(SAVE_KEY,old);
 const guard=createSaveGuard(storage);guard.acceptLoaded(old);const before=[...storage.data];let applied='';
 await loadLocalCitySession(next,undefined,guard,restored=>{applied=serializeParkSession(restored.city,restored.runtime);});
 assert.equal(applied,next);assert.equal(guard.armed,true);assert.deepEqual([...storage.data],before);
 guard.write(applied,null);assert.equal(storage.getItem(SAVE_KEY),next);assert.ok([...storage.data.values()].includes(old));
});

test('an older pending Load cannot replace a subsequently loaded city',async()=>{
 const storage=memory(),old=createCity(3),journal=marketJournalForTest(null);
 journal.receipts['00000000-0000-4000-8000-000000000003']={claimId:'00000000-0000-4000-8000-000000000004',state:'claimed'};
 old.market=journal;const raw=snapshot(old);storage.setItem(SAVE_KEY,raw);
 const guard=createSaveGuard(storage),client=new MarketClient(()=>old,'/citymanager-api');let resume!:()=>void;
 client.bindLoadedCity=async(_value,apply)=>{await new Promise<void>(resolve=>{resume=resolve;});apply();};
 const pending=loadLocalCitySession(raw,client,guard,()=>assert.fail('stale load applied'));
 const next=snapshot(createCity(4));let applied='';
 await loadLocalCitySession(next,undefined,guard,restored=>{applied=serializeParkSession(restored.city,restored.runtime);});
 resume();await assert.rejects(pending,/cancelled the older Load/);
 assert.equal(guard.armed,true);assert.equal(applied,next);guard.write(applied,null);assert.equal(storage.getItem(SAVE_KEY),next);
});

test('superseded Load with the real market binder preserves every stored byte and restart identity',async()=>{
 const descriptors=['window','navigator','localStorage'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)] as const);
 try{
  for(const existingJournal of [false,true]){
   const storage=memory();let resume!:()=>void;
   Object.defineProperty(globalThis,'localStorage',{configurable:true,value:storage});
   Object.defineProperty(globalThis,'window',{configurable:true,value:{}});
   Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:{request:(_name:string,_options:unknown,callback:(lock:unknown)=>Promise<unknown>)=>new Promise((resolve,reject)=>{resume=()=>{void Promise.resolve().then(()=>callback({})).then(resolve,reject);};})}}});
   if(existingJournal)storage.setItem(MARKET_SAVE_KEY,JSON.stringify(marketJournalForTest(null),null,2));
   let city=createCity(3);storage.setItem(SAVE_KEY,snapshot(city));storage.setItem(AUTOSAVE_CHECKPOINT_KEY,snapshot(city));
   const guard=createSaveGuard(storage);guard.acceptLoaded(snapshot(city));
   const client=new MarketClient(()=>city,'/citymanager-api'),journalBefore=client.exportSave();
   const old=createCity(8);old.market=marketJournalForTest(null);old.market.guestId='00000000-0000-4000-8000-000000000001';
   old.market.receipts['00000000-0000-4000-8000-000000000002']={claimId:'00000000-0000-4000-8000-000000000003',state:'claimed'};
   const before=[...storage.data];
   const pending=loadLocalCitySession(snapshot(old),client,guard,()=>assert.fail('cancelled city applied'));
   await loadLocalCitySession(snapshot(createCity(9)),client,guard,restored=>{city=restored.city;});
   const rejected=assert.rejects(pending,/cancelled the older Load/);resume();await rejected;
   assert.equal(city.seed,9);assert.equal(guard.armed,true);
   assert.deepEqual([...storage.data],before,'the cancelled binder must not persist its guest or receipts');
   assert.deepEqual(client.exportSave(),journalBefore);assert.equal(client.guestId,null);
   const restarted=new MarketClient(()=>city,'/citymanager-api');assert.equal(restarted.guestId,null);assert.deepEqual(restarted.journal.receipts,{});
   if(existingJournal)assert.deepEqual(restarted.exportSave(),journalBefore);
  }
 }finally{for(const [key,descriptor] of descriptors){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}}
});

test('real binder rolls back exact journal bytes and revision if applying the loaded city fails',async()=>{
 const descriptors=['window','navigator','localStorage'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)] as const);
 try{
  for(const existingJournal of [false,true]){
   const storage=memory();Object.defineProperty(globalThis,'localStorage',{configurable:true,value:storage});
   Object.defineProperty(globalThis,'window',{configurable:true,value:{}});
   Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:{request:(_name:string,_options:unknown,callback:(lock:unknown)=>Promise<unknown>)=>callback({})}}});
   if(existingJournal)storage.setItem(MARKET_SAVE_KEY,JSON.stringify(marketJournalForTest(null),null,2));
   let city=createCity(3);storage.setItem(SAVE_KEY,snapshot(city));
   const guard=createSaveGuard(storage),client=new MarketClient(()=>city,'/citymanager-api'),journalBefore=client.exportSave();
   const loaded=createCity(8);loaded.market=marketJournalForTest(null);loaded.market.guestId='00000000-0000-4000-8000-000000000001';
   loaded.market.receipts['00000000-0000-4000-8000-000000000002']={claimId:'00000000-0000-4000-8000-000000000003',state:'claimed'};
   const before=[...storage.data];
   await assert.rejects(loadLocalCitySession(snapshot(loaded),client,guard,()=>{throw Error('synthetic apply failure');}),/synthetic apply failure/);
   assert.equal(city.seed,3);assert.equal(guard.armed,false);assert.deepEqual([...storage.data],before);
   assert.deepEqual(client.exportSave(),journalBefore);assert.equal(client.guestId,null);assert.equal(new MarketClient(()=>city,'/citymanager-api').guestId,null);
   await loadLocalCitySession(snapshot(loaded),client,guard,restored=>{city=restored.city;});
   assert.equal(city.seed,8);assert.equal(client.guestId,loaded.market.guestId,'restored revision permits a subsequent valid bind');
  }
 }finally{for(const [key,descriptor] of descriptors){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}}
});
