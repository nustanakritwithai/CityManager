/**
 * BusEngine (PR B4, bus-design.th.md) — pure, deterministic, event-driven bus service. Modelled on
 * TaxiEngine phases. No UI, saves or economy. Driven by absolute GAME minutes (`advanceTo`).
 *
 * Phases: `toStart` (depot → first stop via `fromDepot`) → `dwelling` (BUS_DWELL_MIN at each stop:
 * alight, then board up to seat capacity 40/60/80 by line level) → `running` (next leg) … → `home`
 * (parked at the depot). Driving back to the depot is reported as `running` with 0 passengers and
 * `returning: true` in `busesDetail()`.
 * Service 05:00–23:00 (BUS_SERVICE). Bus k of a line leaves the depot k × headway after service
 * start. After 23:00 buses stop boarding, drop off everyone aboard, then drive home.
 *
 * Conservation (whole people): accepted = waiting + onboard + completed + released.
 * Released = waited too long, still waiting at service end, line suspended/unknown, or riders on a
 * bus whose line became unroutable; each release calls `release(requestId, persons, reason)` so
 * the host returns them to private cars. Nobody is dropped silently.
 */
import { BUS_BODY, BUS_LANE_OFFSET, busLevelForCapacity } from './geometry.ts';
import { TRAFFIC_SPACING } from '../traffic/spacing.ts';
import { buildNetwork, linkKey, type LinkNetwork } from '../traffic/network.ts';
import { linkTimes, shortestPath } from '../traffic/routing.ts';
import { roadNeighbors } from '../road-topology.ts';
import { BusRouteCache, busServiceOrder, type BusHost, type BusLineRoute } from './lines.ts';
import { BUS_CAPACITY, BUS_DWELL_MIN, BUS_PCU, BUS_SERVICE, type BusEvent, type BusPhase, type BusRequestMass, type BusSnapshot } from './types.ts';

export const BUS_MAX_WAIT_MIN = 30;
export const BUS_RETAINED_FLEET_LIMIT = 80;
export const BUS_ROUTE_PLAN_CELL_LIMIT=24*24+1;
export const BUS_ROUTE_PLAN_SAMPLE_LIMIT=2*BUS_ROUTE_PLAN_CELL_LIMIT;
/** A stopped bus must fit between both junction rotation envelopes, with bumper gaps.
 * Uses the actual applied class, not the requested future depot refit. */
export function busClusterPocket(capacity:number,nodeDistance:number):boolean {
  const body=BUS_BODY[busLevelForCapacity(capacity)],gap=TRAFFIC_SPACING.standstillGap;
  const nodeRadius=BUS_LANE_OFFSET+Math.hypot(body.length,body.width)/2;
  return nodeDistance-2*nodeRadius>=body.length+2*gap;
}
export function busConflictClusters(path:readonly number[],junctions:ReadonlySet<number>,capacity:number):readonly (readonly number[])[] {
  const nodes:number[]=[];
  for(let i=1;i+1<path.length;i++){
    const a=path[i-1],n=path[i],z=path[i+1];
    if(junctions.has(n)||(n%24-a%24)*(z%24-n%24)+(Math.floor(n/24)-Math.floor(a/24))*(Math.floor(z/24)-Math.floor(n/24))===0)nodes.push(i);
  }
  const clusters:number[][]=[];
  for(const index of nodes){const last=clusters.at(-1),previous=last?.at(-1);if(previous!==undefined&&!busClusterPocket(capacity,(index-previous)*2))last!.push(index);else clusters.push([index]);}
  return clusters;
}
export type BusReleaseReason = 'timeout' | 'serviceEnd' | 'suspended' | 'unknownLine' | 'stranded';
export type BusTurnIntent={id:string;samples:readonly BusSnapshot[]};
export type BusMovementProposal = { busId: string; from: BusSnapshot; to: BusSnapshot; samples: readonly BusSnapshot[]; minute: number; kind: 'drive' | 'transition'; turns?:readonly BusTurnIntent[] };
export type BusMovementGate = (proposal: BusMovementProposal, others: readonly BusSnapshot[]) => boolean;
export type BusEngineOptions = { movementGate?: BusMovementGate; movementReset?: () => void; maxWaitMinutes?: number; release?: (requestId: string, persons: number, reason: BusReleaseReason) => void; times?: ReadonlyMap<string, number> };
export type BusSubmission = BusRequestMass & { requestId: string };
type Waiting = { requestId: string; toStopId: number; persons: number; minute: number };
type Rider = { requestId: string; toStopId: number; persons: number };
type Bus = {
  id: string; lineId: number; depotId: number; originalCapacity: number; k: number; phase: BusPhase; cell: number; until: number;
  path?: number[]; at?: number[]; /** order index of the stop being approached / dwelt at */ idx: number;
  returning: boolean; retired: boolean; onboard: Rider[]; stopIntent?:BusTurnIntent;
};
const inService = (t: number) => { const m = ((t % 1440) + 1440) % 1440; return m >= BUS_SERVICE.from && m < BUS_SERVICE.to; };
const sum = (r: readonly { persons: number }[]) => r.reduce((n, x) => n + x.persons, 0);

export class BusEngine {
  private host: BusHost; private cache = new BusRouteCache(); private routes: readonly BusLineRoute[] = [];
  private conflictNodes=new Set<number>();
  private clusterPlans=new WeakMap<readonly number[],Map<number,readonly (readonly number[])[]>>();
  private maneuverPlans=new WeakMap<readonly number[],Map<number,readonly BusTurnIntent[]>>();
  private clusters(path:readonly number[],capacity:number){let byClass=this.clusterPlans.get(path);if(!byClass){byClass=new Map();this.clusterPlans.set(path,byClass);}let plan=byClass.get(capacity);if(!plan){plan=busConflictClusters(path,this.conflictNodes,capacity);byClass.set(capacity,plan);}return plan;}
  private net!: LinkNetwork; private times!: ReadonlyMap<string, number>;
  private buses: Bus[] = []; private queues = new Map<string, Waiting[]>(); private events: BusEvent[] = [];
  private readonly movementGate?: BusMovementGate;
  private readonly movementReset?: () => void; private revision = 0;
  private movements={heldDrive:0,heldTransition:0,committedDrive:0,committedTransition:0};
  private cursor: number; private readonly start: number; private readonly maxWait: number;
  private readonly releaseHook: NonNullable<BusEngineOptions['release']>; private readonly fixedTimes?: ReadonlyMap<string, number>;
  totals = { accepted: 0, boarded: 0, completed: 0, released: 0, releasedBy: { timeout: 0, serviceEnd: 0, suspended: 0, unknownLine: 0, stranded: 0 } as Record<BusReleaseReason, number>, replans: 0, departures: 0 };
  constructor(host: BusHost, startMinute: number, o: BusEngineOptions = {}) {
    this.movementGate = o.movementGate; this.movementReset = o.movementReset;
    this.host = host; this.cursor = this.start = startMinute; this.maxWait = o.maxWaitMinutes ?? BUS_MAX_WAIT_MIN;
    this.releaseHook = o.release ?? (() => {}); this.fixedTimes = o.times;
    this.refresh(startMinute);
  }
  get now() { return this.cursor; }
  get movementStats(){return {...this.movements};}
  get topologyRevision() { return this.revision; }
  hasActiveDepot(depotId: number): boolean { return this.buses.some(b => b.phase !== 'home' && (b.depotId === depotId)); }
  activeBusCapacity(lineId:number){const values=this.buses.filter(b=>b.lineId===lineId&&!b.retired).map(b=>this.busCapacity(b));return values.length?Math.min(...values):0;}
  activeBusCount(lineId:number){return this.buses.filter(b=>b.lineId===lineId&&!b.retired).length;}
  get activeLineIds(){return [...new Set(this.buses.filter(b=>!b.retired).map(b=>b.lineId))];}
  get strandedCount() { return this.buses.filter(b=>b.phase!=='home'&&!b.path&&b.returning).length; }
  private route(lineId: number) { return this.routes.find(r => r.lineId === lineId); }
  private order(r: BusLineRoute) { return busServiceOrder(this.host.bus?.lines.find(l => l.id === r.lineId)?.stopIds.filter(id => r.stops.some(s => s.stopId === id)) ?? []); }
  private stopCell(id: number) { return this.host.bus?.stops.find(s => s.id === id)?.cell; }
  private depotCell(lineId: number) { const depotId = this.route(lineId)?.depotId ?? this.buses.find(b=>b.lineId===lineId)?.depotId; return this.host.bus?.depots.find(d => d.id === depotId)?.cell; }
  private capacity(lineId: number) { const line=this.host.bus?.lines.find(l=>l.id===lineId); return line ? BUS_CAPACITY[line.busLevel] : this.buses.find(b=>b.lineId===lineId)?.originalCapacity ?? BUS_CAPACITY[1]; }

  private busCapacity(b:Bus){return this.movementGate?b.originalCapacity:this.capacity(b.lineId);}

  /** Re-read lines/roads (memoised). On change: resize fleets and replan moving buses from where they are. */
  refresh(t = this.cursor): void {
    const next = this.cache.get(this.host, this.fixedTimes ? { times: this.fixedTimes } : {});
    if (next === this.routes && this.net) return;
    this.revision++; this.movementReset?.();
    const first = !this.net; this.routes = next; this.net = buildNetwork(this.host); this.times = this.fixedTimes ?? linkTimes(this.net, new Map());
    const neighbors=new Map<number,Set<number>>();for(const l of this.net.links.values())for(const [a,z]of[[l.from,l.to],[l.to,l.from]])(neighbors.get(a)??neighbors.set(a,new Set()).get(a)!).add(z);
    this.conflictNodes=new Set([...neighbors].filter(([id,n])=>{if(n.size>2)return true;if(n.size!==2)return false;const[a,z]=[...n];return (a%24-id%24)*(z%24-id%24)+(Math.floor(a/24)-Math.floor(id/24))*(Math.floor(z/24)-Math.floor(id/24))===0;}).map(([id])=>id));
    this.clusterPlans=new WeakMap();this.maneuverPlans=new WeakMap();

    for (const r of this.routes) for (let k = 0; k < r.buses; k++) if ((!this.movementGate || this.buses.length < BUS_RETAINED_FLEET_LIMIT) && !this.buses.some(b => b.lineId === r.lineId && b.k === k)) {
      const cell = this.depotCell(r.lineId)!;
      this.buses.push({ id: `bus-${r.lineId}-${k}`, lineId: r.lineId, depotId:r.depotId, originalCapacity:this.capacity(r.lineId), k, phase: 'home', cell, until: this.departure(r, k, t), idx: 0, returning: false, retired: false, onboard: [] });
    }
    this.buses.sort((a, b) => a.lineId - b.lineId || a.k - b.k);
    if (first) return;
    this.totals.replans++;
    for (const b of this.buses) {
      const r = this.route(b.lineId);
      if(b.phase==='home'&&this.host.bus?.lines.some(l=>l.id===b.lineId))b.originalCapacity=this.capacity(b.lineId);
      b.retired = !r || r.status !== 'running' || b.k >= r.buses;
      if (b.phase === 'home' || b.phase === 'dwelling') { if(this.movementGate&&b.phase==='dwelling')b.stopIntent=this.stopDepartureIntent(b,t); if (b.phase === 'home' && r) b.until = Math.max(t, Math.min(b.until, this.departure(r, b.k, t))); continue; }
      const edge = this.movementGate ? this.busSnapshot(b,t) : null;
      const edgeTimes = b.at && [...b.at];
      if(edge&&b.stopIntent&&(edge.cell!==b.stopIntent.samples[3].cell||edge.next!==b.stopIntent.samples[3].next))b.stopIntent=undefined;
      this.cut(b, t);
      // Finish the already occupied fractional edge before replanning. Even if a road
      // is edited underneath the bus, never rewind it to the upstream cell centre.
      const pinned = edge && edge.cell !== edge.next && edge.progress > 1e-9;
      if (pinned) b.cell = edge.next;
      const preserveEdge = () => {
        if (!pinned || !edgeTimes) return;
        let k=0; while(k+1<edgeTimes.length && edgeTimes[k+1]<=t+1e-9)k++;
        const duration=edgeTimes[k+1]-edgeTimes[k], remaining=(1-edge.progress)*duration;
        const tail=b.path?.[0]===edge.next ? b.path.slice(1) : [];
        const times=b.at?.[0]!==undefined && tail.length ? b.at.slice(1).map(x=>x+remaining) : [];
        b.path=[edge.cell,edge.next,...tail];b.at=[t-edge.progress*duration,t+remaining,...times];
        b.until=b.at.at(-1)!;b.cell=edge.cell;
        if(b.phase==='home'){b.phase='running';b.returning=true;}
      };
      if (b.returning || b.retired) { this.releaseRiders(b, b.retired && r?.status !== 'running' ? 'suspended' : 'stranded', t, true); this.goHome(b, t); preserveEdge(); continue; }
      const target = this.stopCell(this.order(r!)[b.idx]);
      const p = target === undefined ? null : shortestPath(this.net, this.times, b.cell, target);
      if (!p) { this.releaseRiders(b, 'stranded', t, true); this.goHome(b, t); } else this.drive(b, p, t, b.phase);
      preserveEdge();
    }
  }
  /** Departure minute from the depot for bus k at or after t (k × headway after service start). */
  private departure(r: BusLineRoute, k: number, t: number): number {
    if (r.status !== 'running' || r.headwayMinutes === null) return t + 5;
    const day = Math.floor(t / 1440) * 1440, open = day + BUS_SERVICE.from, close = day + BUS_SERVICE.to;
    const base = Math.max(open, this.start), dep = base + k * r.headwayMinutes;
    if (t < close && dep < close) return Math.max(t, dep);
    return day + 1440 + BUS_SERVICE.from + k * r.headwayMinutes;
  }
  private cut(b: Bus, t: number): void {
    if (!b.path || !b.at) return;
    let k = 0; while (k + 1 < b.at.length && b.at[k + 1] <= t + 1e-9) k++;
    b.cell = b.path[k]; b.path = b.at = undefined;
  }
  private drive(b: Bus, path: readonly number[], t: number, phase: BusPhase): void {
    const at = [t]; for (let i = 1; i < path.length; i++) at.push(at[i - 1] + (this.times.get(linkKey(path[i - 1], path[i])) ?? Infinity) / 60);
    b.phase = phase; b.path = [...path]; b.at = at; b.until = at.at(-1)!;
  }
  private goHome(b: Bus, t: number): void {
    const depot = this.depotCell(b.lineId); b.returning = true;
    let best: number[] | null = null;
    if (depot !== undefined) for (const n of roadNeighbors(depot).filter(n => this.host.cells[n]?.road).sort((x, y) => x - y)) { const p = n === b.cell ? [n] : shortestPath(this.net, this.times, b.cell, n); if (p && (!best || p.length < best.length)) best = p; }
    if (depot === undefined && this.movementGate) { b.phase='running'; b.path=b.at=undefined;b.until=t+5;return; }
    if (depot === undefined || !this.host.cells[b.cell]?.road && b.cell === depot) { this.park(b, t); return; }
    if (!best) { b.phase = 'running'; b.path = b.at = undefined; b.until = t + 5; return; } // stuck: retry
    this.drive(b, best, t, 'running');
  }
  private park(b: Bus, t: number): void {
    const r = this.route(b.lineId); b.phase = 'home'; b.returning = false; b.path = b.at = undefined;
    if(this.movementGate&&!b.onboard.length)b.originalCapacity=this.capacity(b.lineId);
    b.cell = this.depotCell(b.lineId) ?? b.cell; b.until = r ? this.departure(r, b.k, t + 1e-6) : t + 5;
  }
  private releaseRiders(b: Bus, reason: BusReleaseReason, t: number, emit: boolean): void {
    for (const x of b.onboard) { this.release(x.requestId, x.persons, reason); if (emit) this.events.push(Object.freeze({ kind: 'alight' as const, busId: b.id, lineId: b.lineId, stopId: -1, cell: b.cell, minute: t, persons: x.persons })); }
    b.onboard = [];
  }
  private release(requestId: string, persons: number, reason: BusReleaseReason): void { if (persons > 0) { this.totals.released += persons; this.totals.releasedBy[reason] += persons; this.releaseHook(requestId, persons, reason); } }

  /** Accept riders from mode share. Unknown/suspended lines or stops off the line are released at once. */
  submit(masses: readonly BusSubmission[], minute = this.cursor): void {
    this.refresh(minute);
    for (const m of [...masses].sort((a, b) => (a.requestId < b.requestId ? -1 : a.requestId > b.requestId ? 1 : 0))) {
      if (!Number.isSafeInteger(m.persons) || m.persons < 1) throw RangeError('Bus request needs whole people');
      this.totals.accepted += m.persons;
      const r = this.route(m.lineId), order = r ? this.order(r) : [];
      if (!r || r.status !== 'running' || !order.includes(m.fromStopId) || !order.includes(m.toStopId) || m.fromStopId === m.toStopId) { this.release(m.requestId, m.persons, r ? 'suspended' : 'unknownLine'); continue; }
      if (!inService(minute)) { this.release(m.requestId, m.persons, 'serviceEnd'); continue; }
      const key = `${m.lineId}:${m.fromStopId}`, q = this.queues.get(key) ?? [];
      q.push({ requestId: m.requestId, toStopId: m.toStopId, persons: m.persons, minute }); this.queues.set(key, q);
    }
  }
  /** Stops a bus at order index `k` will still reach in its current direction (loops wrap). */
  private ahead(r: BusLineRoute, k: number): Set<number> {
    const o = this.order(r), L = o.length - 1, out = new Set<number>();
    if (r.loop) { for (let j = 1; j < L; j++) out.add(o[(k + j) % L]); return out; }
    const n = L / 2, end = k < n ? n : L; for (let j = k + 1; j <= end; j++) out.add(o[j]); return out;
  }
  private atStop(b: Bus, t: number): void {
    const r = this.route(b.lineId)!, o = this.order(r), L = o.length - 1;
    if (b.idx >= L) b.idx = 0;
    const stopId = o[b.idx]; if(this.movementGate)b.stopIntent=this.stopDepartureIntent(b,t); b.cell = this.stopCell(stopId)!; b.path = b.at = undefined;
    const off = b.onboard.filter(x => x.toStopId === stopId), n = sum(off);
    if (n) { this.totals.completed += n; this.events.push(Object.freeze({ kind: 'alight' as const, busId: b.id, lineId: b.lineId, stopId, cell: b.cell, minute: t, persons: n })); }
    b.onboard = b.onboard.filter(x => x.toStopId !== stopId);
    this.sweep(t);
    if (inService(t) && !b.retired) {
      const ahead = this.ahead(r, b.idx), key = `${b.lineId}:${stopId}`, q = this.queues.get(key) ?? [];
      let room = this.busCapacity(b) - sum(b.onboard), boarded = 0;
      for (const w of q) { if (room <= 0) break; if (!ahead.has(w.toStopId)) continue; const take = Math.min(room, w.persons); w.persons -= take; room -= take; boarded += take; b.onboard.push({ requestId: w.requestId, toStopId: w.toStopId, persons: take }); }
      this.queues.set(key, q.filter(w => w.persons > 0));
      if (boarded) { this.totals.boarded += boarded; this.events.push(Object.freeze({ kind: 'board' as const, busId: b.id, lineId: b.lineId, stopId, cell: b.cell, minute: t, persons: boarded })); }
    }
    b.phase = 'dwelling'; b.until = t + BUS_DWELL_MIN;
    if(this.movementGate)b.stopIntent=this.stopDepartureIntent(b,t);
  }
  private sweep(t: number): void {
    for (const [key, q] of [...this.queues].sort(([a], [b]) => (a < b ? -1 : 1))) {
      const keep: Waiting[] = [];
      for (const w of q) { if (!inService(t)) this.release(w.requestId, w.persons, 'serviceEnd'); else if (t - w.minute > this.maxWait + 1e-9) this.release(w.requestId, w.persons, 'timeout'); else keep.push(w); }
      if (keep.length) this.queues.set(key, keep); else this.queues.delete(key);
    }
  }
  private event(b: Bus, t: number): void {
    const r = this.route(b.lineId);
    if (b.phase === 'home') {
      if (b.retired || !r || r.status !== 'running' || b.k >= r.buses) { b.until = t + 5; b.retired = !r || r.status !== 'running' || b.k >= r.buses; if (b.retired && !r) this.buses = this.buses.filter(x => x !== b); return; }
      if (!inService(t)) { b.until = this.departure(r, b.k, t); return; }
      const p = r.fromDepot; if (!p) { b.until = t + 5; return; }
      if(this.movementGate&&!b.onboard.length)b.originalCapacity=this.capacity(b.lineId);
      b.idx = 0; b.returning = false; this.totals.departures++; this.drive(b, p, t, 'toStart'); return;
    }
    if (b.phase === 'dwelling') {
      const o = r ? this.order(r) : [], L = o.length - 1;
      if (!r || r.status !== 'running' || b.retired || (!inService(t) && b.onboard.length === 0)) { this.releaseRiders(b, r?.status === 'running' ? 'stranded' : 'suspended', t, true); this.goHome(b, t); return; }
      const leg = r.legs[b.idx]; b.idx = (b.idx + 1) % (L + 1 || 1);
      if (!leg) { this.goHome(b, t); return; }
      this.drive(b, leg.path, t, 'running'); return;
    }
    // Arrival of a drive.
    if (b.returning) {
      const depot = this.depotCell(b.lineId); this.cut(b, t);
      if (this.movementGate && depot === undefined) { this.goHome(b,t); return; }
      if (depot !== undefined && !roadNeighbors(depot).includes(b.cell)) { this.goHome(b, t); return; } // was stuck: retry
      this.park(b, t); if (b.retired && (!r || b.k >= r.buses)) this.buses = this.buses.filter(x => x !== b); return;
    }
    if (!r) { this.goHome(b, t); return; }
    this.atStop(b, t);
  }
  /** Advance to absolute game minute `minute` (deterministic: events in (time, bus id) order). */
  advanceTo(minute: number): void {
    if (this.movementGate) { this.advanceGated(minute); return; }
    this.refresh(this.cursor);
    for (let guard = 0; guard < 1e6; guard++) {
      let next: Bus | undefined;
      for (const b of this.buses) if (b.until <= minute + 1e-9 && (!next || b.until < next.until - 1e-9 || (Math.abs(b.until - next.until) <= 1e-9 && b.id < next.id))) next = b;
      // Service end inside the window: release queues at the boundary even if no bus is there.
      const day = Math.floor(this.cursor / 1440) * 1440; let end = day + BUS_SERVICE.to; if (end <= this.cursor) end += 1440;
      if (end <= minute && (!next || end <= next.until)) { this.cursor = end; this.sweep(end); continue; }
      if (!next) break;
      this.cursor = Math.max(this.cursor, next.until); this.event(next, next.until);
    }
    this.cursor = Math.max(this.cursor, minute); this.sweep(this.cursor);
  }
  /** Take all board/alight events since the last drain (none are lost between frames). */
  drainEvents(): BusEvent[] { const e = this.events; this.events = []; return e; }
  get pendingEvents() { return this.events.length; }
  /** Read-only, frozen per-bus view at `m` (default now; valid until the next event). */
  snapshot(m = this.cursor): readonly BusSnapshot[] {
    return Object.freeze(this.buses.map(b => this.busSnapshot(b, m)));
  }
  private busSnapshot(b: Bus, m: number): BusSnapshot {
    let cell = b.cell, next = b.cell, progress = 0;
    if (b.path && b.at) {
      let k = 0; while (k + 1 < b.at.length && b.at[k + 1] <= m + 1e-9) k++;
      cell = b.path[k]; next = cell;
      if (k + 1 < b.path.length && m >= b.at[0]) { next = b.path[k + 1]; progress = Math.min(1, Math.max(0, (m - b.at[k]) / (b.at[k + 1] - b.at[k]))); }
    }
    return Object.freeze({ id: b.id, lineId: b.lineId, phase: b.phase, cell, next, progress, persons: sum(b.onboard), capacity: this.busCapacity(b) });
  }
  /** Geometry-only event preview. No queues, passenger events or release hooks are touched. */
  private transitionBus(b: Bus, t: number): Bus {
    const r = this.route(b.lineId), copy: Bus = {...b, path: b.path && [...b.path], at: b.at && [...b.at]};
    if (b.phase === 'home') {
      if (!b.retired && r?.status === 'running' && b.k < r.buses && inService(t) && r.fromDepot) { if(this.movementGate&&!copy.onboard.length)copy.originalCapacity=this.capacity(copy.lineId); this.drive(copy, r.fromDepot, t, 'toStart'); }
    } else if (b.phase === 'dwelling') {
      if (!r || r.status !== 'running' || b.retired || (!inService(t) && !b.onboard.length)) this.goHome(copy, t);
      else { const leg = r.legs[b.idx]; if (leg) this.drive(copy, leg.path, t, 'running'); else this.goHome(copy, t); }
    } else if (b.returning) {
      this.cut(copy, t); const depot = this.depotCell(b.lineId);
      if (this.movementGate && depot === undefined) this.goHome(copy,t);
      else if (depot !== undefined && !roadNeighbors(depot).includes(copy.cell)) this.goHome(copy, t); else this.park(copy, t);
    } else if (!r) this.goHome(copy, t);
    else { const order = this.order(r), idx = b.idx >= order.length - 1 ? 0 : b.idx; copy.cell = this.stopCell(order[idx])!; copy.path = copy.at = undefined; copy.phase = 'dwelling'; }
    return copy;
  }
  /** Pure preview of one real stop's arrival, kerb dwell and next-leg departure. */
  private stopDepartureIntent(b:Bus,t:number):BusTurnIntent|undefined {
    if(b.returning)return undefined;
    const r=this.route(b.lineId),order=r?this.order(r):[],idx=b.idx>=order.length-1?0:b.idx;
    const cell=b.phase==='dwelling'?b.cell:b.path?.at(-1);if(cell===undefined)return undefined;
    const remaining=b.phase==='dwelling'?b.onboard:b.onboard.filter(rider=>rider.toStopId!==order[idx]);
    const parked:Bus={...b,cell,phase:'dwelling',path:undefined,at:undefined,idx,onboard:remaining};
    const departure:Bus={...parked},departureTime=b.phase==='dwelling'?b.until:t+BUS_DWELL_MIN;
    // Mirror eligibility only; preview never consumes queues or emits passenger events.
    const ahead=r?this.ahead(r,idx):new Set<number>();
    const willBoard=b.phase!=='dwelling'&&!!r&&inService(t)&&!b.retired&&sum(remaining)<this.busCapacity(b)&&(this.queues.get(`${b.lineId}:${order[idx]}`)??[]).some(w=>w.persons>0&&ahead.has(w.toStopId)&&t-w.minute<=this.maxWait+1e-9);
    if(!r||r.status!=='running'||b.retired||(!inService(departureTime)&&!remaining.length&&!willBoard))this.goHome(departure,t);
    else {const leg=r.legs[idx];if(leg)this.drive(departure,leg.path,t,'running');else this.goHome(departure,t);}
    const home=this.busSnapshot(parked,t),start=this.busSnapshot(departure,t);
    const outgoing=departure.path&&departure.path.length>1?{...start,cell:departure.path[0],next:departure.path[1],progress:.6}:start;
    const previous=b.phase==='dwelling'?b.stopIntent?.samples[0]?.cell:b.path?.at(-2);
    const approach=previous===undefined?home:{...home,phase:'running' as const,cell:previous,next:cell,progress:.25};
    const endpoint={...approach,progress:previous===undefined?0:1-1e-8};
    return {id:`${b.id}:stop:${cell}:${outgoing.next}`,samples:[endpoint,home,start,outgoing]};
  }
  /** Cached, immutable actual-route geometry to the first class-valid holding pocket.
   * A dense run may extend to the real stop, but never follows off-route graph branches.
   * Shortest paths have <=576 cells; one pinned occupied edge can add one cell on replan. */
  private routeManeuvers(b:Bus):readonly BusTurnIntent[] {
    if(!b.path)return [];
    if(b.path.length>BUS_ROUTE_PLAN_CELL_LIMIT)throw Error('Bus route exceeds finite map path bound');
    const capacity=this.busCapacity(b);let cached=this.maneuverPlans.get(b.path);if(!cached){cached=new Map();this.maneuverPlans.set(b.path,cached);}const found=cached.get(capacity);if(found)return found;
    const sample=(cell:number,next:number,p:number):BusSnapshot=>Object.freeze({id:b.id,lineId:b.lineId,phase:'running',cell,next,progress:p,persons:0,capacity});
    const result=this.clusters(b.path,capacity).map(cluster=>{
      const first=cluster[0],last=cluster.at(-1)!,samples:BusSnapshot[]=[sample(b.path![first-1],b.path![first],.25)];
      for(const node of cluster)samples.push(sample(b.path![node-1],b.path![node],1-1e-8),sample(b.path![node],b.path![node+1],0));
      samples.push(sample(b.path![last],b.path![last+1],.6));
      if(samples.length>BUS_ROUTE_PLAN_SAMPLE_LIMIT)throw Error('Bus maneuver exceeds finite map geometry bound');
      const id=cluster.length===1?`${b.id}:${b.path![first]}:${b.path![first+1]}`:`${b.id}:corridor:${first}:${last}:${b.path![first]}:${b.path![last+1]}`;
      return Object.freeze({id,samples:Object.freeze(samples)});
    });cached.set(capacity,result);return result;
  }
  /** Current occupied maneuver plus a pending next maneuver; each contains its complete escape. */
  private turnIntents(b:Bus,m:number):NonNullable<BusMovementProposal['turns']> {
    if(b.phase==='dwelling')return b.stopIntent?[b.stopIntent]:[];
    if(!b.path||!b.at)return [];
    let k=0;while(k+1<b.at.length&&b.at[k+1]<=m+1e-9)k++;
    if(k+1>=b.path.length){const stop=this.stopDepartureIntent(b,m);return stop?[stop]:[];}
    const progress=Math.max(0,Math.min(1,(m-b.at[k])/(b.at[k+1]-b.at[k]))),clusters=this.clusters(b.path,this.busCapacity(b)),plans=this.routeManeuvers(b);
    const intents:BusTurnIntent[]=[];let protectTerminal=false;
    for(let i=0;i<clusters.length;i++){
      const cluster=clusters[i],first=cluster[0],last=cluster.at(-1)!;
      if(k<first-1||k>last||(k===first-1&&progress<.25)||(k===last&&progress>.6))continue;
      intents.push(plans[i]);if(last===b.path.length-2)protectTerminal=true;
    }
    if(k===0&&progress<=.6&&b.stopIntent)intents.unshift(b.stopIntent);
    // If the last crossing and terminal have no safe intermediate pocket, acquire the
    // real kerb/departure guard before entering that crossing, not after trapping a follower.
    if(protectTerminal||k===b.path.length-2&&progress>=.25){const stop=this.stopDepartureIntent(b,b.until);if(stop)intents.push(stop);}
    return [...new Map(intents.map(i=>[i.id,i])).values()];
  }
  private movementTurns(b:Bus,end:number):NonNullable<BusMovementProposal['turns']>{
    // Do not release a current token merely because a not-yet-admitted proposal clears it.
    const turns=new Map([...this.turnIntents(b,this.cursor),...this.turnIntents(b,end)].map(t=>[t.id,t]));
    if(turns.size>3)throw Error('Bus maneuver lifecycle budget exceeded');return [...turns.values()];
  }
  /** Optional live movement authority. Absolute service time advances even while one bus is held.
   * Translating the ENTIRE private timeline preserves its exact fractional position; changing only
   * its next timestamp would make a mid-edge bus slide backwards. Passenger events commit only
   * after their transition is admitted. The original ungated event engine remains unchanged. */
  private advanceGated(minute: number): void {
    if (!Number.isFinite(minute) || minute < this.cursor - 1e-9) throw RangeError('Invalid gated bus clock');
    this.refresh(this.cursor);
    const quantum = 1 / 240;
    // A denied near-boundary move must not subdivide this same host frame forever.
    // Keep its exact position for the remainder, then retry on the next host call.
    const heldDrives=new Set<string>();
    for (let guard = 0; guard < 1_000_000; guard++) {
      const retry = Math.min(quantum, Math.max(1e-8, minute - this.cursor));
      for (const b of [...this.buses].sort((a,b) => a.until - b.until || a.id.localeCompare(b.id))) {
        if (heldDrives.has(b.id) || b.until > this.cursor + 1e-9) continue;
        // A held empty departure can cross service close; protect its actual return,
        // not the nominal direction from the earlier arrival time. No events commit here.
        if(b.phase==='dwelling')b.stopIntent=this.stopDepartureIntent(b,this.cursor);
        const preview=this.transitionBus(b,this.cursor);

        const from = this.busSnapshot(b, this.cursor), to = this.busSnapshot(preview,this.cursor);
        const stationary=from.phase===to.phase&&from.cell===to.cell&&from.next===to.next&&Math.abs(from.progress-to.progress)<1e-12;
        if (stationary || this.movementGate!({busId:b.id, from, to, samples:[from,to], minute:this.cursor, kind:'transition',turns:this.turnIntents(b,this.cursor)}, this.snapshot())) { this.event(b, this.cursor); this.movements.committedTransition++; }
        else { b.until += retry; this.movements.heldTransition++; }
      }
      this.sweep(this.cursor);
      if (this.cursor >= minute - 1e-10) { this.cursor = minute; return; }
      let end = Math.min(minute, this.cursor + quantum);
      let serviceEnd=Math.floor(this.cursor/1440)*1440+BUS_SERVICE.to;if(serviceEnd<=this.cursor+1e-9)serviceEnd+=1440;
      end=Math.min(end,serviceEnd);
      for (const b of this.buses) {
        if(heldDrives.has(b.id))continue;
        if (b.until > this.cursor + 1e-9) end = Math.min(end, b.until);
        for (const t of b.at ?? []) if (t > this.cursor + 1e-9) { end = Math.min(end, t); break; }
      }
      const dt = end - this.cursor, committed = new Map(this.snapshot().map(s => [s.id,s]));
      for (const b of this.buses) {
        if (!b.path || !b.at) continue;
        if(heldDrives.has(b.id)){b.at=b.at.map(t=>t+dt);b.until+=dt;continue;}
        const from = this.busSnapshot(b, this.cursor), to = this.busSnapshot(b, end);
        if(from.cell===to.cell && from.next===to.next && Math.abs(from.progress-to.progress)<1e-12)continue;
        const near = this.busSnapshot(b, Math.max(this.cursor, end - 1e-8));
        const turns=this.movementTurns(b,end);
        if (this.movementGate!({busId:b.id, from, to, samples:[from,near,to], minute:end, kind:'drive',turns}, [...committed.values()])) { committed.set(b.id,to); this.movements.committedDrive++; }
        else { b.at = b.at.map(t => t + dt); b.until += dt; committed.set(b.id,from); this.movements.heldDrive++; heldDrives.add(b.id); }
      }
      this.cursor = end;
    }
    throw Error('Gated bus advancement budget exceeded');
  }

  busesDetail() { return this.buses.map(b => Object.freeze({ id: b.id, lineId: b.lineId, phase: b.phase, returning: b.returning, retired: b.retired, until: b.until })); }
  /** People currently waiting per stop (all lines). */
  waitingAt(stopId: number) { let n = 0; for (const [k, q] of this.queues) if (Number(k.split(':')[1]) === stopId) n += sum(q); return n; }
  ledger() {
    const waiting = [...this.queues.values()].reduce((n, q) => n + sum(q), 0), onboard = this.buses.reduce((n, b) => n + sum(b.onboard), 0);
    const { accepted, completed, released } = this.totals;
    return { accepted, waiting, onboard, completed, released, conservationError: accepted - waiting - onboard - completed - released };
  }
  /** Road load hook for traffic (not wired): PCU per link for buses moving at minute `m`. */
  roadLoad(m = this.cursor): Map<string, number> {
    const load = new Map<string, number>();
    for (const b of this.buses) if (b.path && b.at) { let k = 0; while (k + 1 < b.at.length && b.at[k + 1] <= m + 1e-9) k++; if (k + 1 < b.path.length) { const key = linkKey(b.path[k], b.path[k + 1]); load.set(key, (load.get(key) ?? 0) + BUS_PCU); } }
    return load;
  }
}
/** In-vehicle minutes from one stop to another in the direction a bus actually runs (loops wrap forward). */
export function busRideMinutes(route: BusLineRoute, stopIds: readonly number[], fromStopId: number, toStopId: number): number | null {
  const o = busServiceOrder(stopIds), L = o.length - 1; if (L < 1 || route.legs.length !== L) return null;
  let best: number | null = null;
  for (let k = 0; k < L; k++) if (o[k] === fromStopId) {
    let m = 0;
    const end = route.loop ? k + L - 1 : (k < L / 2 ? L / 2 : L);
    for (let j = k; j < end; j++) { const g = route.legs[j % L]; m += g.seconds / 60 + BUS_DWELL_MIN; if (o[(j + 1) % L] === toStopId) { if (best === null || m - BUS_DWELL_MIN < best) best = m - BUS_DWELL_MIN; break; } }
  }
  return best;
}
