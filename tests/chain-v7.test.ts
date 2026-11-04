import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { MARKET_CONVERSION_COST, bulldoze, createCity, deserialize, firmCapacity, isMarket, isRetail, marketToConvert, serialize, step, type City } from '../src/sim.ts';
import { untyped } from './untyped.ts';
import { createCity as v6City, serialize as v6Serialize, step as v6Step } from '../src/legacy-v6.ts';
import { keepSupplied } from './plants.ts';
import { holdEducationReady } from './education-ready.ts';
import { FARM_MAX_LEVEL } from '../src/agriculture.ts';

test('a v6 growth-1 save loads as v8 chain-3 with only goods typing added, then keeps running', () => {
  const old = v6City(61025); for (let d = 0; d < 150; d++) v6Step(old);
  const raw = v6Serialize(old), city = deserialize(raw);
  assert.equal(city.version, 9); assert.equal(city.rulesVersion, 'chain-4');
  assert.deepEqual({ ...untyped(serialize(city)), version: 6, rulesVersion: 'growth-1' }, JSON.parse(raw));
  for (let d = 0; d < 90; d++) step(city);
  assert.deepEqual(deserialize(serialize(city)), city);
});

test('farms grow from realised profit and each level is one more harvest worker', () => {
  const c = createCity(61025);
  const investments: typeof c.ledger = [];
  for (let d = 1; d <= 540; d++) {
    holdEducationReady(c); step(c);
    investments.push(...c.ledger.filter(e => e.tick === c.tick && e.reason === 'Profitable firm height investment'));
    if (d % 90 === 0) assert.deepEqual(deserialize(serialize(c)), c);
  }
  const farms = c.firms.filter(f => f.zone === 'F').map(f => ({ f, b: c.buildings.find(b => b.id === f.building)! }));
  assert.ok(farms.some(({ b }) => b.level >= 2), 'a farm levelled up');
  assert.ok(farms.some(({ b }) => b.level > 3), 'the new farm tiers are reached');
  for (const { b } of farms) { assert.ok(b.level <= FARM_MAX_LEVEL); assert.equal(firmCapacity(b), b.level); }
  assert.ok(investments.some(e => farms.some(({ f }) => f.wallet === e.from)), 'the farm paid for its own height');
  const harvests = c.cropLedger.filter(e => e.kind === 'harvest');
  assert.ok(harvests.some(e => e.workers > 1), 'a levelled farm harvests with more than one worker');
  for (const e of harvests) assert.ok(e.workers <= farms.find(({ f }) => f.wallet === e.to)!.b.level);
});

test('a save whose harvest used more workers than the farm level allows is rejected', () => {
  const c = createCity(61025);
  for (let d = 1; d <= 540; d++) { holdEducationReady(c); step(c); }
  const harvest = c.cropLedger.find(e => e.kind === 'harvest' && e.workers > 1)!;
  const raw = JSON.parse(serialize(c)), farm = raw.firms.find((f: { wallet: string }) => f.wallet === harvest.to);
  raw.buildings.find((b: { id: number }) => b.id === farm.building).level = 1;
  assert.throws(() => deserialize(JSON.stringify(raw)));
});

// An authentic v15 city captured on the day an owned market converted. The
// current unified-commerce engine opens shops directly and no longer converts.
const historicalConversion = () => readFileSync(new URL('./fixtures/retail-v15.json', import.meta.url), 'utf8');
function converted(): City { return deserialize(historicalConversion()); }

test('a historical conversion preserves owner and labour, paid refit and crop write-off', () => {
  const c = converted(), shop = c.firms.find(f => f.convertedAt !== undefined)!;
  assert.ok(shop, 'historical fixture contains an actual converted market');
  const historical = JSON.parse(historicalConversion());
  const at = shop.convertedAt!, b = c.buildings.find(b => b.id === shop.building)!;
  assert.ok(isRetail(shop) && shop.owner && b.level >= 2 && at % 3 === 1, 'a shop-day conversion to an owned shop');
  assert.ok(c.ownerLabor.some(e => e.firmId === shop.id && e.householdId === shop.owner!.householdId), 'the owner still works the counter');
  assert.deepEqual(historical.ledger.filter((e: { reason: string }) => e.reason === 'Market to shop conversion').map(e => [e.tick, e.from, e.to, e.amount]), [[at, shop.wallet, 'construction', MARKET_CONVERSION_COST]]);
  assert.ok(historical.ledger.some((e: { reason: string; from: string }) => e.reason === 'Self-employed market construction' && e.from === shop.wallet), 'it was built as a market');
  assert.equal(shop.cropInventory, 0); assert.equal(shop.cropCost, 0);
  const writeoffs = historical.cropLedger.filter((e: {kind:string; from:string; tick:number}) => e.kind === 'writeoff' && e.from === shop.wallet && e.tick === at);
  assert.equal(writeoffs.length, 1); assert.equal(writeoffs[0].quantity, 41);
  const oldFirm = historical.firms.find((f: {id:number}) => f.id === shop.id);
  assert.deepEqual(shop.owner, oldFirm.owner, 'the owner survives legacy migration');
  assert.deepEqual(deserialize(serialize(c)).firms.find(f => f.id === shop.id)!.owner, oldFirm.owner, 'the owner survives the current save round trip');
  assert.ok(historical.cropLedger.every((e: {from: string; to: string; tick: number}) => (e.from !== shop.wallet && e.to !== shop.wallet) || e.tick <= at), 'no crop trading after the conversion day');
  assert.ok(c.firms.some(isMarket), 'another market still sells fresh crops');
  assert.deepEqual(deserialize(serialize(c)), c);
});

test('a legacy last market is not eligible for conversion', () => {
  const c = converted();
  for (const f of c.firms.filter(isMarket).slice(1)) assert.equal(bulldoze(c, c.buildings.find(b => b.id === f.building)!.cell).ok, true);
  assert.equal(c.firms.filter(isMarket).length, 1); assert.equal(marketToConvert(c), undefined);
});

test('a historical converted shop without its refit entry or conversion day is rejected', () => {
  const c = converted(), shop = c.firms.find(f => f.convertedAt !== undefined)!, raw = JSON.parse(historicalConversion());
  const noRefit = structuredClone(raw); noRefit.ledger = noRefit.ledger.filter((e: { reason: string }) => e.reason !== 'Market to shop conversion');
  assert.throws(() => deserialize(JSON.stringify(noRefit)));
  const noDay = structuredClone(raw); delete noDay.firms.find((f: { id: number }) => f.id === shop.id).convertedAt;
  assert.throws(() => deserialize(JSON.stringify(noDay)));
  const early = structuredClone(raw); early.firms.find((f: { id: number }) => f.id === shop.id).convertedAt = 1;
  assert.throws(() => deserialize(JSON.stringify(early)));
});

test('new unified shops retain their identity and crops without conversion', () => {
  const c = createCity(61025);
  const conversions: typeof c.ledger = [];
  for (let day = 0; day < 180; day++) {
    step(c); keepSupplied(c);
    conversions.push(...c.ledger.filter(e => e.tick === c.tick && e.reason === 'Market to shop conversion'));
  }
  assert.ok(c.firms.some(isRetail), 'new shops open');
  assert.ok(c.firms.every(f => f.convertedAt === undefined));
  assert.equal(marketToConvert(c), undefined);
  assert.deepEqual(conversions, [], 'no conversion was recorded, including before compaction');
  assert.equal(c.crops.writtenOff, 0, 'no crops were written off by conversion');
  assert.equal(c.crops.harvested - c.crops.processed - c.crops.consumed - c.crops.writtenOff - (c.crops.exported ?? 0), c.firms.reduce((sum, f) => sum + f.cropInventory, 0));
  assert.deepEqual(deserialize(serialize(c)), c);
});
