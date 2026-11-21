import test from 'node:test';
import assert from 'node:assert/strict';
import { createCity, step, serialize, deserialize, farmCrop, firmCapacity, firmCropStore, goodsUnit, selectFarmCrop, selectFactoryRecipe, OTHER_SPENDING, OTHER_GOODS_BOUGHT_IN, OTHER_SPENDING_REASON, type City } from '../src/sim.ts';
import { REAL_CROPS, realLotsPerYear, realHarvest, realFarmStore, millJobsFor, millLotsPerWorker, bagsToday } from '../src/industry-scale.ts';
import { keepSupplied } from './plants.ts';
import { legacyIndustry } from './legacy-sizes.ts';

const VEG = REAL_CROPS.vegetables;

test('a 100-rai vegetable field yields its real kilos, crop after crop, and keeps three days', () => {
  // 100 rai × 1,200 kg × 3 crops is 360 t a year at level 1, in 4 kg lots.
  assert.equal(realLotsPerYear(VEG, 1), 100 * 1200 * 3 / 4);
  for (let level = 1; level <= 6; level++) {
    let year = 0; for (let tick = 0; tick < 365; tick++) year += realHarvest(VEG, level, tick, VEG.hands[level - 1]);
    assert.equal(year, realLotsPerYear(VEG, level), `level ${level}`);
  }
  assert.equal(realFarmStore(VEG, 1), Math.ceil(realLotsPerYear(VEG, 1) / 365 * 3));
  // Hand work: about eight hands for each crop a year on 100 rai.
  assert.deepEqual(VEG.hands.slice(0, 3), [25, 33, 42]);
  // A 4 kg lot at 350 satang is 16 baht a kilo at the game's wage scale.
  assert.equal(Math.round(350 * 18.5 / 100 / 4), 16);
});

test('a cannery prepares half a tonne a worker a day, 10 kg of cans from 8 kg of vegetables, and people eat under 4 kg a year', () => {
  assert.deepEqual(VEG.millTonnesPerDay.map((_, i) => millJobsFor(VEG, i + 1)), [4, 10, 20, 40, 100, 200, 400, 600, 1000]);
  assert.equal(millLotsPerWorker(VEG), 125);
  assert.equal(VEG.batchGoods, 10);
  let year = 0; for (let tick = 0; tick < 365; tick++) year += bagsToday(VEG, 1, tick);
  assert.equal(year, 3);
  // A 425 g can at about 25 baht is 59 baht a kilo.
  assert.equal(Math.round(VEG.prices.retail * 18.5 / 100), 59);
});

function vegetableCity(days: number): City {
  const c = createCity(61025);
  for (let d = 0; d < days; d++) {
    step(c); keepSupplied(c);
    for (const f of c.firms) {
      if (f.zone === 'F' && farmCrop(c, f) !== 'vegetables') assert.equal(selectFarmCrop(c, f.id, 'vegetables').ok, true);
      if (f.zone === 'I' && f.recipe !== 'cannery') assert.equal(selectFactoryRecipe(c, f.id, 'cannery').ok, true);
    }
  }
  return c;
}

test('vegetables go from the field to the cannery and households buy canned food by the kilo', { timeout: 300_000 }, () => {
  const c = vegetableCity(150), farm = c.firms.find(f => f.zone === 'F')!, mill = c.firms.find(f => f.zone === 'I')!;
  const farmBuilding = c.buildings.find(b => b.id === farm.building)!, millBuilding = c.buildings.find(b => b.id === mill.building)!;
  assert.equal(firmCapacity(farmBuilding, farm, c), VEG.hands[farmBuilding.level - 1]);
  assert.equal(firmCapacity(millBuilding, mill, c), millJobsFor(VEG, millBuilding.level));
  assert.ok(farm.cropInventory <= firmCropStore(farmBuilding, farm, c));
  const canned = c.cropLedger.filter(e => e.kind === 'process' && e.from === mill.wallet);
  assert.ok(canned.length > 0);
  for (const e of canned) { assert.equal(e.outputQuantity, e.batches * VEG.batchGoods); assert.ok(e.batches <= e.workers * Math.floor(millLotsPerWorker(VEG) / 2)); }
  const eaten = c.goodsLedger.filter(e => e.reason === 'Household final consumption' && e.product === 'canned-food');
  assert.ok(eaten.length > 0, 'households bought canned food');
  for (const e of eaten) assert.ok(e.quantity <= bagsToday(VEG, c.households.find(h => h.wallet === e.to)!.members, e.tick));
  assert.equal(goodsUnit(c, 'canned-food', 'retail'), VEG.prices.retail);
  assert.equal(Object.values(c.accounts).reduce((a, b) => a + b, 0), 0);
  assert.deepEqual(deserialize(serialize(c)), c, 'the save validates real vegetable harvests, canning and kilo sales');
});

test('households spend the rest of their day at the shop, which buys those goods in from outside', { timeout: 300_000 }, () => {
  const c = createCity(61025); for (let d = 0; d < 90; d++) { step(c); keepSupplied(c); }
  const spent = c.ledger.filter(e => OTHER_SPENDING_REASON.test(e.reason)), bought = c.ledger.filter(e => e.reason === OTHER_GOODS_BOUGHT_IN);
  assert.ok(spent.length > 0, 'households spent at the shop');
  for (const e of spent) {
    const h = c.households.find(h => h.wallet === e.from), people = e.amount / OTHER_SPENDING.price;
    assert.ok(Number.isInteger(people) && people >= 1 && (!h || people <= h.members));
    const match = bought.filter(b => b.tick === e.tick && b.from === e.to).reduce((n, b) => n + b.amount, 0);
    assert.ok(match >= people * OTHER_SPENDING.boughtIn, 'the shop bought in what it sold');
    assert.ok(c.firms.find(f => f.wallet === e.to)?.zone === 'C');
  }
  // 7 baht a person a day, about 139 real baht: the survey's spending less housing, travel and the kilo foods.
  assert.equal(OTHER_SPENDING.price, 700);
  const raw = serialize(c), forged = (mutate: (x: any) => void) => { const x = JSON.parse(raw); mutate(x); return JSON.stringify(x); };
  assert.doesNotThrow(() => deserialize(raw));
  const lastSpent = (x: any) => x.ledger.findLast((e: any) => OTHER_SPENDING_REASON.test(e.reason));
  const lastBought = (x: any) => x.ledger.findLast((e: any) => e.reason === OTHER_GOODS_BOUGHT_IN);
  assert.throws(() => deserialize(forged(x => { const e = lastSpent(x); e.amount += OTHER_SPENDING.price; x.accounts[e.from] -= OTHER_SPENDING.price; x.accounts[e.to] += OTHER_SPENDING.price; })), 'a sale with no goods bought in for it');
  assert.throws(() => deserialize(forged(x => { const e = lastBought(x); e.amount -= 10; x.accounts[e.from] += 10; x.accounts.outside -= 10; })), 'goods bought in at the wrong price');
});

test('a city saved before keeps the daily basket: no other spending', { timeout: 300_000 }, () => {
  const c = legacyIndustry(createCity(61025)); for (let d = 0; d < 60; d++) { step(c); keepSupplied(c); }
  assert.equal(c.ledger.filter(e => OTHER_SPENDING_REASON.test(e.reason) || e.reason === OTHER_GOODS_BOUGHT_IN).length, 0);
  assert.ok(c.ledger.some(e => /^Household #\d+ purchase$/.test(e.reason) && e.amount % 800 === 0));
});
