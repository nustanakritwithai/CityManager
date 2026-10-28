/** Factory levels 1–3 retain their original storage and labour rules. */
export const FACTORY_MAX_LEVEL = 9;
export const FACTORY_MAX_WORKERS = FACTORY_MAX_LEVEL + 3;
export function factoryCropCapacity(level: number): number {
  if (!Number.isInteger(level) || level < 1 || level > FACTORY_MAX_LEVEL) throw new RangeError('Invalid factory level');
  return Math.max(24, 4 * (level + 3));
}
