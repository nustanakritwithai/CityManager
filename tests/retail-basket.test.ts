import test from 'node:test';
import assert from 'node:assert/strict';
import { createCity, step, isRetail, isMarket, bulldoze, deserialize, serialize, firmWorkerCount, type City } from '../src/sim.ts';
import { productPreference } from '../src/goods.ts';
import { householdFoodToday } from '../src/food-demand.ts';

/** A real newly opened shop; test procurement is fully paid and journaled before the next day. */
function fixture(level = 2, quantities = [1, 23]) {
  const city = createCity(61025); for (let day = 0; day < 22; day++) step(city);
  const shop = city.firms.find(isRetail)!, household = city.households[0];
  assert.ok(shop); assert.equal(shop.inventory, 0); assert.equal(household.members, 3);
  for (const market of city.firms.filter(isMarket)) assert.equal(bulldoze(city, city.buildings.find(b => b.id === market.building)!.cell).ok, true);
  const building = city.buildings.find(b => b.id === shop.building)!; building.level = level;
  const preferred = productPreference(household.id, city.tick + 1);
  for (const [product, quantity] of [[preferred[0], quantities[0]], [preferred[1], quantities[1]]] as const) {
    const amount = quantity * 450;
    city.accounts[shop.wallet] -= amount; city.accounts.outside += amount;
    city.ledger.push({ tick: city.tick, from: shop.wallet, to: 'outside', amount, reason: 'Outside goods import' });
    shop.monthlyExpense += amount; shop.products[product] += quantity; shop.inventory += quantity; city.goods.imported += quantity;
    city.goodsLedger.push({ tick: city.tick, from: 'outside', to: shop.wallet, quantity, reason: 'Imported shop stock', product });
  }
  assert.deepEqual(deserialize(serialize(city)), city, 'the pre-trade snapshot is valid, including money and typed stock');
  return { city, shop, household, building, preferred };
}

function assertConserved(city: City) {
  assert.equal(Object.values(city.accounts).reduce((sum, n) => sum + n, 0), 0);
  assert.equal(city.goods.produced + city.goods.imported - city.goods.consumed - city.goods.exported, city.firms.reduce((sum, firm) => sum + firm.inventory, 0));
  assert.deepEqual(deserialize(serialize(city)), city);
}

test('a household can complete one basket from several stocked products at the same shop', () => {
  for (const level of [2, 7]) {
    const { city, shop, household, building, preferred } = fixture(level), cash = city.accounts[household.wallet];
    const people = city.households.map(h => [h.id, h.members]), stock = shop.inventory;
    step(city);
    assert.ok(firmWorkerCount(city, shop.id) > 0);
    const sales = city.goodsLedger.filter(e => e.tick === city.tick && e.to === household.wallet && e.from === shop.wallet);
    assert.deepEqual(sales.map(e => [e.product, e.quantity]), [[preferred[0], 1], [preferred[1], 2]], `level ${level}`);
    assert.equal(city.accounts[household.wallet], cash - 3 * 800);
    assert.equal(householdFoodToday(city, household).purchased, 3); assert.equal(household.needs, 0);
    assert.ok(shop.inventory < stock); assert.equal(building.level, level);
    assert.deepEqual(city.households.map(h => [h.id, h.members]), people);
    const payments = city.ledger.filter(e => e.tick === city.tick && e.from === household.wallet && e.to === shop.wallet && e.reason === `Household #${household.id} purchase`);
    assert.deepEqual(payments.map(e => e.amount), [800, 1600]);
    assertConserved(city);
    // Loading and advancing cannot repeat the previous day's basket.
    const loaded = deserialize(serialize(city)); step(loaded);
    for (const h of loaded.households) assert.ok(householdFoodToday(loaded, h).purchased <= h.members);
    assert.equal(loaded.goodsLedger.filter(e => e.tick === city.tick && e.to === household.wallet).length, sales.length);
    assertConserved(loaded);
  }
});

test('mixed-product baskets stop at the actual household cash limit', () => {
  const { city, household } = fixture(), amount = city.accounts[household.wallet] - 1600;
  city.accounts[household.wallet] -= amount; city.accounts.outside += amount;
  city.ledger.push({ tick: city.tick, from: household.wallet, to: 'outside', amount, reason: 'Test household expense' });
  step(city);
  assert.equal(householdFoodToday(city, household).purchased, 2);
  assert.equal(city.accounts[household.wallet], 0); assert.ok(household.needs > 0);
  assertConserved(city);
});

test('an unstaffed shop cannot sell a basket just because stock is present', () => {
  const { city, shop, household } = fixture(7);
  // A city with only manufacturing specialists has no eligible owner or shop worker.
  for (const h of city.households) h.workerSkills = { general: 0, manufacturing: h.workforce, retail: 0 };
  const before = shop.inventory;
  step(city);
  assert.equal(firmWorkerCount(city, shop.id), 0); assert.equal(shop.inventory, before);
  assert.equal(householdFoodToday(city, household).purchased, 0);
  assertConserved(city);
});

test('mixed-product baskets stop at actual stock when the shop cannot restock', () => {
  const { city, shop, household } = fixture(2, [1, 1]), amount = city.accounts[shop.wallet];
  city.accounts[shop.wallet] = 0; city.accounts.outside += amount;
  city.ledger.push({ tick: city.tick, from: shop.wallet, to: 'outside', amount, reason: 'Test firm expense' });
  const cash = city.accounts[household.wallet];
  step(city);
  assert.equal(firmWorkerCount(city, shop.id), 1, 'owner still works the shelf without a wage');
  assert.equal(householdFoodToday(city, household).purchased, 2);
  assert.equal(city.accounts[household.wallet], cash - 1600);
  assert.equal(shop.inventory, 0); assert.ok(household.needs > 0);
  assertConserved(city);
});
