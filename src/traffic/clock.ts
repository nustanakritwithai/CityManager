import type { RoadMap } from '../road-topology.ts';
import type { City } from '../sim.ts';
import { demandForPeriods, totalVehicles } from './demand.ts';
import { buildNetwork, rebuildRegion, type LinkNetwork } from './network.ts';
import { assignPeriod, type Assignment, type RouteState } from './routing.ts';
import { cityDemandInput } from './snapshot.ts';
import type { DemandCarry, DemandInput } from './types.ts';
/**
 * Feature flag for the aggregate traffic model. OFF by default: nothing in gameplay, decorative
 * cars, economy or saves reads it. The clock holds all its state in memory only.
 */
export const TRAFFIC_MODEL_ENABLED = false;
export const MINUTES_PER_DAY = 1440, MINUTES_PER_PERIOD = 60;
/** Longest catch-up in one call (a game week); older periods are skipped, not replayed. */
export const MAX_CATCHUP_PERIODS = 24 * 7;
export type TrafficTotals = { periods: number; vehicles: number; unserved: number; vehicleSeconds: number; freeFlowSeconds: number };
export type TrafficClockOptions = { enabled?: boolean; snapshot?: (c: City) => DemandInput };
/** Absolute game minute from the economy clock (tick = day) and the minute within the day. */
export const gameMinute = (tick: number, minuteOfDay: number) => tick * MINUTES_PER_DAY + Math.floor(minuteOfDay);

export class TrafficClock {
  readonly enabled: boolean;
  private readonly snapshot: (c: City) => DemandInput;
  private lastPeriod: number | null = null;
  private city: City | null = null;
  private carry: DemandCarry = {};
  private state: RouteState = new Map();
  private iteration = 0;
  private net: LinkNetwork | null = null;
  last: Assignment | null = null;
  totals: TrafficTotals = { periods: 0, vehicles: 0, unserved: 0, vehicleSeconds: 0, freeFlowSeconds: 0 };
  constructor(o: TrafficClockOptions = {}) { this.enabled = o.enabled ?? TRAFFIC_MODEL_ENABLED; this.snapshot = o.snapshot ?? cityDemandInput; }
  /**
   * Run every analysis period completed since the last call. Paused → nothing runs and the
   * cursor stays put; if game time moved while paused, those hours run exactly once on resume
   * (never lost, never replayed). Speed only changes how many periods one call covers, so totals
   * are identical at 1× and 10×. A different City object (new game/load) or time going backwards
   * restarts the model.
   */
  advance(c: City, minute: number, paused = false): Assignment[] {
    const period = Math.floor(minute / MINUTES_PER_PERIOD);
    if (!this.enabled) return [];
    if (c !== this.city || this.lastPeriod == null || period < this.lastPeriod) { this.reset(c); this.lastPeriod = period; return []; }
    if (paused) return [];
    let start = this.lastPeriod, n = period - start;
    if (n <= 0) return [];
    if (n > MAX_CATCHUP_PERIODS) { start = period - MAX_CATCHUP_PERIODS; n = MAX_CATCHUP_PERIODS; }
    this.lastPeriod = period;
    this.net ??= buildNetwork(c as RoadMap);
    const out: Assignment[] = [];
    for (const r of demandForPeriods(this.snapshot(c), start % 24, n, this.carry)) {
      this.carry = r.carry;
      const a = assignPeriod(this.net, r.od, this.state, this.iteration++);
      this.state = a.state; this.last = a; out.push(a);
      const t = this.totals; t.periods++; t.vehicles += totalVehicles(r.od); t.unserved += a.unserved; t.vehicleSeconds += a.vehicleSeconds;
      for (const [k, v] of a.volumes) { const l = this.net.links.get(k)!; t.freeFlowSeconds += v * l.length / (l.freeFlowKmh / 3.6); }
    }
    return out;
  }
  /** After a road edit: rebuild only links near the edited cells; restart the settling step. */
  roadEdited(c: City, cells: Iterable<number>): void {
    if (!this.enabled || !this.net) return;
    rebuildRegion(c as RoadMap, this.net, cells); this.iteration = 0;
  }
  private reset(c: City) {
    this.city = c; this.carry = {}; this.state = new Map(); this.iteration = 0; this.net = null; this.last = null;
    this.totals = { periods: 0, vehicles: 0, unserved: 0, vehicleSeconds: 0, freeFlowSeconds: 0 };
  }
  get network(): LinkNetwork | null { return this.net; }
}
/** Congestion delay (seconds) accumulated beyond free-flow. */
export const totalDelay = (t: TrafficTotals) => Math.max(0, t.vehicleSeconds - t.freeFlowSeconds);
