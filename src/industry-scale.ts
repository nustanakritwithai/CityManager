/**
 * Real workplace sizes. A small factory employs 50 people, a medium one 200 and a large one 1,000; the levels inside
 * each size are the same plant better equipped (more storage, more markers on the map), never more jobs. Farms grow
 * with them: each farm level employs ten people where it used to employ one, so a city's fields can feed its mills.
 * A factory buys up to four crop lots a worker and stores as much; it draws a unit of power for every ten workers and
 * of water for every twenty.
 *
 * Cities saved before real sizes keep the old small workplaces (`industryScale` absent): factories of 4–12 workers and
 * farms of one worker a level, exactly as they grew then.
 */
import { factoryLevel, FACTORY_MAX_LEVEL } from './factory-levels.ts';
import { farmStockCapacity, FARM_REAL_STOCK_FACTOR, MAX_REAL_FACTORY_CROPS } from './agriculture.ts';

export type IndustryRules = { industryScale?: 1 };
export const realIndustry = (c: IndustryRules | undefined): boolean => c?.industryScale === 1;

/** Jobs by absolute factory level 1–9 under real sizes. */
export const REAL_FACTORY_JOBS = Object.freeze([50, 50, 50, 200, 200, 200, 1000, 1000, 1000] as const);
export const FACTORY_SIZE_LABEL = Object.freeze({ 50: 'โรงงานขนาดเล็ก', 200: 'โรงงานขนาดกลาง', 1000: 'โรงงานขนาดใหญ่' } as Record<number, string>);
/** Crop lots a worker can turn into goods each day decide how much a factory buys and keeps. */
export const CROP_LOTS_PER_FACTORY_WORKER = 4;
export const FARM_STAFF_PER_LEVEL = FARM_REAL_STOCK_FACTOR;

export function factoryJobs(level: number, c: IndustryRules | undefined): number {
  const legacy = factoryLevel(level); // keeps the strict 1–9 level contract
  return realIndustry(c) ? REAL_FACTORY_JOBS[level - 1] : legacy.jobs;
}
export function factoryCrops(level: number, c: IndustryRules | undefined): number {
  return realIndustry(c) ? factoryJobs(level, c) * CROP_LOTS_PER_FACTORY_WORKER : factoryLevel(level).crops;
}
export function factoryUtilities(level: number, c: IndustryRules | undefined): { power: number; water: number } {
  if (!realIndustry(c)) { const { power, water } = factoryLevel(level); return { power, water }; }
  const jobs = factoryJobs(level, c);
  return { power: Math.ceil(jobs / 10), water: Math.ceil(jobs / 20) };
}
/** The most crop lots any factory can hold under either rules (validation bound). */
export const MAX_FACTORY_CROPS = REAL_FACTORY_JOBS[FACTORY_MAX_LEVEL - 1] * CROP_LOTS_PER_FACTORY_WORKER;
if (MAX_FACTORY_CROPS !== MAX_REAL_FACTORY_CROPS) throw new Error('Real factory store bound out of step');

export const farmStaff = (level: number, c: IndustryRules | undefined): number => realIndustry(c) ? level * FARM_STAFF_PER_LEVEL : level;
export const farmStock = (level: number, c: IndustryRules | undefined): number => realIndustry(c) ? farmStockCapacity(level) * FARM_STAFF_PER_LEVEL : farmStockCapacity(level);
