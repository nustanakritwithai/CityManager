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
export type Assignment = {
  /** Shares actually loaded this period; use with volumes and times, not next-period state. */
  assigned: RouteState;
  /** Damped shares for the next period; volumes, times and cost describe the current assignment. */
  state: RouteState;
  volumes: Map<string, number>; times: Map<string, number>;
  /** Route-assigned demand, not road admission or completed trips. This model has no queue. */
  served: number;
  unserved: number; vehicleSeconds: number;
};

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
/** Binary min-heap of [distance, node]; ties broken by lower node index for determinism. */
class Heap {
  private a: [number, number][] = [];
  get size() { return this.a.length; }
  private less(i: number, j: number) { const x = this.a[i], y = this.a[j]; return x[0] < y[0] || (x[0] === y[0] && x[1] < y[1]); }
  push(d: number, n: number) {
    const a = this.a; a.push([d, n]);
    for (let i = a.length - 1; i > 0;) { const p = (i - 1) >> 1; if (!this.less(i, p)) break; [a[i], a[p]] = [a[p], a[i]]; i = p; }
  }
  pop(): [number, number] {
    const a = this.a, top = a[0], last = a.pop()!;
    if (a.length) { a[0] = last; for (let i = 0; ;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && this.less(l, m)) m = l; if (r < a.length && this.less(r, m)) m = r; if (m === i) break; [a[i], a[m]] = [a[m], a[i]]; i = m; } }
    return top;
  }
}
/** One heap-based Dijkstra tree from `from` (O(E log V)); stops early once `to` is settled. */
export function shortestTree(net: LinkNetwork, times: ReadonlyMap<string, number>, from: number, to?: number): Map<number, number> {
  const dist = new Map([[from, 0]]), prev = new Map<number, number>(), done = new Set<number>(), heap = new Heap();
  heap.push(0, from);
  while (heap.size) {
    const [d, u] = heap.pop();
    if (done.has(u) || d > dist.get(u)!) continue;
    done.add(u); if (u === to) break;
    for (const l of net.out.get(u) ?? []) {
      const nd = d + (times.get(linkKey(l.from, l.to)) ?? Infinity), old = dist.get(l.to) ?? Infinity;
      if (nd < old || (nd === old && u < (prev.get(l.to) ?? Infinity))) { dist.set(l.to, nd); prev.set(l.to, u); heap.push(nd, l.to); }
    }
  }
  return prev;
}
const walk = (prev: ReadonlyMap<number, number>, from: number, to: number): number[] | null => {
  if (from === to) return [from];
  if (!prev.has(to)) return null;
  const path = [to]; while (path[0] !== from) path.unshift(prev.get(path[0])!);
  return path;
};
/** Deterministic Dijkstra (ties broken by lower node index). Returns cell path or null. */
export const shortestPath = (net: LinkNetwork, times: ReadonlyMap<string, number>, from: number, to: number): number[] | null => walk(shortestTree(net, times, from, to), from, to);
/** One search tree per origin, reused for every destination of that origin in a period. */
function treeCache(net: LinkNetwork, times: ReadonlyMap<string, number>) {
  const trees = new Map<number, Map<number, number>>();
  return (from: number, to: number) => { let t = trees.get(from); if (!t) trees.set(from, t = shortestTree(net, times, from)); return walk(t, from, to); };
}
/** Shrinking MSA-style step: REROUTE_SHARE at iteration 0, then REROUTE_SHARE·K/(K+k) so shares settle. */
export const SETTLE_PERIODS = 10;
export const rerouteStep = (iteration: number) => REROUTE_SHARE * SETTLE_PERIODS / (SETTLE_PERIODS + Math.max(0, iteration));
export const pathTime = (path: number[], times: ReadonlyMap<string, number>) => path.slice(1).reduce((s, b, i) => s + (times.get(linkKey(path[i], b)) ?? Infinity), 0);
const valid = (net: LinkNetwork, p: number[]) => p.slice(1).every((b, i) => net.links.has(linkKey(p[i], b)));
function load(net: LinkNetwork, od: readonly OdDemand[], state: RouteState) {
  const v = new Map<string, number>();
  for (const d of od) for (const ps of state.get(`${d.from}:${d.to}`) ?? []) for (let i = 1; i < ps.path.length; i++) { const k = linkKey(ps.path[i - 1], ps.path[i]); v.set(k, (v.get(k) ?? 0) + ps.share * d.vehicles); }
  return v;
}
/** Purpose-specific rows share one route state, so prepare, load and reroute each OD only once. */
function aggregateOd(od: readonly OdDemand[]): OdDemand[] {
  const grouped = new Map<string, OdDemand>();
  for (const d of od) if (d.vehicles > 0) {
    const key = `${d.from}:${d.to}`, existing = grouped.get(key);
    if (existing) existing.vehicles += d.vehicles;
    else grouped.set(key, { from: d.from, to: d.to, vehicles: d.vehicles });
  }
  return [...grouped.values()].sort((a, b) => a.from - b.from || a.to - b.to);
}
/**
 * Assign one period's OD demand. Uses last period's shares (dropping paths broken by road edits),
 * measures congested times, then moves REROUTE_SHARE of each OD onto its current best path.
 * Unreachable ODs count as `unserved` vehicles and keep no state.
 */
export function assignPeriod(net: LinkNetwork, od: readonly OdDemand[], prior: RouteState = new Map(), iteration: number | ReadonlyMap<string, number> = 0): Assignment {
  const rows = aggregateOd(od);
  const free = linkTimes(net, new Map()), freePath = treeCache(net, free), state: RouteState = new Map();
  // Quiet hours must retain learned routes. Prune road-invalidated paths even for inactive ODs.
  for (const [key, previous] of prior) {
    const paths = previous.filter(p => valid(net, p.path)).map(p => ({ path: [...p.path], share: p.share }));
    const sum = paths.reduce((s, p) => s + p.share, 0);
    if (sum <= 0) continue;
    // Preserve exact shares through quiet periods; only renormalize if a path was removed.
    if (paths.length !== previous.length) paths.forEach(p => p.share /= sum);
    state.set(key, paths);
  }
  let unserved = 0;
  for (const d of rows) {
    const key = `${d.from}:${d.to}`;
    let paths = state.get(key) ?? [];
    const sum = paths.reduce((s, p) => s + p.share, 0);
    if (sum > 0) paths.forEach(p => p.share /= sum);
    else { const p = freePath(d.from, d.to); if (!p) { unserved += d.vehicles; continue; } paths = [{ path: p, share: 1 }]; }
    state.set(key, paths);
  }
  const assigned: RouteState = new Map(rows.flatMap(d => {
    const key = `${d.from}:${d.to}`, paths = state.get(key);
    return paths ? [[key, paths.map(p => ({ path: [...p.path], share: p.share }))] as const] : [];
  }));
  const volumes = load(net, rows, assigned), times = linkTimes(net, volumes);
  // Freeze this period's cost from its loaded links before changing any shares for the next period.
  const vehicleSeconds = [...volumes].reduce((sum, [key, vehicles]) => sum + vehicles * times.get(key)!, 0);
  let served = 0;
  const bestPath = treeCache(net, times);
  for (const d of rows) {
    const key = `${d.from}:${d.to}`, paths = state.get(key); if (!paths) continue;
    served += d.vehicles;
    const step = rerouteStep(typeof iteration === 'number' ? iteration : iteration.get(key) ?? 0);
    const best = bestPath(d.from, d.to)!;
    const id = best.join(','); let hit = paths.find(p => p.path.join(',') === id);
    if (!hit) { hit = { path: best, share: 0 }; paths.push(hit); }
    for (const p of paths) p.share *= 1 - step;
    hit.share += step;
    state.set(key, paths.filter(p => p.share > 1e-4).sort((a, b) => a.path.join(',').localeCompare(b.path.join(','))));
  }
  return { assigned, state, volumes, times, served, unserved, vehicleSeconds };
}
export const averageTripSeconds = (a: Assignment) => a.served ? a.vehicleSeconds / a.served : 0;
