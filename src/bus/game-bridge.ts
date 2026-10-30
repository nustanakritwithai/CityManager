/**
 * Main-thread bus host for #126's worker traffic game (replaces the old TrafficClock wiring of
 * #132/#133). Created by TrafficLayer only when `busEnabled()` (BUS_ENABLED or `?bus=1`).
 *
 * - Owns the pure `BusEngine` (renderer contract: `trafficLayer.bus.engine` → snapshot(),
 *   waitingAt(), drainEvents() — the latter ONLY via `presentBuses`, fanned out by subscribeBusEvents).
 * - `input()` → `GameBusInput` sent with each worker job: stops/lines/ride table, current bus road
 *   load (2 PCU per moving bus, replaced every call via the #133 sink) and cumulative releases.
 * - `onFrame(frame)` turns the game's cumulative per-OD bus totals into whole riders (fraction carried)
 *   and calls `engine.submit`. `release` adds riders to the cumulative car returns the game injects.
 * Conservation (persons): diverted = submitted + carry; submitted = waiting + onboard + completed + released;
 * released = injected (by the game) + pendingReturn.
 */
import { BusEngine, busRideMinutes } from './engine.ts';
import { busLineRoutes, busServiceOrder, type BusHost } from './lines.ts';
import { createBusTrafficHook } from './traffic-hook.ts';
import { createBusLoadSink } from '../traffic/bridge.ts';
import { GAME_BUS_PERSONS_PER_RATE, type GameBusFrame, type GameBusInput, type GameBusLine } from './game-bus.ts';

export class BusGameBridge {
  readonly engine: BusEngine; readonly hook = createBusTrafficHook();
  private readonly host: BusHost; private load: ReadonlyMap<string, number> = new Map();
  private seen = new Map<string, number>(); private carry = new Map<string, number>(); private seq = 0;
  private reqs = new Map<string, string>(); private returns: Record<string, number> = {}; private injected: Record<string, number> = {};
  private cfgKey = ''; private cfg: Pick<GameBusInput, 'stops' | 'lines'> = { stops: [], lines: [] };
  totals = { diverted: 0, submitted: 0, returned: 0 };
  constructor(host: BusHost, minute: number) {
    this.host = host;
    this.engine = new BusEngine(host, minute, { release: (id, persons) => { const k = this.reqs.get(id); if (k === undefined) throw Error(`Unknown bus request ${id}`); this.returns[k] = (this.returns[k] ?? 0) + persons / GAME_BUS_PERSONS_PER_RATE; this.totals.returned += persons; } });
    this.hook.connect(createBusLoadSink(load => { this.load = load; }));
  }
  private config(): Pick<GameBusInput, 'stops' | 'lines'> {
    const b = this.host.bus, key = JSON.stringify([b ?? null, this.host.cells.map(c => c.road ? 1 : 0).join(''), (this.host as { roadTopology?: unknown }).roadTopology ?? null]);
    if (key === this.cfgKey) return this.cfg;
    const lines: GameBusLine[] = [];
    for (const r of b ? busLineRoutes(this.host) : []) {
      const line = b!.lines.find(l => l.id === r.lineId); if (!line || r.status !== 'running' || r.headwayMinutes === null) continue;
      const ride: Record<string, number> = {}, ids = [...new Set(busServiceOrder(line.stopIds))];
      for (const f of ids) for (const t of ids) if (f !== t) { const m = busRideMinutes(r, line.stopIds, f, t); if (m !== null) ride[`${f}:${t}`] = m; }
      lines.push({ line: structuredClone(line), waitMinutes: r.headwayMinutes / 2, ride });
    }
    this.cfgKey = key; this.cfg = { stops: structuredClone(b?.stops ?? []), lines }; return this.cfg;
  }
  /** Plain-data bus section for the next worker job. */
  input(): GameBusInput { return { ...this.config(), load: Object.fromEntries(this.load), returns: { ...this.returns } }; }
  /** Accept one committed game frame: submit newly diverted riders (whole people, fraction carried). */
  onFrame(frame: GameBusFrame | undefined, minute: number): void {
    if (!frame) return;
    this.injected = { ...frame.injected };
    const subs = [];
    for (const t of frame.totals) {
      const key = `${t.from}:${t.to}:${t.lineId}:${t.fromStopId}:${t.toStopId}`, delta = t.total - (this.seen.get(key) ?? 0);
      if (delta <= 1e-12) continue; this.seen.set(key, t.total);
      const exact = delta * GAME_BUS_PERSONS_PER_RATE + (this.carry.get(key) ?? 0), whole = Math.floor(exact + 1e-9);
      this.carry.set(key, exact - whole); this.totals.diverted += delta * GAME_BUS_PERSONS_PER_RATE;
      if (whole > 0) { const requestId = `bg-${++this.seq}`; this.reqs.set(requestId, `${t.from}:${t.to}`); subs.push({ requestId, purpose: 'commute' as const, from: t.from, to: t.to, persons: whole, lineId: t.lineId, fromStopId: t.fromStopId, toStopId: t.toStopId, fareSatang: 0 }); this.totals.submitted += whole; }
    }
    if (subs.length) this.engine.submit(subs, Math.max(minute, this.engine.now));
  }
  /** Every render frame: advance buses to the game minute and push the road load (replace semantics). */
  tick(minute: number): void { if (minute > this.engine.now) this.engine.advanceTo(minute); this.hook.push(this.engine.now, () => this.engine.roadLoad(this.engine.now)); }
  get pendingReturn() { let n = 0; for (const [k, v] of Object.entries(this.returns)) n += v - (this.injected[k] ?? 0); return n * GAME_BUS_PERSONS_PER_RATE; }
  ledger() {
    const e = this.engine.ledger(), carry = [...this.carry.values()].reduce((a, b) => a + b, 0);
    return { ...this.totals, carry, engine: e, pendingReturn: this.pendingReturn,
      splitError: this.totals.diverted - this.totals.submitted - carry,
      engineError: e.conservationError, releaseError: e.released - this.totals.returned };
  }
}
