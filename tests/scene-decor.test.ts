import test from 'node:test';
import assert from 'node:assert/strict';
import { createCity, zoneCell, serialize, SIZE } from '../src/sim.ts';
import { pocketPark } from '../src/scene-decor.ts';

test('pocket parks only on unzoned land surrounded by zones, read-only', () => {
  const city = createCity(), centre = 18 * SIZE + 8;
  assert.equal(pocketPark(city, centre), false, 'open countryside stays empty');
  for (const n of [centre - SIZE - 1, centre - SIZE, centre - SIZE + 1]) zoneCell(city, n, 'R');
  const before = serialize(city);
  assert.equal(pocketPark(city, centre), true);
  assert.equal(pocketPark(city, centre - SIZE), false, 'zoned parcels never become parks');
  assert.equal(serialize(city), before);
});
