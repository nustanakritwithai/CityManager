/**
 * Water and power (rules chain-4). Supply enters the road network at the outside gateway (a fixed
 * contract) and at city-built plants with road frontage; pipes and lines follow connected roads.
 * Every building draws units by its use. When the network is short, buildings closest to a source
 * (by road distance, then id) are served first, so the farthest go dark. Pure functions of the city.
 */
import { GATEWAY, SIZE, type Building, type City } from './sim.ts';

export const UTILITY_KINDS = ['power', 'water'] as const;
export type UtilityKind = typeof UTILITY_KINDS[number];
export type Need = Record<UtilityKind, number>;
/** A city-built plant on one parcel; it supplies the network while it has connected road frontage. */
export type Plant = { id: number; cell: number; kind: UtilityKind; tick: number };

/** Units each plant adds, its construction cost and its monthly upkeep (satang). */
export const PLANTS: Readonly<Record<UtilityKind, { capacity: number; cost: number; upkeep: number }>> = Object.freeze({
  power: Object.freeze({ capacity: 40, cost: 500_000, upkeep: 12_000 }),
  water: Object.freeze({ capacity: 40, cost: 300_000, upkeep: 6_000 }),
});
/** The outside contract a new city starts with at the gateway, in units. */
export const OUTSIDE_SUPPLY: Readonly<Need> = Object.freeze({ power: 20, water: 20 });
/** What a served user pays the city per unit each month (satang). */
export const TARIFF: Readonly<Need> = Object.freeze({ power: 500, water: 300 });
/** What the city pays outside per gateway unit actually used each month (satang). */
export const OUTSIDE_PRICE: Readonly<Need> = Object.freeze({ power: 400, water: 200 });
/** One household draws one unit of each; its monthly bill. */
export const HOUSEHOLD_NEED: Readonly<Need> = Object.freeze({ power: 1, water: 1 });
export const HOUSEHOLD_BILL = HOUSEHOLD_NEED.power * TARIFF.power + HOUSEHOLD_NEED.water * TARIFF.water;
export const MAX_PLANTS = 32;

export const UTILITY_LABELS: Readonly<Record<UtilityKind, string>> = Object.freeze({ power: 'ไฟฟ้า', water: 'น้ำประปา' });
export const PLANT_LABELS: Readonly<Record<UtilityKind, string>> = Object.freeze({ power: 'โรงไฟฟ้า', water: 'โรงสูบน้ำ' });
export const PLANT_NAMES: Readonly<Record<UtilityKind, string>> = Object.freeze({ power: 'power plant', water: 'water pump' });

const none = (): Need => ({ power: 0, water: 0 });
const neighbors = (i: number) => [i % SIZE ? i - 1 : -1, i % SIZE < SIZE - 1 ? i + 1 : -1, i >= SIZE ? i - SIZE : -1, i < SIZE * (SIZE - 1) ? i + SIZE : -1].filter(n => n >= 0 && n < SIZE * SIZE);

/**
 * Units a building draws. Homes: one of each per household living there. Markets and shops: power
 * by level, one water. Factories: level + 2 power, level + 1 water. Farms: water by level (irrigation).
 */
export function buildingNeed(zone: Building['zone'], level: number, households = 0): Need {
  if (zone === 'R') return { power: households * HOUSEHOLD_NEED.power, water: households * HOUSEHOLD_NEED.water };
  if (zone === 'C') return { power: level, water: 1 };
  if (zone === 'I') return { power: level + 2, water: level + 1 };
  return { power: 0, water: level };
}
export const fits = (spare: Need, need: Need) => spare.power >= need.power && spare.water >= need.water;

export type Service = {
  /** Gateway contract plus online plants. */
  capacity: Need; plants: Need; used: Need; spare: Need;
  /** Units drawn from the gateway contract (plants are used first). */
  outside: Need;
  /** Per building: whether each kind it needs is supplied, and what it draws. */
  served: Map<number, Record<UtilityKind, boolean>>; need: Map<number, Need>;
  /** Road distance to the nearest source, per building on the network. */
  distance: Map<number, number>;
  online: Set<number>;
  ok(buildingId: number): boolean;
};

/** Parcels next to a connected road, nearest-source distances along roads, and who gets served. */
export function utilityService(c: City, roads: ReadonlySet<number>): Service {
  const online = new Set(c.plants.filter(p => neighbors(p.cell).some(n => roads.has(n))).map(p => p.id));
  const plants = none();
  for (const p of c.plants) if (online.has(p.id)) plants[p.kind] += PLANTS[p.kind].capacity;
  const capacity = { power: c.utilities.outside.power + plants.power, water: c.utilities.outside.water + plants.water };
  // A water source cannot give a building priority for power, or vice versa.
  const roadDistances = (kind: UtilityKind) => {
    const distances = new Map<number, number>(), queue: number[] = [];
    const seed = (i: number) => { if (roads.has(i) && !distances.has(i)) { distances.set(i, 0); queue.push(i); } };
    // A gateway with no contract for this utility is not an active source.
    // With no source at all, retain the gateway seed so connected zero-need
    // buildings still have a network distance and can be marked served.
    if (c.utilities.outside[kind] > 0 || plants[kind] === 0) seed(GATEWAY);
    for (const p of c.plants) if (p.kind === kind && online.has(p.id)) for (const n of neighbors(p.cell)) seed(n);
    for (let q = 0; q < queue.length; q++) for (const n of neighbors(queue[q])) if (roads.has(n) && !distances.has(n)) { distances.set(n, distances.get(queue[q])! + 1); queue.push(n); }
    return distances;
  };
  const roadsByKind = { power: roadDistances('power'), water: roadDistances('water') };
  const households = new Map<number, number>();
  for (const h of c.households) if (h.home !== null) households.set(h.home, (households.get(h.home) ?? 0) + 1);
  const distance = new Map<number, number>(), distanceByKind = { power: new Map<number, number>(), water: new Map<number, number>() }, need = new Map<number, Need>(), served = new Map<number, Record<UtilityKind, boolean>>();
  for (const b of c.buildings) {
    need.set(b.id, buildingNeed(b.zone, b.level, households.get(b.id) ?? 0));
    for (const kind of UTILITY_KINDS) {
      const roadDistance = roadsByKind[kind];
      const d = Math.min(...neighbors(b.cell).map(n => roadDistance.get(n) ?? Infinity), roadDistance.get(b.cell) ?? Infinity);
      if (d < Infinity) distanceByKind[kind].set(b.id, d);
    }
    const d = Math.min(distanceByKind.power.get(b.id) ?? Infinity, distanceByKind.water.get(b.id) ?? Infinity);
    if (d < Infinity) distance.set(b.id, d);
  }
  const used = none(), remaining = { ...capacity };
  for (const b of c.buildings) served.set(b.id, { power: false, water: false });
  for (const kind of UTILITY_KINDS) {
    const d = distanceByKind[kind];
    const order = [...c.buildings].filter(b => d.has(b.id)).sort((a, b) => d.get(a.id)! - d.get(b.id)! || a.id - b.id);
    for (const b of order) {
      const n = need.get(b.id)!, s = served.get(b.id)!;
      if (n[kind] <= remaining[kind]) { s[kind] = true; remaining[kind] -= n[kind]; used[kind] += n[kind]; }
    }
  }
  const outside = { power: Math.max(0, used.power - plants.power), water: Math.max(0, used.water - plants.water) };
  return { capacity, plants, used, spare: remaining, outside, served, need, distance, online,
    ok: id => { const s = served.get(id); return !!s && s.power && s.water; } };
}
/** A household's monthly bill at its home's current service, in satang. */
export function householdBill(service: Service, homeId: number): number {
  const s = service.served.get(homeId);
  return s ? UTILITY_KINDS.reduce((sum, k) => sum + (s[k] ? HOUSEHOLD_NEED[k] * TARIFF[k] : 0), 0) : 0;
}
/** The building's monthly bill at the current service, in satang; zero for what is not supplied. */
export function buildingBill(service: Service, buildingId: number): number {
  const n = service.need.get(buildingId), s = service.served.get(buildingId);
  return n && s ? UTILITY_KINDS.reduce((sum, k) => sum + (s[k] ? n[k] * TARIFF[k] : 0), 0) : 0;
}

/** Buildings on the network that go without each kind today. */
export function unserved(service: Service): Record<UtilityKind, number> {
  const out = { power: 0, water: 0 };
  for (const id of service.distance.keys()) for (const kind of UTILITY_KINDS) if (!service.served.get(id)![kind]) out[kind]++;
  return out;
}
/** Whether every building on the network has this kind: the simple good/bad flag the HUD and panels show. */
export function utilityFlags(service: Service): Record<UtilityKind, boolean> {
  const out = unserved(service);
  return { power: out.power === 0, water: out.water === 0 };
}
