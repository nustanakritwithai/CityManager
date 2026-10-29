import { linkKey, type Link, type LinkNetwork } from './network.ts';
import { roadNeighbors } from '../road-topology.ts';
import { LANE_SLOTS, laneOffset, laneSlotCentres, type LanePosition } from '../citizen-road-queue.ts';
import type { CitizenVehiclePose } from '../citizen-vehicle-poses.ts';
/**
 * Representative fleet: turns the latest assignPeriod link volumes into a capped set of visible
 * cars with stable ids. Visual only — the model keeps running regardless of what is drawn, and
 * nothing here enters a save. Count per link follows volume/capacity; when a link is congested
 * (or its downstream junction has no free exit) its cars pack into a stationary queue that stops
 * before the junction square, so the picture matches the model.
 */
export const GLOBAL_VEHICLE_CAP = 240;
/** Volume/capacity at which a link shows as a standing queue. */
export const QUEUE_RATIO = .9;
/** Seconds for a free-flowing car to sweep its lane segment at free-flow speed. */
export const SWEEP_SECONDS = 2;
export type FleetVehicle = { id: string; link: string; lane: number; slot: number; paint: number };
export type FleetLink = { ids: string[]; phase: number; queued: boolean; ratio: number };
export type FleetState = { nextId: number; links: Map<string, FleetLink> };
export const createFleet = (): FleetState => ({ nextId: 1, links: new Map() });
const paint = (id: string) => { let n = 0; for (const c of id) n = (Math.imul(n, 31) + c.charCodeAt(0)) | 0; return (n >>> 0) % 6; };
const slotsOf = (l: Link) => l.lanes * LANE_SLOTS;

/** Visible cars wanted on a link: ceil(v/c · slots), at least 1 when any volume, at most the slots. */
export const wantedCars = (l: Link, volume: number) => volume <= 0 ? 0 : Math.min(slotsOf(l), Math.max(1, Math.ceil(volume / l.capacityPerHour * slotsOf(l))));

/**
 * Apportion `cap` across links by want, deterministically. Cars already on screen are kept first
 * (up to their link's want) so hitting the cap never makes existing cars vanish; spare capacity
 * then goes to extra wants by largest remainder, ties by link key.
 */
function capped(want: Map<string, number>, cap: number, have: (k: string) => number): Map<string, number> {
  const total = [...want.values()].reduce((a, b) => a + b, 0);
  if (total <= cap) return want;
  const out = new Map<string, number>();
  let used = 0;
  for (const [k, w] of want) { const keep = Math.min(w, have(k)); out.set(k, keep); used += keep; }
  if (used > cap) { // cap lowered below what is shown: proportional trim
    const scale = cap / used; used = 0;
    for (const [k, n] of out) { const f = Math.floor(n * scale); out.set(k, f); used += f; }
  }
  const extra = [...want].map(([k, w]) => [k, w - out.get(k)!] as [string, number]).filter(([, x]) => x > 0), extraTotal = extra.reduce((a, [, x]) => a + x, 0);
  const room = cap - used, rest: [string, number][] = [];
  for (const [k, x] of extra) { const share = x * room / extraTotal, f = Math.floor(share); out.set(k, out.get(k)! + f); used += f; rest.push([k, share - f]); }
  rest.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  for (let i = 0; used < cap && i < rest.length; i++, used++) out.set(rest[i][0], out.get(rest[i][0])! + 1);
  return out;
}
/**
 * Reconcile the fleet with a new assignment. Existing ids on a link are kept (only surplus ids at
 * the tail retire, only missing ones are added), so a period or day change with similar volume
 * never makes cars vanish and respawn. Offscreen links (visible → false) keep their ids and state
 * but are excluded from the global cap; links gone from the network drop their cars.
 */
export function updateFleet(fleet: FleetState, net: LinkNetwork, volumes: ReadonlyMap<string, number>, visible: (l: Link) => boolean = () => true, cap = GLOBAL_VEHICLE_CAP): FleetState {
  for (const k of [...fleet.links.keys()]) if (!net.links.has(k)) fleet.links.delete(k);
  const want = new Map<string, number>();
  for (const [k, l] of [...net.links].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const v = volumes.get(k) ?? 0, entry = fleet.links.get(k);
    if (!visible(l)) { if (entry) entry.ratio = v / l.capacityPerHour; continue; }
    want.set(k, wantedCars(l, v));
  }
  for (const [k, n] of capped(want, cap, k => fleet.links.get(k)?.ids.length ?? 0)) {
    const l = net.links.get(k)!, v = volumes.get(k) ?? 0;
    let e = fleet.links.get(k);
    if (!e) { if (!n) continue; e = { ids: [], phase: 0, queued: false, ratio: 0 }; fleet.links.set(k, e); }
    e.ratio = v / l.capacityPerHour;
    if (e.ids.length > n) e.ids.length = n;
    while (e.ids.length < n) e.ids.push(`fleet-${fleet.nextId++}`);
    if (!n) fleet.links.delete(k);
  }
  // Queue state needs every ratio first: a junction with no free exit holds its approaches.
  for (const [k, e] of fleet.links) { const l = net.links.get(k)!; e.queued = e.ratio >= QUEUE_RATIO || exitFull(fleet, net, l); }
  return fleet;
}
const isJunction = (net: LinkNetwork, cell: number) => roadNeighbors(cell).filter(n => net.links.has(linkKey(cell, n)) || net.links.has(linkKey(n, cell))).length > 2;
/** A junction exit is full when every onward link (excluding a U-turn) is at or above capacity. */
function exitFull(fleet: FleetState, net: LinkNetwork, l: Link): boolean {
  if (!isJunction(net, l.to)) return false;
  const exits = (net.out.get(l.to) ?? []).filter(x => x.to !== l.from);
  return exits.length > 0 && exits.every(x => (fleet.links.get(linkKey(x.from, x.to))?.ratio ?? 0) >= 1);
}
/** Advance free-flow animation; queued links stand still at the downstream end of their lane. */
export function animateFleet(fleet: FleetState, dt: number): void {
  for (const e of fleet.links.values()) {
    if (e.queued) { e.phase = 1; continue; }
    const speed = 1 / (1 + .15 * e.ratio ** 4);
    e.phase = (e.phase + dt * speed / SWEEP_SECONDS) % 1;
  }
}
export function fleetVehicles(fleet: FleetState, net: LinkNetwork): FleetVehicle[] {
  const out: FleetVehicle[] = [];
  for (const [k, e] of [...fleet.links].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const lanes = net.links.get(k)!.lanes;
    e.ids.forEach((id, i) => out.push({ id, link: k, lane: i % lanes, slot: Math.floor(i / lanes), paint: paint(id) }));
  }
  return out;
}
/** World-space poses (UNIT = 2 world units per tile, origin at the map centre, as renderer.ts). */
export function fleetPoses(fleet: FleetState, net: LinkNetwork, size = 24, unit = 2): CitizenVehiclePose[] {
  const centre = (i: number) => [((i % size) - (size - 1) / 2) * unit, (Math.floor(i / size) - (size - 1) / 2) * unit];
  return fleetVehicles(fleet, net).map(v => {
    const l = net.links.get(v.link)!, e = fleet.links.get(v.link)!, lane: LanePosition = { cell: l.to, incoming: l.to - l.from, lane: v.lane };
    const perLane = Math.floor(e.ids.length / l.lanes) + (v.lane < e.ids.length % l.lanes ? 1 : 0);
    const s = laneSlotCentres(perLane, e.phase)[v.slot];
    const [ax, az] = centre(l.from), [bx, bz] = centre(l.to), hx = Math.sign(bx - ax), hz = Math.sign(bz - az);
    const offset = laneOffset(lane) * unit;
    return { vehicleId: v.id, x: ax + (bx - ax) * s + hz * offset, z: az + (bz - az) * s - hx * offset, headingX: hx, headingZ: hz, paint: v.paint };
  });
}
