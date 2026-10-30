import test from 'node:test';
import assert from 'node:assert/strict';
import { createSaveService } from '../server/city-saves/service.mjs';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const owner = id(1), other = id(2), meta = {name:'City', population:10, tick:5};
const raw = '{ "version":999, "future": {"opaque":true} }';
function memoryStore() {
  let state = { instances: new Map(), snapshots: new Map(), requests: new Map() }, chain = Promise.resolve();
  return {
    async transaction(account, work) {
      const run = chain.then(async () => {
        const next = structuredClone(state), key = (city, revision) => `${city}:${revision}`;
        const db = {
          request: async rid => next.requests.get(`${account}:${rid}`),
          record: async (rid, hash, response) => next.requests.set(`${account}:${rid}`, {payloadHash:hash,response}),
          activeSlot: async slot => [...next.instances.values()].some(x => x.owner === account && !x.deleted && x.slot === slot),
          instance: async city => { const v=next.instances.get(city); if (!v || v.owner!==account) return null; const {owner:_, ...item}=v; return item; },
          create: async v => { if (next.instances.has(v.cityId)) throw Object.assign(Error('city-id-unavailable'),{status:409}); next.instances.set(v.cityId,{...v,owner:account}); },
          update: async v => next.instances.set(v.cityId,{...v,owner:account}),
          snapshot: async (city, revision, snapshot, metadata) => { if (next.snapshots.has(key(city,revision))) throw Error('snapshot already exists'); next.snapshots.set(key(city,revision),{raw:snapshot,metadata}); },
          latestSnapshot: async city => [...next.snapshots].filter(([k]) => k.startsWith(`${city}:`)).map(([k,v]) => [Number(k.split(':')[1]),v]).sort((a,b)=>b[0]-a[0])[0]?.[1]
        };
        const result=await work(db); state=next; return structuredClone(result);
      }); chain=run.catch(()=>{}); return run;
    },
    async list(account) { return [...state.instances.values()].filter(v=>v.owner===account); },
    async read(account, city) { const v=state.instances.get(city); if(!v||v.owner!==account) throw Object.assign(Error('save-not-found'),{status:404}); return {...v,...state.snapshots.get(`${city}:${v.revision}`)}; },
    snapshot(city, revision) { return state.snapshots.get(`${city}:${revision}`); }
  };
}
const create = (cityId,slot=1,snapshot=raw) => ({action:'create',cityId,slot,raw:snapshot,metadata:meta});

test('three slots, owner isolation and unknown-schema bytes', async () => {
  const store=memoryStore(), service=createSaveService(store);
  for(let n=1;n<=3;n++) await service.mutate(owner,id(10+n),create(id(20+n),n));
  assert.equal((await service.list(owner)).length,3); assert.equal((await service.list(other)).length,0);
  assert.equal((await service.read(owner,id(21))).raw,raw);
  await assert.rejects(service.read(other,id(21)),/save-not-found/);
  await assert.rejects(service.mutate(owner,id(40),create(id(24),1)),/slot-occupied/);
  await assert.rejects(service.mutate(owner,id(41),create(id(24),4)),/invalid-slot/);
});

test('lost response retry is idempotent, while conflicting reuse is rejected', async () => {
  const service=createSaveService(memoryStore()), command=create(id(21));
  const a=await service.mutate(owner,id(11),command), b=await service.mutate(owner,id(11),command);
  assert.deepEqual(a,b); assert.equal((await service.list(owner)).length,1);
  await assert.rejects(service.mutate(owner,id(11),{...command,slot:2}),/idempotency-mismatch/);
});

test('stale writes and delayed deleted-city writes cannot overwrite replacement', async () => {
  const store=memoryStore(), service=createSaveService(store), first=id(21), replacement=id(22);
  await service.mutate(owner,id(10),create(first));
  await service.mutate(owner,id(11),{action:'save',cityId:first,expectedRevision:1,raw:'{"version":999,"v":2}',metadata:meta});
  await assert.rejects(service.mutate(owner,id(12),{action:'save',cityId:first,expectedRevision:1,raw,metadata:meta}),/save-conflict/);
  await service.mutate(owner,id(13),{action:'delete',cityId:first,expectedRevision:2});
  await service.mutate(owner,id(14),create(replacement));
  await assert.rejects(service.mutate(owner,id(15),{action:'save',cityId:first,expectedRevision:2,raw,metadata:meta}),/save-conflict/);
  await assert.rejects(service.mutate(owner,id(16),{action:'restore',cityId:first,expectedRevision:3,slot:1}),/slot-occupied/);
  await service.mutate(owner,id(17),{action:'restore',cityId:first,expectedRevision:3,slot:2});
  assert.equal((await service.read(owner,replacement)).raw,raw);
  assert.equal(store.snapshot(first,1).raw,raw); assert.equal(store.snapshot(first,2).raw,'{"version":999,"v":2}');
});

test('concurrent writers allow one expected revision and journal identities cannot be cloned', async () => {
  const store=memoryStore(), service=createSaveService(store), city=id(21);
  await service.mutate(owner,id(10),create(city));
  const save = {action:'save',cityId:city,expectedRevision:1,raw,metadata:meta};
  const results=await Promise.allSettled([service.mutate(owner,id(11),save),service.mutate(owner,id(12),save)]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
  const journal=JSON.stringify({version:23,market:{version:10,cityId:city,guestId:owner}});
  await assert.rejects(service.mutate(owner,id(13),create(id(22),2,journal)),/market-identity-mismatch/);
  await assert.rejects(service.mutate(other,id(14),create(city,2,journal)),/market-identity-mismatch/);
});
