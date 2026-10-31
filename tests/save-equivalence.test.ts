import test from 'node:test';import assert from 'node:assert/strict';
import {createCity} from '../src/sim.ts';import {createParkRuntime,serializeParkSession} from '../src/park-runtime.ts';
import {restoreStartupCity} from '../src/startup-save.ts';import {SAVE_KEY,AUTOSAVE_CHECKPOINT_KEY} from '../src/save-storage.ts';import {decodeSaveCopy} from '../src/save-copy-codec.ts';
const fresh=()=>createCity(61025);const raw=()=>{const c=fresh();return serializeParkSession(c,createParkRuntime(c));};
const store=(primary:string,copy:string)=>{const data=new Map([[SAVE_KEY,primary],[AUTOSAVE_CHECKPOINT_KEY,copy]]);return{data,getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v);}};};
test('same valid session with top-level order/whitespace differences resumes without startup writes and archives alternate bytes on Save',()=>{
 const primary=raw(),parsed=JSON.parse(primary),copy=JSON.stringify(Object.fromEntries(Object.entries(parsed).reverse()),null,2),s=store(primary,copy),before=[...s.data];
 const result=restoreStartupCity(s,fresh);assert.equal(result.restored,true);assert.equal(result.error,null);assert.equal(result.guard.armed,true);assert.deepEqual([...s.data],before);
 result.guard.write(primary,null);assert.ok([...s.data.values()].map(decodeSaveCopy).includes(copy));assert.ok([...s.data.values()].map(decodeSaveCopy).includes(primary));
});
test('clock, Guest, array, unknown-field and nested-key order differences never auto-resume',()=>{
 const primary=raw(),original=JSON.parse(primary);
 const mutations=[
  (p:any)=>{p.parkRuntime.minuteRemainder=0.5;},
  (p:any)=>{p.lastEvent='different city event';},
  (p:any)=>{p.unreviewedExtra=true;},
  (p:any)=>{p.parkRuntime=Object.fromEntries(Object.entries(p.parkRuntime).reverse());},
  (p:any)=>{p.cells=[...p.cells].reverse();},
 ];
 for(const mutate of mutations){const p=structuredClone(original);mutate(p);const s=store(primary,JSON.stringify(p)),before=[...s.data];const result=restoreStartupCity(s,fresh);assert.equal(result.restored,false);assert.equal(result.guard.armed,false);assert.deepEqual([...s.data],before);}
});

test('equivalence never accepts invalid snapshots or different Guest identities',async()=>{
 const {equivalentStoredSessions}=await import('../src/save-equivalence.ts');
 const {marketJournalForTest}=await import('../src/market-client.ts');
 const city=fresh();city.market=marketJournalForTest(null);city.market.guestId='00000000-0000-4000-8000-000000000001';
 const primary=serializeParkSession(city,createParkRuntime(city)),changed=JSON.parse(primary);changed.market.guestId='00000000-0000-4000-8000-000000000002';
 assert.equal(equivalentStoredSessions(primary,JSON.stringify(changed)),false);
 assert.equal(equivalentStoredSessions('{broken','{broken'),false);
 assert.equal(equivalentStoredSessions('{"version":999}','{ "version":999 }'),false);
 const extra=JSON.parse(primary);extra.extra=null;assert.equal(equivalentStoredSessions(primary,JSON.stringify(extra)),false);
 const nested=JSON.parse(primary);nested.extra={a:1,b:2};const nested2=structuredClone(nested);nested2.extra={b:2,a:1};assert.equal(equivalentStoredSessions(JSON.stringify(nested),JSON.stringify(nested2)),false);
 const arr=JSON.parse(primary);arr.extra=[1,2];const arr2=structuredClone(arr);arr2.extra=[2,1];assert.equal(equivalentStoredSessions(JSON.stringify(arr),JSON.stringify(arr2)),false);
});
test('archive quota after formatting-only resume never blocks the primary save (primary first, copies best effort)',()=>{
 const primary=raw(),copy=JSON.stringify(JSON.parse(primary),null,2),s=store(primary,copy);
 const blocked={getItem:s.getItem,setItem:(k:string,v:string)=>{if(k.startsWith('citymanager.backup.save-conflict.'))throw Error('synthetic archive quota');s.setItem(k,v);}};
 const result=restoreStartupCity(blocked,fresh);assert.equal(result.restored,true);
 result.guard.write(primary,null);assert.equal(s.getItem(SAVE_KEY),primary);assert.equal(decodeSaveCopy(s.getItem(AUTOSAVE_CHECKPOINT_KEY)),primary);
});
