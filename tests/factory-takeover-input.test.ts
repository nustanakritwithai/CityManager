import test from 'node:test';
import assert from 'node:assert/strict';
import { createCity, step, bulldoze, zoneCell, serialize, deserialize } from '../src/sim.ts';

test('factory takeover waits for usable crop supply and recovers when the farm returns', () => {
  for (const seed of [61025, 42, 2026]) {
    const city = createCity(seed); for (let d = 0; d < 200; d++) step(city);
    const farm = city.firms.find(f => f.zone === 'F')!;
    const cell = city.buildings.find(b => b.id === farm.building)!.cell;
    assert.equal(bulldoze(city, cell).ok, true);
    for (let d = 0; d < 160; d++) step(city);
    assert.equal(city.ledger.filter(e => e.tick > 200 && /^Outside industry equity #/.test(e.reason)).length, 0, 'no outside investment without crops');
    assert.deepEqual(deserialize(serialize(city)), city);
    assert.equal(zoneCell(city, cell, 'F').ok, true);
    for (let d = 0; d < 180; d++) step(city);
    assert.ok(city.ledger.some(e => e.tick > 360 && /^Outside industry equity #/.test(e.reason)), 'investment resumes when crops return');
    assert.ok(city.goodsLedger.some(e => e.tick > 360 && e.from === 'production'), 'factory actually produces again');
    assert.deepEqual(deserialize(serialize(city)), city);
  }
});

test('takeover picks a recipe matching the available crop after the farm changes crops', async () => {
  const { selectFarmCrop } = await import('../src/sim.ts');
  const city = createCity(61025); for (let d = 0; d < 200; d++) step(city);
  const farm = city.firms.find(f => f.zone === 'F')!;
  assert.equal(selectFarmCrop(city, farm.id, 'vegetables').ok, true);
  for (let d = 0; d < 120; d++) step(city);
  assert.ok(city.firms.some(f => f.zone === 'I' && f.recipe === 'cannery'));
  assert.ok(city.goodsLedger.some(e => e.tick > 200 && e.from === 'production' && e.product === 'canned-food'));
  assert.deepEqual(deserialize(serialize(city)), city);
});

test('a disconnected farm cannot justify factory takeover until road access returns', async () => {
  const { SIZE, access, buildRoad } = await import('../src/sim.ts');
  const c = createCity(61025); for (let d = 0; d < 200; d++) step(c);
  const farm = c.firms.find(f => f.zone === 'F')!, cell = c.buildings.find(b => b.id === farm.building)!.cell;
  const roads = [cell - 1, cell + 1, cell - SIZE, cell + SIZE].filter(i => c.cells[i]?.road);
  assert.equal(roads.length, 1); assert.equal(bulldoze(c, roads[0]).ok, true); assert.equal(access(c, cell), false);
  for (let d = 0; d < 160; d++) step(c);
  assert.equal(c.ledger.filter(e => e.tick > 200 && /^Outside industry equity #/.test(e.reason)).length, 0);
  assert.equal(buildRoad(c, roads[0], roads[0]).ok, true); assert.equal(access(c, cell), true);
  for (let d = 0; d < 180; d++) step(c);
  assert.ok(c.goodsLedger.some(e => e.tick > 360 && e.from === 'production'));
  assert.deepEqual(deserialize(serialize(c)), c);
});
