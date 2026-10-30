import { freeFlowSeconds, linkKey, resolveTrafficZone, type Link, type LinkNetwork } from './network.ts';
import { shortestPath, type OdDemand } from './routing.ts';
import { roadNeighbors } from '../road-topology.ts';
import { movementMask } from './movements.ts';

/** Provisional gameplay budgets, in the SAME ten-person representative trip units as demand.
 * Numeric cohorts, not draw objects, own all transport mass. No population/render cap applies. */
export const FLOW_LANE_CAPACITY = 30, FLOW_STORAGE_PER_LANE = 4;
/** One lane of service per conflict quadrant. Widening an approach does not widen
 * the intersection. Gameplay units remain provisional until runtime playtesting. */
export const FLOW_JUNCTION_CAPACITY = FLOW_LANE_CAPACITY;
const MINUTES_PER_HOUR = 60, EPS = 1e-7;
type Waiting = { from: number; to: number; amount: number; requestId?: string };
type Batch = { destination: number; path: number[]; index: number; amount: number; blocked: number; requestId?: string };
export type FlowOffer = OdDemand & { requestId?: string };
export type FlowRequestRecord = { requestId: string; from: number; to: number; offered: number; admitted: number; completed: number; transferred: number };
export type FlowReceipt = FlowRequestRecord & { waiting: number; active: number };
export type TrafficFlowState = { version: 2; minute: number; offered: number; admitted: number; completed: number; transferred: number; peakQueued: number; waiting: Waiting[]; batches: Batch[]; requests: FlowRequestRecord[] };
export type FlowRenderGroup = { key: string; from: number; to: number; path: number[]; amount: number; queued: number; storage: number; unreachable: boolean; onRoad: boolean };
export type FlowLink = { key: string; from: number; to: number; amount: number; queued: number; storage: number; capacityPerHour: number; closed: boolean };
export type FlowDiagnostics = { offered: number; admitted: number; completed: number; transferred: number; onRoad: number; waiting: number; unreachable: number; queued: number; peakQueued: number; conservationError: number; periods: number; lastAdmitted: number; lastCompleted: number; links: FlowLink[]; bottlenecks: { cell: number; queued: number; capacityPerHour: number }[] };
const clone = <T>(v: T): T => structuredClone(v);
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER;
const zone = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
const fields = (v: unknown, expected: string) => !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).sort().join(',') === expected;
const equalMass = (a: number, b: number) => Math.abs(a - b) <= Math.max(EPS, Number.EPSILON * 32 * Math.max(a, b));
const validId = (id: unknown): id is string => typeof id === 'string' && id.length > 0 && id.length <= 256 && !/[\u0000-\u001f]/.test(id);
const tag = (v: {requestId?: string}) => v.requestId === undefined ? {} : {requestId:v.requestId};
const waitingKey = (w: {from: number; to: number; requestId?: string}) => JSON.stringify([w.requestId ?? null,w.from,w.to]);
const keyOf = (b: Batch) => linkKey(b.path[b.index], b.path[b.index + 1]);
const batchKey = (b: Batch) => JSON.stringify([b.requestId ?? null,b.destination,b.path.slice(b.index)]);
function junctions(net: LinkNetwork) {
  const adj = new Map<number, Set<number>>();
  for (const l of net.links.values()) for (const [a, b] of [[l.from, l.to], [l.to, l.from]]) { const set = adj.get(a) ?? new Set<number>(); set.add(b); adj.set(a, set); }
  return new Set([...adj].filter(([, s]) => s.size > 2).map(([n]) => n));
}
function occupancy(batches: Batch[]) { const out = new Map<string, number>(); for (const b of batches) out.set(keyOf(b), (out.get(keyOf(b)) ?? 0) + b.amount); return out; }
function storage(net: LinkNetwork, key: string) { return (net.links.get(key)?.lanes ?? 0) * FLOW_STORAGE_PER_LANE; }
/** Same legal shortest-path implementation as the assignment model, with current storage delay.
 * A cache belongs to one immutable routing snapshot, never across a road edit. */
function routes(net: LinkNetwork, occupied: ReadonlyMap<string, number>, entryAllowed?: (link: Link) => boolean) {
  const times = new Map([...net.links].map(([key, l]) => [key, freeFlowSeconds(l) + (occupied.get(key) ?? 0) / l.capacityPerHour * 3600]));
  const cache = new Map<string, number[] | null>();
  return (from: number, to: number): number[] | null => {
    const key = `${from}:${to}`; if (cache.has(key)) return cache.get(key)!;
    let best: number[] | null = null, cost = Infinity;
    for (const a of resolveTrafficZone(net, from)) for (const b of resolveTrafficZone(net, to)) {
      const graph = entryAllowed ? { ...net, out: new Map(net.out).set(a, (net.out.get(a) ?? []).filter(entryAllowed)) } : net;
      const p = shortestPath(graph, times, a, b); if (!p) continue;
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
  private state: TrafficFlowState = { version: 2, minute: 0, offered: 0, admitted: 0, completed: 0, transferred: 0, peakQueued: 0, waiting: [], batches: [], requests: [] };
  private requests = new Map<string,FlowRequestRecord>();
  private lastAdmitted = 0;
  private lastCompleted = 0;
  get snapshot(): TrafficFlowState { return clone(this.state); }
  exportState(): TrafficFlowState { return this.snapshot; }
  static restore(value: unknown): TrafficFlow {
    const legacy = value as {version?:number; waiting?: Waiting[]; batches?:Batch[]};
    if (legacy?.version === 1 && (!fields(legacy,'admitted,batches,completed,minute,offered,peakQueued,version,waiting') || !Array.isArray(legacy.waiting) || !Array.isArray(legacy.batches) || [...legacy.waiting,...legacy.batches].some(row=>!row || Object.hasOwn(row,'requestId')))) throw Error('Invalid legacy traffic snapshot');
    const s = (legacy?.version === 1 ? {...legacy,version:2,transferred:0,requests:[]} : value) as TrafficFlowState;
    if (!fields(s, 'admitted,batches,completed,minute,offered,peakQueued,requests,transferred,version,waiting') || s.version !== 2 || !zone(s.minute) || ![s.offered, s.admitted, s.completed, s.transferred, s.peakQueued].every(finite) || !Array.isArray(s.waiting) || !Array.isArray(s.batches) || !Array.isArray(s.requests)) throw Error('Invalid traffic flow snapshot fields');
    if (s.admitted > s.offered + EPS || s.completed > s.admitted + EPS) throw Error('Invalid traffic flow cumulative totals');
    const keys = new Set<string>();
    for (const w of s.waiting) {
      if (!w || !fields(w, w.requestId === undefined ? 'amount,from,to' : 'amount,from,requestId,to') || w.requestId !== undefined && !validId(w.requestId) || !zone(w.from) || !zone(w.to) || !finite(w.amount) || w.amount === 0) throw Error('Invalid waiting traffic');
      const key = waitingKey(w); if (keys.has(key)) throw Error('Duplicate waiting traffic'); keys.add(key);
    }
    const batches = new Set<string>();
    for (const b of s.batches) {
      if (!b || !fields(b, b.requestId === undefined ? 'amount,blocked,destination,index,path' : 'amount,blocked,destination,index,path,requestId') || b.requestId !== undefined && !validId(b.requestId) || !zone(b.destination) || !Array.isArray(b.path) || b.path.length < 2 || b.path.length > 576 || b.path.some(n => !zone(n) || n >= 576) || b.path.slice(1).some((n, i) => !roadNeighbors(b.path[i]).includes(n)) || !zone(b.index) || b.index >= b.path.length - 1 || !finite(b.amount) || b.amount === 0 || !finite(b.blocked) || b.blocked > b.amount + EPS) throw Error('Invalid admitted traffic path or fields');
      const key = batchKey(b); if (batches.has(key)) throw Error('Duplicate admitted traffic'); batches.add(key);
    }
    const waiting = s.waiting.reduce((n, w) => n + w.amount, 0), onRoad = s.batches.reduce((n, b) => n + b.amount, 0);
    if (!equalMass(s.offered, s.completed + waiting + onRoad + s.transferred)) throw Error('Traffic flow conservation mismatch');
    // Total mass alone cannot detect invented admissions. Validate both boundaries.
    if (!equalMass(s.admitted, s.completed + onRoad) || !equalMass(s.offered, s.admitted + waiting + s.transferred)) throw Error('Traffic admission conservation mismatch');
    const records=new Map<string,FlowRequestRecord>();
    for(const r of s.requests) {
      if(!fields(r,'admitted,completed,from,offered,requestId,to,transferred') || !validId(r.requestId) || records.has(r.requestId) || !zone(r.from) || !zone(r.to) || ![r.offered,r.admitted,r.completed,r.transferred].every(finite) || r.completed>r.admitted+EPS || r.admitted+r.transferred>r.offered+EPS) throw Error('Invalid traffic request record');
      records.set(r.requestId,r);
      const w=s.waiting.filter(x=>x.requestId===r.requestId),b=s.batches.filter(x=>x.requestId===r.requestId);
      if(w.some(x=>x.from!==r.from || x.to!==r.to) || b.some(x=>x.destination!==r.to) || !equalMass(r.offered,r.admitted+r.transferred+w.reduce((n,x)=>n+x.amount,0)) || !equalMass(r.admitted,r.completed+b.reduce((n,x)=>n+x.amount,0))) throw Error('Traffic request conservation mismatch');
    }
    if([...s.waiting,...s.batches].some(x=>x.requestId!==undefined&&!records.has(x.requestId))) throw Error('Missing traffic request record');
    for(const key of ['offered','admitted','completed','transferred'] as const) {
      const total=s.requests.reduce((n,r)=>n+r[key],0);
      if(total>s[key]+EPS || key==='transferred'&&!equalMass(total,s[key])) throw Error('Traffic request totals mismatch');
    }
    const flow = new TrafficFlow(); flow.state = clone(s); flow.requests=new Map(flow.state.requests.map(r=>[r.requestId,r])); return flow;
  }
  /** Cumulative receipts survive completion and reload; IDs may never be reused. */
  receipt(requestId: string): FlowReceipt | null {
    const r=this.requests.get(requestId);return r ? {...r,waiting:Math.max(0,r.offered-r.admitted-r.transferred),active:Math.max(0,r.admitted-r.completed)} : null;
  }
  /** Transfers only unadmitted road waiting to its modal owner, never to completion. */
  transferWaiting(requestId: string, amount: number): void {
    const r=this.requests.get(requestId),w=this.state.waiting.find(x=>x.requestId===requestId);
    if(!r || !finite(amount) || amount>0&&(!w || amount>w.amount+EPS)) throw Error('Traffic transfer exceeds waiting ownership');
    if(!amount)return;
    amount=Math.min(amount,w!.amount);
    w!.amount-=amount;r.transferred+=amount;this.state.transferred+=amount;
    this.state.waiting=this.state.waiting.filter(x=>x.amount>0);
  }
  /** Tagged offers are lifetime-idempotent. Anonymous OD rows retain the original
   * incremental API used by the representative clock. No admission occurs here. */
  enqueue(offered: readonly FlowOffer[]): void {
    const seen=new Map(this.requests);
    for(const d of offered) {
      if(!zone(d.from)||!zone(d.to)||!finite(d.vehicles)||d.requestId!==undefined&&!validId(d.requestId)) throw Error('Invalid offered traffic');
      if(d.requestId!==undefined) {
        const old=seen.get(d.requestId);
        if(old&&(old.from!==d.from||old.to!==d.to||old.offered!==d.vehicles)) throw Error('Traffic request ID reused with different payload');
        if(!old)seen.set(d.requestId,{requestId:d.requestId,from:d.from,to:d.to,offered:d.vehicles,admitted:0,completed:0,transferred:0});
      }
    }
    const waiting = new Map(this.state.waiting.map(w => [waitingKey(w), w]));
    for(const d of offered) {
      if(d.requestId!==undefined) {
        if(this.requests.has(d.requestId))continue;
        const r=seen.get(d.requestId)!;this.requests.set(d.requestId,r);this.state.requests.push(r);
      }
      if(d.vehicles===0)continue;
      const key=waitingKey(d),existing=waiting.get(key);
      if(existing)existing.amount+=d.vehicles;else waiting.set(key,{from:d.from,to:d.to,amount:d.vehicles,...tag(d)});
      this.state.offered+=d.vehicles;
    }
    this.state.waiting=[...waiting.values()].sort((a,b)=>a.from-b.from||a.to-b.to||(a.requestId??'').localeCompare(b.requestId??''));
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
  advancePeriod(net: LinkNetwork, offered: readonly FlowOffer[]): void { this.advanceMinutes(net,offered,MINUTES_PER_HOUR); }
  advanceMinutes(net: LinkNetwork, offered: readonly FlowOffer[], minutes: number): void {
    if(!zone(minutes)||minutes>10080||!Number.isSafeInteger(this.state.minute+minutes)) throw Error('Invalid traffic advancement');
    const beforeA = this.state.admitted, beforeC = this.state.completed;
    this.enqueue(offered);
    this.repair(net);
    const nodes = junctions(net);
    for (let minute = 0; minute < minutes; minute++) this.quantum(net, nodes);
    this.lastAdmitted = this.state.admitted - beforeA; this.lastCompleted = this.state.completed - beforeC;
    const d = this.diagnostics(net); this.state.peakQueued = Math.max(this.state.peakQueued, d.queued);
    if (Math.abs(d.conservationError) > EPS * Math.max(1, d.offered)) throw Error('Traffic flow lost demand');
  }
  private quantum(net: LinkNetwork, nodes: Set<number>) {
    const s = this.state, occ = occupancy(s.batches);
    const input = new Map([...net.links].map(([k, l]) => [k, l.capacityPerHour / 60])), output = new Map(input);
    const service = new Map([...nodes].map(n => [n, Array<number>(4).fill(FLOW_JUNCTION_CAPACITY / 60)]));
    const takeNode = (n: number, mask: number, amount: number) => { const room = service.get(n); if (room) for (let i = 0; i < 4; i++) if (mask & (1 << i)) room[i] -= amount; };
    const nodeRoom = (n: number, mask: number) => { const room = service.get(n); return room ? Math.min(...room.filter((_, i) => mask & (1 << i))) : Infinity; };
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
      const mask = atGoal ? 15 : movementMask(b.path[b.index], head, b.path[b.index + 2]);
      const room = next ? Math.max(0, storage(net, next) - (occ.get(next) ?? 0)) : Infinity;
      const moved = Math.min(b.amount, output.get(key) ?? 0, nodeRoom(head, mask), room, next ? input.get(next)! : Infinity);
      if (moved > 0) {
        b.amount -= moved; output.set(key, output.get(key)! - moved); takeNode(head, mask, moved);
        // Reserve next-link storage now; vacated storage is released only after all existing cohorts
        // were considered, so cars cannot leap across a full downstream queue within one quantum.
        if (next) { occ.set(next, (occ.get(next) ?? 0) + moved); input.set(next, input.get(next)! - moved); additions.push({ destination: b.destination, path: b.path, index: b.index + 1, amount: moved, blocked: 0, ...tag(b) }); }
        else {s.completed += moved;if(b.requestId!==undefined)this.requests.get(b.requestId)!.completed+=moved;}
      }
      b.blocked = b.amount;
    }
    s.batches = s.batches.filter(b => b.amount > 0);
    for (const b of additions) s.batches.push(b);
    const after = occupancy(s.batches), originOrder = [...s.waiting], offset = originOrder.length ? s.minute % originOrder.length : 0;
    for (const w of [...originOrder.slice(offset), ...originOrder.slice(0, offset)]) {
     // An OD may use several independent entrances in a quantum. Exhausted input
     // links are excluded only from its first step; shared downstream limits still apply.
     while (w.amount > EPS) {
      const route = routes(net, after, l => (input.get(linkKey(l.from, l.to)) ?? 0) > EPS && storage(net, linkKey(l.from, l.to)) - (after.get(linkKey(l.from, l.to)) ?? 0) > EPS && nodeRoom(l.from, 15) > EPS);
      const path = route(w.from, w.to); if (!path) break;
      if (path.length === 1) { s.admitted += w.amount; s.completed += w.amount; if(w.requestId!==undefined){const r=this.requests.get(w.requestId)!;r.admitted+=w.amount;r.completed+=w.amount;} w.amount = 0; break; }
      const key = linkKey(path[0], path[1]), room = Math.max(0, storage(net, key) - (after.get(key) ?? 0));
      const moved = Math.min(w.amount, input.get(key) ?? 0, room, nodeRoom(path[0], 15));
      if (moved <= 0) break;
      w.amount -= moved; input.set(key, input.get(key)! - moved); takeNode(path[0], 15, moved); after.set(key, (after.get(key) ?? 0) + moved); s.admitted += moved;
      if(w.requestId!==undefined)this.requests.get(w.requestId)!.admitted+=moved;
      s.batches.push({ destination: w.to, path, index: 0, amount: moved, blocked: 0, ...tag(w) });
     }
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
    return { offered: s.offered, admitted: s.admitted, completed: s.completed, transferred:s.transferred, onRoad, waiting, unreachable, queued, peakQueued: Math.max(s.peakQueued, queued), conservationError: s.offered - s.completed - s.transferred - onRoad - waiting - unreachable, periods: s.minute / 60, lastAdmitted: this.lastAdmitted, lastCompleted: this.lastCompleted, links, bottlenecks };
  }
}
