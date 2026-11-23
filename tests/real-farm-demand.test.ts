import test from 'node:test';
import assert from 'node:assert/strict';
import { createCity, step, serialize, deserialize, summary, zoneCell, access, bulldoze, farmCrop, firmWorkerCount, automaticFarmCrop, realCropShortage, type City } from '../src/sim.ts';
import { REAL_CROPS, realLotsPerYear, millLotsPerWorker } from '../src/industry-scale.ts';
import { keepSupplied } from './plants.ts';
import { legacyIndustry } from './legacy-sizes.ts';

/** The starter city with `count` more lots zoned for farms. */
function farmland(count: number, prepare: (c: City) => City = c => c) {
  const c = prepare(createCity(61025)), lots: number[] = [];
  for (let i = 0; i < c.cells.length && lots.length < count; i++) if (!c.cells[i].road && !c.cells[i].zone && c.cells[i].building === null && access(c, i) && zoneCell(c, i, 'F').ok) lots.push(i);
  assert.equal(lots.length, count);
  return { c, lots };
}

test('a real mill short of crop wants the paddy of many 100-rai fields: its farms grow first, then farms go up on zoned land', { timeout: 300_000 }, () => {
  const { c, lots } = farmland(6);
  const level = (f: { building: number }) => c.buildings.find(b => b.id === f.building)!.level;
  for (let d = 0; d < 60; d++) { step(c); keepSupplied(c); }
  assert.ok(lots.filter(i => c.cells[i].building !== null).length < lots.length, 'farms that can still grow hold the land back');
  assert.ok(c.firms.some(f => f.zone === 'F' && level(f) >= 2), 'the farms grow instead');
  // At level 3 a farm needs a worker with a diploma to grow on; the land is then taken for new farms.
  for (let d = 0; d < 90; d++) { step(c); keepSupplied(c); }
  const built = lots.filter(i => c.cells[i].building !== null);
  assert.equal(built.length, lots.length, 'every zoned lot has a farm');
  assert.ok(c.firms.filter(f => f.zone === 'F').some(f => level(f) === 3));
  // People who come for the work let the town open a second rice mill too.
  const mills = c.firms.filter(f => f.zone === 'I'), farms = c.firms.filter(f => f.zone === 'F');
  assert.ok(mills.every(f => f.recipe === 'rice-mill'));
  assert.ok(farms.every(f => farmCrop(c, f) === 'rice'), 'new farms grow what the mills mill');
  // One rice-mill worker processes 200 lots a day; a 100-rai field harvests a few dozen at most.
  const short = realCropShortage(c), harvest = farms.reduce((n, f) => n + realLotsPerYear(REAL_CROPS.rice, c.buildings.find(b => b.id === f.building)!.level) / 365, 0);
  const milling = mills.reduce((n, f) => n + firmWorkerCount(c, f.id), 0) * millLotsPerWorker(REAL_CROPS.rice);
  assert.ok(Math.abs(short.rice - (milling - harvest)) < 1e-9);
  assert.ok(short.rice > 0 && summary(c).demand.F === 1, 'still short, so more farms are wanted');
  assert.deepEqual(deserialize(serialize(c)), c);
});

test('with no mill to sell to, no more farms are wanted', { timeout: 300_000 }, () => {
  const { c } = farmland(2);
  for (let d = 0; d < 5; d++) { step(c); keepSupplied(c); }
  const mill = c.firms.find(f => f.zone === 'I')!;
  assert.equal(bulldoze(c, c.buildings.find(b => b.id === mill.building)!.cell).ok, true);
  assert.ok(Object.values(realCropShortage(c)).every(n => n <= 0));
  assert.equal(summary(c).demand.F, 0);
});

test('a new farm picks the crop mills are shortest of; a city saved before keeps the least-grown crop', () => {
  const { c } = farmland(1);
  for (let d = 0; d < 3; d++) step(c);
  assert.equal(automaticFarmCrop(c), 'rice', 'the rice mill is short of paddy');
  const legacy = farmland(1, legacyIndustry).c;
  for (let d = 0; d < 3; d++) step(legacy);
  const grown = new Set(legacy.firms.filter(f => f.zone === 'F').map(f => farmCrop(legacy, f)));
  assert.ok(!grown.has(automaticFarmCrop(legacy)), 'old rules: a crop no farm grows yet');
});
