/** Pure agriculture arithmetic. The simulation owns atomic journal/account commits. */
export const RESOURCE_VERSION = 'fertility-1' as const;
export const RESOURCE_CELL_COUNT = 24 * 24;
export const FERTILITY_THRESHOLD = 50;
export const CROP_STOCK_CAPS = Object.freeze({ F: 96, T: 48, I: 24 } as const);
export const CROP_PRICES = Object.freeze({ farmToTrader: 150, traderToFactory: 300, farmToFactory: 350, householdCrop: 800 } as const);
export type CropPrices = { readonly farmToTrader: number; readonly traderToFactory: number; readonly farmToFactory: number; readonly householdCrop: number };
/**
 * Current rules pay farms 2 credits a lot from markets: at 1.50 a farm worker's harvest
 * (about 9 lots a day) could not cover a wage plus rent, so every farm slowly went broke.
 * CROP_PRICES stays the frozen original table that legacy saves replay with.
 */
export const CHAIN_CROP_PRICES: CropPrices = Object.freeze({ ...CROP_PRICES, farmToTrader: 200 });
export const CROP_RECIPE = Object.freeze({ crop: 2, goods: 8 } as const);
/**
 * Surplus the city cannot use: a farm keeps `keep` lots for local buyers and sells the rest to
 * the outside market through the gateway, below every local price, so a full farm still earns
 * and the harvest is not wasted. The export journal is also the signal outside investors read.
 */
export const CROP_EXPORT = Object.freeze({ price: 120, keep: 48 } as const);
export type ResourceMap = { version: typeof RESOURCE_VERSION; seed: number; fertility: number[] };
export type CropZone = keyof typeof CROP_STOCK_CAPS;
export type CropHolding = { cropInventory: number; cropCost: number };
export type HarvestState = CropHolding & { productionTick: number };
export type RecipeState = HarvestState & { inventory: number };
export type CropAccount = CropHolding & { wallet: string; zone: CropZone; cash: number; reservedCash: number };
export type HouseholdAccount = { wallet: string; cash: number; lastPurchaseTick: number };
export type CommodityDefinition = { id: 'crop' | 'goods'; unit: 'crop lot' | 'generic basket'; industrialInput: boolean; directConsumable: boolean };
export const COMMODITIES = Object.freeze({
  crop: Object.freeze({ id: 'crop', unit: 'crop lot', industrialInput: true, directConsumable: true } as const),
  goods: Object.freeze({ id: 'goods', unit: 'generic basket', industrialInput: false, directConsumable: true } as const),
});
export type AgricultureReason = 'exported' | 'harvested' | 'processed' | 'purchased' | 'consumed' | 'invalid-input' | 'overflow' | 'already-processed' | 'stale-tick' | 'not-operational' | 'no-workers' | 'unsuitable-fertility' | 'stock-cap' | 'no-input' | 'output-limit' | 'invalid-channel' | 'same-counterparty' | 'insufficient-stock' | 'sellable-limit' | 'insufficient-cash' | 'capacity' | 'not-consumable' | 'wrong-commodity' | 'already-consumed';
const MAX = BigInt(Number.MAX_SAFE_INTEGER);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export const isSafeCount = (value: unknown, minimum = 0): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
function requireCount(value: number, label: string, minimum = 0): void {
  if (!isSafeCount(value, minimum)) throw new RangeError(label + ' must be a safe integer >= ' + minimum);
}
export function safeAdd(a: number, b: number): number {
  requireCount(a, 'Left count'); requireCount(b, 'Right count');
  const result = BigInt(a) + BigInt(b); if (result > MAX) throw new RangeError('Integer addition overflow'); return Number(result);
}
export function safeMultiply(a: number, b: number): number {
  requireCount(a, 'Left count'); requireCount(b, 'Right count');
  const result = BigInt(a) * BigInt(b); if (result > MAX) throw new RangeError('Integer multiplication overflow'); return Number(result);
}
function seedValid(seed: unknown): seed is number { return isSafeCount(seed) && seed <= 0xffffffff; }

/** Independent per-cell integer hash: no use of, or mutation to, simulation RNG. */
export function fertilityForCell(seed: number, cell: number): number {
  if (!seedValid(seed)) throw new RangeError('Resource seed must be an unsigned 32-bit integer');
  requireCount(cell, 'Resource cell'); if (cell >= RESOURCE_CELL_COUNT) throw new RangeError('Resource cell is outside the bounded map');
  let value = (seed ^ Math.imul(cell + 1, 0x9e3779b1)) >>> 0;
  value = Math.imul(value ^ value >>> 16, 0x7feb352d) >>> 0;
  value = Math.imul(value ^ value >>> 15, 0x846ca68b) >>> 0;
  return ((value ^ value >>> 16) >>> 0) % 101;
}
export function createResourceMap(seed: number): ResourceMap {
  if (!seedValid(seed)) throw new RangeError('Resource seed must be an unsigned 32-bit integer');
  return { version: RESOURCE_VERSION, seed, fertility: Array.from({ length: RESOURCE_CELL_COUNT }, (_, cell) => fertilityForCell(seed, cell)) };
}
export function isCanonicalResourceMap(value: unknown, seed: number): value is ResourceMap {
  if (!seedValid(seed) || !record(value) || value.version !== RESOURCE_VERSION || value.seed !== seed || !Array.isArray(value.fertility) || value.fertility.length !== RESOURCE_CELL_COUNT) return false;
  for (let cell = 0; cell < RESOURCE_CELL_COUNT; cell++) if (value.fertility[cell] !== fertilityForCell(seed, cell)) return false;
  return true;
}
export function isViableFarmland(fertility: unknown): fertility is number {
  return isSafeCount(fertility) && fertility >= FERTILITY_THRESHOLD && fertility <= 100;
}
export function harvestYield(fertility: number, workers: number): number {
  requireCount(fertility, 'Fertility'); if (fertility > 100) throw new RangeError('Fertility exceeds 100');
  requireCount(workers, 'Workers'); return safeMultiply(Math.floor(24 * fertility / 100), workers);
}
export function validCropHolding(value: unknown, capacity: number): value is CropHolding {
  return isSafeCount(capacity) && record(value) && isSafeCount(value.cropInventory) && value.cropInventory <= capacity && isSafeCount(value.cropCost) && (value.cropInventory !== 0 || value.cropCost === 0);
}
/** Release all book cost on the final lot; otherwise floor exact BigInt weighted cost. */
export function releaseCropCost(stock: number, cost: number, quantity: number): number {
  requireCount(stock, 'Crop stock'); requireCount(cost, 'Crop book cost'); requireCount(quantity, 'Crop quantity');
  if (quantity > stock || (stock === 0 && cost !== 0)) throw new RangeError('Invalid weighted-cost holding or quantity');
  if (quantity === 0) return 0;
  if (quantity === stock) return cost;
  return Number(BigInt(cost) * BigInt(quantity) / BigInt(stock));
}
export type DailyProposal<T> = { ok: boolean; reason: AgricultureReason; next: T; quantity: number; batches: number; outputQuantity: number; costReleased: number };
const daily = <T>(next: T, ok: boolean, reason: AgricultureReason, quantity = 0, batches = 0, outputQuantity = 0, costReleased = 0): DailyProposal<T> => ({ ok, reason, next, quantity, batches, outputQuantity, costReleased });
function dailyInput(state: HarvestState, options: { tick: number; workers: number; operational: boolean }, capacity: number): AgricultureReason | null {
  if (!validCropHolding(state, capacity) || !record(options) || !isSafeCount(state.productionTick) || !isSafeCount(options.tick) || !isSafeCount(options.workers) || typeof options.operational !== 'boolean') return 'invalid-input';
  if (options.tick < state.productionTick) return 'stale-tick';
  if (options.tick === state.productionTick) return 'already-processed';
  return null;
}
/**
 * A valid daily attempt, including a blocked day, stamps productionTick once.
 * An invalid, duplicate or stale attempt returns unchanged copied state.
 * The stock cap truncates harvest using BigInt even for huge safe worker counts.
 */
export function proposeHarvest(state: HarvestState, options: { tick: number; workers: number; fertility: number; operational: boolean }): DailyProposal<HarvestState> {
  const failure = dailyInput(state, options, CROP_STOCK_CAPS.F);
  if (failure || !isSafeCount(options.fertility) || options.fertility > 100) return daily({ ...state }, false, failure ?? 'invalid-input');
  const next = { ...state, productionTick: options.tick };
  if (!options.operational) return daily(next, true, 'not-operational');
  if (!isViableFarmland(options.fertility)) return daily(next, true, 'unsuitable-fertility');
  if (!options.workers) return daily(next, true, 'no-workers');
  const room = CROP_STOCK_CAPS.F - state.cropInventory;
  if (!room) return daily(next, true, 'stock-cap');
  const possible = BigInt(Math.floor(24 * options.fertility / 100)) * BigInt(options.workers);
  const quantity = Number(possible < BigInt(room) ? possible : BigInt(room));
  next.cropInventory += quantity;
  return daily(next, true, 'harvested', quantity);
}
export function proposeRecipe(state: RecipeState, options: { tick: number; workers: number; operational: boolean }): DailyProposal<RecipeState> {
  const failure = dailyInput(state, options, CROP_STOCK_CAPS.I);
  if (failure || !isSafeCount(state.inventory)) return daily({ ...state }, false, failure ?? 'invalid-input');
  const next = { ...state, productionTick: options.tick };
  if (!options.operational) return daily(next, true, 'not-operational');
  if (!options.workers) return daily(next, true, 'no-workers');
  if (state.cropInventory < CROP_RECIPE.crop) return daily(next, true, 'no-input');
  const outputRoom = Number.MAX_SAFE_INTEGER - state.inventory;
  const batches = Math.min(options.workers, Math.floor(state.cropInventory / CROP_RECIPE.crop), Math.floor(outputRoom / CROP_RECIPE.goods));
  if (!batches) return daily(next, true, 'output-limit');
  const quantity = batches * CROP_RECIPE.crop, outputQuantity = batches * CROP_RECIPE.goods, costReleased = releaseCropCost(state.cropInventory, state.cropCost, quantity);
  next.cropInventory -= quantity; next.cropCost -= costReleased; next.inventory += outputQuantity;
  return daily(next, true, 'processed', quantity, batches, outputQuantity, costReleased);
}
function walletValid(wallet: unknown, kind: 'firm' | 'household'): wallet is string {
  if (typeof wallet !== 'string' || !new RegExp('^' + kind + ':[1-9][0-9]*$').test(wallet)) return false;
  return isSafeCount(Number(wallet.slice(kind.length + 1)), 1);
}
export function validCropAccount(value: unknown): value is CropAccount {
  return record(value) && walletValid(value.wallet, 'firm') && isSafeCount(value.cash) && isSafeCount(value.reservedCash) && value.reservedCash <= value.cash && (value.zone === 'F' || value.zone === 'T' || value.zone === 'I') && validCropHolding(value, CROP_STOCK_CAPS[value.zone]);
}
export function cropPrice(from: CropZone, to: CropZone, prices: CropPrices = CROP_PRICES): number | null {
  if ((from === 'F' || from === 'I') && to === 'T') return prices.farmToTrader;
  if (from === 'T' && to === 'I') return prices.traderToFactory;
  if (from === 'F' && to === 'I') return prices.farmToFactory;
  return null;
}
export type CropPurchaseProposal = { ok: boolean; reason: AgricultureReason; nextSeller: CropAccount; nextBuyer: CropAccount; quantity: number; cash: number; fromValue: number; toValue: number; sellerRevenue: number; sellerExpense: number; buyerExpense: number; margin: number };
function purchaseResult(seller: CropAccount, buyer: CropAccount, ok: boolean, reason: AgricultureReason, quantity = 0, cash = 0, fromValue = 0): CropPurchaseProposal {
  return { ok, reason, nextSeller: { ...seller }, nextBuyer: { ...buyer }, quantity, cash, fromValue, toValue: cash, sellerRevenue: cash, sellerExpense: fromValue, buyerExpense: 0, margin: cash - fromValue };
}
/**
 * A proposal is not a reservation. Commit sequentially against current canonical
 * state. For trader sales pass the shared remaining start-of-day sellableLimit;
 * buying stock never enlarges that limit or creates operating profit/expense.
 */
export function proposeCropPurchase(seller: CropAccount, buyer: CropAccount, options: { quantity: number; sellableLimit?: number; prices?: CropPrices }): CropPurchaseProposal {
  const fail = (reason: AgricultureReason) => purchaseResult(seller, buyer, false, reason);
  if (!validCropAccount(seller) || !validCropAccount(buyer) || !record(options) || !isSafeCount(options.quantity, 1) || (options.sellableLimit !== undefined && !isSafeCount(options.sellableLimit))) return fail('invalid-input');
  if (seller.wallet === buyer.wallet) return fail('same-counterparty');
  const price = cropPrice(seller.zone, buyer.zone, options.prices);
  if (price === null) return fail('invalid-channel');
  if (options.quantity > seller.cropInventory) return fail('insufficient-stock');
  if (options.quantity > (options.sellableLimit ?? seller.cropInventory)) return fail('sellable-limit');
  if (options.quantity > CROP_STOCK_CAPS[buyer.zone] - buyer.cropInventory) return fail('capacity');
  let cash: number, buyerCost: number, sellerCash: number;
  try { cash = safeMultiply(options.quantity, price); buyerCost = safeAdd(buyer.cropCost, cash); sellerCash = safeAdd(seller.cash, cash); } catch { return fail('overflow'); }
  if (cash > buyer.cash - buyer.reservedCash) return fail('insufficient-cash');
  const released = releaseCropCost(seller.cropInventory, seller.cropCost, options.quantity), result = purchaseResult(seller, buyer, true, 'purchased', options.quantity, cash, released);
  result.nextSeller.cropInventory -= options.quantity; result.nextSeller.cropCost -= released; result.nextSeller.cash = sellerCash;
  result.nextBuyer.cropInventory += options.quantity; result.nextBuyer.cropCost = buyerCost; result.nextBuyer.cash -= cash;
  return result;
}
/** Only the two admitted catalog entries may satisfy the shared household basket. */
export function canHouseholdConsume(value: unknown): boolean {
  if (typeof value === 'string') return Object.hasOwn(COMMODITIES, value) && COMMODITIES[value as keyof typeof COMMODITIES].directConsumable;
  if (!record(value) || typeof value.id !== 'string' || !Object.hasOwn(COMMODITIES, value.id)) return false;
  const canonical = COMMODITIES[value.id as keyof typeof COMMODITIES];
  return value.directConsumable === true && value.industrialInput === canonical.industrialInput && value.unit === canonical.unit;
}
export type CropConsumptionProposal = { ok: boolean; reason: AgricultureReason; nextTrader: CropAccount; nextHousehold: HouseholdAccount; quantity: number; cash: number; fromValue: number; toValue: 0; sellerRevenue: number; sellerExpense: number; margin: number };
export function proposeCropConsumption(trader: CropAccount, household: HouseholdAccount, options: { tick: number; sellableLimit: number; commodity?: unknown; allowRepeat?: boolean }): CropConsumptionProposal {
  const result = (ok: boolean, reason: AgricultureReason, quantity = 0, cash = 0, fromValue = 0): CropConsumptionProposal => ({ ok, reason, nextTrader: { ...trader }, nextHousehold: { ...household }, quantity, cash, fromValue, toValue: 0, sellerRevenue: cash, sellerExpense: fromValue, margin: cash - fromValue });
  const fail = (reason: AgricultureReason) => result(false, reason);
  if (!validCropAccount(trader) || !record(household) || !record(options) || !walletValid(household.wallet, 'household') || !isSafeCount(household.cash) || !isSafeCount(household.lastPurchaseTick, -1) || !isSafeCount(options.tick) || household.lastPurchaseTick > options.tick || !isSafeCount(options.sellableLimit)) return fail('invalid-input');
  if (trader.zone !== 'T') return fail('invalid-channel');
  const commodity = options.commodity === undefined ? 'crop' : options.commodity;
  if (!canHouseholdConsume(commodity)) return fail('not-consumable');
  if ((typeof commodity === 'string' ? commodity : (commodity as CommodityDefinition).id) !== 'crop') return fail('wrong-commodity');
  if (household.lastPurchaseTick === options.tick && !options.allowRepeat) return fail('already-consumed');
  if (!trader.cropInventory) return fail('insufficient-stock');
  if (!options.sellableLimit) return fail('sellable-limit');
  if (household.cash < CROP_PRICES.householdCrop) return fail('insufficient-cash');
  let traderCash: number; try { traderCash = safeAdd(trader.cash, CROP_PRICES.householdCrop); } catch { return fail('overflow'); }
  const released = releaseCropCost(trader.cropInventory, trader.cropCost, 1), proposal = result(true, 'consumed', 1, CROP_PRICES.householdCrop, released);
  proposal.nextTrader.cropInventory--; proposal.nextTrader.cropCost -= released; proposal.nextTrader.cash = traderCash;
  proposal.nextHousehold.cash -= CROP_PRICES.householdCrop; proposal.nextHousehold.lastPurchaseTick = options.tick;
  return proposal;
}
export type CropExportProposal = { ok: boolean; reason: AgricultureReason; nextFarm: CropAccount; quantity: number; cash: number; fromValue: number };
/** Sell a farm's stock above the local reserve to outside at the export price. */
export function proposeCropExport(farm: CropAccount, limit = Number.MAX_SAFE_INTEGER): CropExportProposal {
  const fail = (reason: AgricultureReason): CropExportProposal => ({ ok: false, reason, nextFarm: { ...farm }, quantity: 0, cash: 0, fromValue: 0 });
  if (!validCropAccount(farm)) return fail('invalid-input');
  if (farm.zone !== 'F') return fail('invalid-channel');
  if (!isSafeCount(limit)) return fail('invalid-input');
  const quantity = Math.min(farm.cropInventory - CROP_EXPORT.keep, limit);
  if (quantity <= 0) return fail('insufficient-stock');
  let cash: number, nextCash: number; try { cash = safeMultiply(quantity, CROP_EXPORT.price); nextCash = safeAdd(farm.cash, cash); } catch { return fail('overflow'); }
  const fromValue = releaseCropCost(farm.cropInventory, farm.cropCost, quantity);
  return { ok: true, reason: 'exported', nextFarm: { ...farm, cropInventory: farm.cropInventory - quantity, cropCost: farm.cropCost - fromValue, cash: nextCash }, quantity, cash, fromValue };
}
