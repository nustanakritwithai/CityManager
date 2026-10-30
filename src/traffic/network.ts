import { roadDriveAllowed, roadNeighbors, type RoadMap } from '../road-topology.ts';
/**
 * Directed link graph for the aggregate traffic model, built strictly from road-topology rules:
 * a link a→b exists iff roadDriveAllowed(a,b) — so parallel non-junction roads stay separate,
 * cancelled junctions are absent, and one-way arrows are honoured. Read-only; not saved.
 */
export const TILE_LENGTH_M = 100, FREE_FLOW_KMH = 40, LANE_CAPACITY_VPH = 600;
export type Link = { from: number; to: number; length: number; freeFlowKmh: number; lanes: number; capacityPerHour: number };
export type LinkNetwork = { links: Map<string, Link>; out: Map<number, Link[]>; capacityPerLane?: number; frontages?: Map<number, number[]> };
export const PARCEL_ZONE_BASE = 576;
/** Stable parcel demand identity; frontage changes must not delete an existing request. */
export const parcelTrafficZone = (cell: number) => PARCEL_ZONE_BASE + cell;
export function resolveTrafficZone(net: LinkNetwork, zone: number): number[] {
  if (zone >= PARCEL_ZONE_BASE) return net.frontages?.get(zone) ?? [];
  return net.out.has(zone) || [...net.links.values()].some(l => l.to === zone) ? [zone] : [];
}
function updateFrontages(c: RoadMap, net: LinkNetwork) {
  if (!net.frontages) return;
  net.frontages.clear();
  c.cells.forEach((cell, i) => net.frontages!.set(parcelTrafficZone(i), cell.road ? [i] : roadNeighbors(i).filter(n => c.cells[n]?.road).sort((a, b) => a - b)));
}
export const linkKey = (a: number, b: number) => `${a}>${b}`;
function makeLink(c: RoadMap, a: number, b: number, capacity = LANE_CAPACITY_VPH): Link {
  // This forward link is legal. Only a forbidden reverse movement makes this segment one-way;
  // an endpoint's perpendicular arrow must not widen a bidirectional junction branch.
  const lanes = roadDriveAllowed(c, b, a) ? 1 : 2;
  return { from: a, to: b, length: TILE_LENGTH_M, freeFlowKmh: FREE_FLOW_KMH, lanes, capacityPerHour: lanes * capacity };
}
function addCell(c: RoadMap, net: LinkNetwork, a: number) {
  for (const b of roadNeighbors(a)) if (roadDriveAllowed(c, a, b)) net.links.set(linkKey(a, b), makeLink(c, a, b, net.capacityPerLane));
}
function reindex(net: LinkNetwork) {
  net.out.clear();
  for (const l of [...net.links.values()].sort((x, y) => x.from - y.from || x.to - y.to)) {
    const list = net.out.get(l.from); if (list) list.push(l); else net.out.set(l.from, [l]);
  }
}
export function buildNetwork(c: RoadMap, options: { capacityPerLane?: number; parcelZones?: boolean } = {}): LinkNetwork {
  if (options.capacityPerLane !== undefined && (!Number.isFinite(options.capacityPerLane) || options.capacityPerLane <= 0)) throw Error('Invalid road capacity');
  const net: LinkNetwork = { links: new Map(), out: new Map(), ...(options.capacityPerLane === undefined ? {} : { capacityPerLane: options.capacityPerLane }), ...(options.parcelZones ? { frontages: new Map<number, number[]>() } : {}) };
  c.cells.forEach((cell, i) => { if (cell.road) addCell(c, net, i); });
  reindex(net); updateFrontages(c, net); return net;
}
/** Rebuild only links touching `cells` (and their neighbours) after a road edit. Mutates `net`. */
export function rebuildRegion(c: RoadMap, net: LinkNetwork, cells: Iterable<number>): LinkNetwork {
  const region = new Set<number>();
  for (const i of cells) { region.add(i); for (const n of roadNeighbors(i)) region.add(n); }
  for (const [k, l] of net.links) if (region.has(l.from) || region.has(l.to)) net.links.delete(k);
  for (const a of region) if (c.cells[a]?.road) for (const b of roadNeighbors(a)) {
    if (roadDriveAllowed(c, a, b)) net.links.set(linkKey(a, b), makeLink(c, a, b, net.capacityPerLane));
    if (roadDriveAllowed(c, b, a)) net.links.set(linkKey(b, a), makeLink(c, b, a, net.capacityPerLane));
  }
  reindex(net); updateFrontages(c, net); return net;
}
/** Free-flow travel time of a link in seconds. */
export const freeFlowSeconds = (l: Link) => l.length / (l.freeFlowKmh / 3.6);
