import test from 'node:test';
import assert from 'node:assert/strict';
import {populationFixture} from './population-capacity-fixture.ts';
import {step,serialize} from '../src/sim.ts';
import {advanceParkRuntime,createParkRuntime,serializeParkSession,deserializeParkSession} from '../src/park-runtime.ts';
import {restoreStartupCity} from '../src/startup-save.ts';
import {createAutosave,installAutosave,AUTOSAVE_INTERVAL_MS} from '../src/autosave.ts';
import {saveLocalCitySession} from '../src/local-city-save.ts';
import {SAVE_KEY,AUTOSAVE_CHECKPOINT_KEY,PRE_AUTOSAVE_BACKUP} from '../src/save-storage.ts';
import {decodeSaveCopy} from '../src/save-copy-codec.ts';

test('legacy storage utility preserves runtime-only autosave with primary-first durable copies',async()=>{
 const dense=populationFixture(334,true);step(dense);
 const raw=serializeParkSession(dense,createParkRuntime(dense));
 const writes:string[]=[],map=new Map([[SAVE_KEY,raw]]);
 const storage={getItem:(key:string)=>map.get(key)??null,setItem:(key:string,value:string)=>{writes.push(key);map.set(key,value);}};
 const {city,runtime,guard}=restoreStartupCity(storage,()=>{throw Error('unexpected fresh city');});
 const economic=serialize(city);
 let timer=()=>{};let delay=0;
 const events:Record<string,()=>void>={};const listen={addEventListener:(key:string,fn:()=>void)=>{events[key]=fn;}};
 const auto=createAutosave({save:()=>saveLocalCitySession(city,runtime,undefined,value=>guard.write(value,null)),tick:()=>city.tick,revision:()=>serializeParkSession(city,runtime,city.market),canSave:()=>guard.armed,onResult:()=>{}});
 installAutosave(listen,{...listen,setInterval:(fn:()=>void,ms:number)=>{timer=fn;delay=ms;}},auto,()=>false);
 assert.equal(delay,AUTOSAVE_INTERVAL_MS);assert.equal(delay,60000);assert.equal(guard.armed,true);
 advanceParkRuntime(city,runtime,1.25,()=>{throw Error('must not advance economic day');});
 assert.equal(serialize(city),economic);assert.equal(city.tick,401);
 assert.equal(storage.getItem(SAVE_KEY),raw);assert.deepEqual(writes,[],'runtime/traffic-style advancement itself performs no storage writes');
 const advanced=serializeParkSession(city,runtime,city.market);assert.notEqual(advanced,raw);
 assert.deepEqual(Object.keys(JSON.parse(raw)).filter(key=>JSON.stringify(JSON.parse(raw)[key])!==JSON.stringify(JSON.parse(advanced)[key])),['parkRuntime']);
 timer();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(auto.last?.ok,true);assert.equal(storage.getItem(SAVE_KEY),advanced);
 // Current guard publishes the validated primary first; both lossless copies remain required.
 assert.deepEqual(writes,[SAVE_KEY,AUTOSAVE_CHECKPOINT_KEY,PRE_AUTOSAVE_BACKUP]);
 assert.equal(decodeSaveCopy(storage.getItem(PRE_AUTOSAVE_BACKUP)),raw);
 assert.equal(decodeSaveCopy(storage.getItem(AUTOSAVE_CHECKPOINT_KEY)),advanced);
 const reopened=deserializeParkSession(storage.getItem(SAVE_KEY)!);
 assert.equal(serialize(reopened.city),economic);assert.deepEqual(reopened.runtime,runtime);
});
