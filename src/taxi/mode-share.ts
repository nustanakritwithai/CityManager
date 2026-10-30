import { PEOPLE_PER_VEHICLE, type OdEntry } from '../traffic/types.ts';
import { PARKING_PENALTY_MIN, TAXI_AVAILABILITY_CAP, TAXI_FARE, TAXI_PURPOSES, TAXI_THETA, VALUE_OF_TIME_SATANG_PER_MIN, type TaxiCarry, type TaxiOdCost, type TaxiSplit } from './types.ts';

/** Shadow fare per person in integer satang. */
export const taxiFareSatang = (km: number, minutes: number) => Math.round(TAXI_FARE.flagFall + TAXI_FARE.perKm * Math.max(0, km) + TAXI_FARE.perMinute * Math.max(0, minutes));
/** Binary logit taxi share in [0, TAXI_AVAILABILITY_CAP]. Deterministic, no RNG. */
export function taxiShare(cost: TaxiOdCost, fareSatang = taxiFareSatang(cost.km, cost.taxiMinutes)): number {
  if (![cost.carMinutes, cost.taxiMinutes, cost.waitMinutes].every(Number.isFinite)) return 0;
  const uCar = -(cost.carMinutes + PARKING_PENALTY_MIN), uTaxi = -(cost.waitMinutes + cost.taxiMinutes + fareSatang / VALUE_OF_TIME_SATANG_PER_MIN);
  return TAXI_AVAILABILITY_CAP / (1 + Math.exp(-TAXI_THETA * (uTaxi - uCar)));
}
/**
 * Split one period's OD (representative vehicles) into whole taxi people and remaining road people.
 * Fractions carry per purpose/OD, so cumulative taxi people = floor(Σ exact) regardless of how
 * periods are batched (1× vs 10×). Conserved: taxiPersons + Σ roadPersons = offeredPersons.
 * `cost` returns null when no taxi is offered (outside coverage / unreachable) → all stay on road.
 */
export function splitTaxiDemand(od: readonly OdEntry[], cost: (from: number, to: number) => TaxiOdCost | null, carry: TaxiCarry = {}): TaxiSplit {
  const next: TaxiCarry = { ...carry }, out: TaxiSplit = { taxi: [], roadPersons: [], offeredPersons: 0, taxiPersons: 0, carry: next };
  for (const e of [...od].sort((a, b) => a.purpose.localeCompare(b.purpose) || a.from - b.from || a.to - b.to)) {
    const persons = e.vehicles * PEOPLE_PER_VEHICLE, key = `${e.purpose}:${e.from}:${e.to}`;
    out.offeredPersons += persons;
    const c = TAXI_PURPOSES.has(e.purpose) && e.from !== e.to ? cost(e.from, e.to) : null;
    let taxi = 0, fare = 0;
    if (c && persons > 0) {
      fare = taxiFareSatang(c.km, c.taxiMinutes);
      const exact = persons * taxiShare(c, fare) + (next[key] ?? 0);
      taxi = Math.min(persons, Math.floor(exact + 1e-9));
      const rest = exact - taxi; if (rest > 1e-9) next[key] = rest; else delete next[key];
    }
    if (taxi > 0) out.taxi.push({ purpose: e.purpose, from: e.from, to: e.to, persons: taxi, fareSatang: fare });
    if (persons - taxi > 0) out.roadPersons.push({ purpose: e.purpose, from: e.from, to: e.to, persons: persons - taxi });
    out.taxiPersons += taxi;
  }
  return out;
}
