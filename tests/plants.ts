import { access, buildPlant, plantAt, utilities, type City } from '../src/sim.ts';
import { UTILITY_KINDS } from '../src/utilities.ts';

/**
 * What a player does when the network runs low: build a power plant or water pump on the empty,
 * unzoned, connected parcel with the poorest soil (lowest index on ties). Returns the plants built.
 */
export function keepSupplied(c: City, reserve = 6): number {
  let built = 0;
  for (const kind of UTILITY_KINDS) {
    if (utilities(c).spare[kind] >= reserve) continue;
    const site = c.cells.map((cell, i) => !cell.road && !cell.zone && cell.building === null && !plantAt(c, i) && access(c, i) ? i : -1).filter(i => i >= 0)
      .sort((a, b) => c.resources.fertility[a] - c.resources.fertility[b] || a - b)[0];
    if (site !== undefined && buildPlant(c, site, kind).ok) built++;
  }
  return built;
}
