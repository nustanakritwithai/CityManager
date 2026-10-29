/**
 * Aggregate, demand-based traffic model (representative vehicles, not per-citizen).
 * One representative vehicle stands for PEOPLE_PER_VEHICLE people (or freight units).
 * Read-only over city state; nothing here enters a save.
 */
export const PEOPLE_PER_VEHICLE = 10;
/** Analysis period length, in game hours. Demand is computed once per period. */
export const PERIOD_HOURS = 1;
export type TripPurpose = 'commute' | 'school' | 'park' | 'freight';
/** A zone is a grid cell index (0..575) that generates or attracts trips. */
export type Zone = number;
export type DemandSource = { cell: Zone; amount: number };
/** Pure, save-independent snapshot of what generates traffic. */
export type DemandInput = {
  households: DemandSource[];   // amount = residents
  jobs: DemandSource[];         // amount = job slots
  schoolSeats: DemandSource[];  // amount = seats
  parks: DemandSource[];        // amount = attractiveness/capacity
  freight: DemandSource[];      // amount = goods units/day to or from the city entrance
  entrance: Zone;
};
export type OdEntry = { from: Zone; to: Zone; purpose: TripPurpose; vehicles: number };
/** Fractional vehicle remainder per OD key, carried to the next period so totals never drift. */
export type DemandCarry = Record<string, number>;
export type DemandResult = { hour: number; od: OdEntry[]; carry: DemandCarry };
