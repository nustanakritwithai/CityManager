/**
 * Real rice: fields, mills and the rice people eat, in real Thai quantities. New cities carry `industryScale: 1`;
 * cities saved before keep the old abstract farms and factories exactly as they grew then.
 *
 * - A crop lot is 10 kg of paddy (ข้าวเปลือก). The existing price of 350 satang a lot from farm to mill is then
 *   6.5 baht a kilo at the game's wage scale, against a real 6.4–7.2 baht a kilo (Thai Rice Mills Association,
 *   November 2025).
 * - A farm tile stands for 100 rai of paddy around its yard. Thailand averages 413 kg a rai a crop (Office of
 *   Agricultural Economics). Farm levels 1–3 plant one, two and three crops a year; levels 4–6 keep three crops on
 *   better seed and fertiliser, 500, 600 and 700 kg a rai (irrigated dry-season yields).
 * - A tile needs a hand for each crop it plants in a year, up to three (assumed: machinery is hired for ploughing and
 *   harvest); fewer hands harvest the same share less.
 * - A rice mill's level sets its milling capacity, from a community mill (2 tonnes a day) to a medium one (100 tonnes):
 *   the Rice Department's size classes are community up to 10 t, small 10–40 t, medium 40–100 t. A worker mills two
 *   tonnes of paddy a day (assumed; no published staffing figure found). Milled rice is 65% of paddy by weight.
 * - Milled rice is sold by the kilo. People eat 75 kg of rice a year (Department of Internal Trade, as reported in
 *   2024), 0.2 kg a day, bought in 1 kg bags.
 *
 * Other crops and products keep the old rules until they get their own real numbers.
 */
import { factoryLevel, FACTORY_MAX_LEVEL } from './factory-levels.ts';
import { farmStockCapacity, REAL_RICE_FARM_STORES, MAX_REAL_FACTORY_CROPS } from './agriculture.ts';

export type IndustryRules = { industryScale?: 1 };
export const realIndustry = (c: IndustryRules | undefined): boolean => c?.industryScale === 1;

export const KG_PER_LOT = 10;
export const RAI_PER_FARM_TILE = 100;
/** Kilograms of paddy a rai a crop, and crops a year, by farm level 1–6. */
export const RICE_KG_PER_RAI = Object.freeze([413, 413, 413, 500, 600, 700] as const);
export const RICE_CROPS_PER_YEAR = Object.freeze([1, 2, 3, 3, 3, 3] as const);
/** Hands a 100-rai rice farm needs: one for each crop it plants a year (assumed; machinery is hired for ploughing and harvest). */
export const riceFarmHands = (level: number): number => RICE_CROPS_PER_YEAR[level - 1];
/** Lots of paddy a fully staffed rice farm of this level harvests in a year. */
export const riceLotsPerYear = (level: number): number => RAI_PER_FARM_TILE * RICE_KG_PER_RAI[level - 1] * RICE_CROPS_PER_YEAR[level - 1] / KG_PER_LOT;
/**
 * Lots harvested on `tick`: the year's harvest spread evenly over the days, whole lots only, so every year adds up to
 * the real total without carrying fractions in the save.
 */
export function riceHarvest(level: number, tick: number, hands: number): number {
  // Whole-number arithmetic, so a year adds up exactly: lots a year × hands working ÷ (365 days × hands needed).
  const year = Math.round(riceLotsPerYear(level)), need = riceFarmHands(level), working = Math.min(need, hands), per = 365 * need;
  return Math.floor((tick + 1) * year * working / per) - Math.floor(tick * year * working / per);
}
/** A rice farm's yard holds sixty days of its harvest. */
export const riceFarmStore = (level: number): number => Math.ceil(riceLotsPerYear(level) / 365 * 60);

/** Tonnes of paddy a rice mill of this level can mill in a day. */
export const MILL_TONNES_PER_DAY = Object.freeze([2, 5, 10, 20, 30, 40, 60, 80, 100] as const);
export const MILL_TONNES_PER_WORKER = 2;
export const MILL_LOTS_PER_WORKER = MILL_TONNES_PER_WORKER * 1000 / KG_PER_LOT;
/** Milled rice from one batch: two lots (20 kg) of paddy give 13 kg of milled rice. */
export const REAL_RICE_RECIPE = Object.freeze({ crop: 2, goods: 13 } as const);
export const millJobs = (level: number): number => Math.ceil(MILL_TONNES_PER_DAY[level - 1] / MILL_TONNES_PER_WORKER);
/** A mill keeps two days of paddy at full capacity. */
export const millStore = (level: number): number => MILL_TONNES_PER_DAY[level - 1] * 1000 / KG_PER_LOT * 2;

/** Grams of milled rice a person eats a day, and the bag households buy. */
export const RICE_GRAMS_PER_PERSON_DAY = 200;
/** Kilograms a household of `members` buys on `tick`: whole bags, so over time it buys exactly what it eats. */
export function riceBagsToday(members: number, tick: number): number {
  const grams = members * RICE_GRAMS_PER_PERSON_DAY;
  return Math.floor((tick + 1) * grams / 1000) - Math.floor(tick * grams / 1000);
}
/**
 * Satang a kilo of milled rice, at the game's wage scale (a factory day pays 20 baht against a real minimum of about
 * 370, so 18.5 real baht make one): wholesale about 22 baht, retail about 30, import 26, export 20.
 */
export const RICE_PRICE = Object.freeze({ wholesale: 119, retail: 162, import: 140, export: 108 } as const);

export type FirmShape = { zone: string; recipe?: string };
export const isRealRiceMill = (f: FirmShape, c: IndustryRules | undefined) => realIndustry(c) && f.zone === 'I' && f.recipe === 'rice-mill';
export const isRealRiceFarm = (crop: string, c: IndustryRules | undefined) => realIndustry(c) && crop === 'rice';

export function factoryJobs(level: number, c: IndustryRules | undefined, f?: FirmShape): number {
  const legacy = factoryLevel(level); // keeps the strict 1–9 level contract
  return f && isRealRiceMill(f, c) ? millJobs(level) : legacy.jobs;
}
export function factoryCrops(level: number, c: IndustryRules | undefined, f?: FirmShape): number {
  return f && isRealRiceMill(f, c) ? millStore(level) : factoryLevel(level).crops;
}
export function factoryUtilities(level: number, _c: IndustryRules | undefined): { power: number; water: number } {
  const { power, water } = factoryLevel(level); return { power, water };
}
/** The most paddy lots any mill can hold under either rules (validation bound). */
export const MAX_FACTORY_CROPS = millStore(FACTORY_MAX_LEVEL);
// agriculture.ts validates stores without importing this module; keep its copies in step.
if (MAX_FACTORY_CROPS !== MAX_REAL_FACTORY_CROPS || REAL_RICE_FARM_STORES.some((store, i) => store !== riceFarmStore(i + 1))) throw new Error('Real rice stores out of step with agriculture.ts');

export const farmStaff = (level: number, c: IndustryRules | undefined, crop?: string): number => crop !== undefined && isRealRiceFarm(crop, c) ? riceFarmHands(level) : level;
export const farmStock = (level: number, c: IndustryRules | undefined, crop?: string): number => crop !== undefined && isRealRiceFarm(crop, c) ? riceFarmStore(level) : farmStockCapacity(level);
