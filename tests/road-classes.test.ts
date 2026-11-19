import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCity, step, serialize, deserialize, setRoadClassAlong, bulldoze, buildRoad, treasurySpendable, type City } from '../src/sim.ts';
import { ROAD_CLASS, roadClassAt, roadUpgradeReason, roadUpkeep, setRoadClass, validateRoadClasses } from '../src/road-classes.ts';
import { validateMunicipalRefunds } from '../src/municipal-refunds.ts';

const grown = () => { const c = createCity(61025); for (let i = 0; i < 30; i++) step(c); return c; };
const roadRun = (c: City) => {
  // Two road parcels a straight drag apart along the main road.
  const roads = c.cells.map((cell, i) => cell.road ? i : -1).filter(i => i >= 0);
  return [roads[2], roads[5]] as const;
};

test('a city that never upgrades a road saves byte-identically and pays the old upkeep', () => {
  const c = grown(), before = serialize(c);
  assert.equal('roadClasses' in c, false);
  assert.equal(serialize(deserialize(before)), before);
  assert.equal(roadUpkeep(c), c.cells.filter(cell => cell.road).length * ROAD_CLASS.local.dailyUpkeep);
  for (const [i, cell] of c.cells.entries()) if (cell.road) assert.equal(roadClassAt(c, i), 'local');
});

test('upgrading a drag pays the difference per road parcel, lowering is free, and both survive a save', () => {
  const c = grown(), [a, b] = roadRun(c), money = treasurySpendable(c);
  const r = setRoadClassAlong(c, a, b, 'arterial');
  assert.equal(r.ok, true, r.message);
  const upgraded = Object.keys(c.roadClasses!.cells).map(Number);
  assert.ok(upgraded.length >= 2);
  for (const i of upgraded) { assert.equal(roadClassAt(c, i), 'arterial'); assert.ok(c.ledger.some(e => e.reason === roadUpgradeReason(i, 'arterial') && e.amount === ROAD_CLASS.arterial.upgradeCost && e.to === 'roadworks')); }
  assert.equal(money - treasurySpendable(c), upgraded.length * ROAD_CLASS.arterial.upgradeCost);
  assert.equal(setRoadClassAlong(c, a, b, 'arterial').message.includes('อยู่แล้ว'), true, 'nothing to pay twice');
  const saved = serialize(c); assert.equal(serialize(deserialize(saved)), saved); assert.deepEqual(deserialize(saved).roadClasses, c.roadClasses);
  const spend = treasurySpendable(c); assert.equal(setRoadClassAlong(c, a, b, 'collector').ok, true); assert.equal(treasurySpendable(c), spend, 'lowering is free');
  assert.equal(setRoadClassAlong(c, a, b, 'local').ok, true); assert.equal('roadClasses' in c, false, 'all local again drops the section');
  validateMunicipalRefunds(c);
  assert.equal(Object.values(c.accounts).reduce((x, y) => x + y, 0), 0);
});

test('upkeep follows the classes, demolition forgets a parcel’s class, and a drag off the road changes nothing', () => {
  const c = grown(), [a, b] = roadRun(c);
  setRoadClassAlong(c, a, b, 'collector');
  const collectors = Object.keys(c.roadClasses!.cells).length, roads = c.cells.filter(cell => cell.road).length;
  assert.equal(roadUpkeep(c), (roads - collectors) * ROAD_CLASS.local.dailyUpkeep + collectors * ROAD_CLASS.collector.dailyUpkeep);
  step(c);
  assert.equal(c.ledger.filter(e => e.tick === c.tick && e.reason === 'Daily road upkeep').at(-1)?.amount, roadUpkeep(c));
  const end = Number(Object.keys(c.roadClasses!.cells).at(-1));
  if (bulldoze(c, end).ok) { assert.equal(roadClassAt(c, end), 'local'); assert.equal(c.roadClasses?.cells[end], undefined); }
  const empty = c.cells.findIndex((cell, i) => !cell.road && cell.building === null && i > 0);
  assert.equal(setRoadClassAlong(c, empty, empty, 'arterial').ok, false);
  const saved = serialize(c); assert.equal(serialize(deserialize(saved)), saved);
  assert.ok(buildRoad);
});

test('a malformed road class section is rejected', () => {
  const c = grown(), road = c.cells.findIndex(cell => cell.road), plain = c.cells.findIndex(cell => !cell.road);
  for (const bad of [null, [], { version: 2, cells: { [road]: 'arterial' } }, { version: 1 }, { version: 1, cells: {} }, { version: 1, cells: { [road]: 'local' } }, { version: 1, cells: { [road]: 'highway' } }, { version: 1, cells: { [plain]: 'arterial' } }, { version: 1, cells: { '-1': 'arterial' } }, { version: 1, cells: { [road]: 'arterial' }, extra: 1 }])
    assert.throws(() => validateRoadClasses(bad, c), /Invalid road classes save/, JSON.stringify(bad));
  validateRoadClasses({ version: 1, cells: { [road]: 'collector' } }, c);
  const raw = JSON.parse(serialize(c)); raw.roadClasses = { version: 1, cells: { [plain]: 'arterial' } };
  assert.throws(() => deserialize(JSON.stringify(raw)), /Invalid road classes save/);
  assert.equal(setRoadClass(c, [plain], 'arterial'), 0, 'only road parcels take a class');
});
