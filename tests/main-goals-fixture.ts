import assert from 'node:assert/strict';
import { access, buildRoad, createCity, SIZE, zoneCell, type City } from '../src/sim.ts';

/** Two compact, distinct player-built layouts, with real zoned development on both axes. */
export function expandedGoalCity(seed = 61025, layout: 'branches' | 'loop' = 'branches'): City {
  const c = createCity(seed), ix = (x: number, z: number) => z * SIZE + x;
  const roads = layout === 'branches'
    ? [[10,12,17,12], [13,8,13,17], [16,8,16,17]]
    : [[10,12,17,12], [12,8,12,16], [16,8,16,16], [12,8,16,8], [12,16,16,16]];
  for (const [x1,z1,x2,z2] of roads) assert.equal(buildRoad(c, ix(x1,z1), ix(x2,z2)).ok, true);
  const sites = c.cells.map((cell,i) => !cell.road && !cell.zone && access(c,i) ? i : -1).filter(i => i >= 0);
  for (const [zone, count] of [['R',12], ['I',5], ['C',4], ['F',3]] as const) {
    for (let i = 0; i < count; i++) { const site = sites.shift(); assert.notEqual(site, undefined); assert.equal(zoneCell(c, site!, zone).ok, true); }
  }
  return c;
}
