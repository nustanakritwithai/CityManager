/** Municipal parks: integer satang, one parcel at every future level.
 * Initial balance values for review. This first slice supports level 1 only;
 * it has no service coverage or economic bonuses. Staffing is real residual labour.
 */
import type { WorkerSkill } from './labor.ts';
export type ParkAllocation = { householdId: number; parkId: number; skill: WorkerSkill; workers: number };
export type Park = { id: number; cell: number; tick: number; level: 1; staffing?: { allocations: ParkAllocation[]; workDays: Record<string, number> } };
export const PARK = Object.freeze({ cost: 100_000, upkeep: 1_000, footprint: 1 });
/** Maintenance excludes wages. One funded worker maintains one park; no coverage bonus. */
export const PARK_STAFF = Object.freeze({ slots: 1, monthlyWage: 42_000, dailyWage: 1_400 });
/**
 * Real wages (cities with `wageScale: 1`): a park keeper earns the 2024 average wage in administrative and support
 * services, which take in landscape care, 14,010.77 baht a month (Bank of Thailand EC_RL_014_S2, from the NSO Labour
 * Force Survey), 757.20 here at 18.5 real baht to one.
 */
export const REAL_PARK_STAFF = Object.freeze({ slots: 1, monthlyWage: 75_720, dailyWage: 2_524 });
/** A park's posts and wages under its city's wage rules. */
export const parkStaff = (rules: { wageScale?: 1 } | undefined) => rules?.wageScale === 1 ? REAL_PARK_STAFF : PARK_STAFF;
export const parkWorkers = (p: Park): number => p.staffing?.allocations.reduce((n, a) => n + a.workers, 0) ?? 0;
export const parkPayroll = (p: Park, rules: { wageScale?: 1 } | undefined): number => Object.values(p.staffing?.workDays ?? {}).reduce((n, days) => n + days * parkStaff(rules).dailyWage, 0);
export const MAX_PARKS = 32;
