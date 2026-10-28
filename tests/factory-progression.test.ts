import test from 'node:test';
import assert from 'node:assert/strict';
import { factoryCropCapacity } from '../src/factory-levels.ts';
import { proposeCropPurchase, proposeRecipe } from '../src/agriculture.ts';
import { createCity, deserialize, serialize, step } from '../src/sim.ts';

test('factory capacity retains old tiers and adds two days of input storage per funded job', () => {
  assert.deepEqual(Array.from({length:9}, (_, i) => factoryCropCapacity(i + 1)), [24,24,24,28,32,36,40,44,48]);
  assert.throws(() => factoryCropCapacity(10));
});

test('expanded factory buys real input and processes once per worker with no extra multiplier', () => {
  const seller = {wallet:'firm:1', zone:'F' as const, cash:0, reservedCash:0, cropInventory:48, cropCost:0};
  const buyer = {wallet:'firm:2', zone:'I' as const, cash:20000, reservedCash:2000, cropInventory:0, cropCost:0, cropCapacity:48};
  const p = proposeCropPurchase(seller, buyer, {quantity:48});
  assert.equal(p.ok,true); assert.equal(p.cash,16800); assert.equal(p.nextSeller.cropInventory,0); assert.equal(p.nextBuyer.cropInventory,48);
  const r = proposeRecipe({...p.nextBuyer, inventory:0, productionTick:0}, {tick:1, workers:12, operational:true, cropCapacity:48});
  assert.deepEqual([r.quantity,r.outputQuantity,r.batches,r.next.cropInventory], [24,96,12,24]);
  assert.equal(proposeRecipe({...p.nextBuyer, inventory:0, productionTick:0}, {tick:1, workers:0, operational:true, cropCapacity:48}).outputQuantity,0);
  assert.equal(proposeRecipe({...p.nextBuyer, inventory:0, productionTick:0}, {tick:1, workers:12, operational:false, cropCapacity:48}).outputQuantity,0);
});

test('new level save roundtrip preserves firm identity and old envelope still rejects a new level', () => {
  const city = createCity(61025); for (let day=0; day<90; day++) step(city);
  const f = city.firms.find(f=>f.zone==='I')!; assert.ok(f);
  const b = city.buildings.find(b=>b.id===f.building)!; b.level=9;
  const before = structuredClone(f); const saved = JSON.parse(serialize(city));
  const loaded = deserialize(JSON.stringify(saved));
  assert.deepEqual(loaded.firms.find(x=>x.id===f.id),before);
  assert.equal(loaded.buildings.find(x=>x.id===b.id)?.level,9);
  saved.version=15; saved.rulesVersion='chain-10'; delete saved.factoryProgressionStartTick;
  assert.throws(()=>deserialize(JSON.stringify(saved)));
});

test('first upgraded save backs up exact old bytes before overwriting', async () => {
  const { SAVE_KEY, FACTORY_PROGRESS_BACKUP_KEY, saveStoredCity } = await import('../src/save-storage.ts');
  const data = new Map<string,string>();
  const storage = {getItem:(k:string)=>data.get(k) ?? null, setItem:(k:string,v:string)=>{data.set(k,v)}};
  const old = JSON.stringify({version:15, rulesVersion:'chain-10', parks:[]});
  const next = JSON.stringify({version:17, rulesVersion:'chain-12', parks:[]});
  storage.setItem(SAVE_KEY,old); saveStoredCity(storage,next,null);
  assert.equal(storage.getItem(FACTORY_PROGRESS_BACKUP_KEY),old); assert.equal(storage.getItem(SAVE_KEY),next);
});
