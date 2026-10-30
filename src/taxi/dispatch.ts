import { linkKey, type LinkNetwork } from '../traffic/network.ts';
import { TAXI_DEPOT_UNITS, type TaxiDepotSite } from './sites.ts';
export type { TaxiDepotSite } from './sites.ts';
import { planRoam } from './rrt-roam.ts';
import { dispatchZones, travelTree, treeMinutes, treePath, TAXI_DISPATCH_MINUTES, type TravelTree } from './coverage.ts';
/**
 * Pure taxi dispatch engine (phase D3, taxi-design.th.md). Economy-neutral: no money, labour, saves
 * or UI. Driven by absolute GAME minutes; works in fixed quanta so 1× and 10× give identical results.
 *
 * Conservation (whole people): accepted = waiting + assigned (to pickup / riding / stranded)
 *                                         + completed + released.
 * Released people go back to private cars through the lease adapter; nobody is dropped.
 */
export const TAXI_QUANTUM_MIN = 5, TAXI_MAX_WAIT_MIN = 20, TAXI_DWELL_MIN = 1, TAXI_SEATS_PER_UNIT = 10;
/** Local pickup radius (ETA minutes); taxis only consider requests this close. */
export const TAXI_LOCAL_RADIUS_MIN = 10, TAXI_DEMAND_WINDOW_MIN = 60;
/** Night: minute-of-day window where idle taxis return to their depot. */
export const TAXI_NIGHT = Object.freeze({ from: 23 * 60, to: 5 * 60 });
export const DEPOT_UNITS = TAXI_DEPOT_UNITS;
/** City-wide cruising: every road cell earns an exploration bonus of TAXI_EXPLORE_WEIGHT × mean demand,
 *  growing linearly to full after TAXI_EXPLORE_HORIZON_MIN minutes without a taxi passing through. */
export const TAXI_EXPLORE_WEIGHT = 1, TAXI_EXPLORE_HORIZON_MIN = 60;
/** Anti-bunching: a cell's demand is divided by 1 + (other taxis parked at or roaming to a cell within
 *  this many grid steps, Manhattan). Idle taxis decide in id order, so later taxis see earlier claims. */
export const TAXI_SPREAD_RADIUS = 3;

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

/** `width` = map width in cells (required: the RRT samples on the real grid). */
export type TaxiEngineOptions = { width: number; seed?: number; lease?: TaxiLeaseAdapter; expected?: (cell: number, minute: number) => number };
export type TaxiRequest = { id: string; from: number; to: number; persons: number; minute: number };
type State = 'idle' | 'toPickup' | 'riding' | 'roaming' | 'home' | 'stranded';
/** `route` = planned cells, `at[k]` = absolute minute the unit reaches route[k]; `leg` = its recorded road leg. */
type Unit = { id: string; depotId: number; cell: number; state: State; until: number; job?: Job; target?: number; resume?: State; route?: number[]; at?: number[]; leg?: RoadLeg };
type Job = { requestId: string; part: string; from: number; to: number; persons: number; minute: number };
export type RoadLeg = { unitId: string; from: number; to: number; loaded: boolean; minute: number; path: number[] };
export type TaxiTotals = { accepted: number; rejected: number; completed: number; released: number; waitMinutesSum: number; pickups: number; legs: number; emptyLegs: number; roamLegs: number; roamMinutes: number; parked: number; interrupted: number; replans: number };

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
  totals: TaxiTotals = { accepted: 0, rejected: 0, completed: 0, released: 0, waitMinutesSum: 0, pickups: 0, legs: 0, emptyLegs: 0, roamLegs: 0, roamMinutes: 0, parked: 0, interrupted: 0, replans: 0 };
  private readonly depots: readonly TaxiDepotSite[];
  private readonly lease: TaxiLeaseAdapter; private readonly seed: number; private readonly width: number;
  private readonly expected?: (cell: number, minute: number) => number;
  /** Minute a taxi last (plannedly) passed each cell; drives the exploration bonus. */
  private lastSeen = new Map<number, number>();
  private origins: { cell: number; minute: number; persons: number }[] = [];
  constructor(net: LinkNetwork, times: ReadonlyMap<string, number>, depots: readonly TaxiDepotSite[], startMinute: number, opts: TaxiEngineOptions) {
    if (!opts || !Number.isSafeInteger(opts.width) || opts.width < 1) throw RangeError('TaxiEngine needs the map width');
    this.depots = depots; this.lease = opts.lease ?? nullLeaseAdapter; this.seed = opts.seed ?? 0; this.width = opts.width; this.expected = opts.expected;
    this.net = net; this.times = times; this.cursor = Math.floor(startMinute / TAXI_QUANTUM_MIN) * TAXI_QUANTUM_MIN;
    this.zones = this.computeZones();
    for (const d of [...depots].sort((a, b) => a.id - b.id)) if (d.open) for (let k = 0; k < DEPOT_UNITS[d.level]; k++) this.units.push({ id: `taxi-${d.id}-${k}`, depotId: d.id, cell: d.cell, state: 'idle', until: this.cursor });
  }
  private computeZones() { return dispatchZones(this.net, this.times, this.depots.filter(d => d.open), TAXI_DISPATCH_MINUTES); }
  private tree(from: number) { let t = this.trees.get(from); if (!t) this.trees.set(from, t = travelTree(this.net, this.times, from)); return t; }
  private minutes(a: number, b: number) { return treeMinutes(this.tree(a), b); }
  zoneOf(cell: number) { return this.zones.get(cell) ?? null; }
  get now() { return this.cursor; }

  submit(requests: readonly TaxiRequest[]): { accepted: string[]; rejected: string[] } {
    const accepted: string[] = [], rejected: string[] = [];
    for (const r of [...requests].sort((a, b) => a.minute - b.minute || (a.id < b.id ? -1 : 1))) {
      if (!Number.isSafeInteger(r.persons) || r.persons < 1) throw RangeError('Taxi request needs whole people');
      if (!this.zones.has(r.from) || !Number.isFinite(this.minutes(r.from, r.to)) || r.from === r.to) { rejected.push(r.id); this.totals.rejected += r.persons; continue; }
      this.lease.reserve(r.id, r.persons); this.origins.push({ cell: r.from, minute: r.minute, persons: r.persons }); accepted.push(r.id); this.totals.accepted += r.persons;
      for (let left = r.persons, k = 0; left > 0; k++) { const n = Math.min(TAXI_SEATS_PER_UNIT, left); left -= n; this.waiting.push({ requestId: r.id, part: `${r.id}#${k}`, from: r.from, to: r.to, persons: n, minute: Math.max(r.minute, this.cursor) }); }
    }
    return { accepted, rejected };
  }
  /** Index of the last route cell reached by minute `t`. */
  private reached(u: Unit, t: number): number { const at = u.at!; let k = 0; while (k + 1 < at.length && at[k + 1] <= t + 1e-9) k++; return k; }
  /** Stop a moving unit where it is at `t`: trims its recorded leg to the driven part. */
  private stopAt(u: Unit, t: number): void {
    if (!u.route) return;
    const k = this.reached(u, t); u.cell = u.route[k];
    if (u.leg) { u.leg.path = u.route.slice(0, k + 1); u.leg.to = u.cell; if (u.leg.path.length < 2) { const i = this.legs.indexOf(u.leg); if (i >= 0) { this.legs.splice(i, 1); this.totals.legs--; if (!u.leg.loaded) this.totals.emptyLegs--; } } }
    u.route = u.at = u.leg = undefined;
  }
  /** Replace the network after a road edit or new congested times. Every moving unit's remaining route
   *  is re-checked link by link; a gone link stops it at its current cell and it replans from there. */
  setNetwork(net: LinkNetwork, times: ReadonlyMap<string, number>): void {
    this.net = net; this.times = times; this.trees.clear(); this.zones = this.computeZones();
    const t = this.cursor;
    for (const u of [...this.units].sort((a, b) => (a.id < b.id ? -1 : 1))) {
      if (!u.route || u.state === 'stranded') continue;
      const k = this.reached(u, t), r = u.route;
      let ok = true; for (let i = k + 1; i < r.length; i++) if (!net.links.has(linkKey(r[i - 1], r[i]))) { ok = false; break; }
      if (ok) continue;
      this.totals.replans++;
      const state = u.state, target = u.target!; this.stopAt(u, t);
      if (state === 'roaming') { u.state = 'idle'; u.target = undefined; continue; } // replans next quantum from here
      this.go(u, target, state, t, state === 'riding' ? TAXI_DWELL_MIN : state === 'toPickup' ? TAXI_DWELL_MIN : 0, state === 'riding');
    }
  }
  advanceTo(minute: number, paused = false): void {
    if (paused) return;
    while (this.cursor + TAXI_QUANTUM_MIN <= minute) { this.cursor += TAXI_QUANTUM_MIN; this.quantum(this.cursor); }
  }
  private drive(u: Unit, path: number[], loaded: boolean, t: number, state: State, dwell: number): void {
    const at = [t]; for (let i = 1; i < path.length; i++) at.push(at[i - 1] + (this.times.get(linkKey(path[i - 1], path[i])) ?? Infinity) / 60);
    for (let i = 0; i < path.length; i++) this.lastSeen.set(path[i], at[i]);
    u.state = state; u.target = path.at(-1)!; u.route = path; u.at = at; u.leg = undefined;
    u.until = t + Math.max(path.length > 1 ? 1 : 0, Math.ceil(at.at(-1)! - t + dwell));
    if (path.length > 1) { const leg = { unitId: u.id, from: path[0], to: u.target, loaded, minute: t, path }; this.legs.push(leg); u.leg = leg; this.totals.legs++; if (!loaded) this.totals.emptyLegs++; }
  }
  private go(u: Unit, to: number, state: State, t: number, dwell: number, loaded: boolean): void {
    const path = Number.isFinite(this.minutes(u.cell, to)) ? treePath(this.tree(u.cell), to) : null;
    if (!path) { u.state = 'stranded'; u.resume = state; u.target = to; u.route = u.at = u.leg = undefined; return; }
    this.drive(u, path, loaded, t, state, dwell);
  }
  private quantum(t: number): void {
    // 1. Arrivals; stranded units resume from where they stopped.
    for (const u of this.units) {
      if (u.state === 'stranded' && u.target !== undefined && Number.isFinite(this.minutes(u.cell, u.target))) {
        const resume = u.resume!; this.go(u, u.target, resume, t, resume === 'home' ? 0 : TAXI_DWELL_MIN, resume === 'riding');
      }
      if (u.state === 'stranded' || u.state === 'idle' || u.until > t) continue;
      u.cell = u.target!; u.route = u.at = u.leg = undefined;
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
    // 3. Local decisions by free taxis (idle, roaming or heading home; id order), from their current
    //    position along the route: oldest reachable request within the ETA radius (tie → nearer → part).
    const free = this.units.filter(u => u.state === 'idle' || u.state === 'roaming' || u.state === 'home').sort((a, b) => (a.id < b.id ? -1 : 1));
    const taken = new Set<Job>();
    for (const u of free) {
      const here = u.route ? u.route[this.reached(u, t)] : u.cell;
      let pick: Job | null = null, eta = Infinity;
      for (const j of this.waiting) {
        if (j.minute > t || taken.has(j)) continue;
        const m = this.minutes(here, j.from);
        if (!(m <= TAXI_LOCAL_RADIUS_MIN + 1e-9) || t + m - j.minute > TAXI_MAX_WAIT_MIN) continue;
        if (!pick || j.minute < pick.minute || (j.minute === pick.minute && (m < eta - 1e-9 || (Math.abs(m - eta) <= 1e-9 && j.part < pick.part)))) { pick = j; eta = m; }
      }
      if (!pick) continue;
      if (u.route) { this.stopAt(u, t); this.totals.interrupted++; }
      taken.add(pick);
      const wait = t - pick.minute + eta; this.waits.push(wait); this.totals.waitMinutesSum += wait * pick.persons; this.totals.pickups += pick.persons;
      u.job = pick;
      if (u.cell === pick.from) this.go(u, pick.to, 'riding', t, TAXI_DWELL_MIN, true);
      else this.go(u, pick.from, 'toPickup', t, TAXI_DWELL_MIN, false);
    }
    this.waiting = this.waiting.filter(j => !taken.has(j));
    // 4. Idle taxis: go home at night / near-zero demand; otherwise roam (RRT) only if the best branch
    //    Service hours: idle taxis always cruise (chained RRT legs ≤ 15 min) over the whole road network,
    //    toward demand plus not-recently-visited cells, discounted by nearby claimed supply. Home only at
    //    night or when the city has zero demand; park only if no legal move exists.
    this.origins = this.origins.filter(o => t - o.minute < TAXI_DEMAND_WINDOW_MIN);
    const mod = ((t % 1440) + 1440) % 1440, night = mod >= TAXI_NIGHT.from || mod < TAXI_NIGHT.to;
    const w = this.demandWeights(t), total = [...w.values()].reduce((a, b) => a + b, 0), mean = total / Math.max(1, this.zones.size);
    const W = this.width, ordered = [...this.units].sort((a, b) => (a.id < b.id ? -1 : 1));
    const claimOf = (x: Unit) => (x.state === 'idle' ? x.cell : x.state === 'roaming' ? x.target ?? x.cell : -1);
    const claims = new Map<Unit, number>(); for (const x of ordered) { const c = claimOf(x); if (c >= 0) claims.set(x, c); }
    const crowd = (self: Unit, c: number) => { let n = 0; const cx = c % W, cy = Math.floor(c / W); for (const [x, k] of claims) if (x !== self && Math.abs(k % W - cx) + Math.abs(Math.floor(k / W) - cy) <= TAXI_SPREAD_RADIUS) n++; return n; };
    const explore = (c: number) => TAXI_EXPLORE_WEIGHT * mean * Math.min(1, (t - (this.lastSeen.get(c) ?? -Infinity)) / TAXI_EXPLORE_HORIZON_MIN);
    const stale = [...this.net.out.keys()].filter(c => !(t - (this.lastSeen.get(c) ?? -Infinity) < TAXI_EXPLORE_HORIZON_MIN));
    const targets = [...new Set([...w.keys(), ...stale])];
    for (const u of ordered) if (u.state === 'idle') {
      const home = this.depots.find(d => d.id === u.depotId)!.cell;
      if (night || !(total > 0)) { claims.delete(u); if (u.cell !== home) this.go(u, home, 'home', t, 0, false); continue; }
      const memo = new Map<number, number>(), weight = (c: number) => { let v = memo.get(c); if (v === undefined) memo.set(c, v = ((w.get(c) ?? 0) + explore(c)) / (1 + crowd(u, c))); return v; };
      const plan = planRoam(this.net, this.times, u.cell, { seed: this.seed, taxiId: u.id, period: Math.floor(t / 60), width: this.width, weight, demandCells: targets });
      if (plan.path.length < 2) { this.totals.parked++; continue; }
      this.drive(u, plan.path, false, t, 'roaming', 0); claims.set(u, u.target!); this.totals.roamLegs++; this.totals.roamMinutes += plan.minutes;
    }
  }
  private demandWeights(t: number): Map<number, number> {
    const w = new Map<number, number>();
    if (this.expected) { for (const c of [...this.zones.keys()].sort((a, b) => a - b)) { const v = this.expected(c, t); if (v > 0) w.set(c, v); } return w; }
    for (const o of this.origins) w.set(o.cell, (w.get(o.cell) ?? 0) + o.persons);
    return w;
  }
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
