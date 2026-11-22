import test from 'node:test';
import assert from 'node:assert/strict';
import { createCity, step, serialize, deserialize, farmCrop, firmCapacity, firmCropStore, firmWorkerCount, goodsUnit, type City } from '../src/sim.ts';
import {
  KG_PER_LOT, RAI_PER_FARM_TILE, RICE_KG_PER_RAI, RICE_CROPS_PER_YEAR, riceLotsPerYear, riceHarvest, riceFarmHands, riceFarmStore,
  millJobs, MILL_TONNES_PER_DAY, MILL_LOTS_PER_WORKER, REAL_RICE_RECIPE, riceBagsToday, RICE_GRAMS_PER_PERSON_DAY, RICE_PRICE,
} from '../src/industry-scale.ts';
import { REAL_CROPS } from '../src/industry-scale.ts';
import { keepSupplied } from './plants.ts';
import { legacySizes } from './legacy-sizes.ts';

test('a 100-rai paddy harvests the real Thai yield: 413 kg a rai a crop, one to three crops a year by level', () => {
  assert.equal(RAI_PER_FARM_TILE, 100); assert.equal(KG_PER_LOT, 10);
  assert.deepEqual([1, 2, 3].map(l => RICE_KG_PER_RAI[l - 1] * RICE_CROPS_PER_YEAR[l - 1]), [413, 826, 1239]);
  for (let level = 1; level <= 6; level++) {
    let year = 0; for (let tick = 0; tick < 365; tick++) year += riceHarvest(level, tick, riceFarmHands(level));
    assert.equal(year, Math.floor(riceLotsPerYear(level)), `level ${level}: a full year adds up to the real total`);
  }
  // 100 rai × 413 kg × 2 crops = 82,600 kg a year, about 226 kg a day.
  assert.equal(riceLotsPerYear(2) * KG_PER_LOT, 82_600);
  // Fewer hands than the farm needs harvest that share less.
  let half = 0; for (let tick = 0; tick < 365; tick++) half += riceHarvest(2, tick, 1);
  assert.equal(half, Math.floor(riceLotsPerYear(2) / 2));
  assert.deepEqual([1, 2, 3, 4].map(riceFarmHands), [1, 2, 3, 3], 'a hand for each crop a year');
  assert.equal(riceFarmStore(2), Math.ceil(riceLotsPerYear(2) / 365 * 60), 'the yard holds sixty days');
});

test('a rice mill mills two tonnes a worker a day into 65% milled rice, sized from community to medium mills', () => {
  assert.deepEqual(MILL_TONNES_PER_DAY.map((_, i) => millJobs(i + 1)), [1, 3, 5, 10, 15, 20, 30, 40, 50]);
  assert.equal(MILL_LOTS_PER_WORKER * KG_PER_LOT, 2_000);
  assert.equal(REAL_RICE_RECIPE.goods / (REAL_RICE_RECIPE.crop * KG_PER_LOT), .65);
});

test('people eat 200 g of rice a day and buy it in whole kilo bags, so over time they buy exactly what they eat', () => {
  assert.equal(RICE_GRAMS_PER_PERSON_DAY, 200);
  for (const members of [1, 3, 5]) {
    let bought = 0; for (let tick = 0; tick < 365; tick++) bought += riceBagsToday(members, tick);
    assert.equal(bought, Math.floor(members * .2 * 365));
  }
});

/** A new city run with the gateway contract topped up, so the rice chain is what limits it. */
function grown(days: number, city = createCity(61025)): City { for (let d = 0; d < days; d++) { step(city); keepSupplied(city); } return city; }
const since = (c: City, days: number) => <T extends { tick: number }>(list: T[]) => list.filter(e => e.tick > c.tick - days);

test('in a new city the rice farm, the mill and the households move real kilos and pay real kilo prices', { timeout: 300_000 }, () => {
  const c = grown(120), recent = since(c, 30);
  const farm = c.firms.find(f => f.zone === 'F' && farmCrop(c, f) === 'rice')!, mill = c.firms.find(f => f.zone === 'I' && f.recipe === 'rice-mill')!;
  assert.ok(farm && mill, 'the starter city grows and mills rice');
  const farmBuilding = c.buildings.find(b => b.id === farm.building)!, millBuilding = c.buildings.find(b => b.id === mill.building)!;
  assert.equal(firmCapacity(farmBuilding, farm, c), riceFarmHands(farmBuilding.level));
  assert.equal(firmCapacity(millBuilding, mill, c), millJobs(millBuilding.level));
  assert.ok(firmWorkerCount(c, mill.id) <= millJobs(millBuilding.level));
  assert.ok(farm.cropInventory <= firmCropStore(farmBuilding, farm, c));
  // Every harvest this month is the farm's level share of the year.
  for (const e of recent(c.cropLedger).filter(e => e.kind === 'harvest' && e.to === farm.wallet)) assert.ok(e.quantity <= Math.ceil(riceLotsPerYear(farmBuilding.level) / 365));
  // Every milling turns 2 lots into 13 kg, at most 100 batches a worker.
  for (const e of recent(c.cropLedger).filter(e => e.kind === 'process' && e.from === mill.wallet)) {
    assert.equal(e.quantity, e.batches * REAL_RICE_RECIPE.crop); assert.equal(e.outputQuantity, e.batches * REAL_RICE_RECIPE.goods);
    assert.ok(e.batches <= e.workers * MILL_LOTS_PER_WORKER / REAL_RICE_RECIPE.crop);
  }
  // Households buy the kilos they eat, at the kilo price.
  const eaten = recent(c.goodsLedger).filter(e => e.reason === 'Household final consumption' && e.product === 'milled-rice');
  assert.ok(eaten.length > 0, 'households bought rice');
  for (const e of eaten) {
    const h = c.households.find(x => x.wallet === e.to)!;
    assert.ok(e.quantity <= riceBagsToday(h.members, e.tick));
  }
  const paid = recent(c.ledger).filter(e => /^Household #\d+ purchase$/.test(e.reason) && eaten.some(g => g.tick === e.tick && g.to === e.from && g.from === e.to));
  assert.ok(paid.some(e => e.amount % RICE_PRICE.retail === 0));
  assert.equal(goodsUnit(c, 'milled-rice', 'retail'), RICE_PRICE.retail);
  assert.equal(goodsUnit(c, 'canned-food', 'retail'), REAL_CROPS.vegetables.prices.retail, 'canned food is sold by the kilo too');
  assert.equal(Object.values(c.accounts).reduce((a, b) => a + b, 0), 0);
  assert.deepEqual(deserialize(serialize(c)), c, 'the save validates the real harvests, milling and kilo sales');
});

test('a mill short of the town\'s paddy buys the rest from outside at the farm price, and pays its way', { timeout: 300_000 }, () => {
  const c = grown(240), mill = c.firms.find(f => f.zone === 'I' && f.recipe === 'rice-mill')!, b = c.buildings.find(x => x.id === mill.building)!;
  // One rice farm's paddy is a fraction of a two-tonne day: the mill buys what it lacks from outside, after the town's.
  const imports = c.cropLedger.filter(e => e.kind === 'import' && e.to === mill.wallet);
  assert.ok(imports.length > 0);
  for (const e of imports) { assert.equal(e.crop, 'rice'); assert.equal(e.cash, e.quantity * 350); assert.equal(e.toValue, e.cash); }
  const bought = c.cropLedger.filter(e => e.kind === 'trade' && e.to === mill.wallet), farm = c.firms.find(f => f.zone === 'F')!;
  assert.ok(bought.some(e => e.from === farm.wallet), 'the town farm still sells its paddy to the mill');
  assert.ok(mill.cropInventory <= firmCropStore(b, mill, c));
  assert.ok(firmWorkerCount(c, mill.id) <= millJobs(b.level));
  assert.ok((c.accounts[mill.wallet] ?? 0) > 0, 'and pays its way');
  assert.equal(c.crops.imported, c.cropLedger.filter(e => e.kind === 'import').reduce((n, e) => n + e.quantity, 0) + (c.history?.cropTotals.imported ?? 0));
});

test('a city saved before real rice keeps its old farms, mills and basket prices', { timeout: 300_000 }, () => {
  const c = grown(90, legacySizes(createCity(61025)));
  assert.equal(goodsUnit(c, 'milled-rice', 'retail'), 800);
  const farm = c.firms.find(f => f.zone === 'F')!, b = c.buildings.find(x => x.id === farm.building)!;
  assert.equal(firmCapacity(b, farm, c), b.level, 'one farm worker a level');
  for (const e of c.cropLedger.filter(e => e.kind === 'process')) assert.equal(e.outputQuantity, e.batches * 8);
  assert.equal(c.goodsLedger.filter(e => e.reason === 'Household final consumption').every(e => e.quantity >= 1), true);
  assert.deepEqual(deserialize(serialize(c)), c);
});
