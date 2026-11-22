import test from 'node:test';
import assert from 'node:assert/strict';
import { createCity, step, serialize, deserialize, farmCrop, firmCapacity, firmCropStore, firmWorkerCount, goodsUnit, selectFarmCrop, selectFactoryRecipe, type City } from '../src/sim.ts';
import { REAL_CROPS, realLotsPerYear, realHarvest, realFarmStore, millJobsFor, millLotsPerWorker, bagsToday } from '../src/industry-scale.ts';
import { keepSupplied } from './plants.ts';

const CANE = REAL_CROPS.sugarcane;

test('a 100-rai cane field yields its real tonnes a year and spoils if left: three days in the yard', () => {
  // 100 rai × 9 t a rai is 900 t a year at level 2, in 56 kg lots.
  assert.equal(realLotsPerYear(CANE, 2), Math.floor(100 * 9000 / 56));
  for (let level = 1; level <= 6; level++) {
    let year = 0; for (let tick = 0; tick < 365; tick++) year += realHarvest(CANE, level, tick, CANE.hands[level - 1]);
    assert.equal(year, realLotsPerYear(CANE, level), `level ${level}`);
  }
  assert.equal(realFarmStore(CANE, 3), Math.ceil(realLotsPerYear(CANE, 3) / 365 * 3));
  // A 56 kg lot at 350 satang is 1.16 baht a kilo at the game's wage scale: the real 1,160 baht a tonne of cane.
  assert.equal(Math.round(350 * 18.5 / 100 / 56 * 1000), 1156);
});

test('a sugar mill crushes 25 t a worker a day, 107 kg of sugar a tonne, and people eat 30 kg a year', () => {
  assert.deepEqual(CANE.millTonnesPerDay.map((_, i) => millJobsFor(CANE, i + 1)), [1, 2, 4, 10, 20, 40, 100, 200, 400]);
  assert.equal(millLotsPerWorker(CANE), Math.floor(25_000 / 56));
  // Two 56 kg lots (112 kg of cane) give 12 kg of sugar: 107 kg a tonne.
  assert.equal(Math.round(CANE.batchGoods / (2 * CANE.kgPerLot) * 1000), 107);
  let year = 0; for (let tick = 0; tick < 365; tick++) year += bagsToday(CANE, 1, tick);
  assert.equal(year, 29, 'about 30 kg a person a year, in whole kilo bags');
});

/** The starter city turned to cane: its farm grows sugarcane and its factory crushes it. */
function caneCity(days: number): City {
  const c = createCity(61025);
  for (let d = 0; d < days; d++) {
    step(c); keepSupplied(c);
    for (const f of c.firms) {
      if (f.zone === 'F' && farmCrop(c, f) !== 'sugarcane') assert.equal(selectFarmCrop(c, f.id, 'sugarcane').ok, true);
      if (f.zone === 'I' && f.recipe !== 'sugar-mill') assert.equal(selectFactoryRecipe(c, f.id, 'sugar-mill').ok, true);
    }
  }
  return c;
}

test('in a new city cane goes from the field to the sugar mill, and households buy sugar by the kilo', { timeout: 300_000 }, () => {
  const c = caneCity(120), recent = <T extends { tick: number }>(list: T[]) => list.filter(e => e.tick > c.tick - 30);
  const farm = c.firms.find(f => f.zone === 'F')!, mill = c.firms.find(f => f.zone === 'I')!;
  const farmBuilding = c.buildings.find(b => b.id === farm.building)!, millBuilding = c.buildings.find(b => b.id === mill.building)!;
  assert.equal(farmCrop(c, farm), 'sugarcane'); assert.equal(mill.recipe, 'sugar-mill');
  assert.equal(firmCapacity(farmBuilding, farm, c), CANE.hands[farmBuilding.level - 1]);
  assert.equal(firmCapacity(millBuilding, mill, c), millJobsFor(CANE, millBuilding.level));
  assert.ok(farm.cropInventory <= firmCropStore(farmBuilding, farm, c));
  const milled = recent(c.cropLedger).filter(e => e.kind === 'process' && e.from === mill.wallet);
  assert.ok(milled.length > 0);
  for (const e of milled) { assert.equal(e.outputQuantity, e.batches * CANE.batchGoods); assert.ok(e.batches <= e.workers * Math.floor(millLotsPerWorker(CANE) / 2)); }
  const eaten = recent(c.goodsLedger).filter(e => e.reason === 'Household final consumption' && e.product === 'sugar');
  assert.ok(eaten.length > 0, 'households bought sugar');
  // A household that has since left is not checked (its size is gone with it).
  for (const e of eaten) { const h = c.households.find(h => h.wallet === e.to); if (h) assert.ok(e.quantity <= bagsToday(CANE, h.members, e.tick)); }
  assert.equal(goodsUnit(c, 'sugar', 'retail'), CANE.prices.retail);
  // The town's one field is a fraction of a mill's day: the mill buys the rest of its cane from outside and pays its way.
  assert.ok(recent(c.cropLedger).some(e => e.kind === 'import' && e.to === mill.wallet), 'the mill buys cane from outside');
  assert.ok(firmWorkerCount(c, mill.id) >= 1 && (c.accounts[mill.wallet] ?? 0) > 0, 'and pays its way');
  assert.equal(Object.values(c.accounts).reduce((a, b) => a + b, 0), 0);
  assert.deepEqual(deserialize(serialize(c)), c, 'the save validates real cane harvests, crushing and kilo sales');
});

test('a shop keeps about a week of the kilos the town eats, and at least a bag for each household', { timeout: 300_000 }, () => {
  const c = createCity(61025); for (let d = 0; d < 120; d++) { step(c); keepSupplied(c); }
  const people = c.households.reduce((n, h) => n + h.members, 0), week = (g: number) => Math.max(1, c.households.length, Math.ceil(people * g * 7 / 1000));
  for (const shop of c.firms.filter(f => f.zone === 'C')) {
    assert.ok(shop.products['milled-rice'] <= week(REAL_CROPS.rice.gramsPerPersonDay));
    assert.ok(shop.products.sugar <= week(CANE.gramsPerPersonDay));
    assert.ok(shop.products['canned-food'] <= week(REAL_CROPS.vegetables.gramsPerPersonDay));
  }
  assert.equal(c.migration.departures ?? 0, 0, 'the shop pays its way and nobody leaves');
});
