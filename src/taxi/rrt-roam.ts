import { linkKey, type LinkNetwork } from '../traffic/network.ts';
/**
 * Seeded RRT roaming for idle taxis (pure, deterministic). The tree grows only along `net.out`
 * links, so every step is a legal drive (one-way roads and blocked junctions respected). Samples are
 * biased toward expected demand; the plan ends at the tree node with the best demand per minute.
 * Cost is bounded by `maxNodes` tree nodes and `maxMinutes` of driving.
 */
export const RRT_MAX_NODES = 48, RRT_MAX_MINUTES = 5, RRT_DEMAND_BIAS = 0.8;
export type RoamOptions = { seed: number; taxiId: string; period: number; width: number; weight: (cell: number) => number; demandCells: readonly number[]; maxNodes?: number; maxMinutes?: number };
export type RoamPlan = { path: number[]; minutes: number; score: number; expanded: number };

function hash(...parts: (number | string)[]): number {
  let h = 2166136261 >>> 0;
  for (const p of parts) for (const ch of String(p) + '|') { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return h;
}
export function roamRng(seed: number, taxiId: string, period: number, start: number): () => number {
  let a = hash(seed, taxiId, period, start);
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function planRoam(net: LinkNetwork, times: ReadonlyMap<string, number>, start: number, o: RoamOptions): RoamPlan {
  const maxNodes = o.maxNodes ?? RRT_MAX_NODES, maxMin = o.maxMinutes ?? RRT_MAX_MINUTES, W = o.width;
  const rng = roamRng(o.seed, o.taxiId, o.period, start);
  const xy = (c: number) => [c % W, Math.floor(c / W)] as const;
  const dist = (a: number, b: number) => { const [ax, ay] = xy(a), [bx, by] = xy(b); return Math.abs(ax - bx) + Math.abs(ay - by); };
  const parent = new Map<number, number>([[start, -1]]), mins = new Map<number, number>([[start, 0]]), nodes = [start];
  const demand = [...o.demandCells].sort((a, b) => a - b);
  let expanded = 0;
  for (let iter = 0; iter < maxNodes * 4 && nodes.length < maxNodes; iter++) {
    // Sample: demand cell (bias) or a random cell near a random tree node.
    let sample: number;
    if (demand.length && rng() < RRT_DEMAND_BIAS) sample = demand[Math.floor(rng() * demand.length)];
    else { const [x, y] = xy(nodes[Math.floor(rng() * nodes.length)]); sample = Math.max(0, y + Math.floor(rng() * 9) - 4) * W + Math.min(W - 1, Math.max(0, x + Math.floor(rng() * 9) - 4)); }
    let near = nodes[0], nd = Infinity;
    for (const n of nodes) { const d = dist(n, sample); if (d < nd) { nd = d; near = n; } }
    // Extend one legal link toward the sample.
    let step: number | null = null, sd = Infinity, sm = 0;
    for (const l of net.out.get(near) ?? []) {
      if (parent.has(l.to)) continue;
      const m = mins.get(near)! + (times.get(linkKey(near, l.to)) ?? Infinity) / 60;
      if (!(m <= maxMin + 1e-9)) continue;
      const d = dist(l.to, sample); if (d < sd || (d === sd && step !== null && l.to < step)) { sd = d; step = l.to; sm = m; }
    }
    if (step === null) continue;
    parent.set(step, near); mins.set(step, sm); nodes.push(step); expanded++;
  }
  // Best branch: expected demand per minute (start excluded when the tree grew, so taxis keep moving);
  // a small seeded jitter breaks ties between equally good branches.
  let best = start, bs = -Infinity;
  for (const n of nodes) { if (n === start && nodes.length > 1) continue; const s = o.weight(n) * (1 + 0.05 * rng()) / (1 + mins.get(n)!); if (s > bs + 1e-12 || (Math.abs(s - bs) <= 1e-12 && mins.get(n)! < mins.get(best)!)) { bs = s; best = n; } }
  const path = [best]; while (parent.get(path[0])! !== -1) path.unshift(parent.get(path[0])!);
  return { path, minutes: mins.get(best)!, score: bs, expanded };
}
