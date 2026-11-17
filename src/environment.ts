/**
 * Pollution and land value: read-only maps derived from what stands in the city each day. Nothing here is saved,
 * so an old save simply reads its own buildings. Distance is the same Manhattan walking proxy the services use.
 */
import type { City } from './sim.ts';
import { expandedCellCoordinate } from './expanded-map-grid.ts';
import { civicCells } from './civic/sites.ts';

type Source = { cells: readonly number[]; strength: number; radius: number };

/** How much each kind of place pollutes at its own parcel, and how far it carries. */
export const POLLUTION = Object.freeze({
  factory: Object.freeze({ base: 20, perLevel: 8, max: 60, radius: 4 }),
  power: Object.freeze({ strength: 40, radius: 4 }),
  airport: Object.freeze({ strength: 30, radius: 5 }),
  /** A park cleans the air around it by this much, within this many cells. */
  park: Object.freeze({ cleaning: 15, radius: 3 }),
});
/** Happiness a home loses: one point for every this many points of pollution, up to the cap. */
export const POLLUTION_HAPPINESS_STEP = 5, POLLUTION_HAPPINESS_CAP = 15;

const distance = (a: number, b: number) => { const x = expandedCellCoordinate(a), y = expandedCellCoordinate(b); return Math.abs(x.x - y.x) + Math.abs(x.z - y.z); };

function sources(city: City): Source[] {
  const out: Source[] = [];
  for (const b of city.buildings) if (b.zone === 'I') out.push({ cells: [b.cell], strength: Math.min(POLLUTION.factory.max, POLLUTION.factory.base + POLLUTION.factory.perLevel * Math.max(0, b.level - 1)), radius: POLLUTION.factory.radius });
  for (const p of city.plants) if (p.kind === 'power') out.push({ cells: [p.cell], strength: POLLUTION.power.strength, radius: POLLUTION.power.radius });
  for (const site of city.civic?.sites ?? []) if (site.kind === 'airport') out.push({ cells: civicCells(site), strength: POLLUTION.airport.strength, radius: POLLUTION.airport.radius });
  return out;
}

/** A reader for pollution 0–100 at any parcel. Each source fades linearly to nothing one cell past its radius; parks clean nearby air. */
export function pollutionReader(city: City): (cell: number) => number {
  const list = sources(city);
  if (!list.length) return () => 0;
  return cell => {
    let total = 0;
    for (const s of list) {
      let d = Infinity; for (const part of s.cells) d = Math.min(d, distance(cell, part));
      if (d <= s.radius) total += s.strength * (1 - d / (s.radius + 1));
    }
    if (total > 0 && city.parks.some(p => distance(cell, p.cell) <= POLLUTION.park.radius)) total -= POLLUTION.park.cleaning;
    return Math.max(0, Math.min(100, Math.round(total)));
  };
}
export const pollutionMap = (city: City): number[] => { const read = pollutionReader(city); return city.cells.map((_, i) => read(i)); };
export const pollutionAt = (city: City, cell: number) => pollutionReader(city)(cell);
export const pollutionHappinessPoints = (pollution: number) => Math.min(POLLUTION_HAPPINESS_CAP, Math.floor(Math.max(0, pollution) / POLLUTION_HAPPINESS_STEP));

/** Land value 0–100: what a parcel offers (services and places in reach, a road) less the pollution on it. */
export function landValue(amenityPoints: number, roadAccess: boolean, pollution: number): number {
  return Math.max(0, Math.min(100, Math.round(30 + amenityPoints * 1.2 + (roadAccess ? 10 : 0) - pollution * 0.6)));
}
