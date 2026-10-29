/** Absolute levels. The first three entries preserve the published factory rules. */
const LEVELS = [
  { jobs: 4, crops: 24, power: 3, water: 2, model: 1, markers: 0 },
  { jobs: 5, crops: 24, power: 4, water: 3, model: 2, markers: 0 },
  { jobs: 6, crops: 24, power: 5, water: 4, model: 3, markers: 0 },
  { jobs: 7, crops: 28, power: 6, water: 5, model: 3, markers: 1 },
  { jobs: 8, crops: 32, power: 7, water: 6, model: 3, markers: 2 },
  { jobs: 9, crops: 36, power: 8, water: 7, model: 3, markers: 3 },
  { jobs: 10, crops: 40, power: 9, water: 8, model: 3, markers: 4 },
  { jobs: 11, crops: 44, power: 10, water: 9, model: 3, markers: 5 },
  { jobs: 12, crops: 48, power: 11, water: 10, model: 3, markers: 6 },
] as const;
export const FACTORY_MAX_LEVEL = LEVELS.length;
export const FACTORY_MAX_WORKERS = LEVELS[LEVELS.length - 1].jobs;
export function factoryLevel(level: number): (typeof LEVELS)[number] {
  if (!Number.isInteger(level) || level < 1 || level > FACTORY_MAX_LEVEL) throw new RangeError('Invalid factory level');
  return LEVELS[level - 1];
}
export const factoryCropCapacity = (level: number): number => factoryLevel(level).crops;
