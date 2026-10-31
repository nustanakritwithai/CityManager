import test from 'node:test';import assert from 'node:assert/strict';
import {createCity,step} from '../src/sim.ts';import {createParkRuntime,serializeParkSession} from '../src/park-runtime.ts';
import {createSaveGuard,freeSaveSpace,isOrphanTaxiBackup} from '../src/save-guard.ts';
import {encodeSaveCopy,decodeSaveCopy} from '../src/save-copy-codec.ts';
import {SAVE_KEY,AUTOSAVE_CHECKPOINT_KEY,TAXI_BACKUP_KEY} from '../src/save-storage.ts';
/** localStorage-like store with a character quota (keys + values), like browsers. */
function quotaStore(limit:number){const data=new Map<string,string>();const used=()=>[...data].reduce((n,[k,v])=>n+k.length+v.length,0);
 return {data,get length(){return data.size;},key:(i:number)=>[...data.keys()][i]??null,getItem:(k:string)=>data.get(k)??null,removeItem:(k:string)=>{data.delete(k);},
  setItem(k:string,v:string){const prev=data.get(k);const next=used()-(prev===undefined?0:k.length+prev.length)+k.length+v.length;if(next>limit)throw Object.assign(Error('quota'),{name:'QuotaExceededError'});data.set(k,v);}};}
const city=(days:number)=>{const c=createCity(3,{starter:true});for(let i=0;i<days;i++)step(c);return c;};
const raw=(days:number)=>{const c=city(days);return serializeParkSession(c,createParkRuntime(c));};
test('startup removes only the raw #153 taxi orphan; compressed taxi backup, primary and Strategy-Game keys stay',()=>{
 const save=raw(65),s=quotaStore(10_000_000);s.setItem(SAVE_KEY,save);s.setItem(TAXI_BACKUP_KEY,save);s.setItem(`${TAXI_BACKUP_KEY}.1`,encodeSaveCopy(save));s.setItem('strategy-game.save','{"turn":1}');s.setItem('citymanager.backup.before-taxi-note','x'.repeat(70000));
 assert.equal(isOrphanTaxiBackup(TAXI_BACKUP_KEY,save),true);assert.equal(isOrphanTaxiBackup(TAXI_BACKUP_KEY,encodeSaveCopy(save)),false);
 createSaveGuard(s);
 assert.equal(s.getItem(TAXI_BACKUP_KEY),null);assert.equal(decodeSaveCopy(s.getItem(`${TAXI_BACKUP_KEY}.1`)),save);assert.equal(s.getItem(SAVE_KEY),save);assert.equal(s.getItem('strategy-game.save'),'{"turn":1}');
 assert.equal(s.getItem('citymanager.backup.before-taxi-note')?.length,70000);
});
test('near-full storage: primary is written first and wins; raw old backups are recompressed losslessly; reload reads them',()=>{
 const old=raw(65),next=raw(66);
 // Primary + two raw old backups fill the quota; there is no room for any extra copy.
 const s=quotaStore(old.length*3+next.length-old.length+2000);s.setItem(SAVE_KEY,old);s.setItem('citymanager.backup.before-bus',old);s.setItem('citymanager.backup.before-education',old);s.setItem('strategy-game.save','keep');
 const g=createSaveGuard(s);g.acceptLoaded(old);
 g.write(next,null);
 assert.equal(s.getItem(SAVE_KEY),next,'primary written');
 assert.equal(decodeSaveCopy(s.getItem('citymanager.backup.before-bus')),old,'old backup still readable (lossless)');
 assert.equal(decodeSaveCopy(s.getItem('citymanager.backup.before-education')),old);
 const ck=s.getItem(AUTOSAVE_CHECKPOINT_KEY);assert.ok(ck===null||decodeSaveCopy(ck)===next,'checkpoint never disagrees with primary');
 assert.equal(s.getItem('strategy-game.save'),'keep');
});
test('freeSaveSpace never touches the primary save or non-CityManager keys',()=>{
 const save=raw(10),s=quotaStore(10_000_000);s.setItem(SAVE_KEY,save);s.setItem('other-app','y'.repeat(80000));s.setItem('citymanager.backup.v1','z'.repeat(80000));
 freeSaveSpace(s);assert.equal(s.getItem(SAVE_KEY),save);assert.equal(s.getItem('other-app')?.length,80000);assert.equal(decodeSaveCopy(s.getItem('citymanager.backup.v1')),'z'.repeat(80000));
});
