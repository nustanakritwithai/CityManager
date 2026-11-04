import test from 'node:test';
import assert from 'node:assert/strict';
import { cityChallenges, connectedRoadLoops } from '../src/city-challenges.ts';
import { buildRoad, buildParallelRoad, createCity, deserialize, editRoadJunction, GATEWAY, MONTH, serialize, SIZE, step } from '../src/sim.ts';
import { keepSupplied } from './plants.ts';

const challenge = (c: Parameters<typeof cityChallenges>[0], id: string) => cityChallenges(c).find(x => x.id === id)!;
const at = (x: number, y: number) => y * SIZE + x;

test('advanced challenges start incomplete and retain stable IDs and units', () => {
  const c = createCity(4418, { starter: false });
  assert.deepEqual(cityChallenges(c).map(({ id, current, target, unit, done }) => [id, current, target, unit, done]), [
    ['harvest-variety', 0, 3, 'ชนิด', false], ['processing-variety', 0, 3, 'ชนิด', false],
    ['household-buyers', 0, 20, 'ครัวเรือน', false], ['road-loops', 0, 2, 'วง', false],
  ]);
});

test('crop challenges count actual distinct harvests and processing within the last 30 days', () => {
  const c = createCity(4418, { starter: false }); c.tick = 60;
  const add = (tick: number, kind: 'harvest' | 'process', crop: 'rice' | 'vegetables' | 'sugarcane', quantity = 1) =>
    c.cropLedger.push({ id: c.cropLedger.length + 1, tick, kind, crop, quantity, from: 'a', to: 'b', fromValue: 0, toValue: 0, cash: 0, workers: 1, batches: 1, outputQuantity: 1, reason: 'test' });
  add(30, 'harvest', 'rice'); // exactly 30 days old
  add(31, 'harvest', 'vegetables'); add(31, 'harvest', 'vegetables');
  add(60, 'harvest', 'sugarcane', 0); add(61, 'harvest', 'rice');
  add(60, 'process', 'rice');
  assert.equal(challenge(c, 'harvest-variety').current, 1);
  assert.equal(challenge(c, 'processing-variety').current, 1);
  add(60, 'harvest', 'rice'); add(60, 'harvest', 'sugarcane');
  add(60, 'process', 'vegetables'); add(60, 'process', 'sugarcane');
  assert.equal(challenge(c, 'harvest-variety').done, true);
  assert.equal(challenge(c, 'processing-variety').done, true);
  c.tick = 61;
  assert.equal(challenge(c, 'harvest-variety').current, 2, 'old events roll out');
});

test('buyers are distinct currently housed households buying either fresh crops or shop goods', () => {
  const c = createCity(61025);
  while (c.households.length < 2 && c.tick < 60) step(c);
  c.tick = 60; c.cropLedger = []; c.goodsLedger = [];
  const [a, b] = c.households; assert.ok(a && b); a.home = c.buildings.find(b => b.zone === 'R')!.id; b.home = a.home;
  const crop = (tick: number, to: string) => c.cropLedger.push({ id: c.cropLedger.length + 1, tick, kind: 'consumption', crop: 'rice', quantity: 1, from: 'firm:1', to, fromValue: 0, toValue: 0, cash: 0, workers: 0, batches: 0, outputQuantity: 0, reason: 'test' });
  crop(31, a.wallet); crop(60, a.wallet); crop(30, b.wallet); crop(61, b.wallet);
  c.goodsLedger.push({ tick: 60, from: 'firm:1', to: b.wallet, quantity: 1, reason: 'Household final consumption', product: 'sugar' });
  c.goodsLedger.push({ tick: 60, from: 'firm:1', to: 'household:999999', quantity: 1, reason: 'Household final consumption', product: 'sugar' });
  assert.equal(challenge(c, 'household-buyers').current, 2);
  b.home = null; assert.equal(challenge(c, 'household-buyers').current, 1);
  c.tick = 61; assert.equal(challenge(c, 'household-buyers').current, 1);
  c.tick = 90; assert.equal(challenge(c, 'household-buyers').current, 0);
});

test('road challenges count independent loops on the gateway network, respecting junctions', () => {
  const c = createCity(61025, { starter: false });
  assert.ok(buildRoad(c, GATEWAY, at(4, 12)).ok);
  assert.equal(connectedRoadLoops(c), 0);
  assert.ok(buildParallelRoad(c, at(0, 13), at(4, 13)).ok);
  assert.ok(editRoadJunction(c, at(0, 12), at(0, 13), true).ok);
  assert.equal(connectedRoadLoops(c), 0, 'a connected branch is not a loop');
  assert.ok(editRoadJunction(c, at(4, 12), at(4, 13), true).ok);
  assert.equal(connectedRoadLoops(c), 1);
  assert.ok(editRoadJunction(c, at(2, 12), at(2, 13), true).ok);
  assert.equal(connectedRoadLoops(c), 2); assert.equal(challenge(c, 'road-loops').done, true);
  assert.ok(editRoadJunction(c, at(2, 12), at(2, 13), false).ok);
  assert.equal(connectedRoadLoops(c), 1);
  assert.equal(connectedRoadLoops(deserialize(serialize(c))), 1);
});

test('evaluating challenges is read-only and stable across save/load after history compaction', () => {
  const c = createCity(61025);
  for (let i = 0; i < MONTH * 5; i++) { step(c); keepSupplied(c); }
  assert.ok(c.history && c.history.throughTick > 0);
  const before = serialize(c), challenges = cityChallenges(c);
  assert.equal(serialize(c), before);
  assert.deepEqual(cityChallenges(deserialize(before)), challenges);
});

test('buyer threshold requires 20 distinct current households and drops when one leaves', () => {
  const c = createCity(61025);
  while (!c.households.length && c.tick < 60) step(c);
  const template = c.households[0]; assert.ok(template);
  c.tick = 60; c.cropLedger = []; c.goodsLedger = [];
  c.households = Array.from({ length: 20 }, (_, i) => ({ ...template, id: i + 1, home: 1, wallet: `household:${i + 1}` }));
  for (const h of c.households) c.goodsLedger.push({ tick: 60, from: 'firm:1', to: h.wallet, quantity: 1, reason: 'Household final consumption', product: 'milled-rice' });
  assert.equal(challenge(c, 'household-buyers').current, 20);
  assert.equal(challenge(c, 'household-buyers').done, true);
  c.households.pop();
  assert.equal(challenge(c, 'household-buyers').current, 19);
  assert.equal(challenge(c, 'household-buyers').done, false);
});

test('road loop count uses expanded-map seam links and ignores disconnected loops', async () => {
  const { expandedCellAt, EXPANDED_MAP_CELLS } = await import('../src/expanded-map-grid.ts');
  const { setRoadJunction } = await import('../src/road-topology.ts');
  const c = createCity(1, { starter: false });
  c.cells = Array.from({ length: EXPANDED_MAP_CELLS }, () => ({ road: false, zone: null, building: null }));
  for (let y = 0; y <= 12; y++) c.cells[at(0, y)].road = true;
  const north = expandedCellAt(0, -1)!, northEast = expandedCellAt(1, -1)!;
  c.cells[north].road = c.cells[northEast].road = c.cells[at(1, 0)].road = true;
  for (const [x, y] of [[10, 10], [11, 10], [10, 11], [11, 11]]) c.cells[at(x, y)].road = true;
  assert.equal(connectedRoadLoops(c), 1);
  assert.ok(setRoadJunction(c, at(0, 0), north, false));
  assert.equal(connectedRoadLoops(c), 0);
});
