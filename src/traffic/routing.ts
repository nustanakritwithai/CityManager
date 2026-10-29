import { freeFlowSeconds, linkKey, type Link, type LinkNetwork } from './network.ts';
/**
 * Aggregate route assignment over the link network (network.ts).
 * Link cost = free-flow time × BPR volume-delay (1 + α(v/c)^β) + junction wait at the head node.
 * Each period only REROUTE_SHARE of an OD's vehicles move to the current best path (MSA-style
 * damping) so assignments don't flip-flop. Deterministic; read-only; nothing enters a save.
 */
export const BPR_ALPHA = .15, BPR_BETA = 4, JUNCTION_WAIT_S = 6, REROUTE_SHARE = .1;
/** Structural OD row — compatible with OdEntry from demand.ts without importing it. */
export type OdDemand = { from: number; to: number; vehicles: number };
export type PathShare = { path: number[]; share: number };
/** Per-OD path shares, carried between periods. Key: "from:to". */
export type RouteState = Map<string, PathShare[]>;
export type Assignment = { state: RouteState; volumes: Map<string, number>; times: Map<string, number>; served: number; unserved: number; vehicleSeconds: number };

export const bprTime = (l: Link, volume: number) => freeFlowSeconds(l) * (1 + BPR_ALPHA * (volume / l.capacityPerHour) ** BPR_BETA);
/** A junction is a node with more than two distinct road neighbours reachable in or out. */
function junctions(net: LinkNetwork): Set<number> {
  const adj = new Map<number, Set<number>>();
  for (const l of net.links.values()) for (const [a, b] of [[l.from, l.to], [l.to, l.from]]) { const s = adj.get(a) ?? new Set(); s.add(b); adj.set(a, s); }
  return new Set([...adj].filter(([, s]) => s.size > 2).map(([n]) => n));
}
export function linkTimes(net: LinkNetwork, volumes: ReadonlyMap<string, number>): Map<string, number> {
  const j = junctions(net), t = new Map<string, number>();
  for (const [k, l] of net.links) t.set(k, bprTime(l, volumes.get(k) ?? 0) + (j.has(l.to) ? JUNCTION_WAIT_S : 0));
  return t;
}
/** Deterministic Dijkstra (ties broken by lower node index). Returns cell path or null. */
export function shortestPath(net: LinkNetwork, times: ReadonlyMap<string, number>, from: number, to: number): number[] | null {
  if (from === to) return [from];
  const dist = new Map([[from, 0]]), prev = new Map<number, number>(), done = new Set<number>();
  while (true) {
    let u = -1, best = Infinity;
    for (const [n, d] of dist) if (!done.has(n) && (d < best || (d === best && n < u))) { u = n; best = d; }
    if (u < 0) return null;
    if (u === to) break;
    done.add(u);
    for (const l of net.out.get(u) ?? []) {
      const nd = best + (times.get(linkKey(l.from, l.to)) ?? Infinity);
      if (nd < (dist.get(l.to) ?? Infinity)) { dist.set(l.to, nd); prev.set(l.to, u); }
    }
  }
  const path = [to]; while (path[0] !== from) path.unshift(prev.get(path[0])!);
  return path;
}
export const pathTime = (path: number[], times: ReadonlyMap<string, number>) => path.slice(1).reduce((s, b, i) => s + (times.get(linkKey(path[i], b)) ?? Infinity), 0);
const valid = (net: LinkNetwork, p: number[]) => p.slice(1).every((b, i) => net.links.has(linkKey(p[i], b)));
function load(net: LinkNetwork, od: readonly OdDemand[], state: RouteState) {
  const v = new Map<string, number>();
  for (const d of od) for (const ps of state.get(`${d.from}:${d.to}`) ?? []) for (let i = 1; i < ps.path.length; i++) { const k = linkKey(ps.path[i - 1], ps.path[i]); v.set(k, (v.get(k) ?? 0) + ps.share * d.vehicles); }
  return v;
}
/**
 * Assign one period's OD demand. Uses last period's shares (dropping paths broken by road edits),
 * measures congested times, then moves REROUTE_SHARE of each OD onto its current best path.
 * Unreachable ODs count as `unserved` vehicles and keep no state.
 */
export function assignPeriod(net: LinkNetwork, od: readonly OdDemand[], prior: RouteState = new Map()): Assignment {
  const rows = [...od].filter(d => d.vehicles > 0).sort((a, b) => a.from - b.from || a.to - b.to);
  const free = linkTimes(net, new Map()), state: RouteState = new Map();
  let unserved = 0;
  for (const d of rows) {
    const key = `${d.from}:${d.to}`;
    let paths = (prior.get(key) ?? []).filter(p => valid(net, p.path)).map(p => ({ ...p }));
    const sum = paths.reduce((s, p) => s + p.share, 0);
    if (sum > 0) paths.forEach(p => p.share /= sum);
    else { const p = shortestPath(net, free, d.from, d.to); if (!p) { unserved += d.vehicles; continue; } paths = [{ path: p, share: 1 }]; }
    state.set(key, paths);
  }
  const volumes = load(net, rows, state), times = linkTimes(net, volumes);
  let vehicleSeconds = 0, served = 0;
  for (const d of rows) {
    const key = `${d.from}:${d.to}`, paths = state.get(key); if (!paths) continue;
    served += d.vehicles;
    for (const p of paths) vehicleSeconds += p.share * d.vehicles * pathTime(p.path, times);
    const best = shortestPath(net, times, d.from, d.to)!;
    const id = best.join(','); let hit = paths.find(p => p.path.join(',') === id);
    if (!hit) { hit = { path: best, share: 0 }; paths.push(hit); }
    for (const p of paths) p.share *= 1 - REROUTE_SHARE;
    hit.share += REROUTE_SHARE;
    state.set(key, paths.filter(p => p.share > 1e-4).sort((a, b) => a.path.join(',').localeCompare(b.path.join(','))));
  }
  return { state, volumes, times, served, unserved, vehicleSeconds };
}
export const averageTripSeconds = (a: Assignment) => a.served ? a.vehicleSeconds / a.served : 0;
