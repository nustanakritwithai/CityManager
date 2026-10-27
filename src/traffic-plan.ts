/**
 * Decorative city life: which cars, trucks, walkers and smoke plumes to show.
 * Read-only over City; no sim RNG, no mutation, nothing enters a save. Quantities follow
 * real data (employment, population, today's goods/crop journals, producing factories).
 */
import { GATEWAY, SIZE, connectedRoads, economicSignals, firmWorkerCount, type City } from './sim.ts';

export const MAX_CARS = 40, MAX_TRUCKS = 12, MAX_WALKERS = 60;
/**
 * Trucks show last full week's real delivery routes, so the fleet changes once a week, not every
 * day at 10×; a busy route (TRUCK_LOAD units or more) gets a second truck.
 */
export const DELIVERY_WINDOW = 7, TRUCK_LOAD = 60;
const TRUCKED = ['Wholesale stock delivery', 'Imported shop stock', 'Exported goods'];
/** Truck cargo, in paint order: the three crops, then the three products. */
export const CARGO = ['rice', 'vegetables', 'sugarcane', 'milled-rice', 'canned-food', 'sugar'] as const;
/** `colour` is the paint for cars; for trucks it is the index in CARGO of what the route mostly carries. */
export type Vehicle = { key: string; kind: 'car' | 'truck'; route: number[]; colour: number };
export type Walker = { key: string; route: number[]; colour: number };
export type TrafficPlan = { cars: Vehicle[]; trucks: Vehicle[]; walkers: Walker[]; smoke: number[]; signature: string };

const neighbours = (i: number) => [i % SIZE ? i - 1 : -1, i % SIZE < SIZE - 1 ? i + 1 : -1, i >= SIZE ? i - SIZE : -1, i < SIZE * (SIZE - 1) ? i + SIZE : -1].filter(n => n >= 0);

/** Visual-only hash; never the simulation RNG. */
export function visualHash(a: number, b = 0): number {
  let n = Math.imul((a ^ 0x9e3779b1) >>> 0, 0x85ebca6b) ^ Math.imul((b + 0x7f4a7c15) >>> 0, 0xc2b2ae35);
  n = Math.imul(n ^ (n >>> 15), 0x27d4eb2d);
  return ((n ^ (n >>> 13)) >>> 0) / 4294967296;
}

/** Visual-only hash of a key, so actors on one route still get their own start and pace. */
export function keyHash(key: string): number {
  let n = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) n = Math.imul(n ^ key.charCodeAt(i), 0x01000193);
  return visualHash(n >>> 0, key.length);
}

/** Ticks [since, until) of the last full delivery week before `tick`. */
export function deliveryWeek(tick: number): [number, number] {
  const until = Math.floor(tick / DELIVERY_WINDOW) * DELIVERY_WINDOW;
  return [until - DELIVERY_WINDOW, until];
}

export type CommuteGoal = 'home' | 'work' | 'cruise';
/**
 * Where a commuter wants to be at a visual hour: leave home during the morning rush, drive home
 * during the evening rush, park in between. `depart` (0–1) spreads each car over its rush window;
 * `errand` (0–1) picks the few cars that run errands through the working day or drive at night.
 */
export function commuteGoal(hour: number, depart: number, errand: number): CommuteGoal {
  const h = ((hour % 24) + 24) % 24, leave = 6.5 + depart * 3, back = 16.5 + depart * 3;
  if (h >= 9.5 && h < 16.5 && errand < .25) return 'cruise';
  if ((h >= 21 || h < 5.5) && errand < .06) return 'cruise';
  return h >= leave && h < back ? 'work' : 'home';
}

export type Mover = { x: number; z: number; hx: number; hz: number; length: number; width: number; rank: number };
/**
 * The nearest vehicle ahead in this lane, or crossing it, and the clear gap to it, measured on
 * each body's footprint so a car crossing at a junction is seen before it touches. Two vehicles
 * on the same spot never both wait: the lower rank counts as ahead. Oncoming traffic is ignored.
 */
export function leaderAhead(movers: readonly Mover[], i: number, lookahead = 1.6): { leader: number; gap: number } {
  const a = movers[i]; let leader = -1, gap = Infinity;
  for (let j = 0; j < movers.length; j++) {
    if (j === i) continue;
    const b = movers[j], dx = b.x - a.x, dz = b.z - a.z, dot = a.hx * b.hx + a.hz * b.hz, cross = Math.abs(a.hx * b.hz - a.hz * b.hx);
    if (dot < -.5) continue;
    const along = dx * a.hx + dz * a.hz, side = Math.abs(dx * a.hz - dz * a.hx);
    const bAlong = Math.abs(dot) * b.length / 2 + cross * b.width / 2, bSide = cross * b.length / 2 + Math.abs(dot) * b.width / 2;
    if (side > a.width / 2 + bSide + .04) continue; // not in this lane
    if (along < -1e-3 || (along <= 1e-3 && b.rank > a.rank) || along > lookahead) continue;
    const clear = along - a.length / 2 - bAlong;
    if (clear < gap) { gap = clear; leader = j; }
  }
  return { leader, gap };
}

/** True when two vehicle footprints overlap by more than `slack` (QA and tests only). */
export function overlapping(a: Mover, b: Mover, slack = .05): boolean {
  const dx = b.x - a.x, dz = b.z - a.z, dot = Math.abs(a.hx * b.hx + a.hz * b.hz), cross = Math.abs(a.hx * b.hz - a.hz * b.hx);
  const along = Math.abs(dx * a.hx + dz * a.hz), side = Math.abs(dx * a.hz - dz * a.hx);
  return along < a.length / 2 + dot * b.length / 2 + cross * b.width / 2 - slack && side < a.width / 2 + cross * b.length / 2 + dot * b.width / 2 - slack;
}

/** Nearest connected road cell beside a parcel (stable: lowest index wins ties). */
export function accessCell(roads: ReadonlySet<number>, cell: number): number | null {
  if (roads.has(cell)) return cell;
  const options = neighbours(cell).filter(n => roads.has(n)).sort((a, b) => a - b);
  return options.length ? options[0] : null;
}

/** Shortest path over connected road cells, deterministic neighbour order. */
export function roadRoute(roads: ReadonlySet<number>, from: number, to: number): number[] {
  if (!roads.has(from) || !roads.has(to)) return [];
  if (from === to) return [from];
  const previous = new Map<number, number>([[from, -1]]), queue = [from];
  for (let q = 0; q < queue.length; q++) {
    const here = queue[q];
    for (const next of neighbours(here)) {
      if (!roads.has(next) || previous.has(next)) continue;
      previous.set(next, here);
      if (next === to) {
        const path = [to]; for (let at = here; at !== -1; at = previous.get(at)!) path.push(at);
        return path.reverse();
      }
      queue.push(next);
    }
  }
  return [];
}

function walletCell(city: City, roads: ReadonlySet<number>, wallet: string): number | null {
  if (wallet === 'outside') return roads.has(GATEWAY) ? GATEWAY : null;
  const firm = city.firms.find(f => f.wallet === wallet);
  const building = firm && city.buildings.find(b => b.id === firm.building);
  return building ? accessCell(roads, building.cell) : null;
}

export function trafficPlan(city: City): TrafficPlan {
  const roads = connectedRoads(city), cars: Vehicle[] = [], trucks: Vehicle[] = [], walkers: Walker[] = [], smoke: number[] = [];
  const buildingCell = (id: number) => city.buildings.find(b => b.id === id)?.cell ?? null;
  if (roads.size > 1) {
    // Commuters: one car per real employment allocation (household home → firm), plus self-employed owners.
    const jobs = [...city.employment.map(e => ({ h: e.householdId, f: e.firmId })), ...city.ownerLabor.map(e => ({ h: e.householdId, f: e.firmId }))];
    for (const job of jobs.sort((a, b) => a.f - b.f || a.h - b.h)) {
      if (cars.length >= MAX_CARS) break;
      const home = city.households.find(h => h.id === job.h)?.home, firm = city.firms.find(f => f.id === job.f);
      const homeCell = home == null ? null : buildingCell(home), workCell = firm ? buildingCell(firm.building) : null;
      const from = homeCell == null ? null : accessCell(roads, homeCell), to = workCell == null ? null : accessCell(roads, workCell);
      if (from == null || to == null || from === to) continue;
      const route = roadRoute(roads, from, to);
      if (route.length > 1) cars.push({ key: `car:${job.h}:${job.f}`, kind: 'car', route, colour: Math.floor(visualHash(job.h, job.f) * 6) });
    }
    // Trucks: one per real delivery route of the last full week (goods wholesale/import/export, crop
    // trades and crop exports to the gateway), two on a busy route. Keys carry no day, so a route keeps its truck.
    const [since, until] = deliveryWeek(city.tick), flows = new Map<string, { from: string; to: string; quantity: number; loads: number[] }>();
    const flow = (from: string, to: string, quantity: number, cargo: string | undefined) => {
      const key = `${from}>${to}`, f = flows.get(key) ?? { from, to, quantity: 0, loads: CARGO.map(() => 0) }; f.quantity += quantity;
      const i = CARGO.indexOf(cargo as typeof CARGO[number]); if (i >= 0) f.loads[i] += quantity; flows.set(key, f);
    };
    for (let i = city.goodsLedger.length - 1; i >= 0 && city.goodsLedger[i].tick >= since; i--) { const e = city.goodsLedger[i]; if (e.tick < until && TRUCKED.includes(e.reason)) flow(e.from, e.to, e.quantity, e.product ?? 'milled-rice'); }
    for (let i = city.cropLedger.length - 1; i >= 0 && city.cropLedger[i].tick >= since; i--) { const e = city.cropLedger[i]; if (e.tick < until && (e.kind === 'trade' || e.kind === 'export')) flow(e.from, e.to, e.quantity, e.crop ?? 'rice'); }
    for (const [key, f] of [...flows].sort((a, b) => b[1].quantity - a[1].quantity || (a[0] < b[0] ? -1 : 1))) {
      if (trucks.length >= MAX_TRUCKS) break;
      const from = walletCell(city, roads, f.from), to = walletCell(city, roads, f.to);
      if (from == null || to == null || from === to) continue;
      const route = roadRoute(roads, from, to);
      for (let k = 0; route.length > 1 && k < (f.quantity >= TRUCK_LOAD ? 2 : 1) && trucks.length < MAX_TRUCKS; k++) trucks.push({ key: `truck:${key}:${k}`, kind: 'truck', route, colour: f.loads.indexOf(Math.max(...f.loads)) });
    }
    // Walkers: residents of connected homes stroll a short stretch of their street.
    const people = new Map<number, number>();
    for (const h of city.households) if (h.home != null) people.set(h.home, (people.get(h.home) ?? 0) + h.members);
    for (const [home, count] of [...people].sort((a, b) => a[0] - b[0])) {
      const cell = buildingCell(home), start = cell == null ? null : accessCell(roads, cell);
      if (start == null) continue;
      const out = neighbours(start).filter(n => roads.has(n)).sort((a, b) => a - b);
      for (let k = 0; k < Math.min(2, Math.ceil(count / 3)) && walkers.length < MAX_WALKERS; k++) {
        const far = out.length ? out[Math.floor(visualHash(home, k) * out.length)] : start;
        walkers.push({ key: `walk:${home}:${k}`, route: far === start ? [start] : [start, far], colour: Math.floor(visualHash(home, k + 9) * 6) });
      }
    }
    // Smoke: factories that really produce today.
    for (const s of economicSignals(city)) {
      const firm = city.firms.find(f => f.id === s.firmId);
      if (firm?.zone !== 'I' || s.reasonId !== 'agriculture.recipe-ready' || firmWorkerCount(city, firm.id) < 1) continue;
      const cell = buildingCell(firm.building); if (cell != null && roads.has(accessCell(roads, cell) ?? -1)) smoke.push(cell);
    }
  }
  const signature = [city.tick, cars.map(c => c.key).join(','), trucks.map(t => t.key).join(','), walkers.length, smoke.join(',')].join('|');
  return { cars, trucks, walkers, smoke, signature };
}
