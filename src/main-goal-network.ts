/** Read-only network development facts. Only connected frontage serving occupied homes or
 * staffed businesses, and both must have utilities. Loops, grids and branched layouts qualify. */
import { connectedRoads, utilities, withRoadScope, type City } from './sim.ts';
import { expandedCellCoordinate } from './expanded-map-grid.ts';
import { roadLinked, roadNeighborsFor } from './road-topology.ts';

export const GOAL_SERVED_ROADS = 18;
export const GOAL_SERVED_ROADS_PER_AXIS = 5;
export const GOAL_LARGE_CITY_POPULATION = 60;
export const GOAL_LARGE_CITY_SALES = 1800;

export function mainGoalNetwork(c: City) {
  return withRoadScope(c, () => {
    const roads = connectedRoads(c), occupiedHomes = new Set(c.households.flatMap(h => h.home === null ? [] : [h.home]));
    const staffedFirms = new Set([...c.employment.filter(e => e.workers > 0).map(e => e.firmId), ...c.ownerLabor.map(e => e.firmId)]);
    const service = utilities(c);
    const activeFirms = new Set(c.firms.filter(f => staffedFirms.has(f.id) && service.ok(f.building)).map(f => f.building));
    const activeCells = new Set(c.buildings.filter(b => (occupiedHomes.has(b.id) || activeFirms.has(b.id)) && service.ok(b.id)).map(b => b.cell));
    let horizontalOnly = 0, verticalOnly = 0, both = 0;
    for (const i of roads) {
      const neighbors = roadNeighborsFor(c, i);
      if (!neighbors.some(n => activeCells.has(n))) continue;
      const { x, z } = expandedCellCoordinate(i);
      const linked = neighbors.filter(n => roads.has(n) && roadLinked(c, i, n));
      const h = linked.some(n => expandedCellCoordinate(n).z === z);
      const v = linked.some(n => expandedCellCoordinate(n).x === x);
      if (h && v) both++; else if (h) horizontalOnly++; else if (v) verticalOnly++;
    }
    // A junction is assigned to at most one axis. Reserve only what horizontal needs,
    // leaving the rest for vertical, so every qualifying pair is accepted.
    const junctionsForHorizontal = Math.min(both, Math.max(0, GOAL_SERVED_ROADS_PER_AXIS - horizontalOnly));
    return { roads: roads.size, served: horizontalOnly + verticalOnly + both,
      horizontal: horizontalOnly + junctionsForHorizontal, vertical: verticalOnly + both - junctionsForHorizontal };
  });
}
