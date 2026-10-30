import test from 'node:test';import assert from 'node:assert/strict';
import {createCity} from '../src/sim.ts';
import {createParkRuntime,serializeParkSession,deserializeParkSession} from '../src/park-runtime.ts';
import {RailNetworkRuntime} from '../src/rail/network-runtime.ts';
import {restoreStartupCity} from '../src/startup-save.ts';
import {createSaveGuard} from '../src/save-guard.ts';
import {createAutosave} from '../src/autosave.ts';
import {SAVE_KEY} from '../src/save-storage.ts';
import {loadLocalCitySession} from '../src/local-city-save.ts';
import {marketJournalForTest} from '../src/market-client.ts';
const memory=()=>{const data=new Map<string,string>();return {data,getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v);}};};
const fixture=()=>{const city=createCity(61025,{starter:false}),runtime=createParkRuntime(city);const market=marketJournalForTest(null);market.guestId='00000000-0000-4000-8000-000000000003';city.market=market;
  runtime.rail=RailNetworkRuntime.create(city,'rail-guard-city',0);runtime.rail.addStation('a',245);return {city,runtime};};
test('startup restores rail and Guest identity without writes or identity replacement',()=>{
 const s=memory(),{city,runtime}=fixture(),raw=serializeParkSession(city,runtime);s.setItem(SAVE_KEY,raw);const before=[...s.data];
 const loaded=restoreStartupCity(s,()=>createCity(9));assert.equal(loaded.restored,true);assert.deepEqual([...s.data],before);assert.equal(loaded.city.market!.guestId,city.market!.guestId);
 assert.equal(serializeParkSession(loaded.city,loaded.runtime),raw);assert.equal(loaded.runtime.rail!.snapshot.cityId,'rail-guard-city');
});
test('corrupt rail blocks startup and explicit load, preserving exact original bytes',async()=>{
 const s=memory(),{city,runtime}=fixture(),parsed=JSON.parse(serializeParkSession(city,runtime));parsed.parkRuntime.rail.binding.cityRevision='bad';const bad=JSON.stringify(parsed);s.setItem(SAVE_KEY,bad);
 const loaded=restoreStartupCity(s,()=>createCity(9));assert.ok(loaded.error);assert.equal(loaded.guard.armed,false);assert.equal(s.getItem(SAVE_KEY),bad);
 let applied=false;await assert.rejects(loadLocalCitySession(bad,undefined,loaded.guard,()=>{applied=true;}));assert.equal(applied,false);assert.equal(s.getItem(SAVE_KEY),bad);
});
test('paused station edits reach existing autosave while generation and cross-tab guards remain authoritative',async()=>{
 const s=memory(),{city,runtime}=fixture(),guard=createSaveGuard(s);const auto=createAutosave({tick:()=>city.tick,revision:()=>serializeParkSession(city,runtime),save:()=>guard.write(serializeParkSession(city,runtime),null),onResult:()=>{}});
 await auto.run();const before=s.getItem(SAVE_KEY)!;runtime.rail!.addStation('b',255);await auto.run();const current=s.getItem(SAVE_KEY)!;assert.notEqual(current,before);assert.equal(deserializeParkSession(current).runtime.rail!.snapshot.stations.length,2);
 const generation=guard.generation;guard.acceptLoaded(current,true);assert.throws(()=>guard.write(current,null,generation));assert.equal(s.getItem(SAVE_KEY),current);
 s.setItem(SAVE_KEY,before);assert.throws(()=>guard.write(current,null));assert.equal(s.getItem(SAVE_KEY),before);
});
test('primary quota failure preserves the complete prior city and railway together',()=>{
 const s=memory(),{city,runtime}=fixture(),old=serializeParkSession(city,runtime);s.setItem(SAVE_KEY,old);
 const guard=createSaveGuard({...s,setItem:(key,value)=>{if(key===SAVE_KEY)throw Error('primary quota');s.setItem(key,value);}});guard.acceptLoaded(old);
 runtime.rail!.addStation('b',255);assert.throws(()=>guard.write(serializeParkSession(city,runtime),null),/quota/);assert.equal(s.getItem(SAVE_KEY),old);assert.equal(deserializeParkSession(old).runtime.rail!.snapshot.stations.length,1);
});
