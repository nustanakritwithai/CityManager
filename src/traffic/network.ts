import { roadDriveAllowed, roadNeighbors, type RoadMap } from '../road-topology.ts';
/**
 * Directed link graph for the aggregate traffic model, built strictly from road-topology rules:
 * a link a→b exists iff roadDriveAllowed(a,b) — so parallel non-junction roads stay separate,
 * cancelled junctions are absent, and one-way arrows are honoured. Read-only; not saved.
 */
export const TILE_LENGTH_M = 100, FREE_FLOW_KMH = 40, LANE_CAPACITY_VPH = 600;
export type Link = { from: number; to: number; length: number; freeFlowKmh: number; lanes: number; capacityPerHour: number };
export type LinkNetwork = { links: Map<string, Link>; out: Map<number, Link[]> };
export const linkKey = (a: number, b: number) => `${a}>${b}`;
const isOneWay = (c: RoadMap, a: number, b: number) => c.roadTopology?.oneWay[a] != null || c.roadTopology?.oneWay[b] != null || !roadDriveAllowed(c, b, a);
function makeLink(c: RoadMap, a: number, b: number): Link {
  const lanes = isOneWay(c, a, b) ? 2 : 1;
  return { from: a, to: b, length: TILE_LENGTH_M, freeFlowKmh: FREE_FLOW_KMH, lanes, capacityPerHour: lanes * LANE_CAPACITY_VPH };
}
function addCell(c: RoadMap, net: LinkNetwork, a: number) {
  for (const b of roadNeighbors(a)) if (roadDriveAllowed(c, a, b)) net.links.set(linkKey(a, b), makeLink(c, a, b));
}
function reindex(net: LinkNetwork) {
  net.out.clear();
  for (const l of [...net.links.values()].sort((x, y) => x.from - y.from || x.to - y.to)) {
    const list = net.out.get(l.from); if (list) list.push(l); else net.out.set(l.from, [l]);
  }
}
export function buildNetwork(c: RoadMap): LinkNetwork {
  const net: LinkNetwork = { links: new Map(), out: new Map() };
  c.cells.forEach((cell, i) => { if (cell.road) addCell(c, net, i); });
  reindex(net); return net;
}
/** Rebuild only links touching `cells` (and their neighbours) after a road edit. Mutates `net`. */
export function rebuildRegion(c: RoadMap, net: LinkNetwork, cells: Iterable<number>): LinkNetwork {
  const region = new Set<number>();
  for (const i of cells) { region.add(i); for (const n of roadNeighbors(i)) region.add(n); }
  for (const [k, l] of net.links) if (region.has(l.from) || region.has(l.to)) net.links.delete(k);
  for (const a of region) if (c.cells[a]?.road) for (const b of roadNeighbors(a)) {
    if (roadDriveAllowed(c, a, b)) net.links.set(linkKey(a, b), makeLink(c, a, b));
    if (roadDriveAllowed(c, b, a)) net.links.set(linkKey(b, a), makeLink(c, b, a));
  }
  reindex(net); return net;
}
/** Free-flow travel time of a link in seconds. */
export const freeFlowSeconds = (l: Link) => l.length / (l.freeFlowKmh / 3.6);
