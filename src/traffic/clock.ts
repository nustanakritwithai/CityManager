import type { RoadMap } from '../road-topology.ts';
import type { City } from '../sim.ts';
import { demandForPeriods, totalVehicles } from './demand.ts';
import { buildNetwork, rebuildRegion, resolveTrafficZone, type LinkNetwork } from './network.ts';
import { assignPeriod, shortestPath, linkTimes, type Assignment, type RouteState } from './routing.ts';
import { TrafficFlow, FLOW_LANE_CAPACITY } from './flow.ts';
import { cityDemandInput } from './snapshot.ts';
import type { DemandCarry, DemandInput, OdEntry } from './types.ts';
/**
 * Feature flag for the aggregate traffic model. OFF by default: nothing in gameplay, decorative
 * cars, economy or saves reads it. The clock holds all its state in memory only.
 */
export const TRAFFIC_MODEL_ENABLED = false;
export const MINUTES_PER_DAY = 1440, MINUTES_PER_PERIOD = 60;
/** Work budget per call. Remaining elapsed hours stay pending and are never skipped. */
export const MAX_CATCHUP_PERIODS = 24 * 7;
export type TrafficTotals = { periods: number; vehicles: number; unserved: number; vehicleSeconds: number; freeFlowSeconds: number };
export type TrafficClockOptions = { enabled?: boolean; snapshot?: (c: City) => DemandInput };
/** Absolute game minute from the economy clock (tick = day) and the minute within the day. */
export const gameMinute = (tick: number, minuteOfDay: number) => tick * MINUTES_PER_DAY + Math.floor(minuteOfDay);

export class TrafficClock {
  readonly enabled: boolean;
  flow = new TrafficFlow();
  lifecycle: 'new' | 'running' | 'different-city' | 'time-reversed' = 'new';
  pendingPeriods = 0;
  private readonly snapshot: (c: City) => DemandInput;
  private lastPeriod: number | null = null;
  private city: City | null = null;
  private carry: DemandCarry = {};
  private state: RouteState = new Map();
  private iterations = new Map<string, number>();
  private net: LinkNetwork | null = null;
  last: Assignment | null = null;
  /** OD rows of the latest period (for the visual fleet). */
  lastOd: OdEntry[] = [];
  totals: TrafficTotals = { periods: 0, vehicles: 0, unserved: 0, vehicleSeconds: 0, freeFlowSeconds: 0 };
  constructor(o: TrafficClockOptions = {}) { this.enabled = o.enabled ?? TRAFFIC_MODEL_ENABLED; this.snapshot = o.snapshot ?? (c => cityDemandInput(c, true)); }
  /**
   * Run every analysis period completed since the last call. Paused → nothing runs and the
   * cursor stays put; if game time moved while paused, those hours run exactly once on resume
   * (never lost, never replayed). Speed only changes how many periods one call covers, so totals
   * are identical at 1× and 10×. A different City object or reversed time suspends the model
   * explicitly without erasing pending journeys; matching sidecar restore is caller-controlled.
   */
  advance(c: City, minute: number, paused = false): Assignment[] {
    const period = Math.floor(minute / MINUTES_PER_PERIOD);
    if (!this.enabled) return [];
    if (this.lastPeriod == null) { this.city = c; this.lastPeriod = period; this.lifecycle = 'running'; return []; }
    // A new city/save is a different experiment: never silently clear unresolved trips.
    // The caller must retain/archive this clock or explicitly restore its matching sidecar.
    if (c !== this.city) { this.lifecycle = 'different-city'; return []; }
    if (period < this.lastPeriod) { this.lifecycle = 'time-reversed'; return []; }
    this.lifecycle = 'running';
    if (paused) return [];
    let start = this.lastPeriod, n = period - start;
    if (n <= 0) return [];
    n = Math.min(n, MAX_CATCHUP_PERIODS);
    this.lastPeriod = start + n; this.pendingPeriods = period - this.lastPeriod;
    this.net ??= buildNetwork(c as RoadMap, { capacityPerLane: FLOW_LANE_CAPACITY, parcelZones: true });
    const out: Assignment[] = [];
    for (const r of demandForPeriods(this.snapshot(c), start % 24, n, this.carry)) {
      this.carry = r.carry;
      const { rows: resolved, unreachable } = this.routingDemand(r.od);
      const a = assignPeriod(this.net, resolved, this.state, this.iterations);
      a.unserved += unreachable;
      this.flow.advancePeriod(this.net, r.od);
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
    rebuildRegion(c as RoadMap, this.net, cells); this.iterations.clear(); this.flow.roadEdited(this.net);
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
    return { version: 1 as const, lastPeriod: this.lastPeriod, carry: structuredClone(this.carry), routes: [...this.state], iterations: [...this.iterations], totals: structuredClone(this.totals), flow: this.flow.exportState() };
  }
  restoreState(c: City, minute: number, value: unknown): void {
    const s = value as ReturnType<TrafficClock['exportState']>;
    if (!s || s.version !== 1 || s.lastPeriod !== Math.floor(minute / 60) || !s.carry || !Array.isArray(s.routes) || !Array.isArray(s.iterations) || !s.totals || Object.values(s.totals).some(n => !Number.isFinite(n) || n < 0) || Object.values(s.carry).some(n => !Number.isFinite(n) || n < 0 || n >= 1)) throw Error('Invalid traffic clock sidecar');
    const flow = TrafficFlow.restore(s.flow);
    if (s.totals.periods !== flow.snapshot.minute / 60 || Math.abs(s.totals.vehicles - flow.snapshot.offered) > 1e-6) throw Error('Traffic clock and flow differ');
    const routes: RouteState = new Map();
    for (const entry of s.routes) {
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || !Array.isArray(entry[1])) throw Error('Invalid traffic route sidecar');
      for (const p of entry[1]) if (!p || !Array.isArray(p.path) || p.path.some(n => !Number.isSafeInteger(n) || n < 0 || n >= 576) || !Number.isFinite(p.share) || p.share < 0) throw Error('Invalid traffic route share');
      routes.set(entry[0], structuredClone(entry[1]));
    }
    for (const [key, age] of s.iterations) if (typeof key !== 'string' || !Number.isSafeInteger(age) || age < 0) throw Error('Invalid traffic route age');
    this.city = c; this.lastPeriod = s.lastPeriod; this.carry = structuredClone(s.carry); this.state = routes; this.iterations = new Map(s.iterations); this.totals = structuredClone(s.totals); this.flow = flow;
    this.net = buildNetwork(c as RoadMap, { capacityPerLane: FLOW_LANE_CAPACITY, parcelZones: true }); this.flow.roadEdited(this.net); this.last = null; this.lastOd = []; this.pendingPeriods = 0; this.lifecycle = 'running';
  }
  get network(): LinkNetwork | null { return this.net; }
}
/** Congestion delay (seconds) accumulated beyond free-flow. */
export const totalDelay = (t: TrafficTotals) => Math.max(0, t.vehicleSeconds - t.freeFlowSeconds);
