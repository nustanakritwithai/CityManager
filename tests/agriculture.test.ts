import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CROP_PRICES, CROP_STOCK_CAPS, CROP_RECIPE, COMMODITIES, RESOURCE_CELL_COUNT, RESOURCE_VERSION, FERTILITY_THRESHOLD,
  createResourceMap, fertilityForCell, isCanonicalResourceMap, isViableFarmland, harvestYield,
  isSafeCount, safeAdd, safeMultiply, validCropHolding, releaseCropCost,
  proposeHarvest, proposeRecipe, cropPrice, validCropAccount, proposeCropPurchase, canHouseholdConsume, proposeCropConsumption,
  type CropAccount, type HouseholdAccount, type HarvestState, type RecipeState,
} from '../src/agriculture.ts';
const farm = (stock = 24, cost = 0, cash = 1000): CropAccount => ({ wallet: 'firm:1', zone: 'F', cropInventory: stock, cropCost: cost, cash, reservedCash: 0 });
const trader = (stock = 0, cost = 0, cash = 10000): CropAccount => ({ wallet: 'firm:2', zone: 'T', cropInventory: stock, cropCost: cost, cash, reservedCash: 0 });
const factory = (stock = 0, cost = 0, cash = 10000): CropAccount => ({ wallet: 'firm:3', zone: 'I', cropInventory: stock, cropCost: cost, cash, reservedCash: 0 });
const family = (cash = 1000, lastPurchaseTick = -1): HouseholdAccount => ({ wallet: 'household:4', cash, lastPurchaseTick });
const fresh = (): HarvestState => ({ cropInventory: 0, cropCost: 0, productionTick: 0 });
const recipe = (stock = 4, cost = 1200, inventory = 0): RecipeState => ({ cropInventory: stock, cropCost: cost, inventory, productionTick: 0 });

test('bounded agriculture catalog admits only crop and generic goods with explicit units and prices', () => {
  assert.deepEqual(CROP_PRICES, { farmToTrader: 150, traderToFactory: 300, farmToFactory: 350, householdCrop: 800 });
  assert.deepEqual(CROP_STOCK_CAPS, { F: 96, T: 48, I: 24 }); assert.deepEqual(CROP_RECIPE, { crop: 2, goods: 8 });
  assert.deepEqual(Object.keys(COMMODITIES), ['crop', 'goods']);
  assert.equal(COMMODITIES.crop.industrialInput, true); assert.equal(COMMODITIES.crop.directConsumable, true);
  assert.equal(COMMODITIES.goods.industrialInput, false); assert.equal(COMMODITIES.goods.directConsumable, true);
  assert.equal(RESOURCE_VERSION, 'fertility-1'); assert.equal(RESOURCE_CELL_COUNT, 576); assert.equal(FERTILITY_THRESHOLD, 50);
});

test('resource seed/cell generation has a fixed canonical vector and does not touch simulation RNG', () => {
  const city = { seed: 61025, rng: 998877, tick: 123 }, before = { ...city }, map = createResourceMap(city.seed);
  assert.deepEqual(map.fertility.slice(0, 12), [19, 53, 70, 90, 52, 41, 10, 17, 24, 5, 30, 50]);
  assert.deepEqual(map.fertility.slice(-6), [47, 80, 100, 92, 86, 82]);
  assert.equal(map.fertility.filter(isViableFarmland).length, 281); assert.deepEqual(city, before);
  assert.deepEqual(createResourceMap(61025), map);
  assert.equal(fertilityForCell(61025, 575), map.fertility[575]);
  assert.equal(isCanonicalResourceMap(map, 61025), true);
  assert.equal(isCanonicalResourceMap(JSON.parse(JSON.stringify(map)), 61025), true);
  for (const seed of [0, 1, 0xffffffff]) {
    const next = createResourceMap(seed); assert.equal(next.seed, seed); assert.equal(next.fertility.length, 576);
    assert.ok(next.fertility.every(n => Number.isSafeInteger(n) && n >= 0 && n <= 100));
    assert.equal(isCanonicalResourceMap(next, seed), true);
  }
  assert.notDeepEqual(createResourceMap(61024), map);
});

test('canonical validation rejects tampered, sparse, wrong-seed and malformed resource maps', () => {
  const map = createResourceMap(61025), changed = structuredClone(map); changed.fertility[7] = (changed.fertility[7] + 1) % 101;
  for (const bad of [null, {}, { ...map, version: 'other' }, { ...map, seed: 7 }, { ...map, fertility: new Array(576) }, { ...map, fertility: map.fertility.slice(1) }, changed]) assert.equal(isCanonicalResourceMap(bad, 61025), false);
  for (const bad of [-1, .2, NaN, Infinity, 0x100000000, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => createResourceMap(bad), RangeError); assert.equal(isCanonicalResourceMap(map, bad), false);
  }
  for (const bad of [-1, 576, .5, NaN]) assert.throws(() => fertilityForCell(61025, bad), RangeError);
});

test('fertility threshold and per-worker floor are explicit, not fractional harvest', () => {
  assert.equal(isViableFarmland(49), false); assert.equal(isViableFarmland(50), true); assert.equal(isViableFarmland(100), true);
  for (const bad of [-1, 100.5, 101, NaN, '90']) assert.equal(isViableFarmland(bad), false);
  assert.equal(harvestYield(50, 3), 36); assert.equal(harvestYield(54, 3), 36); assert.equal(harvestYield(99, 3), 69); assert.equal(harvestYield(100, 0), 0);
  assert.throws(() => harvestYield(101, 1), RangeError); assert.throws(() => harvestYield(100, Number.MAX_SAFE_INTEGER), RangeError);
});

test('daily harvest is immutable, worker-based, capped and same-tick idempotent', () => {
  const state = Object.freeze(fresh()), p = proposeHarvest(state, { tick: 1, workers: 3, fertility: 50, operational: true });
  assert.equal(p.ok, true); assert.equal(p.reason, 'harvested'); assert.equal(p.quantity, 36);
  assert.deepEqual(p.next, { cropInventory: 36, cropCost: 0, productionTick: 1 }); assert.deepEqual(state, fresh());
  const duplicate = proposeHarvest(p.next, { tick: 1, workers: 3, fertility: 50, operational: true });
  assert.equal(duplicate.ok, false); assert.equal(duplicate.reason, 'already-processed'); assert.deepEqual(duplicate.next, p.next); assert.equal(duplicate.quantity, 0);
  const stale = proposeHarvest(p.next, { tick: 0, workers: 3, fertility: 50, operational: true }); assert.equal(stale.reason, 'stale-tick'); assert.deepEqual(stale.next, p.next);
  const cap = proposeHarvest({ ...fresh(), cropInventory: 95 }, { tick: 1, workers: Number.MAX_SAFE_INTEGER, fertility: 100, operational: true });
  assert.equal(cap.quantity, 1); assert.equal(cap.next.cropInventory, 96);
});

test('blocked daily harvest stamps the attempt without fabricating stock or allowing same-day recovery', () => {
  const cases = [
    [{ tick: 1, workers: 1, fertility: 100, operational: false }, 'not-operational'],
    [{ tick: 1, workers: 0, fertility: 100, operational: true }, 'no-workers'],
    [{ tick: 1, workers: 2, fertility: 49, operational: true }, 'unsuitable-fertility'],
  ] as const;
  for (const [options, reason] of cases) {
    const p = proposeHarvest(fresh(), options); assert.equal(p.ok, true); assert.equal(p.reason, reason); assert.equal(p.quantity, 0); assert.equal(p.next.productionTick, 1); assert.equal(p.next.cropInventory, 0);
    assert.equal(proposeHarvest(p.next, { tick: 1, workers: 1, fertility: 100, operational: true }).reason, 'already-processed');
    assert.equal(proposeHarvest(p.next, { tick: 2, workers: 1, fertility: 100, operational: true }).quantity, 24);
  }
  const full = { cropInventory: 96, cropCost: 0, productionTick: 0 };
  assert.equal(proposeHarvest(full, { tick: 1, workers: 1, fertility: 100, operational: true }).reason, 'stock-cap');
});

test('weighted cost releases exact BigInt floor and leaves all rounding residual for the final lot', () => {
  assert.equal(releaseCropCost(5, 1001, 4), 800); assert.equal(releaseCropCost(1, 201, 1), 201); assert.equal(releaseCropCost(8, 0, 3), 0); assert.equal(releaseCropCost(0, 0, 0), 0);
  const max = Number.MAX_SAFE_INTEGER, a = releaseCropCost(3, max, 1), b = releaseCropCost(2, max - a, 1), c = releaseCropCost(1, max - a - b, 1);
  assert.equal(a, 3002399751580330); assert.equal(b, 3002399751580330); assert.equal(c, 3002399751580331); assert.equal(a + b + c, max);
  for (const args of [[1, 2, 2], [0, 1, 0], [-1, 0, 0], [1, .5, 1], [1, 1, .5]]) assert.throws(() => releaseCropCost(...args as [number, number, number]), RangeError);
});

test('recipe consumes only whole available input and releases its acquisition value once', () => {
  const state = Object.freeze(recipe(5, 1001)), p = proposeRecipe(state, { tick: 1, workers: 2, operational: true });
  assert.equal(p.ok, true); assert.equal(p.reason, 'processed'); assert.equal(p.batches, 2); assert.equal(p.quantity, 4); assert.equal(p.outputQuantity, 16); assert.equal(p.costReleased, 800);
  assert.deepEqual(p.next, { cropInventory: 1, cropCost: 201, inventory: 16, productionTick: 1 }); assert.deepEqual(state, recipe(5, 1001));
  assert.equal(proposeRecipe(p.next, { tick: 1, workers: 2, operational: true }).reason, 'already-processed');
  const stopped = proposeRecipe(p.next, { tick: 2, workers: 2, operational: true }); assert.equal(stopped.reason, 'no-input'); assert.equal(stopped.outputQuantity, 0); assert.equal(stopped.next.inventory, 16);
  const recovered = proposeRecipe({ ...stopped.next, cropInventory: 3, cropCost: 801 }, { tick: 3, workers: 1, operational: true });
  assert.equal(recovered.batches, 1); assert.equal(recovered.outputQuantity, 8); assert.equal(recovered.next.cropInventory, 1); assert.equal(recovered.costReleased, 534);
});

test('recipes stop for missing input/labor/connection and respect safe output arithmetic', () => {
  assert.equal(proposeRecipe(recipe(0, 0), { tick: 1, workers: 1000, operational: true }).reason, 'no-input');
  assert.equal(proposeRecipe(recipe(), { tick: 1, workers: 0, operational: true }).reason, 'no-workers');
  assert.equal(proposeRecipe(recipe(), { tick: 1, workers: 1, operational: false }).reason, 'not-operational');
  const max = Number.MAX_SAFE_INTEGER;
  assert.equal(proposeRecipe(recipe(24, 100, max), { tick: 1, workers: max, operational: true }).reason, 'output-limit');
  const exact = proposeRecipe(recipe(24, 100, max - 8), { tick: 1, workers: max, operational: true });
  assert.equal(exact.batches, 1); assert.equal(exact.next.inventory, max); assert.equal(exact.quantity, 2);
  assert.equal(proposeRecipe(recipe(24, 100, max - 7), { tick: 1, workers: max, operational: true }).outputQuantity, 0);
});

test('invalid daily inputs return unchanged copies with zero physical/value output', () => {
  for (const bad of [{ ...fresh(), cropInventory: 97 }, { ...fresh(), cropCost: 1 }, { ...fresh(), productionTick: -1 }]) {
    const p = proposeHarvest(bad, { tick: 1, workers: 1, fertility: 100, operational: true }); assert.equal(p.ok, false); assert.equal(p.reason, 'invalid-input'); assert.deepEqual(p.next, bad); assert.equal(p.quantity, 0);
  }
  for (const bad of [-1, .5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(proposeHarvest(fresh(), { tick: 1, workers: bad, fertility: 100, operational: true }).ok, false);
    assert.equal(proposeRecipe(recipe(), { tick: bad, workers: 1, operational: true }).ok, false);
  }
  assert.equal(proposeRecipe({ ...recipe(), inventory: -1 }, { tick: 1, workers: 1, operational: true }).ok, false);
});

test('only admitted posted-price channels can purchase crops; no trader arbitrage or input imports', () => {
  assert.equal(cropPrice('I', 'T'), 150); assert.equal(cropPrice('F', 'T'), 150); assert.equal(cropPrice('T', 'I'), 300); assert.equal(cropPrice('F', 'I'), 350);
  for (const [a, b] of [['F', 'F'], ['T', 'T'], ['T', 'F'], ['I', 'F'], ['I', 'I']] as const) assert.equal(cropPrice(a, b), null);
  assert.equal(proposeCropPurchase(farm(), trader(), { quantity: 4 }).cash, 600);
  assert.equal(proposeCropPurchase(trader(8, 1200), factory(), { quantity: 4 }).cash, 1200);
  assert.equal(proposeCropPurchase(farm(), factory(), { quantity: 4 }).cash, 1400);
  assert.equal(proposeCropPurchase(trader(8, 1200), { ...trader(), wallet: 'firm:9' }, { quantity: 1 }).reason, 'invalid-channel');
  assert.equal(proposeCropPurchase(farm(), { ...trader(), wallet: 'firm:1' }, { quantity: 1 }).reason, 'same-counterparty');
});

test('crop purchase capitalizes buyer stock and recognizes only seller realised margin', () => {
  const seller = Object.freeze(trader(8, 1201)), buyer = Object.freeze(factory()), p = proposeCropPurchase(seller, buyer, { quantity: 3, sellableLimit: 8 });
  assert.equal(p.ok, true); assert.equal(p.cash, 900); assert.equal(p.fromValue, 450); assert.equal(p.toValue, 900);
  assert.equal(p.sellerRevenue, 900); assert.equal(p.sellerExpense, 450); assert.equal(p.margin, 450); assert.equal(p.buyerExpense, 0);
  assert.deepEqual(p.nextSeller, { ...seller, cropInventory: 5, cropCost: 751, cash: seller.cash + 900 });
  assert.deepEqual(p.nextBuyer, { ...buyer, cropInventory: 3, cropCost: 900, cash: buyer.cash - 900 });
  assert.equal(seller.cropInventory, 8); assert.equal(buyer.cropInventory, 0);
});

test('stock, sellable snapshot, cash and capacity failures are atomic and preserve wage reserves', () => {
  const seller = Object.freeze(farm(4)), buyer = Object.freeze({ ...trader(), reservedCash: 9800 });
  const cases = [[5, 5, 'insufficient-stock'], [2, 1, 'sellable-limit'], [2, 4, 'insufficient-cash']] as const;
  for (const [quantity, sellableLimit, reason] of cases) {
    const p = proposeCropPurchase(seller, buyer, { quantity, sellableLimit });
    assert.equal(p.ok, false); assert.equal(p.reason, reason); assert.deepEqual(p.nextSeller, seller); assert.deepEqual(p.nextBuyer, buyer); assert.equal(p.cash, 0); assert.equal(p.fromValue, 0); assert.equal(p.quantity, 0);
  }
  const cap = proposeCropPurchase(farm(4), factory(23, 3000), { quantity: 2 }); assert.equal(cap.reason, 'capacity');
  const exact = proposeCropPurchase(farm(4), { ...trader(), cash: 400, reservedCash: 100 }, { quantity: 2 });
  assert.equal(exact.ok, true); assert.equal(exact.nextBuyer.cash, 100); assert.equal(exact.nextBuyer.reservedCash, 100);
});

test('cash or acquisition-value overflow rejects before any stock/value/cash mutation', () => {
  const max = Number.MAX_SAFE_INTEGER;
  const cash = proposeCropPurchase(farm(1, 0, max), trader(), { quantity: 1 }); assert.equal(cash.reason, 'overflow'); assert.equal(cash.nextSeller.cash, max); assert.equal(cash.nextSeller.cropInventory, 1);
  const cost = proposeCropPurchase(farm(1), factory(1, max), { quantity: 1 }); assert.equal(cost.reason, 'overflow'); assert.equal(cost.nextBuyer.cropCost, max); assert.equal(cost.nextBuyer.cropInventory, 1);
  for (const quantity of [0, -1, .1, NaN, Infinity, max + 1]) assert.equal(proposeCropPurchase(farm(), trader(), { quantity }).reason, 'invalid-input');
});

test('unknown or industrial-only metadata cannot be used as a household basket', () => {
  assert.equal(canHouseholdConsume('crop'), true); assert.equal(canHouseholdConsume('goods'), true);
  assert.equal(canHouseholdConsume(COMMODITIES.crop), true); assert.equal(canHouseholdConsume(COMMODITIES.goods), true);
  for (const bad of ['ore', 'outside', 'constructor', null, {}, { id: 'ore', unit: 'crop lot', industrialInput: true, directConsumable: true }, { ...COMMODITIES.crop, directConsumable: false }, { ...COMMODITIES.crop, unit: 'ore' }]) {
    assert.equal(canHouseholdConsume(bad), false);
    assert.equal(proposeCropConsumption(trader(1, 150), family(), { tick: 3, sellableLimit: 1, commodity: bad }).reason, 'not-consumable');
  }
  assert.equal(proposeCropConsumption(trader(1, 150), family(), { tick: 3, sellableLimit: 1, commodity: 'goods' }).reason, 'wrong-commodity', 'Generic goods use their own canonical inventory path');
});

test('direct crop consumption debits the shared household wallet and exact trader stock/cost', () => {
  const seller = Object.freeze(trader(3, 451)), buyer = Object.freeze(family()), p = proposeCropConsumption(seller, buyer, { tick: 5, sellableLimit: 3 });
  assert.equal(p.ok, true); assert.equal(p.reason, 'consumed'); assert.equal(p.quantity, 1); assert.equal(p.cash, 800); assert.equal(p.fromValue, 150); assert.equal(p.toValue, 0); assert.equal(p.margin, 650);
  assert.deepEqual(p.nextTrader, { ...seller, cropInventory: 2, cropCost: 301, cash: seller.cash + 800 });
  assert.deepEqual(p.nextHousehold, { ...buyer, cash: 200, lastPurchaseTick: 5 }); assert.equal(buyer.cash, 1000);
  const duplicate = proposeCropConsumption(p.nextTrader, p.nextHousehold, { tick: 5, sellableLimit: 2 }); assert.equal(duplicate.reason, 'already-consumed'); assert.equal(duplicate.quantity, 0);
  const genericAlreadySatisfied = proposeCropConsumption(seller, family(1000, 5), { tick: 5, sellableLimit: 3 }); assert.equal(genericAlreadySatisfied.reason, 'already-consumed');
});

test('direct household sales require trader stock, old-day sellable quantity and actual cash', () => {
  assert.equal(proposeCropConsumption(farm(1), family(), { tick: 2, sellableLimit: 1 }).reason, 'invalid-channel');
  assert.equal(proposeCropConsumption(trader(), family(), { tick: 2, sellableLimit: 1 }).reason, 'insufficient-stock');
  assert.equal(proposeCropConsumption(trader(1, 150), family(), { tick: 2, sellableLimit: 0 }).reason, 'sellable-limit');
  assert.equal(proposeCropConsumption(trader(1, 150), family(799), { tick: 2, sellableLimit: 1 }).reason, 'insufficient-cash');
  const p = proposeCropConsumption(trader(1, 150), family(800), { tick: 2, sellableLimit: 1 });
  assert.equal(p.ok, true); assert.equal(p.nextTrader.cropCost, 0); assert.equal(p.nextTrader.cropInventory, 0); assert.equal(p.nextHousehold.cash, 0);
});

test('a fresh trader acquisition cannot be resold in the same tick through either customer path', () => {
  const start = trader(), buying = proposeCropPurchase(farm(24), start, { quantity: 24 });
  assert.equal(buying.ok, true); assert.equal(buying.nextBuyer.cropInventory, 24);
  assert.equal(proposeCropPurchase(buying.nextBuyer, factory(), { quantity: 2, sellableLimit: start.cropInventory }).reason, 'sellable-limit');
  assert.equal(proposeCropConsumption(buying.nextBuyer, family(), { tick: 3, sellableLimit: start.cropInventory }).reason, 'sellable-limit');
  assert.equal(proposeCropPurchase(buying.nextBuyer, factory(), { quantity: 2, sellableLimit: buying.nextBuyer.cropInventory }).ok, true, 'Next day has a new snapshot');
});

test('factory and household compete for the same trader pool without duplicated availability', () => {
  const seller = trader(2, 300), first = proposeCropPurchase(seller, factory(), { quantity: 1, sellableLimit: 2 });
  const second = proposeCropConsumption(first.nextSeller, family(), { tick: 4, sellableLimit: 1 });
  assert.equal(first.ok, true); assert.equal(second.ok, true); assert.equal(second.nextTrader.cropInventory, 0); assert.equal(second.nextTrader.cropCost, 0);
  const third = proposeCropPurchase(second.nextTrader, { ...factory(), wallet: 'firm:8' }, { quantity: 1, sellableLimit: 0 });
  assert.equal(third.ok, false); assert.equal(third.quantity, 0);
  assert.equal(first.quantity + second.quantity, seller.cropInventory);
  assert.equal(first.fromValue + second.fromValue, seller.cropCost);
});

test('harvest to trader to factory and household conserves crop quantities, cash and book value', () => {
  const harvest = proposeHarvest(fresh(), { tick: 1, workers: 1, fertility: 100, operational: true });
  const f = { ...farm(), ...harvest.next }, t = trader(), i = factory(), h = family();
  const initialMoney = f.cash + t.cash + i.cash + h.cash;
  const a = proposeCropPurchase(f, t, { quantity: 24 }), b = proposeCropPurchase(a.nextBuyer, i, { quantity: 4, sellableLimit: 24 });
  const c = proposeRecipe({ ...recipe(), cropInventory: b.nextBuyer.cropInventory, cropCost: b.nextBuyer.cropCost }, { tick: 2, workers: 2, operational: true });
  const d = proposeCropConsumption(b.nextSeller, h, { tick: 2, sellableLimit: 20 });
  assert.ok([a.ok, b.ok, c.ok, d.ok].every(Boolean));
  assert.equal(a.nextSeller.cropInventory + d.nextTrader.cropInventory + c.next.cropInventory + c.quantity + d.quantity, harvest.quantity);
  assert.equal(a.nextSeller.cash + d.nextTrader.cash + b.nextBuyer.cash + d.nextHousehold.cash, initialMoney);
  assert.equal(c.costReleased, 1200); assert.equal(c.outputQuantity, 16);
  assert.equal(d.fromValue, 150); assert.equal(d.nextTrader.cropCost, 2850);
  assert.equal(b.nextSeller.cropCost + b.fromValue, a.nextBuyer.cropCost);
  assert.equal(a.buyerExpense + b.buyerExpense, 0);
});

test('safe counts, stock invariants and account identities reject malformed or ambiguous values', () => {
  assert.equal(safeAdd(1, 2), 3); assert.equal(safeMultiply(3, 8), 24);
  assert.equal(isSafeCount(-1), false); assert.equal(isSafeCount(-1, -1), true); assert.equal(isSafeCount('2'), false);
  assert.throws(() => safeAdd(Number.MAX_SAFE_INTEGER, 1), RangeError); assert.throws(() => safeMultiply(Number.MAX_SAFE_INTEGER, 2), RangeError);
  assert.equal(validCropHolding({ cropInventory: 0, cropCost: 1 }, 96), false); assert.equal(validCropHolding({ cropInventory: 1, cropCost: 0 }, 96), true);
  for (const bad of [{ ...farm(), wallet: 'outside' }, { ...farm(), wallet: 'firm:01' }, { ...farm(), wallet: 'firm:9007199254740993' }, { ...farm(), reservedCash: 1001 }, { ...farm(), cropInventory: 97 }, { ...farm(), cropCost: .5 }, null]) assert.equal(validCropAccount(bad), false);
  const p = proposeCropConsumption(trader(1, 150), family(1000, 9), { tick: 8, sellableLimit: 1 }); assert.equal(p.reason, 'invalid-input'); assert.equal(p.nextHousehold.lastPurchaseTick, 9);
});
