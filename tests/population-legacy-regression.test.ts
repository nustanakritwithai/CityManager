import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {deserialize,serialize} from '../src/sim.ts';

const files=[['legacy-v1-day65.json','4e358e66acdfb55dcfd434aaf67be51ccea99c69fc5a2b9b44343035c16166d0'],['legacy-v2-day180.json','0c33c983c1e71063496f4a95b935c22647b972c0084d2ce98449b7e7b8c13475'],['legacy-v3-day180.json','59518ff5b7d2a7c7de52ef8cb8362ed387f91df67ffc09934c93e97f3a556693']] as const;
const originals=files.map(([f,hash])=>{const raw=readFileSync(new URL('./fixtures/'+f,import.meta.url),'utf8');assert.equal(createHash('sha256').update(raw).digest('hex'),hash);return raw;});
test('authentic v1 v2 v3 decode repeatedly without changing money, identities, goods, journals or original bytes',()=>{
 for(const raw of originals){
  const prior=JSON.parse(raw),city=deserialize(raw),again=deserialize(raw);
  assert.deepEqual(again,city);for(const key of ['accounts','ledger','goodsLedger','goods','seed','rng','tick','nextId'] as const)assert.deepEqual(city[key],prior[key],key);
  for(const old of prior.households){const h=city.households.find(x=>x.id===old.id)!;assert.ok(h);for(const key of ['home','wallet','lastPurchaseTick','needs'])assert.equal(h[key as 'home'],old[key],key);if(old.members!==undefined)for(const key of ['members','workforce','dependents','profile','origin'])assert.equal(h[key as 'members'],old[key],key);}
  for(const old of prior.firms){const f=city.firms.find(x=>x.id===old.id)!;assert.ok(f);for(const key of ['building','wallet','inventory','workDays'])assert.deepEqual(f[key as 'building'],old[key],key);}
  assert.equal(raw,JSON.stringify(prior));assert.deepEqual(deserialize(serialize(city)),city);
 }
});


test('corrupt serialized city is rejected without modifying authentic legacy originals',()=>{
 assert.throws(()=>deserialize('{broken'));
 for(const [index,raw] of originals.entries()) assert.equal(createHash('sha256').update(raw).digest('hex'),files[index][1]);
});
