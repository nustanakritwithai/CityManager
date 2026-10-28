/**
 * One read-only snapshot for the city stats overlay: services, buildings by level and kind,
 * population and labour by skill, and crop and goods stocks. Nothing here mutates the city.
 */
import { MONTH, WAGES, access, connectedRoads, firmCapacity, firmWorkerCount, isMarket, summary, utilityStatus, type City, type Firm } from './sim.ts';
import { PARK_STAFF, parkWorkers } from './parks.ts';
import { cityOverview } from './context-data.ts';

export type BuildingKind = 'R' | 'market' | 'shop' | 'I' | 'F';
export const BUILDING_KINDS: readonly BuildingKind[] = Object.freeze(['R', 'market', 'shop', 'I', 'F']);
export type SkillKey = 'general' | 'manufacturing' | 'retail';
export const SKILLS: readonly SkillKey[] = Object.freeze(['general', 'manufacturing', 'retail']);

export type CityStats = {
  tick: number;
  services: { power: boolean; water: boolean; powerUsed: number; powerCapacity: number; waterUsed: number; waterCapacity: number; plants: number; unservedPower: number; unservedWater: number; roads: number; connectedRoads: number; upkeepPerDay: number; disconnectedBuildings: number; treasury: number; income: number; expense: number; net: number };
  buildings: { levels: number[]; rows: Record<number, Record<BuildingKind, number>>; totals: Record<BuildingKind, number>; all: number };
  people: { population: number; households: number; workforce: number; dependents: number; employed: number; unemployed: number; homeless: number; homelessPersons: number; occupiedPersons: number; personCapacity: number; occupiedHomes: number; homeSlots: number };
  labour: { skill: SkillKey; supply: number; employed: number; owners: number; idle: number }[];
  jobs: { kind: 'I' | 'F' | 'shop' | 'market' | 'park'; firms: number; capacity: number; workers: number; wage: number }[];
  stocks: { crops: { farm: number; market: number; factory: number }; goods: { factory: number; shop: number }; harvested: number; processed: number; produced: number; consumed: number; imported: number; exported: number };
};

const kindOf = (firm: Firm | undefined, zone: string): BuildingKind => zone === 'C' ? (firm && !isMarket(firm) ? 'shop' : 'market') : zone as BuildingKind;
const zeroRow = (): Record<BuildingKind, number> => ({ R: 0, market: 0, shop: 0, I: 0, F: 0 });

export function cityStats(city: City): CityStats {
  const s = summary(city), o = cityOverview(city, s), connected = connectedRoads(city), roads = city.cells.filter(c => c.road).length;
  const rows: Record<number, Record<BuildingKind, number>> = {}, totals = zeroRow();
  for (const b of city.buildings) {
    const kind = kindOf(city.firms.find(f => f.building === b.id), b.zone);
    (rows[b.level] ??= zeroRow())[kind]++; totals[kind]++;
  }
  const labour = SKILLS.map(skill => {
    const supply = city.households.reduce((n, h) => n + h.workerSkills[skill], 0);
    const employed = [...city.employment, ...city.parks.flatMap(p => p.staffing?.allocations ?? [])].filter(e => e.skill === skill).reduce((n, e) => n + e.workers, 0);
    const owners = city.ownerLabor.filter(e => e.skill === skill).length;
    return { skill, supply, employed, owners, idle: Math.max(0, supply - employed - owners) };
  });
  const jobs: CityStats['jobs'] = (['I', 'F', 'shop', 'market'] as const).map(kind => {
    const firms = city.firms.filter(f => kindOf(f, f.zone) === kind);
    const buildings = firms.map(f => city.buildings.find(b => b.id === f.building)!).filter(Boolean);
    return {
      kind, firms: firms.length, capacity: buildings.reduce((n, b) => n + firmCapacity(b), 0),
      workers: firms.reduce((n, f) => n + firmWorkerCount(city, f.id), 0), wage: kind === 'market' ? 0 : WAGES[kind === 'shop' ? 'C' : kind],
    };
  });
  if (city.parks.length) jobs.push({ kind: 'park', firms: city.parks.length, capacity: city.parks.length * PARK_STAFF.slots, workers: city.parks.reduce((n, p) => n + parkWorkers(p), 0), wage: PARK_STAFF.monthlyWage });
  const crop = { farm: 0, market: 0, factory: 0 }, goods = { factory: 0, shop: 0 };
  for (const f of city.firms) {
    if (f.zone === 'F') crop.farm += f.cropInventory; else if (f.zone === 'I') { crop.factory += f.cropInventory; goods.factory += f.inventory; }
    else if (isMarket(f)) crop.market += f.cropInventory; else goods.shop += f.inventory;
  }
  const u = utilityStatus(city);
  return {
    tick: city.tick,
    services: { power: u.power, water: u.water, powerUsed: u.used.power, powerCapacity: u.capacity.power, waterUsed: u.used.water, waterCapacity: u.capacity.water, plants: u.plants, unservedPower: u.unserved.power, unservedWater: u.unserved.water, roads, connectedRoads: connected.size, upkeepPerDay: roads * 10, disconnectedBuildings: city.buildings.filter(b => !access(city, b.cell)).length, treasury: o.treasury, income: o.income, expense: o.expense, net: o.net },
    buildings: { levels: Object.keys(rows).map(Number).sort((a, b) => a - b), rows, totals, all: city.buildings.length },
    people: { population: s.population, households: s.households, workforce: s.workforce, dependents: o.dependents, employed: s.employed, unemployed: s.unemployed, homeless: o.homeless, homelessPersons: o.homelessPersons, occupiedPersons: o.occupiedPersons, personCapacity: o.personCapacity, occupiedHomes: o.occupiedHomeSlots, homeSlots: o.homeSlots },
    labour, jobs,
    stocks: { crops: crop, goods, harvested: o.cropHarvested, processed: o.cropProcessed, produced: o.produced, consumed: o.consumed, imported: o.imported, exported: o.exported },
  };
}
export const STATS_WINDOW = MONTH;
