import test from 'node:test';
import assert from 'node:assert/strict';
import { createCity, buildRoad, zoneCell, step, serialize, GATEWAY, SIZE, type City } from '../src/sim.ts';
import { cityOverview } from '../src/context-data.ts';
import { treasuryHistory } from '../src/overview-data.ts';
import { dailySeries, sum, BUILDING_ORDER } from '../src/city-series.ts';

function grown(days: number, record?: (c: City) => void): City {
  const c = createCity(61025), S = SIZE;
  buildRoad(c, GATEWAY, 12 * S + 20);
  for (const col of [5, 10, 15]) buildRoad(c, 6 * S + col, 18 * S + col);
  for (let r = 7; r <= 17; r++) for (const col of [4, 6, 9, 11, 14, 16]) if (r !== 12) zoneCell(c, r * S + col, r < 12 ? 'R' : col > 12 ? 'I' : 'R');
  for (const col of [6, 7, 8, 9, 11, 12, 13]) { zoneCell(c, 11 * S + col, 'C'); zoneCell(c, 13 * S + col, col % 2 ? 'C' : 'F'); }
  for (let col = 16; col <= 20; col++) { zoneCell(c, 11 * S + col, 'F'); zoneCell(c, 13 * S + col, 'F'); }
  for (let t = 0; t < days; t++) { step(c); record?.(c); }
  return c;
}

test('30-day series reconcile with the city overview and the treasury history, read-only', () => {
  const city = grown(140), before = serialize(city), s = dailySeries(city, 30), o = cityOverview(city);
  assert.equal(serialize(city), before);
  assert.equal(s.ticks.length, 30); assert.equal(s.ticks.at(-1), city.tick);
  assert.equal(sum(s.income), o.income); assert.equal(sum(s.expense), o.expense);
  assert.equal(sum(s.goodsProduced), o.produced); assert.equal(sum(s.goodsConsumed), o.consumed);
  assert.equal(sum(s.goodsExported), o.exported); assert.equal(sum(s.goodsImported), o.imported);
  assert.equal(sum(s.cropsHarvested), o.cropHarvested); assert.equal(sum(s.cropsProcessed), o.cropProcessed); assert.equal(sum(s.cropsConsumed), o.cropConsumed);
  assert.deepEqual(s.treasury, treasuryHistory(city, 30).map(p => p.balance));
  assert.equal(s.population.at(-1), o.population); assert.equal(s.households.at(-1), o.households);
  assert.equal(BUILDING_ORDER.reduce((n, k) => n + s.buildings[k].at(-1)!, 0), city.buildings.length);
});

test('population and building history match what the city looked like on earlier days', () => {
  const snapshots = new Map<number, { population: number; households: number; buildings: number }>();
  const city = grown(120, c => snapshots.set(c.tick, { population: c.households.reduce((n, h) => n + h.members, 0), households: c.households.length, buildings: c.buildings.length }));
  const s = dailySeries(city, Infinity);
  assert.equal(s.ticks[0], 0);
  for (const [tick, snap] of snapshots) {
    const i = s.ticks.indexOf(tick); if (i < 0) continue;
    assert.equal(s.population[i], snap.population, `population on day ${tick}`);
    assert.equal(s.households[i], snap.households, `households on day ${tick}`);
    assert.equal(BUILDING_ORDER.reduce((n, k) => n + s.buildings[k][i], 0), snap.buildings, `buildings on day ${tick}`);
  }
  assert.ok(s.markers.some(m => m.kind === 'building') && s.markers.some(m => m.kind === 'arrival') && s.markers.some(m => m.kind === 'road'));
  assert.ok(s.markers.every((m, i) => i === 0 || s.markers[i - 1].tick <= m.tick));
});
