import type { RoadMap } from '../road-topology.ts';
import type { City } from '../sim.ts';
import { demandForPeriods, totalVehicles } from './demand.ts';
import { buildNetwork, rebuildRegion, resolveTrafficZone, type LinkNetwork } from './network.ts';
import { assignPeriod, shortestPath, linkTimes, type Assignment, type RouteState } from './routing.ts';
import { TrafficFlow, FLOW_LANE_CAPACITY } from './flow.ts';
import { cityDemandInput } from './snapshot.ts';
import type { DemandCarry, DemandInput, OdEntry } from './types.ts';
import { roadNeighbors } from '../road-topology.ts';
import { freeFlowSeconds } from './network.ts';
import { createBusLoadSink, type BusLoadSink } from './bridge.ts';
/**
 * Feature flag for the aggregate traffic model. OFF by default: nothing in gameplay, decorative
 * cars, economy or saves reads it. The clock holds all its state in memory only.
 */
export const TRAFFIC_MODEL_ENABLED = false;
export const MINUTES_PER_DAY = 1440, MINUTES_PER_PERIOD = 60;
/** Work budget per call. Remaining elapsed hours stay pending and are never skipped. */
export const MAX_CATCHUP_PERIODS = 24 * 7;
export type TrafficTotals = { periods: number; vehicles: number; unserved: number; vehicleSeconds: number; freeFlowSeconds: number };
export type TrafficClockOptions = {
  enabled?: boolean;
  /** Prototype conserved engine. Keep opt-in until city-bound save/runtime integration lands. */
  conservedFlow?: boolean;
  snapshot?: (c: City) => DemandInput;
  /** Optional per-period OD filter (bus mode share, PR B5). Absent = unchanged behaviour. */
  demandFilter?: (od: OdEntry[], periodStartMinute: number) => OdEntry[];
};
/** Absolute game minute from the economy clock (tick = day) and the minute within the day. */
export const gameMinute = (tick: number, minuteOfDay: number) => tick * MINUTES_PER_DAY + Math.floor(minuteOfDay);

export class TrafficClock {
  readonly enabled: boolean;
  readonly conservedFlow: boolean;
  flow = new TrafficFlow();
  lifecycle: 'new' | 'running' | 'different-city' | 'time-reversed' = 'new';
  pendingPeriods = 0;
  private readonly snapshot: (c: City) => DemandInput;
  readonly demandFilter?: (od: OdEntry[], periodStartMinute: number) => OdEntry[];
  private lastPeriod: number | null = null;
  private observedPeriod: number | null = null;
  private city: City | null = null;
  private carry: DemandCarry = {};
  private state: RouteState = new Map();
  private iterations = new Map<string, number>();
  private net: LinkNetwork | null = null;
  last: Assignment | null = null;
  /** OD rows of the latest period (for the visual fleet). */
  lastOd: OdEntry[] = [];
  totals: TrafficTotals = { periods: 0, vehicles: 0, unserved: 0, vehicleSeconds: 0, freeFlowSeconds: 0 };
  constructor(o: TrafficClockOptions = {}) {
    this.enabled = o.enabled ?? TRAFFIC_MODEL_ENABLED;
    this.conservedFlow = o.conservedFlow ?? false;
    this.demandFilter = o.demandFilter;
    this.snapshot = o.snapshot ?? (c => cityDemandInput(c, this.conservedFlow));
  }
  /**
   * Run every analysis period completed since the last call. Paused → nothing runs and the
   * cursor stays put; if game time moved while paused, those hours run exactly once on resume
   * (never lost, never replayed). Speed only changes how many periods one call covers, so totals
   * are identical at 1× and 10×. A different City object or reversed time suspends the model
   * explicitly for conserved clocks without erasing pending journeys; matching sidecar restore
   * is caller-controlled. The released representative-only clock retains its reset lifecycle.
   */
  private busPcu: ReadonlyMap<string, number> = new Map();
  /** Bus road-load sink (`trafficLayer.bus?.hook.connect(clock.busRoadSink())`). Never connected = unchanged. */
  busRoadSink(): BusLoadSink { return createBusLoadSink(load => { this.busPcu = load; this.flow.setBusLoad(load); }); }
  /** Present bus PCU → hourly volume by Little's law (PCU × 3600 / free-flow seconds). */
  private busVolumes(): Map<string, number> | undefined {
    if (!this.busPcu.size || !this.net) return undefined;
    const v = new Map<string, number>(); for (const [k, p] of this.busPcu) { const l = this.net.links.get(k); if (l) v.set(k, p * 3600 / Math.max(1, freeFlowSeconds(l))); }
    return v;
  }
  advance(c: City, minute: number, paused = false): Assignment[] {
    if (!Number.isSafeInteger(minute) || minute < 0) throw Error('Invalid traffic clock minute');
    const period = Math.floor(minute / MINUTES_PER_PERIOD);
    if (!this.enabled) return [];
    if (!this.conservedFlow && (c !== this.city || period < (this.observedPeriod ?? period))) this.resetRepresentative(c);
    if (this.lastPeriod == null) { this.city = c; this.lastPeriod = this.observedPeriod = period; this.lifecycle = 'running'; return []; }
    // A new city/save is a different experiment: never silently clear unresolved trips.
    // The caller must retain/archive this clock or explicitly restore its matching sidecar.
    if (c !== this.city) { this.lifecycle = 'different-city'; return []; }
    if (period < this.observedPeriod!) { this.lifecycle = 'time-reversed'; return []; }
    this.observedPeriod = period; this.pendingPeriods = period - this.lastPeriod;
    this.lifecycle = 'running';
    if (paused) return [];
    let start = this.lastPeriod, n = period - start;
    if (n <= 0) return [];
    n = Math.min(n, MAX_CATCHUP_PERIODS);
    this.lastPeriod = start + n; this.pendingPeriods = period - this.lastPeriod;
    this.net ??= buildNetwork(c as RoadMap, this.conservedFlow ? { capacityPerLane: FLOW_LANE_CAPACITY, parcelZones: true } : {});
    const out: Assignment[] = [];
    for (const r of demandForPeriods(this.snapshot(c), start % 24, n, this.carry)) {
      this.carry = r.carry;
      const od = this.demandFilter ? this.demandFilter(r.od, (start + out.length) * MINUTES_PER_PERIOD) : r.od;
      const { rows: resolved, unreachable } = this.conservedFlow ? this.routingDemand(od) : { rows: od, unreachable: 0 };
      const a = assignPeriod(this.net, resolved, this.state, this.iterations, this.busVolumes());
      a.unserved += unreachable;
      if (this.conservedFlow) this.flow.advancePeriod(this.net, od);
      // Age only ODs actually assigned, once even when multiple purposes share the route.
      for (const key of this.iterations.keys()) if (!a.state.has(key)) this.iterations.delete(key);
      for (const key of new Set(resolved.filter(d => d.vehicles > 0).map(d => `${d.from}:${d.to}`))) {
        if (a.state.has(key)) this.iterations.set(key, (this.iterations.get(key) ?? 0) + 1);
      }
      this.state = a.state; this.last = a; this.lastOd = resolved; out.push(a);

      const t = this.totals; t.periods++; t.vehicles += totalVehicles(r.od); t.unserved += a.unserved; t.vehicleSeconds += a.vehicleSeconds;
      for (const [k, v] of a.volumes) { const l = this.net.links.get(k)!; t.freeFlowSeconds += v * l.length / (l.freeFlowKmh / 3.6); }
    }
    return out;
  }
  /** After a road edit: rebuild only links near the edited cells; restart the settling step. */
  roadEdited(c: City, cells: Iterable<number>): void {
    if (!this.enabled || !this.net) return;
    if (c !== this.city) { this.lifecycle = 'different-city'; return; }
    rebuildRegion(c as RoadMap, this.net, cells); this.iterations.clear();
    if (this.conservedFlow) this.flow.roadEdited(this.net);
  }
  private resetRepresentative(c: City) {
    this.city = c; this.lastPeriod = this.observedPeriod = null; this.pendingPeriods = 0;
    this.carry = {}; this.state = new Map(); this.iterations.clear(); this.net = null; this.last = null; this.lastOd = [];
    this.totals = { periods: 0, vehicles: 0, unserved: 0, vehicleSeconds: 0, freeFlowSeconds: 0 };
  }
  private routingDemand(od: readonly OdEntry[]): { rows: OdEntry[]; unreachable: number } {
    const net = this.net!, times = linkTimes(net, new Map()), rows: OdEntry[] = []; let unreachable = 0;
    for (const d of od) {
      let best: number[] | null = null;
      for (const from of resolveTrafficZone(net, d.from)) for (const to of resolveTrafficZone(net, d.to)) {
        const p = shortestPath(net, times, from, to); if (p && (!best || p.length < best.length)) best = p;
      }
      if (best) rows.push({ ...d, from: best[0], to: best.at(-1)! }); else unreachable += d.vehicles;
    }
    return { rows, unreachable };
  }
  /** Pure sidecar codec only: this does not write player saves or browser storage. */
  exportState() {
    if (!this.conservedFlow) throw Error('Traffic sidecar requires a conserved clock');
    return { version: 2 as const, lastPeriod: this.lastPeriod, observedPeriod: this.observedPeriod, carry: structuredClone(this.carry), routes: structuredClone([...this.state]), iterations: [...this.iterations], totals: structuredClone(this.totals), flow: this.flow.exportState() };
  }
  restoreState(c: City, minute: number, value: unknown): void {
    if (!this.conservedFlow) throw Error('Traffic sidecar requires a conserved clock');
    const s = value as ReturnType<TrafficClock['exportState']>;
    const fields = (v: unknown, keys: string) => !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).sort().join(',') === keys;
    const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER;
    if (!Number.isSafeInteger(minute) || minute < 0 || !fields(s, 'carry,flow,iterations,lastPeriod,observedPeriod,routes,totals,version') || s.version !== 2 || s.lastPeriod == null || s.observedPeriod == null || !Number.isSafeInteger(s.lastPeriod) || s.lastPeriod < 0 || !Number.isSafeInteger(s.observedPeriod) || s.observedPeriod !== Math.floor(minute / 60) || s.lastPeriod > s.observedPeriod || !s.carry || typeof s.carry !== 'object' || Array.isArray(s.carry) || !Array.isArray(s.routes) || !Array.isArray(s.iterations) || !fields(s.totals, 'freeFlowSeconds,periods,unserved,vehicleSeconds,vehicles') || Object.values(s.totals).some(n => !finite(n)) || !Number.isSafeInteger(s.totals.periods) || s.totals.periods > s.lastPeriod || Object.entries(s.carry).some(([key,n]) => !/^(commute|school|park|freight):\d+:\d+$/.test(key) || !finite(n) || n >= 1)) throw Error('Invalid traffic clock sidecar');
    const flow = TrafficFlow.restore(s.flow);
    if (s.totals.periods !== flow.snapshot.minute / 60 || Math.abs(s.totals.vehicles - flow.snapshot.offered) > 1e-6) throw Error('Traffic clock and flow differ');
    const routes: RouteState = new Map();
    for (const entry of s.routes) {
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || !/^\d+:\d+$/.test(entry[0]) || routes.has(entry[0]) || !Array.isArray(entry[1]) || !entry[1].length) throw Error('Invalid traffic route sidecar');
      const [from,to] = entry[0].split(':').map(Number), paths = new Set<string>();
      for (const p of entry[1]) {
        if (!fields(p, 'path,share') || !Array.isArray(p.path) || !p.path.length || p.path.length > 576 || p.path[0] !== from || p.path.at(-1) !== to || p.path.some(n => !Number.isSafeInteger(n) || n < 0 || n >= 576) || p.path.slice(1).some((n,i)=>!roadNeighbors(p.path[i]).includes(n)) || !finite(p.share) || p.share > 1 || paths.has(p.path.join(','))) throw Error('Invalid traffic route share');
        paths.add(p.path.join(','));
      }
      const sum = entry[1].reduce((n,p)=>n+p.share,0); if (sum <= 0 || sum > 1+1e-7) throw Error('Invalid traffic route total');
      routes.set(entry[0], structuredClone(entry[1]));
    }
    const iterations = new Map<string, number>();
    for (const entry of s.iterations) {
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || !routes.has(entry[0]) || iterations.has(entry[0]) || !Number.isSafeInteger(entry[1]) || entry[1] < 0) throw Error('Invalid traffic route age');
      iterations.set(entry[0],entry[1]);
    }
    // Prepare the coupled graph/flow before publishing any part of a restored clock.
    const net = buildNetwork(c as RoadMap, { capacityPerLane: FLOW_LANE_CAPACITY, parcelZones: true }); flow.roadEdited(net);
    this.city = c; this.lastPeriod = s.lastPeriod; this.observedPeriod = s.observedPeriod; this.carry = structuredClone(s.carry); this.state = routes; this.iterations = iterations; this.totals = structuredClone(s.totals); this.flow = flow;
    this.net = net; this.last = null; this.lastOd = []; this.pendingPeriods = s.observedPeriod-s.lastPeriod; this.lifecycle = 'running';
  }
  get network(): LinkNetwork | null { return this.net; }
}
/** Congestion delay (seconds) accumulated beyond free-flow. */
export const totalDelay = (t: TrafficTotals) => Math.max(0, t.vehicleSeconds - t.freeFlowSeconds);
