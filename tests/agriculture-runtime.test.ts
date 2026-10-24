import test from 'node:test';
import assert from 'node:assert/strict';
import type { City, Firm, Household } from '../src/sim.ts';
import { createResourceMap } from '../src/agriculture.ts';
import { runAgriculture, consumeMarketCrop, writeOffCrops, agricultureDiagnostic, type AgricultureHooks } from '../src/agriculture-runtime.ts';

/** Isolated runtime projection, with explicit opening funding and canonical stocks. */
function fixture() {
  const seed = 61025, resources = createResourceMap(seed), farmCell = resources.fertility.findIndex((n, i) => n === 100 && i > 10);
  assert.ok(farmCell > 10);
  const c: City = {
    version: 4, rulesVersion: 'agriculture-1', seed, rng: seed, tick: 1, nextId: 103,
    migration: { arrivals: 2, legacyHouseholds: 0 }, agricultureStartTick: 0, resources,
    cells: Array.from({ length: 576 }, () => ({ road: false, zone: null, building: null })),
    buildings: [
      { id: 1, cell: 1, zone: 'R', housingType: 'cottage', level: 1, age: 1 },
      { id: 2, cell: 2, zone: 'R', housingType: 'cottage', level: 1, age: 1 },
      { id: 3, cell: farmCell, zone: 'F', level: 1, age: 1 },
      { id: 4, cell: 4, zone: 'I', level: 1, age: 1 },
      { id: 5, cell: 5, zone: 'T', level: 1, age: 1 },
    ],
    households: [
      { id: 101, home: 1, members: 3, workforce: 2, dependents: 1, workerSkills: { general: 1, manufacturing: 1, retail: 0 }, skillSource: 'arrival-profile', profile: 'family', origin: 'arrival', wallet: 'household:101', lastPurchaseTick: -1, needs: 2 },
      { id: 102, home: 2, members: 1, workforce: 1, dependents: 0, workerSkills: { general: 1, manufacturing: 0, retail: 0 }, skillSource: 'arrival-profile', profile: 'single-worker', origin: 'arrival', wallet: 'household:102', lastPurchaseTick: -1, needs: 3 },
    ],
    firms: (['F', 'I', 'T'] as const).map((zone, i) => ({ id: 11 + i, building: 3 + i, zone, wallet: `firm:${11 + i}`, workDays: {}, inventory: 0, cropInventory: 0, cropCost: 0, productionTick: 0, owner: zone === 'T' ? { householdId: 102, capitalContributed: 60000, capitalReturned: 0, withdrawn: 0, taxPaid: 0 } : null, profit: 0, lastMonthProfit: 0, monthlyRevenue: 0, monthlyExpense: 0 })),
    employment: [
      { householdId: 101, firmId: 11, occupation: 'manufacturing', rank: 'entry', skill: 'manufacturing', workers: 1 },
      { householdId: 101, firmId: 12, occupation: 'manufacturing', rank: 'entry', skill: 'general', workers: 1 },
    ],
    ownerLabor: [{ householdId: 102, firmId: 13, skill: 'general', workers: 1 }],
    accounts: { outside: 0, treasury: 0, construction: 0, roadworks: 0, upkeep: 0, landlord: 0, 'firm:11': 0, 'firm:12': 0, 'firm:13': 0, 'household:101': 0, 'household:102': 0 },
    ledger: [], goodsLedger: [], cropLedger: [], goods: { produced: 0, imported: 0, consumed: 0, exported: 0 }, crops: { harvested: 0, processed: 0, consumed: 0, writtenOff: 0 }, utilities: { power: true, water: true }, lastEvent: '',
  };
  for (const b of c.buildings) c.cells[b.cell] = { road: false, zone: b.zone, building: b.id };
  const disconnected = new Set<number>(), salaries = { I: 60000, C: 42000, F: 42000, T: 0 };
  const hooks: AgricultureHooks = {
    connected: cell => !disconnected.has(cell),
    workers: f => c.employment.filter(e => e.firmId === f.id).reduce((n, e) => n + e.workers, 0) + c.ownerLabor.filter(e => e.firmId === f.id).length,
    spendable: f => Math.max(0, c.accounts[f.wallet] - Object.values(f.workDays).reduce((n, days) => n + days * salaries[f.zone] / 30, 0)),
    transfer: (from, to, amount, reason, book = false) => {
      assert.equal(book, false, 'Runtime capitalizes crop purchases and books seller only');
      const source = c.firms.find(f => f.wallet === from), available = from === 'outside' ? amount : source ? hooks.spendable(source) : c.accounts[from];
      const paid = Math.min(amount, available); if (paid <= 0) return 0;
      c.accounts[from] -= paid; c.accounts[to] += paid; c.ledger.push({ tick: c.tick, from, to, amount: paid, reason }); return paid;
    },
    goodsTransfer: (from, to, quantity, reason) => { c.goodsLedger.push({ tick: c.tick, from, to, quantity, reason }); },
  };
  for (const f of c.firms.filter(f => f.zone !== 'T')) { hooks.transfer('outside', f.wallet, 300000, 'Test outside equity'); hooks.transfer(f.wallet, 'construction', 40000, 'Test construction'); }
  for (const h of c.households) hooks.transfer('outside', h.wallet, 150000, 'Test household opening funding');
  hooks.transfer('household:102', 'firm:13', 60000, 'Test real owner capital'); hooks.transfer('firm:13', 'construction', 10000, 'Test market construction');
  return { c, hooks, disconnected, farm: c.firms[0], factory: c.firms[1], trader: c.firms[2], h: c.households[0], owner: c.households[1] };
}
function reconciles(c: City): void {
  assert.equal(Object.values(c.accounts).reduce((a, b) => a + b, 0), 0);
  const cash: Record<string, number> = Object.fromEntries(Object.keys(c.accounts).map(k => [k, 0]));
  for (const e of c.ledger) { cash[e.from] -= e.amount; cash[e.to] += e.amount; } assert.deepEqual(cash, c.accounts);
  assert.equal(c.crops.harvested - c.crops.processed - c.crops.consumed - c.crops.writtenOff, c.firms.reduce((n, f) => n + f.cropInventory, 0));
  const qty: Record<string, number> = {}, value: Record<string, number> = {};
  c.cropLedger.forEach((e, i) => {
    assert.equal(e.id, i + 1); qty[e.from] = (qty[e.from] ?? 0) - e.quantity; qty[e.to] = (qty[e.to] ?? 0) + e.quantity;
    value[e.from] = (value[e.from] ?? 0) - e.fromValue; value[e.to] = (value[e.to] ?? 0) + e.toValue;
    if (e.kind === 'trade' || e.kind === 'consumption') assert.equal(c.ledger.filter(m => m.reason === e.reason && m.from === e.to && m.to === e.from && m.amount === e.cash && m.tick === e.tick).length, 1);
    if (e.kind === 'process') assert.equal(c.goodsLedger.filter(g => g.reason === e.reason && g.from === 'production' && g.to === e.from && g.quantity === e.outputQuantity).length, 1);
  });
  for (const f of c.firms) { assert.equal(qty[f.wallet] ?? 0, f.cropInventory); assert.equal(value[f.wallet] ?? 0, f.cropCost); assert.ok(f.cropInventory >= 0 && f.cropCost >= 0); }
  assert.equal(c.goods.produced, c.firms.reduce((n, f) => n + f.inventory, 0));
}
const day = (c: City) => { c.tick++; for (const b of c.buildings) b.age++; };

test('farm harvest, real direct inputs, capitalized trader purchase and recipe reconcile in pipeline order', () => {
  const { c, hooks, farm, factory, trader } = fixture(), quota = runAgriculture(c, hooks);
  assert.equal(c.crops.harvested, 24); assert.equal(c.crops.processed, 2); assert.equal(c.goods.produced, 8);
  assert.deepEqual([farm.cropInventory, factory.cropInventory, trader.cropInventory], [12, 2, 8]);
  assert.deepEqual([factory.cropCost, trader.cropCost], [700, 1200]);
  assert.equal(factory.monthlyExpense, 700); assert.equal(trader.monthlyExpense, 0); assert.equal(trader.monthlyRevenue, 0);
  assert.equal(quota.get(trader.id), 0); assert.equal(factory.inventory, 8);
  assert.deepEqual(c.cropLedger.map(e => e.kind), ['harvest', 'trade', 'trade', 'process']); reconciles(c);
});

test('fresh market acquisitions wait one day and factory/households share one canonical opening quota', () => {
  const { c, hooks, trader, h, owner } = fixture(), quota1 = runAgriculture(c, hooks), first = JSON.stringify(c);
  assert.equal(consumeMarketCrop(c, h, trader, quota1, hooks), false); assert.equal(JSON.stringify(c), first);
  day(c); const quota = runAgriculture(c, hooks); assert.equal(quota.get(trader.id), 6); assert.equal(trader.cropInventory, 8);
  assert.equal(consumeMarketCrop(c, h, trader, quota, hooks), true); assert.equal(h.needs, 0); assert.equal(h.lastPurchaseTick, c.tick);
  const once = JSON.stringify(c); assert.equal(consumeMarketCrop(c, h, trader, quota, hooks), false); assert.equal(JSON.stringify(c), once);
  assert.equal(consumeMarketCrop(c, owner, trader, quota, hooks), true); assert.equal(c.crops.consumed, 2); assert.equal(quota.get(trader.id), 4);
  assert.equal(trader.cropInventory, 6); assert.equal(trader.cropCost, 900); assert.equal(trader.monthlyRevenue, 2200); assert.equal(trader.monthlyExpense, 600);
  const beforeRepeat = JSON.stringify(c), repeated = runAgriculture(c, hooks); assert.equal(JSON.stringify(c), beforeRepeat); assert.equal(repeated.get(trader.id), 4); reconciles(c);
});

test('factory gets cheaper opening trader stock before direct farm channel and releases weighted integer cost', () => {
  const { c, hooks, farm, factory, trader, disconnected, h } = fixture(); runAgriculture(c, hooks);
  // Dispose seven existing lots through the canonical writeoff operation by
  // temporarily splitting a projection; no cash or extra crop is introduced.
  const originalQty = trader.cropInventory, originalCost = trader.cropCost;
  trader.cropInventory = 7; trader.cropCost = 1050; assert.equal(writeOffCrops(c, trader, hooks), true);
  trader.cropInventory = originalQty - 7; trader.cropCost = originalCost - 1050;
  day(c); disconnected.add(c.buildings.find(b => b.id === farm.building)!.cell);
  const quota = runAgriculture(c, hooks), today = c.cropLedger.filter(e => e.tick === c.tick);
  assert.equal(today.find(e => e.kind === 'trade')?.from, trader.wallet); assert.equal(quota.get(trader.id), 0);
  assert.equal(factory.cropInventory, 1); assert.equal(factory.cropCost, 334);
  assert.equal(today.find(e => e.kind === 'process')?.fromValue, 666);
  assert.equal(consumeMarketCrop(c, h, trader, quota, hooks), false); reconciles(c);
});

test('household-only demand can replenish and operate a self-employed market without active factories', () => {
  const { c, hooks, factory, trader, h } = fixture(); c.employment = c.employment.filter(e => e.firmId !== factory.id);
  const quota1 = runAgriculture(c, hooks); assert.equal(trader.cropInventory, 4); assert.equal(quota1.get(trader.id), 0); assert.equal(c.goods.produced, 0);
  day(c); const quota2 = runAgriculture(c, hooks); assert.equal(consumeMarketCrop(c, h, trader, quota2, hooks), true); reconciles(c);
});

test('no actual buyers means no market replenishment or made-up sales', () => {
  const { c, hooks, factory, trader } = fixture(); c.employment = c.employment.filter(e => e.firmId !== factory.id);
  for (const h of c.households) hooks.transfer(h.wallet, 'outside', c.accounts[h.wallet], 'Test remove purchasing power');
  const cash = c.accounts[trader.wallet]; runAgriculture(c, hooks);
  assert.equal(trader.cropInventory, 0); assert.equal(c.accounts[trader.wallet], cash); assert.equal(trader.monthlyRevenue, 0); assert.equal(trader.monthlyExpense, 0);
  assert.equal(agricultureDiagnostic(c, trader, hooks).reasonId, 'agriculture.no-buyer'); reconciles(c);
});

test('wage reserve cash cannot buy crop inputs and a factory with no inputs creates no goods', () => {
  const { c, hooks, factory, h } = fixture(); factory.workDays[h.wallet] = 1;
  hooks.transfer(factory.wallet, 'outside', c.accounts[factory.wallet] - 2100, 'Test cash reduction');
  assert.equal(c.accounts[factory.wallet], 2100); assert.equal(hooks.spendable(factory), 100);
  runAgriculture(c, hooks); assert.equal(c.accounts[factory.wallet], 2100); assert.equal(factory.cropInventory, 0); assert.equal(factory.inventory, 0); assert.equal(c.goods.produced, 0);
  assert.equal(factory.workDays[h.wallet], 1); assert.equal(agricultureDiagnostic(c, factory, hooks).reasonId, 'agriculture.no-input'); reconciles(c);
});

test('road/utility stoppage conserves holdings and resumes actual harvest/production after recovery', () => {
  const { c, hooks, farm, disconnected } = fixture(); const cell = c.buildings.find(b => b.id === farm.building)!.cell;
  disconnected.add(cell); runAgriculture(c, hooks); assert.equal(c.crops.harvested, 0); assert.equal(c.goods.produced, 0);
  assert.equal(agricultureDiagnostic(c, farm, hooks).reasonId, 'agriculture.no-road');
  disconnected.delete(cell); day(c); c.utilities.power = false; runAgriculture(c, hooks); assert.equal(c.crops.harvested, 0);
  c.utilities.power = true; day(c); runAgriculture(c, hooks); assert.equal(c.crops.harvested, 24); assert.equal(c.goods.produced, 8); reconciles(c);
});

test('inactive owner labour cannot operate market or be replaced by fabricated salaried workers', () => {
  const { c, hooks, trader, h } = fixture(); runAgriculture(c, hooks); day(c); c.ownerLabor = [];
  const cash = c.accounts[trader.wallet], stock = trader.cropInventory, quota = runAgriculture(c, hooks);
  assert.equal(consumeMarketCrop(c, h, trader, quota, hooks), false); assert.equal(c.accounts[trader.wallet], cash); assert.equal(trader.cropInventory, stock);
  assert.deepEqual(trader.workDays, {}); assert.equal(agricultureDiagnostic(c, trader, hooks).reasonId, 'agriculture.no-workers'); reconciles(c);
});

test('partial/throwing cash hooks roll back money, stock, book values, basket and quota together', () => {
  for (const mode of ['partial', 'throw'] as const) {
    const { c, hooks, trader, h } = fixture(); runAgriculture(c, hooks); day(c); const quota = new Map([[trader.id, trader.cropInventory]]), before = JSON.stringify(c);
    const bad = { ...hooks, transfer: (from: string, to: string, amount: number, reason: string) => { const paid = hooks.transfer(from, to, amount - 1, reason); if (mode === 'throw') throw Error('test interrupted'); return paid; } };
    assert.equal(consumeMarketCrop(c, h, trader, quota, bad), false); assert.equal(JSON.stringify(c), before); assert.equal(quota.get(trader.id), 8); reconciles(c);
  }
});

test('a failed output journal append leaves input asset intact and can retry without duplicate harvest', () => {
  const { c, hooks, factory } = fixture(), bad = { ...hooks, goodsTransfer: (...args: Parameters<AgricultureHooks['goodsTransfer']>) => { hooks.goodsTransfer(...args); throw Error('test journal interrupted'); } };
  runAgriculture(c, bad); assert.equal(c.crops.harvested, 24); assert.equal(factory.cropInventory, 4); assert.equal(factory.cropCost, 1400);
  assert.equal(factory.inventory, 0); assert.equal(c.goods.produced, 0); assert.equal(c.crops.processed, 0); assert.equal(c.goodsLedger.length, 0);
  runAgriculture(c, hooks); assert.equal(c.crops.harvested, 24); assert.equal(factory.inventory, 8); assert.equal(c.crops.processed, 2); reconciles(c);
});

test('overflow proposals and invalid crop books fail before any transfer or basket mutation', () => {
  const { c, hooks, trader, h } = fixture(); runAgriculture(c, hooks); day(c); const quota = new Map([[trader.id, trader.cropInventory]]);
  for (const failure of ['counter', 'revenue', 'book'] as const) {
    const oldConsumed = c.crops.consumed, oldRevenue = trader.monthlyRevenue, oldCost = trader.cropCost;
    if (failure === 'counter') c.crops.consumed = Number.MAX_SAFE_INTEGER;
    if (failure === 'revenue') trader.monthlyRevenue = Number.MAX_SAFE_INTEGER;
    if (failure === 'book') trader.cropCost = -1;
    const before = JSON.stringify(c); assert.equal(consumeMarketCrop(c, h, trader, quota, hooks), false); assert.equal(JSON.stringify(c), before); assert.equal(quota.get(trader.id), 8);
    c.crops.consumed = oldConsumed; trader.monthlyRevenue = oldRevenue; trader.cropCost = oldCost;
  }
  reconciles(c);
});

test('demolition writeoff releases exact crop value as expense without a cash receipt and is idempotent', () => {
  const { c, hooks, trader, disconnected } = fixture(); runAgriculture(c, hooks); disconnected.add(c.buildings.find(b => b.id === trader.building)!.cell);
  const money = JSON.stringify([c.accounts, c.ledger]); assert.equal(writeOffCrops(c, trader, hooks), true);
  assert.equal(trader.cropInventory, 0); assert.equal(trader.cropCost, 0); assert.equal(trader.monthlyExpense, 1200); assert.equal(c.crops.writtenOff, 8);
  assert.equal(JSON.stringify([c.accounts, c.ledger]), money); const once = JSON.stringify(c); assert.equal(writeOffCrops(c, trader, hooks), true); assert.equal(JSON.stringify(c), once); reconciles(c);
});

test('input permutations keep ID/price-ordered crop operations and books deterministic', () => {
  const first = fixture(), second = fixture(); second.c.firms.reverse(); second.c.buildings.reverse(); second.c.households.reverse(); second.c.employment.reverse();
  runAgriculture(first.c, first.hooks); runAgriculture(second.c, second.hooks);
  assert.deepEqual(first.c.cropLedger, second.c.cropLedger); assert.deepEqual(first.c.ledger, second.c.ledger); assert.deepEqual(first.c.goodsLedger, second.c.goodsLedger);
  const books = (c: City) => [...c.firms].sort((a, b) => a.id - b.id).map(f => ({ ...f })); assert.deepEqual(books(first.c), books(second.c)); reconciles(first.c); reconciles(second.c);
});
