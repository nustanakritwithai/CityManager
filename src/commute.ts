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
import { bprTime, linkTimes, shortestTree } from './traffic/routing.ts';
import { driveway } from './parking.ts';
import { roadLinked, roadNeighborsFor } from './road-topology.ts';
import { parkPedestrianRoute } from './park-activity.ts';
import { busAccess } from './bus/mode-share.ts';
import { BUS_CAPACITY, BUS_FARE_SATANG } from './bus/types.ts';
import { TAXI_DEPOT_UNITS } from './taxi/sites.ts';
import { civicFeeReason, type CivicKind } from './civic/sites.ts';
import { taxiFareSatang } from './taxi/mode-share.ts';

/** Anyone whose route is this short walks, as people do for a few minutes' trip. */
export const WALK_MAX_M = 500;
export const WALK_KMH = 5, BUS_KMH = 25, BUS_WAIT_MIN = 5;
/** Trips one taxi can make in a morning rush: a depot's cars are shared out this many times. */
export const TAXI_TRIPS_PER_CAR = 3;
/** Commuters leave over the three-hour morning rush (06:30–09:30, as on the map), so a road carries a third of its rush in an hour. */
export const RUSH_HOURS = 3;
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

export type CommuteMode = 'walk' | 'drive' | 'passenger' | 'bus' | 'taxi' | 'walk-long' | 'unreachable';
export const MODE_LABEL: Readonly<Record<CommuteMode, string>> = Object.freeze({
  walk: 'เดิน', drive: 'ขับรถของบ้าน', passenger: 'นั่งรถคนในบ้าน', bus: 'รถเมล์', taxi: 'แท็กซี่', 'walk-long': 'เดินไกล (ไม่มีรถ)', unreachable: 'ไม่มีทางไปถึง',
});
export type WorkplaceKind = 'firm' | 'park' | 'venue' | 'campus';
export type Trip = {
  householdId: number; person: number; workplace: { kind: WorkplaceKind; id: number };
  from: number | null; to: number | null; route: number[] | null; distanceM: number;
  mode: CommuteMode; vehicleId: number | null;
  /** Door-to-door minutes today, in whatever traffic the city's own vehicles make on the route. */
  minutes: number | null;
  /** The same trip on empty roads, so `minutes - freeMinutes` is the time lost in jams. Set only for trips by car, motorcycle or taxi. */
  freeMinutes?: number | null;
  /** The job earns a day's work credit when worked, so missing it costs that day's pay. */
  wage: boolean;
  bus?: { lineId: number; fromStopId: number; toStopId: number; walkCells: number };
  /** The depot whose taxi picks this person up at home, drives them there and back, and the fare one way in satang. */
  taxi?: { depotId: number; depotCell: number; fare: number };
};

/** `wage`: the job earns a day's work credit when worked (employees, park staff, staff of a city-run venue). */
type Job = { householdId: number; workplace: Trip['workplace']; footprint: number[]; workers: number; wage: boolean };
/** The walking route between two road parcels (fewest parcels, then lowest parcel numbers), or null when no linked street joins them. */
function walkRoute(c: City, from: number, to: number): number[] | null {
  if (from === to) return [from];
  const roads = roadsOf(c);
  let tree = roads.walks.get(from);
  if (!tree) {
    tree = new Map([[from, -1]]);
    for (let q = [from], i = 0; i < q.length; i++) for (const n of roadNeighborsFor(c, q[i]).sort((a, b) => a - b)) {
      if (tree.has(n) || !c.cells[n]?.road || !roadLinked(c, q[i], n)) continue;
      tree.set(n, q[i]); q.push(n);
    }
    roads.walks.set(from, tree);
  }
  if (!tree.has(to)) return null;
  const path = [to]; while (path[0] !== from) path.unshift(tree.get(path[0])!); return path;
}

/** Everyone who goes to work today, one row per workplace a household sends people to. */
function jobs(c: City): Job[] {
  const cellOf = new Map(c.buildings.map(b => [b.id, b.cell])), out: Job[] = [];
  const homes = new Set(c.households.filter(h => h.home !== null).map(h => h.id));
  const add = (householdId: number, workplace: Trip['workplace'], footprint: (number | undefined)[], workers: number, wage: boolean) => {
    const cells = footprint.filter((x): x is number => x !== undefined);
    if (homes.has(householdId) && workers > 0 && cells.length) out.push({ householdId, workplace, footprint: cells, workers, wage });
  };
  const firms = new Map(c.firms.map(f => [f.id, f]));
  for (const a of c.employment) { const f = firms.get(a.firmId); add(a.householdId, { kind: 'firm', id: a.firmId }, [f && cellOf.get(f.building)], a.workers, true); }
  for (const a of c.ownerLabor) { const f = firms.get(a.firmId); add(a.householdId, { kind: 'firm', id: a.firmId }, [f && cellOf.get(f.building)], a.workers, false); }
  for (const p of c.parks) for (const a of p.staffing?.allocations ?? []) add(a.householdId, { kind: 'park', id: p.id }, [p.cell], a.workers, true);
  for (const s of c.civic?.sites ?? []) for (const a of s.staffing?.allocations ?? []) add(a.householdId, { kind: 'venue', id: s.id }, s.cells ?? [s.cell], a.workers, !s.operator);
  for (const p of c.education?.people ?? []) if (p.campusId !== null) {
    const campus = c.education!.campuses.find(x => x.id === p.campusId);
    add(p.householdId, { kind: 'campus', id: p.campusId }, [campus?.cell], p.teacher + p.professor, false);
  }
  return out;
}

const minutesAt = (metres: number, kmh: number) => metres / 1000 / kmh * 60;
/** `walks` are walking-route trees: on foot a person follows any linked street, whichever way its one-way arrows point. */
type Roads = { key: string; net: ReturnType<typeof buildNetwork>; times: Map<string, number>; trees: Map<number, Map<number, number>>; walks: Map<number, Map<number, number>> };
const roadCache = new WeakMap<City, Roads>();
/** The road network and its route trees, rebuilt only when a road, a junction, a direction or a road class changes. */
const roadKey = (c: City) => `${c.cells.map(cell => (cell.road ? 1 : 0)).join('')}|${JSON.stringify(c.roadTopology ?? null)}|${JSON.stringify(c.roadClasses ?? null)}`;
/** What a stored day depends on besides the date: roads, who works where, homes, the vehicles there are, and the taxis and bus lines that run. */
const dayKey = (c: City) => `${roadKey(c)}|${c.employment.map(a => `${a.householdId}>${a.firmId}x${a.workers}`).join(',')}|${c.ownerLabor.map(a => `${a.householdId}>${a.firmId}`).join(',')}|${(c.vehicles?.fleet ?? []).map(v => `${v.id}:${v.householdId}`).join(',')}|${c.households.map(h => `${h.id}@${h.home}`).join(',')}|${JSON.stringify(c.taxi?.depots ?? null)}|${JSON.stringify(c.bus?.lines ?? null)}|${(c.bus?.stops ?? []).map(x => `${x.id}@${x.cell}`).join(',')}`;
function roadsOf(c: City): Roads {
  const key = roadKey(c);
  const hit = roadCache.get(c);
  if (hit && hit.key === key) return hit;
  const net = buildNetwork(c), roads = { key, net, times: linkTimes(net, new Map()), trees: new Map<number, Map<number, number>>(), walks: new Map<number, Map<number, number>>() };
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
    // Everyone can at least walk the linked streets; a vehicle below needs a legal driving route there and back.
    let path = from === null || to === null ? null : walkRoute(c, from, to);
    // Park and venue staff need no road to their post: they walk the park footpaths across open ground, as park visitors do.
    if (!path && home !== undefined && (job.workplace.kind === 'park' || job.workplace.kind === 'venue')) { const foot = parkPedestrianRoute(c, home, job.footprint[0]); if (foot.length) path = foot; }
    const distanceM = path ? (path.length - 1) * TILE_LENGTH_M : 0;
    for (let k = 0; k < job.workers; k++) trips.push({ householdId: job.householdId, person: 0, workplace: job.workplace, from, to, route: path, distanceM, mode: path ? 'walk' : 'unreachable', vehicleId: null, minutes: null, wage: job.wage });
  }
  const pathMinutes = (path: number[]) => { let s = 0; for (let k = 1; k < path.length; k++) s += times.get(`${path[k - 1]}>${path[k]}`) ?? 0; return s / 60; };
  const fleet = c.vehicles?.fleet ?? [], owned = new Map<number, Vehicle[]>();
  for (const v of fleet) { const list = owned.get(v.householdId); if (list) list.push(v); else owned.set(v.householdId, [v]); }
  const byHousehold = new Map<number, Trip[]>();
  for (const t of trips) { const list = byHousehold.get(t.householdId); if (list) list.push(t); else byHousehold.set(t.householdId, [t]); }
  const busy = new Map<number, number>(); // riders per bus line
  // Open taxi depots, nearest-first per trip is not needed: in ID order, each with its morning's trips.
  const taxis = (c.taxi?.depots ?? []).filter(d => d.open).sort((a, b) => a.id - b.id).flatMap(d => { const drive = driveway(c, [d.cell]); return drive === null ? [] : [{ id: d.id, drive, trips: TAXI_DEPOT_UNITS[d.level] * TAXI_TRIPS_PER_CAR }]; });
  const taken = new Map<number, number>();
  for (const [householdId, list] of [...byHousehold].sort((a, b) => a[0] - b[0])) {
    list.sort((a, b) => b.distanceM - a.distanceM || (a.to ?? -1) - (b.to ?? -1) || a.workplace.id - b.workplace.id);
    list.forEach((t, k) => { t.person = k + 1; });
    const free = [...(owned.get(householdId) ?? [])].sort((a, b) => kindOrder(a) - kindOrder(b) || a.id - b.id);
    for (const t of list) {
      if (t.mode !== 'walk' || !t.route) continue;
      if (t.distanceM <= WALK_MAX_M) { t.minutes = minutesAt(t.distanceM, WALK_KMH); continue; }
      const there = free.length ? route(t.from!, t.to!) : null, back = there ? route(t.to!, t.from!) : null;
      const vehicle = there && back ? free.shift() : undefined;
      if (vehicle && there) {
        Object.assign(t, { mode: 'drive', vehicleId: vehicle.id, route: there, distanceM: (there.length - 1) * TILE_LENGTH_M, minutes: pathMinutes(there) });
        let seats = VEHICLE[vehicle.kind].seats - 1;
        for (const other of list) if (seats > 0 && other !== t && other.mode === 'walk' && other.vehicleId === null && other.to === t.to && other.distanceM > WALK_MAX_M) {
          Object.assign(other, { mode: 'passenger', vehicleId: vehicle.id, route: t.route, distanceM: t.distanceM, minutes: t.minutes }); seats--;
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
      // No vehicle and no bus: a taxi from the nearest open depot whose cars still have a trip free this morning.
      const there2 = route(t.from!, t.to!), back2 = there2 ? route(t.to!, t.from!) : null;
      const depot = there2 && back2 ? taxis.find(d => (taken.get(d.id) ?? 0) < d.trips && route(d.drive, t.from!)) : undefined;
      if (depot && there2) {
        taken.set(depot.id, (taken.get(depot.id) ?? 0) + 1);
        const km = (there2.length - 1) * TILE_LENGTH_M / 1000, minutes = pathMinutes(there2);
        Object.assign(t, { mode: 'taxi', route: there2, distanceM: (there2.length - 1) * TILE_LENGTH_M, minutes, taxi: { depotId: depot.id, depotCell: depot.drive, fare: taxiFareSatang(km, minutes) } });
        continue;
      }
      Object.assign(t, { mode: 'walk-long', minutes: minutesAt(t.distanceM, WALK_KMH) });
    }
  }
  // Real congestion: every vehicle driven to work today (household vehicles and taxis; passengers ride along) loads each
  // link of its route, and the extra time a full road takes follows the standard BPR curve on that link's real capacity
  // (on top of the empty-road time, junction waits included).
  const load = rushVehicles(trips), hourly = (key: string) => (load.get(key) ?? 0) / RUSH_HOURS;
  for (const t of trips) if ((t.mode === 'drive' || t.mode === 'passenger' || t.mode === 'taxi') && t.route) {
    let jammed = 0;
    for (let k = 1; k < t.route.length; k++) { const key = `${t.route[k - 1]}>${t.route[k]}`, link = net.links.get(key); jammed += (times.get(key) ?? 0) + (link ? bprTime(link, hourly(key)) - bprTime(link, 0) : 0); }
    t.freeMinutes = pathMinutes(t.route); t.minutes = jammed / 60;
    // The meter runs on the minutes actually spent, jams included.
    if (t.taxi) t.taxi.fare = taxiFareSatang(t.distanceM / 1000, t.minutes);
  }
  return trips;
}

/** Vehicles on each link over the morning rush: one per household vehicle or taxi driven to work (passengers add none). */
function rushVehicles(trips: readonly Trip[]): Map<string, number> {
  const load = new Map<string, number>();
  for (const t of trips) if ((t.mode === 'drive' || t.mode === 'taxi') && t.route) for (let k = 1; k < t.route.length; k++) {
    const key = `${t.route[k - 1]}>${t.route[k]}`; load.set(key, (load.get(key) ?? 0) + 1);
  }
  return load;
}
/** Each road link's load in the busiest hour today as a share of its capacity (1 = full), from the real trips. */
export function rushLoad(c: City): Map<string, number> {
  const { net } = roadsOf(c), out = new Map<string, number>();
  for (const [key, vehicles] of rushVehicles(commutesToday(c))) { const link = net.links.get(key); if (link) out.set(key, vehicles / RUSH_HOURS / link.capacityPerHour); }
  return out;
}
/** How jammed the street outside each parcel is in the morning rush: the fullest link at its driveway, 0 when empty. */
export function congestionReader(c: City): (cell: number) => number {
  const load = rushLoad(c), atRoad = new Map<number, number>();
  for (const [key, ratio] of load) for (const cell of key.split('>').map(Number)) atRoad.set(cell, Math.max(atRoad.get(cell) ?? 0, ratio));
  const memo = new Map<number, number>();
  return cell => { let v = memo.get(cell); if (v === undefined) { const road = c.cells[cell]?.road ? cell : driveway(c, [cell]); v = road === null ? 0 : atRoad.get(road) ?? 0; memo.set(cell, v); } return v; };
}
/** Each household's real commute today, in the shape the wellbeing model reads: average door-to-door seconds in traffic and on empty roads. */
export function householdCommutes(c: City): { householdId: number; workers: number; reachableWorkers: number; unreachableWorkers: number; averageSeconds: number | null; freeFlowSeconds: number | null }[] {
  const by = new Map<number, Trip[]>();
  for (const t of commutesToday(c)) { const list = by.get(t.householdId); if (list) list.push(t); else by.set(t.householdId, [t]); }
  return [...by].map(([householdId, trips]) => {
    const reached = trips.filter(t => t.mode !== 'unreachable' && t.minutes !== null);
    const avg = (f: (t: Trip) => number) => reached.length ? Math.round(reached.reduce((n, t) => n + f(t), 0) / reached.length * 60) : null;
    return { householdId, workers: trips.length, reachableWorkers: reached.length, unreachableWorkers: trips.length - reached.length,
      averageSeconds: avg(t => t.minutes!), freeFlowSeconds: avg(t => t.freeMinutes ?? t.minutes!) };
  });
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
export const TAXI_FARE_REASON = 'Taxi fare';
const spaceUsed = (fleet: readonly Vehicle[], householdId: number) => fleet.filter(v => v.householdId === householdId).reduce((n, v) => n + VEHICLE[v.kind].space, 0);

/** Start the vehicle section, keeping the key order a reload gives (household wellbeing and tax policy stay last). */
function openVehicles(c: City): VehicleState {
  c.vehicles = { version: 1, nextId: 1, fleet: [] };
  for (const key of ['happiness', 'taxPolicy'] as const) if (key in c) { const value = c[key]; delete c[key]; Object.assign(c, { [key]: value }); }
  return c.vehicles;
}
export type CommuteDay = { tick: number; key: string; trips: Trip[]; bought: Vehicle[]; /** Work days lost because the worker had no route there. */ missed: number };
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
  for (const t of trips) if (t.mode === 'taxi' && t.taxi) {
    const fare = 2 * t.taxi.fare;
    if (balance(t.householdId) < fare || pay(wallet.get(t.householdId)!, 'treasury', fare, TAXI_FARE_REASON) !== fare) { delete t.taxi; strand(t); }
  }
  for (const t of trips) if (t.mode === 'bus') {
    const fare = 2 * BUS_FARE_SATANG;
    if (balance(t.householdId) < fare || pay(wallet.get(t.householdId)!, 'treasury', fare, BUS_FARE_REASON) !== fare) { delete t.bus; strand(t); }
  }
  const needing = [...new Set(trips.filter(t => t.mode === 'walk-long' || t.mode === 'bus' || t.mode === 'taxi').map(t => t.householdId))].sort((a, b) => a - b);
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
  // Nobody can work where they cannot get to: a worker with no route there loses today's work credit.
  let missed = 0;
  // Park and venue staff need no road to their post (their rules never did), so only firm jobs are lost this way.
  for (const t of trips) if (t.mode === 'unreachable' && t.wage && t.workplace.kind === 'firm') {
    const wallet = households.get(t.householdId)!.wallet;
    const days = c.firms.find(f => f.id === t.workplace.id)?.workDays;
    if (days && (days[wallet] ?? 0) > 0) { days[wallet]--; if (!days[wallet]) delete days[wallet]; missed++; }
  }
  const day = { tick: c.tick, key: dayKey(c), trips, bought, missed };
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
  const planned = { tick: c.tick, key, trips: planCommutes(c), bought: [], missed: 0 };
  days.set(c, planned);
  return planned.trips;
}

/**
 * The road route a delivery truck takes between two places: from the driveway of one footprint (or a road
 * parcel itself, such as the city gateway) to the driveway of the other, on the class-aware network. Null
 * when no legal route links them, in which case nothing can be delivered between them today.
 */
export function freightRoute(c: City, from: readonly number[], to: readonly number[]): number[] | null {
  const end = (cells: readonly number[]) => cells.length === 1 && c.cells[cells[0]]?.road ? cells[0] : driveway(c, cells);
  const a = end(from), b = end(to);
  if (a === null || b === null) return null;
  if (a === b) return [a];
  const { net, times, trees } = roadsOf(c);
  let tree = trees.get(a); if (!tree) { tree = shortestTree(net, times, a); trees.set(a, tree); }
  if (!tree.has(b)) return null;
  const path = [b]; while (path[0] !== a) path.unshift(tree.get(path[0])!); return path;
}

/** Whether someone can walk between two places on the linked streets (a road parcel stands for itself). */
export function canWalk(c: City, from: readonly number[], to: readonly number[]): boolean {
  const end = (cells: readonly number[]) => cells.length === 1 && c.cells[cells[0]]?.road ? cells[0] : driveway(c, cells);
  const a = end(from), b = end(to);
  return a !== null && b !== null && walkRoute(c, a, b) !== null;
}

export type ShoppingTrip = { householdId: number; shopFirmId: number; from: number; to: number; route: number[]; distanceM: number; mode: 'walk' | 'drive'; vehicleId: number | null; minutes: number };
const PURCHASE = /^Household #([1-9]\d*) purchase$/;
/**
 * Today's real shopping trips: one per household and shop it bought from today (goods or market crops), from
 * the home driveway to the shop's. A household drives its own vehicle when the shop is beyond walking distance
 * and the vehicle can legally drive there and back; otherwise it walks.
 */
export function shoppingTrips(c: City): ShoppingTrip[] {
  const firmByWallet = new Map(c.firms.map(f => [f.wallet, f])), byWallet = new Map(c.households.map(h => [h.wallet, h]));
  const visits = new Set<string>();
  for (let i = c.ledger.length - 1; i >= 0 && c.ledger[i].tick === c.tick; i--) {
    const e = c.ledger[i], m = PURCHASE.exec(e.reason), h = byWallet.get(e.from), shop = firmByWallet.get(e.to);
    if (m && h && shop) visits.add(`${h.id}:${shop.id}`);
  }
  for (let i = c.cropLedger.length - 1; i >= 0 && c.cropLedger[i].tick === c.tick; i--) {
    const e = c.cropLedger[i], h = byWallet.get(e.to), shop = firmByWallet.get(e.from);
    if (e.kind === 'consumption' && h && shop) visits.add(`${h.id}:${shop.id}`);
  }
  if (!visits.size) return [];
  const cellOf = new Map(c.buildings.map(b => [b.id, b.cell])), households = new Map(c.households.map(h => [h.id, h])), firms = new Map(c.firms.map(f => [f.id, f]));
  const out: ShoppingTrip[] = [];
  for (const key of [...visits].sort()) {
    const [householdId, shopId] = key.split(':').map(Number), h = households.get(householdId)!, shop = firms.get(shopId)!;
    const home = h.home === null ? undefined : cellOf.get(h.home), at = cellOf.get(shop.building);
    const from = home === undefined ? null : driveway(c, [home]), to = at === undefined ? null : driveway(c, [at]);
    const trip = from === null || to === null ? null : personalTrip(c, householdId, from, to);
    if (trip && from !== null && to !== null) out.push({ householdId, shopFirmId: shopId, from, to, ...trip });
  }
  return out;
}

/** A household's own trip between two road parcels: walked, or driven in its own vehicle when beyond walking distance and legal there and back. */
function personalTrip(c: City, householdId: number, from: number, to: number) {
  const walk = walkRoute(c, from, to);
  if (!walk) return null;
  const { net, times, trees } = roadsOf(c);
  const drive = (a: number, b: number) => { if (a === b) return [a]; let tree = trees.get(a); if (!tree) { tree = shortestTree(net, times, a); trees.set(a, tree); } if (!tree.has(b)) return null; const p = [b]; while (p[0] !== a) p.unshift(tree.get(p[0])!); return p; };
  const distanceM = (walk.length - 1) * TILE_LENGTH_M, vehicle = (c.vehicles?.fleet ?? []).filter(v => v.householdId === householdId).sort((a, b) => kindOrder(a) - kindOrder(b) || a.id - b.id)[0];
  const there = vehicle && distanceM > WALK_MAX_M ? drive(from, to) : null, back = there ? drive(to, from) : null;
  if (vehicle && there && back) {
    let seconds = 0; for (let k = 1; k < there.length; k++) seconds += times.get(`${there[k - 1]}>${there[k]}`) ?? 0;
    return { route: there, distanceM: (there.length - 1) * TILE_LENGTH_M, mode: 'drive' as const, vehicleId: vehicle.id, minutes: seconds / 60 };
  }
  return { route: walk, distanceM, mode: 'walk' as const, vehicleId: null, minutes: minutesAt(distanceM, WALK_KMH) };
}

/** A household's evening out: to a cinema, restaurant, night market or concert it paid to visit today. */
export type LeisureTrip = { householdId: number; siteId: number; kind: CivicKind; from: number; to: number; route: number[]; distanceM: number; mode: 'walk' | 'drive'; vehicleId: number | null; minutes: number };
/** Today's real outings, one per household and venue it paid an entry fee to today, from home to the venue and back. */
export function leisureTrips(c: City): LeisureTrip[] {
  const sites = (c.civic?.sites ?? []), byReason = new Map(sites.map(site => [civicFeeReason(site.kind, site.id), site])), byWallet = new Map(c.households.map(h => [h.wallet, h]));
  if (!sites.length) return [];
  const visits = new Map<string, { householdId: number; site: typeof sites[number] }>();
  for (let i = c.ledger.length - 1; i >= 0 && c.ledger[i].tick === c.tick; i--) {
    const e = c.ledger[i], site = byReason.get(e.reason), h = byWallet.get(e.from);
    if (site && h) visits.set(`${h.id}:${site.id}`, { householdId: h.id, site });
  }
  const cellOf = new Map(c.buildings.map(b => [b.id, b.cell])), out: LeisureTrip[] = [];
  for (const [, { householdId, site }] of [...visits].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const h = c.households.find(x => x.id === householdId)!, home = h.home === null ? undefined : cellOf.get(h.home);
    const from = home === undefined ? null : driveway(c, [home]), to = driveway(c, site.cells ?? [site.cell]);
    const trip = from === null || to === null ? null : personalTrip(c, householdId, from, to);
    if (trip && from !== null && to !== null) out.push({ householdId, siteId: site.id, kind: site.kind, from, to, ...trip });
  }
  return out;
}

/** A sick person's trip: to a clinic or hospital in the city (`siteId`), or out through the gateway to one outside (null). */
export type CareTrip = { householdId: number; siteId: number | null; from: number; to: number; route: number[]; distanceM: number; mode: 'walk' | 'drive'; vehicleId: number | null; minutes: number };
/**
 * The trip someone taken ill makes from home: to the nearest of `sites` (the clinics and hospitals whose service
 * area covers the home) they can actually get to along linked streets, or null when none can be reached.
 */
export function careTrip(c: City, householdId: number, homeCell: number, sites: readonly { id: number; cell: number; cells?: number[] }[]): CareTrip | null {
  const from = driveway(c, [homeCell]); if (from === null) return null;
  let best: CareTrip | null = null;
  for (const site of [...sites].sort((a, b) => a.id - b.id)) {
    const to = driveway(c, site.cells ?? [site.cell]); if (to === null) continue;
    const trip = personalTrip(c, householdId, from, to);
    if (trip && (!best || trip.distanceM < best.distanceM)) best = { householdId, siteId: site.id, from, to, ...trip };
  }
  return best;
}
/** The trip out through the city gateway to a hospital outside, or null when home has no street out. */
export function outsideCareTrip(c: City, householdId: number, homeCell: number, gateway: number): CareTrip | null {
  const from = driveway(c, [homeCell]); if (from === null || !c.cells[gateway]?.road) return null;
  const trip = personalTrip(c, householdId, from, gateway);
  return trip && { householdId, siteId: null, from, to: gateway, ...trip };
}
const careDays = new WeakMap<City, { tick: number; trips: CareTrip[] }>();
/** Remember a sick person's trip for today's screen. */
export function recordCareTrip(c: City, trip: CareTrip) {
  const day = careDays.get(c);
  if (day && day.tick === c.tick) day.trips.push(trip); else careDays.set(c, { tick: c.tick, trips: [trip] });
}
/** Today's trips to the doctor, as they happened when the city last stepped. */
export const careTripsToday = (c: City): CareTrip[] => { const day = careDays.get(c); return day && day.tick === c.tick ? day.trips : []; };

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
