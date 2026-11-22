import { roadNeighborsFor, roadLinked } from './road-topology.ts';
/**
 * Water and power (rules chain-4). Supply enters the road network at the outside gateway (a fixed
 * contract) and at city-built plants with road frontage; pipes and lines follow connected roads.
 * Every building draws units by its use. When the network is short, buildings closest to a source
 * (by road distance, then id) are served first, so the farthest go dark. Pure functions of the city.
 */
import { GATEWAY, SIZE, type Building, type City } from './sim.ts';
import { factoryUtilities, type IndustryRules } from './industry-scale.ts';

export const UTILITY_KINDS = ['power', 'water'] as const;
export type UtilityKind = typeof UTILITY_KINDS[number];
export type Need = Record<UtilityKind, number>;
/** A city-built plant on one parcel; it supplies the network while it has connected road frontage. */
export type Plant = { id: number; cell: number; kind: UtilityKind; tick: number; level?: 2 | 3 };

/** Units each plant adds, its construction cost and its monthly upkeep (satang). */
export const PLANTS: Readonly<Record<UtilityKind, { capacity: number; cost: number; upkeep: number }>> = Object.freeze({
  power: Object.freeze({ capacity: 40, cost: 500_000, upkeep: 12_000 }),
  water: Object.freeze({ capacity: 40, cost: 300_000, upkeep: 6_000 }),
});
/** Upgrade costs are incremental, in satang; existing four-field plants remain level 1.
 * Keep historical prices stable: save validation reconciles every construction receipt. */
export type PlantLevel = 1 | 2 | 3;
export const PLANT_LEVELS = Object.freeze({
  power: Object.freeze([
    Object.freeze({ capacity: 40, upkeep: 12_000, upgradeCost: 0 }),
    Object.freeze({ capacity: 80, upkeep: 18_000, upgradeCost: 300_000 }),
    Object.freeze({ capacity: 160, upkeep: 30_000, upgradeCost: 600_000 }),
  ]),
  water: Object.freeze([
    Object.freeze({ capacity: 40, upkeep: 6_000, upgradeCost: 0 }),
    Object.freeze({ capacity: 80, upkeep: 9_000, upgradeCost: 180_000 }),
    Object.freeze({ capacity: 160, upkeep: 15_000, upgradeCost: 360_000 }),
  ]),
});
export const plantLevel = (plant: Plant): PlantLevel => plant.level ?? 1;
export function plantLevelSpec(kind: UtilityKind, level: PlantLevel) {
  if (!Number.isInteger(level) || level < 1 || level > 3) throw Error('Invalid plant level');
  return PLANT_LEVELS[kind][level - 1];
}
export const plantSpec = (plant: Plant) => plantLevelSpec(plant.kind, plantLevel(plant));
export const plantUpgradeReason = (kind: UtilityKind, id: number, level: PlantLevel) => `Upgrade ${PLANT_NAMES[kind]} #${id} to level ${level}`;
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

/**
 * Real bills (cities with `priceScale: 1`): homes and shops pay the Provincial Electricity Authority and the Provincial
 * Waterworks Authority directly, as people in Thailand do, so the money leaves the town; the town's plants only add
 * supply, and it no longer buys units at the gateway. One unit is a home's month: 200 kWh (the average home bill was
 * 905 baht in 2024, NSO energy survey) and 15 m³ (about 150 litres a person a day for three people, assumed). Prices,
 * paid at 18.5 real baht to one:
 * - homes, PEA residential rate from September 2026 bills (over 150 units a month): 3.00 baht a unit to 200, 4.1584 to
 *   400, 4.3583 above, service 24.62 baht a month;
 * - shops, PEA small general service 2.1.2 (May 2023 schedule): 3.2484 to 150 units, 4.2218 to 400, 4.4217 above,
 *   service 33.29;
 * - on every unit the Ft of September–December 2026, 16.23 satang, and on the whole bill VAT 7%;
 * - water, PWA user type 1 (homes): 10.20 baht a m³ to 10, 16.00 to 20, 19.00 to 30, 21.20 to 50, at least 50 baht;
 *   type 2 (shops, outside the concession areas): 16.00, 19.00, 20.00, 21.50 to 50, 21.60 to 80, 21.65 to 100, 21.70
 *   to 300, at least 150 baht; VAT 7%.
 * Mills pay their energy and water in their running costs (industry-scale.ts), and farmers take irrigation water free.
 */
export type BillRules = { priceScale?: 1; industryScale?: 1 };
export const REAL_UNIT = Object.freeze({ kWh: 200, m3: 15 });
type Band = readonly [upTo: number, baht: number];
export const REAL_TARIFFS = Object.freeze({
  ft: 0.1623, vat: 1.07,
  homePower: Object.freeze({ service: 24.62, bands: [[200, 3], [400, 4.1584], [Infinity, 4.3583]] as readonly Band[] }),
  shopPower: Object.freeze({ service: 33.29, bands: [[150, 3.2484], [400, 4.2218], [Infinity, 4.4217]] as readonly Band[] }),
  homeWater: Object.freeze({ minimum: 50, bands: [[10, 10.2], [20, 16], [30, 19], [50, 21.2], [80, 21.6], [100, 21.65], [Infinity, 21.7]] as readonly Band[] }),
  shopWater: Object.freeze({ minimum: 150, bands: [[10, 16], [20, 19], [30, 20], [50, 21.5], [80, 21.6], [100, 21.65], [Infinity, 21.7]] as readonly Band[] }),
});
const banded = (amount: number, bands: readonly Band[]) => { let sum = 0, from = 0; for (const [upTo, rate] of bands) { if (amount <= from) break; sum += (Math.min(amount, upTo) - from) * rate; from = upTo; } return sum; };
const satang = (baht: number) => Math.round(baht / 18.5 * 100);
/** A month's electricity bill for this many kWh, in satang: energy by band, Ft, service and VAT. */
export const realPowerBill = (kWh: number, who: 'home' | 'shop'): number => {
  const t = who === 'home' ? REAL_TARIFFS.homePower : REAL_TARIFFS.shopPower;
  return kWh > 0 ? satang((banded(kWh, t.bands) + kWh * REAL_TARIFFS.ft + t.service) * REAL_TARIFFS.vat) : 0;
};
/** A month's water bill for this many m³, in satang: by band, at least the minimum, VAT. */
export const realWaterBill = (m3: number, who: 'home' | 'shop'): number => {
  const t = who === 'home' ? REAL_TARIFFS.homeWater : REAL_TARIFFS.shopWater;
  return m3 > 0 ? satang(Math.max(t.minimum, banded(m3, t.bands)) * REAL_TARIFFS.vat) : 0;
};
/** A household's monthly bill with both supplied, under its city's rules. */
export const householdMonthlyBill = (rules: BillRules | undefined): number => rules?.priceScale === 1
  ? realPowerBill(REAL_UNIT.kWh, 'home') + realWaterBill(REAL_UNIT.m3, 'home') : HOUSEHOLD_BILL;
/** Who a bill is paid to: the town, or under real prices the electricity and water authorities outside it. */
export const billPayee = (rules: BillRules | undefined): 'treasury' | 'outside' => rules?.priceScale === 1 ? 'outside' : 'treasury';

export const UTILITY_LABELS: Readonly<Record<UtilityKind, string>> = Object.freeze({ power: 'ไฟฟ้า', water: 'น้ำประปา' });
export const PLANT_LABELS: Readonly<Record<UtilityKind, string>> = Object.freeze({ power: 'โรงไฟฟ้า', water: 'โรงสูบน้ำ' });
export const PLANT_NAMES: Readonly<Record<UtilityKind, string>> = Object.freeze({ power: 'power plant', water: 'water pump' });

const none = (): Need => ({ power: 0, water: 0 });

/**
 * Units a building draws. Homes: one of each per household living there. Markets and shops: power
 * by level, one water. Factories: by size (industry-scale.ts). Farms: water by level (irrigation).
 */
export function buildingNeed(zone: Building['zone'], level: number, households = 0, rules?: IndustryRules): Need {
  if (zone === 'R') return { power: households * HOUSEHOLD_NEED.power, water: households * HOUSEHOLD_NEED.water };
  if (zone === 'C') return { power: level, water: 1 };
  if (zone === 'I') return factoryUtilities(level, rules);
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
  const online = new Set(c.plants.filter(p => roadNeighborsFor(c,p.cell).some(n => roads.has(n))).map(p => p.id));
  const plants = none();
  for (const p of c.plants) if (online.has(p.id)) plants[p.kind] += plantSpec(p).capacity;
  const capacity = { power: c.utilities.outside.power + plants.power, water: c.utilities.outside.water + plants.water };
  // A water source cannot give a building priority for power, or vice versa.
  const roadDistances = (kind: UtilityKind) => {
    const distances = new Map<number, number>(), queue: number[] = [];
    const seed = (i: number) => { if (roads.has(i) && !distances.has(i)) { distances.set(i, 0); queue.push(i); } };
    // A gateway with no contract for this utility is not an active source.
    // With no source at all, retain the gateway seed so connected zero-need
    // buildings still have a network distance and can be marked served.
    if (c.utilities.outside[kind] > 0 || plants[kind] === 0) seed(GATEWAY);
    for (const p of c.plants) if (p.kind === kind && online.has(p.id)) for (const n of roadNeighborsFor(c,p.cell)) seed(n);
    for (let q = 0; q < queue.length; q++) for (const n of roadNeighborsFor(c,queue[q])) if (roads.has(n) && roadLinked(c,queue[q],n) && !distances.has(n)) { distances.set(n, distances.get(queue[q])! + 1); queue.push(n); }
    return distances;
  };
  const roadsByKind = { power: roadDistances('power'), water: roadDistances('water') };
  const households = new Map<number, number>();
  for (const h of c.households) if (h.home !== null) households.set(h.home, (households.get(h.home) ?? 0) + 1);
  const distance = new Map<number, number>(), distanceByKind = { power: new Map<number, number>(), water: new Map<number, number>() }, need = new Map<number, Need>(), served = new Map<number, Record<UtilityKind, boolean>>();
  for (const b of c.buildings) {
    need.set(b.id, buildingNeed(b.zone, b.level, households.get(b.id) ?? 0, c));
    for (const kind of UTILITY_KINDS) {
      const roadDistance = roadsByKind[kind];
      const d = Math.min(...roadNeighborsFor(c,b.cell).map(n => roadDistance.get(n) ?? Infinity), roadDistance.get(b.cell) ?? Infinity);
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
/** A household's monthly bill at its home's current service, in satang, under its city's rules. */
export function householdBill(service: Service, homeId: number, rules?: BillRules): number {
  const s = service.served.get(homeId);
  if (!s) return 0;
  if (rules?.priceScale === 1) return (s.power ? realPowerBill(REAL_UNIT.kWh, 'home') : 0) + (s.water ? realWaterBill(REAL_UNIT.m3, 'home') : 0);
  return UTILITY_KINDS.reduce((sum, k) => sum + (s[k] ? HOUSEHOLD_NEED[k] * TARIFF[k] : 0), 0);
}
/** The building's monthly bill at the current service, in satang; zero for what is not supplied. Under real prices a shop
 * pays the business rates, while a real mill's energy and water are in its running costs and a farm's irrigation is free. */
export function buildingBill(service: Service, buildingId: number, zone?: Building['zone'], rules?: BillRules): number {
  const n = service.need.get(buildingId), s = service.served.get(buildingId);
  if (!n || !s) return 0;
  if (rules?.priceScale === 1 && zone) {
    if (zone === 'F' || zone === 'R' || (zone === 'I' && rules.industryScale === 1)) return 0;
    return (s.power ? realPowerBill(n.power * REAL_UNIT.kWh, 'shop') : 0) + (s.water ? realWaterBill(n.water * REAL_UNIT.m3, 'shop') : 0);
  }
  return UTILITY_KINDS.reduce((sum, k) => sum + (s[k] ? n[k] * TARIFF[k] : 0), 0);
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
