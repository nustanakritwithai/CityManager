/** Read-only reconciliation for the agriculture extension, after base-city validation. */
import { isMarket, isRetail, type City, type CropEntry, type Firm } from './sim.ts';
import { CROP_EXPORT, CROP_STOCK_CAPS, isCanonicalResourceMap, isSafeCount, isViableFarmland, releaseCropCost, safeAdd, harvestYield } from './agriculture.ts';
import { RECIPE } from './goods.ts';

const invalid = (): never => { throw new Error('Unsupported or corrupt CityManager agriculture state.'); };
function requireThat(value: unknown): asserts value { if (!value) invalid(); }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
type Role = 'F' | 'T' | 'I';
type Holding = { quantity: number; value: number };
type Operating = { tick: number; revenue: number; expense: number; moneyIndex?: number };

/** No repair, allocation, time advance or writes occur here. Historical roads are not inferred. */
export function validateAgriculture(c: City): void {
  requireThat(isCanonicalResourceMap(c.resources, c.seed));
  requireThat(isSafeCount(c.agricultureStartTick) && c.agricultureStartTick <= c.tick);
  requireThat(object(c.crops) && ['harvested', 'processed', 'consumed', 'writtenOff'].every(key => isSafeCount(c.crops[key as keyof City['crops']])));
  requireThat(Array.isArray(c.cropLedger) && Array.isArray(c.ownerLabor));
  const firms = new Map(c.firms.map(f => [f.wallet, f]));
  const households = new Map(c.households.map(h => [h.id, h]));
  const ownerIds = new Set<number>();
  for (const f of c.firms) {
    const capacity = isRetail(f) ? 0 : isMarket(f) ? CROP_STOCK_CAPS.T : CROP_STOCK_CAPS[f.zone as 'F' | 'I'];
    requireThat(isSafeCount(f.cropInventory) && f.cropInventory <= capacity && isSafeCount(f.cropCost) && (f.cropInventory > 0 || f.cropCost === 0));
    requireThat(isSafeCount(f.productionTick) && f.productionTick >= c.agricultureStartTick && f.productionTick <= c.tick);
    if (isRetail(f)) requireThat(f.cropCost === 0);
    // Farms grow up to level 3 (one worker per level); crop markets stay single-stall.
    if (f.zone === 'F' || isMarket(f)) requireThat(f.inventory === 0 && (f.zone === 'F' || c.buildings.find(b => b.id === f.building)?.level === 1));
    if (f.zone === 'F') {
      const b = c.buildings.find(b => b.id === f.building);
      requireThat(b && isViableFarmland(c.resources.fertility[b.cell]) && f.cropCost === 0);
    }
    if (!isMarket(f) && !(isRetail(f) && f.owner !== null)) { requireThat(f.owner === null); continue; }
    const owner = f.owner;
    requireThat(object(owner) && isSafeCount(owner.householdId, 1) && households.has(owner.householdId) && !ownerIds.has(owner.householdId));
    requireThat(['capitalContributed', 'capitalReturned', 'withdrawn', 'taxPaid'].every(key => isSafeCount(owner[key as keyof typeof owner])));
    requireThat(owner.capitalContributed >= 60_000 && owner.capitalReturned === 0);
    // A household-owned shop may hire beside its owner; a market stall is the owner's labour alone.
    if (isMarket(f)) requireThat(Object.keys(f.workDays).length === 0 && !c.employment.some(e => e.firmId === f.id));
    ownerIds.add(owner.householdId);
  }
  const ownerFirms = new Set<number>();
  for (const e of c.ownerLabor) {
    requireThat(object(e) && isSafeCount(e.householdId, 1) && isSafeCount(e.firmId, 1) && e.workers === 1 && (e.skill === 'general' || e.skill === 'retail') && !ownerFirms.has(e.firmId));
    const h = households.get(e.householdId), f = c.firms.find(f => f.id === e.firmId);
    requireThat(h && h.home !== null && f && (isMarket(f) || isRetail(f)) && f.owner?.householdId === h.id);
    ownerFirms.add(e.firmId);
  }
  for (const h of c.households) {
    const salary = c.employment.filter(e => e.householdId === h.id), owner = c.ownerLabor.filter(e => e.householdId === h.id);
    requireThat(salary.reduce((n, e) => n + e.workers, 0) + owner.length <= h.workforce);
    for (const skill of ['general', 'manufacturing', 'retail'] as const) requireThat(salary.filter(e => e.skill === skill).reduce((n, e) => n + e.workers, 0) + owner.filter(e => e.skill === skill).length <= h.workerSkills[skill]);
  }

  const cashReasons = new Map<string, number[]>(), goodsReasons = new Map<string, number[]>();
  c.ledger.forEach((e, i) => { const rows = cashReasons.get(e.reason) ?? []; rows.push(i); cashReasons.set(e.reason, rows); });
  c.goodsLedger.forEach((e, i) => { const rows = goodsReasons.get(e.reason) ?? []; rows.push(i); goodsReasons.set(e.reason, rows); });
  const matchedCash = new Set<number>(), matchedGoods = new Set<number>();
  const roles = new Map<string, Role>(), holdings = new Map<string, Holding>(), operating = new Map<string, Operating[]>();
  const op = (wallet: string, item: Operating) => { const rows = operating.get(wallet) ?? []; rows.push(item); operating.set(wallet, rows); };
  const role = (wallet: string, expected?: Role): Role | undefined => {
    requireThat(/^firm:[1-9][0-9]*$/.test(wallet) && Object.hasOwn(c.accounts, wallet));
    const current = firms.get(wallet), known = roles.get(wallet);
    // A shop converted from a market traded crops as a market up to and including its conversion day.
    const currentRole = current && (isMarket(current) ? 'T' : isRetail(current) ? (current.convertedAt !== undefined && day <= current.convertedAt ? 'T' : undefined) : current.zone);
    if (current) requireThat(currentRole !== undefined && (!expected || currentRole === expected));
    if (known && expected) requireThat(known === expected);
    const result = expected ?? known ?? (currentRole as Role | undefined);
    if (result) roles.set(wallet, result);
    return result;
  };
  const cropDestinationRole = (wallet: string, crop: string): Role => {
    const f = firms.get(wallet); requireThat(f);
    if (isMarket(f)) return 'T';
    requireThat(f.zone === 'I' && f.recipe !== undefined && RECIPE[f.recipe].crop === crop);
    return 'I';
  };
  const holding = (wallet: string): Holding => { const value = holdings.get(wallet) ?? { quantity: 0, value: 0 }; holdings.set(wallet, value); return value; };
  const receive = (wallet: string, qty: number, value: number) => {
    const h = holding(wallet); h.quantity = safeAdd(h.quantity, qty); h.value = safeAdd(h.value, value);
    const known = role(wallet); if (known) requireThat(h.quantity <= CROP_STOCK_CAPS[known]);
  };
  const release = (e: CropEntry) => {
    const h = holding(e.from); requireThat(e.quantity <= h.quantity && e.fromValue === releaseCropCost(h.quantity, h.value, e.quantity));
    h.quantity -= e.quantity; h.value -= e.fromValue;
  };
  const cash = (e: CropEntry, from: string, to: string): number => {
    const matches = cashReasons.get(e.reason) ?? []; requireThat(matches.length === 1);
    const index = matches[0], payment = c.ledger[index];
    requireThat(!matchedCash.has(index) && payment.tick === e.tick && payment.from === from && payment.to === to && payment.amount === e.cash);
    matchedCash.add(index); return index;
  };
  const baskets = new Set<string>(), latestPurchase = new Map<string, number>();
  const basket = (tick: number, wallet: string, quantity: number) => {
    requireThat(quantity === 1 && /^household:[1-9][0-9]*$/.test(wallet) && Object.hasOwn(c.accounts, wallet));
    const key = tick + ':' + wallet; requireThat(!baskets.has(key)); baskets.add(key);
    latestPurchase.set(wallet, Math.max(tick, latestPurchase.get(wallet) ?? -1));
  };
  for (const e of c.goodsLedger) if (e.tick > c.agricultureStartTick && e.to.startsWith('household:')) basket(e.tick, e.to, e.quantity);
  let previousTick = c.agricultureStartTick, day = -1;
  let sellable = new Map<string, number>();
  const dailyProduction = new Set<string>();
  const totals = { harvested: 0, processed: 0, consumed: 0, writtenOff: 0, exported: 0 };
  for (let i = 0; i < c.cropLedger.length; i++) {
    const e = c.cropLedger[i];
    requireThat(object(e) && e.id === i + 1 && isSafeCount(e.tick) && e.tick > c.agricultureStartTick && e.tick >= previousTick && e.tick <= c.tick && typeof e.from === 'string' && typeof e.to === 'string' && e.from !== e.to && typeof e.reason === 'string');
    requireThat(['quantity', 'fromValue', 'toValue', 'cash', 'workers', 'batches', 'outputQuantity'].every(key => isSafeCount(e[key as keyof CropEntry], key === 'quantity' ? 1 : 0)));
    previousTick = e.tick;
    if (day !== e.tick) { day = e.tick; sellable = new Map([...holdings].map(([wallet, h]) => [wallet, h.quantity])); }
    if (e.kind === 'harvest') {
      requireThat(e.from === 'environment:crops' && e.reason === `Farm harvest #${e.id}` && e.fromValue === 0 && e.toValue === 0 && e.cash === 0 && e.workers >= 1 && e.workers <= 3 && e.batches === 0 && e.outputQuantity === 0);
      role(e.to, 'F'); const before = holding(e.to), current = firms.get(e.to), b = current && c.buildings.find(b => b.id === current.building);
      if (b) requireThat(e.workers <= b.level);
      const maximum = Math.min(96 - before.quantity, b ? harvestYield(c.resources.fertility[b.cell], e.workers) : 24 * e.workers);
      requireThat(e.quantity <= maximum && (!b || e.quantity === maximum));
      const key = e.tick + ':' + e.to; requireThat(!dailyProduction.has(key)); dailyProduction.add(key);
      receive(e.to, e.quantity, 0); totals.harvested = safeAdd(totals.harvested, e.quantity);
    } else if (e.kind === 'trade') {
      requireThat(e.workers === 0 && e.batches === 0 && e.outputQuantity === 0 && e.toValue === e.cash && e.reason === `Crop exchange #${e.id}`);
      const unitPrice = e.cash / e.quantity;
      // 1.50 before chain-2 farm prices, 2.00 after; both are farm-to-market lots.
      if (unitPrice === 150 || unitPrice === 200) { role(e.from, 'F'); role(e.to, 'T'); }
      else if (unitPrice === 350) { role(e.from, 'F'); role(e.to, 'I'); }
      else { requireThat(unitPrice === 300); role(e.from, 'T'); role(e.to, 'I'); }
      if (role(e.from) === 'T') { const limit = sellable.get(e.from) ?? 0; requireThat(e.quantity <= limit); sellable.set(e.from, limit - e.quantity); }
      const index = cash(e, e.to, e.from); release(e); receive(e.to, e.quantity, e.toValue);
      op(e.from, { tick: e.tick, revenue: e.cash, expense: e.fromValue, moneyIndex: index });
    } else if (e.kind === 'consumption') {
      requireThat(e.reason === `Fresh crop purchase #${e.id}` && e.quantity === 1 && e.cash === 800 && e.toValue === 0 && e.workers === 0 && e.batches === 0 && e.outputQuantity === 0);
      role(e.from, 'T'); basket(e.tick, e.to, e.quantity);
      const limit = sellable.get(e.from) ?? 0; requireThat(limit >= 1); sellable.set(e.from, limit - 1);
      const index = cash(e, e.to, e.from); release(e); totals.consumed = safeAdd(totals.consumed, 1);
      op(e.from, { tick: e.tick, revenue: e.cash, expense: e.fromValue, moneyIndex: index });
    } else if (e.kind === 'process') {
      requireThat(e.to === 'processing' && e.reason === `Crop recipe #${e.id}` && e.cash === 0 && e.toValue === 0 && e.workers >= 1 && e.workers <= 6 && e.batches >= 1 && e.batches <= e.workers && e.quantity === 2 * e.batches && e.outputQuantity === 8 * e.batches);
      role(e.from, 'I'); release(e);
      const current = firms.get(e.from), b = current && c.buildings.find(b => b.id === current.building); if (b) requireThat(e.workers <= b.level + 3);
      const key = e.tick + ':' + e.from; requireThat(!dailyProduction.has(key)); dailyProduction.add(key);
      const matches = goodsReasons.get(e.reason) ?? []; requireThat(matches.length === 1);
      const index = matches[0], output = c.goodsLedger[index];
      requireThat(!matchedGoods.has(index) && output.tick === e.tick && output.from === 'production' && output.to === e.from && output.quantity === e.outputQuantity); matchedGoods.add(index);
      totals.processed = safeAdd(totals.processed, e.quantity);
    } else if (e.kind === 'export') {
      // A farm sells only what it holds above the local reserve, at the outside price.
      requireThat(e.to === 'outside' && e.reason === `Crop export #${e.id}` && e.cash === e.quantity * CROP_EXPORT.price && e.toValue === e.cash && e.workers === 0 && e.batches === 0 && e.outputQuantity === 0);
      role(e.from, 'F'); requireThat(holding(e.from).quantity - e.quantity === CROP_EXPORT.keep);
      const index = cash(e, 'outside', e.from); release(e); totals.exported = safeAdd(totals.exported, e.quantity);
      op(e.from, { tick: e.tick, revenue: e.cash, expense: e.fromValue, moneyIndex: index });
    } else if (e.kind === 'market-deposit') {
      requireThat(e.to === 'market-server' && e.reason === `Market escrow deposit #${e.id}` && e.toValue === e.fromValue && e.cash === 0 && e.workers === 0 && e.batches === 0 && e.outputQuantity === 0);
      role(e.from, 'F'); release(e); const deposited = holding(e.to); deposited.quantity = safeAdd(deposited.quantity, e.quantity); deposited.value = safeAdd(deposited.value, e.toValue);
    } else if (e.kind === 'market-refund') {
      requireThat(e.from === 'market-server' && e.reason === `Market escrow refund #${e.id}` && e.toValue === e.fromValue && e.cash === 0 && e.workers === 0 && e.batches === 0 && e.outputQuantity === 0);
      release(e); role(e.to, cropDestinationRole(e.to, e.crop)); receive(e.to, e.quantity, e.toValue);
    } else if (e.kind === 'market-receipt') {
      requireThat(e.from === 'market-server' && e.reason === `Market receipt #${e.id}` && e.fromValue === 0 && e.toValue === 0 && e.cash === 0 && e.workers === 0 && e.batches === 0 && e.outputQuantity === 0);
      role(e.to, cropDestinationRole(e.to, e.crop)); receive(e.to, e.quantity, e.toValue);
    } else {
      requireThat(e.kind === 'writeoff' && e.to === 'outside' && e.reason === `Crop write-off #${e.id}` && e.toValue === 0 && e.cash === 0 && e.workers === 0 && e.batches === 0 && e.outputQuantity === 0);
      role(e.from); requireThat(e.quantity === holding(e.from).quantity); release(e);
      totals.writtenOff = safeAdd(totals.writtenOff, e.quantity); op(e.from, { tick: e.tick, revenue: 0, expense: e.fromValue });
    }
    for (const wallet of [e.from, e.to]) { const f = firms.get(wallet); if (f) requireThat(f.productionTick >= e.tick); }
  }
  for (const key of ['harvested', 'processed', 'consumed', 'writtenOff'] as const) requireThat(totals[key] === c.crops[key]);
  requireThat(totals.exported === (c.crops.exported ?? 0) && (c.crops.exported === undefined || isSafeCount(c.crops.exported)));
  for (const [wallet, h] of holdings) {
    if (wallet === 'market-server') continue;
    const f = firms.get(wallet); requireThat(f ? f.cropInventory === h.quantity && f.cropCost === h.value : h.quantity === 0 && h.value === 0);
  }
  for (const f of c.firms) { const h = holdings.get(f.wallet); requireThat(f.cropInventory === (h?.quantity ?? 0) && f.cropCost === (h?.value ?? 0)); }
  c.ledger.forEach((e, i) => { if (/^(?:Crop exchange|Fresh crop purchase|Crop export) #/.test(e.reason)) requireThat(matchedCash.has(i)); });
  c.goodsLedger.forEach((e, i) => { if ((e.tick > c.agricultureStartTick && e.from === 'production') || /^Crop recipe #/.test(e.reason)) requireThat(matchedGoods.has(i)); });
  for (const h of c.households) { const tick = latestPurchase.get(h.wallet); if (tick !== undefined || h.lastPurchaseTick > c.agricultureStartTick) requireThat(h.lastPurchaseTick === tick); }

  for (const f of c.firms.filter(f => isMarket(f))) validateOwnerFinance(c, f, operating.get(f.wallet) ?? []);
  for (const f of c.firms.filter(f => isRetail(f) && f.owner)) validateShopOwner(c, f);
}

/** A household-owned shop: its owner paid the opening capital and every owner movement is in the ledger. */
function validateShopOwner(c: City, f: Firm): void {
  const owner = f.owner!, wallet = `household:${owner.householdId}`;
  let contributed = 0n, withdrawn = 0n, taxPaid = 0n;
  for (const e of c.ledger) {
    if (e.from !== f.wallet && e.to !== f.wallet) continue;
    requireThat(!e.reason.startsWith('Closing owner ') && e.reason !== 'Outside firm equity investment');
    if (e.reason === 'Owner capital contribution') { requireThat(e.from === wallet && e.to === f.wallet); if (contributed === 0n) requireThat(e.amount === 60_000); contributed += BigInt(e.amount); }
    if (e.reason === 'Owner profit distribution') { requireThat(e.from === f.wallet && e.to === wallet); withdrawn += BigInt(e.amount); }
    if (e.reason === 'Monthly firm profit tax') { requireThat(e.from === f.wallet && e.to === 'treasury'); taxPaid += BigInt(e.amount); }
  }
  requireThat(contributed === BigInt(owner.capitalContributed) && withdrawn === BigInt(owner.withdrawn) && taxPaid === BigInt(owner.taxPaid));
  const built = f.convertedAt === undefined ? 'Self-employed shop construction' : 'Self-employed market construction';
  const construction = c.ledger.filter(e => e.from === f.wallet && e.reason === built);
  requireThat(construction.length === 1 && construction[0].to === 'construction' && construction[0].amount === 10_000);
  const refit = c.ledger.filter(e => e.from === f.wallet && e.reason === 'Market to shop conversion');
  requireThat(f.convertedAt === undefined ? refit.length === 0 : refit.length === 1 && refit[0].to === 'construction' && refit[0].amount === 20_000 && refit[0].tick === f.convertedAt);
}

/** Capital/earnings movements are distinct from the stall's operating result. */
function validateOwnerFinance(c: City, f: Firm, operating: Operating[]): void {
  const owner = f.owner!, wallet = `household:${owner.householdId}`;
  let contributed = 0n, withdrawn = 0n, taxPaid = 0n, cash = 0n;
  const rows = [...operating];
  c.ledger.forEach((e, i) => {
    if (e.from === f.wallet && e.reason === 'Monthly firm rent') { requireThat(e.to === 'landlord'); rows.push({ tick: e.tick, revenue: 0, expense: e.amount, moneyIndex: i }); }
    // Water and power bills (chain-4) are operating costs too.
    if (e.from === f.wallet && e.reason === 'Monthly water and power bill') { requireThat(e.to === 'treasury'); rows.push({ tick: e.tick, revenue: 0, expense: e.amount, moneyIndex: i }); }
  });
  const earnings = (endTick: number, endIndex = Infinity, fromTick = -1) => rows.filter(e => e.tick > fromTick && e.tick <= endTick && (e.moneyIndex === undefined || e.moneyIndex < endIndex)).reduce((n, e) => n + BigInt(e.revenue) - BigInt(e.expense), 0n);
  for (let i = 0; i < c.ledger.length; i++) {
    const e = c.ledger[i]; if (e.from !== f.wallet && e.to !== f.wallet) continue;
    if (e.to === f.wallet) requireThat(e.reason === 'Owner capital contribution' || /^(?:Crop exchange|Fresh crop purchase) #\d+$/.test(e.reason));
    if (e.reason === 'Owner capital contribution') { requireThat(e.from === wallet && e.to === f.wallet); if (contributed === 0n) requireThat(e.amount === 60_000); contributed += BigInt(e.amount); }
    if (e.reason === 'Owner profit distribution') {
      requireThat(e.from === f.wallet && e.to === wallet);
      const current = earnings(e.tick, i, e.tick - e.tick % 30), reserve = current > 0n ? current / 5n : 0n;
      requireThat(BigInt(e.amount) <= earnings(e.tick, i) - taxPaid - withdrawn - reserve && cash - BigInt(e.amount) >= 20_000n + reserve);
      withdrawn += BigInt(e.amount);
    }
    if (e.reason === 'Monthly firm profit tax') { requireThat(e.from === f.wallet && e.to === 'treasury'); taxPaid += BigInt(e.amount); }
    requireThat(!e.reason.startsWith('Closing owner ') && e.reason !== 'Monthly wages');
    if (e.from === f.wallet) cash -= BigInt(e.amount); if (e.to === f.wallet) cash += BigInt(e.amount); requireThat(cash >= 0n);
  }
  requireThat(contributed === BigInt(owner.capitalContributed) && withdrawn === BigInt(owner.withdrawn) && taxPaid === BigInt(owner.taxPaid));
  const construction = c.ledger.filter(e => e.from === f.wallet && e.reason === 'Self-employed market construction');
  requireThat(construction.length === 1 && construction[0].to === 'construction' && construction[0].amount === 10_000);
  const settled = c.tick - c.tick % 30;
  requireThat(BigInt(f.profit) === earnings(settled) && BigInt(f.lastMonthProfit) === earnings(settled, Infinity, settled - 30));
  const current = rows.filter(e => e.tick > settled);
  requireThat(BigInt(f.monthlyRevenue) === current.reduce((n, e) => n + BigInt(e.revenue), 0n) && BigInt(f.monthlyExpense) === current.reduce((n, e) => n + BigInt(e.expense), 0n));
}
