/**
 * Real commutes, one person at a time. Every working resident travels from the driveway of their home to
 * the driveway of their workplace along the shortest route on the class-aware road network, and goes by
 * the way a real person would: on foot when it is close, on the household's own motorcycle or car, as a
 * passenger in the family vehicle when a relative works at the same place, on a city bus line that serves
 * both ends, or on foot the long way when nothing else is there.
 *
 * Households buy their vehicles with their own savings and pay for the fuel they burn; bus riders pay the
 * fare to the city. Vehicles are kept in the optional `city.vehicles` save section, so a city where nobody
 * has bought one saves byte-identically. No randomness: the same city always plans the same trips.
 */
import type { City } from './sim.ts';
import { buildNetwork, TILE_LENGTH_M } from './traffic/network.ts';
import { linkTimes, shortestTree } from './traffic/routing.ts';
import { driveway } from './parking.ts';
import { busAccess } from './bus/mode-share.ts';
import { BUS_CAPACITY, BUS_FARE_SATANG } from './bus/types.ts';

/** Anyone whose route is this short walks, as people do for a few minutes' trip. */
export const WALK_MAX_M = 500;
export const WALK_KMH = 5, BUS_KMH = 25, BUS_WAIT_MIN = 5;
/** Satang a litre: about 35 baht in real life, scaled by the game's wages (a factory job pays 600 a month). */
export const FUEL_SATANG_PER_LITRE = 150;
export const VEHICLE_KINDS = ['motorcycle', 'car'] as const;
export type VehicleKind = typeof VEHICLE_KINDS[number];
export type VehicleSpec = { label: string; seats: number; price: number; mlPerKm: number; tankMl: number; space: number };
/**
 * Prices keep real proportions to wages: a motorcycle costs about three and a half months of a factory wage,
 * a car about two years. `space` is the share of one home parking space it takes: two motorcycles fit where
 * one car does.
 */
export const VEHICLE: Readonly<Record<VehicleKind, VehicleSpec>> = Object.freeze({
  motorcycle: Object.freeze({ label: 'มอเตอร์ไซค์', seats: 2, price: 210_000, mlPerKm: 22, tankMl: 4_000, space: .5 }),
  car: Object.freeze({ label: 'รถยนต์', seats: 4, price: 1_500_000, mlPerKm: 70, tankMl: 40_000, space: 1 }),
});
export type Vehicle = { id: number; householdId: number; kind: VehicleKind; bought: number; fuelMl: number; odometerM: number };
export type VehicleState = { version: 1; nextId: number; fleet: Vehicle[] };

export type CommuteMode = 'walk' | 'drive' | 'passenger' | 'bus' | 'walk-long' | 'unreachable';
export const MODE_LABEL: Readonly<Record<CommuteMode, string>> = Object.freeze({
  walk: 'เดิน', drive: 'ขับรถของบ้าน', passenger: 'นั่งรถคนในบ้าน', bus: 'รถเมล์', 'walk-long': 'เดินไกล (ไม่มีรถ)', unreachable: 'ไม่มีทางไปถึง',
});
export type WorkplaceKind = 'firm' | 'park' | 'venue' | 'campus';
export type Trip = {
  householdId: number; person: number; workplace: { kind: WorkplaceKind; id: number };
  from: number | null; to: number | null; route: number[] | null; distanceM: number;
  mode: CommuteMode; vehicleId: number | null; minutes: number | null;
  bus?: { lineId: number; fromStopId: number; toStopId: number; walkCells: number };
};

type Job = { householdId: number; workplace: Trip['workplace']; footprint: number[]; workers: number };
/** Everyone who goes to work today, one row per workplace a household sends people to. */
function jobs(c: City): Job[] {
  const cellOf = new Map(c.buildings.map(b => [b.id, b.cell])), out: Job[] = [];
  const homes = new Set(c.households.filter(h => h.home !== null).map(h => h.id));
  const add = (householdId: number, workplace: Trip['workplace'], footprint: (number | undefined)[], workers: number) => {
    const cells = footprint.filter((x): x is number => x !== undefined);
    if (homes.has(householdId) && workers > 0 && cells.length) out.push({ householdId, workplace, footprint: cells, workers });
  };
  const firms = new Map(c.firms.map(f => [f.id, f]));
  for (const a of c.employment) { const f = firms.get(a.firmId); add(a.householdId, { kind: 'firm', id: a.firmId }, [f && cellOf.get(f.building)], a.workers); }
  for (const a of c.ownerLabor) { const f = firms.get(a.firmId); add(a.householdId, { kind: 'firm', id: a.firmId }, [f && cellOf.get(f.building)], a.workers); }
  for (const p of c.parks) for (const a of p.staffing?.allocations ?? []) add(a.householdId, { kind: 'park', id: p.id }, [p.cell], a.workers);
  for (const s of c.civic?.sites ?? []) for (const a of s.staffing?.allocations ?? []) add(a.householdId, { kind: 'venue', id: s.id }, s.cells ?? [s.cell], a.workers);
  for (const p of c.education?.people ?? []) if (p.campusId !== null) {
    const campus = c.education!.campuses.find(x => x.id === p.campusId);
    add(p.householdId, { kind: 'campus', id: p.campusId }, [campus?.cell], p.teacher + p.professor);
  }
  return out;
}

const minutesAt = (metres: number, kmh: number) => metres / 1000 / kmh * 60;
type Roads = { key: string; net: ReturnType<typeof buildNetwork>; times: Map<string, number>; trees: Map<number, Map<number, number>> };
const roadCache = new WeakMap<City, Roads>();
/** The road network and its route trees, rebuilt only when a road, a junction, a direction or a road class changes. */
const roadKey = (c: City) => `${c.cells.map(cell => (cell.road ? 1 : 0)).join('')}|${JSON.stringify(c.roadTopology ?? null)}|${JSON.stringify(c.roadClasses ?? null)}`;
/** What a stored day depends on besides the date: roads, who works where, and the vehicles there are. */
const dayKey = (c: City) => `${roadKey(c)}|${c.employment.map(a => `${a.householdId}>${a.firmId}x${a.workers}`).join(',')}|${c.ownerLabor.map(a => `${a.householdId}>${a.firmId}`).join(',')}|${(c.vehicles?.fleet ?? []).map(v => `${v.id}:${v.householdId}`).join(',')}|${c.households.map(h => `${h.id}@${h.home}`).join(',')}`;
function roadsOf(c: City): Roads {
  const key = roadKey(c);
  const hit = roadCache.get(c);
  if (hit && hit.key === key) return hit;
  const net = buildNetwork(c), roads = { key, net, times: linkTimes(net, new Map()), trees: new Map<number, Map<number, number>>() };
  roadCache.set(c, roads);
  return roads;
}
const kindOrder = (v: Vehicle) => (v.kind === 'car' ? 0 : 1);

/**
 * Today's trips, read-only. Vehicles go to the longest trips first; a relative bound for the same place rides
 * along while seats remain. Fuel is not checked here (runCommutes does that when it buys fuel).
 */
export function planCommutes(c: City): Trip[] {
  const work = jobs(c);
  if (!work.length) return [];
  const { times, trees, net } = roadsOf(c);
  const route = (from: number, to: number): number[] | null => {
    if (from === to) return [from];
    let tree = trees.get(from); if (!tree) { tree = shortestTree(net, times, from); trees.set(from, tree); }
    if (!tree.has(to)) return null;
    const path = [to]; while (path[0] !== from) path.unshift(tree.get(path[0])!); return path;
  };
  const cellOf = new Map(c.buildings.map(b => [b.id, b.cell])), households = new Map(c.households.map(h => [h.id, h]));
  const drives = new Map<string, number | null>(), drive = (cells: number[]) => { const k = cells.join(','); if (!drives.has(k)) drives.set(k, driveway(c, cells)); return drives.get(k)!; };
  const trips: Trip[] = [];
  for (const job of work) {
    const h = households.get(job.householdId)!, home = cellOf.get(h.home!);
    const from = home === undefined ? null : drive([home]), to = drive(job.footprint);
    const path = from === null || to === null ? null : route(from, to);
    const distanceM = path ? (path.length - 1) * TILE_LENGTH_M : 0;
    for (let k = 0; k < job.workers; k++) trips.push({ householdId: job.householdId, person: 0, workplace: job.workplace, from, to, route: path, distanceM, mode: path ? 'walk' : 'unreachable', vehicleId: null, minutes: null });
  }
  const pathMinutes = (path: number[]) => { let s = 0; for (let k = 1; k < path.length; k++) s += times.get(`${path[k - 1]}>${path[k]}`) ?? 0; return s / 60; };
  const fleet = c.vehicles?.fleet ?? [], owned = new Map<number, Vehicle[]>();
  for (const v of fleet) { const list = owned.get(v.householdId); if (list) list.push(v); else owned.set(v.householdId, [v]); }
  const byHousehold = new Map<number, Trip[]>();
  for (const t of trips) { const list = byHousehold.get(t.householdId); if (list) list.push(t); else byHousehold.set(t.householdId, [t]); }
  const busy = new Map<number, number>(); // riders per bus line
  for (const [householdId, list] of [...byHousehold].sort((a, b) => a[0] - b[0])) {
    list.sort((a, b) => b.distanceM - a.distanceM || (a.to ?? -1) - (b.to ?? -1) || a.workplace.id - b.workplace.id);
    list.forEach((t, k) => { t.person = k + 1; });
    const free = [...(owned.get(householdId) ?? [])].sort((a, b) => kindOrder(a) - kindOrder(b) || a.id - b.id);
    for (const t of list) {
      if (t.mode !== 'walk' || !t.route) continue;
      if (t.distanceM <= WALK_MAX_M) { t.minutes = minutesAt(t.distanceM, WALK_KMH); continue; }
      const vehicle = free.shift();
      if (vehicle) {
        Object.assign(t, { mode: 'drive', vehicleId: vehicle.id, minutes: pathMinutes(t.route) });
        let seats = VEHICLE[vehicle.kind].seats - 1;
        for (const other of list) if (seats > 0 && other !== t && other.mode === 'walk' && other.vehicleId === null && other.to === t.to && other.distanceM > WALK_MAX_M) {
          Object.assign(other, { mode: 'passenger', vehicleId: vehicle.id, minutes: t.minutes }); seats--;
        }
        continue;
      }
      const access = c.bus && t.from !== null && t.to !== null ? busAccess(t.from, t.to, c.bus.stops, c.bus.lines, 24) : null;
      const line = access && c.bus!.lines.find(l => l.id === access.lineId);
      if (access && line && (busy.get(line.id) ?? 0) < line.busCount * BUS_CAPACITY[line.busLevel]) {
        busy.set(line.id, (busy.get(line.id) ?? 0) + 1);
        Object.assign(t, { mode: 'bus', minutes: access.walkMinutes + BUS_WAIT_MIN + minutesAt(t.distanceM, BUS_KMH), bus: { lineId: access.lineId, fromStopId: access.fromStopId, toStopId: access.toStopId, walkCells: access.walkCells } });
        continue;
      }
      Object.assign(t, { mode: 'walk-long', minutes: minutesAt(t.distanceM, WALK_KMH) });
    }
  }
  return trips;
}

/** Satang this wallet paid out over the last 30 days, other than for vehicles: what it keeps back before buying one. */
function monthlySpending(c: City, wallet: string): number {
  let total = 0;
  for (let i = c.ledger.length - 1; i >= 0 && c.ledger[i].tick > c.tick - 30; i--) {
    const e = c.ledger[i]; if (e.from === wallet && !e.reason.startsWith('Vehicle bought')) total += e.amount;
  }
  return total;
}
export const vehiclePurchaseReason = (kind: VehicleKind, id: number) => `Vehicle bought ${kind} #${id}`;
export const fuelReason = (id: number) => `Vehicle fuel #${id}`;
export const BUS_FARE_REASON = 'Bus fare';
const spaceUsed = (fleet: readonly Vehicle[], householdId: number) => fleet.filter(v => v.householdId === householdId).reduce((n, v) => n + VEHICLE[v.kind].space, 0);

/** Start the vehicle section, keeping the key order a reload gives (household wellbeing and tax policy stay last). */
function openVehicles(c: City): VehicleState {
  c.vehicles = { version: 1, nextId: 1, fleet: [] };
  for (const key of ['happiness', 'taxPolicy'] as const) if (key in c) { const value = c[key]; delete c[key]; Object.assign(c, { [key]: value }); }
  return c.vehicles;
}
export type CommuteDay = { tick: number; key: string; trips: Trip[]; bought: Vehicle[] };
const days = new WeakMap<City, CommuteDay>();
type Pay = (from: string, to: string, amount: number, reason: string) => number;

/**
 * One day of commuting: every driver buys a tank of fuel when the trip there and back would run it dry (and
 * stays home if the household cannot pay, its people going by bus or on foot instead), bus riders pay the
 * fare both ways, and a household whose people had no vehicle for a long trip buys one when its savings,
 * after a month of its usual spending, cover the price and its home has a parking space for it.
 */
export function runCommutes(c: City, pay: Pay): CommuteDay {
  if (c.vehicles) c.vehicles = liveVehicles(c);
  const trips = planCommutes(c), bought: Vehicle[] = [];
  const households = new Map(c.households.map(h => [h.id, h])), wallet = new Map(c.households.map(h => [h.id, h.wallet]));
  const balance = (householdId: number) => c.accounts[wallet.get(householdId)!] ?? 0;
  const vehicle = new Map((c.vehicles?.fleet ?? []).map(v => [v.id, v]));
  const strand = (t: Trip) => Object.assign(t, { mode: 'walk-long' as const, vehicleId: null, minutes: minutesAt(t.distanceM, WALK_KMH) });
  for (const t of trips) {
    if (t.mode !== 'drive') continue;
    const v = vehicle.get(t.vehicleId!)!, spec = VEHICLE[v.kind], need = Math.round(2 * t.distanceM * spec.mlPerKm / 1000);
    if (v.fuelMl < need) {
      const cost = Math.round((spec.tankMl - v.fuelMl) / 1000 * FUEL_SATANG_PER_LITRE);
      if (balance(t.householdId) >= cost && pay(wallet.get(t.householdId)!, 'outside', cost, fuelReason(v.id)) === cost) v.fuelMl = spec.tankMl;
    }
    if (v.fuelMl < need) { for (const o of trips) if (o.vehicleId === v.id) strand(o); continue; }
    v.fuelMl -= need; v.odometerM += 2 * t.distanceM;
  }
  for (const t of trips) if (t.mode === 'bus') {
    const fare = 2 * BUS_FARE_SATANG;
    if (balance(t.householdId) < fare || pay(wallet.get(t.householdId)!, 'treasury', fare, BUS_FARE_REASON) !== fare) { delete t.bus; strand(t); }
  }
  const needing = [...new Set(trips.filter(t => t.mode === 'walk-long' || t.mode === 'bus').map(t => t.householdId))].sort((a, b) => a - b);
  for (const householdId of needing) {
    const fleet = c.vehicles?.fleet ?? [], room = 1 - spaceUsed(fleet, householdId), h = households.get(householdId)!;
    const spare = balance(householdId) - monthlySpending(c, h.wallet);
    const kind = fleet.every(v => v.householdId !== householdId) && room >= VEHICLE.car.space && spare >= VEHICLE.car.price ? 'car'
      : room >= VEHICLE.motorcycle.space && spare >= VEHICLE.motorcycle.price ? 'motorcycle' : null;
    if (!kind) continue;
    const id = c.vehicles?.nextId ?? 1;
    if (pay(h.wallet, 'outside', VEHICLE[kind].price, vehiclePurchaseReason(kind, id)) !== VEHICLE[kind].price) continue;
    const state = c.vehicles ?? openVehicles(c);
    const v: Vehicle = { id, householdId, kind, bought: c.tick, fuelMl: VEHICLE[kind].tankMl, odometerM: 0 };
    state.fleet.push(v); state.nextId++; bought.push(v);
  }
  const day = { tick: c.tick, key: dayKey(c), trips, bought };
  days.set(c, day);
  return day;
}
/**
 * Today's trips as they happened when the city last stepped, or as planned now after a load or after an edit to
 * roads, jobs, homes or vehicles (a plan made now is kept until the next change, so the screen can ask every frame).
 */
export function commutesToday(c: City): Trip[] {
  const day = days.get(c), key = dayKey(c);
  if (day && day.tick === c.tick && day.key === key) return day.trips;
  const planned = { tick: c.tick, key, trips: planCommutes(c), bought: [] };
  days.set(c, planned);
  return planned.trips;
}

/** The fleet as it should be saved: vehicles whose household has left the city went with it. */
export function liveVehicles(c: Pick<City, 'vehicles' | 'households'>): VehicleState | undefined {
  if (!c.vehicles) return undefined;
  const here = new Set(c.households.map(h => h.id));
  return { version: 1, nextId: c.vehicles.nextId, fleet: c.vehicles.fleet.filter(v => here.has(v.householdId)) };
}
/** Throws on a malformed vehicle section. Runs only when `vehicles` is present. */
export function validateVehicles(value: unknown, c: Pick<City, 'households' | 'tick'>): asserts value is VehicleState {
  const fail = (why: string): never => { throw new Error(`Invalid vehicles save: ${why}`); };
  const s = value as VehicleState;
  if (!s || typeof s !== 'object' || Array.isArray(s) || Object.keys(s).sort().join(',') !== 'fleet,nextId,version' || s.version !== 1 || !Number.isSafeInteger(s.nextId) || s.nextId < 2 || !Array.isArray(s.fleet)) fail('envelope');
  const households = new Set(c.households.map(h => h.id)), space = new Map<number, number>();
  let last = 0;
  for (const v of s.fleet) {
    if (!v || typeof v !== 'object' || Object.keys(v).sort().join(',') !== 'bought,fuelMl,householdId,id,kind,odometerM') fail('vehicle');
    if (!Number.isSafeInteger(v.id) || v.id <= last || v.id >= s.nextId) fail('id');
    if (!households.has(v.householdId)) fail('household');
    if (!VEHICLE_KINDS.includes(v.kind)) fail('kind');
    if (!Number.isSafeInteger(v.bought) || v.bought < 0 || v.bought > c.tick) fail('bought');
    if (!Number.isSafeInteger(v.fuelMl) || v.fuelMl < 0 || v.fuelMl > VEHICLE[v.kind].tankMl) fail('fuel');
    if (!Number.isSafeInteger(v.odometerM) || v.odometerM < 0) fail('odometer');
    const used = (space.get(v.householdId) ?? 0) + VEHICLE[v.kind].space;
    if (used > 1) fail('parking'); space.set(v.householdId, used);
    last = v.id;
  }
}
