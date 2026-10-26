import test from 'node:test';
import assert from 'node:assert/strict';
import { MARKET_CONVERSION_COST, bulldoze, createCity, deserialize, firmCapacity, isMarket, isRetail, marketToConvert, serialize, step, type City } from '../src/sim.ts';
import { untyped } from './untyped.ts';
import { createCity as v6City, serialize as v6Serialize, step as v6Step } from '../src/legacy-v6.ts';

test('a v6 growth-1 save loads as v8 chain-3 with only goods typing added, then keeps running', () => {
  const old = v6City(61025); for (let d = 0; d < 150; d++) v6Step(old);
  const raw = v6Serialize(old), city = deserialize(raw);
  assert.equal(city.version, 8); assert.equal(city.rulesVersion, 'chain-3');
  assert.deepEqual({ ...untyped(serialize(city)), version: 6, rulesVersion: 'growth-1' }, JSON.parse(raw));
  for (let d = 0; d < 90; d++) step(city);
  assert.deepEqual(deserialize(serialize(city)), city);
});

test('farms grow to level 3 from realised profit and each level is one more harvest worker', () => {
  const c = createCity(61025);
  for (let d = 1; d <= 540; d++) { step(c); if (d % 90 === 0) assert.deepEqual(deserialize(serialize(c)), c); }
  const farms = c.firms.filter(f => f.zone === 'F').map(f => ({ f, b: c.buildings.find(b => b.id === f.building)! }));
  assert.ok(farms.some(({ b }) => b.level >= 2), 'a farm levelled up');
  for (const { b } of farms) { assert.ok(b.level <= 3); assert.equal(firmCapacity(b), b.level); }
  assert.ok(c.ledger.some(e => e.reason === 'Profitable firm height investment' && farms.some(({ f }) => f.wallet === e.from)), 'the farm paid for its own height');
  const harvests = c.cropLedger.filter(e => e.kind === 'harvest');
  assert.ok(harvests.some(e => e.workers > 1), 'a levelled farm harvests with more than one worker');
  for (const e of harvests) assert.ok(e.workers <= farms.find(({ f }) => f.wallet === e.to)!.b.level);
});

test('a save whose harvest used more workers than the farm level allows is rejected', () => {
  const c = createCity(61025);
  for (let d = 1; d <= 540; d++) step(c);
  const harvest = c.cropLedger.find(e => e.kind === 'harvest' && e.workers > 1)!;
  const raw = JSON.parse(serialize(c)), farm = raw.firms.find((f: { wallet: string }) => f.wallet === harvest.to);
  raw.buildings.find((b: { id: number }) => b.id === farm.building).level = 1;
  assert.throws(() => deserialize(JSON.stringify(raw)));
});

function converted(): City {
  const c = createCity(61025);
  for (let d = 1; d <= 400 && !c.firms.some(f => f.convertedAt !== undefined); d++) step(c);
  return c;
}

test('a profitable owner-run market becomes the next shop: same owner and labour, refit from its own cash, leftover crops written off', () => {
  const c = converted(), shop = c.firms.find(f => f.convertedAt !== undefined)!;
  assert.ok(shop, 'a market converted within 400 days');
  const at = shop.convertedAt!, b = c.buildings.find(b => b.id === shop.building)!;
  assert.ok(isRetail(shop) && shop.owner && b.level >= 2 && at % 3 === 1, 'a shop-day conversion to an owned shop');
  assert.ok(c.ownerLabor.some(e => e.firmId === shop.id && e.householdId === shop.owner!.householdId), 'the owner still works the counter');
  assert.deepEqual(c.ledger.filter(e => e.reason === 'Market to shop conversion').map(e => [e.tick, e.from, e.to, e.amount]), [[at, shop.wallet, 'construction', MARKET_CONVERSION_COST]]);
  assert.ok(c.ledger.some(e => e.reason === 'Self-employed market construction' && e.from === shop.wallet), 'it was built as a market');
  assert.equal(shop.cropInventory, 0); assert.equal(shop.cropCost, 0);
  assert.ok(c.cropLedger.every(e => (e.from !== shop.wallet && e.to !== shop.wallet) || e.tick <= at), 'no crop trading after the conversion day');
  assert.ok(c.firms.some(isMarket), 'another market still sells fresh crops');
  assert.deepEqual(deserialize(serialize(c)), c);
});

test('the last market never converts', () => {
  const c = converted();
  for (const f of c.firms.filter(isMarket).slice(1)) assert.equal(bulldoze(c, c.buildings.find(b => b.id === f.building)!.cell).ok, true);
  assert.equal(c.firms.filter(isMarket).length, 1); assert.equal(marketToConvert(c), undefined);
});

test('a converted shop save without its refit entry or its conversion day is rejected', () => {
  const c = converted(), shop = c.firms.find(f => f.convertedAt !== undefined)!, raw = JSON.parse(serialize(c));
  const noRefit = structuredClone(raw); noRefit.ledger = noRefit.ledger.filter((e: { reason: string }) => e.reason !== 'Market to shop conversion');
  assert.throws(() => deserialize(JSON.stringify(noRefit)));
  const noDay = structuredClone(raw); delete noDay.firms.find((f: { id: number }) => f.id === shop.id).convertedAt;
  assert.throws(() => deserialize(JSON.stringify(noDay)));
  const early = structuredClone(raw); early.firms.find((f: { id: number }) => f.id === shop.id).convertedAt = 1;
  assert.throws(() => deserialize(JSON.stringify(early)));
});
