/** Proposed retail balance. Level 1 is a market; shops occupy levels 2–7. */
export const RETAIL_MAX_LEVEL = 7;
export const RETAIL_LEGACY_MAX_LEVEL = 4;
export type RetailCapacity = { workers: number; stock: number; householdCoverage: number; heightFactor: number };
const TABLE: readonly Readonly<RetailCapacity>[] = Object.freeze([
  Object.freeze({ workers: 1, stock: 24, householdCoverage: 8, heightFactor: 1 }),
  Object.freeze({ workers: 2, stock: 24, householdCoverage: 8, heightFactor: 1 }),
  Object.freeze({ workers: 3, stock: 24, householdCoverage: 8, heightFactor: 1 }),
  Object.freeze({ workers: 4, stock: 48, householdCoverage: 16, heightFactor: 1.2 }),
  Object.freeze({ workers: 5, stock: 72, householdCoverage: 24, heightFactor: 1.4 }),
  Object.freeze({ workers: 6, stock: 96, householdCoverage: 32, heightFactor: 1.6 }),
]);
export function retailCapacity(level: number): RetailCapacity {
  if (!Number.isInteger(level) || level < 2 || level > RETAIL_MAX_LEVEL) throw new RangeError('Retail level must be 2–7');
  return { ...TABLE[level - 2] };
}
/** Legacy shelf and coverage stay available with one worker; extra capacity needs extra employees. */
export function staffedRetailCapacity(level: number, workers: number): RetailCapacity {
  const capacity = retailCapacity(level);
  const bands = workers > 0 ? 1 + Math.max(0, Math.min(capacity.workers, workers) - 3) : 0;
  return { workers: capacity.workers, stock: bands * 24, householdCoverage: bands * 8, heightFactor: capacity.heightFactor };
}
