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
export const parkWorkers = (p: Park): number => p.staffing?.allocations.reduce((n, a) => n + a.workers, 0) ?? 0;
export const parkPayroll = (p: Park): number => Object.values(p.staffing?.workDays ?? {}).reduce((n, days) => n + days * PARK_STAFF.dailyWage, 0);
export const MAX_PARKS = 32;
