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
 *   Levels 7–9 are high-tech farms that need a worker with a university degree: 800, 900 and 1,000 kg a rai (assumed;
 *   irrigated central-plains paddy averaged 604 kg a rai in 2025, NSO, and the best-managed farms reach about a tonne).
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
 *   on irrigated land at levels 4–6 (assumed). High-tech levels 7–9 grow 18 and 20 t, what farmers report from drip
 *   irrigation with good soil care (Technology Chaoban, Khaosod), and 25 t, short of the 36 t of the Department of
 *   Agriculture's drip-irrigation trial plots (assumed). Four hands cut a tile (assumed). Cut cane spoils, so the yard
 *   holds three days.
 * - Sugar is 107 kg a tonne of cane (2023/24: 82.17 Mt of cane gave 8.80 Mt of sugar, Office of the Cane and Sugar
 *   Board). Mills crush 25 t to 10,000 t a day by level; a worker crushes 25 t a day (assumed: a 15,000 t mill such
 *   as Mitr Amnat Charoen employs some hundreds).
 * - People eat 30 kg of sugar a year (Ministry of Public Health, 2015), 82 g a day.
 *
 * Vegetables
 * - A lot is 4 kg of leafy vegetables: 16 baht a kilo at the farm gate (assumed; Chinese kale and morning glory sell for
 *   about 15–20).
 * - A farm tile stands for 100 rai. Chinese kale yields about 1,200 kg a rai a crop in the field (National Statistical
 *   Office). Levels 1–3 grow three, four and five crops a year (a crop takes 45–60 days); levels 4–6 keep five crops at
 *   1,500, 2,000 and 2,500 kg a rai on better land (assumed). High-tech levels 7–9 are a greenhouse (six crops of
 *   3,000 kg, 11 kg a m² a year), a hydroponic greenhouse (eight of 5,000, 25 kg a m²) and a vertical farm (eight of
 *   12,000, 60 kg a m² a year, the average of commercial vertical farms for lettuce, Agronomy for Sustainable
 *   Development 2025; open fields give 3.3–3.9); the greenhouse steps are assumed. Their hands stay at level 6
 *   (assumed: automation takes the extra work).
 * - Leafy vegetables are worked by hand: about 25 days of work a rai a crop over a 300-day working year, so about eight
 *   hands for each crop a year on 100 rai (assumed). Cut vegetables keep three days.
 * - A cannery's level sets its capacity from 2 t of vegetables a day to 500 t; a worker prepares half a tonne a day
 *   (assumed: canning is hand work). Two 4 kg lots fill 10 kg of cans, net weight with the brine (assumed).
 * - People eat 10 g of canned vegetables a day, under 4 kg a year (assumed: Thais eat vegetables fresh). Fresh
 *   vegetables are part of the household's other spending (sim.ts, OTHER_SPENDING).
 *
 * Products of real crops are sold by the kilo, in 1 kg bags.
 */
import { factoryLevel, FACTORY_MAX_LEVEL } from './factory-levels.ts';
import { farmStockCapacity, FARM_MAX_LEVEL, REAL_FARM_MAX_LEVEL, REAL_FARM_STORES, MAX_REAL_FACTORY_CROPS } from './agriculture.ts';
import { TILE_SCALE, tileScale, type TileRules } from './tile-scale.ts';

export type IndustryRules = { industryScale?: 1 } & TileRules;
export const realIndustry = (c: IndustryRules | undefined): boolean => c?.industryScale === 1;
export const RAI_PER_FARM_TILE = 100;

type Prices = Readonly<{ wholesale: number; retail: number; import: number; export: number }>;
type RealCrop = Readonly<{
  /** Rai a farm tile stands for: 100, or 1,000 in a big town (tile-scale.ts). */
  raiPerTile: number;
  kgPerLot: number; kgPerRai: readonly number[]; cropsPerYear: readonly number[]; hands: readonly number[]; storeDays: number;
  recipe: string; product: string; millTonnesPerDay: readonly number[]; millTonnesPerWorker: number;
  /** Two lots of crop give `goods` kg of product. */ batchGoods: number; gramsPerPersonDay: number; prices: Prices;
  /** Real baht a rai a crop the farm spends on what is not labour or land: seed, fertilizer, chemicals, fuel, machine hire. */
  inputsPerRai: number;
  /** Satang a kilo of product the mill spends running: packaging, energy and water, upkeep, net of what its by-products bring. */
  millCostPerKg: number;
}>;
export const REAL_CROPS: Readonly<Record<string, RealCrop>> = Object.freeze({
  rice: Object.freeze({
    raiPerTile: RAI_PER_FARM_TILE, kgPerLot: 10, kgPerRai: [413, 413, 413, 500, 600, 700, 800, 900, 1000], cropsPerYear: [1, 2, 3, 3, 3, 3, 3, 3, 3], hands: [1, 2, 3, 3, 3, 3, 3, 3, 3], storeDays: 60,
    recipe: 'rice-mill', product: 'milled-rice', millTonnesPerDay: [2, 5, 10, 20, 30, 40, 60, 80, 100], millTonnesPerWorker: 2,
    batchGoods: 13, gramsPerPersonDay: 200,
    // White rice 5%: about 12.5 baht a kilo wholesale (Thai Rice Mills Association, 1,200–1,310 baht a 100 kg in 2025),
    // 11.6 for export (356 US$ a tonne, October 2025), 30 retail and 13.5 imported (assumed).
    prices: Object.freeze({ wholesale: 68, retail: 162, import: 73, export: 63 }),
    // Fertilizer, seed, chemicals and fuel come to about 700 baht a rai (Topphak et al., Int. J. Agric. Technol. 2023) and
    // machine hire for ploughing and the combine about 800 more (assumed): half the 3,433 a rai the rice policy committee
    // gives for all costs in 2022, labour and land included. A mill's bags, power, upkeep and the cost of its machines and
    // capital come to about 2.10 a kilo of rice, net of what bran and broken rice bring back: 1.10, which leaves it the
    // thin margin of a Thai rice miller, about 5% of what its rice sells for (assumed).
    inputsPerRai: 1500, millCostPerKg: 6,
  }),
  sugarcane: Object.freeze({
    raiPerTile: RAI_PER_FARM_TILE, kgPerLot: 56, kgPerRai: [8000, 9000, 10000, 12000, 14000, 16000, 18000, 20000, 25000], cropsPerYear: [1, 1, 1, 1, 1, 1, 1, 1, 1], hands: [4, 4, 4, 4, 4, 4, 4, 4, 4], storeDays: 3,
    recipe: 'sugar-mill', product: 'sugar', millTonnesPerDay: [25, 50, 100, 250, 500, 1000, 2500, 5000, 10000], millTonnesPerWorker: 25,
    batchGoods: 12, gramsPerPersonDay: 82,
    // White sugar leaves the mill at 21 baht a kilo (Office of the Cane and Sugar Board, October 2025); about 25 retail,
    // 22 imported and 16 for export (assumed).
    prices: Object.freeze({ wholesale: 114, retail: 135, import: 119, export: 86 }),
    // Growing cane costs about 10,000 baht a rai (Prachatai, 2024), of which half is assumed to be inputs and machines, as
    // for rice, the rest labour and land. A mill's lime, power beyond its own bagasse, bags, upkeep and the cost of its
    // machines and capital come to about 4.30 a kilo of sugar, which leaves it about 5% of its sugar's price, near the net
    // margin of Thai sugar companies (assumed).
    inputsPerRai: 5000, millCostPerKg: 23,
  }),
  vegetables: Object.freeze({
    raiPerTile: RAI_PER_FARM_TILE, kgPerLot: 4, kgPerRai: [1200, 1200, 1200, 1500, 2000, 2500, 3000, 5000, 12000], cropsPerYear: [3, 4, 5, 5, 5, 5, 6, 8, 8], hands: [25, 33, 42, 42, 42, 42, 42, 42, 42], storeDays: 3,
    recipe: 'cannery', product: 'canned-food', millTonnesPerDay: [2, 5, 10, 20, 50, 100, 200, 300, 500], millTonnesPerWorker: .5,
    batchGoods: 10, gramsPerPersonDay: 10,
    // A 425 g can of vegetables sells for about 25 baht: 59 a kilo retail, 45 wholesale, 48 imported and 33 for export
    // (about 1,000 US$ a tonne) (assumed).
    prices: Object.freeze({ wholesale: 243, retail: 319, import: 259, export: 178 }),
    // Seed, fertilizer and sprays for leafy vegetables about 4 baht a kilo grown, 4,800 a rai a crop (assumed). The can
    // itself is about 5 baht for 425 g, 12 a kilo, plus brine, power, upkeep and the cost of the line and its capital:
    // about 18.30 a kilo, which leaves the cannery about 5% of its export price (assumed).
    inputsPerRai: 4800, millCostPerKg: 99,
  }),
});
/**
 * The same crops in a big town (tile-scale.ts): a tile is ten times the land with ten times the hands, and a mill ten
 * times the capacity, so its jobs and store follow. Yields, prices and costs a kilo are the real ones.
 */
export const BIG_TOWN_CROPS: Readonly<Record<string, RealCrop>> = Object.freeze(Object.fromEntries(Object.entries(REAL_CROPS).map(([crop, spec]) => [crop, Object.freeze({
  ...spec, raiPerTile: spec.raiPerTile * TILE_SCALE, hands: Object.freeze(spec.hands.map(n => n * TILE_SCALE)), millTonnesPerDay: Object.freeze(spec.millTonnesPerDay.map(t => t * TILE_SCALE)),
})])));
const cropsOf = (c: IndustryRules | undefined) => tileScale(c) === TILE_SCALE ? BIG_TOWN_CROPS : REAL_CROPS;
const cropOfRecipe = new Map(Object.entries(REAL_CROPS).map(([crop, spec]) => [spec.recipe, crop]));
const cropOfProduct = new Map(Object.entries(REAL_CROPS).map(([crop, spec]) => [spec.product, crop]));

/** The highest level a farm reaches: 9 for real crops (7–9 high-tech), 6 under the old rules. */
export const farmMaxLevel = (c: IndustryRules | undefined): number => realIndustry(c) ? REAL_FARM_MAX_LEVEL : FARM_MAX_LEVEL;
/** The real crop a farm grows or a mill processes, under real rules; undefined for the old rules or other crops. */
export const realCrop = (crop: string | undefined, c: IndustryRules | undefined): RealCrop | undefined => realIndustry(c) && crop !== undefined ? cropsOf(c)[crop] : undefined;
export const realMillCrop = (f: FirmShape, c: IndustryRules | undefined): RealCrop | undefined => f.zone === 'I' && f.recipe !== undefined && realIndustry(c) ? cropsOf(c)[cropOfRecipe.get(f.recipe) ?? ''] : undefined;
export const realProduct = (product: string, c: IndustryRules | undefined): RealCrop | undefined => realIndustry(c) ? cropsOf(c)[cropOfProduct.get(product) ?? ''] : undefined;

/** Lots a fully staffed farm of this level harvests in a year. */
export const realLotsPerYear = (spec: RealCrop, level: number): number => Math.floor(spec.raiPerTile * spec.kgPerRai[level - 1] * spec.cropsPerYear[level - 1] / spec.kgPerLot);
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
/** The game's price scale: 18.5 real baht to one game baht, set when a factory day paid 20 against a real minimum wage of about 370. Real wages (sim.ts, REAL_WAGES) are converted at it too. */
export const REAL_BAHT_PER_GAME_BAHT = 18.5;
/** Satang a farm of this level pays for the inputs of `lots` lots it harvested: its per-rai inputs over the rai they grew on.
 * A high-tech farm (levels 7–9) spends on climate control, nutrients and energy in step with its extra yield, so a kilo
 * costs it what it costs at level 6 (assumed; a real vertical farm's lights cost far more). */
export const farmInputs = (spec: RealCrop, level: number, lots: number): number =>
  Math.round(lots * spec.kgPerLot * spec.inputsPerRai * 100 / (spec.kgPerRai[Math.min(level, 6) - 1] * REAL_BAHT_PER_GAME_BAHT));
/** Satang a mill pays to run for `kg` kilos of product it made. */
export const millRunningCost = (spec: RealCrop, kg: number): number => kg * spec.millCostPerKg;
export const FARM_INPUTS_REASON = 'Farm inputs', MILL_COSTS_REASON = 'Mill running costs';
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

/** The most crop lots any real mill can hold, in a big town too (validation bound). */
export const MAX_FACTORY_CROPS = Math.max(...[REAL_CROPS, BIG_TOWN_CROPS].flatMap(crops => Object.values(crops)).map(spec => millStoreFor(spec, FACTORY_MAX_LEVEL)));
// agriculture.ts validates stores without importing this module; keep its copies in step.
const stores = [REAL_CROPS, BIG_TOWN_CROPS].flatMap(crops => Object.values(crops)).flatMap(spec => [1, 2, 3, 4, 5, 6, 7, 8, 9].map(level => realFarmStore(spec, level)));
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
