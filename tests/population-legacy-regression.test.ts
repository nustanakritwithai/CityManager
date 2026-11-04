import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {deserialize,serialize} from '../src/sim.ts';
import {LEGACY_SAVE_KEY,LEGACY_BACKUP_KEY,HOUSEHOLD_SAVE_KEY,WORKER_SAVE_KEY,LATEST_BACKUP_KEY,SAVE_KEY,readStoredCity,saveStoredCity} from '../src/save-storage.ts';

const files=[['legacy-v1-day65.json','4e358e66acdfb55dcfd434aaf67be51ccea99c69fc5a2b9b44343035c16166d0'],['legacy-v2-day180.json','0c33c983c1e71063496f4a95b935c22647b972c0084d2ce98449b7e7b8c13475'],['legacy-v3-day180.json','59518ff5b7d2a7c7de52ef8cb8362ed387f91df67ffc09934c93e97f3a556693']] as const;
const originals=files.map(([f,hash])=>{const raw=readFileSync(new URL('./fixtures/'+f,import.meta.url),'utf8');assert.equal(createHash('sha256').update(raw).digest('hex'),hash);return raw;});
function memory(initial:Record<string,string>={}){const values=new Map(Object.entries(initial));return {values,getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v);}};}
test('authentic v1 v2 v3 decode repeatedly without changing money, identities, goods, journals or original bytes',()=>{
 for(const raw of originals){
  const prior=JSON.parse(raw),city=deserialize(raw),again=deserialize(raw);
  assert.deepEqual(again,city);for(const key of ['accounts','ledger','goodsLedger','goods','seed','rng','tick','nextId'] as const)assert.deepEqual(city[key],prior[key],key);
  for(const old of prior.households){const h=city.households.find(x=>x.id===old.id)!;assert.ok(h);for(const key of ['home','wallet','lastPurchaseTick','needs'])assert.equal(h[key as 'home'],old[key],key);if(old.members!==undefined)for(const key of ['members','workforce','dependents','profile','origin'])assert.equal(h[key as 'members'],old[key],key);}
  for(const old of prior.firms){const f=city.firms.find(x=>x.id===old.id)!;assert.ok(f);for(const key of ['building','wallet','inventory','workDays'])assert.deepEqual(f[key as 'building'],old[key],key);}
  assert.equal(raw,JSON.stringify(prior));assert.deepEqual(deserialize(serialize(city)),city);
 }
});
test('legacy backup utility preserves authentic original bytes, reuses backup and fails safely on quota',()=>{
 const [v1,v2,v3]=originals,next=serialize(deserialize(v1)),sentinel=serialize(deserialize(v2));
 const s=memory({[SAVE_KEY]:sentinel,[LEGACY_SAVE_KEY]:v1,[HOUSEHOLD_SAVE_KEY]:v2,[WORKER_SAVE_KEY]:v3});
 const backupFail={getItem:s.getItem,setItem:(k:string,v:string)=>{if(k===LEGACY_BACKUP_KEY)throw Error('backup quota');s.setItem(k,v);}};
 assert.throws(()=>saveStoredCity(backupFail,next,v1),/backup quota/);assert.equal(s.getItem(SAVE_KEY),sentinel);assert.equal(s.getItem(LEGACY_SAVE_KEY),v1);
 saveStoredCity(s,next,v1);assert.equal(s.getItem(LEGACY_BACKUP_KEY),v1);assert.equal(s.getItem(LATEST_BACKUP_KEY),LEGACY_BACKUP_KEY);assert.equal(s.getItem(HOUSEHOLD_SAVE_KEY),v2);assert.equal(s.getItem(WORKER_SAVE_KEY),v3);
 const first=[...s.values];saveStoredCity(s,next,v1);assert.deepEqual([...s.values],first);assert.deepEqual(readStoredCity(s,'backup'),{key:LEGACY_BACKUP_KEY,raw:v1});
 const failed=memory({[SAVE_KEY]:sentinel,[LEGACY_SAVE_KEY]:v1});const primaryFail={getItem:failed.getItem,setItem:(k:string,v:string)=>{if(k===SAVE_KEY)throw Error('primary quota');failed.setItem(k,v);}};
 assert.throws(()=>saveStoredCity(primaryFail,next,v1),/primary quota/);assert.equal(failed.getItem(SAVE_KEY),sentinel);assert.equal(failed.getItem(LEGACY_BACKUP_KEY),v1);assert.equal(failed.getItem(LEGACY_SAVE_KEY),v1);
 s.setItem(SAVE_KEY,'{broken');assert.equal(readStoredCity(s)?.raw,'{broken');assert.throws(()=>deserialize(readStoredCity(s)!.raw));assert.equal(readStoredCity(s,'backup')?.raw,v1);
});
