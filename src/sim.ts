import { roadLinked, configureRoadPath, setRoadJunction, forgetRoadTopology, validateRoadTopology, type RoadTopology } from './road-topology.ts';
/** Pure household/establishment simulation: one tick is one day; money is integer satang. */
import { FACTORY_MAX_LEVEL, factoryLevel } from './factory-levels.ts';
import { HOUSING_LEVELS, housingLevel, getHousingCapacity, buildOccupancyIndex, canAccommodate, type HousingType, type HousingCapacity } from './housing.ts';
import { allocateEmployment, retrainingMoves, type EmploymentAllocation, type WorkerSkills } from './labor.ts';
import { deserialize as deserializeV6, type City as CityV6 } from './legacy-v6.ts';
import { createResourceMap, isCanonicalResourceMap, FERTILITY_THRESHOLD, CROP_RECIPE, FARM_MAX_LEVEL, farmStockCapacity, type ResourceMap } from './agriculture.ts';
import { CROPS, PRODUCTS, RECIPE, RECIPES, cropForFertility, emptyCrops, emptyProducts, mixTotal, productPreference, recipeForCrop, takeLargest, validMix, type CropId, type CropMix, type ProductId, type ProductMix, type RecipeId } from './goods.ts';
import { runAgriculture, consumeMarketCrop, writeOffCrops, agricultureDiagnostic } from './agriculture-runtime.ts';
import { validateTypes } from './goods-validation.ts';
import { MAX_PARKS, PARK, PARK_STAFF, parkPayroll, parkWorkers, type Park } from './parks.ts';
import { validateAgriculture } from './agriculture-validation.ts';
import { RETAIL_LEGACY_MAX_LEVEL, RETAIL_MAX_LEVEL, retailCapacity, staffedRetailCapacity } from './retail-capacity.ts';
import { HOUSEHOLD_BILL, HOUSEHOLD_NEED, MAX_PLANTS, OUTSIDE_PRICE, OUTSIDE_SUPPLY, PLANTS, PLANT_NAMES, UTILITY_KINDS, buildingBill, buildingNeed, fits, householdBill, unserved, utilityFlags, utilityService, type Need, type Plant, type Service, type UtilityKind } from './utilities.ts';
export type { Plant, UtilityKind } from './utilities.ts';
export type { EmploymentAllocation } from './labor.ts';
export const SIZE = 24;
/** Structural save bound: 192 residential parcels at the largest 32-household tier. */
export const MAX_CITY_HOUSEHOLDS = 192 * Math.max(...HOUSING_LEVELS.map(level => level.households));
export const GATEWAY = 12 * SIZE;
export const MONTH = 30;
export const ROAD_COST = 5_000;
export const WAGES = { I: 60_000, C: 42_000, F: 42_000 } as const;
export type Zone = 'R' | 'C' | 'I' | 'F' | null;
export type Cell = { road: boolean; zone: Zone; building: number | null };
export type Building = { id: number; cell: number; zone: Exclude<Zone, null>; level: number; age: number; housingType?: HousingType };
export type Household = { id: number; home: number | null; members: number; workforce: number; dependents: number; workerSkills: WorkerSkills; skillSource: 'legacy-assumed' | 'arrival-profile'; profile: 'legacy-worker' | 'single-worker' | 'family'; origin: 'legacy-v1' | 'arrival'; wallet: string; lastPurchaseTick: number; needs: number };
export type Owner = { householdId: number; capitalContributed: number; capitalReturned: number; withdrawn: number; taxPaid: number };
export type OwnerLabor = { householdId: number; firmId: number; skill: 'general' | 'retail'; workers: 1 };
export type Firm = { id: number; building: number; zone: 'C' | 'I' | 'F'; recipe?: RecipeId; recipeMode?: 'auto' | 'manual'; recipeChoices?: { at: number; recipe: RecipeId }[]; cropMode?: 'auto' | 'manual'; cropChoices?: { at: number; crop: CropId }[]; crops: CropMix; products: ProductMix; commercialKind?: 'market' | 'retail'; convertedAt?: number; takenOverAt?: number; fundedBy?: { firmId: number; capital: number }; wallet: string; workDays: Record<string, number>; inventory: number; cropInventory: number; cropCost: number; productionTick: number; owner: Owner | null; profit: number; lastMonthProfit: number; monthlyRevenue: number; monthlyExpense: number };
/** `crop` names the lots moved (every kind but a write-off); a write-off carries the whole `mix`. Untyped only before `typeBaseline.tick`. */
export type CropEntry = { id: number; tick: number; kind: 'harvest' | 'trade' | 'process' | 'writeoff' | 'consumption' | 'export' | 'market-deposit' | 'market-refund' | 'market-receipt'; from: string; to: string; quantity: number; fromValue: number; toValue: number; cash: number; workers: number; batches: number; outputQuantity: number; reason: string; crop?: CropId; mix?: CropMix };
export type Entry = { tick: number; from: string; to: string; amount: number; reason: string };
export type GoodsEntry = { tick: number; from: string; to: string; quantity: number; reason: string; product?: ProductId };
/**
 * Typed stock at the moment typing began, and how many crop and goods journal entries came before
 * it (those stay untyped). A fresh city starts empty; a migrated v7 city records its stock on load.
 */
export type TypeBaseline = { tick: number; cropEntries: number; goodsEntries: number; crops: Record<string, CropMix>; products: Record<string, ProductMix> };
export type City = {
  populationCapacityVersion?: 1;
  roadTopology?: RoadTopology;
  foodDemandStartTick?: number;
  factoryProgressionStartTick?: number;
  /** Earlier harvests were produced under the level 1–3 farm rules. */
  farmLevelStartTick?: number;
  version: 9; rulesVersion: 'chain-4'; typeBaseline: TypeBaseline; growthStartTick: number; migration: { arrivals: number; legacyHouseholds: number; departures?: number }; employment: EmploymentAllocation[];
  ownerLabor: OwnerLabor[]; resources: ResourceMap; crops: { harvested: number; processed: number; consumed: number; writtenOff: number; exported?: number }; cropLedger: CropEntry[]; agricultureStartTick: number;
  seed: number; rng: number; tick: number; nextId: number;
  cells: Cell[]; buildings: Building[]; households: Household[]; firms: Firm[];
  accounts: Record<string, number>; ledger: Entry[]; goodsLedger: GoodsEntry[];
  goods: { produced: number; imported: number; consumed: number; exported: number };
  /** Optional v10 market envelope; the city simulator never reads or trusts its server token. */
  market?: { version: 10; rulesVersion: 'chain-5'; cityId: string; guestId: string | null; operations: unknown[]; escrow: unknown[]; receipts: Record<string, unknown>; seq: string };
  /** The gateway's outside water/power contract in units; plants add the rest (see utilities.ts). */
  utilities: { outside: Need }; plants: Plant[]; parks: Park[]; lastEvent: string;
};
export type Result = { ok: boolean; message: string };
const validIndex = (i: number) => Number.isInteger(i) && i >= 0 && i < SIZE * SIZE;
const neighbors = (i: number) => [i % SIZE ? i - 1 : -1, i % SIZE < SIZE - 1 ? i + 1 : -1, i >= SIZE ? i - SIZE : -1, i < SIZE * (SIZE - 1) ? i + SIZE : -1].filter(validIndex);
const balance = (c: City, id: string) => c.accounts[id] ?? 0;
export const treasurySpendable = (c: City): number => Math.max(0, balance(c, 'treasury') - c.parks.reduce((n, p) => n + parkPayroll(p), 0));
export const parkEmploymentForHousehold = (c: City, id: number) => c.parks.flatMap(p => p.staffing?.allocations ?? []).filter(a => a.householdId === id);
const parkEmployment = (c: City) => c.parks.flatMap(p => p.staffing?.allocations ?? []);
/** ID-ordered funding shares prevent several parks promising the same treasury money. */
function parkFundedSeats(c: City): Map<number, number> {
  let budget = treasurySpendable(c);
  return new Map([...c.parks].sort((a, b) => a.id - b.id).map(p => {
    const seats = Math.min(PARK_STAFF.slots, Math.floor(budget / PARK_STAFF.dailyWage));
    budget -= seats * PARK_STAFF.dailyWage; return [p.id, seats];
  }));
}
export function parkStaffingStatus(c: City, p: Park) {
  const employed = parkWorkers(p), vacancies = PARK_STAFF.slots - employed;
  const funded = parkFundedSeats(c).get(p.id) ?? 0;
  const applicants = c.households.reduce((n, h) => n + Math.max(0, h.workforce - householdWorkerCount(c, h.id)), 0);
  return { employed, vacancies, slots: PARK_STAFF.slots, staffedCapacity: employed / PARK_STAFF.slots,
    fundedVacancies: Math.min(vacancies, funded), unfundedVacancies: Math.max(0, vacancies - funded),
    status: employed === PARK_STAFF.slots ? 'staffed' : funded < vacancies ? 'inadequate-budget' : applicants ? 'recruiting' : 'no-applicants',
    monthlyWages: employed * PARK_STAFF.monthlyWage, earnedWages: parkPayroll(p) };
}
export const isMarket = (f: Pick<Firm, 'zone' | 'commercialKind'>): boolean => f.zone === 'C' && f.commercialKind === 'market';
export const isRetail = (f: Pick<Firm, 'zone' | 'commercialKind'>): boolean => f.zone === 'C' && f.commercialKind === 'retail';
export const firmCapacity = (b: Building) => b.zone === 'I' ? factoryLevel(b.level).jobs : b.zone === 'F' ? b.level : b.zone === 'C' ? b.level === 1 ? 1 : retailCapacity(b.level).workers : 0;
const capacity = firmCapacity;
export const firmWage = (f: Firm) => isMarket(f) ? 0 : WAGES[f.zone];
export const firmRent = (f: Firm) => isMarket(f) ? 3_000 : 10_000;
const payroll = (f: Firm) => Object.values(f.workDays).reduce((n, days) => n + days * firmWage(f) / MONTH, 0);
const spendable = (c: City, f: Firm) => Math.max(0, balance(c, f.wallet) - payroll(f));
// Keep the next counter saveable after every allocation, including a two-ID establishment.
const canAllocateIds = (c: City, count: number) => Number.isSafeInteger(c.nextId) && c.nextId >= 1 && c.nextId <= Number.MAX_SAFE_INTEGER - 2 - count;
function random(c: City): number { c.rng = (Math.imul(c.rng, 1664525) + 1013904223) >>> 0; return c.rng / 4294967296; }

export const employmentForHousehold = (c: City, id: number): EmploymentAllocation[] => c.employment.filter(e => e.householdId === id);
export const employmentForFirm = (c: City, id: number): EmploymentAllocation[] => c.employment.filter(e => e.firmId === id);
export const firmWorkerCount = (c: City, id: number): number => employmentForFirm(c, id).reduce((n, e) => n + e.workers, 0) + c.ownerLabor.filter(e => e.firmId === id).length;
export const householdWorkerCount = (c: City, id: number): number => employmentForHousehold(c, id).reduce((n, e) => n + e.workers, 0) + c.ownerLabor.filter(e => e.householdId === id).length + parkEmploymentForHousehold(c, id).reduce((n, e) => n + e.workers, 0);
export const housingCapacity = (b: Building): HousingCapacity => b.zone === 'R' ? getHousingCapacity(b.housingType!, b.level) : { households: 0, persons: 0 };
export const homeOccupancy = (c: City, id: number): HousingCapacity => buildOccupancyIndex(c.households).get(id) ?? { households: 0, persons: 0 };
const residentialInvestorEligible = (c: City, h: Household) => householdWorkerCount(c, h.id) > 0 && c.tick - h.lastPurchaseTick <= 3 && balance(c, h.wallet) >= 20_000;
/** Uses the same conditions as autonomous residential growth. */
export function housingUpgradeStatus(c: City, b: Building) {
  if (b.zone !== 'R') throw new Error('Not a residential building.');
  const current = housingLevel(b.housingType!, b.level), next = HOUSING_LEVELS[b.level] ?? null;
  const blocked: string[] = [];
  if (next) {
    if (b.age < MONTH) blocked.push('อาคารต้องมีอายุอย่างน้อย 30 วัน');
    if (!access(c, b.cell)) blocked.push('ต้องมีถนนเชื่อมถึงประตูเมือง');
    if (!utilities(c).ok(b.id)) blocked.push('ต้องมีน้ำและไฟเพียงพอสำหรับผู้อยู่อาศัยปัจจุบัน');
    if (!c.households.some(h => h.home === b.id && residentialInvestorEligible(c, h))) blocked.push('ต้องมีครัวเรือนที่ทำงาน ซื้อสินค้าใน 3 วัน และมีเงินอย่างน้อย 200 เครดิต');
  }
  return { current, next, blocked };
}
const householdAccess = (c: City, h: Household) => h.home !== null && access(c, building(c, h.home).cell);
/** Today's water and power along the connected roads (see utilities.ts). */
export const utilities = (c: City): Service => utilityService(c, connectedRoads(c));
/** A home can take one more household: it is supplied now and the network has a unit of each to spare. */
function homeSupplied(c: City, home: Building, svc = utilities(c)): boolean { return svc.ok(home.id) && fits(svc.spare, HOUSEHOLD_NEED); }
/** Simple per-kind flags and shortage counts for the HUD and panels. */
export function utilityStatus(c: City) {
  const svc = utilities(c);
  return { ...utilityFlags(svc), capacity: svc.capacity, used: svc.used, spare: svc.spare, outside: svc.outside, unserved: unserved(svc), plants: c.plants.length };
}
/** Whether the parcel has water and power: a building is served now; an empty connected parcel could take a new household. */
export function utilityAt(c: City, cell: number): boolean {
  const b = c.buildings.find(b => b.cell === cell), svc = utilities(c);
  return b ? svc.ok(b.id) : access(c, cell) && fits(svc.spare, HOUSEHOLD_NEED);
}
export const plantAt = (c: City, i: number): Plant | undefined => c.plants.find(p => p.cell === i);
export const parkAt = (c: City, i: number): Park | undefined => c.parks.find(p => p.cell === i);

/** Proposed prototype finance policy, in integer satang; no credit or outside grant. */
export const INDUSTRY_STARTUP_CAPITAL = 300_000;
export const OWNER_STARTUP_CAPITAL = 60_000;
/** One quarter of each month's after-tax profit stays in the business for development. */
export const OWNER_DEVELOPMENT_SHARE_DENOMINATOR = 4;
export const MARKET_CONVERSION_COST = 20_000;
const INDUSTRY_WORKING_RESERVE = 20_000;
/**
 * Outside investors fund a factory when the city keeps exporting crops it cannot process: at
 * least a new factory's monthly intake (4 workers × 2 lots × 30 days) in the last 30 days, and at
 * most one such factory a month.
 */
export const OUTSIDE_INDUSTRY_CROPS = 240;
/** Outside investors only look at an established city: at least this many residents. */
export const OUTSIDE_INDUSTRY_POPULATION = 20;
/** Crop lots exported in the last 30 days and whether outside investors already funded a factory this month. */
function idleCrops(c: City): { exported: number; recentOutside: boolean } {
  let exported = 0, recentOutside = false;
  for (let i = c.cropLedger.length - 1; i >= 0 && c.cropLedger[i].tick > c.tick - MONTH; i--) if (c.cropLedger[i].kind === 'export') exported += c.cropLedger[i].quantity;
  for (let i = c.ledger.length - 1; i >= 0 && c.ledger[i].tick > c.tick - MONTH; i--) if (/^Outside industry equity #/.test(c.ledger[i].reason)) recentOutside = true;
  return { exported, recentOutside };
}
export function industryGrowthStatus(c: City) {
  const industries = c.firms.filter(f => f.zone === 'I').sort((a, b) => a.id - b.id);
  const fundedVacancies = admissionFacts(c).vacancies;
  const cropAvailable = c.firms.filter(f => (f.zone === 'F' || isMarket(f)) && access(c, building(c, f.building).cell) && firmWorkerCount(c, f.id) > 0).reduce((n, f) => n + f.cropInventory, 0);
  const facts = (f?: Firm) => {
    const cash = f ? balance(c, f.wallet) : 0, payrollReserve = f ? payroll(f) : 0;
    const taxReserve = f ? Math.floor(Math.max(0, f.monthlyRevenue - f.monthlyExpense - payrollReserve) / 5) : 0;
    const rentReserve = 10_000, workingReserve = INDUSTRY_WORKING_RESERVE;
    return { sponsorFirmId: f?.id ?? null, cash, payrollReserve, taxReserve, rentReserve, workingReserve,
      requiredCapital: INDUSTRY_STARTUP_CAPITAL, availableCapital: Math.max(0, cash - payrollReserve - taxReserve - rentReserve - workingReserve) };
  };
  const profitable = industries.filter(f => access(c, building(c, f.building).cell) && firmWorkerCount(c, f.id) === capacity(building(c, f.building)) && f.lastMonthProfit > 0 && f.profit > 0 && f.cropInventory >= 2);
  const funded = profitable.find(f => facts(f).availableCapital >= INDUSTRY_STARTUP_CAPITAL);
  const chosen = funded ?? [...profitable].sort((a, b) => facts(b).availableCapital - facts(a).availableCapital || a.id - b.id)[0] ?? industries[0];
  const finance = facts(chosen), bootstrap = industries.length === 0;
  const idle = idleCrops(c), residents = c.households.reduce((n, h) => n + h.members, 0);
  const outside = !bootstrap && !funded && residents >= OUTSIDE_INDUSTRY_POPULATION && idle.exported >= OUTSIDE_INDUSTRY_CROPS && !idle.recentOutside;
  const result = (code: string, reason: string, ready = false) => ({ ...finance, bootstrap, outside: ready && code === 'growth.outside-investor', code, reason, ready, eligible: ready, fundedVacancies, cropAvailable, exportedCrops: idle.exported });
  const spare = utilities(c).spare, factoryNeed = buildingNeed('I', 1);
  if (!fits(spare, factoryNeed)) return result('growth.utilities-unavailable', `A new factory needs ${factoryNeed.power} power and ${factoryNeed.water} water units; the network has ${spare.power} and ${spare.water} spare. Build a power plant or water pump on road frontage.`);
  if (!c.cells.some((p, i) => p.zone === 'I' && p.building === null && access(c, i))) return result('growth.no-industrial-parcel', 'Zone an empty connected industrial parcel before commissioning paid jobs.');
  if (bootstrap) return result('growth.bootstrap', 'Only the first factory uses the existing named outside-equity bootstrap; no workers are fabricated.', true);
  if (fundedVacancies > 0) return result('growth.vacancies-remain', `Fill ${fundedVacancies} existing funded paid vacancies before another factory is commissioned.`);
  const room = vacantHomes(c).some(b => canAccommodate(housingCapacity(b), homeOccupancy(c, b.id), 3));
  const residentialSite = c.cells.some((p, i) => p.zone === 'R' && p.building === null && access(c, i));
  const availableManufacturing = c.households.some(h => householdAccess(c, h) && (['general', 'manufacturing'] as const).some(skill => h.workerSkills[skill] > c.employment.filter(e => e.householdId === h.id && e.skill === skill).reduce((n, e) => n + e.workers, 0) + c.ownerLabor.filter(e => e.householdId === h.id && e.skill === skill).length));
  if (!room && !residentialSite && !availableManufacturing) return result('growth.housing-unavailable', 'New paid jobs need an available home, a connected residential parcel, or an eligible existing unemployed worker.');
  if (cropAvailable < 8) return result('growth.no-crop-buffer', `Industry investment needs 8 real accessible crop lots for a startup batch; have ${cropAvailable}. No input is gifted.`);
  if (outside) return result('growth.outside-investor', `Farms exported ${idle.exported} crop lots in 30 days that no factory here could use; outside investors fund ${INDUSTRY_STARTUP_CAPITAL} satang of new factory capital.`, true);
  if (!profitable.length) return result('growth.no-profitable-sponsor', 'A connected, fully staffed factory needs positive realized operating profit and actual inputs before sponsoring an expansion.');
  if (!funded) return result('growth.saving-capital', `Factory #${finance.sponsorFirmId} can invest ${finance.availableCapital}/${INDUSTRY_STARTUP_CAPITAL} satang after earned wages, current tax, rent and working-cash reserves.`);
  return result('growth.ready', `Factory #${finance.sponsorFirmId} can fund ${INDUSTRY_STARTUP_CAPITAL} satang of new paid-job capital from its own cash; wages and reserves remain protected.`, true);
}

export function ownerFinance(c: City, firmId: number) {
  const f = c.firms.find(f => f.id === firmId), owner = f?.owner;
  const h = owner && c.households.find(h => h.id === owner.householdId);
  if (!f || !(isMarket(f) || isRetail(f)) || !owner || !h) return null;
  const currentProfit = f.monthlyRevenue - f.monthlyExpense, taxReserve = Math.floor(Math.max(0, currentProfit) / 5);
  const profit = BigInt(f.profit) + BigInt(currentProfit) - BigInt(owner.taxPaid) - BigInt(owner.withdrawn) - BigInt(taxReserve);
  const distributable = profit <= 0n ? 0 : Number(profit > BigInt(Number.MAX_SAFE_INTEGER) ? BigInt(Number.MAX_SAFE_INTEGER) : profit);
  const contributeAvailable = Math.max(0, Math.min(balance(c, h.wallet), Number.MAX_SAFE_INTEGER - owner.capitalContributed, Number.MAX_SAFE_INTEGER - balance(c, f.wallet)));
  const withdrawAvailable = Math.max(0, Math.min(distributable, spendable(c, f) - 20_000 - taxReserve, Number.MAX_SAFE_INTEGER - owner.withdrawn, Number.MAX_SAFE_INTEGER - balance(c, h.wallet)));
  return { ownerHouseholdId: h.id, capitalContributed: owner.capitalContributed, capitalReturned: owner.capitalReturned,
    withdrawn: owner.withdrawn, taxPaid: owner.taxPaid, realizedProfit: f.profit + currentProfit, distributable, taxReserve,
    contributeAvailable, withdrawAvailable, workingCashFloor: 20_000,
    contributeReason: contributeAvailable >= 10_000 ? 'พร้อมเติมทุนจากเงินครัวเรือนจริง' : 'เงินครัวเรือนไม่พอเติมทุน 100 ฿',
    withdrawReason: withdrawAvailable >= 10_000 ? 'ถอนจากกำไรที่เกิดขึ้นจริงได้' : 'ต้องมีกำไรหลังสำรองภาษีและเงินหมุนเวียน 200 ฿' };
}
export function contributeOwnerCapital(c: City, firmId: number, amount: number): Result {
  const f = c.firms.find(f => f.id === firmId), facts = ownerFinance(c, firmId);
  if (!facts || !f?.owner || !Number.isSafeInteger(amount) || amount <= 0 || amount > facts.contributeAvailable) return { ok: false, message: 'Owner capital contribution rejected; cash and state unchanged.' };
  const h = c.households.find(h => h.id === facts.ownerHouseholdId)!;
  if (transfer(c, h.wallet, f.wallet, amount, 'Owner capital contribution') !== amount) throw new Error('Owner contribution invariant violated.');
  f.owner.capitalContributed += amount;
  return { ok: true, message: `เติมทุน ${(amount / 100).toFixed(2)} ฿ จากครัวเรือน #${h.id} แล้ว` };
}
export function withdrawOwnerProfit(c: City, firmId: number, amount: number): Result {
  const f = c.firms.find(f => f.id === firmId), facts = ownerFinance(c, firmId);
  if (!facts || !f?.owner || !Number.isSafeInteger(amount) || amount <= 0 || amount > facts.withdrawAvailable) return { ok: false, message: 'Owner profit withdrawal rejected; earned profit, tax and working cash must remain sufficient.' };
  const h = c.households.find(h => h.id === facts.ownerHouseholdId)!;
  if (transfer(c, f.wallet, h.wallet, amount, 'Owner profit distribution') !== amount) throw new Error('Owner draw invariant violated.');
  f.owner.withdrawn += amount;
  return { ok: true, message: `ถอนกำไร ${(amount / 100).toFixed(2)} ฿ เข้าครัวเรือน #${h.id} แล้ว` };
}
/** One raw market per six households, once a real farm and a household owner exist. */
function marketDemand(c: City): number {
  return c.firms.some(f => f.zone === 'F') && ownerCandidate(c) ? Math.max(0, Math.ceil(c.households.length / 6) - c.firms.filter(isMarket).length) : 0;
}
/**
 * Shops close the finished-goods chain: once a factory with workers is producing, one shop per
 * eight connected households opens with outside equity, buys local wholesale first and employs
 * retail workers. No shop opens for goods the city does not make.
 */
export function retailDemand(c: City): number {
  const producing = c.firms.some(f => f.zone === 'I' && access(c, building(c, f.building).cell) && firmWorkerCount(c, f.id) > 0);
  const buyers = c.households.filter(h => householdAccess(c, h)).length;
  if (!producing || buyers < 4) return 0;
  const shops = c.firms.filter(isRetail);
  const expanded = shops.filter(f => building(c, f.building).level > RETAIL_LEGACY_MAX_LEVEL);
  if (!expanded.length) return Math.max(0, Math.ceil(buyers / 8) - shops.length);
  // Each existing shop still counts as one even if closed, as in the original rule.
  // Additional coverage is credited only when the shop is supplied and stocked, and
  // only for employed workers above the legacy level-four staff.
  const svc = utilities(c);
  const extra = expanded.reduce((n, f) => {
    const b = building(c, f.building), workers = f.inventory > 0 && access(c, b.cell) && svc.ok(b.id) ? firmWorkerCount(c, f.id) : 0;
    return n + Math.max(0, staffedRetailCapacity(b.level, workers).householdCoverage - 8);
  }, 0);
  return Math.max(0, Math.ceil((buyers - 8 * shops.length - extra) / 8));
}
/** The lowest-id connected household with 600 credits of savings and a general/retail worker that owns nothing yet. */
function ownerCandidate(c: City): Household | undefined {
  return [...c.households].sort((a, b) => a.id - b.id).find(h => householdAccess(c, h) && balance(c, h.wallet) >= 60_000 &&
    h.workerSkills.general + h.workerSkills.retail > 0 && !c.firms.some(f => f.owner?.householdId === h.id));
}
function reserveOwnerLabor(c: City): void {
  c.ownerLabor = [];
  const svc = utilities(c);
  for (const f of [...c.firms].filter(f => (isMarket(f) || isRetail(f)) && f.owner).sort((a, b) => a.id - b.id)) {
    const h = c.households.find(h => h.id === f.owner!.householdId);
    if (!h || !householdAccess(c, h) || !access(c, building(c, f.building).cell) || !svc.ok(f.building)) continue;
    const skill = h.workerSkills.retail > 0 ? 'retail' : 'general';
    if (h.workerSkills[skill] <= c.ownerLabor.filter(e => e.householdId === h.id && e.skill === skill).length) continue;
    c.ownerLabor.push({ householdId: h.id, firmId: f.id, skill, workers: 1 });
  }
  // Changing into self-employment never deletes already earned wage claims.
  for (const h of c.households) for (const skill of ['general', 'manufacturing', 'retail'] as const) {
    let remaining = h.workerSkills[skill] - c.ownerLabor.filter(e => e.householdId === h.id && e.skill === skill).length;
    for (const e of c.employment.filter(e => e.householdId === h.id && e.skill === skill).sort((a, b) => a.firmId - b.firmId)) {
      const kept = Math.min(remaining, e.workers); e.workers = kept; remaining -= kept;
    }
  }
  c.employment = c.employment.filter(e => e.workers > 0);
  if (!c.parks.length) return;
  // New owners may claim a worker after today's park shift. Keep earned pay, release
  // only the assignment that conflicts with the real remaining skill pool.
  for (const h of c.households) for (const skill of ['general', 'manufacturing', 'retail'] as const) {
    let left = h.workerSkills[skill] - [...c.employment, ...c.ownerLabor].filter(a => a.householdId === h.id && a.skill === skill).reduce((n, a) => n + a.workers, 0);
    for (const p of [...c.parks].sort((a, b) => a.id - b.id)) if (p.staffing) {
      for (const a of p.staffing.allocations.filter(a => a.householdId === h.id && a.skill === skill)) { a.workers = Math.min(a.workers, Math.max(0, left)); left -= a.workers; }
      p.staffing.allocations = p.staffing.allocations.filter(a => a.workers > 0);
    }
  }
}

/** Every transfer has a debit and credit. Outside is the sole permitted negative source account. */
function transfer(c: City, from: string, to: string, amount: number, reason: string, operating = false): number {
  const firm = c.firms.find(f => f.wallet === from);
  const available = from === 'outside' ? amount : from === 'treasury' ? treasurySpendable(c) : firm ? spendable(c, firm) : balance(c, from);
  const paid = Math.max(0, Math.min(Math.round(amount), available));
  if (!Number.isSafeInteger(paid) || paid === 0) return 0;
  c.accounts[from] = balance(c, from) - paid;
  c.accounts[to] = balance(c, to) + paid;
  c.ledger.push({ tick: c.tick, from, to, amount: paid, reason });
  if (operating) {
    const seller = c.firms.find(f => f.wallet === to), buyer = c.firms.find(f => f.wallet === from);
    if (seller) seller.monthlyRevenue += paid;
    if (buyer) buyer.monthlyExpense += paid;
  }
  return paid;
}
function goodsTransfer(c: City, from: string, to: string, quantity: number, reason: string, product: ProductId) {
  if (quantity > 0) c.goodsLedger.push({ tick: c.tick, from, to, quantity, reason, product });
}
/** Move finished goods between firm shelves, keeping each firm's product mix with its total. */
function moveProduct(c: City, from: Firm | null, to: Firm | null, product: ProductId, quantity: number) {
  if (from) { from.products[product] -= quantity; from.inventory -= quantity; }
  if (to) { to.products[product] += quantity; to.inventory += quantity; }
}
/** Existing saves without a mode retain their current crop as a manual choice. */
export const farmCropMode = (f: Pick<Firm, 'cropMode'>): 'auto' | 'manual' => f.cropMode ?? 'manual';
export function farmCrop(c: City, f: Pick<Firm, 'building'> & Partial<Pick<Firm, 'cropChoices'>>): CropId {
  return f.cropChoices?.at(-1)?.crop ?? cropForFertility(c.resources.fertility[building(c, f.building).cell]) ?? 'rice';
}
/** Choose the least represented crop, ties resolved in catalog order; never mutate the city. */
export function automaticFarmCrop(c: City, excludeFirmId?: number): CropId {
  const counts = Object.fromEntries(CROPS.map(crop => [crop, 0])) as Record<CropId, number>;
  for (const f of c.firms) if (f.zone === 'F' && f.id !== excludeFirmId) counts[farmCrop(c, f)]++;
  return [...CROPS].sort((a, b) => counts[a] - counts[b] || CROPS.indexOf(a) - CROPS.indexOf(b))[0];
}
/** Selecting auto makes a fresh automatic choice; selecting a crop fixes it manually. */
export function selectFarmCrop(c: City, firmId: number, choice: CropId | 'auto'): Result {
  const f = c.firms.find(f => f.id === firmId && f.zone === 'F');
  if (!f || (choice !== 'auto' && !CROPS.includes(choice))) return { ok: false, message: 'ไม่พบฟาร์มหรือชนิดพืชไม่ถูกต้อง' };
  const crop = choice === 'auto' ? automaticFarmCrop(c, firmId) : choice;
  if (farmCrop(c, f) !== crop) (f.cropChoices ??= []).push({ at: c.cropLedger.length, crop });
  f.cropMode = choice === 'auto' ? 'auto' : 'manual';
  return { ok: true, message: choice === 'auto' ? 'เลือกพืชอัตโนมัติแล้ว' : 'เลือกพืชสำหรับการเก็บเกี่ยวครั้งถัดไปแล้ว' };
}
/** Lots a day a new four-worker factory needs. */
const NEW_FACTORY_LOTS = 8;
/**
 * The recipe for a new factory. Spare supply is each crop's farm harvest at full staffing minus
 * what factories already running its recipe use. Among crops that can feed a new factory, the
 * product the fewest factories make wins (the city's shelves get variety), then the larger
 * surplus; with no crop to spare, the largest surplus; ties and an empty map go to the rice mill.
 */
export function chooseRecipe(c: City, factories: readonly Firm[] = c.firms.filter(f => f.zone === 'I' && f.recipe)): RecipeId {
  const spare = emptyCrops(), making = emptyCrops();
  for (const f of c.firms) if (f.zone === 'F' && access(c, building(c, f.building).cell)) spare[farmCrop(c, f)] += Math.floor(24 * Math.max(50, c.resources.fertility[building(c, f.building).cell]) / 100) * building(c, f.building).level;
  for (const f of factories) if (f.recipe) { spare[RECIPE[f.recipe].crop] -= capacity(building(c, f.building)) * 2; making[RECIPE[f.recipe].crop]++; }
  const order = (a: CropId, b: CropId) => spare[b] - spare[a] || CROPS.indexOf(a) - CROPS.indexOf(b);
  const fed = CROPS.filter(k => spare[k] >= NEW_FACTORY_LOTS).sort((a, b) => making[a] - making[b] || order(a, b));
  return recipeForCrop(fed[0] ?? [...CROPS].sort(order)[0]);
}

/** Select a recipe for future processing while retaining all existing stocks. */
export function selectFactoryRecipe(c: City, firmId: number, choice: RecipeId | 'auto'): Result {
  const f = c.firms.find(f => f.id === firmId && f.zone === 'I');
  if (!f || !f.recipe || (choice !== 'auto' && !RECIPES.includes(choice))) return { ok: false, message: 'ไม่พบโรงงานหรือสูตรไม่ถูกต้อง' };
  const recipe = choice === 'auto' ? chooseRecipe(c, c.firms.filter(other => other.zone === 'I' && other.id !== f.id && other.recipe)) : choice;
  if (recipe !== f.recipe) { (f.recipeChoices ??= [{ at: 0, recipe: f.recipe }]).push({ at: c.cropLedger.length, recipe }); f.recipe = recipe; }
  f.recipeMode = choice === 'auto' ? 'auto' : 'manual';
  return { ok: true, message: choice === 'auto' ? 'เลือกสูตรอัตโนมัติแล้ว' : 'เลือกสูตรโรงงานแล้ว' };
}

// Road topology does not change during a synchronous simulation step or summary.
// Scope this cache to those operations rather than the lifetime of a mutable City:
// callers may directly edit cells or replace a loaded city between operations.
const roadScopes = new WeakMap<City, Set<number>>();
/** Use only for synchronous work that does not modify road topology. */
export function withRoadScope<T>(c: City, run: () => T): T {
  if (roadScopes.has(c)) return run();
  roadScopes.set(c, connectedRoads(c));
  try { return run(); } finally { roadScopes.delete(c); }
}
export function connectedRoads(c: City): Set<number> {
  const scoped = roadScopes.get(c);
  // Public callers own their Set and cannot corrupt the shared scope.
  if (scoped) return new Set(scoped);
  const seen = new Set<number>();
  if (!c.cells[GATEWAY].road) return seen;
  const queue = [GATEWAY]; seen.add(GATEWAY);
  for (let q = 0; q < queue.length; q++) for (const n of neighbors(queue[q])) {
    if (roadLinked(c, queue[q], n) && !seen.has(n)) { seen.add(n); queue.push(n); }
  }
  return seen;
}
export function access(c: City, i: number): boolean {
  if (!validIndex(i)) return false;
  const connected = roadScopes.get(c) ?? connectedRoads(c);
  return c.cells[i].road ? connected.has(i) : neighbors(i).some(n => connected.has(n));
}
export function roadPath(a: number, b: number): number[] {
  if (!validIndex(a) || !validIndex(b)) return [];
  let x = a % SIZE, z = Math.floor(a / SIZE);
  const targetX = b % SIZE, targetZ = Math.floor(b / SIZE), path = [a];
  while (x !== targetX) { x += Math.sign(targetX - x); path.push(z * SIZE + x); }
  while (z !== targetZ) { z += Math.sign(targetZ - z); path.push(z * SIZE + x); }
  return path;
}
export function buildRoad(c: City, a: number, b: number): Result {
  const path = roadPath(a, b);
  if (!path.length) return { ok: false, message: 'Road is outside the bounded map.' };
  if (path.some(i => parkAt(c, i))) return { ok: false, message: 'มีสวนสาธารณะขวางทาง ต้องรื้อก่อนสร้างถนน' };
  if (path.some(i => c.cells[i].building !== null || plantAt(c, i))) return { ok: false, message: 'A building or plant blocks this road. Bulldoze it first.' };
  const added = path.filter(i => !c.cells[i].road), cost = added.length * ROAD_COST;
  if (treasurySpendable(c) < cost) return { ok: false, message: `Need ${(cost / 100).toFixed(0)} credits for this road.` };
  if (!added.length) return { ok: true, message: 'Road already exists; no charge.' };
  transfer(c, 'treasury', 'roadworks', cost, `Build ${added.length} road cells`);
  for (const i of added) { c.cells[i].road = true; c.cells[i].zone = null; }
  const message = access(c, b) ? `Built ${added.length} road cells.` : 'Road built, but disconnected from the west outside gateway. Adjacent zones cannot grow.';
  c.lastEvent = message;
  return { ok: true, message };
}
/** Selected parallel paths do not join every adjacent side. Existing roads remain legacy until explicitly edited. */
export function buildParallelRoad(c: City, a: number, b: number, oneWay = false): Result {
  const path=roadPath(a,b);
  if(path.length<2)return {ok:false,message:'เลือกจุดเริ่มและจุดจบต่างกันเพื่อกำหนดแนวถนน'};
  // One-way corners need a dedicated junction cell; this first tool builds straight carriageways.
  if(oneWay && a%SIZE!==b%SIZE && Math.floor(a/SIZE)!==Math.floor(b/SIZE))return {ok:false,message:'ถนนวันเวย์ลากเป็นเส้นตรง แล้วเชื่อมทางเลี้ยวด้วยเครื่องมือทางแยก'};
  const added=new Set(path.filter(i=>!c.cells[i].road)),result=buildRoad(c,a,b);
  if(!result.ok)return result;
  configureRoadPath(c,path,added,oneWay);
  c.lastEvent=oneWay?'สร้างถนน 2 เลนวันเวย์ตามลูกศรแล้ว · เชื่อมทางแยกเอง':'จัดถนนคู่ขนานแล้ว · จุดด้านข้างแยกจากกัน เลือกเชื่อมทางแยกเอง';
  return {ok:true,message:c.lastEvent};
}
export function editRoadJunction(c:City,a:number,b:number,connect:boolean):Result {
  if(!setRoadJunction(c,a,b,connect))return {ok:false,message:'เลือกถนนสองช่องที่ติดกันด้านข้าง ไม่ใช่แนวทแยง'};
  c.lastEvent=connect?'เชื่อมทางแยกแล้ว · รถยังต้องตามทิศลูกศร':'แยกทางเชื่อมแล้ว · ตรวจทางออกและน้ำไฟของเมือง';
  return {ok:true,message:c.lastEvent};
}
export function zoneCell(c: City, i: number, zone: Zone): Result {
  if (!validIndex(i) || ![null, 'R', 'C', 'I', 'F'].includes(zone)) return { ok: false, message: 'Invalid parcel or zone.' };
  const cell = c.cells[i];
  if (cell.road) return { ok: false, message: 'Road cells cannot be zoned.' };
  if (parkAt(c, i)) return { ok: false, message: 'มีสวนสาธารณะอยู่ ต้องรื้อก่อนวางโซน' };
  if (plantAt(c, i)) return { ok: false, message: 'A water or power plant stands here. Bulldoze it before zoning.' };
  if (cell.building !== null && cell.zone !== zone) return { ok: false, message: 'Bulldoze the existing building before rezoning.' };
  cell.zone = zone;
  const message = !zone ? 'Zone cleared.' : access(c, i) ? `${zone} zone marked. Growth is evaluated every 3 days.` : `${zone} zone marked, but no connected road frontage. Link a neighboring road to the west gateway.`;
  c.lastEvent = message;
  return { ok: true, message };
}
export function bulldoze(c: City, i: number): Result {
  if (!validIndex(i)) return { ok: false, message: 'Outside the map.' };
  if (i === GATEWAY) return { ok: false, message: 'The outside gateway is reserved.' };
  const cell = c.cells[i], b = c.buildings.find(v => v.id === cell.building), plant = plantAt(c, i), park = parkAt(c, i);
  const cost = b || cell.road || plant || park ? 2_000 : 0;
  if (treasurySpendable(c) < cost) return { ok: false, message: 'Need 20 credits for demolition.' };
  if (park) {
    payParkWages(c, park);
    transfer(c, 'treasury', 'construction', cost, `Demolish park #${park.id}`);
    c.parks = c.parks.filter(p => p !== park);
    c.lastEvent = `รื้อสวนสาธารณะ #${park.id} แล้ว · ค่ารื้อ 20 · หยุดค่าบำรุงของสวนนี้`;
    return { ok: true, message: c.lastEvent };
  }
  if (plant) {
    transfer(c, 'treasury', 'construction', cost, `Demolish ${PLANT_NAMES[plant.kind]} #${plant.id}`);
    c.plants = c.plants.filter(p => p !== plant);
    c.lastEvent = `${PLANT_NAMES[plant.kind]} #${plant.id} removed: the network loses ${PLANTS[plant.kind].capacity} ${plant.kind} units; the farthest buildings go without first.`;
    return { ok: true, message: c.lastEvent };
  }
  const closingFirms = b ? c.firms.filter(f => f.building === b.id) : [];
  for (const f of closingFirms) {
    const tax = Math.floor(Math.max(0, f.monthlyRevenue - f.monthlyExpense - payroll(f) - f.cropCost) / 5);
    if (spendable(c, f) < tax) return { ok: false, message: 'Closure needs enough cash to settle earned wages and current profit tax; no demolition was charged.' };
    if (!writeOffCrops(c, f, agricultureHooks(c))) return { ok: false, message: 'Crop disposal could not be journaled; business and city retained.' };
  }
  const fundedClosing = closingFirms.find(f => f.fundedBy);
  transfer(c, 'treasury', 'construction', cost, fundedClosing ? `Funded industry demolition #${fundedClosing.id}` : 'Demolition');
  if (b) {
    const displaced = c.households.filter(h => h.home === b.id), closing = c.firms.filter(f => f.building === b.id);
    for (const h of displaced) h.home = null;
    const displacedIds = new Set(displaced.map(h => h.id));
    c.employment = c.employment.filter(e => !displacedIds.has(e.householdId));
    c.ownerLabor = c.ownerLabor.filter(e => !displacedIds.has(e.householdId));
    for (const f of closing) closeFirm(c, f);
    c.buildings = c.buildings.filter(v => v.id !== b.id);
  }
  forgetRoadTopology(c, i);
  cell.road = false; cell.zone = null; cell.building = null;
  c.lastEvent = 'Parcel cleared. Disconnected buildings stop recruiting, trading and growing.';
  return { ok: true, message: c.lastEvent };
}

/**
 * The city builds a plant on an empty parcel with connected road frontage, paid from the treasury.
 * Its units join the network along the roads; upkeep is charged each month.
 */
export function buildPlant(c: City, i: number, kind: UtilityKind): Result {
  if (!validIndex(i) || !UTILITY_KINDS.includes(kind)) return { ok: false, message: 'Invalid parcel or plant.' };
  const cell = c.cells[i], plant = PLANTS[kind];
  if (cell.road || cell.building !== null || plantAt(c, i) || parkAt(c, i)) return { ok: false, message: 'A plant needs an empty parcel; roads, buildings and other plants stay where they are.' };
  if (!access(c, i)) return { ok: false, message: 'A plant needs road frontage connected to the west gateway; its supply travels along the roads.' };
  if (c.plants.length >= MAX_PLANTS || !canAllocateIds(c, 1)) return { ok: false, message: `Plant limit (${MAX_PLANTS}) reached.` };
  if (treasurySpendable(c) < plant.cost) return { ok: false, message: `Need ${plant.cost / 100} credits for a ${PLANT_NAMES[kind]}.` };
  const id = c.nextId++;
  transfer(c, 'treasury', 'construction', plant.cost, `Build ${PLANT_NAMES[kind]} #${id}`);
  cell.zone = null; c.plants.push({ id, cell: i, kind, tick: c.tick });
  c.lastEvent = `${PLANT_NAMES[kind]} #${id} built: +${plant.capacity} ${kind} units along connected roads; upkeep ${plant.upkeep / 100} credits/month.`;
  return { ok: true, message: c.lastEvent };
}

/** One empty, unzoned parcel. Parks need neither roads nor utility supply. */
export function buildPark(c: City, i: number): Result {
  if (!validIndex(i)) return { ok: false, message: 'ตำแหน่งสวนอยู่นอกแผนที่' };
  const cell = c.cells[i];
  if (cell.road || cell.zone !== null || cell.building !== null || plantAt(c, i) || parkAt(c, i)) return { ok: false, message: 'สวนต้องใช้แปลงว่าง 1 ช่อง ล้างโซนหรือรื้อสิ่งเดิมก่อน' };
  if (c.parks.length >= MAX_PARKS || !canAllocateIds(c, 1)) return { ok: false, message: `สร้างสวนเพิ่มไม่ได้ (สูงสุด ${MAX_PARKS} แห่ง)` };
  if (treasurySpendable(c) < PARK.cost) return { ok: false, message: `เงินคลังไม่พอ สวนใช้ ${PARK.cost / 100}` };
  const id = c.nextId++;
  transfer(c, 'treasury', 'construction', PARK.cost, `Build park #${id}`);
  c.parks.push({ id, cell: i, tick: c.tick, level: 1 });
  c.lastEvent = `สร้างสวนสาธารณะ #${id} แล้ว · เลเวล 1 · 1 ช่อง · ไม่ต้องติดถนน`;
  return { ok: true, message: c.lastEvent };
}

/** Settle and remove one firm (its crops are already written off): wages, current tax, owner or sponsor capital, stock to outside. */
function closeFirm(c: City, f: Firm) {
  payWages(c, f);
  const paidTax = transfer(c, f.wallet, 'treasury', Math.floor(Math.max(0, f.monthlyRevenue - f.monthlyExpense) / 5), 'Closing firm profit tax');
  if (f.owner) {
    f.owner.taxPaid += paidTax;
    const h = c.households.find(h => h.id === f.owner!.householdId)!;
    const capital = Math.min(balance(c, f.wallet), f.owner.capitalContributed - f.owner.capitalReturned);
    f.owner.capitalReturned += transfer(c, f.wallet, h.wallet, capital, 'Closing owner capital return');
    f.owner.withdrawn += transfer(c, f.wallet, h.wallet, balance(c, f.wallet), 'Closing owner profit distribution');
  } else if (f.fundedBy) transfer(c, f.wallet, `firm:${f.fundedBy.firmId}`, balance(c, f.wallet), `Industry expansion residual return #${f.id}`);
  else transfer(c, f.wallet, 'outside', balance(c, f.wallet), 'Firm liquidation');
  for (const product of PRODUCTS) { const n = f.products[product]; goodsTransfer(c, f.wallet, 'outside', n, 'Demolition stock write-off to outside', product); moveProduct(c, f, null, product, n); c.goods.exported += n; }
  c.employment = c.employment.filter(e => e.firmId !== f.id);
  c.ownerLabor = c.ownerLabor.filter(e => e.firmId !== f.id);
  c.firms = c.firms.filter(x => x !== f);
}
/** A dead business: no cash left and nobody working. */
export const deadFirm = (c: City, f: Firm): boolean => balance(c, f.wallet) === 0 && firmWorkerCount(c, f.id) === 0;
/** What a new owner pays to refit taken-over premises (outside equity); a household owner pays the usual 100-credit opening. */
export const TAKEOVER_REFIT = 20_000;
/** Choose a recipe only when an operating supplier has matching stock or can grow it. */
export function factoryTakeoverRecipe(c: City, old: Firm): RecipeId | null {
  if (old.zone !== 'I' || !deadFirm(c, old)) return null;
  const service = utilities(c);
  const suppliers = c.firms.filter(f => (f.zone === 'F' || isMarket(f)) && access(c, building(c, f.building).cell) && service.ok(f.building) && firmWorkerCount(c, f.id) > 0);
  const available = (crop: CropId) => suppliers.reduce((sum, f) => sum + f.crops[crop], 0) >= CROP_RECIPE.crop || suppliers.some(f => f.zone === 'F' && farmCrop(c, f) === crop);
  const preferred = chooseRecipe(c, c.firms.filter(f => f.zone === 'I' && f.id !== old.id && f.recipe));
  if (available(RECIPE[preferred].crop)) return preferred;
  const crop = CROPS.find(available);
  return crop ? recipeForCrop(crop) : null;
}
/**
 * At month end a dead business closes and a new one takes over the same premises, so the player
 * never has to bulldoze and rezone: a saving household takes a market or shop (outside equity takes
 * a shop when no household can), outside investors take a farm or factory. The building keeps its
 * parcel and level; the new firm has a new id and wallet, and a factory picks a fresh recipe. It
 * waits while the premises lack a connected road, water or power, or a market finds no owner.
 */
function takeOver(c: City) {
  const taken: string[] = [];
  for (const old of [...c.firms].sort((a, b) => a.id - b.id)) {
    if (!c.firms.includes(old) || !deadFirm(c, old)) continue;
    const b = building(c, old.building), owner = old.zone === 'C' ? ownerCandidate(c) : undefined;
    if (!access(c, b.cell) || !utilities(c).ok(b.id) || !canAllocateIds(c, 1) || isMarket(old) && !owner) continue;
    const recipe = old.zone === 'I' ? factoryTakeoverRecipe(c, old) : null;
    if (old.zone === 'I' && !recipe) continue;
    if (!writeOffCrops(c, old, agricultureHooks(c))) continue;
    const funded = old.fundedBy, retail = isRetail(old);
    closeFirm(c, old);
    const fid = c.nextId++, wallet = `firm:${fid}`;
    c.firms.push({ id: fid, building: b.id, zone: old.zone, ...(old.zone === 'I' ? { recipe: recipe! } : old.zone === 'F' ? { cropMode: farmCropMode(old), cropChoices: [{ at: c.cropLedger.length, crop: farmCrop(c, old) }] } : {}), crops: emptyCrops(), products: emptyProducts(), ...(old.commercialKind ? { commercialKind: old.commercialKind } : {}), takenOverAt: c.tick,
      wallet, workDays: {}, inventory: 0, cropInventory: 0, cropCost: 0, productionTick: c.tick,
      owner: owner ? { householdId: owner.id, capitalContributed: OWNER_STARTUP_CAPITAL, capitalReturned: 0, withdrawn: 0, taxPaid: 0 } : null,
      profit: 0, lastMonthProfit: 0, monthlyRevenue: 0, monthlyExpense: 0 });
    const capital = owner ? OWNER_STARTUP_CAPITAL : INDUSTRY_STARTUP_CAPITAL;
    if (transfer(c, owner ? owner.wallet : 'outside', wallet, capital, owner ? 'Owner capital contribution' : old.zone === 'F' ? 'Outside farm equity investment' : old.zone === 'I' ? `Outside industry equity #${fid}` : 'Outside firm equity investment') !== capital) throw new Error('Takeover capital invariant violated.');
    transfer(c, wallet, 'construction', owner ? 10_000 : TAKEOVER_REFIT, owner ? retail ? 'Self-employed shop construction' : 'Self-employed market construction' : funded ? `Funded industry takeover #${old.id}` : `Business takeover refit #${fid}`);
    if (owner) reserveOwnerLabor(c);
    taken.push(`#${old.id} → #${fid} (${owner ? `household #${owner.id}` : 'outside investors'})`);
  }
  if (taken.length) c.lastEvent = `Dead business taken over: ${taken.join(', ')}. The premises stay; the new owner starts with fresh capital.`;
}

export function summary(c: City) {
  return withRoadScope(c, () => summarize(c));
}
function summarize(c: City) {
  const svc = utilities(c);
  const jobs = c.firms.filter(f => access(c, building(c, f.building).cell) && svc.ok(f.building)).reduce((n, f) => n + capacity(building(c, f.building)), 0) + c.parks.length * PARK_STAFF.slots;
  const employed = c.employment.reduce((n, e) => n + e.workers, 0) + c.ownerLabor.length + parkEmployment(c).reduce((n, a) => n + a.workers, 0);
  const workforce = c.households.reduce((n, h) => n + h.workforce, 0);
  const availableWorkers = c.households.filter(h => householdAccess(c, h)).reduce((n, h) => n + h.workforce - householdWorkerCount(c, h.id), 0);
  const recent = c.ledger.filter(e => e.tick > Math.max(0, c.tick - MONTH) && !e.reason.includes('grant'));
  const net = recent.reduce((n, e) => n + (e.to === 'treasury' ? e.amount : 0) - (e.from === 'treasury' ? e.amount : 0), 0);
  const homes = c.buildings.filter(b => b.zone === 'R');
  const occupied = buildOccupancyIndex(c.households), admission = admissionFacts(c);
  // Every catalog profile has at most 3 members and every slot provides 4-person capacity.
  // Count usable existing slots before commissioning more houses, including a newly built empty home.
  const vacantSlots = homes.filter(b => access(c, b.cell)).reduce((n, b) => {
    const room = housingCapacity(b), used = occupied.get(b.id) ?? { households: 0, persons: 0 };
    return n + Math.max(0, Math.min(room.households - used.households, Math.floor((room.persons - used.persons) / 3)));
  }, 0);
  const homeless = c.households.filter(h => h.home === null).length;
  const incoming = Math.min(MAX_CITY_HOUSEHOLDS - c.households.length, Math.max(0, 2 - c.migration.arrivals, Math.ceil(Math.max(0, admission.vacancies - availableWorkers) / 2)));
  // Open jobs people can take now (a seat and a wage the firm can pay) vs seats a firm cannot fund.
  const seats = c.firms.filter(f => !isMarket(f) && access(c, building(c, f.building).cell) && svc.ok(f.building)).reduce((n, f) => n + Math.max(0, capacity(building(c, f.building)) - firmWorkerCount(c, f.id)), 0);
  const farms = c.firms.filter(f => f.zone === 'F');
  // Once expanded farms can cover aggregate demand, an absent crop can still
  // leave a product unavailable to real customers. Only the new-tier path
  // adds this signal; existing farm choices and the old-tier rules stay intact.
  const missingCropForBuyers = farms.some(f => building(c, f.building).level > 3) &&
    c.households.some(h => householdAccess(c, h) && balance(c, h.wallet) >= 800) &&
    c.firms.some(f => isRetail(f) && access(c, building(c, f.building).cell) && svc.ok(f.building) && firmWorkerCount(c, f.id) > 0) &&
    CROPS.some(crop => !farms.some(f => farmCrop(c, f) === crop));
  return { population: c.households.reduce((n, h) => n + h.members, 0), households: c.households.length, workforce, openJobs: admission.vacancies + c.parks.reduce((n, p) => n + parkStaffingStatus(c, p).fundedVacancies, 0), unfundedJobs: Math.max(0, seats - admission.vacancies) + c.parks.reduce((n, p) => n + parkStaffingStatus(c, p).unfundedVacancies, 0),
    dependents: c.households.reduce((n, h) => n + h.dependents, 0), jobs, employed, unemployed: workforce - employed,
    homeless, homeSlots: homes.reduce((n, b) => n + housingCapacity(b).households, 0),
    personCapacity: homes.reduce((n, b) => n + housingCapacity(b).persons, 0), treasury: balance(c, 'treasury'), net,
    demand: { R: Math.max(0, homeless + incoming - vacantSlots), C: marketDemand(c) + retailDemand(c),
      I: industryGrowthStatus(c).ready ? 1 : 0,
      F: (c.firms.some(f => f.zone === 'I' || isMarket(f)) || c.households.some(h => householdAccess(c, h)) && c.cells.some((cell, i) => cell.zone === 'C' && access(c, i))) && (!farms.length || missingCropForBuyers ||
        c.households.reduce((n, h) => n + h.members, 0) + c.firms.filter(f => f.zone === 'I').reduce((n, f) => n + firmWorkerCount(c, f.id) * 2, 0) >
        farms.reduce((n, f) => n + Math.floor(24 * Math.max(50, c.resources.fertility[building(c, f.building).cell]) / 100) * (building(c, f.building).level > 3 ? (access(c, building(c, f.building).cell) && svc.ok(f.building) ? firmWorkerCount(c, f.id) : 0) : 1), 0)) ? 1 : 0 } };
}
function building(c: City, id: number): Building { return c.buildings.find(b => b.id === id)!; }
function blockers(c: City, i: number): string[] {
  const cell = c.cells[i];
  if (!cell.zone) return ['No R/C/I zoning.'];
  const reasons: string[] = [], s = summary(c);
  if (!access(c, i)) reasons.push('No connected road frontage. Connect an adjacent road to the west outside gateway.');
  // A new factory's water and power is part of its growth status below.
  const spare = utilities(c).spare, need = cell.zone === 'R' ? HOUSEHOLD_NEED : buildingNeed(cell.zone, 1);
  if (cell.zone !== 'I') for (const kind of UTILITY_KINDS) if (spare[kind] < need[kind]) reasons.push(`Not enough ${kind}: a new ${cell.zone === 'R' ? 'household' : 'building'} here needs ${need[kind]} unit(s); the network has ${spare[kind]} spare. Build a ${PLANT_NAMES[kind]} on road frontage.`);
  if (!canAllocateIds(c, cell.zone === 'R' ? 1 : 2)) reasons.push('Entity ID range exhausted. No new entity or investment can be created safely.');
  if (c.buildings.length >= 192) reasons.push('Prototype building limit (192) reached.');
  if (cell.zone === 'R') {
    if (s.demand.R <= 0) reasons.push('No housing demand: usable vacant capacity already covers funded job opportunities and displaced households.');
    if (WAGES.C * .9 - 30 * 800 - 10_000 - HOUSEHOLD_BILL <= 0) reasons.push('Expected income cannot cover purchases, rent and the water/power bill.');
  } else {
    if (c.firms.length >= 64) reasons.push('Firm limit (64) reached.');
    if (cell.zone === 'C' && !ownerCandidate(c)) reasons.push('Raw market needs a connected household owner with one general/retail worker and 600 credits of actual capital.');
    if ((cell.zone === 'C' ? marketDemand(c) : s.demand[cell.zone]) <= 0) reasons.push(cell.zone === 'I' ? industryGrowthStatus(c).reason : cell.zone === 'F' ? 'No additional crop demand: current farm capacity covers potential factory and household buyers.' : cell.zone === 'C' ? 'Raw market needs an actual farm, reachable buyers and a household owner with real capital and labour.' : 'No retail demand: existing shops cover the household market.');
  }
  return reasons;
}
export function explainCell(c: City, i: number): string[] {
  const park = parkAt(c, i);
  if (park) return [`สวนสาธารณะ #${park.id} · เลเวล ${park.level} · พื้นที่ 1 ช่อง`, `ค่าบำรุง ${PARK.upkeep / 100} ต่อเดือนจากคลังเมือง · ไม่ต้องติดถนน`, 'รุ่นแรกยังไม่มีพื้นที่บริการหรือโบนัสเศรษฐกิจ'];
  if (!validIndex(i)) return ['Select a parcel inside the 24 × 24 map.'];
  const cell = c.cells[i];
  if (cell.road) return [i === GATEWAY ? 'Reserved outside gateway.' : 'Grid road.', connectedRoads(c).has(i) ? 'Connected to outside market.' : 'Disconnected: no route to the west outside gateway.', 'Road construction 50 credits/cell; upkeep 0.10 credits/day/cell.'];
  if (!cell.zone) return ['Unzoned land. Choose R homes, C commercial level-one markets or I industry, then tap this parcel.', 'Buildings require connected road frontage, power, water, demand and viable expected rent.'];
  if (cell.building === null) {
    const stopped = blockers(c, i), shop = cell.zone === 'C' && retailDemand(c) > 0 && !marketToConvert(c) && shopSite(c) === i;
    if (shop) return [`${cell.zone} zone · vacant`, `Shop site: a factory with workers and connected households want a shop. A saving household or outside equity opens one here on the next shop day (in ${(4 - c.tick % 3) % 3 || 3} day(s)); it buys local wholesale first and hires retail workers.`];
    return [`${cell.zone} zone · vacant`, ...stopped, stopped.length ? 'Growth is blocked until these conditions change.' : `Eligible; a seeded parcel is chosen every 3 days. Next review in ${3 - c.tick % 3} day(s).`, cell.zone === 'C' ? 'Self-employed startup: owner contributes 600 real household credits; construction costs 100 and remaining business cash stays separate. One owner worker is reserved from the same household skill pool.' : 'Bootstrap: first industry may open without workers; first 2 households may arrive without jobs. Private firm equity and arrival savings use the named outside account.'];
  }
  const b = building(c, cell.building), f = c.firms.find(v => v.building === b.id), residents = c.households.filter(v => v.home === b.id);
  const output = [`${({ R: 'Home', C: 'Commercial', I: 'Factory', F: 'Farm' } as const)[b.zone]} #${b.id} · level ${b.level} · age ${b.age} days`, access(c, i) ? 'Connected road frontage.' : 'Disconnected: employment, purchases, production and height growth are suspended.'];
  const svc = utilities(c), supplied = svc.served.get(b.id)!, draws = svc.need.get(b.id)!;
  if (!svc.ok(b.id)) output.push(`No ${UTILITY_KINDS.filter(k => !supplied[k]).join(' or ')}: the network is short or this parcel is off it. Work, production, move-ins and growth here wait until a plant adds capacity.`);
  else output.push(`Water and power: draws ${draws.power} power and ${draws.water} water unit(s); bills ${(buildingBill(svc, b.id) / 100).toFixed(2)} credits/month.`);
  if (b.zone === 'R') {
    const used = homeOccupancy(c, b.id), room = housingCapacity(b);
    output.push(`Actual occupancy: ${used.households}/${room.households} households, ${used.persons}/${room.persons} persons. Upgrades add capacity only.`, ...explainMigration(c, b.id));
    for (const h of residents) output.push(`Household #${h.id}: ${h.members} members, ${h.workforce} workforce, ${householdWorkerCount(c, h.id)} allocated workers; wallet ${(balance(c, h.wallet) / 100).toFixed(2)} credits.${h.origin === 'legacy-v1' ? ' Composition is an explicit minimum assumption from v1.' : ''}`);
  }
  if (f) output.push(`Firm #${f.id}: ${firmWorkerCount(c, f.id)}/${capacity(b)} workers; finished inventory ${f.inventory}; crop inventory ${f.cropInventory}; wallet ${(balance(c, f.wallet) / 100).toFixed(2)} credits; earned wages reserved ${(payroll(f) / 100).toFixed(2)}.`, `Last monthly operating profit ${(f.lastMonthProfit / 100).toFixed(2)} credits.`,
    f.zone === 'F' ? `Renewable crops require actual labour, roads, utilities and fertility; this parcel ${c.resources.fertility[i]}%. ${capacity(b)} worker slots, crop cap ${farmStockCapacity(b.level)}; no manufactured goods.` :
    isMarket(f) ? 'Owner-operated crop trading only: capital and cash remain separate from household savings. Opening stock can supply factories or one household basket; new purchases cannot resell this tick. Unsold stock ties up capital, never creates profit.' :
    f.zone === 'I' ? `Each worker can process 2 actual crop lots into 8 generic goods/day. ${f.cropInventory < 2 ? 'Input shortage: production stopped until crops arrive.' : 'Input stock available.'} Wholesale and outside export 3.50 credits.` : 'Buys goods locally at 3.50 credits or imports at 4.50; competes with crop markets for food at 8 credits per unit.',
    isMarket(f) ? 'Owner labour earns no fabricated salary; explicit distributions use realised profit after tax and working-cash reserves.' : 'Wages accrue per allocated worker-day and are paid each 30-day month. Reserved wages cannot fund stock or expansion.',
    `Rent ${firmRent(f) / 100} credits/month; positive operating profit tax 20%. Self-employed market stalls stay small; farms grow to level 6 from their own profit.`);
  if (f && isRetail(f)) {
    const s = retailGrowthStatus(c, f);
    output.push(`Retail level ${s.level}: ${s.workers}/${s.current.workers} workers; shelf ${f.inventory}/${s.current.stock}, staffed refill limit ${s.staffed.stock}; sales have no fixed daily customer cap.`,
      s.next ? `Next level ${s.level + 1}: ${s.next.workers} workers and ${s.next.stock} stock capacity. ${s.reasons.length ? `Currently unmet: ${s.reasons.join('; ')}.` : 'Current conditions met; reviewed monthly, subject to remaining utility supply.'}` : 'Maximum retail level reached.');
  }
  if (f && retailDemand(c) > 0 && marketToConvert(c)?.id === f.id) output.push(`Shop conversion: the city wants a shop and this profitable stall can pay the ${MARKET_CONVERSION_COST / 100}-credit refit, so it becomes a shop on the next shop day (in ${(4 - c.tick % 3) % 3 || 3} day(s)). Leftover fresh crops are written off.`);
  if (f?.convertedAt !== undefined) output.push(`Converted from a crop market on day ${f.convertedAt}.`);
  return output;
}
function createBuilding(c: City, i: number, shop = false) {
  if (!canAllocateIds(c, c.cells[i].zone === 'R' ? 1 : 2)) { c.lastEvent = 'Entity ID range exhausted; construction and funding were not created.'; return; }
  const zone = c.cells[i].zone!, retail = shop && zone === 'C';
  // A household with savings opens the shop itself and works the counter; otherwise outside equity funds it.
  const owner = zone === 'C' ? ownerCandidate(c) : undefined;
  if (zone === 'C' && !owner && !retail) return;
  const industry = zone === 'I' ? industryGrowthStatus(c) : null;
  if (industry && !industry.ready) return;
  const sponsor = industry && !industry.bootstrap && !industry.outside ? c.firms.find(f => f.id === industry.sponsorFirmId && f.zone === 'I') : undefined;
  if (industry && !industry.bootstrap && !industry.outside && !sponsor) return;
  const id = c.nextId++;
  const b: Building = { id, cell: i, zone, level: retail ? 2 : 1, age: 0, ...(zone === 'R' ? { housingType: 'cottage' as const } : {}) }; c.buildings.push(b); c.cells[i].building = id;
  if (zone === 'R') {
    transfer(c, 'outside', 'construction', 40_000, 'Outside residential developer investment');
  } else {
    const fid = c.nextId++, wallet = `firm:${fid}`;
    c.firms.push({ id: fid, building: id, zone, ...(zone === 'I' ? { recipe: chooseRecipe(c) } : zone === 'F' ? { cropMode: 'auto' as const, cropChoices: [{ at: c.cropLedger.length, crop: automaticFarmCrop(c) }] } : {}), crops: emptyCrops(), products: emptyProducts(), ...(zone === 'C' ? { commercialKind: retail ? 'retail' as const : 'market' as const } : {}), ...(sponsor ? { fundedBy: { firmId: sponsor.id, capital: INDUSTRY_STARTUP_CAPITAL } } : {}), wallet, workDays: {}, inventory: 0, cropInventory: 0, cropCost: 0, productionTick: c.tick,
      owner: owner ? { householdId: owner.id, capitalContributed: 60_000, capitalReturned: 0, withdrawn: 0, taxPaid: 0 } : null,
      profit: 0, lastMonthProfit: 0, monthlyRevenue: 0, monthlyExpense: 0 });
    const paidCapital = transfer(c, sponsor ? sponsor.wallet : owner ? owner.wallet : 'outside', wallet, owner ? OWNER_STARTUP_CAPITAL : INDUSTRY_STARTUP_CAPITAL, sponsor ? `Industry expansion capital #${fid}` : owner ? 'Owner capital contribution' : zone === 'F' ? 'Outside farm equity investment' : retail ? 'Outside firm equity investment' : industry?.outside ? `Outside industry equity #${fid}` : `Outside industry bootstrap equity #${fid}`);
    if (paidCapital !== (owner ? OWNER_STARTUP_CAPITAL : INDUSTRY_STARTUP_CAPITAL)) throw new Error('Commissioned capital invariant violated.');
    transfer(c, wallet, 'construction', owner ? 10_000 : 40_000, owner ? retail ? 'Self-employed shop construction' : 'Self-employed market construction' : 'Firm building investment');
    if (owner) reserveOwnerLabor(c);
  }
  const made = c.firms.find(f => f.building === id), goods = zone === 'I' && made?.recipe ? ` Recipe: ${made.recipe}.` : zone === 'F' ? ` Crop: ${farmCrop(c, { building: id })}.` : '';
  c.lastEvent = `${zone} building #${id} grew: road + utilities + demand + viable expected rent. Initial investment is recorded in the ledger.${goods}`;
}
function employ(c: City) {
  reserveOwnerLabor(c);
  const svc = utilities(c);
  c.employment = allocateEmployment(c.households.map(h => {
    const workerSkills = { ...h.workerSkills };
    for (const e of c.ownerLabor.filter(e => e.householdId === h.id)) workerSkills[e.skill]--;
    return { id: h.id, workforce: h.workforce - c.ownerLabor.filter(e => e.householdId === h.id).length, workerSkills, accessible: householdAccess(c, h) };
  }), c.firms.filter(f => !isMarket(f)).map(f => ({
    id: f.id, zone: f.zone === 'F' ? 'I' as const : f.zone as 'I' | 'C', slots: access(c, building(c, f.building).cell) && svc.ok(f.building) ? capacity(building(c, f.building)) - c.ownerLabor.filter(e => e.firmId === f.id).length : 0,
    budgetWorkers: Math.floor(spendable(c, f) / (firmWage(f) / MONTH)),
  })), c.employment);
  for (const allocation of c.employment) {
    const h = c.households.find(h => h.id === allocation.householdId)!, f = c.firms.find(f => f.id === allocation.firmId)!;
    f.workDays[h.wallet] = (f.workDays[h.wallet] ?? 0) + allocation.workers;
  }
  employParks(c);
}
/** Same allocator, residual disjoint skill counts; no park/home road or utility test. */
function employParks(c: City): void {
  if (!c.parks.length) return;
  const prior = parkEmployment(c).map(a => ({ ...a, firmId: a.parkId, occupation: 'park-maintenance' as const, rank: 'entry' as const }));
  const funding = parkFundedSeats(c);
  const allocations = allocateEmployment(c.households.map(h => {
    const workerSkills = { ...h.workerSkills };
    for (const a of [...c.employment, ...c.ownerLabor].filter(a => a.householdId === h.id)) workerSkills[a.skill] -= a.workers;
    return { id: h.id, workforce: Object.values(workerSkills).reduce((a, b) => a + b, 0), workerSkills, accessible: true };
  }), c.parks.map(p => ({ id: p.id, zone: 'P' as const, slots: PARK_STAFF.slots, budgetWorkers: funding.get(p.id)! })), prior);
  for (const p of c.parks) {
    p.staffing ??= { allocations: [], workDays: {} };
    p.staffing.allocations = allocations.filter(a => a.firmId === p.id).map(a => ({ parkId: p.id, householdId: a.householdId, skill: a.skill, workers: a.workers }));
    for (const a of p.staffing.allocations) {
      const wallet = c.households.find(h => h.id === a.householdId)!.wallet;
      p.staffing.workDays[wallet] = (p.staffing.workDays[wallet] ?? 0) + a.workers;
    }
  }
}
function agricultureHooks(c: City) {
  const roads = connectedRoads(c), svc = utilityService(c, roads);
  return { served: (buildingId: number) => svc.ok(buildingId), connected: (cell: number) => validIndex(cell) && neighbors(cell).some(n => roads.has(n)), workers: (f: Firm) => firmWorkerCount(c, f.id),
    spendable: (f: Firm) => spendable(c, f), transfer: (from: string, to: string, amount: number, reason: string, book = false) => transfer(c, from, to, amount, reason, book),
    goodsTransfer: (from: string, to: string, quantity: number, reason: string, product: ProductId) => goodsTransfer(c, from, to, quantity, reason, product) };
}
export function economicSignals(c: City) {
  const hooks = agricultureHooks(c);
  return c.firms.filter(f => !isRetail(f)).map(f => ({ firmId: f.id, ...agricultureDiagnostic(c, f, hooks) }));
}
function trade(c: City) {
  const active = c.firms.filter(f => access(c, building(c, f.building).cell));
  const hooks = agricultureHooks(c), sellable = runAgriculture(c, hooks);
  // Shops stock every product the city makes, an even share of the shelf each, local wholesale first.
  const made = PRODUCTS.filter(p => active.some(f => f.zone === 'I' && f.recipe && (RECIPE[f.recipe].product === p || f.products[p] > 0)));
  for (const shop of active.filter(f => isRetail(f) && firmWorkerCount(c, f.id) > 0)) {
    const target = Math.min(staffedRetailCapacity(building(c, shop.building).level, firmWorkerCount(c, shop.id)).stock, Math.max(4, c.households.reduce((n, h) => n + h.members, 0) * 2)), share = Math.ceil(target / Math.max(1, made.length));
    for (const product of made) {
      for (const producer of active.filter(f => f.zone === 'I' && f.products[product] > 0)) {
        const qty = Math.min(producer.products[product], share - shop.products[product], target - shop.inventory, Math.floor(spendable(c, shop) / 350));
        if (qty <= 0) continue;
        transfer(c, shop.wallet, producer.wallet, qty * 350, 'Local wholesale goods', true);
        moveProduct(c, producer, shop, product, qty); goodsTransfer(c, producer.wallet, shop.wallet, qty, 'Wholesale stock delivery', product);
      }
      const imported = Math.min(share - shop.products[product], target - shop.inventory, Math.floor(spendable(c, shop) / 450));
      if (imported > 0) {
        transfer(c, shop.wallet, 'outside', imported * 450, 'Outside goods import', true);
        moveProduct(c, null, shop, product, imported); c.goods.imported += imported; goodsTransfer(c, 'outside', shop.wallet, imported, 'Imported shop stock', product);
      }
    }
  }
  for (const h of c.households) {
    h.needs++; const unmetDays = h.needs;
    if (h.lastPurchaseTick === c.tick || !householdAccess(c, h) || balance(c, h.wallet) < 800) continue;
    let purchased = 0;
    const shops = active.filter(f => firmWorkerCount(c, f.id) > 0 && (isRetail(f) && f.inventory > 0 || isMarket(f) && f.cropInventory > 0 && (sellable.get(f.id) ?? 0) > 0));
    // Rotate sellers without repeatedly picking an empty or unaffordable business.
    if (shops.length) { const start = Math.floor(random(c) * shops.length); shops.push(...shops.splice(0, start)); }
    for (const shop of shops) {
      if (purchased >= h.members || balance(c, h.wallet) < 800) break;
      if (isMarket(shop)) {
        while (purchased < h.members && balance(c, h.wallet) >= 800 && consumeMarketCrop(c, h, shop, sellable, hooks, true)) purchased++;
      } else {
        const product = productPreference(h.id, c.tick).find(p => shop.products[p] > 0);
        if (!product) continue;
        const quantity = Math.min(h.members - purchased, shop.products[product], Math.floor(balance(c, h.wallet) / 800));
        if (!quantity) continue;
        transfer(c, h.wallet, shop.wallet, 800 * quantity, `Household #${h.id} purchase`, true);
        moveProduct(c, shop, null, product, quantity); c.goods.consumed += quantity; h.lastPurchaseTick = c.tick;
        goodsTransfer(c, shop.wallet, h.wallet, quantity, 'Household final consumption', product); purchased += quantity;
      }
    }
    h.needs = purchased === h.members ? 0 : unmetDays;
  }
  for (const f of active.filter(f => f.zone === 'I' && firmWorkerCount(c, f.id) > 0)) {
    const exported = takeLargest(f.products, PRODUCTS, Math.min(f.inventory, firmWorkerCount(c, f.id) * 8));
    for (const product of PRODUCTS) {
      const n = exported[product]; if (!n) continue;
      transfer(c, 'outside', f.wallet, n * 350, 'Outside market goods export', true);
      moveProduct(c, f, null, product, n); c.goods.exported += n; goodsTransfer(c, f.wallet, 'outside', n, 'Exported goods', product);
    }
  }
}
function payWages(c: City, f: Firm, onlyWallet?: string) {
  for (const [wallet, days] of Object.entries(f.workDays)) {
    if (onlyWallet && wallet !== onlyWallet) continue;
    const owed = days * firmWage(f) / MONTH;
    // Release this claim's reserve immediately before paying it; other workers remain protected.
    delete f.workDays[wallet];
    const wage = transfer(c, f.wallet, wallet, owed, 'Monthly wages', true);
    if (wage !== owed) throw new Error('Payroll reserve invariant violated.');
    transfer(c, wallet, 'treasury', Math.floor(wage / 10), 'Monthly household wage tax');
  }
}
function payParkWages(c: City, p: Park, onlyWallet?: string): void {
  for (const [wallet, days] of Object.entries(p.staffing?.workDays ?? {})) {
    if (onlyWallet && wallet !== onlyWallet) continue;
    const owed = days * PARK_STAFF.dailyWage;
    delete p.staffing!.workDays[wallet];
    if (transfer(c, 'treasury', wallet, owed, `Monthly park wages #${p.id}`) !== owed) throw new Error('Park payroll reserve invariant violated.');
    transfer(c, wallet, 'treasury', Math.floor(owed / 10), 'Monthly household wage tax');
  }
}
const isWage = (reason: string): boolean => reason === 'Monthly wages' || /^Monthly park wages #[1-9]\d*$/.test(reason);
function settleMonth(c: City) {
  const svc = utilities(c);
  for (const f of c.firms) {
    payWages(c, f);
    transfer(c, f.wallet, 'landlord', firmRent(f), 'Monthly firm rent', true);
    transfer(c, f.wallet, 'treasury', buildingBill(svc, f.building), 'Monthly water and power bill', true);
    f.lastMonthProfit = f.monthlyRevenue - f.monthlyExpense;
    f.profit += f.lastMonthProfit;
    const taxPaid = transfer(c, f.wallet, 'treasury', Math.max(0, Math.floor(f.lastMonthProfit * .2)), 'Monthly firm profit tax');
    if (f.owner) f.owner.taxPaid += taxPaid;
    f.monthlyRevenue = 0; f.monthlyExpense = 0;
    // Income is a distribution, not a new wage or expense. Pay after taxes and
    // protect earned payroll and the existing working-cash reserve.
    if (f.owner) {
      const available = ownerFinance(c, f.id)?.withdrawAvailable ?? 0;
      const netProfit = Math.max(0, f.lastMonthProfit - taxPaid);
      const retained = Math.ceil(netProfit / OWNER_DEVELOPMENT_SHARE_DENOMINATOR);
      const amount = Math.min(netProfit - retained, Math.max(0, available - retained));
      if (amount > 0 && !withdrawOwnerProfit(c, f.id, amount).ok) throw new Error('Monthly owner income invariant violated.');
    }
  }
  for (const p of c.parks) payParkWages(c, p);
  for (const h of c.households) if (h.home !== null) {
    transfer(c, h.wallet, 'landlord', 10_000, 'Monthly household rent');
    transfer(c, h.wallet, 'treasury', householdBill(svc, h.home), 'Monthly household water and power bill');
  }
  // The city buys what the gateway delivered and keeps its plants running.
  for (const kind of UTILITY_KINDS) transfer(c, 'treasury', 'outside', svc.outside[kind] * OUTSIDE_PRICE[kind], `Outside ${kind} supply`);
  for (const p of c.plants) transfer(c, 'treasury', 'upkeep', PLANTS[p.kind].upkeep, `Monthly ${PLANT_NAMES[p.kind]} upkeep #${p.id}`);
  for (const p of c.parks) transfer(c, 'treasury', 'upkeep', PARK.upkeep, `Monthly park upkeep #${p.id}`);
  const { retrained, departed } = reviewLabour(c);
  c.lastEvent = 'Month settled: actual firm wages, household rent, water/power bills and taxes are in the money ledger.'
    + (retrained ? ` ${retrained} idle specialist worker(s) retrained as general workers for open jobs in the other trade.` : '')
    + (departed ? ` ${departed} household(s) left the city after two months without paid work; their savings left with them.` : '');
}

/**
 * The month-end on which this household would leave if it still has no paid work, or null when it
 * stays (it has work, owns a firm, or came from a v1 import). The floor and the monthly cap can
 * only delay it.
 */
export function departureDay(c: City, householdId: number): number | null {
  const h = c.households.find(h => h.id === householdId);
  if (!h || h.origin !== 'arrival' || householdWorkerCount(c, h.id) > 0 || c.firms.some(f => f.owner?.householdId === h.id)) return null;
  let last = 0;
  for (let i = c.ledger.length - 1; i >= 0; i--) {
    const e = c.ledger[i];
    if (e.to === h.wallet && (isWage(e.reason) || e.reason === 'New household arrival savings')) { last = e.tick; break; }
  }
  return Math.max(c.tick % MONTH ? c.tick - c.tick % MONTH + MONTH : c.tick + MONTH, Math.ceil((last + DEPARTURE_MONTHS * MONTH) / MONTH) * MONTH);
}

/** Households never leave below this many, so a quiet city keeps a seed population. */
export const DEPARTURE_FLOOR = 2;
/** Months without any paid work before a household leaves. */
export const DEPARTURE_MONTHS = 2;
/** At most this share of households leaves in one month, so a downturn empties the city gradually. */
export const DEPARTURE_SHARE = .2;

/**
 * Monthly labour review, after wages and rent are settled. A specialist with no opening in
 * their trade while the other trade has funded openings retrains as a general worker (career
 * change). A household with no worker in any job, no wage in the last two settlements and in
 * the city for at least that long leaves with its savings (to outside), freeing its home. Shop
 * owners and households that arrived recently stay; at most a fifth leave in one month, and the
 * city never drops below the floor.
 */
function reviewLabour(c: City): { retrained: number; departed: number } {
  const open = { ...admissionFacts(c).vacanciesByZone };
  let retrained = 0;
  for (const h of [...c.households].sort((a, b) => a.id - b.id)) {
    const working = (skill: 'manufacturing' | 'retail') => [...employmentForHousehold(c, h.id), ...parkEmploymentForHousehold(c, h.id)].filter(e => e.skill === skill).reduce((n, e) => n + e.workers, 0) + c.ownerLabor.filter(e => e.householdId === h.id && e.skill === skill).length;
    const moves = retrainingMoves(h.workerSkills, { manufacturing: working('manufacturing'), retail: working('retail') }, open);
    h.workerSkills.manufacturing -= moves.manufacturing; h.workerSkills.retail -= moves.retail; h.workerSkills.general += moves.manufacturing + moves.retail;
    open.C -= moves.manufacturing; open.I -= moves.retail; retrained += moves.manufacturing + moves.retail;
  }
  const since = c.tick - DEPARTURE_MONTHS * MONTH, paid = new Set<string>(), recent = new Set<string>();
  for (let i = c.ledger.length - 1; i >= 0 && c.ledger[i].tick > since; i--) {
    const e = c.ledger[i];
    if (isWage(e.reason)) paid.add(e.to);
    else if (e.reason === 'New household arrival savings') recent.add(e.to);
  }
  const owners = new Set(c.firms.flatMap(f => f.owner ? [f.owner.householdId] : []));
  const leaving = c.households.filter(h => h.origin === 'arrival' && !owners.has(h.id) && householdWorkerCount(c, h.id) === 0 && !paid.has(h.wallet) && !recent.has(h.wallet))
    .sort((a, b) => a.id - b.id).slice(0, Math.min(Math.max(0, c.households.length - DEPARTURE_FLOOR), Math.ceil(c.households.length * DEPARTURE_SHARE)));
  for (const h of leaving) {
    for (const p of c.parks) payParkWages(c, p, h.wallet);
    for (const f of c.firms) payWages(c, f, h.wallet); // no claim should remain after settlement; pay any that does
    transfer(c, h.wallet, 'outside', balance(c, h.wallet), 'Emigration savings');
    c.households = c.households.filter(x => x.id !== h.id);
    c.migration.departures = (c.migration.departures ?? 0) + 1;
  }
  return { retrained, departed: leaving.length };
}

export function moveHousehold(c: City, householdId: number, destinationId: number): Result {
  const h = c.households.find(h => h.id === householdId), destination = c.buildings.find(b => b.id === destinationId && b.zone === 'R');
  if (!h || !destination) return { ok: false, message: 'Household or destination home does not exist.' };
  if (h.home === destinationId) return { ok: true, message: 'Household already lives here; no transfer or population change.' };
  if (destination.age < 1 || !access(c, destination.cell) || !homeSupplied(c, destination)) return { ok: false, message: 'Destination needs a later daily tick, connected road, and a unit of spare power and water.' };
  if (!canAccommodate(housingCapacity(destination), homeOccupancy(c, destinationId), h.members)) return { ok: false, message: 'Destination lacks household slots or person capacity.' };
  h.home = destinationId;
  return { ok: true, message: 'Household moved with the same identity, wallet, members and earned wage claims.' };
}
function vacantHomes(c: City): Building[] {
  return c.buildings.filter(b => b.zone === 'R' && b.age >= 1 && access(c, b.cell)).sort((a, b) => a.cell - b.cell || a.id - b.id);
}
function rehouse(c: City) {
  for (const h of [...c.households].filter(h => h.home === null).sort((a, b) => a.id - b.id)) {
    for (const home of vacantHomes(c)) if (canAccommodate(housingCapacity(home), homeOccupancy(c, home.id), h.members)) { moveHousehold(c, h.id, home.id); break; }
  }
}
function admissionFacts(c: City) {
  const vacanciesByZone = { I: 0, C: 0 }, svc = utilities(c);
  for (const f of c.firms) if (!isMarket(f) && access(c, building(c, f.building).cell) && svc.ok(f.building)) vacanciesByZone[f.zone === 'F' ? 'I' : f.zone] += Math.min(Math.max(0, capacity(building(c, f.building)) - firmWorkerCount(c, f.id)), Math.floor(spendable(c, f) / (firmWage(f) / MONTH)));
  const vacancies = vacanciesByZone.I + vacanciesByZone.C;
  const existingUnemployed = c.households.filter(h => householdAccess(c, h)).reduce((n, h) => n + h.workforce - householdWorkerCount(c, h.id), 0);
  return { vacancies, vacanciesByZone, existingUnemployed, bootstrap: c.migration.arrivals < 2 };
}
export function explainMigration(c: City, buildingId: number): string[] {
  const b = c.buildings.find(b => b.id === buildingId && b.zone === 'R');
  if (!b) return ['ไม่พบบ้านพักที่เลือก'];
  const used = homeOccupancy(c, b.id), room = housingCapacity(b), facts = admissionFacts(c), reasons = [
    `พักจริง ${used.households}/${room.households} ครัวเรือน และ ${used.persons}/${room.persons} คน ตามความจุระดับปัจจุบัน`,
    `มีตำแหน่งว่างที่สำรองค่าจ้างได้ ${facts.vacancies} ตำแหน่ง และแรงงานเดิมที่ยังไม่ได้งาน ${facts.existingUnemployed} คน`,
  ];
  if (b.age < 1) reasons.push('บ้านใหม่ยังว่างในวันที่สร้าง ต้องรออย่างน้อยหนึ่งวันจำลอง');
  if (!access(c, b.cell)) reasons.push('ต้องมีถนนเชื่อมข้างบ้านถึงทางออกเมือง');
  if (!homeSupplied(c, b)) reasons.push('บ้านนี้ต้องมีน้ำและไฟ และเครือข่ายต้องเหลืออย่างละ 1 หน่วยต่อครัวเรือนใหม่ สร้างโรงไฟฟ้าหรือโรงสูบน้ำริมถนน');
  if (used.households >= room.households || used.persons >= room.persons) reasons.push('ความจุครัวเรือนหรือจำนวนคนเต็มแล้ว การเพิ่มระดับเพิ่มเฉพาะความจุ');
  if (c.households.some(h => h.home === null)) reasons.push('ครัวเรือนที่ไร้บ้านจะได้รับการจัดบ้านก่อนรับครัวเรือนใหม่');
  if (c.households.length >= MAX_CITY_HOUSEHOLDS) reasons.push('ถึงความจุสูงสุดตามจำนวนแปลงและระดับที่อยู่อาศัยของแผนที่แล้ว');
  if (facts.bootstrap) reasons.push(`สิทธิเริ่มเมืองเหลือ ${2 - c.migration.arrivals} ครัวเรือน ยกเว้นเงื่อนไขงานเริ่มต้นเท่านั้น เงินติดตัว 1,500 ฿ต้องบันทึกจากบัญชีภายนอกหนึ่งครั้งต่อครัวเรือน`);
  else reasons.push('รับใหม่เมื่อมีตำแหน่งว่างที่จ่ายค่าจ้างได้ และรายได้สุทธิคาดหมายพอค่าของใช้กับค่าเช่า โดยให้แรงงานเดิมได้งานก่อน');
  reasons.push('รับครัวเรือนใหม่ไม่เกินหนึ่งครัวเรือนต่อวัน สมาชิกเป็นจำนวนจริงของแต่ละครัวเรือน ไม่ใช่ตัวแทนประชากรแบบกลุ่มรวม');
  reasons.push(`สิ้นเดือน: แรงงานเฉพาะทางที่สายงานเดิมไม่มีตำแหน่งว่างแต่อีกสายมี จะเปลี่ยนเป็นแรงงานทั่วไป ครัวเรือนที่ไม่มีงานได้ค่าจ้างเลย ${DEPARTURE_MONTHS} เดือนจะย้ายออกพร้อมเงินออม (เจ้าของร้านและผู้มาใหม่ไม่ย้าย เมืองเหลืออย่างน้อย ${DEPARTURE_FLOOR} ครัวเรือน)`);
  return reasons;
}
function admitHousehold(c: City) {
  if (!canAllocateIds(c, 1)) { c.lastEvent = 'Entity ID range exhausted; no household or arrival funding was created.'; return; }
  if (c.households.length >= MAX_CITY_HOUSEHOLDS || c.households.some(h => h.home === null) || c.ledger.some(e => e.tick === c.tick && e.reason === 'New household arrival savings')) return;
  const facts = admissionFacts(c);
  if (!facts.bootstrap && (facts.vacancies < 1 || facts.existingUnemployed > 0)) return;
  const family = facts.vacancies >= 2 && facts.existingUnemployed === 0;
  const members = family ? 3 : 1, workforce = family ? 2 : 1;
  if (!facts.bootstrap && Math.floor(WAGES.C * workforce * .9) < 30 * 800 + 10_000 + HOUSEHOLD_BILL) return;
  const svc = utilities(c), home = vacantHomes(c).find(b => canAccommodate(housingCapacity(b), homeOccupancy(c, b.id), members) && homeSupplied(c, b, svc));
  if (!home) return;
  const id = c.nextId, wallet = `household:${id}`;
  // Outside is an explicit source. No existing family wallet or earned claim is duplicated.
  if (transfer(c, 'outside', wallet, 150_000, 'New household arrival savings') !== 150_000) return;
  c.nextId++;
  // Proposed entry capability profile: one flexible worker plus one specialist
  // in a currently funded role. Counts are disjoint; no per-person agents exist.
  const workerSkills: WorkerSkills = { general: 1, manufacturing: family && facts.vacanciesByZone.I > 0 ? 1 : 0, retail: family && facts.vacanciesByZone.I === 0 ? 1 : 0 };
  c.households.push({ id, home: home.id, members, workforce, dependents: family ? 1 : 0, workerSkills, skillSource: 'arrival-profile', profile: family ? 'family' : 'single-worker', origin: 'arrival', wallet, lastPurchaseTick: -1, needs: 0 });
  if (c.households.length > 128) c.populationCapacityVersion = 1;
  c.migration.arrivals++;
  c.lastEvent = `Household #${id} arrived with ${members} members and ${workforce} workforce; outside arrival savings recorded once.${facts.bootstrap ? ' Explicit first-two-household job bootstrap.' : ''}`;
}
/** The lowest-index vacant C parcel a shop could use: road frontage, utilities and the usual caps. */
export function shopSite(c: City): number | null {
  if (!fits(utilities(c).spare, buildingNeed('C', 2)) || !canAllocateIds(c, 2) || c.buildings.length >= 192 || c.firms.length >= 64) return null;
  const i = c.cells.findIndex((cell, i) => cell.zone === 'C' && cell.building === null && access(c, i));
  return i < 0 ? null : i;
}
/**
 * A market becomes the next shop when its owner already works it, it earned a profit last month, it can pay
 * the refit from its own cash and keep 200 credits working, and another market still sells fresh crops.
 */
export function marketToConvert(c: City): Firm | undefined {
  const markets = c.firms.filter(isMarket);
  if (markets.length < 2) return undefined;
  // The refit adds a level: one more unit of power.
  const svc = utilities(c), extra = buildingNeed('C', 2).power - buildingNeed('C', 1).power;
  return markets.sort((a, b) => a.id - b.id).find(f => {
    const b = building(c, f.building);
    return svc.ok(b.id) && svc.spare.power >= extra && !!f.owner && b.age >= MONTH && access(c, b.cell) && c.ownerLabor.some(e => e.firmId === f.id) && f.lastMonthProfit > 0 && spendable(c, f) >= MARKET_CONVERSION_COST + 20_000;
  });
}
/** Current conditions are a preview: other buildings may use spare utilities first at review. */
export function retailGrowthStatus(c: City, f: Firm) {
  if (!isRetail(f)) throw new TypeError('Expected a retail firm');
  const b = building(c, f.building), current = retailCapacity(b.level), workers = firmWorkerCount(c, f.id);
  const next = b.level < RETAIL_MAX_LEVEL ? retailCapacity(b.level + 1) : null;
  const reasons: string[] = [];
  if (next) {
    const svc = utilities(c), before = svc.need.get(b.id)!, after = buildingNeed('C', b.level + 1);
    if (b.age < MONTH) reasons.push(`อาคารต้องมีอายุอย่างน้อย ${MONTH} วัน`);
    if (!access(c, b.cell)) reasons.push('ต้องเชื่อมถนน');
    if (!svc.ok(b.id)) reasons.push('ต้องมีไฟฟ้าและน้ำ');
    if (!fits(svc.spare, { power: after.power - before.power, water: after.water - before.water })) reasons.push('ไฟฟ้าหรือน้ำสำรองไม่พอสำหรับระดับถัดไป');
    if (f.lastMonthProfit <= (f.owner ? firmWage(f) : 0)) reasons.push('กำไรรอบก่อนยังไม่ถึงเกณฑ์');
    if (workers === 0) reasons.push('ต้องมีคนทำงานจริงอย่างน้อย 1 คน');
    if (balance(c, f.wallet) < 20_000) reasons.push('เงินกิจการต้องมีอย่างน้อย 200 เครดิต');
  }
  return { level: b.level, current, staffed: staffedRetailCapacity(b.level, workers), workers, next, reasons };
}
/** Read-only preview of the existing monthly upgrade gates; does not allocate spare utilities. */
export function productionUpgradeStatus(c: City, f: Firm) {
  if (f.zone !== 'I' && f.zone !== 'F') throw new TypeError('Expected factory or farm');
  const b = building(c, f.building), maximum = f.zone === 'I' ? FACTORY_MAX_LEVEL : FARM_MAX_LEVEL;
  const nextLevel = b.level < maximum ? b.level + 1 : null, reasons: string[] = [];
  const svc = utilities(c), before = buildingNeed(b.zone, b.level);
  const after = nextLevel === null ? before : buildingNeed(b.zone, nextLevel);
  const extra = { power: after.power - before.power, water: after.water - before.water };
  const profitThreshold = f.owner || f.zone === 'F' ? firmWage(f) : 0;
  const requiredSpendable = nextLevel === null ? 0 : f.zone === 'F' && b.level >= 3 ? 40_000
    : f.zone === 'I' && b.level >= 3 ? 20_000 + INDUSTRY_WORKING_RESERVE + factoryLevel(nextLevel).jobs * (firmWage(f) / MONTH + 2 * 350) : 0;
  if (nextLevel !== null) {
    if (b.age < MONTH) reasons.push(`อายุอาคาร ${b.age}/${MONTH} วัน`);
    if (!access(c, b.cell)) reasons.push('ต้องมีถนนเชื่อมถึงเมือง');
    if (!svc.ok(b.id)) reasons.push('น้ำและไฟของอาคารปัจจุบันยังไม่พร้อม');
    if (!fits(svc.spare, extra)) reasons.push('น้ำหรือไฟสำรองไม่พอสำหรับระดับถัดไป');
    if (f.lastMonthProfit <= profitThreshold) reasons.push(`กำไรรอบก่อนต้องมากกว่า ${profitThreshold / 100} เครดิต`);
    if (firmWorkerCount(c, f.id) === 0) reasons.push('ต้องมีคนทำงานจริงอย่างน้อย 1 คน');
    if (balance(c, f.wallet) < 20_000) reasons.push('เงินกิจการต้องมีอย่างน้อย 200 เครดิต');
    if (requiredSpendable && spendable(c, f) < requiredSpendable) reasons.push(`เงินพ้นสำรองค่าจ้างต้องมี ${requiredSpendable / 100} เครดิต`);
  }
  return { level: b.level, maximum, nextLevel, reasons, cost: 20_000, cash: balance(c, f.wallet),
    spendable: spendable(c, f), requiredSpendable, profitThreshold, workers: firmWorkerCount(c, f.id),
    before, after, extra, spare: { ...svc.spare } };
}
/** The stall's leftover fresh crops are written off at book value (a shop holds no crops), then the owner pays the refit. */
function convertMarket(c: City, f: Firm) {
  if (!writeOffCrops(c, f, agricultureHooks(c))) return;
  transfer(c, f.wallet, 'construction', MARKET_CONVERSION_COST, 'Market to shop conversion');
  building(c, f.building).level = 2; f.commercialKind = 'retail'; f.convertedAt = c.tick;
  c.lastEvent = `Market #${f.id} became a shop: its owner paid the refit from the stall's own profit and keeps working the counter.`;
}
/** Shops open on their own day of the cycle, so the seeded growth draw for every other zone is unchanged. */
function openShop(c: City) {
  if (retailDemand(c) <= 0) return;
  const market = marketToConvert(c);
  if (market) { convertMarket(c, market); return; }
  const site = shopSite(c);
  if (site !== null) createBuilding(c, site, true);
}
function grow(c: City) {
  const eligible = c.cells.map((cell, i) => cell.zone && cell.building === null && !blockers(c, i).length ? i : -1).filter(i => i >= 0);
  if (eligible.length) createBuilding(c, eligible[Math.floor(random(c) * eligible.length)]);
  if (c.tick % MONTH !== 0) return;
  // A taller building draws more water and power; it grows only while the network can supply it.
  const svc = utilities(c), spare = { ...svc.spare };
  for (const b of c.buildings) {
    if (b.level >= (b.zone === 'R' ? HOUSING_LEVELS.length : b.zone === 'C' ? RETAIL_MAX_LEVEL : b.zone === 'I' ? FACTORY_MAX_LEVEL : b.zone === 'F' ? FARM_MAX_LEVEL : 3) || b.age < MONTH || !access(c, b.cell) || !svc.ok(b.id)) continue;
    const before = svc.need.get(b.id)!, after = buildingNeed(b.zone, b.level + 1, c.households.filter(h => h.home === b.id).length), extra = { power: after.power - before.power, water: after.water - before.water };
    if (!fits(spare, extra)) continue;
    const residents = c.households.filter(h => h.home === b.id), f = c.firms.find(f => f.building === b.id);
    if (b.zone === 'R' && residents.some(h => residentialInvestorEligible(c, h))) {
      transfer(c, 'outside', 'construction', 20_000, 'Outside residential height investment'); b.level++; b.housingType = HOUSING_LEVELS[b.level - 1].type; spare.power -= extra.power; spare.water -= extra.water;
    } else if (f && !isMarket(f) && f.lastMonthProfit > (f.owner || f.zone === 'F' ? firmWage(f) : 0) && firmWorkerCount(c, f.id) > 0 && (f.zone === 'F' && b.level >= 3 ? spendable(c, f) >= 40_000 : balance(c, f.wallet) >= 20_000) && (b.zone !== 'I' || b.level < 3 || spendable(c, f) >= 20_000 + INDUSTRY_WORKING_RESERVE + factoryLevel(b.level + 1).jobs * (firmWage(f) / MONTH + 2 * 350))) {
      transfer(c, f.wallet, 'construction', 20_000, 'Profitable firm height investment'); b.level++; spare.power -= extra.power; spare.water -= extra.water;
    }
  }
}
export function step(c: City): void {
  withRoadScope(c, () => stepWithRoads(c));
}
function stepWithRoads(c: City): void {
  if (c.foodDemandStartTick === undefined) c.foodDemandStartTick = c.tick;
  c.tick++; for (const b of c.buildings) b.age++;
  rehouse(c); employ(c); admitHousehold(c); trade(c);
  transfer(c, 'treasury', 'upkeep', c.cells.filter(cell => cell.road).length * 10, 'Daily road upkeep');
  if (c.tick % MONTH === 0) { settleMonth(c); takeOver(c); }
  if (c.tick % 3 === 0) grow(c);
  else if (c.tick % 3 === 1) openShop(c);
}
/** `starter: false` gives an empty map with only the outside gateway, for the guided first game. */
export function createCity(seed = 20261023, options: { starter?: boolean } = {}): City {
  const safeSeed = Number.isSafeInteger(seed) ? seed >>> 0 : 20261023;
  const c: City = { foodDemandStartTick: 0, factoryProgressionStartTick: 0, farmLevelStartTick: 0, version: 9, rulesVersion: 'chain-4', typeBaseline: { tick: 0, cropEntries: 0, goodsEntries: 0, crops: {}, products: {} }, growthStartTick: 0, migration: { arrivals: 0, legacyHouseholds: 0 }, employment: [], ownerLabor: [],
    resources: createResourceMap(safeSeed), crops: { harvested: 0, processed: 0, consumed: 0, writtenOff: 0 }, cropLedger: [], agricultureStartTick: 0,
    seed: safeSeed, rng: safeSeed, tick: 0, nextId: 1,
    cells: Array.from({ length: SIZE * SIZE }, () => ({ road: false, zone: null, building: null })),
    buildings: [], households: [], firms: [], accounts: { outside: 0, treasury: 0, construction: 0, roadworks: 0, upkeep: 0, landlord: 0 }, ledger: [], goodsLedger: [],
    goods: { produced: 0, imported: 0, consumed: 0, exported: 0 }, utilities: { outside: { ...OUTSIDE_SUPPLY } }, plants: [], parks: [], lastEvent: '' };
  transfer(c, 'outside', 'treasury', 3_000_000, 'Initial municipal grant');
  if (options.starter === false) {
    buildRoad(c, GATEWAY, GATEWAY);
    c.lastEvent = 'Empty map: only the outside gateway exists. Build a road from it, then zone beside the road.';
    return c;
  }
  buildRoad(c, GATEWAY, GATEWAY + 10);
  for (const x of [2, 3, 5, 6, 8, 9]) zoneCell(c, 11 * SIZE + x, 'R');
  for (const x of [4, 7]) zoneCell(c, 13 * SIZE + x, 'C');
  for (const x of [8, 10]) zoneCell(c, 13 * SIZE + x, 'I');
  const frontier = c.cells.map((cell, i) => !cell.road && cell.zone === null && access(c, i) ? i : -1).filter(i => i >= 0);
  const farm = [...frontier].filter(i => c.resources.fertility[i] >= FERTILITY_THRESHOLD).sort((a, b) => c.resources.fertility[b] - c.resources.fertility[a] || a - b)[0];
  if (farm !== undefined) zoneCell(c, farm, 'F');
  const market = frontier.find(i => i !== farm); if (market !== undefined) zoneCell(c, market, 'C');
  c.lastEvent = 'Starter road and zones are funded by the recorded grant. Unpause and watch one seeded development review every 3 days.';
  return c;
}
export function serialize(c: City, market?: City['market']): string {
  if (c.roadTopology) validateRoadTopology(c, c.roadTopology);
  const expanded = c.populationCapacityVersion === 1 || c.households.length > 128 || c.employment.length > 256;
  const json = JSON.stringify({ ...c, ...(expanded ? {populationCapacityVersion: 1} : {}), foodDemandStartTick: c.foodDemandStartTick ?? c.tick, factoryProgressionStartTick: c.factoryProgressionStartTick ?? c.tick, farmLevelStartTick: c.farmLevelStartTick ?? c.tick, version: expanded ? 21 : c.roadTopology ? 20 : 19, rulesVersion: expanded ? 'chain-16' : c.roadTopology ? 'chain-15' : 'chain-14', ...(market ? { market } : {}) });
  if (json.length > 12_000_000) throw new Error('Save journal exceeds the prototype 12 MB limit. The previous local save is preserved.');
  return json;
}

/** Original commercial state is validated first; no operating state or history is rewritten. */
/** v6 state is already valid v7 state (every v6 farm and shop rule still holds); only the stamp changes. */
function migrateV6(old: CityV6): City {
  return { ...old, version: 7, rulesVersion: 'chain-2' } as unknown as City;
}
/**
 * v7 (chain-2) had one crop and one generic product. Typing starts now: farms hold their land's
 * crop, factories get recipes in ID order as if each had just opened, markets' lots count as the
 * first farm's crop and shop shelves as the first factory's product. This stock is recorded as
 * the type baseline; no history is rewritten.
 */
function migrateV7(old: City): City {
  const c = { ...old, version: 8, rulesVersion: 'chain-3', typeBaseline: { tick: old.tick, cropEntries: old.cropLedger.length, goodsEntries: old.goodsLedger.length, crops: {}, products: {} } } as unknown as City;
  const byId = [...c.firms].sort((a, b) => a.id - b.id), assigned: Firm[] = [];
  for (const f of byId) { f.crops = emptyCrops(); f.products = emptyProducts(); delete f.recipe; }
  for (const f of byId.filter(f => f.zone === 'I')) { f.recipe = chooseRecipe(c, assigned); assigned.push(f); }
  const firstFarm = byId.find(f => f.zone === 'F'), firstFactory = byId.find(f => f.zone === 'I');
  for (const f of byId) {
    const crop: CropId = f.zone === 'F' ? farmCrop(c, f) : f.zone === 'I' ? RECIPE[f.recipe!].crop : firstFarm ? farmCrop(c, firstFarm) : 'rice';
    const product: ProductId = f.zone === 'I' ? RECIPE[f.recipe!].product : firstFactory ? RECIPE[firstFactory.recipe!].product : 'milled-rice';
    f.crops[crop] = f.cropInventory; f.products[product] = f.inventory;
    if (f.cropInventory) c.typeBaseline.crops[f.wallet] = { ...f.crops };
    if (f.inventory) c.typeBaseline.products[f.wallet] = { ...f.products };
  }
  return c;
}
/**
 * 2.0 (v8 / chain-3) had outside water and power everywhere. Plants start now: the gateway contract
 * covers everything the city already drew (at least the new-city contract), so nothing that ran
 * stops on load; growth beyond it needs plants.
 */
function migrateV8(old: City): City {
  const { utilities: _, ...rest } = old as City & { utilities: unknown };
  const c = { ...rest, version: 9, rulesVersion: 'chain-4', plants: [], utilities: { outside: { power: Number.MAX_SAFE_INTEGER, water: Number.MAX_SAFE_INTEGER } } } as City;
  const drawn = utilities(c).used;
  c.utilities.outside = { power: Math.max(OUTSIDE_SUPPLY.power, drawn.power), water: Math.max(OUTSIDE_SUPPLY.water, drawn.water) };
  return c;
}
const RULES = { 7: 'chain-2', 8: 'chain-3', 9: 'chain-4' } as const;
/** Every rule of a chain-2 (v7) save; chain-3 (v8) also reconciles typed stock, chain-4 (v9) its plants. */
function validateV7(c: City, version: 7 | 8 | 9 = 7, withParks = false, withStaffing = false, withDensity = false, extendedFactories = false, retailMaxLevel = RETAIL_LEGACY_MAX_LEVEL, withFarmLevels = false, expandedPopulation = false): City {
  const typed = version >= 8;
  const fail = (): never => { throw new Error(`Unsupported or corrupt CityManager save (expected version ${version} / ${RULES[version]}).`); };
  const int = (v: unknown, min = 0): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= min;
  if (!c || (c.version as number) !== version || (c.rulesVersion as string) !== RULES[version] || !int(c.growthStartTick) || c.growthStartTick > c.tick || !int(c.seed) || c.seed > 4294967295 || !int(c.rng) || c.rng > 4294967295 || !int(c.tick) || !int(c.nextId, 1) || c.nextId > Number.MAX_SAFE_INTEGER - 2 || typeof c.lastEvent !== 'string') fail();
  if (withParks ? !Array.isArray(c.parks) || c.parks.length > MAX_PARKS : c.parks !== undefined && (!Array.isArray(c.parks) || c.parks.length !== 0)) fail();
  if (!withParks) c.parks = [];
  if (!Array.isArray(c.cells) || c.cells.length !== SIZE * SIZE || !Array.isArray(c.buildings) || c.buildings.length > 192 || !Array.isArray(c.households) || c.households.length > (expandedPopulation ? MAX_CITY_HOUSEHOLDS : 128) || !Array.isArray(c.firms) || c.firms.length > 64) fail();
  if (!c.migration || !int(c.migration.arrivals) || !int(c.migration.legacyHouseholds) || !Array.isArray(c.employment) || c.employment.length > (expandedPopulation ? MAX_CITY_HOUSEHOLDS * 2 : 256)) fail();
  if (!Array.isArray(c.ownerLabor) || c.ownerLabor.length > 64 || c.ownerLabor.some(e => !e || !int(e.householdId, 1) || !int(e.firmId, 1) || e.workers !== 1 || !['general', 'retail'].includes(e.skill)) || !Array.isArray(c.cropLedger) || !c.crops || !['harvested', 'processed', 'consumed', 'writtenOff'].every(k => int(c.crops[k as keyof typeof c.crops])) || !int(c.agricultureStartTick) || c.agricultureStartTick > c.tick || !isCanonicalResourceMap(c.resources, c.seed)) fail();
  const legacyUtilities = c.utilities as unknown as { power: unknown; water: unknown } | undefined, outside = c.utilities?.outside;
  if (version < 9 ? !legacyUtilities || typeof legacyUtilities.power !== 'boolean' || typeof legacyUtilities.water !== 'boolean'
    : Object.keys(c.utilities ?? {}).length !== 1 || !outside || Object.keys(outside).length !== 2 || !UTILITY_KINDS.every(k => int(outside[k]) && outside[k] >= OUTSIDE_SUPPLY[k] && outside[k] <= 1_000_000) || !Array.isArray(c.plants) || c.plants.length > MAX_PLANTS) fail();
  if (!c.goods || !['produced', 'imported', 'consumed', 'exported'].every(k => int(c.goods[k as keyof typeof c.goods]))) fail();
  if (!c.accounts || typeof c.accounts !== 'object' || Array.isArray(c.accounts) || !['outside', 'treasury', 'construction', 'roadworks', 'upkeep', 'landlord'].every(k => int(c.accounts[k], k === 'outside' ? Number.MIN_SAFE_INTEGER : 0)) || !Object.entries(c.accounts).every(([k, v]) => /^(outside|treasury|construction|roadworks|upkeep|landlord|household:\d+|firm:\d+)$/.test(k) && int(v, k === 'outside' ? Number.MIN_SAFE_INTEGER : 0)) || Object.values(c.accounts).reduce((a, b) => a + b, 0) !== 0) fail();
  for (const cell of c.cells) if (!cell || typeof cell.road !== 'boolean' || ![null, 'R', 'C', 'I', 'F'].includes(cell.zone) || !(cell.building === null || int(cell.building, 1)) || (cell.road && (cell.zone !== null || cell.building !== null))) fail();
  if (!c.cells[GATEWAY].road) fail();
  const ids = new Set<number>();
  for (const b of c.buildings) {
    if (!b || !int(b.id, 1) || ids.has(b.id) || !validIndex(b.cell) || !['R', 'C', 'I', 'F'].includes(b.zone) || !int(b.level, 1) || b.level > (b.zone === 'R' && withDensity ? HOUSING_LEVELS.length : b.zone === 'C' ? retailMaxLevel : b.zone === 'I' && extendedFactories ? FACTORY_MAX_LEVEL : b.zone === 'F' && withFarmLevels ? FARM_MAX_LEVEL : 3) || !int(b.age) || b.age > c.tick || c.cells[b.cell].building !== b.id || c.cells[b.cell].zone !== b.zone || (b.zone === 'R' ? b.housingType !== (withDensity ? HOUSING_LEVELS[b.level - 1]?.type : 'cottage') : b.housingType !== undefined)) fail();
    ids.add(b.id);
  }
  for (let i = 0; i < c.cells.length; i++) if (c.cells[i].building !== null && !c.buildings.some(b => b.id === c.cells[i].building && b.cell === i)) fail();
  for (const h of c.households) {
    if (!h || !int(h.id, 1) || ids.has(h.id) || !(h.home === null || c.buildings.some(b => b.id === h.home && b.zone === 'R')) || h.wallet !== `household:${h.id}` || !int(c.accounts[h.wallet]) || Object.hasOwn(h, 'employer') || !int(h.members, 1) || !int(h.workforce) || !int(h.dependents) || h.members !== h.workforce + h.dependents || !int(h.lastPurchaseTick, -1) || h.lastPurchaseTick > c.tick || !int(h.needs)) fail();
    if (h.origin === 'legacy-v1' ? h.profile !== 'legacy-worker' || h.members !== 1 || h.workforce !== 1 || h.dependents !== 0 : h.origin !== 'arrival' || (h.profile === 'family' ? h.members !== 3 || h.workforce !== 2 || h.dependents !== 1 : h.profile !== 'single-worker' || h.members !== 1 || h.workforce !== 1 || h.dependents !== 0)) fail();
    if (!h.workerSkills || typeof h.workerSkills !== 'object' || Array.isArray(h.workerSkills) || Object.keys(h.workerSkills).length !== 3 || !['general', 'manufacturing', 'retail'].every(k => int(h.workerSkills[k as keyof WorkerSkills])) || h.workerSkills.general + h.workerSkills.manufacturing + h.workerSkills.retail !== h.workforce) fail();
    if (h.skillSource === 'legacy-assumed' ? h.workerSkills.general !== h.workforce : h.skillSource !== 'arrival-profile' || h.origin !== 'arrival') fail();
    ids.add(h.id);
  }
  for (const f of c.firms) {
    if (!f || !int(f.id, 1) || ids.has(f.id) || !['C', 'I', 'F'].includes(f.zone) || !c.buildings.some(b => b.id === f.building && b.zone === f.zone) || f.wallet !== `firm:${f.id}` || !int(c.accounts[f.wallet]) || Object.hasOwn(f, 'employees') || !int(f.inventory) || !int(f.profit, Number.MIN_SAFE_INTEGER) || !int(f.lastMonthProfit, Number.MIN_SAFE_INTEGER) || !int(f.monthlyRevenue) || !int(f.monthlyExpense)) fail();
    const premise = c.buildings.find(b => b.id === f.building)!;
    if (f.zone === 'C' ? !['market', 'retail'].includes(f.commercialKind!) || (isMarket(f) ? premise.level !== 1 : premise.level < 2) : f.commercialKind !== undefined) fail();
    if (f.takenOverAt !== undefined) {
      const opened = c.ledger.filter(e => e.from === f.wallet && e.to === 'construction' && e.tick === f.takenOverAt && (/^Self-employed (?:shop|market) construction$/.test(e.reason) ? !!f.owner && e.amount === 10_000 : !f.owner && e.amount === TAKEOVER_REFIT && (e.reason === `Business takeover refit #${f.id}` || /^Funded industry takeover #[1-9]\d*$/.test(e.reason))));
      if (version < 9 || !int(f.takenOverAt, 1) || f.takenOverAt > c.tick || f.takenOverAt < c.tick - premise.age || f.fundedBy !== undefined || f.convertedAt !== undefined || opened.length !== 1) fail();
    }
    if (f.convertedAt !== undefined && (!isRetail(f) || !f.owner || !int(f.convertedAt, 1) || f.convertedAt > c.tick || premise.level < 2)) fail();
    if (f.fundedBy !== undefined && (f.zone !== 'I' || !f.fundedBy || typeof f.fundedBy !== 'object' || Array.isArray(f.fundedBy) || Object.keys(f.fundedBy).length !== 2 || !int(f.fundedBy.firmId, 1) || f.fundedBy.firmId >= f.id || f.fundedBy.capital !== INDUSTRY_STARTUP_CAPITAL || !Object.hasOwn(c.accounts, `firm:${f.fundedBy.firmId}`))) fail();
    if (!f.workDays || typeof f.workDays !== 'object' || Array.isArray(f.workDays) || !Object.entries(f.workDays).every(([wallet, days]) => { const h = c.households.find(h => h.wallet === wallet); return h && int(days, 1) && days <= h.workforce * (c.tick % MONTH); }) || !int(payroll(f)) || payroll(f) > balance(c, f.wallet)) fail();
    ids.add(f.id);
  }
  for (const p of version === 9 ? c.plants : []) {
    if (!p || Object.keys(p).length !== 4 || !int(p.id, 1) || ids.has(p.id) || !validIndex(p.cell) || !UTILITY_KINDS.includes(p.kind) || !int(p.tick) || p.tick > c.tick) fail();
    const cell = c.cells[p.cell], built = c.ledger.filter(e => e.reason === `Build ${PLANT_NAMES[p.kind]} #${p.id}`);
    if (cell.road || cell.zone !== null || cell.building !== null || c.plants.some(q => q !== p && q.cell === p.cell)) fail();
    if (built.length !== 1 || built[0].from !== 'treasury' || built[0].to !== 'construction' || built[0].amount !== PLANTS[p.kind].cost || built[0].tick !== p.tick) fail();
    ids.add(p.id);
  }
  for (const p of c.parks) {
    if (!p || Object.keys(p).length !== (withStaffing && p.staffing !== undefined ? 5 : 4) || (!withStaffing && p.staffing !== undefined) || !int(p.id, 1) || ids.has(p.id) || !validIndex(p.cell) || p.level !== 1 || !int(p.tick) || p.tick > c.tick) fail();
    const cell = c.cells[p.cell], built = c.ledger.filter(e => e.reason === `Build park #${p.id}`);
    if (cell.road || cell.zone !== null || cell.building !== null || c.plants.some(q => q.cell === p.cell) || c.parks.some(q => q !== p && q.cell === p.cell)) fail();
    if (built.length !== 1 || built[0].from !== 'treasury' || built[0].to !== 'construction' || built[0].amount !== PARK.cost || built[0].tick !== p.tick || c.ledger.some(e => e.reason === `Demolish park #${p.id}`)) fail();
    ids.add(p.id);
  }
  const parkBuilds = new Map<number, number>(), parkRemoved = new Set<number>(), parkBills = new Set<string>();
  for (const p of c.parks) if (p.staffing !== undefined) {
    const s = p.staffing;
    if (!s || Object.keys(s).length !== 2 || !Array.isArray(s.allocations) || s.allocations.length > PARK_STAFF.slots || !s.workDays || typeof s.workDays !== 'object' || Array.isArray(s.workDays)) fail();
    const pairs = new Set<string>();
    for (const a of s.allocations) {
      if (!a || Object.keys(a).length !== 4 || a.parkId !== p.id || !int(a.householdId, 1) || !int(a.workers, 1) || !['general', 'manufacturing', 'retail'].includes(a.skill) || !c.households.some(h => h.id === a.householdId)) fail();
      const key = `${a.householdId}:${a.skill}`; if (pairs.has(key)) fail(); pairs.add(key);
    }
    if (parkWorkers(p) > PARK_STAFF.slots || !int(parkPayroll(p))) fail();
    for (const [wallet, days] of Object.entries(s.workDays)) if (!c.households.some(h => h.wallet === wallet) || !int(days, 1)) fail();
    if (Object.values(s.workDays).reduce((n, days) => n + days, 0) > PARK_STAFF.slots * Math.min(c.tick - p.tick, c.tick % MONTH)) fail();
  }
  if (c.parks.reduce((n, p) => n + parkPayroll(p), 0) > balance(c, 'treasury')) fail();
  const parkPaid = new Map<string, number>();
  const parkPayments = new Set<string>();
  for (const e of c.ledger) {
    const wage = /^Monthly park wages #([1-9]\d*)$/.exec(e.reason);
    if (wage) {
      const id = Number(wage[1]), built = parkBuilds.get(id), key = `${id}:${Math.ceil(e.tick / MONTH)}`;
      if (!withStaffing || built === undefined || parkRemoved.has(id) || e.tick <= built || e.from !== 'treasury' || !/^household:[1-9]\d*$/.test(e.to) || !int(e.amount, 1) || e.amount % PARK_STAFF.dailyWage !== 0) fail();
      // A claim is settled once per wallet. Mid-month settlements only occur on
      // demolition; accepting one on a live park would leave already-paid days owed.
      const payment = `${id}:${e.tick}:${e.to}`;
      if (parkPayments.has(payment) || e.tick % MONTH !== 0 && !c.ledger.some(row => row.tick === e.tick && row.reason === `Demolish park #${id}`)) fail();
      parkPayments.add(payment);
      const paid = (parkPaid.get(key) ?? 0) + e.amount;
      if (paid > PARK_STAFF.slots * Math.min(MONTH, e.tick - built!, (e.tick - 1) % MONTH + 1) * PARK_STAFF.dailyWage) fail();
      parkPaid.set(key, paid);
      continue;
    }
    const event = /^(Build|Demolish|Monthly park upkeep) (?:park )?#([1-9]\d*)$/.exec(e.reason);
    if (!event) continue;
    const id = Number(event[2]);
    if (!withParks || !int(id, 1) || id >= c.nextId || e.from !== 'treasury') fail();
    if (event[1] === 'Build') {
      if (parkBuilds.has(id) || e.to !== 'construction' || e.amount !== PARK.cost) fail();
      parkBuilds.set(id, e.tick);
    } else {
      if (!parkBuilds.has(id) || parkRemoved.has(id) || e.tick < parkBuilds.get(id)!) fail();
      if (event[1] === 'Demolish') { if (e.to !== 'construction' || e.amount !== 2_000) fail(); parkRemoved.add(id); }
      else { const key = `${id}:${e.tick}`; if (e.to !== 'upkeep' || e.tick % MONTH !== 0 || e.tick <= parkBuilds.get(id)! || e.amount > PARK.upkeep || parkBills.has(key)) fail(); parkBills.add(key); }
    }
  }
  for (const p of c.parks) if (c.tick % MONTH !== 0 && (parkPaid.get(`${p.id}:${Math.ceil(c.tick / MONTH)}`) ?? 0) + parkPayroll(p) > PARK_STAFF.slots * Math.min(c.tick - p.tick, c.tick % MONTH) * PARK_STAFF.dailyWage) fail();
  for (const id of parkBuilds.keys()) if (!parkRemoved.has(id) && !c.parks.some(p => p.id === id)) fail();
  const retainedAccountIds = Object.keys(c.accounts).flatMap(key => {
    const match = /^(?:household|firm):(\d+)$/.exec(key);
    if (!match) return [];
    const id = Number(match[1]);
    if (!int(id, 1)) fail();
    return [id];
  });
  if (Math.max(0, ...ids, ...retainedAccountIds) >= c.nextId || new Set(c.firms.map(f => f.building)).size !== c.firms.length) fail();
  const occupied = buildOccupancyIndex(c.households);
  for (const b of c.buildings) {
    if (b.zone !== 'R') { if (!c.firms.some(f => f.building === b.id)) fail(); }
    else { const used = occupied.get(b.id) ?? { households: 0, persons: 0 }, room = housingCapacity(b); if (used.households > room.households || used.persons > room.persons) fail(); }
  }
  const pairs = new Set<string>();
  for (const e of c.employment) {
    if (!e || !int(e.householdId, 1) || !int(e.firmId, 1) || !int(e.workers, 1) || e.rank !== 'entry' || !['general', 'manufacturing', 'retail'].includes(e.skill)) fail();
    const h = c.households.find(h => h.id === e.householdId), f = c.firms.find(f => f.id === e.firmId), pair = `${e.householdId}:${e.firmId}:${e.skill}`;
    if (!h || h.home === null || !f || isMarket(f) || e.occupation !== (f.zone === 'I' || f.zone === 'F' ? 'manufacturing' : 'retail') || (e.skill !== 'general' && e.skill !== e.occupation) || pairs.has(pair)) fail();
    pairs.add(pair);
  }
  for (const h of c.households) {
    if (householdWorkerCount(c, h.id) > h.workforce || c.firms.reduce((n, f) => n + (f.workDays[h.wallet] ?? 0), 0) + c.parks.reduce((n, p) => n + (p.staffing?.workDays[h.wallet] ?? 0), 0) > h.workforce * (c.tick % MONTH)) fail();
    for (const skill of ['general', 'manufacturing', 'retail'] as const) if ([...employmentForHousehold(c, h.id), ...parkEmploymentForHousehold(c, h.id), ...c.ownerLabor.filter(a => a.householdId === h.id)].filter(e => e.skill === skill).reduce((n, e) => n + e.workers, 0) > h.workerSkills[skill]) fail();
  }
  for (const f of c.firms) if (firmWorkerCount(c, f.id) > capacity(building(c, f.building)) || Object.values(f.workDays).reduce((n, days) => n + days, 0) > capacity(building(c, f.building)) * (c.tick % MONTH)) fail();
  if (c.goods.produced + c.goods.imported - c.goods.consumed - c.goods.exported !== c.firms.reduce((n, f) => n + f.inventory, 0)) fail();
  if (!Array.isArray(c.ledger) || !Array.isArray(c.goodsLedger)) fail();
  for (const e of c.ledger) if (!e || !int(e.tick) || e.tick > c.tick || !int(e.amount, 1) || typeof e.reason !== 'string' || typeof e.from !== 'string' || typeof e.to !== 'string' || !Object.hasOwn(c.accounts, e.from) || !Object.hasOwn(c.accounts, e.to) || e.from === e.to) fail();
  const expansionFunding = new Map<number, Entry>(), bootstrapFunding = new Map<number, Entry>(), outsideFunding = new Map<number, Entry>();
  for (const e of c.ledger) {
    const expansion = /^Industry expansion capital #([1-9]\d*)$/.exec(e.reason), bootstrap = /^Outside industry bootstrap equity #([1-9]\d*)$/.exec(e.reason), outsideEquity = /^Outside industry equity #([1-9]\d*)$/.exec(e.reason);
    if (outsideEquity) {
      const id = Number(outsideEquity[1]);
      if (!int(id, 1) || id >= c.nextId || e.to !== `firm:${id}` || e.from !== 'outside' || e.amount !== INDUSTRY_STARTUP_CAPITAL || e.tick <= c.growthStartTick || outsideFunding.has(id)) fail();
      outsideFunding.set(id, e); continue;
    }
    if (!expansion && !bootstrap) continue;
    const id = Number((expansion ?? bootstrap)![1]);
    if (!int(id, 1) || id >= c.nextId || e.to !== `firm:${id}` || e.amount !== INDUSTRY_STARTUP_CAPITAL || e.tick <= c.growthStartTick) fail();
    if (expansion) {
      const parent = /^firm:([1-9]\d*)$/.exec(e.from), parentId = parent ? Number(parent[1]) : 0;
      if (!int(parentId, 1) || parentId >= id || expansionFunding.has(id)) fail();
      expansionFunding.set(id, e);
    } else {
      if (e.from !== 'outside' || bootstrapFunding.has(id)) fail();
      bootstrapFunding.set(id, e);
    }
  }
  if ([...expansionFunding.keys()].some(id => bootstrapFunding.has(id)) || [...outsideFunding.keys()].some(id => bootstrapFunding.has(id) || expansionFunding.has(id))) fail();
  for (const f of c.firms) {
    // A taken-over business opened on its takeover day, not when its building went up.
    const funding = expansionFunding.get(f.id), born = f.takenOverAt ?? c.tick - building(c, f.building).age;
    if (f.fundedBy) {
      if (!funding || funding.from !== `firm:${f.fundedBy.firmId}` || funding.to !== f.wallet || funding.tick !== born) fail();
    } else if (funding) fail();
    // A later factory without a sponsor was funded by outside investors on the day it opened.
    if (f.zone === 'I' && born > c.growthStartTick && !f.fundedBy && (outsideFunding.has(f.id) ? outsideFunding.get(f.id)!.tick !== born : bootstrapFunding.get(f.id)?.tick !== born || c.firms.some(other => other.id !== f.id && other.zone === 'I' && c.tick - building(c, other.building).age < born))) fail();
    if (outsideFunding.has(f.id) && (f.zone !== 'I' || f.fundedBy)) fail();
  }
  const closureMarkers = new Map<number, number>();
  c.ledger.forEach((e, index) => {
    const match = /^Funded industry (demolition|takeover) #([1-9]\d*)$/.exec(e.reason); if (!match) return;
    // A funded factory closes by demolition (the treasury pays) or by a takeover (the new firm pays its refit).
    const id = Number(match[2]), funding = expansionFunding.get(id), takeover = match[1] === 'takeover';
    if (!funding || closureMarkers.has(id) || (takeover ? !/^firm:\d+$/.test(e.from) || e.amount !== TAKEOVER_REFIT : e.from !== 'treasury' || e.amount !== 2_000) || e.to !== 'construction' || e.tick < funding.tick || c.firms.some(f => f.id === id)) fail();
    closureMarkers.set(id, index);
  });
  for (const [id, funding] of expansionFunding) {
    const parent = c.firms.find(f => f.wallet === funding.from);
    const historicalIndustry = c.goodsLedger.some(e => e.from === 'production' && e.to === funding.from && e.tick <= funding.tick);
    if (parent ? parent.zone !== 'I' : !historicalIndustry) fail();
    if (!c.firms.some(f => f.id === id)) {
      const closedAt = closureMarkers.get(id); if (closedAt === undefined) fail();
      const estateReceipts = c.ledger.slice(closedAt! + 1).filter(e => /^Industry expansion residual return #[1-9]\d*$/.test(e.reason) && e.to === funding.to).reduce((n, e) => n + e.amount, 0);
      if (balance(c, funding.to) !== estateReceipts) fail();
    }
  }
  const returned = new Set<number>();
  for (const e of c.ledger) {
    const match = /^Industry expansion residual return #([1-9]\d*)$/.exec(e.reason); if (!match) continue;
    const id = Number(match[1]), funding = expansionFunding.get(id);
    if (!funding || e.from !== funding.to || e.to !== funding.from || e.tick < funding.tick || !closureMarkers.has(id) || returned.has(id) || c.firms.some(f => f.id === id)) fail();
    returned.add(id);
  }
  const arrivals = c.households.filter(h => h.origin === 'arrival'), legacyCount = c.households.filter(h => h.origin === 'legacy-v1').length;
  const arrivalEntries = c.ledger.filter(e => e.reason === 'New household arrival savings');
  // Departed arrivals keep their funding entry and a zero wallet; the departure count covers them.
  const departures = c.migration.departures ?? 0;
  if (!int(departures) || departures > arrivalEntries.length - arrivals.length) fail();
  if (c.migration.legacyHouseholds !== legacyCount || c.migration.arrivals !== Math.max(legacyCount, arrivalEntries.length - arrivals.length - departures) + arrivals.length + departures) fail();
  for (const e of c.ledger) if (e.reason === 'Emigration savings' && (e.to !== 'outside' || c.households.some(h => h.wallet === e.from) || !/^household:\d+$/.test(e.from))) fail();
  const arrivalDays = new Set<number>();
  for (const h of arrivals) {
    const funding = arrivalEntries.filter(e => e.to === h.wallet);
    if (funding.length !== 1 || funding[0].from !== 'outside' || funding[0].amount !== 150_000 || arrivalDays.has(funding[0].tick)) fail();
    arrivalDays.add(funding[0].tick);
  }
  const goodsBalances: Record<string, number> = {};
  let produced = 0, imported = 0, consumed = 0, exported = 0;
  for (const e of c.goodsLedger) {
    if (!e || !int(e.tick) || e.tick > c.tick || !int(e.quantity, 1) || typeof e.reason !== 'string' || typeof e.from !== 'string' || typeof e.to !== 'string' || e.from === e.to || !/^(production|outside|firm:\d+)$/.test(e.from) || !/^(outside|firm:\d+|household:\d+)$/.test(e.to) || (e.from !== 'production' && !(e.from in c.accounts)) || !(e.to in c.accounts)) fail();
    goodsBalances[e.from] = (goodsBalances[e.from] ?? 0) - e.quantity;
    goodsBalances[e.to] = (goodsBalances[e.to] ?? 0) + e.quantity;
    if (e.from === 'production') produced += e.quantity;
    if (e.from === 'outside') imported += e.quantity;
    if (e.to.startsWith('household:')) consumed += e.quantity;
    if (e.to === 'outside') exported += e.quantity;
  }
  if (produced !== c.goods.produced || imported !== c.goods.imported || consumed !== c.goods.consumed || exported !== c.goods.exported || c.firms.some(f => (goodsBalances[f.wallet] ?? 0) !== f.inventory) || Object.entries(goodsBalances).some(([wallet, amount]) => wallet.startsWith('firm:') && !c.firms.some(f => f.wallet === wallet) && amount !== 0)) fail();
  const reconciled: Record<string, number> = Object.fromEntries(Object.keys(c.accounts).map(k => [k, 0]));
  for (const e of c.ledger) { reconciled[e.from] -= e.amount; reconciled[e.to] += e.amount; }
  if (Object.entries(c.accounts).some(([key, value]) => reconciled[key] !== value)) fail();
  validateAgriculture(c, extendedFactories, withFarmLevels);
  if (typed) validateTypes(c);
  return c;
}

/** Validate old saves before migration; never advance time, RNG, money or admission history on load. */
function deserializeVersioned(json: string, expandedPopulation = false): City {
  if (typeof json !== 'string' || json.length > 12_000_000) throw new Error('Save is too large or invalid.');
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { throw new Error('Save is not valid JSON.'); }
  // v1–v6 are read and validated by the frozen v6 rules first, then carried forward unchanged.
  const version = parsed && typeof parsed === 'object' ? (parsed as { version: unknown }).version : undefined;
  if (version === 21) {
    const envelope = parsed as Record<string, unknown>;
    if (envelope.rulesVersion !== 'chain-16' || envelope.populationCapacityVersion !== 1) throw Error('Invalid population save version');
    const {populationCapacityVersion, ...base} = envelope;
    const hasRoads = 'roadTopology' in base;
    const city = deserializeVersioned(JSON.stringify({...base, version: hasRoads ? 20 : 19, rulesVersion: hasRoads ? 'chain-15' : 'chain-14'}), true);
    city.populationCapacityVersion = 1;
    return city;
  }
  if (parsed && typeof parsed === 'object' && 'populationCapacityVersion' in parsed) throw Error('Expanded population requires save v21');
  if (version === 20) {
    const envelope = parsed as Record<string, unknown>;
    if(envelope.rulesVersion !== 'chain-15') throw Error('Invalid road save version');
    const {roadTopology,...base}=envelope;
    const city=deserializeVersioned(JSON.stringify({...base,version:19,rulesVersion:'chain-14'}), expandedPopulation);
    validateRoadTopology(city,roadTopology); city.roadTopology=roadTopology; return city;
  }
  if(parsed && typeof parsed==='object' && 'roadTopology' in parsed) throw Error('Road topology requires save v20');
  if (version !== 19 && parsed && typeof parsed === 'object' && 'farmLevelStartTick' in parsed) throw new Error('Unexpected farm progression boundary.');
  if (version !== 17 && version !== 18 && version !== 19 && parsed && typeof parsed === 'object' && 'factoryProgressionStartTick' in parsed) throw new Error('Unexpected factory progression boundary.');
  if (version !== 13 && version !== 14 && version !== 15 && version !== 16 && version !== 17 && version !== 18 && version !== 19 && parsed && typeof parsed === 'object' && 'foodDemandStartTick' in parsed) throw new Error('Unsupported or corrupt CityManager save.');
  if (version === 13 || version === 14 || version === 15 || version === 16 || version === 17 || version === 18 || version === 19) {
    const envelope = parsed as Omit<City, 'version' | 'rulesVersion'> & { version: number; rulesVersion: string };
    if (version === 19 && (!Number.isSafeInteger(envelope.farmLevelStartTick) || envelope.farmLevelStartTick! < 0 || envelope.farmLevelStartTick! > envelope.tick)) throw new Error('Invalid farm progression boundary.');
    if ((version === 17 || version === 18 || version === 19) && (!Number.isSafeInteger(envelope.factoryProgressionStartTick) || envelope.factoryProgressionStartTick! < 0 || envelope.factoryProgressionStartTick! > envelope.tick)) throw new Error('Invalid factory progression boundary.');
    if (envelope.rulesVersion !== (version === 19 ? 'chain-14' : version === 18 ? 'chain-13' : version === 17 ? 'chain-12' : version === 16 ? 'chain-11' : version === 15 ? 'chain-10' : version === 14 ? 'chain-9' : 'chain-8') || !Number.isSafeInteger(envelope.foodDemandStartTick) || envelope.foodDemandStartTick! < 0 || envelope.foodDemandStartTick! > envelope.tick) throw new Error('Unsupported or corrupt CityManager food save.');
    const { market, ...base } = envelope;
    if (market && (market.version !== 10 || market.rulesVersion !== 'chain-5')) throw new Error('Unsupported or corrupt CityManager market save.');
    const loaded = validateV7({ ...base, version: 9, rulesVersion: 'chain-4' } as City, 9, version >= 14, version >= 15, version >= 16, version >= 17, version >= 18 ? RETAIL_MAX_LEVEL : RETAIL_LEGACY_MAX_LEVEL, version === 19, expandedPopulation);
    if (market) loaded.market = market;
    return loaded;
  }
  if (version === 11 || version === 12) {
    const envelope = parsed as Omit<City, 'version' | 'rulesVersion'> & { version: number; rulesVersion: string };
    if (envelope.rulesVersion !== (version === 11 ? 'chain-6' : 'chain-7')) throw new Error('Unsupported or corrupt CityManager save.');
    const { market, ...base } = envelope;
    if (market && (market.version !== 10 || market.rulesVersion !== 'chain-5')) throw new Error('Unsupported or corrupt CityManager market save.');
    const loaded = validateV7({ ...base, version: 9, rulesVersion: 'chain-4' } as City, 9);
    if (market) loaded.market = market;
    return loaded;
  }
  if (version === 10) {
    const envelope = parsed as City & { market?: City['market'] };
    if ('foodDemandStartTick' in envelope || !envelope.market || envelope.market.version !== 10 || envelope.market.rulesVersion !== 'chain-5') throw new Error('Unsupported or corrupt CityManager market save.');
    const { market, ...base } = envelope;
    const loaded = validateV7({ ...base, version: 9, rulesVersion: 'chain-4' } as City, 9);
    loaded.market = market;
    return loaded;
  }
  if (typeof version === 'number' && [1, 2, 3, 4, 5, 6].includes(version)) return validateV7(migrateV8(validateV7(migrateV7(validateV7(migrateV6(deserializeV6(json)))), 8)), 9);
  // A 1.x (chain-2) save is validated by its own rules, then typed; a 2.0 (chain-3) save gets plants.
  if (version === 7) return validateV7(migrateV8(validateV7(migrateV7(validateV7(parsed as City)), 8)), 9);
  if (version === 8) return validateV7(migrateV8(validateV7(parsed as City, 8)), 9);
  return validateV7(parsed as City, 9);
}

/** Mark the transition at the loaded day without changing historical transactions. */
export function deserialize(json: string): City {
  const city = deserializeVersioned(json);
  if (city.foodDemandStartTick === undefined) city.foodDemandStartTick = city.tick;
  if (city.factoryProgressionStartTick === undefined) city.factoryProgressionStartTick = city.tick;
  if (city.farmLevelStartTick === undefined) city.farmLevelStartTick = city.tick;
  return city;
}
