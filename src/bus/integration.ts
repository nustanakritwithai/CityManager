/**
 * Bus ↔ game integration (PR B5). Created ONLY when `busEnabled()` (BUS_ENABLED or `?bus=1`).
 * Flag off → nothing is constructed and the traffic clock gets no demand filter: identical game.
 *
 * Per traffic period: OD → `splitModeDemand` (bus cost from `busAccess` + `busRideMinutes`) →
 * bus masses `engine.submit`; taxi + road people stay on the road OD (taxi is not split off here:
 * the taxi engine is not wired in the host yet, so those people remain private cars as today).
 * Released riders (`release` callback) are queued and re-added to the next period's car OD.
 * Conservation: offered = road + busAccepted; busAccepted = waiting + onboard + completed + released;
 * released = returnedToCar + pendingReturn.
 */
import { busLineRoutes } from './lines.ts';
import { BusEngine, busRideMinutes } from './engine.ts';
import { busAccess, splitModeDemand, type ModeCarry } from './mode-share.ts';
import { createBusTrafficHook } from './traffic-hook.ts';
import { PEOPLE_PER_VEHICLE, type OdEntry, type TripPurpose } from '../traffic/types.ts';
import type { BusHost } from './lines.ts';
import type { BusOdCost } from './types.ts';

type Od = { purpose: TripPurpose; from: number; to: number };
export type BusIntegrationOptions = { width: number; carMinutes?: (from: number, to: number) => number; maxWaitMinutes?: number };
const key = (o: Od) => `${o.purpose}:${o.from}:${o.to}`;

export class BusIntegration {
  readonly engine: BusEngine; readonly hook = createBusTrafficHook();
  private carry: ModeCarry = { bus: {}, taxi: {} }; private seq = 0;
  private reqs = new Map<string, Od>(); private pending = new Map<string, { od: Od; persons: number }>();
  totals = { offered: 0, road: 0, bus: 0, returnedToCar: 0 };
  private readonly host: BusHost; private readonly o: BusIntegrationOptions;
  constructor(host: BusHost, startMinute: number, o: BusIntegrationOptions) {
    this.host = host; this.o = o;
    this.engine = new BusEngine(host, startMinute, { maxWaitMinutes: o.maxWaitMinutes, release: (id, persons) => this.release(id, persons) });
  }
  private release(id: string, persons: number) {
    const od = this.reqs.get(id); if (!od) throw Error(`Unknown bus request ${id}`);
    const k = key(od), p = this.pending.get(k); if (p) p.persons += persons; else this.pending.set(k, { od, persons });
  }
  get pendingReturn() { let n = 0; for (const p of this.pending.values()) n += p.persons; return n; }
  private carMinutes(from: number, to: number) {
    if (this.o.carMinutes) return this.o.carMinutes(from, to);
    const w = this.o.width; return (Math.abs(from % w - to % w) + Math.abs(Math.floor(from / w) - Math.floor(to / w))) * .5;
  }
  private busCost(from: number, to: number): BusOdCost | null {
    const b = this.host.bus; if (!b) return null;
    const a = busAccess(from, to, b.stops, b.lines, this.o.width); if (!a) return null;
    const r = busLineRoutes(this.host).find(x => x.lineId === a.lineId), line = b.lines.find(l => l.id === a.lineId);
    if (!r || !line || r.status !== 'running' || r.headwayMinutes === null) return null;
    const ride = busRideMinutes(r, line.stopIds, a.fromStopId, a.toStopId); if (ride === null) return null;
    return { lineId: a.lineId, fromStopId: a.fromStopId, toStopId: a.toStopId, walkMinutes: a.walkMinutes, waitMinutes: r.headwayMinutes / 2, rideMinutes: ride, seats: Number.MAX_SAFE_INTEGER };
  }
  /** Traffic-clock demand filter: returns the car OD for this period (bus riders removed, released riders added back). */
  filter(od: readonly OdEntry[], minute: number): OdEntry[] {
    this.engine.advanceTo(minute);
    const s = splitModeDemand(od, { car: (f, t) => this.carMinutes(f, t), taxi: () => null, bus: (f, t) => this.busCost(f, t) }, this.carry);
    this.carry = s.carry;
    const subs = s.bus.map(m => { const requestId = `bus-${++this.seq}`; this.reqs.set(requestId, { purpose: m.purpose, from: m.from, to: m.to }); return { ...m, requestId }; });
    this.engine.submit(subs, minute); // may release at once (out of service etc.) → pending
    const road = new Map<string, { od: Od; persons: number }>();
    const add = (o: Od, p: number) => { const k = key(o), x = road.get(k); if (x) x.persons += p; else road.set(k, { od: o, persons: p }); };
    for (const r of s.roadPersons) add(r, r.persons);
    // ODs that went 100% bus must still keep their row (with 0) only if present; add released riders.
    let back = 0; for (const p of this.pending.values()) { add(p.od, p.persons); back += p.persons; } this.pending.clear();
    this.totals.offered += s.offeredPersons; this.totals.bus += s.busPersons; this.totals.road += s.offeredPersons - s.busPersons; this.totals.returnedToCar += back;
    return [...road.values()].map(({ od: o, persons }) => ({ purpose: o.purpose, from: o.from, to: o.to, vehicles: persons / PEOPLE_PER_VEHICLE }));
  }
  /** Every game tick/frame: advance buses and feed the (no-op) road hook. */
  tick(minute: number): void { this.engine.advanceTo(minute); this.hook.push(minute, () => this.engine.roadLoad(minute)); }
  ledger() {
    const e = this.engine.ledger();
    return { ...this.totals, engine: e, pendingReturn: this.pendingReturn,
      conservationError: this.totals.offered - this.totals.road - e.waiting - e.onboard - e.completed - e.released,
      releaseError: e.released - this.totals.returnedToCar - this.pendingReturn };
  }
}
