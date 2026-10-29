import { linkKey, type Link, type LinkNetwork } from './network.ts';
import { roadNeighbors } from '../road-topology.ts';
import { LANE_START, LANE_END, SLOT_PITCH, laneOffset } from '../citizen-road-queue.ts';
import type { CitizenVehiclePose } from '../citizen-vehicle-poses.ts';
import type { OdDemand, RouteState } from './routing.ts';
/**
 * Representative fleet (visual only; nothing here feeds back into the model or a save).
 *
 * Count: 1 visible car ≈ VISUAL_SCALE model vehicles on a routed path in the current period
 * (1 model vehicle = PEOPLE_PER_VEHICLE people). Targets are apportioned across paths by
 * largest remainder, so the total is round(Σflow / VISUAL_SCALE) and quiet paths show 0.
 *
 * Motion: each car drives its routed cell path continuously, handing off link to link. Cars in a
 * lane keep SLOT_PITCH apart; a car may only cross a turning/junction node square if it holds
 * the node (one car at a time) and its exit lane has room. Cars spawn at the path start and
 * leave by driving to the destination and fading out, so a demand drop never pops cars.
 */
export const VISUAL_SCALE = 2;
export const GLOBAL_VEHICLE_CAP = 240;
/** Base visual speed at free flow, tiles per real second; slowed by link congestion. */
export const VISUAL_TILES_PER_SECOND = 1.2;
export const FADE_SECONDS = .4;
/** Centre s at which a car's box touches the node square (stop line) / has fully left it. */
const STOP = LANE_END, CLEAR = LANE_START, SQUARE = (1 - STOP) + CLEAR;

export type FleetCar = { id: string; path: number[]; pathKey: string; i: number; s: number; lane: number; paint: number; phase: 'in' | 'drive' | 'out'; fade: number };
export type FleetState = { nextId: number; cars: FleetCar[]; targets: Map<string, { path: number[]; target: number }>; held: Map<number, string>; slow: Map<string, number> };
export const createFleet = (): FleetState => ({ nextId: 1, cars: [], targets: new Map(), held: new Map(), slow: new Map() });
const paint = (id: string) => { let n = 0; for (const c of id) n = (Math.imul(n, 31) + c.charCodeAt(0)) | 0; return (n >>> 0) % 6; };

/** Largest-remainder apportionment of round(Σw / scale) (capped) — deterministic, may give 0. */
export function apportion(weights: ReadonlyMap<string, number>, scale = VISUAL_SCALE, cap = GLOBAL_VEHICLE_CAP): Map<string, number> {
  const sum = [...weights.values()].reduce((a, b) => a + b, 0), total = Math.min(cap, Math.round(sum / scale));
  const out = new Map<string, number>(), rest: [string, number][] = [];
  if (total <= 0) { for (const k of weights.keys()) out.set(k, 0); return out; }
  let used = 0;
  for (const [k, w] of weights) { const x = w / sum * total, f = Math.floor(x); out.set(k, f); used += f; rest.push([k, x - f]); }
  rest.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  for (let i = 0; used < total && i < rest.length; i++, used++) out.set(rest[i][0], out.get(rest[i][0])! + 1);
  return out;
}
/**
 * New period: set per-path targets from routed flows (OD vehicles × path share) and link slowdown
 * from congested times. Existing cars are never removed here; surplus ones simply aren't replaced.
 */
export function setFleetDemand(fleet: FleetState, net: LinkNetwork, od: readonly OdDemand[], routes: RouteState, times?: ReadonlyMap<string, number>, scale = VISUAL_SCALE, cap = GLOBAL_VEHICLE_CAP): void {
  const flow = new Map<string, number>(), paths = new Map<string, number[]>();
  for (const d of od) for (const p of routes.get(`${d.from}:${d.to}`) ?? []) {
    if (p.path.length < 2) continue;
    const k = p.path.join(','); flow.set(k, (flow.get(k) ?? 0) + d.vehicles * p.share); paths.set(k, p.path);
  }
  fleet.targets = new Map([...apportion(new Map([...flow].sort((a, b) => (a[0] < b[0] ? -1 : 1))), scale, cap)].map(([k, n]) => [k, { path: paths.get(k)!, target: n }]));
  fleet.slow = new Map();
  if (times) for (const [k, l] of net.links) { const t = times.get(k); if (t) fleet.slow.set(k, Math.min(1, l.length / (l.freeFlowKmh / 3.6) / t)); }
}
const linkOf = (c: FleetCar) => linkKey(c.path[c.i], c.path[c.i + 1]);
const degree = (net: LinkNetwork, n: number) => roadNeighbors(n).filter(m => net.links.has(linkKey(n, m)) || net.links.has(linkKey(m, n))).length;
/** A node needs the one-car square unless it is a plain straight run with equal lane counts. */
function needsSquare(net: LinkNetwork, a: number, n: number, b: number): boolean {
  const la = net.links.get(linkKey(a, n)), lb = net.links.get(linkKey(n, b));
  return !(degree(net, n) <= 2 && n - a === b - n && la?.lanes === lb?.lanes);
}
const laneOn = (net: LinkNetwork, c: FleetCar, i = c.i) => Math.min(c.lane, (net.links.get(linkKey(c.path[i], c.path[i + 1]))?.lanes ?? 1) - 1);

/** Advance visual cars by dt real seconds. Deterministic for a given call sequence. */
export function stepFleet(fleet: FleetState, net: LinkNetwork, dt: number): void {
  const live = new Set<string>();
  // Fades; drop cars whose road vanished (they fade out where they stand).
  for (const c of fleet.cars) {
    if (c.phase !== 'out' && !net.links.has(linkOf(c))) c.phase = 'out';
    if (c.phase === 'in') { c.fade = Math.min(1, c.fade + dt / FADE_SECONDS); if (c.fade >= 1) c.phase = 'drive'; }
    else if (c.phase === 'out') c.fade -= dt / FADE_SECONDS;
  }
  for (const c of fleet.cars) if (c.fade <= 0 && c.phase === 'out') for (const [n, id] of fleet.held) if (id === c.id) fleet.held.delete(n);
  fleet.cars = fleet.cars.filter(c => !(c.phase === 'out' && c.fade <= 0));
  const lanes = () => {
    const m = new Map<string, FleetCar[]>();
    for (const c of fleet.cars) { const k = `${linkOf(c)}|${laneOn(net, c)}`; (m.get(k) ?? m.set(k, []).get(k)!).push(c); }
    return m;
  };
  let occ = lanes();
  const order = [...fleet.cars].sort((a, b) => b.s - a.s || (a.id < b.id ? -1 : 1));
  for (const c of order) {
    live.add(c.id);
    if (c.phase === 'out') continue;
    const last = c.i === c.path.length - 2, link = linkOf(c), lane = laneOn(net, c);
    let max = Infinity;
    // A leader inside the node square is drawn on its L-shaped turn, so followers hold back from the stop line.
    const squareAhead = !last && needsSquare(net, c.path[c.i], c.path[c.i + 1], c.path[c.i + 2]);
    for (const o of occ.get(`${link}|${lane}`) ?? []) if (o !== c && o.s > c.s) max = Math.min(max, (o.s > STOP ? (squareAhead || o.i === o.path.length - 2 ? STOP : o.s) : o.s) - SLOT_PITCH);
    if (last) max = Math.min(max, STOP);
    else {
      const n = c.path[c.i + 1], next = linkKey(n, c.path[c.i + 2]), nl = laneOn(net, c, c.i + 1);
      if (!net.links.has(next)) max = Math.min(max, STOP);
      else {
        const ahead = occ.get(`${next}|${nl}`) ?? [];
        for (const o of ahead) if (o !== c) max = Math.min(max, 1 + o.s - SLOT_PITCH);
        if (needsSquare(net, c.path[c.i], n, c.path[c.i + 2]) && c.s <= STOP) {
          const holder = fleet.held.get(n), room = ahead.every(o => o === c || o.s >= CLEAR + SLOT_PITCH);
          if ((holder && holder !== c.id) || !room) max = Math.min(max, STOP);
        }
      }
    }
    const speed = VISUAL_TILES_PER_SECOND * (fleet.slow.get(link) ?? 1);
    const ns = Math.max(c.s, Math.min(c.s + speed * dt, max));
    if (!last && c.s <= STOP && ns > STOP && needsSquare(net, c.path[c.i], c.path[c.i + 1], c.path[c.i + 2])) fleet.held.set(c.path[c.i + 1], c.id);
    c.s = ns;
    if (c.s >= 1) { c.i++; c.s -= 1; }
    if (c.i > 0 && c.s >= CLEAR && fleet.held.get(c.path[c.i]) === c.id) fleet.held.delete(c.path[c.i]);
    if (c.i === c.path.length - 2 && c.s >= STOP) c.phase = 'out';
    occ = lanes();
  }
  // Spawn toward each path's target, at most one per path per step, only into a clear start.
  const count = new Map<string, number>();
  for (const c of fleet.cars) if (c.phase !== 'out') count.set(c.pathKey, (count.get(c.pathKey) ?? 0) + 1);
  for (const [k, t] of fleet.targets) {
    if ((count.get(k) ?? 0) >= t.target || fleet.cars.length >= GLOBAL_VEHICLE_CAP) continue;
    const first = linkKey(t.path[0], t.path[1]); if (!net.links.has(first) || fleet.held.has(t.path[0])) continue;
    const lane = Math.min(fleet.nextId % 2, net.links.get(first)!.lanes - 1);
    if ((occ.get(`${first}|${lane}`) ?? []).some(o => o.s < CLEAR + SLOT_PITCH)) continue;
    const id = `fleet-${fleet.nextId++}`;
    const car: FleetCar = { id, path: t.path, pathKey: k, i: 0, s: CLEAR, lane, paint: paint(id), phase: 'in', fade: 0 };
    fleet.cars.push(car); occ = lanes();
  }
}
/** World-space poses (UNIT = 2 world units per tile, origin at the map centre, as renderer.ts). */
export function fleetPoses(fleet: FleetState, net: LinkNetwork, visible: (cell: number) => boolean = () => true, size = 24, unit = 2): CitizenVehiclePose[] {
  const centre = (i: number) => [((i % size) - (size - 1) / 2) * unit, (Math.floor(i / size) - (size - 1) / 2) * unit];
  const at = (a: number, b: number, s: number, lane: number) => {
    const [ax, az] = centre(a), [bx, bz] = centre(b), hx = Math.sign(bx - ax), hz = Math.sign(bz - az), o = laneOffset({ cell: b, incoming: b - a, lane }) * unit;
    return { x: ax + (bx - ax) * s + hz * o, z: az + (bz - az) * s - hx * o, hx, hz };
  };
  const out: CitizenVehiclePose[] = [];
  for (const c of [...fleet.cars].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const a = c.path[c.i], b = c.path[c.i + 1];
    if (!visible(a) && !visible(b)) continue;
    let p = at(a, b, c.s, laneOn(net, c));
    const into = c.s > STOP && c.i < c.path.length - 2 && needsSquare(net, a, b, c.path[c.i + 2]);
    const from = c.s < CLEAR && c.i > 0 && needsSquare(net, c.path[c.i - 1], a, b);
    if (into || from) {
      const k = into ? c.i : c.i - 1, u = into ? (c.s - STOP) / SQUARE : (c.s + 1 - STOP) / SQUARE;
      const e = at(c.path[k], c.path[k + 1], STOP, laneOn(net, c, k)), x = at(c.path[k + 1], c.path[k + 2], CLEAR, laneOn(net, c, k + 1));
      // L-shaped path through the square: along the entry lane to the corner, then along the exit lane.
      const straight = e.hx === x.hx && e.hz === x.hz, cx = straight ? (e.x + x.x) / 2 : e.hx !== 0 ? x.x : e.x, cz = straight ? (e.z + x.z) / 2 : e.hx !== 0 ? e.z : x.z;
      const d1 = Math.hypot(cx - e.x, cz - e.z), d2 = Math.hypot(x.x - cx, x.z - cz), d = u * (d1 + d2);
      p = d <= d1 ? { x: e.x + (cx - e.x) * (d1 ? d / d1 : 0), z: e.z + (cz - e.z) * (d1 ? d / d1 : 0), hx: e.hx, hz: e.hz }
        : { x: cx + (x.x - cx) * ((d - d1) / d2), z: cz + (x.z - cz) * ((d - d1) / d2), hx: x.hx, hz: x.hz };
    }
    out.push({ vehicleId: c.id, x: p.x, z: p.z, headingX: p.hx, headingZ: p.hz, paint: c.paint, scale: c.fade });
  }
  return out;
}
export const activeCars = (fleet: FleetState) => fleet.cars.filter(c => c.phase !== 'out').length;
export type { Link };
