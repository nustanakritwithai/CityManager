/** Per-district readings for the overview: who lives there and how the land and air are. Read-only. */
import { landValues, type City } from './sim.ts';
import { pollutionReader } from './environment.ts';
import type { District } from './districts.ts';

export type DistrictStats = { id: number; name: string; parcels: number; buildings: number; households: number; people: number; happiness: number | null; pollution: number | null; landValue: number | null };
export function districtStats(city: City): DistrictStats[] {
  const air = pollutionReader(city), worth = landValues(city), homes = new Map(city.buildings.map(b => [b.id, b.cell]));
  const scores = new Map((city.happiness?.rows ?? []).map(row => [row.householdId, row.score]));
  const mean = (values: number[]) => values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null;
  return (city.districts?.list ?? []).map((d: District) => {
    const cells = new Set(d.cells), living = city.households.filter(h => h.home !== null && cells.has(homes.get(h.home)!));
    return {
      id: d.id, name: d.name, parcels: d.cells.length, buildings: city.buildings.filter(b => cells.has(b.cell)).length,
      households: living.length, people: living.reduce((n, h) => n + h.members, 0),
      happiness: mean(living.flatMap(h => scores.has(h.id) ? [scores.get(h.id)!] : [])),
      pollution: mean(living.map(h => air(homes.get(h.home!)!))),
      landValue: mean(d.cells.filter(cell => !city.cells[cell]?.road).map(worth)),
    };
  });
}
