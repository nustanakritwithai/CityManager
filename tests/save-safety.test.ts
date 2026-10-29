import {readFileSync} from 'node:fs';
import test from 'node:test';import assert from 'node:assert/strict';
import {createCity,step,zoneCell} from '../src/sim.ts';
import {createParkRuntime,serializeParkSession,deserializeParkSession} from '../src/park-runtime.ts';
import {SAVE_KEY,AUTOSAVE_CHECKPOINT_KEY,PRE_AUTOSAVE_BACKUP,readStoredCity} from '../src/save-storage.ts';
import {createSaveGuard} from '../src/save-guard.ts';import {restoreStartupCity} from '../src/startup-save.ts';
import {createAutosave} from '../src/autosave.ts';import {saveLocalCitySession} from '../src/local-city-save.ts';import {MarketClient} from '../src/market-client.ts';
const memory=()=>{const data=new Map<string,string>();return{data,getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v);}};};
const fresh=()=>createCity(61025,{starter:false});const snapshot=(c:ReturnType<typeof fresh>)=>serializeParkSession(c,createParkRuntime(c));
test('startup restores prior played city before autosave without changing original bytes',()=>{
 const s=memory(),old=fresh();for(let i=0;i<65;i++)step(old);const raw=snapshot(old);s.setItem(SAVE_KEY,raw);
 const loaded=restoreStartupCity(s,fresh);assert.equal(loaded.restored,true);assert.equal(loaded.city.tick,65);assert.deepEqual(loaded.city,old);assert.equal(s.getItem(SAVE_KEY),raw);assert.equal(s.data.size,1);assert.equal(loaded.guard.armed,true);
 loaded.guard.write(raw,null);assert.equal(s.getItem(PRE_AUTOSAVE_BACKUP),raw);assert.equal(s.getItem(AUTOSAVE_CHECKPOINT_KEY),raw);
});
test('corrupt or unknown-version save blocks all replacement writes and keeps bytes',()=>{
 for(const raw of ['{broken',JSON.stringify({version:999,tick:65})]){const s=memory();s.setItem(SAVE_KEY,raw);const loaded=restoreStartupCity(s,fresh);assert.ok(loaded.error);assert.equal(loaded.guard.armed,false);assert.throws(()=>loaded.guard.write(snapshot(fresh()),null));assert.equal(s.getItem(SAVE_KEY),raw);}
});
test('fresh un-loaded session cannot auto-overwrite an existing city',()=>{
 const s=memory(),raw=snapshot(fresh());s.setItem(SAVE_KEY,raw);const guard=createSaveGuard(s);assert.equal(guard.armed,false);assert.throws(()=>guard.write(snapshot(createCity(2)),null));assert.equal(s.getItem(SAVE_KEY),raw);
});
test('stale tab and old async generation cannot overwrite a newer save',()=>{
 const s=memory(),c=fresh(),a=createSaveGuard(s),b=createSaveGuard(s);a.write(snapshot(c),null);const latest=s.getItem(SAVE_KEY);assert.throws(()=>b.write(snapshot(createCity(2)),null),/อีกแท็บ/);assert.equal(s.getItem(SAVE_KEY),latest);
 const generation=a.generation;a.acceptLoaded(latest!,true);assert.throws(()=>a.write(latest!,null,generation),/เมืองเปลี่ยน/);assert.equal(s.getItem(SAVE_KEY),latest);
});
test('old client overwriting legacy slot does not destroy the independent latest checkpoint',()=>{
 const s=memory(),c=fresh(),g=createSaveGuard(s);step(c);const latest=snapshot(c);g.write(latest,null);s.setItem(SAVE_KEY,snapshot(fresh()));
 assert.equal(s.getItem(AUTOSAVE_CHECKPOINT_KEY),latest);const loaded=restoreStartupCity(s,fresh);assert.ok(loaded.error);assert.equal(loaded.guard.armed,false);
 assert.equal(readStoredCity(s,'checkpoint')?.raw,latest);
});
test('paused edits are saved even when economic day did not change',async()=>{
 const s=memory(),c=fresh(),p=createParkRuntime(c),g=createSaveGuard(s);const auto=createAutosave({tick:()=>c.tick,revision:()=>serializeParkSession(c,p),save:()=>g.write(serializeParkSession(c,p),null),onResult:()=>{}});await auto.run();const before=s.getItem(SAVE_KEY);
 const i=c.cells.findIndex((cell,n)=>!cell.road&&!cell.building&&[n-1,n+1,n-24,n+24].some(j=>c.cells[j]?.road));assert.ok(zoneCell(c,i,'R').ok);assert.equal(c.tick,0);await auto.run();assert.notEqual(s.getItem(SAVE_KEY),before);assert.deepEqual(deserializeParkSession(s.getItem(SAVE_KEY)!).city,c);
});
test('offline city saves without network or Web Locks and does not mutate market journal',async()=>{
 const originalWindow=Object.getOwnPropertyDescriptor(globalThis,'window'),originalStorage=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),originalNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator');const s=memory();Object.defineProperty(globalThis,'window',{configurable:true,value:{}});Object.defineProperty(globalThis,'localStorage',{configurable:true,value:s});Object.defineProperty(globalThis,'navigator',{configurable:true,value:{}});
 try{const c=fresh(),p=createParkRuntime(c),client=new MarketClient(()=>c,'/citymanager-api'),before=JSON.stringify(client.journal);let raw='';await saveLocalCitySession(c,p,client,value=>{raw=value;});assert.equal(JSON.stringify(client.journal),before);assert.deepEqual(deserializeParkSession(raw).city,c);}finally{for(const [key,descriptor] of [['window',originalWindow],['localStorage',originalStorage],['navigator',originalNavigator]] as const){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}}
});
test('quota failures preserve primary snapshot and explicit new-city archives prior work',()=>{
 const s=memory(),old=snapshot(fresh());s.setItem(SAVE_KEY,old);const blocked=createSaveGuard({...s,setItem:()=>{throw Error('quota');}});blocked.acceptLoaded(old);assert.throws(()=>blocked.write(old,null),/quota/);assert.equal(s.getItem(SAVE_KEY),old);
 const guard=createSaveGuard(s);guard.acceptLoaded(old);guard.authorizeNew(old);guard.write(snapshot(createCity(2)),null);assert.ok([...s.data.values()].includes(old));
});

test('explicit Load remains read-only; replacement copies are deferred until Save',()=>{
 const s=memory(),current=snapshot(fresh()),other=snapshot(createCity(2));s.setItem(SAVE_KEY,current);s.setItem(AUTOSAVE_CHECKPOINT_KEY,current);const g=createSaveGuard(s),before=[...s.data];
 g.acceptLoaded(other,true);assert.deepEqual([...s.data],before);g.write(other,null);assert.ok([...s.data.values()].includes(current));assert.equal(s.getItem(SAVE_KEY),other);
});

test('required legacy backup quota fails before any new recovery metadata is published',()=>{
 const old=readFileSync(new URL('./fixtures/legacy-v1-day65.json',import.meta.url),'utf8'),loaded=deserializeParkSession(old),s=memory(),sentinel=snapshot(createCity(91));s.setItem(SAVE_KEY,sentinel);s.setItem('citymanager.save.v1',old);const before=[...s.data];
 const g=createSaveGuard({...s,setItem:(key,value)=>{if(key.startsWith('citymanager.backup.v1'))throw Error('backup quota');s.setItem(key,value);}});g.acceptLoaded(old,true);
 assert.throws(()=>g.write(serializeParkSession(loaded.city,loaded.runtime),old),/backup quota/);assert.deepEqual([...s.data],before);
});

test('corrupt primary recovery preserves the valid legacy-backup pointer',()=>{
 const old=readFileSync(new URL('./fixtures/legacy-v1-day65.json',import.meta.url),'utf8'),loaded=deserializeParkSession(old),raw=serializeParkSession(loaded.city,loaded.runtime),s=memory();s.setItem(SAVE_KEY,snapshot(createCity(91)));s.setItem('citymanager.save.v1',old);const g=createSaveGuard(s);g.acceptLoaded(old,true);g.write(raw,old);const pointer=s.getItem('citymanager.backup.latest');
 s.setItem(SAVE_KEY,'{broken');g.acceptLoaded(old,true);g.write(raw,old);assert.equal(s.getItem('citymanager.backup.latest'),pointer);assert.equal(s.getItem(SAVE_KEY),raw);
});
test('primary quota preserves current bytes and existing recovery pointer',()=>{
 const c=fresh(),s=memory(),old=snapshot(c);s.setItem(SAVE_KEY,old);s.setItem('citymanager.backup.latest','citymanager.backup.v1');const g=createSaveGuard({...s,setItem:(k,v)=>{if(k===SAVE_KEY)throw Error('primary quota');s.setItem(k,v);}});g.acceptLoaded(old);step(c);assert.throws(()=>g.write(snapshot(c),null),/primary quota/);assert.equal(s.getItem(SAVE_KEY),old);assert.equal(s.getItem('citymanager.backup.latest'),'citymanager.backup.v1');
});

test('stale-work recovery is separate from the legacy migration backup selection',()=>{
 const s=memory(),c=fresh(),g=createSaveGuard(s);g.write(snapshot(c),null);s.setItem('citymanager.backup.latest','citymanager.backup.v1');const other=snapshot(createCity(2));s.setItem(SAVE_KEY,other);
 const work=snapshot(c);assert.throws(()=>g.write(work,null),/อีกแท็บ/);assert.equal(s.getItem('citymanager.backup.latest'),'citymanager.backup.v1');assert.equal(readStoredCity(s,'conflict')?.raw,work);assert.equal(s.getItem(SAVE_KEY),other);
});
