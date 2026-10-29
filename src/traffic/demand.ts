import { PEOPLE_PER_VEHICLE, type DemandCarry, type DemandInput, type DemandResult, type DemandSource, type OdEntry, type TripPurpose } from './types.ts';

/** Share of daily trips of each purpose that start in a given hour (0..23). Each profile sums to 1. */
const norm = (w: number[]) => { const s = w.reduce((a, b) => a + b, 0); return w.map(x => x / s); };
export const HOURLY_PROFILE: Record<TripPurpose, readonly number[]> = {
  // AM peak 7-8 out, PM peak 17-18 back (each person 2 commute trips/day).
  commute: norm([0,0,0,0,0,1,4,12,10,3,2,2,2,2,2,3,6,12,10,4,2,1,0,0]),
  school: norm([0,0,0,0,0,0,2,12,6,1,0,0,1,1,2,10,4,1,0,0,0,0,0,0]),
  park: norm([0,0,0,0,0,0,1,2,3,4,5,6,6,6,6,6,6,6,5,4,3,1,0,0]),
  freight: norm([0,0,0,0,1,2,4,6,7,7,7,7,6,6,6,6,5,4,3,2,1,0,0,0]),
};
/** Daily trips per person (both directions counted). */
export const TRIP_RATE = { commute: 2, school: 2, park: .3 } as const;
/** Fraction of residents who are school-age, and freight units per truck-equivalent vehicle. */
export const SCHOOL_SHARE = .2, FREIGHT_UNITS_PER_VEHICLE = PEOPLE_PER_VEHICLE;

const total = (s: DemandSource[]) => s.reduce((a, x) => a + Math.max(0, x.amount), 0);
/** Gravity-free proportional split: each origin sends to destinations in proportion to their size. */
function distribute(origins: DemandSource[], dests: DemandSource[], people: number, purpose: TripPurpose, out: Map<string, OdEntry & { raw: number }>, reverse: boolean) {
  const to = total(origins), td = total(dests);
  if (!to || !td || people <= 0) return;
  for (const o of origins) for (const d of dests) {
    if (o.amount <= 0 || d.amount <= 0) continue;
    const raw = people * (o.amount / to) * (d.amount / td) / PEOPLE_PER_VEHICLE;
    const from = reverse ? d.cell : o.cell, dest = reverse ? o.cell : d.cell;
    const key = `${purpose}:${from}:${dest}`, e = out.get(key);
    if (e) e.raw += raw; else out.set(key, { from, to: dest, purpose, vehicles: 0, raw });
  }
}
/** Morning hours send home→destination; afternoon/evening send destination→home. */
const outbound = (hour: number) => hour < 12;

/**
 * Representative-vehicle OD matrix for one analysis period (game hour 0..23).
 * Deterministic. Call exactly once per elapsed period — at 10× speed the caller iterates the
 * periods passed; demand never depends on tick rate, so nothing is double counted. Fractional
 * vehicles carry over in `carry` (integer-safe: cumulative vehicles = floor(cumulative raw)).
 */
export function periodDemand(input: DemandInput, hour: number, carry: DemandCarry = {}): DemandResult {
  const h = ((Math.floor(hour) % 24) + 24) % 24, raw = new Map<string, OdEntry & { raw: number }>();
  const residents = total(input.households), out = outbound(h);
  const workers = Math.min(residents, total(input.jobs));
  distribute(input.households, input.jobs, workers * TRIP_RATE.commute * HOURLY_PROFILE.commute[h], 'commute', raw, !out);
  const pupils = Math.min(residents * SCHOOL_SHARE, total(input.schoolSeats));
  distribute(input.households, input.schoolSeats, pupils * TRIP_RATE.school * HOURLY_PROFILE.school[h], 'school', raw, !out);
  distribute(input.households, input.parks, residents * TRIP_RATE.park * HOURLY_PROFILE.park[h], 'park', raw, h >= 14);
  // Freight: half inbound from the entrance, half outbound, spread by hourly profile.
  const gate = [{ cell: input.entrance, amount: 1 }], units = total(input.freight) * HOURLY_PROFILE.freight[h] * PEOPLE_PER_VEHICLE / FREIGHT_UNITS_PER_VEHICLE;
  distribute(gate, input.freight, units / 2, 'freight', raw, false);
  distribute(gate, input.freight, units / 2, 'freight', raw, true);
  const next: DemandCarry = {}, od: OdEntry[] = [];
  for (const key of new Set([...raw.keys(), ...Object.keys(carry)])) {
    const v = (raw.get(key)?.raw ?? 0) + (carry[key] ?? 0), whole = Math.floor(v + 1e-9), rest = v - whole;
    if (rest > 1e-9) next[key] = rest;
    if (whole > 0) { const [purpose, from, to] = key.split(':'); od.push({ from: +from, to: +to, purpose: purpose as TripPurpose, vehicles: whole }); }
  }
  od.sort((a, b) => a.purpose.localeCompare(b.purpose) || a.from - b.from || a.to - b.to);
  return { hour: h, od, carry: next };
}
/** Run consecutive periods (e.g. after accelerated time) without double counting. */
export function demandForPeriods(input: DemandInput, startHour: number, periods: number, carry: DemandCarry = {}): DemandResult[] {
  const out: DemandResult[] = [];
  for (let i = 0; i < periods; i++) { const r = periodDemand(input, startHour + i, carry); carry = r.carry; out.push(r); }
  return out;
}
export const totalVehicles = (od: OdEntry[], purpose?: TripPurpose) => od.reduce((a, e) => a + (!purpose || e.purpose === purpose ? e.vehicles : 0), 0);
