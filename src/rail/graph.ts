/** Preparation-only rail topology. Explicit cardinal links, independent of road connectivity.
 * No elevation/crossing/placement policy is inferred here; those remain owner decisions. */
import { roadNeighbors } from '../road-topology.ts';

export type RailLink = { from: number; to: number; minutes: number };
export type RailGraph = { revision: number; links: RailLink[] };
export type RailPath = { cells: number[]; minutes: number };
export const safeCount = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
export const validId = (id: unknown): id is string => typeof id === 'string' && /^[a-zA-Z0-9:_-]{1,100}$/.test(id);
const cell = (n: unknown): n is number => safeCount(n) && n < 24 * 24;

export function createRailGraph(revision: number, links: readonly RailLink[]): RailGraph {
  if (!safeCount(revision)) throw Error('Invalid rail graph revision');
  const seen = new Set<string>();
  for (const l of links) {
    const key = `${l.from}:${l.to}`;
    if (!cell(l.from) || !cell(l.to) || !roadNeighbors(l.from).includes(l.to) || !safeCount(l.minutes) || l.minutes < 1 || seen.has(key)) throw Error('Invalid or duplicate rail link');
    seen.add(key);
  }
  return { revision, links: links.map(l => ({ ...l })).sort((a, b) => a.from - b.from || a.to - b.to) };
}

/** Deterministic small-grid Dijkstra. Caller caches only against an immutable graph revision. */
export function railPath(graph: RailGraph, from: number, to: number): RailPath | null {
  if (!cell(from) || !cell(to)) throw Error('Invalid rail endpoint');
  const dist = new Map([[from, 0]]), prev = new Map<number, number>(), done = new Set<number>();
  while (true) {
    let u = -1, best = Infinity;
    for (const [n, d] of dist) if (!done.has(n) && (d < best || (d === best && n < u))) { u = n; best = d; }
    if (u < 0) return null;
    if (u === to) {
      const cells = [to]; while (cells[0] !== from) cells.unshift(prev.get(cells[0])!);
      return { cells, minutes: best };
    }
    done.add(u);
    for (const l of graph.links) if (l.from === u) {
      const next = best + l.minutes;
      if (!safeCount(next)) throw Error('Rail path duration overflow');
      if (next < (dist.get(l.to) ?? Infinity)) { dist.set(l.to, next); prev.set(l.to, u); }
    }
  }
}
