import test from 'node:test';
import assert from 'node:assert/strict';
import { GATEWAY, ROAD_COST, SIZE, access, buildPlant, buildRoad, createCity, deserialize, plantAt, serialize, step, zoneCell } from '../src/sim.ts';
import { guideState, guideSteps } from '../src/guide-steps.ts';
import { WinLatch, cityGoals } from '../src/city-goals.ts';

test('an empty start has only the outside gateway, a valid save and the guide on step 1', () => {
  const c = createCity(61025, { starter: false });
  assert.deepEqual(c.cells.flatMap((cell, i) => cell.road ? [i] : []), [GATEWAY]);
  assert.ok(c.cells.every(cell => cell.zone === null && cell.building === null)); assert.equal(c.buildings.length, 0);
  assert.equal(c.accounts.treasury, 3_000_000 - ROAD_COST, 'only the gateway cell is paid for');
  assert.deepEqual(deserialize(serialize(c)), c);
  const g = guideState(c); assert.equal(g.index, 0); assert.equal(g.step?.id, 'road'); assert.equal(g.step?.tool, 'road');
  assert.equal(guideSteps(createCity(61025)).slice(0, 5).every(s => s.done), true, 'the sample city already has its road and zones');
});

test('following the guide from an empty map walks every step and leaves a city that grows', () => {
  const c = createCity(61025, { starter: false }), seen: string[] = [];
  const now = () => { const id = guideState(c).step?.id ?? 'done'; if (seen.at(-1) !== id) seen.push(id); };
  now(); assert.equal(buildRoad(c, GATEWAY, GATEWAY + 10).ok, true); now();
  for (const x of [2, 3, 5, 6]) assert.equal(zoneCell(c, 11 * SIZE + x, 'R').ok, true); now();
  const later = [4, 7, 9, 10].map(x => 13 * SIZE + x); // the factory and shop cells below
  const frontier = c.cells.map((cell, i) => !cell.road && cell.zone === null && access(c, i) && i > 12 * SIZE + 10 && !later.includes(i) ? i : -1).filter(i => i >= 0);
  const farm = frontier.sort((a, b) => c.resources.fertility[b] - c.resources.fertility[a])[0];
  assert.equal(zoneCell(c, farm, 'F').ok, true); now();
  assert.equal(zoneCell(c, 13 * SIZE + 9, 'I').ok, true); now();
  for (const x of [4, 7]) assert.equal(zoneCell(c, 13 * SIZE + x, 'C').ok, true); now();
  for (let d = 0; d < 120 && guideState(c).step?.id !== 'grow'; d++) { step(c); now(); }
  for (const x of [8, 10]) zoneCell(c, 11 * SIZE + x, 'R'); zoneCell(c, 13 * SIZE + 10, 'I'); now();
  assert.equal(guideState(c).step?.tool, 'power', 'the utilities step picks the power plant first');
  const sites = c.cells.map((cell, i) => !cell.road && cell.zone === null && cell.building === null && !plantAt(c, i) && access(c, i) ? i : -1).filter(i => i >= 0);
  assert.equal(buildPlant(c, sites[0], 'power').ok, true); now(); assert.equal(guideState(c).step?.tool, 'water');
  assert.equal(buildPlant(c, sites[1], 'water').ok, true); now();
  assert.deepEqual(seen, ['road', 'homes', 'farm', 'factory', 'commerce', 'play', 'chain', 'grow', 'utilities', 'done']);
  assert.ok(cityGoals(c).level >= 3);
  for (let d = 0; d < 420 && !cityGoals(c).won; d++) step(c);
  assert.equal(cityGoals(c).won, true, 'a guided city can win');
});

test('the win screen shows once per city: never on load, never again after a dip', () => {
  const latch = new WinLatch(), a = {}, b = {};
  assert.equal(latch.check(a, false, true), false, 'first sight of a city only records it');
  assert.equal(latch.check(a, true, false), false, 'paused or loading never shows it');
  assert.equal(latch.check(a, true, true), true, 'reaching stage 5 while running shows it once');
  assert.equal(latch.check(a, false, true), false); assert.equal(latch.check(a, true, true), false, 'a dip and a climb back does not show it again');
  assert.equal(latch.check(b, true, true), false, 'a loaded city that already won does not show it');
  const c = {}; latch.check(c, false, true); assert.equal(latch.check(c, true, true), true, 'a new city can win again');
});
