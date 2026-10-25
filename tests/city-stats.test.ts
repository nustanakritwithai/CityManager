import test from 'node:test';
import assert from 'node:assert/strict';
import { createCity, buildRoad, zoneCell, step, serialize, summary, GATEWAY, SIZE } from '../src/sim.ts';
import { cityOverview } from '../src/context-data.ts';
import { cityStats, BUILDING_KINDS } from '../src/city-stats.ts';

const grown = () => {
  const c = createCity(61025), S = SIZE;
  buildRoad(c, GATEWAY, 12 * S + 20);
  for (const col of [5, 10, 15]) buildRoad(c, 6 * S + col, 18 * S + col);
  for (let r = 7; r <= 17; r++) for (const col of [4, 6, 9, 11, 14, 16]) if (r !== 12) zoneCell(c, r * S + col, r < 12 ? 'R' : col > 12 ? 'I' : 'R');
  for (const col of [6, 7, 8, 9, 11, 12, 13]) { zoneCell(c, 11 * S + col, 'C'); zoneCell(c, 13 * S + col, col % 2 ? 'C' : 'F'); }
  for (let col = 16; col <= 20; col++) { zoneCell(c, 11 * S + col, 'F'); zoneCell(c, 13 * S + col, 'F'); }
  for (let t = 0; t < 150; t++) step(c);
  return c;
};

test('city stats reconcile with the simulator summary and overview, read-only', () => {
  const city = grown(), before = serialize(city), s = cityStats(city), sum = summary(city), o = cityOverview(city);
  assert.equal(serialize(city), before);
  assert.equal(s.buildings.all, city.buildings.length);
  assert.equal(BUILDING_KINDS.reduce((n, k) => n + s.buildings.totals[k], 0), city.buildings.length);
  for (const k of BUILDING_KINDS) assert.equal(s.buildings.levels.reduce((n, l) => n + s.buildings.rows[l][k], 0), s.buildings.totals[k]);
  assert.equal(s.people.population, sum.population); assert.equal(s.people.employed, sum.employed); assert.equal(s.people.unemployed, sum.unemployed);
  assert.equal(s.labour.reduce((n, l) => n + l.supply, 0), city.households.reduce((n, h) => n + h.workerSkills.general + h.workerSkills.manufacturing + h.workerSkills.retail, 0));
  assert.equal(s.labour.reduce((n, l) => n + l.employed + l.owners, 0), o.employeeWorkers + o.selfEmployedWorkers);
  assert.equal(s.jobs.reduce((n, j) => n + j.firms, 0), city.firms.length);
  assert.equal(s.stocks.crops.farm + s.stocks.crops.market + s.stocks.crops.factory, o.cropInventory);
  assert.equal(s.stocks.goods.factory + s.stocks.goods.shop, o.inventory);
  assert.deepEqual([s.services.income, s.services.expense, s.services.net, s.services.treasury], [o.income, o.expense, o.net, o.treasury]);
  assert.equal(s.services.roads, city.cells.filter(c => c.road).length);
  assert.ok(s.services.connectedRoads <= s.services.roads);
});

test('an empty city has no building rows', () => {
  const s = cityStats(createCity());
  assert.deepEqual(s.buildings.levels, []); assert.equal(s.buildings.all, 0);
});
