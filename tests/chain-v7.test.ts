import test from 'node:test';
import assert from 'node:assert/strict';
import { createCity, deserialize, firmCapacity, serialize, step } from '../src/sim.ts';
import { createCity as v6City, serialize as v6Serialize, step as v6Step } from '../src/legacy-v6.ts';

test('a v6 growth-1 save loads as v7 chain-2 with every other fact unchanged, then keeps running', () => {
  const old = v6City(61025); for (let d = 0; d < 150; d++) v6Step(old);
  const raw = v6Serialize(old), city = deserialize(raw);
  assert.equal(city.version, 7); assert.equal(city.rulesVersion, 'chain-2');
  assert.deepEqual({ ...JSON.parse(serialize(city)), version: 6, rulesVersion: 'growth-1' }, JSON.parse(raw));
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
