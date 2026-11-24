/** Proposed retail balance. Commodity roles are independent of the shared 1–9 commercial visual tiers. */
export const RETAIL_MAX_LEVEL = 9;
export const RETAIL_LEGACY_MAX_LEVEL = 4;
export type RetailCapacity = { workers: number; stock: number; householdCoverage: number; heightFactor: number };
const TABLE: readonly Readonly<RetailCapacity>[] = Object.freeze([
  Object.freeze({ workers: 1, stock: 24, householdCoverage: 8, heightFactor: 1 }),
  Object.freeze({ workers: 2, stock: 32, householdCoverage: 8, heightFactor: 1 }),
  Object.freeze({ workers: 3, stock: 40, householdCoverage: 8, heightFactor: 1 }),
  Object.freeze({ workers: 4, stock: 48, householdCoverage: 16, heightFactor: 1.2 }),
  Object.freeze({ workers: 5, stock: 72, householdCoverage: 24, heightFactor: 1.4 }),
  Object.freeze({ workers: 6, stock: 96, householdCoverage: 32, heightFactor: 1.6 }),
  Object.freeze({ workers: 7, stock: 120, householdCoverage: 40, heightFactor: 1.8 }),
  Object.freeze({ workers: 8, stock: 144, householdCoverage: 48, heightFactor: 2 }),
]);
export function retailCapacity(level: number): RetailCapacity {
  if (!Number.isInteger(level) || level < 1 || level > RETAIL_MAX_LEVEL) throw new RangeError('Retail level must be 1–9');
  return { ...TABLE[Math.max(0, level - 2)] };
}
/**
 * One worker keeps the base 24-unit shelf; each extra actual worker unlocks the shelf of the level
 * built for that many staff (24/32/40/48/72/96), so every level from 2 to 7 adds stock. Coverage
 * keeps its legacy bands: 8 households up to three workers, then 8 more per extra worker.
 */
export function staffedRetailCapacity(level: number, workers: number): RetailCapacity {
  const capacity = retailCapacity(level), staffed = Math.min(capacity.workers, workers);
  const bands = workers > 0 ? 1 + Math.max(0, staffed - 3) : 0;
  return { workers: capacity.workers, stock: staffed > 0 ? TABLE[staffed - 1].stock : 0, householdCoverage: bands * 8, heightFactor: capacity.heightFactor };
}
