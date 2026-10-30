import { freeFlowSeconds, linkKey, resolveTrafficZone, type LinkNetwork } from './network.ts';
import { shortestPath, type OdDemand } from './routing.ts';

/** Provisional gameplay budgets, in the SAME ten-person representative trip units as demand.
 * Numeric cohorts, not draw objects, own all transport mass. No population/render cap applies. */
export const FLOW_LANE_CAPACITY = 30, FLOW_JUNCTION_CAPACITY = 12, FLOW_STORAGE_PER_LANE = 4;
const MINUTES_PER_HOUR = 60, EPS = 1e-7;
type Waiting = { from: number; to: number; amount: number };
type Batch = { destination: number; path: number[]; index: number; amount: number; blocked: number };
export type TrafficFlowState = { version: 1; minute: number; offered: number; admitted: number; completed: number; peakQueued: number; waiting: Waiting[]; batches: Batch[] };
export type FlowRenderGroup = { key: string; from: number; to: number; path: number[]; amount: number; queued: number; storage: number; unreachable: boolean; onRoad: boolean };
export type FlowLink = { key: string; from: number; to: number; amount: number; queued: number; storage: number; capacityPerHour: number; closed: boolean };
export type FlowDiagnostics = { offered: number; admitted: number; completed: number; onRoad: number; waiting: number; unreachable: number; queued: number; peakQueued: number; conservationError: number; periods: number; lastAdmitted: number; lastCompleted: number; links: FlowLink[]; bottlenecks: { cell: number; queued: number; capacityPerHour: number }[] };
const clone = <T>(v: T): T => structuredClone(v);
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const zone = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
const keyOf = (b: Batch) => linkKey(b.path[b.index], b.path[b.index + 1]);
const batchKey = (b: Batch) => `${b.destination}|${b.path.slice(b.index).join(',')}`;
function junctions(net: LinkNetwork) {
  const adj = new Map<number, Set<number>>();
  for (const l of net.links.values()) for (const [a, b] of [[l.from, l.to], [l.to, l.from]]) { const set = adj.get(a) ?? new Set<number>(); set.add(b); adj.set(a, set); }
  return new Set([...adj].filter(([, s]) => s.size > 2).map(([n]) => n));
}
function occupancy(batches: Batch[]) { const out = new Map<string, number>(); for (const b of batches) out.set(keyOf(b), (out.get(keyOf(b)) ?? 0) + b.amount); return out; }
function storage(net: LinkNetwork, key: string) { return (net.links.get(key)?.lanes ?? 0) * FLOW_STORAGE_PER_LANE; }
/** Same legal shortest-path implementation as the assignment model, with current storage delay.
 * A cache belongs to one immutable routing snapshot, never across a road edit. */
function routes(net: LinkNetwork, occupied: ReadonlyMap<string, number>) {
  const times = new Map([...net.links].map(([key, l]) => [key, freeFlowSeconds(l) + (occupied.get(key) ?? 0) / l.capacityPerHour * 3600]));
  const cache = new Map<string, number[] | null>();
  return (from: number, to: number): number[] | null => {
    const key = `${from}:${to}`; if (cache.has(key)) return cache.get(key)!;
    let best: number[] | null = null, cost = Infinity;
    for (const a of resolveTrafficZone(net, from)) for (const b of resolveTrafficZone(net, to)) {
      const p = shortestPath(net, times, a, b); if (!p) continue;
      const t = p.slice(1).reduce((n, cell, i) => n + times.get(linkKey(p[i], cell))!, 0);
      if (t < cost || (t === cost && p.join(',') < (best?.join(',') ?? '~'))) { best = p; cost = t; }
    }
    cache.set(key, best); return best;
  };
}
/** Aggregate cell-transmission queue. One hour consists of sixty deterministic minute quanta.
 * A cohort can traverse at most one link per quantum. This conservative travel resolution is
 * explicit (not 40km/h exact motion); link/junction throughput remains units per game hour.
 * An origin queue is unbounded numeric mass; on-road storage is finite. No fade/drop operation. */
export class TrafficFlow {
  private state: TrafficFlowState = { version: 1, minute: 0, offered: 0, admitted: 0, completed: 0, peakQueued: 0, waiting: [], batches: [] };
  private lastAdmitted = 0;
  private lastCompleted = 0;
  get snapshot(): TrafficFlowState { return clone(this.state); }
  exportState(): TrafficFlowState { return this.snapshot; }
  static restore(value: unknown): TrafficFlow {
    const s = value as TrafficFlowState;
    if (!s || s.version !== 1 || !zone(s.minute) || s.minute % 60 !== 0 || ![s.offered, s.admitted, s.completed, s.peakQueued].every(finite) || !Array.isArray(s.waiting) || !Array.isArray(s.batches)) throw Error('Invalid traffic flow snapshot');
    if (s.admitted > s.offered + EPS || s.completed > s.admitted + EPS) throw Error('Invalid traffic flow cumulative totals');
    const keys = new Set<string>();
    for (const w of s.waiting) { const key = `${w.from}:${w.to}`; if (!zone(w.from) || !zone(w.to) || !finite(w.amount) || w.amount === 0 || keys.has(key)) throw Error('Invalid waiting traffic'); keys.add(key); }
    for (const b of s.batches) if (!zone(b.destination) || !Array.isArray(b.path) || b.path.length < 2 || b.path.some(n => !zone(n) || n >= 576) || !zone(b.index) || b.index >= b.path.length - 1 || !finite(b.amount) || b.amount === 0 || !finite(b.blocked) || b.blocked > b.amount + EPS) throw Error('Invalid admitted traffic');
    const pending = s.waiting.reduce((n, w) => n + w.amount, 0) + s.batches.reduce((n, b) => n + b.amount, 0);
    if (Math.abs(s.offered - s.completed - pending) > EPS * Math.max(1, s.offered)) throw Error('Traffic flow conservation mismatch');
    const flow = new TrafficFlow(); flow.state = clone(s); return flow;
  }
  /** No advancement or new demand: only legal route repair. Removed occupied links remain
   * represented at their old link until restored; future suffixes may reroute from the head. */
  roadEdited(net: LinkNetwork): void { this.repair(net); }
  private repair(net: LinkNetwork) {
    const route = routes(net, occupancy(this.state.batches));
    for (const b of this.state.batches) {
      if (!net.links.has(keyOf(b))) { b.blocked = b.amount; continue; }
      const head = b.path[b.index + 1], goals = resolveTrafficZone(net, b.destination);
      if (goals.includes(b.path.at(-1)!) && b.path.slice(b.index + 2).every((n, i) => net.links.has(linkKey(b.path[b.index + 1 + i], n)))) continue;
      const tail = route(head, b.destination);
      if (tail) { b.path = [b.path[b.index], ...tail]; b.index = 0; }
      else b.blocked = b.amount;
    }
  }
  advancePeriod(net: LinkNetwork, offered: readonly OdDemand[]): void {
    for (const d of offered) if (!zone(d.from) || !zone(d.to) || !finite(d.vehicles)) throw Error('Invalid offered traffic');
    const beforeA = this.state.admitted, beforeC = this.state.completed;
    const waiting = new Map(this.state.waiting.map(w => [`${w.from}:${w.to}`, w]));
    for (const d of offered) if (d.vehicles > 0) {
      const key = `${d.from}:${d.to}`, existing = waiting.get(key);
      if (existing) existing.amount += d.vehicles; else waiting.set(key, { from: d.from, to: d.to, amount: d.vehicles });
      this.state.offered += d.vehicles;
    }
    this.state.waiting = [...waiting.values()].sort((a, b) => a.from - b.from || a.to - b.to);
    this.repair(net);
    const nodes = junctions(net);
    for (let minute = 0; minute < MINUTES_PER_HOUR; minute++) this.quantum(net, nodes);
    this.lastAdmitted = this.state.admitted - beforeA; this.lastCompleted = this.state.completed - beforeC;
    const d = this.diagnostics(net); this.state.peakQueued = Math.max(this.state.peakQueued, d.queued);
    if (Math.abs(d.conservationError) > EPS * Math.max(1, d.offered)) throw Error('Traffic flow lost demand');
  }
  private quantum(net: LinkNetwork, nodes: Set<number>) {
    const s = this.state, occ = occupancy(s.batches), route = routes(net, occ);
    const input = new Map([...net.links].map(([k, l]) => [k, l.capacityPerHour / 60])), output = new Map(input), service = new Map([...nodes].map(n => [n, FLOW_JUNCTION_CAPACITY / 60]));
    const takeNode = (n: number, amount: number) => { if (service.has(n)) service.set(n, service.get(n)! - amount); };
    const nodeRoom = (n: number) => service.get(n) ?? Infinity;
    const additions: Batch[] = [];
    const groups = new Map<string, Batch[]>(); for (const b of s.batches) { const k = keyOf(b); (groups.get(k) ?? groups.set(k, []).get(k)!).push(b); }
    // Rotate link/origin priority deterministically so a permanent low-ID source cannot monopolize a shared junction.
    const ordered = [...groups.keys()].sort(), shift = ordered.length ? s.minute % ordered.length : 0;
    for (const key of [...ordered.slice(shift), ...ordered.slice(0, shift)]) for (const b of groups.get(key)!) {
      b.blocked = 0;
      if (!net.links.has(key)) { b.blocked = b.amount; continue; }
      const head = b.path[b.index + 1], atGoal = resolveTrafficZone(net, b.destination).includes(head);
      const next = atGoal ? null : linkKey(head, b.path[b.index + 2]);
      const legal = atGoal || b.index + 2 < b.path.length && net.links.has(next!);
      if (!legal) { b.blocked = b.amount; continue; }
      const room = next ? Math.max(0, storage(net, next) - (occ.get(next) ?? 0)) : Infinity;
      const moved = Math.min(b.amount, output.get(key) ?? 0, nodeRoom(head), room, next ? input.get(next)! : Infinity);
      if (moved > 0) {
        b.amount -= moved; output.set(key, output.get(key)! - moved); takeNode(head, moved);
        // Reserve next-link storage now; vacated storage is released only after all existing cohorts
        // were considered, so cars cannot leap across a full downstream queue within one quantum.
        if (next) { occ.set(next, (occ.get(next) ?? 0) + moved); input.set(next, input.get(next)! - moved); additions.push({ destination: b.destination, path: b.path, index: b.index + 1, amount: moved, blocked: 0 }); }
        else s.completed += moved;
      }
      b.blocked = b.amount;
    }
    s.batches = s.batches.filter(b => b.amount > 0);
    for (const b of additions) s.batches.push(b);
    const after = occupancy(s.batches), originOrder = [...s.waiting], offset = originOrder.length ? s.minute % originOrder.length : 0;
    for (const w of [...originOrder.slice(offset), ...originOrder.slice(0, offset)]) {
      const path = route(w.from, w.to); if (!path) continue;
      if (path.length === 1) { s.admitted += w.amount; s.completed += w.amount; w.amount = 0; continue; }
      const key = linkKey(path[0], path[1]), room = Math.max(0, storage(net, key) - (after.get(key) ?? 0));
      const moved = Math.min(w.amount, input.get(key) ?? 0, room, nodeRoom(path[0]));
      if (moved <= 0) continue;
      w.amount -= moved; input.set(key, input.get(key)! - moved); takeNode(path[0], moved); after.set(key, (after.get(key) ?? 0) + moved); s.admitted += moved;
      s.batches.push({ destination: w.to, path, index: 0, amount: moved, blocked: 0 });
    }
    s.waiting = s.waiting.filter(w => w.amount > 0);
    const merged = new Map<string, Batch>();
    for (const b of s.batches) { const key = batchKey(b), old = merged.get(key); if (old) { old.amount += b.amount; old.blocked += b.blocked; } else merged.set(key, { ...b, path: b.path.slice(b.index), index: 0 }); }
    s.batches = [...merged.values()]; s.minute++;
  }
  renderGroups(net: LinkNetwork): FlowRenderGroup[] {
    const groups = new Map<string, FlowRenderGroup>();
    for (const b of this.state.batches) {
      const key = keyOf(b), l = net.links.get(key), old = groups.get(key);
      if (old) { old.amount += b.amount; old.queued += b.blocked; }
      else groups.set(key, { key, from: b.path[b.index], to: b.path[b.index + 1], path: b.path.slice(b.index), amount: b.amount, queued: b.blocked, storage: storage(net, key), unreachable: !l, onRoad: true });
    }
    return [...groups.values()].sort((a, b) => a.key.localeCompare(b.key));
  }
  diagnostics(net: LinkNetwork): FlowDiagnostics {
    const s = this.state, route = routes(net, occupancy(s.batches)); let waiting = 0, unreachable = 0, onRoad = 0, blockedOnRoad = 0;
    const nodeQueue = new Map<number, number>();
    for (const w of s.waiting) { const p = route(w.from, w.to); if (p) { waiting += w.amount; nodeQueue.set(p[0], (nodeQueue.get(p[0]) ?? 0) + w.amount); } else unreachable += w.amount; }
    for (const b of s.batches) {
      const legal = net.links.has(keyOf(b)), p = legal ? route(b.path[b.index + 1], b.destination) : null;
      if (!legal || !p) unreachable += b.amount; else { onRoad += b.amount; blockedOnRoad += b.blocked; nodeQueue.set(b.path[b.index + 1], (nodeQueue.get(b.path[b.index + 1]) ?? 0) + b.blocked); }
    }
    const queued = waiting + unreachable + blockedOnRoad, nodes = junctions(net);
    const links = this.renderGroups(net).map(g => ({ key: g.key, from: g.from, to: g.to, amount: g.amount, queued: g.queued, storage: g.storage, capacityPerHour: net.links.get(g.key)?.capacityPerHour ?? 0, closed: !net.links.has(g.key) }));
    const bottlenecks = [...nodeQueue].filter(([, amount]) => amount > EPS).map(([cell, amount]) => ({ cell, queued: amount, capacityPerHour: nodes.has(cell) ? FLOW_JUNCTION_CAPACITY : Math.max(0, ...(net.out.get(cell) ?? []).map(l => l.capacityPerHour)) })).sort((a, b) => b.queued - a.queued || a.cell - b.cell);
    return { offered: s.offered, admitted: s.admitted, completed: s.completed, onRoad, waiting, unreachable, queued, peakQueued: Math.max(s.peakQueued, queued), conservationError: s.offered - s.completed - onRoad - waiting - unreachable, periods: s.minute / 60, lastAdmitted: this.lastAdmitted, lastCompleted: this.lastCompleted, links, bottlenecks };
  }
}
