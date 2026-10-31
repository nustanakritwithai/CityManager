import { collectTaxiFares, type City } from '../sim.ts';

/**
 * Accrues completed taxi trips in memory and credits them to the treasury as ONE integer
 * 'Taxi fares' ledger entry when the in-game day changes. Posting per frame (#153) grew the
 * ledger by an entry for every frame a trip completed.
 */
export type TaxiFareAccumulator = {
  /** `counter` is the traffic game's cumulative {trips,tiles}; `accrue` false while paused/preview/recovery. Returns satang posted this call. */
  observe(city: City, counter: { trips: number; tiles: number }, accrue: boolean): number;
  pending(): { trips: number; tiles: number };
};
export function createTaxiFareAccumulator(): TaxiFareAccumulator {
  let bound: City | null = null, seen = { trips: 0, tiles: 0 }, pending = { trips: 0, tiles: 0 }, tick = -1;
  return {
    observe(city, counter, accrue) {
      const t = { trips: Math.max(0, Math.floor(counter.trips)), tiles: Math.max(0, Math.floor(counter.tiles)) };
      if (bound !== city) { bound = city; seen = t; pending = { trips: 0, tiles: 0 }; tick = city.tick; return 0; }
      if (t.trips < seen.trips || t.tiles < seen.tiles) seen = { trips: 0, tiles: 0 }; // traffic game reset
      if (accrue && t.trips > seen.trips) { pending.trips += t.trips - seen.trips; pending.tiles += Math.max(0, t.tiles - seen.tiles); }
      seen = t;
      if (city.tick === tick) return 0;
      tick = city.tick;
      const due = pending; pending = { trips: 0, tiles: 0 };
      return accrue && due.trips > 0 ? collectTaxiFares(city, due.trips, due.tiles) : 0;
    },
    pending: () => ({ ...pending }),
  };
}
