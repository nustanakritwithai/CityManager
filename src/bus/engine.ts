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
import { buildNetwork, linkKey, type LinkNetwork } from '../traffic/network.ts';
import { linkTimes, shortestPath } from '../traffic/routing.ts';
import { roadNeighbors } from '../road-topology.ts';
import { BusRouteCache, busServiceOrder, type BusHost, type BusLineRoute } from './lines.ts';
import { BUS_CAPACITY, BUS_DWELL_MIN, BUS_PCU, BUS_SERVICE, type BusEvent, type BusPhase, type BusRequestMass, type BusSnapshot } from './types.ts';

export const BUS_MAX_WAIT_MIN = 30;
export type BusReleaseReason = 'timeout' | 'serviceEnd' | 'suspended' | 'unknownLine' | 'stranded';
export type BusEngineOptions = { maxWaitMinutes?: number; release?: (requestId: string, persons: number, reason: BusReleaseReason) => void; times?: ReadonlyMap<string, number> };
export type BusSubmission = BusRequestMass & { requestId: string };
type Waiting = { requestId: string; toStopId: number; persons: number; minute: number };
type Rider = { requestId: string; toStopId: number; persons: number };
type Bus = {
  id: string; lineId: number; k: number; phase: BusPhase; cell: number; until: number;
  path?: number[]; at?: number[]; /** order index of the stop being approached / dwelt at */ idx: number;
  returning: boolean; retired: boolean; onboard: Rider[];
};
const inService = (t: number) => { const m = ((t % 1440) + 1440) % 1440; return m >= BUS_SERVICE.from && m < BUS_SERVICE.to; };
const sum = (r: readonly { persons: number }[]) => r.reduce((n, x) => n + x.persons, 0);

export class BusEngine {
  private host: BusHost; private cache = new BusRouteCache(); private routes: readonly BusLineRoute[] = [];
  private net!: LinkNetwork; private times!: ReadonlyMap<string, number>;
  private buses: Bus[] = []; private queues = new Map<string, Waiting[]>(); private events: BusEvent[] = [];
  private cursor: number; private readonly start: number; private readonly maxWait: number;
  private readonly releaseHook: NonNullable<BusEngineOptions['release']>; private readonly fixedTimes?: ReadonlyMap<string, number>;
  totals = { accepted: 0, boarded: 0, completed: 0, released: 0, releasedBy: { timeout: 0, serviceEnd: 0, suspended: 0, unknownLine: 0, stranded: 0 } as Record<BusReleaseReason, number>, replans: 0, departures: 0 };
  constructor(host: BusHost, startMinute: number, o: BusEngineOptions = {}) {
    this.host = host; this.cursor = this.start = startMinute; this.maxWait = o.maxWaitMinutes ?? BUS_MAX_WAIT_MIN;
    this.releaseHook = o.release ?? (() => {}); this.fixedTimes = o.times;
    this.refresh(startMinute);
  }
  get now() { return this.cursor; }
  private route(lineId: number) { return this.routes.find(r => r.lineId === lineId); }
  private order(r: BusLineRoute) { return busServiceOrder(this.host.bus?.lines.find(l => l.id === r.lineId)?.stopIds.filter(id => r.stops.some(s => s.stopId === id)) ?? []); }
  private stopCell(id: number) { return this.host.bus?.stops.find(s => s.id === id)?.cell; }
  private depotCell(lineId: number) { const r = this.route(lineId); return this.host.bus?.depots.find(d => d.id === r?.depotId)?.cell; }
  private capacity(lineId: number) { return BUS_CAPACITY[this.host.bus?.lines.find(l => l.id === lineId)?.busLevel ?? 1]; }

  /** Re-read lines/roads (memoised). On change: resize fleets and replan moving buses from where they are. */
  refresh(t = this.cursor): void {
    const next = this.cache.get(this.host, this.fixedTimes ? { times: this.fixedTimes } : {});
    if (next === this.routes && this.net) return;
    const first = !this.net; this.routes = next; this.net = buildNetwork(this.host); this.times = this.fixedTimes ?? linkTimes(this.net, new Map());
    for (const r of this.routes) for (let k = 0; k < r.buses; k++) if (!this.buses.some(b => b.lineId === r.lineId && b.k === k)) {
      const cell = this.depotCell(r.lineId)!;
      this.buses.push({ id: `bus-${r.lineId}-${k}`, lineId: r.lineId, k, phase: 'home', cell, until: this.departure(r, k, t), idx: 0, returning: false, retired: false, onboard: [] });
    }
    this.buses.sort((a, b) => a.lineId - b.lineId || a.k - b.k);
    if (first) return;
    this.totals.replans++;
    for (const b of this.buses) {
      const r = this.route(b.lineId);
      b.retired = !r || r.status !== 'running' || b.k >= r.buses;
      if (b.phase === 'home' || b.phase === 'dwelling') { if (b.phase === 'home' && r) b.until = Math.max(t, Math.min(b.until, this.departure(r, b.k, t))); continue; }
      this.cut(b, t);
      if (b.returning || b.retired) { this.releaseRiders(b, b.retired && r?.status !== 'running' ? 'suspended' : 'stranded', t, true); this.goHome(b, t); continue; }
      const target = this.stopCell(this.order(r!)[b.idx]);
      const p = target === undefined ? null : shortestPath(this.net, this.times, b.cell, target);
      if (!p) { this.releaseRiders(b, 'stranded', t, true); this.goHome(b, t); } else this.drive(b, p, t, b.phase);
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
    if (depot === undefined || !this.host.cells[b.cell]?.road && b.cell === depot) { this.park(b, t); return; }
    if (!best) { b.phase = 'running'; b.path = b.at = undefined; b.until = t + 5; return; } // stuck: retry
    this.drive(b, best, t, 'running');
  }
  private park(b: Bus, t: number): void {
    const r = this.route(b.lineId); b.phase = 'home'; b.returning = false; b.path = b.at = undefined;
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
    const stopId = o[b.idx]; b.cell = this.stopCell(stopId)!; b.path = b.at = undefined;
    const off = b.onboard.filter(x => x.toStopId === stopId), n = sum(off);
    if (n) { this.totals.completed += n; this.events.push(Object.freeze({ kind: 'alight' as const, busId: b.id, lineId: b.lineId, stopId, cell: b.cell, minute: t, persons: n })); }
    b.onboard = b.onboard.filter(x => x.toStopId !== stopId);
    this.sweep(t);
    if (inService(t) && !b.retired) {
      const ahead = this.ahead(r, b.idx), key = `${b.lineId}:${stopId}`, q = this.queues.get(key) ?? [];
      let room = this.capacity(b.lineId) - sum(b.onboard), boarded = 0;
      for (const w of q) { if (room <= 0) break; if (!ahead.has(w.toStopId)) continue; const take = Math.min(room, w.persons); w.persons -= take; room -= take; boarded += take; b.onboard.push({ requestId: w.requestId, toStopId: w.toStopId, persons: take }); }
      this.queues.set(key, q.filter(w => w.persons > 0));
      if (boarded) { this.totals.boarded += boarded; this.events.push(Object.freeze({ kind: 'board' as const, busId: b.id, lineId: b.lineId, stopId, cell: b.cell, minute: t, persons: boarded })); }
    }
    b.phase = 'dwelling'; b.until = t + BUS_DWELL_MIN;
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
      if (depot !== undefined && !roadNeighbors(depot).includes(b.cell)) { this.goHome(b, t); return; } // was stuck: retry
      this.park(b, t); if (b.retired && (!r || b.k >= r.buses)) this.buses = this.buses.filter(x => x !== b); return;
    }
    if (!r) { this.goHome(b, t); return; }
    this.atStop(b, t);
  }
  /** Advance to absolute game minute `minute` (deterministic: events in (time, bus id) order). */
  advanceTo(minute: number): void {
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
    return Object.freeze(this.buses.map(b => {
      let cell = b.cell, next = b.cell, progress = 0;
      if (b.path && b.at) {
        let k = 0; while (k + 1 < b.at.length && b.at[k + 1] <= m + 1e-9) k++;
        cell = b.path[k];
        if (k + 1 < b.path.length && m >= b.at[0]) { next = b.path[k + 1]; progress = Math.min(1, Math.max(0, (m - b.at[k]) / (b.at[k + 1] - b.at[k]))); }
        if (next === cell) progress = 0;
      }
      return Object.freeze({ id: b.id, lineId: b.lineId, phase: b.phase, cell, next, progress, persons: sum(b.onboard), capacity: this.capacity(b.lineId) });
    }));
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
