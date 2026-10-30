import type { LinkNetwork } from '../traffic/network.ts';
import { dispatchZones, travelTree, treeMinutes, treePath, TAXI_DISPATCH_MINUTES, type TravelTree } from './coverage.ts';
/**
 * Pure taxi dispatch engine (phase D3, taxi-design.th.md). Economy-neutral: no money, labour, saves
 * or UI. Driven by absolute GAME minutes; works in fixed quanta so 1× and 10× give identical results.
 *
 * Conservation (whole people): accepted = waiting + assigned (to pickup / riding / stranded)
 *                                         + completed + released.
 * Released people go back to private cars through the lease adapter; nobody is dropped.
 */
export const TAXI_QUANTUM_MIN = 5, TAXI_MAX_WAIT_MIN = 20, TAXI_DWELL_MIN = 1, TAXI_SEATS_PER_UNIT = 10, STAND_SLOTS = 2;
export const DEPOT_UNITS: Readonly<Record<1 | 2, number>> = Object.freeze({ 1: 4, 2: 8 });

/**
 * Local adapter for modal ownership. There is no stable lease API yet (#114 is rail-only and
 * draft; PR6 has no stable request ids), so the host supplies this. Calls are idempotent per
 * (requestId, cumulative count) semantics on the host side; the engine calls each once.
 */
export interface TaxiLeaseAdapter {
  /** Take `persons` out of road-assignable demand for this request. */
  reserve(requestId: string, persons: number): void;
  /** Return `persons` to private cars (wait timeout or coverage loss). */
  release(requestId: string, persons: number): void;
  /** Cumulative completed people for this request. */
  complete(requestId: string, completedPersons: number): void;
}
export const nullLeaseAdapter: TaxiLeaseAdapter = { reserve() {}, release() {}, complete() {} };

export type TaxiDepotSite = { id: number; cell: number; level: 1 | 2; open: boolean };
export type TaxiStandSite = { id: number; cell: number; open: boolean };
export type TaxiRequest = { id: string; from: number; to: number; persons: number; minute: number };
type Unit = { id: string; depotId: number; cell: number; state: 'idle' | 'toPickup' | 'riding' | 'repositioning' | 'stranded'; until: number; job?: Job; target?: number };
type Job = { requestId: string; part: string; from: number; to: number; persons: number; minute: number };
export type RoadLeg = { unitId: string; from: number; to: number; loaded: boolean; minute: number; path: number[] };
export type TaxiTotals = { accepted: number; rejected: number; completed: number; released: number; waitMinutesSum: number; pickups: number; legs: number; emptyLegs: number };

export class TaxiEngine {
  private net: LinkNetwork; private times: ReadonlyMap<string, number>;
  private trees = new Map<number, TravelTree>();
  private zones: Map<number, { depotId: number; minutes: number }>;
  readonly units: Unit[] = [];
  private waiting: Job[] = [];
  private completedBy = new Map<string, number>();
  private cursor: number;
  readonly legs: RoadLeg[] = [];
  readonly waits: number[] = [];
  totals: TaxiTotals = { accepted: 0, rejected: 0, completed: 0, released: 0, waitMinutesSum: 0, pickups: 0, legs: 0, emptyLegs: 0 };
  private readonly depots: readonly TaxiDepotSite[]; private readonly stands: readonly TaxiStandSite[]; private readonly lease: TaxiLeaseAdapter;
  constructor(net: LinkNetwork, times: ReadonlyMap<string, number>, depots: readonly TaxiDepotSite[], stands: readonly TaxiStandSite[], startMinute: number, lease: TaxiLeaseAdapter = nullLeaseAdapter) {
    this.depots = depots; this.stands = stands; this.lease = lease;
    this.net = net; this.times = times; this.cursor = Math.floor(startMinute / TAXI_QUANTUM_MIN) * TAXI_QUANTUM_MIN;
    this.zones = this.computeZones();
    for (const d of [...depots].sort((a, b) => a.id - b.id)) if (d.open) for (let k = 0; k < DEPOT_UNITS[d.level]; k++) this.units.push({ id: `taxi-${d.id}-${k}`, depotId: d.id, cell: d.cell, state: 'idle', until: this.cursor });
  }
  private computeZones() { return dispatchZones(this.net, this.times, this.depots.filter(d => d.open), TAXI_DISPATCH_MINUTES); }
  private tree(from: number) { let t = this.trees.get(from); if (!t) this.trees.set(from, t = travelTree(this.net, this.times, from)); return t; }
  private minutes(a: number, b: number) { return treeMinutes(this.tree(a), b); }
  /** Coverage lookup: which depot serves this curb cell (null = outside coverage). */
  zoneOf(cell: number) { return this.zones.get(cell) ?? null; }
  standServed(s: TaxiStandSite) { return s.open && this.zones.has(s.cell); }
  get now() { return this.cursor; }

  /** Offer requests. Outside coverage or unreachable → rejected (stays with private cars, no lease). */
  submit(requests: readonly TaxiRequest[]): { accepted: string[]; rejected: string[] } {
    const accepted: string[] = [], rejected: string[] = [];
    for (const r of [...requests].sort((a, b) => a.minute - b.minute || (a.id < b.id ? -1 : 1))) {
      if (!Number.isSafeInteger(r.persons) || r.persons < 1) throw RangeError('Taxi request needs whole people');
      if (!this.zones.has(r.from) || !Number.isFinite(this.minutes(r.from, r.to)) || r.from === r.to) { rejected.push(r.id); this.totals.rejected += r.persons; continue; }
      this.lease.reserve(r.id, r.persons); accepted.push(r.id); this.totals.accepted += r.persons;
      for (let left = r.persons, k = 0; left > 0; k++) { const n = Math.min(TAXI_SEATS_PER_UNIT, left); left -= n; this.waiting.push({ requestId: r.id, part: `${r.id}#${k}`, from: r.from, to: r.to, persons: n, minute: Math.max(r.minute, this.cursor) }); }
    }
    return { accepted, rejected };
  }
  /** Replace the network after a road edit or a new period's congested times. Mid-trip units re-check reachability. */
  setNetwork(net: LinkNetwork, times: ReadonlyMap<string, number>): void {
    this.net = net; this.times = times; this.trees.clear(); this.zones = this.computeZones();
    for (const u of this.units) if (u.state !== 'idle' && u.target !== undefined && !Number.isFinite(this.minutes(u.cell, u.target))) u.state = 'stranded';
  }
  /** Run all whole quanta up to `minute`. Paused → nothing moves and the cursor stays (no loss, no replay). */
  advanceTo(minute: number, paused = false): void {
    if (paused) return;
    while (this.cursor + TAXI_QUANTUM_MIN <= minute) { this.cursor += TAXI_QUANTUM_MIN; this.quantum(this.cursor); }
  }
  private leg(u: Unit, from: number, to: number, loaded: boolean, minute: number) {
    const path = treePath(this.tree(from), to) ?? [from];
    if (from !== to) { this.legs.push({ unitId: u.id, from, to, loaded, minute, path }); this.totals.legs++; if (!loaded) this.totals.emptyLegs++; }
  }
  private go(u: Unit, to: number, state: Unit['state'], t: number, dwell: number, loaded: boolean): void {
    const m = this.minutes(u.cell, to);
    if (!Number.isFinite(m)) { u.state = 'stranded'; u.target = to; return; }
    this.leg(u, u.cell, to, loaded, t); u.state = state; u.target = to; u.until = t + Math.ceil(m + dwell);
  }
  private quantum(t: number): void {
    // 1. Arrivals.
    for (const u of this.units) {
      if (u.state === 'stranded' && u.target !== undefined && Number.isFinite(this.minutes(u.cell, u.target))) {
        const resume = u.job && u.cell === u.job.from ? 'riding' : u.job ? 'toPickup' : 'repositioning';
        this.go(u, u.target, resume, t, resume === 'riding' ? TAXI_DWELL_MIN : 0, resume === 'riding');
      }
      if (u.state === 'stranded' || u.state === 'idle' || u.until > t) continue;
      u.cell = u.target!;
      if (u.state === 'toPickup') { this.go(u, u.job!.to, 'riding', t, TAXI_DWELL_MIN, true); continue; }
      if (u.state === 'riding') {
        const j = u.job!, done = (this.completedBy.get(j.requestId) ?? 0) + j.persons;
        this.completedBy.set(j.requestId, done); this.lease.complete(j.requestId, done); this.totals.completed += j.persons; u.job = undefined;
      }
      u.state = 'idle'; u.target = undefined;
    }
    // 2. Timeouts: back to private cars.
    this.waiting = this.waiting.filter(j => {
      if (t - j.minute <= TAXI_MAX_WAIT_MIN) return true;
      this.lease.release(j.requestId, j.persons); this.totals.released += j.persons; return false;
    });
    // 3. FIFO assignment to the idle unit with the lowest ETA (tie → unit id).
    const left: Job[] = [];
    for (const j of this.waiting) {
      if (j.minute > t) { left.push(j); continue; }
      let best: Unit | null = null, eta = Infinity;
      for (const u of this.units) if (u.state === 'idle') { const m = this.minutes(u.cell, j.from); if (m < eta - 1e-9) { eta = m; best = u; } }
      if (!best || t + eta - j.minute > TAXI_MAX_WAIT_MIN) { left.push(j); continue; }
      const wait = t - j.minute + eta; this.waits.push(wait); this.totals.waitMinutesSum += wait * j.persons; this.totals.pickups += j.persons;
      best.job = j;
      if (best.cell === j.from) this.go(best, j.to, 'riding', t, TAXI_DWELL_MIN, true);
      else this.go(best, j.from, 'toPickup', t, TAXI_DWELL_MIN, false);
    }
    this.waiting = left;
    // 4. Reposition idle units: to an open, served stand short of units, else home depot. Idle units at home stay put.
    for (const u of this.units) if (u.state === 'idle') {
      const atStand = this.stands.find(s => s.cell === u.cell);
      if (atStand) continue;
      const short = [...this.stands].filter(s => this.standServed(s) && this.units.filter(x => x.target === s.cell || (x.state === 'idle' && x.cell === s.cell)).length < STAND_SLOTS)
        .sort((a, b) => this.minutes(u.cell, a.cell) - this.minutes(u.cell, b.cell) || a.id - b.id)[0];
      const home = this.depots.find(d => d.id === u.depotId)!.cell;
      const to = short && Number.isFinite(this.minutes(u.cell, short.cell)) ? short.cell : home;
      if (to !== u.cell) this.go(u, to, 'repositioning', t, 0, false);
    }
  }
  /** People currently owned by the taxi engine, by state. */
  ledger() {
    const waiting = this.waiting.reduce((n, j) => n + j.persons, 0), assigned = this.units.reduce((n, u) => n + (u.job?.persons ?? 0), 0);
    const { accepted, completed, released } = this.totals;
    return { accepted, waiting, assigned, completed, released, conservationError: accepted - waiting - assigned - completed - released };
  }
  diagnostics() {
    const w = [...this.waits].sort((a, b) => a - b), busy = this.units.filter(u => u.state !== 'idle').length;
    return { meanWait: this.totals.pickups ? this.totals.waitMinutesSum / this.totals.pickups : 0, p90Wait: w.length ? w[Math.min(w.length - 1, Math.floor(w.length * .9))] : 0, utilization: this.units.length ? busy / this.units.length : 0, units: this.units.length, ...this.ledger() };
  }
}
