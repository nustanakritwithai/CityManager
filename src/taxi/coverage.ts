import { linkKey, type LinkNetwork } from '../traffic/network.ts';
import { shortestTree } from '../traffic/routing.ts';
/**
 * Travel-time coverage over the road network (pure). Times are link seconds, e.g. linkTimes() of the
 * previous period (congested). Uses routing.ts' heap Dijkstra tree; no new path search.
 */
export const TAXI_DISPATCH_MINUTES = 8;
export type TravelTree = { from: number; prev: Map<number, number>; seconds: Map<number, number> };
export function travelTree(net: LinkNetwork, times: ReadonlyMap<string, number>, from: number): TravelTree {
  const prev = shortestTree(net, times, from), seconds = new Map<number, number>([[from, 0]]);
  const at = (n: number): number => {
    const known = seconds.get(n); if (known !== undefined) return known;
    const p = prev.get(n)!, s = at(p) + (times.get(linkKey(p, n)) ?? Infinity); seconds.set(n, s); return s;
  };
  for (const n of prev.keys()) at(n);
  return { from, prev, seconds };
}
export const treeMinutes = (t: TravelTree, to: number) => (t.seconds.get(to) ?? Infinity) / 60;
export function treePath(t: TravelTree, to: number): number[] | null {
  if (to === t.from) return [to];
  if (!t.prev.has(to)) return null;
  const p = [to]; while (p[0] !== t.from) p.unshift(t.prev.get(p[0])!); return p;
}
/** Cell → depot id for every road cell reachable from a depot within `minutes` (nearest; tie → lower id). */
export function dispatchZones(net: LinkNetwork, times: ReadonlyMap<string, number>, depots: readonly { id: number; cell: number }[], minutes = TAXI_DISPATCH_MINUTES): Map<number, { depotId: number; minutes: number }> {
  const zone = new Map<number, { depotId: number; minutes: number }>();
  for (const d of [...depots].sort((a, b) => a.id - b.id)) {
    const t = travelTree(net, times, d.cell);
    for (const [cell, s] of t.seconds) {
      const m = s / 60; if (m > minutes + 1e-9) continue;
      const cur = zone.get(cell); if (!cur || m < cur.minutes - 1e-9) zone.set(cell, { depotId: d.id, minutes: m });
    }
  }
  return zone;
}
