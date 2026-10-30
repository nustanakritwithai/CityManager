import { PEOPLE_PER_VEHICLE, type OdEntry, type TripPurpose } from '../traffic/types.ts';
import { PARKING_PENALTY_MIN, TAXI_PURPOSES, TAXI_THETA, VALUE_OF_TIME_SATANG_PER_MIN, type TaxiCarry, type TaxiOdCost, type TaxiRequestMass } from '../taxi/types.ts';
import { taxiFareSatang, taxiShare } from '../taxi/mode-share.ts';
import { BUS_AVAILABILITY_CAP, BUS_FARE_SATANG, BUS_PURPOSES, BUS_RIDE_PENALTY_MIN, BUS_WALK_MIN_PER_CELL, BUS_WALK_RADIUS, type BusLine, type BusOdCost, type BusRequestMass, type BusStop } from './types.ts';
/**
 * 3-way car / taxi / bus choice (PR B1). Bus share = multinomial logit over car, taxi, bus utilities
 * (same θ, VOT and parking penalty as taxi), capped by BUS_AVAILABILITY_CAP and by whole seats. Taxi
 * then takes its unchanged binary-logit share of the people who did not choose bus, so with no bus
 * offered the taxi result is identical to `splitTaxiDemand`.
 */
const manhattan = (a: number, b: number, w: number) => Math.abs((a % w) - (b % w)) + Math.abs(Math.floor(a / w) - Math.floor(b / w));
/** Nearest stops on one common line within walk radius of both ends (ties: lower walk → line id → stop ids). */
export function busAccess(from: number, to: number, stops: readonly BusStop[], lines: readonly BusLine[], width: number, radius = BUS_WALK_RADIUS) {
  if (!Number.isSafeInteger(width) || width < 1) throw RangeError('busAccess needs the map width');
  const byId = new Map(stops.map(s => [s.id, s]));
  let best: { lineId: number; fromStopId: number; toStopId: number; walkCells: number; walkMinutes: number } | null = null;
  for (const l of [...lines].sort((a, b) => a.id - b.id)) {
    if (l.busCount < 1) continue;
    const on = [...new Set(l.stopIds)].map(id => byId.get(id)).filter((s): s is BusStop => !!s).sort((a, b) => a.id - b.id);
    for (const a of on) { const da = manhattan(from, a.cell, width); if (da > radius) continue;
      for (const b of on) { if (b.id === a.id) continue; const db = manhattan(to, b.cell, width); if (db > radius) continue;
        const walk = da + db;
        if (!best || walk < best.walkCells) best = { lineId: l.id, fromStopId: a.id, toStopId: b.id, walkCells: walk, walkMinutes: walk * BUS_WALK_MIN_PER_CELL };
      } }
  }
  return best;
}
export const busFareSatang = (c: BusOdCost) => Math.max(0, Math.round(c.fareSatang ?? BUS_FARE_SATANG));
/** Multinomial-logit bus share in [0, BUS_AVAILABILITY_CAP]; `taxi` null = taxi not offered. */
export function busShare(carMinutes: number, bus: BusOdCost, taxi: TaxiOdCost | null = null): number {
  const bt = [bus.walkMinutes, bus.waitMinutes, bus.rideMinutes];
  if (!Number.isFinite(carMinutes) || !bt.every(Number.isFinite)) return 0;
  const uCar = -(carMinutes + PARKING_PENALTY_MIN);
  const uBus = -(bt[0] + bt[1] + bt[2] + BUS_RIDE_PENALTY_MIN + busFareSatang(bus) / VALUE_OF_TIME_SATANG_PER_MIN);
  const alts = [uCar, uBus];
  if (taxi && [taxi.taxiMinutes, taxi.waitMinutes].every(Number.isFinite)) alts.push(-(taxi.waitMinutes + taxi.taxiMinutes + taxiFareSatang(taxi.km, taxi.taxiMinutes) / VALUE_OF_TIME_SATANG_PER_MIN));
  const m = Math.max(...alts), denom = alts.reduce((s, u) => s + Math.exp(TAXI_THETA * (u - m)), 0);
  return BUS_AVAILABILITY_CAP * Math.exp(TAXI_THETA * (uBus - m)) / denom;
}
export type ModeCarry = { bus: Record<string, number>; taxi: TaxiCarry };
export type RoadMass = { purpose: TripPurpose; from: number; to: number; persons: number };
export type ModeSplit = { bus: BusRequestMass[]; taxi: TaxiRequestMass[]; roadPersons: RoadMass[]; offeredPersons: number; busPersons: number; taxiPersons: number; carry: ModeCarry };
/**
 * Split one period's OD into whole bus, taxi and road people. Conserved per OD:
 * bus + taxi + road = offered. Fractions carry per `purpose:from:to` for each mode (1× = 10×).
 * When the seat cap binds, the bus remainder is dropped (no backlog of phantom riders).
 * `carMinutes` is required whenever bus or taxi is offered (taxi cost carries it too).
 */
export function splitModeDemand(od: readonly OdEntry[], costs: { car: (from: number, to: number) => number; taxi: (from: number, to: number) => TaxiOdCost | null; bus: (from: number, to: number) => BusOdCost | null }, carry: ModeCarry = { bus: {}, taxi: {} }): ModeSplit {
  const next: ModeCarry = { bus: { ...carry.bus }, taxi: { ...carry.taxi } };
  const out: ModeSplit = { bus: [], taxi: [], roadPersons: [], offeredPersons: 0, busPersons: 0, taxiPersons: 0, carry: next };
  for (const e of [...od].sort((a, b) => a.purpose.localeCompare(b.purpose) || a.from - b.from || a.to - b.to)) {
    const persons = e.vehicles * PEOPLE_PER_VEHICLE, key = `${e.purpose}:${e.from}:${e.to}`;
    out.offeredPersons += persons;
    const t = TAXI_PURPOSES.has(e.purpose) && e.from !== e.to ? costs.taxi(e.from, e.to) : null;
    const b = BUS_PURPOSES.has(e.purpose) && e.from !== e.to ? costs.bus(e.from, e.to) : null;
    let bus = 0, taxi = 0, fare = 0;
    if (b && persons > 0) {
      const car = t ? t.carMinutes : costs.car(e.from, e.to);
      const exact = persons * busShare(car, b, t) + (next.bus[key] ?? 0), seats = Math.max(0, Math.floor(b.seats));
      bus = Math.min(persons, seats, Math.floor(exact + 1e-9));
      const rest = exact - bus; if (bus < seats && rest > 1e-9) next.bus[key] = rest; else delete next.bus[key];
      if (bus > 0) out.bus.push({ purpose: e.purpose, from: e.from, to: e.to, persons: bus, lineId: b.lineId, fromStopId: b.fromStopId, toStopId: b.toStopId, fareSatang: busFareSatang(b) });
    }
    const left = persons - bus;
    if (t && left > 0) {
      fare = taxiFareSatang(t.km, t.taxiMinutes);
      const exact = left * taxiShare(t, fare) + (next.taxi[key] ?? 0);
      taxi = Math.min(left, Math.floor(exact + 1e-9));
      const rest = exact - taxi; if (rest > 1e-9) next.taxi[key] = rest; else delete next.taxi[key];
    }
    if (taxi > 0) out.taxi.push({ purpose: e.purpose, from: e.from, to: e.to, persons: taxi, fareSatang: fare });
    if (left - taxi > 0) out.roadPersons.push({ purpose: e.purpose, from: e.from, to: e.to, persons: left - taxi });
    out.busPersons += bus; out.taxiPersons += taxi;
  }
  return out;
}
