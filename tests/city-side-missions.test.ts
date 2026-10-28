import test from 'node:test';
import assert from 'node:assert/strict';
import { CROPS, PRODUCTS, RECIPES } from '../src/goods.ts';
import { citySideMissions } from '../src/city-goals.ts';
import { MONTH, createCity, deserialize, farmCrop, serialize, step } from '../src/sim.ts';
import { keepSupplied } from './plants.ts';

test('a new city has three optional missions, with no instant wins', () => {
  const c = createCity(4418, { starter: false });
  const missions = citySideMissions(c);
  assert.deepEqual(missions.map(m => m.id), ['crop-diversity', 'recipe-diversity', 'basket-diversity']);
  assert.deepEqual(missions.map(m => m.current), [0, 0, 0]);
  assert.ok(missions.every(m => !m.done));
  assert.deepEqual(missions.map(m => m.target), [CROPS.length, RECIPES.length, PRODUCTS.length]);
});

test('consumption counts distinct products purchased in the latest 30 days only', () => {
  const c = createCity(4418, { starter: false });
  c.tick = MONTH * 2;
  const add = (tick: number, reason: string, product: typeof PRODUCTS[number]) =>
    c.goodsLedger.push({ tick, from: 'firm:1', to: 'household:1', quantity: 1, reason, product });
  add(30, 'Household final consumption', 'milled-rice'); // 30 days old, excluded
  add(31, 'Household final consumption', 'milled-rice');
  add(31, 'Household final consumption', 'milled-rice'); // not another variety
  add(60, 'Imported shop stock', 'sugar'); // not a household purchase
  assert.equal(citySideMissions(c)[2].current, 1);
  add(59, 'Household final consumption', 'sugar');
  add(60, 'Household final consumption', 'canned-food');
  assert.equal(citySideMissions(c)[2].current, 3);
  assert.equal(citySideMissions(c)[2].done, true);
  c.tick++;
  assert.equal(citySideMissions(c)[2].current, 2, 'old purchases roll out after 30 days');
});

test('missions read active firms and journals without changing or resaving the city', () => {
  const c = createCity(61025);
  for (let day = 0; day < 120; day++) { step(c); keepSupplied(c); }
  const save = serialize(c), missions = citySideMissions(c);
  assert.equal(serialize(c), save, 'reading missions must not mutate the city');
  const cropKinds = new Set(c.firms.filter(f => f.zone === 'F').map(f => farmCrop(c, f))).size;
  const recipeKinds = new Set(c.firms.filter(f => f.zone === 'I').map(f => f.recipe).filter(Boolean)).size;
  const purchaseKinds = new Set(c.goodsLedger.filter(e => e.tick > c.tick - MONTH && e.tick <= c.tick && e.reason === 'Household final consumption' && e.product).map(e => e.product)).size;
  assert.deepEqual(missions.map(m => m.current), [cropKinds, recipeKinds, purchaseKinds]);
  assert.deepEqual(citySideMissions(deserialize(save)), missions, 'loaded saves reproduce progress');
});
