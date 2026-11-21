/**
 * Real crops: fields, mills and what people eat, in real Thai quantities. New cities carry `industryScale: 1`; cities
 * saved before keep the old abstract farms and factories exactly as they grew then. Each real crop has its own lot
 * weight, chosen so the game's existing price of 350 satang a lot from farm to mill is that crop's real price at the
 * game's wage scale (a factory day pays 20 baht against a real minimum of about 370, so 18.5 real baht make one).
 *
 * Rice
 * - A lot is 10 kg of paddy: 6.5 baht a kilo, against a real 6.4–7.2 (Thai Rice Mills Association, November 2025).
 * - A farm tile stands for 100 rai. Thailand averages 413 kg a rai a crop (Office of Agricultural Economics). Levels
 *   1–3 plant one, two and three crops a year; levels 4–6 keep three crops at 500, 600 and 700 kg a rai.
 * - A hand for each crop a year (assumed). The yard holds 60 days of harvest.
 * - A mill's level sets its capacity from 2 t a day (community) to 100 t (medium), after the Rice Department's size
 *   classes. A worker mills 2 t of paddy a day (assumed). Milled rice is 65% of paddy (assumed).
 * - People eat 75 kg a year (Department of Internal Trade), 200 g a day.
 *
 * Sugarcane
 * - A lot is 56 kg of cane: 1.16 baht a kilo, the 2024/25 initial cane price of 1,160 baht a tonne at 10 CCS (cabinet,
 *   March 2025).
 * - A farm tile stands for 100 rai harvested once a year: 8, 9 and 10 t a rai at levels 1–3 (about 9.6 t national in
 *   2022/23, a secondary figure; the Office of the Cane and Sugar Board publishes the official one), 12, 14 and 16 t
 *   on irrigated land at levels 4–6 (assumed). Four hands cut a tile (assumed). Cut cane spoils, so the yard holds
 *   three days.
 * - Sugar is 107 kg a tonne of cane (2023/24: 82.17 Mt of cane gave 8.80 Mt of sugar, Office of the Cane and Sugar
 *   Board). Mills crush 25 t to 10,000 t a day by level; a worker crushes 25 t a day (assumed: a 15,000 t mill such
 *   as Mitr Amnat Charoen employs some hundreds).
 * - People eat 30 kg of sugar a year (Ministry of Public Health, 2015), 82 g a day.
 *
 * Products of real crops are sold by the kilo, in 1 kg bags. Vegetables and canned food keep the old rules for now.
 */
import { factoryLevel, FACTORY_MAX_LEVEL } from './factory-levels.ts';
import { farmStockCapacity, REAL_FARM_STORES, MAX_REAL_FACTORY_CROPS } from './agriculture.ts';

export type IndustryRules = { industryScale?: 1 };
export const realIndustry = (c: IndustryRules | undefined): boolean => c?.industryScale === 1;
export const RAI_PER_FARM_TILE = 100;

type Prices = Readonly<{ wholesale: number; retail: number; import: number; export: number }>;
type RealCrop = Readonly<{
  kgPerLot: number; kgPerRai: readonly number[]; cropsPerYear: readonly number[]; hands: readonly number[]; storeDays: number;
  recipe: string; product: string; millTonnesPerDay: readonly number[]; millTonnesPerWorker: number;
  /** Two lots of crop give `goods` kg of product. */ batchGoods: number; gramsPerPersonDay: number; prices: Prices;
}>;
export const REAL_CROPS: Readonly<Record<string, RealCrop>> = Object.freeze({
  rice: Object.freeze({
    kgPerLot: 10, kgPerRai: [413, 413, 413, 500, 600, 700], cropsPerYear: [1, 2, 3, 3, 3, 3], hands: [1, 2, 3, 3, 3, 3], storeDays: 60,
    recipe: 'rice-mill', product: 'milled-rice', millTonnesPerDay: [2, 5, 10, 20, 30, 40, 60, 80, 100], millTonnesPerWorker: 2,
    batchGoods: 13, gramsPerPersonDay: 200,
    // About 22 baht a kilo wholesale, 30 retail, 26 imported and 20 for export (assumed).
    prices: Object.freeze({ wholesale: 119, retail: 162, import: 140, export: 108 }),
  }),
  sugarcane: Object.freeze({
    kgPerLot: 56, kgPerRai: [8000, 9000, 10000, 12000, 14000, 16000], cropsPerYear: [1, 1, 1, 1, 1, 1], hands: [4, 4, 4, 4, 4, 4], storeDays: 3,
    recipe: 'sugar-mill', product: 'sugar', millTonnesPerDay: [25, 50, 100, 250, 500, 1000, 2500, 5000, 10000], millTonnesPerWorker: 25,
    batchGoods: 12, gramsPerPersonDay: 82,
    // About 22 baht a kilo wholesale, 25 retail, 24 imported and 18 for export (assumed).
    prices: Object.freeze({ wholesale: 119, retail: 135, import: 130, export: 97 }),
  }),
});
const cropOfRecipe = new Map(Object.entries(REAL_CROPS).map(([crop, spec]) => [spec.recipe, crop]));
const cropOfProduct = new Map(Object.entries(REAL_CROPS).map(([crop, spec]) => [spec.product, crop]));

/** The real crop a farm grows or a mill processes, under real rules; undefined for the old rules or other crops. */
export const realCrop = (crop: string | undefined, c: IndustryRules | undefined): RealCrop | undefined => realIndustry(c) && crop !== undefined ? REAL_CROPS[crop] : undefined;
export const realMillCrop = (f: FirmShape, c: IndustryRules | undefined): RealCrop | undefined => f.zone === 'I' && f.recipe !== undefined && realIndustry(c) ? REAL_CROPS[cropOfRecipe.get(f.recipe) ?? ''] : undefined;
export const realProduct = (product: string, c: IndustryRules | undefined): RealCrop | undefined => realIndustry(c) ? REAL_CROPS[cropOfProduct.get(product) ?? ''] : undefined;

/** Lots a fully staffed farm of this level harvests in a year. */
export const realLotsPerYear = (spec: RealCrop, level: number): number => Math.floor(RAI_PER_FARM_TILE * spec.kgPerRai[level - 1] * spec.cropsPerYear[level - 1] / spec.kgPerLot);
/** Lots harvested on `tick`: the year spread evenly over its days in whole lots, so every year adds up exactly. */
export function realHarvest(spec: RealCrop, level: number, tick: number, hands: number): number {
  const year = realLotsPerYear(spec, level), need = spec.hands[level - 1], working = Math.min(need, hands), per = 365 * need;
  return Math.floor((tick + 1) * year * working / per) - Math.floor(tick * year * working / per);
}
export const realFarmStore = (spec: RealCrop, level: number): number => Math.ceil(realLotsPerYear(spec, level) / 365 * spec.storeDays);
export const millLotsPerWorker = (spec: RealCrop): number => Math.floor(spec.millTonnesPerWorker * 1000 / spec.kgPerLot);
export const millJobsFor = (spec: RealCrop, level: number): number => Math.ceil(spec.millTonnesPerDay[level - 1] / spec.millTonnesPerWorker);
/** A mill keeps two days of crop at full capacity. */
export const millStoreFor = (spec: RealCrop, level: number): number => Math.floor(spec.millTonnesPerDay[level - 1] * 1000 / spec.kgPerLot) * 2;
export const realRecipe = (spec: RealCrop) => ({ crop: 2, goods: spec.batchGoods });
/** Kilos a household of `members` buys on `tick`: whole bags, so over time it buys exactly what it eats. */
export function bagsToday(spec: RealCrop, members: number, tick: number): number {
  const grams = members * spec.gramsPerPersonDay;
  return Math.floor((tick + 1) * grams / 1000) - Math.floor(tick * grams / 1000);
}

export type FirmShape = { zone: string; recipe?: string };
export function factoryJobs(level: number, c: IndustryRules | undefined, f?: FirmShape): number {
  const legacy = factoryLevel(level); // keeps the strict 1–9 level contract
  const spec = f && realMillCrop(f, c);
  return spec ? millJobsFor(spec, level) : legacy.jobs;
}
export function factoryCrops(level: number, c: IndustryRules | undefined, f?: FirmShape): number {
  const spec = f && realMillCrop(f, c);
  return spec ? millStoreFor(spec, level) : factoryLevel(level).crops;
}
export function factoryUtilities(level: number, _c: IndustryRules | undefined): { power: number; water: number } {
  const { power, water } = factoryLevel(level); return { power, water };
}
export const farmStaff = (level: number, c: IndustryRules | undefined, crop?: string): number => { const spec = realCrop(crop, c); return spec ? spec.hands[level - 1] : level; };
export const farmStock = (level: number, c: IndustryRules | undefined, crop?: string): number => { const spec = realCrop(crop, c); return spec ? realFarmStore(spec, level) : farmStockCapacity(level); };

/** The most crop lots any real mill can hold (validation bound). */
export const MAX_FACTORY_CROPS = Math.max(...Object.values(REAL_CROPS).map(spec => millStoreFor(spec, FACTORY_MAX_LEVEL)));
// agriculture.ts validates stores without importing this module; keep its copies in step.
const stores = Object.values(REAL_CROPS).flatMap(spec => [1, 2, 3, 4, 5, 6].map(level => realFarmStore(spec, level)));
if (MAX_FACTORY_CROPS !== MAX_REAL_FACTORY_CROPS || stores.some(s => !REAL_FARM_STORES.includes(s)) || REAL_FARM_STORES.length !== stores.length) throw new Error('Real crop stores out of step with agriculture.ts');

// Rice names kept for callers and tests written for the first real crop.
const RICE = REAL_CROPS.rice;
export const KG_PER_LOT = RICE.kgPerLot;
export const RICE_KG_PER_RAI = RICE.kgPerRai, RICE_CROPS_PER_YEAR = RICE.cropsPerYear;
export const riceLotsPerYear = (level: number) => realLotsPerYear(RICE, level);
export const riceHarvest = (level: number, tick: number, hands: number) => realHarvest(RICE, level, tick, hands);
export const riceFarmHands = (level: number) => RICE.hands[level - 1];
export const riceFarmStore = (level: number) => realFarmStore(RICE, level);
export const MILL_TONNES_PER_DAY = RICE.millTonnesPerDay, MILL_TONNES_PER_WORKER = RICE.millTonnesPerWorker, MILL_LOTS_PER_WORKER = millLotsPerWorker(RICE);
export const REAL_RICE_RECIPE = Object.freeze(realRecipe(RICE));
export const millJobs = (level: number) => millJobsFor(RICE, level);
export const millStore = (level: number) => millStoreFor(RICE, level);
export const RICE_GRAMS_PER_PERSON_DAY = RICE.gramsPerPersonDay;
export const riceBagsToday = (members: number, tick: number) => bagsToday(RICE, members, tick);
export const RICE_PRICE = RICE.prices;
