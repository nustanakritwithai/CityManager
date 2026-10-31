import test from 'node:test';import assert from 'node:assert/strict';
import {createCity,step} from '../src/sim.ts';
import {createParkRuntime,serializeParkSession} from '../src/park-runtime.ts';
import {createSaveGuard} from '../src/save-guard.ts';
import {SAVE_KEY,AUTOSAVE_CHECKPOINT_KEY,PRE_AUTOSAVE_BACKUP,readStoredCity} from '../src/save-storage.ts';
import {encodeSaveCopy} from '../src/save-copy-codec.ts';
import {autoCleanupOnce,dropOldCopies,AUTO_CLEANUP_FLAG} from '../src/auto-cleanup.ts';
const snap=(c:ReturnType<typeof createCity>)=>serializeParkSession(c,createParkRuntime(c));
function quotaStore(limit:number){const data=new Map<string,string>();const size=(skip?:string)=>[...data].reduce((n,[k,v])=>n+(k===skip?0:k.length+v.length),0);
 const s={data,get length(){return data.size;},key:(i:number)=>[...data.keys()][i]??null,getItem:(k:string)=>data.get(k)??null,removeItem:(k:string)=>{data.delete(k);},
  setItem:(k:string,v:string)=>{if(size(k)+k.length+v.length>limit)throw Object.assign(Error('quota'),{name:'QuotaExceededError'});data.set(k,v);}};return s;}
const city=(days:number,seed=7)=>{const c=createCity(seed,{starter:true});for(let i=0;i<days;i++)step(c);return c;};
test('full storage + many old saves: newest kept, others removed, foreign keys untouched, primary write succeeds',async()=>{
 const old=snap(city(20)),newer=snap(city(60)),s=quotaStore(old.length*4+newer.length*2+4000);
 s.setItem('strategy-game.save','X'.repeat(1000));s.setItem(SAVE_KEY,old);s.setItem(PRE_AUTOSAVE_BACKUP,encodeSaveCopy(old));s.setItem('citymanager.backup.before-taxi',old);s.setItem('citymanager.backup.save-conflict.0',encodeSaveCopy(old));s.setItem(AUTOSAVE_CHECKPOINT_KEY,encodeSaveCopy(newer));
 const r=await autoCleanupOnce(s as unknown as Storage,undefined);
 assert.equal(r.ran,true);assert.equal(r.tick,JSON.parse(newer).city?.tick??60);
 assert.equal(s.getItem(SAVE_KEY),newer);assert.equal(s.getItem('strategy-game.save'),'X'.repeat(1000));
 assert.deepEqual([...s.data.keys()].filter(k=>k.startsWith('citymanager.')).sort(),[AUTO_CLEANUP_FLAG,SAVE_KEY].sort());
 assert.equal((await autoCleanupOnce(s as unknown as Storage,undefined)).ran,false);
 const g=createSaveGuard(s);assert.equal(readStoredCity(s)?.raw,newer);g.acceptLoaded(newer);const c=city(61);g.write(snap(c),null);assert.equal(s.getItem(SAVE_KEY),snap(c));
});
test('never discards newer unreadable city',async()=>{const s=quotaStore(1e7);s.setItem(SAVE_KEY,snap(city(5)));s.setItem('citymanager.backup.v6',JSON.stringify({city:{tick:999}}));const r=await autoCleanupOnce(s as unknown as Storage,undefined);assert.equal(r.ran,false);assert(s.getItem('citymanager.backup.v6'));});
test('dropOldCopies keeps primary + checkpoint and foreign keys',()=>{const s=quotaStore(1e7);for(const k of [SAVE_KEY,AUTOSAVE_CHECKPOINT_KEY,PRE_AUTOSAVE_BACKUP,'citymanager.market.v10','other'])s.setItem(k,'1');dropOldCopies(s as unknown as Storage,[AUTOSAVE_CHECKPOINT_KEY]);assert.deepEqual([...s.data.keys()].sort(),[SAVE_KEY,AUTOSAVE_CHECKPOINT_KEY,'citymanager.market.v10','other'].sort());});
test('one-time full wipe removes every CityManager save copy, keeps foreign + settings keys',async()=>{
 const {autoWipeOnce,FULL_WIPE_FLAG}=await import('../src/auto-cleanup.ts');const s=quotaStore(1e7);
 for(const k of [SAVE_KEY,AUTOSAVE_CHECKPOINT_KEY,PRE_AUTOSAVE_BACKUP,'citymanager.backup.v6','citymanager.save.v1','citymanager.resume-choice.v1','citymanager.audio.v1','strategy-game.save'])s.setItem(k,'1');
 const r=await autoWipeOnce(s as unknown as Storage,undefined);assert.equal(r.ran,true);
 assert.deepEqual([...s.data.keys()].sort(),['citymanager.audio.v1',FULL_WIPE_FLAG,'strategy-game.save'].sort());
 s.setItem(SAVE_KEY,'new');assert.equal((await autoWipeOnce(s as unknown as Storage,undefined)).ran,false);assert.equal(s.getItem(SAVE_KEY),'new');
});
