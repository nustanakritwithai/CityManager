/** Canonical crop operations. Proposals are checked before synchronous commits. */
import { farmCrop, isMarket, isRetail, type City, type Firm, type Household, type CropEntry } from './sim.ts';
import { CROPS, RECIPE, emptyCrops, freshPreference, type CropId } from './goods.ts';
import {
  CHAIN_CROP_PRICES as CROP_PRICES, CROP_STOCK_CAPS, isSafeCount, isViableFarmland,
  proposeHarvest, proposeRecipe, proposeCropPurchase, proposeCropConsumption, proposeCropExport,
  validCropAccount, validCropHolding, safeAdd, releaseCropCost, harvestYield,
  type CropAccount,
} from './agriculture.ts';

/** Hooks append only their stated journal and change only named cash accounts. */
export type AgricultureHooks = {
  connected(cell: number): boolean;
  /** Whether the building has the water and power it draws today. */
  served(buildingId: number): boolean;
  workers(firm: Firm): number;
  spendable(firm: Firm): number;
  transfer(from: string, to: string, amount: number, reason: string, book?: boolean): number;
  goodsTransfer(from: string, to: string, quantity: number, reason: string, product: import('./goods.ts').ProductId): void;
};
export type AgricultureDiagnostic = { reasonId: string; qty: number; unit: 'crop lot'; tick: number };

const cappedProduct = (count: number, factor: number, cap: number): number => {
  if (!isSafeCount(count)) throw new RangeError('Invalid worker count');
  const value = BigInt(count) * BigInt(factor); return Number(value > BigInt(cap) ? BigInt(cap) : value);
};
function workers(firm: Firm, hooks: AgricultureHooks): number | null {
  const value = hooks.workers(firm); return isSafeCount(value) ? value : null;
}
function operational(c: City, firm: Firm, hooks: AgricultureHooks): boolean {
  const building = c.buildings.find(b => b.id === firm.building && b.zone === firm.zone), count = workers(firm, hooks);
  if (!c.firms.includes(firm) || !building || !hooks.served(building.id) || !hooks.connected(building.cell) || count === null || count === 0) return false;
  return !isMarket(firm) || !!firm.owner && c.ownerLabor.some(e => e.firmId === firm.id && e.householdId === firm.owner!.householdId && e.workers === 1);
}
function accessibleHousehold(c: City, h: Household, hooks: AgricultureHooks): boolean {
  const home = c.buildings.find(b => b.id === h.home && b.zone === 'R');
  return c.households.includes(h) && !!home && hooks.connected(home.cell);
}
function cropAccount(c: City, f: Firm, hooks: AgricultureHooks): CropAccount | null {
  if (f.zone !== 'F' && !isMarket(f) && f.zone !== 'I') return null;
  const cash = c.accounts[f.wallet], available = hooks.spendable(f);
  if (!isSafeCount(cash) || !isSafeCount(available) || available > cash) return null;
  const account: CropAccount = { wallet: f.wallet, zone: isMarket(f) ? 'T' : f.zone as 'F' | 'I', cropInventory: f.cropInventory, cropCost: f.cropCost, cash, reservedCash: cash - available };
  return validCropAccount(account) ? account : null;
}
function nextEntry(c: City): number {
  if (!isSafeCount(c.tick) || !Array.isArray(c.cropLedger) || (c.cropLedger.length > 0 && c.cropLedger.at(-1)?.id !== c.cropLedger.length)) throw new RangeError('Invalid crop journal');
  return safeAdd(c.cropLedger.length, 1);
}
type EntryFields = Omit<CropEntry, 'id' | 'tick'>;
function entry(c: City, fields: EntryFields): CropEntry {
  const id = nextEntry(c);
  for (const key of ['quantity', 'fromValue', 'toValue', 'cash', 'workers', 'batches', 'outputQuantity'] as const) if (!isSafeCount(fields[key], key === 'quantity' ? 1 : 0)) throw new RangeError('Invalid crop event');
  return { id, tick: c.tick, ...fields };
}

/** A failed callback/partial payment cannot leave a half crop operation. */
function commit(c: City, firms: Firm[], h: Household | null, quota: Map<number, number> | null, action: () => void): boolean {
  const firmsBefore = firms.map(f => [f, { cropInventory: f.cropInventory, cropCost: f.cropCost, inventory: f.inventory, crops: { ...f.crops }, products: { ...f.products }, productionTick: f.productionTick, monthlyRevenue: f.monthlyRevenue, monthlyExpense: f.monthlyExpense }] as const);
  const wallets = [...new Set([...firms.map(f => f.wallet), ...(h ? [h.wallet] : [])])];
  const cashBefore = wallets.map(wallet => [wallet, c.accounts[wallet]] as const);
  const ledgerLength = c.ledger.length, goodsLength = c.goodsLedger.length, cropLength = c.cropLedger.length;
  const cropsBefore = { ...c.crops }, goodsBefore = { ...c.goods }, householdBefore = h ? { needs: h.needs, lastPurchaseTick: h.lastPurchaseTick } : null;
  const quotaBefore = quota ? new Map(quota) : null;
  try { action(); return true; }
  catch {
    for (const [f, state] of firmsBefore) Object.assign(f, state);
    for (const [wallet, cash] of cashBefore) c.accounts[wallet] = cash;
    c.ledger.length = ledgerLength; c.goodsLedger.length = goodsLength; c.cropLedger.length = cropLength;
    Object.assign(c.crops, cropsBefore); Object.assign(c.goods, goodsBefore);
    if (h && householdBefore) Object.assign(h, householdBefore);
    if (quota && quotaBefore) { quota.clear(); for (const [id, qty] of quotaBefore) quota.set(id, qty); }
    return false;
  }
}
function cashPayment(hooks: AgricultureHooks, from: string, to: string, amount: number, reason: string): void {
  if (hooks.transfer(from, to, amount, reason, false) !== amount) throw new Error('Crop operation requires its full prevalidated payment');
}

function exchange(c: City, seller: Firm, buyer: Firm, crop: CropId, quantity: number, quota: Map<number, number>, hooks: AgricultureHooks): boolean {
  if (!operational(c, seller, hooks) || !operational(c, buyer, hooks) || quantity > seller.crops[crop]) return false;
  const from = cropAccount(c, seller, hooks), to = cropAccount(c, buyer, hooks);
  if (!from || !to) return false;
  const limit = isMarket(seller) ? quota.get(seller.id) ?? 0 : undefined;
  const proposal = proposeCropPurchase(from, to, { quantity, prices: CROP_PRICES, ...(limit === undefined ? {} : { sellableLimit: limit }) });
  if (!proposal.ok) return false;
  let event: CropEntry, revenue: number, expense: number;
  try {
    revenue = safeAdd(seller.monthlyRevenue, proposal.sellerRevenue); expense = safeAdd(seller.monthlyExpense, proposal.sellerExpense);
    const id = nextEntry(c);
    event = entry(c, { kind: 'trade', from: seller.wallet, to: buyer.wallet, quantity: proposal.quantity, fromValue: proposal.fromValue, toValue: proposal.toValue, cash: proposal.cash, workers: 0, batches: 0, outputQuantity: 0, reason: `Crop exchange #${id}`, crop });
  } catch { return false; }
  return commit(c, [seller, buyer], null, quota, () => {
    cashPayment(hooks, buyer.wallet, seller.wallet, proposal.cash, event.reason);
    seller.cropInventory = proposal.nextSeller.cropInventory; seller.cropCost = proposal.nextSeller.cropCost;
    buyer.cropInventory = proposal.nextBuyer.cropInventory; buyer.cropCost = proposal.nextBuyer.cropCost;
    seller.crops[crop] -= proposal.quantity; buyer.crops[crop] += proposal.quantity;
    seller.monthlyRevenue = revenue; seller.monthlyExpense = expense;
    if (limit !== undefined) quota.set(seller.id, limit - proposal.quantity);
    c.cropLedger.push(event);
  });
}

function harvest(c: City, f: Firm, hooks: AgricultureHooks): void {
  const building = c.buildings.find(b => b.id === f.building), count = workers(f, hooks);
  if (!building || count === null) return;
  const proposal = proposeHarvest({ cropInventory: f.cropInventory, cropCost: f.cropCost, productionTick: f.productionTick }, { tick: c.tick, workers: count, fertility: c.resources.fertility[building.cell], operational: operational(c, f, hooks) });
  if (!proposal.ok) return;
  if (!proposal.quantity) { f.productionTick = proposal.next.productionTick; return; }
  let event: CropEntry, harvested: number;
  try {
    harvested = safeAdd(c.crops.harvested, proposal.quantity);
    const id = nextEntry(c);
    event = entry(c, { kind: 'harvest', from: 'environment:crops', to: f.wallet, quantity: proposal.quantity, fromValue: 0, toValue: 0, cash: 0, workers: count, batches: 0, outputQuantity: 0, reason: `Farm harvest #${id}`, crop: farmCrop(c, f) });
  } catch { return; }
  commit(c, [f], null, null, () => { Object.assign(f, proposal.next); f.crops[event.crop!] += proposal.quantity; c.crops.harvested = harvested; c.cropLedger.push(event); });
}
function process(c: City, f: Firm, hooks: AgricultureHooks): void {
  const count = workers(f, hooks); if (count === null || !f.recipe) return;
  const recipe = RECIPE[f.recipe];
  const proposal = proposeRecipe({ cropInventory: f.cropInventory, cropCost: f.cropCost, inventory: f.inventory, productionTick: f.productionTick }, { tick: c.tick, workers: count, operational: operational(c, f, hooks) });
  if (!proposal.ok) return;
  if (!proposal.quantity) { f.productionTick = proposal.next.productionTick; return; }
  let event: CropEntry, processed: number, produced: number, expense: number;
  try {
    processed = safeAdd(c.crops.processed, proposal.quantity); produced = safeAdd(c.goods.produced, proposal.outputQuantity); expense = safeAdd(f.monthlyExpense, proposal.costReleased);
    const id = nextEntry(c);
    event = entry(c, { kind: 'process', from: f.wallet, to: 'processing', quantity: proposal.quantity, fromValue: proposal.costReleased, toValue: 0, cash: 0, workers: count, batches: proposal.batches, outputQuantity: proposal.outputQuantity, reason: `Crop recipe #${id}`, crop: recipe.crop });
  } catch { return; }
  commit(c, [f], null, null, () => {
    hooks.goodsTransfer('production', f.wallet, proposal.outputQuantity, event.reason, recipe.product);
    Object.assign(f, proposal.next); f.crops[recipe.crop] -= proposal.quantity; f.products[recipe.product] += proposal.outputQuantity; f.monthlyExpense = expense; c.crops.processed = processed; c.goods.produced = produced; c.cropLedger.push(event);
  });
}

/** Excludes every T acquisition made today, including on repeated runtime calls. */
function openingSellable(c: City, traders: Firm[]): Map<number, number> {
  const acquired = new Map<string, bigint>();
  // Canonical journal appends are chronological; inspect only today's suffix.
  for (let i = c.cropLedger.length - 1; i >= 0; i--) {
    const event = c.cropLedger[i]; if (event.tick < c.tick) break;
    if (event.tick !== c.tick) throw new RangeError('Invalid crop trade tick');
    if (event.kind === 'trade') {
      if (!isSafeCount(event.quantity, 1)) throw new RangeError('Invalid crop trade history');
      acquired.set(event.to, (acquired.get(event.to) ?? 0n) + BigInt(event.quantity));
    }
  }
  return new Map(traders.map(f => {
    const id = f.id;
    if (!validCropHolding(f, CROP_STOCK_CAPS.T)) return [id, 0];
    const remaining = BigInt(f.cropInventory) - (acquired.get(f.wallet) ?? 0n);
    return [id, Number(remaining > 0n ? remaining : 0n)];
  }));
}

/** Harvest → factory purchases → market purchases → input-backed factory output. */
export function runAgriculture(c: City, hooks: AgricultureHooks): Map<number, number> {
  const byId = (a: Firm, b: Firm) => a.id - b.id;
  const farms = c.firms.filter(f => f.zone === 'F').sort(byId), traders = c.firms.filter(f => isMarket(f)).sort(byId), factories = c.firms.filter(f => f.zone === 'I').sort(byId);
  let sellable: Map<number, number>;
  try { sellable = openingSellable(c, traders); } catch { return new Map(traders.map(f => [f.id, 0])); }
  for (const farm of farms) harvest(c, farm, hooks);
  const activeFarms = farms.filter(f => operational(c, f, hooks)), activeTraders = traders.filter(f => operational(c, f, hooks)), activeFactories = factories.filter(f => operational(c, f, hooks));
  // Each factory buys only its recipe's crop: market stock first (ID order), then farms growing it.
  const sellersFor = new Map(CROPS.map(crop => [crop, [...activeTraders.map(f => ({ firm: f, price: CROP_PRICES.traderToFactory })), ...activeFarms.filter(f => farmCrop(c, f) === crop).map(f => ({ firm: f, price: CROP_PRICES.farmToFactory }))]]));
  const sourceFor = new Map(CROPS.map(crop => [crop, 0]));
  for (const factory of activeFactories) {
    if (!isSafeCount(factory.productionTick) || factory.productionTick >= c.tick || !factory.recipe) continue;
    const crop = RECIPE[factory.recipe].crop, sellers = sellersFor.get(crop)!; let source = sourceFor.get(crop)!;
    let target: number; try { target = cappedProduct(workers(factory, hooks)!, 4, CROP_STOCK_CAPS.I); } catch { continue; }
    while (source < sellers.length && factory.cropInventory < target) {
      const { firm: seller, price } = sellers[source], available = Math.min(seller.crops[crop], isMarket(seller) ? Math.min(seller.cropInventory, sellable.get(seller.id) ?? 0) : seller.cropInventory);
      if (!isSafeCount(available, 1)) { source++; continue; }
      const budget = hooks.spendable(factory); if (!isSafeCount(budget) || budget < price) break;
      const qty = Math.min(available, target - factory.cropInventory, Math.floor(budget / price));
      if (!exchange(c, seller, factory, crop, qty, sellable, hooks)) { source++; continue; }
      if (qty === available) source++;
    }
    sourceFor.set(crop, source);
  }
  // Bounded two-day crop target from actual active factory capacity and unmet,
  // affordable household baskets. No buyers means no speculative replenishment.
  let demand = 0n;
  for (const factory of activeFactories) demand += BigInt(workers(factory, hooks)!) * 2n;
  for (const h of c.households) if (accessibleHousehold(c, h, hooks) && isSafeCount(c.accounts[h.wallet]) && c.accounts[h.wallet] >= CROP_PRICES.householdCrop && h.lastPurchaseTick < c.tick) demand++;
  const target = Number(demand * 2n > BigInt(CROP_STOCK_CAPS.T) ? BigInt(CROP_STOCK_CAPS.T) : demand * 2n);
  // A market stocks an even share of each crop the city grows, then fills any gap from whatever is left.
  const grown = CROPS.filter(k => activeFarms.some(f => farmCrop(c, f) === k)), farmIndex = new Map<CropId | 'any', number>();
  const buyFrom = (trader: Firm, farms: Firm[], key: CropId | 'any', limit: (crop: CropId) => number) => {
    let i = farmIndex.get(key) ?? 0;
    while (i < farms.length && trader.cropInventory < target) {
      const farm = farms[i], crop = farmCrop(c, farm); if (!isSafeCount(farm.cropInventory, 1) || limit(crop) <= 0) { i++; continue; }
      const budget = hooks.spendable(trader); if (!isSafeCount(budget) || budget < CROP_PRICES.farmToTrader) break;
      const qty = Math.min(farm.cropInventory, target - trader.cropInventory, limit(crop), Math.floor(budget / CROP_PRICES.farmToTrader));
      if (!exchange(c, farm, trader, crop, qty, sellable, hooks)) { i++; continue; }
      if (farm.cropInventory === 0) i++;
    }
    farmIndex.set(key, i);
  };
  for (const trader of activeTraders) {
    if (!isSafeCount(trader.productionTick) || trader.productionTick >= c.tick || !validCropHolding(trader, CROP_STOCK_CAPS.T)) continue;
    const share = Math.ceil(target / Math.max(1, grown.length));
    for (const crop of grown) buyFrom(trader, activeFarms.filter(f => farmCrop(c, f) === crop), crop, k => share - trader.crops[k]);
    buyFrom(trader, activeFarms, 'any', () => target - trader.cropInventory);
    trader.productionTick = c.tick;
  }
  // What local buyers left above each farm's reserve goes out through the gateway.
  for (const farm of activeFarms) exportSurplus(c, farm, hooks);
  for (const factory of factories) process(c, factory, hooks);
  return sellable;
}

function exportSurplus(c: City, farm: Firm, hooks: AgricultureHooks): void {
  const account = cropAccount(c, farm, hooks); if (!account) return;
  const proposal = proposeCropExport(account); if (!proposal.ok) return;
  let event: CropEntry, exported: number, revenue: number, expense: number;
  try {
    exported = safeAdd(c.crops.exported ?? 0, proposal.quantity); revenue = safeAdd(farm.monthlyRevenue, proposal.cash); expense = safeAdd(farm.monthlyExpense, proposal.fromValue);
    const id = nextEntry(c);
    event = entry(c, { kind: 'export', from: farm.wallet, to: 'outside', quantity: proposal.quantity, fromValue: proposal.fromValue, toValue: proposal.cash, cash: proposal.cash, workers: 0, batches: 0, outputQuantity: 0, reason: `Crop export #${id}`, crop: farmCrop(c, farm) });
  } catch { return; }
  commit(c, [farm], null, null, () => {
    cashPayment(hooks, 'outside', farm.wallet, proposal.cash, event.reason);
    farm.cropInventory = proposal.nextFarm.cropInventory; farm.cropCost = proposal.nextFarm.cropCost; farm.crops[event.crop!] -= proposal.quantity; farm.monthlyRevenue = revenue; farm.monthlyExpense = expense;
    c.crops.exported = exported; c.cropLedger.push(event);
  });
}

/** Fulfils the same ONE daily basket as generic retail, from canonical T stock. */
export function consumeMarketCrop(c: City, h: Household, firm: Firm, sellable: Map<number, number>, hooks: AgricultureHooks): boolean {
  if (!isMarket(firm) || !operational(c, firm, hooks) || !accessibleHousehold(c, h, hooks)) return false;
  const trader = cropAccount(c, firm, hooks), limit = sellable.get(firm.id) ?? 0;
  const crop = freshPreference(h.id, c.tick).find(k => firm.crops[k] > 0);
  if (!trader || !crop) return false;
  const proposal = proposeCropConsumption(trader, { wallet: h.wallet, cash: c.accounts[h.wallet], lastPurchaseTick: h.lastPurchaseTick }, { tick: c.tick, sellableLimit: limit, commodity: 'crop' });
  if (!proposal.ok) return false;
  let event: CropEntry, consumed: number, revenue: number, expense: number;
  try {
    consumed = safeAdd(c.crops.consumed, 1); revenue = safeAdd(firm.monthlyRevenue, proposal.sellerRevenue); expense = safeAdd(firm.monthlyExpense, proposal.sellerExpense);
    const id = nextEntry(c);
    event = entry(c, { kind: 'consumption', from: firm.wallet, to: h.wallet, quantity: 1, fromValue: proposal.fromValue, toValue: 0, cash: proposal.cash, workers: 0, batches: 0, outputQuantity: 0, reason: `Fresh crop purchase #${id}`, crop });
  } catch { return false; }
  return commit(c, [firm], h, sellable, () => {
    cashPayment(hooks, h.wallet, firm.wallet, proposal.cash, event.reason);
    firm.cropInventory = proposal.nextTrader.cropInventory; firm.cropCost = proposal.nextTrader.cropCost; firm.crops[crop]--; firm.monthlyRevenue = revenue; firm.monthlyExpense = expense;
    h.lastPurchaseTick = proposal.nextHousehold.lastPurchaseTick; h.needs = 0; c.crops.consumed = consumed; sellable.set(firm.id, limit - 1); c.cropLedger.push(event);
  });
}

/** Demolition may write off disconnected stock; it never creates a cash receipt. */
export function writeOffCrops(c: City, firm: Firm, _hooks: AgricultureHooks): boolean {
  if (!c.firms.includes(firm)) return false;
  const cap = isRetail(firm) ? 0 : isMarket(firm) ? CROP_STOCK_CAPS.T : CROP_STOCK_CAPS[firm.zone as 'F' | 'I'];
  if (!validCropHolding(firm, cap)) return false;
  if (!firm.cropInventory) return true;
  let event: CropEntry, writtenOff: number, expense: number;
  try {
    writtenOff = safeAdd(c.crops.writtenOff, firm.cropInventory); expense = safeAdd(firm.monthlyExpense, firm.cropCost);
    const id = nextEntry(c), released = releaseCropCost(firm.cropInventory, firm.cropCost, firm.cropInventory);
    event = entry(c, { kind: 'writeoff', from: firm.wallet, to: 'outside', quantity: firm.cropInventory, fromValue: released, toValue: 0, cash: 0, workers: 0, batches: 0, outputQuantity: 0, reason: `Crop write-off #${id}`, mix: { ...firm.crops } });
  } catch { return false; }
  return commit(c, [firm], null, null, () => { firm.cropInventory = 0; firm.cropCost = 0; firm.crops = emptyCrops(); firm.monthlyExpense = expense; c.crops.writtenOff = writtenOff; c.cropLedger.push(event); });
}

/** Read-only diagnostics, quantity units and tick provenance for future adapters. */
export function agricultureDiagnostic(c: City, f: Firm, hooks: AgricultureHooks): AgricultureDiagnostic {
  const result = (reasonId: string, qty = f.cropInventory): AgricultureDiagnostic => ({ reasonId, qty, unit: 'crop lot', tick: c.tick });
  const b = c.buildings.find(b => b.id === f.building);
  if (!b || !hooks.connected(b.cell)) return result('agriculture.no-road');
  if (!hooks.served(b.id)) return result('agriculture.no-utilities');
  if (!workers(f, hooks) || !operational(c, f, hooks)) return result('agriculture.no-workers');
  if (f.zone === 'F') {
    const fertility = c.resources.fertility[b.cell];
    if (!isViableFarmland(fertility)) return result('agriculture.unsuitable-fertility');
    if (f.cropInventory >= CROP_STOCK_CAPS.F) return result('agriculture.stock-cap');
    return result('agriculture.harvest-ready', Math.min(CROP_STOCK_CAPS.F - f.cropInventory, harvestYield(fertility, workers(f, hooks)!)));
  }
  if (f.zone === 'I') return result(f.cropInventory < 2 ? 'agriculture.no-input' : 'agriculture.recipe-ready');
  if (isMarket(f)) {
    const buyers = c.firms.some(i => i.zone === 'I' && operational(c, i, hooks)) || c.households.some(h => accessibleHousehold(c, h, hooks) && h.lastPurchaseTick < c.tick && c.accounts[h.wallet] >= CROP_PRICES.householdCrop);
    if (!buyers) return result('agriculture.no-buyer');
    return result(f.cropInventory === 0 ? 'agriculture.no-stock' : 'agriculture.market-ready');
  }
  return result('agriculture.not-applicable', 0);
}
