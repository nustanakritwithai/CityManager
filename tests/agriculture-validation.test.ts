import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCity, step, deserialize, serialize, ownerFinance, contributeOwnerCapital, withdrawOwnerProfit, type City } from '../src/sim.ts';
import { validateAgriculture } from '../src/agriculture-validation.ts';

const natural = createCity(61025);
for (let day = 0; day < 360; day++) { step(natural); validateAgriculture(natural); }
const snapshot = serialize(natural);
const fresh = (): City => JSON.parse(snapshot);
const market = (c: City) => c.firms.find(f => f.zone === 'T')!;
function rejects(mutate: (c: City) => void): void {
  const city = fresh(); mutate(city); const before = JSON.stringify(city);
  assert.throws(() => validateAgriculture(city)); assert.equal(JSON.stringify(city), before);
}
function freeze(value: unknown): void {
  if (value && typeof value === 'object') { Object.freeze(value); for (const child of Object.values(value)) freeze(child); }
}

test('actual 360-day agriculture replay reconciles all channels, stock, costs, ownership and household baskets without mutation', () => {
  assert.ok(natural.firms.some(f => f.zone === 'F') && natural.firms.some(f => f.zone === 'T'));
  for (const kind of ['harvest', 'trade', 'process', 'consumption']) assert.ok(natural.cropLedger.some(e => e.kind === kind));
  assert.ok(natural.crops.harvested > 0 && natural.crops.processed > 0 && natural.crops.consumed > 0);
  const city = fresh(); freeze(city); assert.doesNotThrow(() => validateAgriculture(city)); assert.equal(JSON.stringify(city), snapshot);
});

test('strict frozen v3 migration starts empty agriculture while preserving historical input-free goods and all old state', () => {
  const raw = readFileSync(new URL('./fixtures/legacy-v3-day180.json', import.meta.url), 'utf8'), original = JSON.parse(raw), city = deserialize(raw);
  assert.equal(city.agricultureStartTick, original.tick); assert.deepEqual(city.cropLedger, []); assert.deepEqual(city.ownerLabor, []);
  assert.deepEqual(city.crops, { harvested: 0, processed: 0, consumed: 0, writtenOff: 0 });
  for (const key of ['accounts', 'ledger', 'goods', 'goodsLedger', 'rng', 'tick', 'nextId'] as const) assert.deepEqual(city[key], original[key]);
  assert.doesNotThrow(() => validateAgriculture(city));
  const before = serialize(city); assert.equal(serialize(deserialize(before)), before);
  city.tick++;
  city.goodsLedger.push({ tick: city.tick, from: 'production', to: city.firms.find(f => f.zone === 'I')!.wallet, quantity: 8, reason: 'Daily worker production' });
  assert.throws(() => validateAgriculture(city), 'Post-transition production cannot inherit the old input-free exemption');
});

test('canonical resources, transition boundary, stock/value bounds and attempted production clocks reject tampering', () => {
  for (const mutate of [
    (c: City) => { c.resources.fertility[0] = (c.resources.fertility[0] + 1) % 101; },
    (c: City) => { c.resources.seed++; },
    (c: City) => { c.agricultureStartTick = c.tick + 1; },
    (c: City) => { c.crops.harvested++; },
    (c: City) => { market(c).cropInventory = 49; },
    (c: City) => { market(c).cropCost++; },
    (c: City) => { market(c).productionTick = c.tick + 1; },
    (c: City) => { c.firms.find(f => f.zone === 'C')!.cropInventory = 1; },
    (c: City) => { c.firms.find(f => f.zone === 'F')!.inventory = 1; },
    (c: City) => { c.firms.find(f => f.zone === 'F')!.cropCost = 1; },
  ]) rejects(mutate);
});

test('owner labour reserves actual eligible household capacity and does not require current road access for persisted rows', () => {
  const cut = fresh(); for (const cell of cut.cells) if (cell.road) cell.road = false;
  assert.doesNotThrow(() => validateAgriculture(cut), 'A cut road is reevaluated next tick; load must not fabricate historical routing');
  for (const mutate of [
    (c: City) => { c.ownerLabor.push({ ...c.ownerLabor[0] }); },
    (c: City) => { (c.ownerLabor[0] as any).skill = 'manufacturing'; },
    (c: City) => { c.ownerLabor[0].householdId = c.households.find(h => h.id !== c.ownerLabor[0].householdId)!.id; },
    (c: City) => { c.households.find(h => h.id === c.ownerLabor[0].householdId)!.home = null; },
    (c: City) => { const owner = c.ownerLabor[0]; c.employment.push({ householdId: owner.householdId, firmId: market(c).id, skill: owner.skill, workers: 1, rank: 'entry', occupation: 'retail' }); },
    (c: City) => { market(c).workDays[c.households[0].wallet] = 1; },
    (c: City) => { const own = c.ownerLabor[0], h = c.households.find(h => h.id === own.householdId)!; c.employment.push({ householdId: h.id, firmId: c.firms.find(f => f.zone === 'C')!.id, skill: own.skill, workers: h.workerSkills[own.skill], rank: 'entry', occupation: 'retail' }); },
  ]) rejects(mutate);
});

test('owner capital, drawn earnings and paid tax reconcile real counterparties and stay outside operating revenue', () => {
  for (const mutate of [
    (c: City) => { market(c).owner!.capitalContributed++; },
    (c: City) => { market(c).owner!.capitalReturned = 1; },
    (c: City) => { market(c).owner!.withdrawn++; },
    (c: City) => { market(c).owner!.taxPaid++; },
    (c: City) => { market(c).monthlyRevenue += 60_000; },
    (c: City) => { const t = market(c); c.ledger.find(e => e.reason === 'Owner capital contribution' && e.to === t.wallet)!.from = 'outside'; },
    (c: City) => { const t = market(c); c.ledger.push({ tick: c.tick, from: 'outside', to: t.wallet, amount: 1, reason: 'Outside firm equity investment' }); },
    (c: City) => { c.firms.find(f => f.zone === 'I')!.owner = { ...market(c).owner! }; },
  ]) rejects(mutate);
});

test('real owner contributions and profit draws remain valid through subsequent monthly settlement; initial capital is not drawable profit', () => {
  const city = fresh(), trader = market(city), beforeProfit = trader.profit;
  assert.equal(contributeOwnerCapital(city, trader.id, 10_000).ok, true); validateAgriculture(city); assert.equal(trader.profit, beforeProfit);
  assert.ok(ownerFinance(city, trader.id)!.withdrawAvailable >= 10_000);
  assert.equal(withdrawOwnerProfit(city, trader.id, 10_000).ok, true); validateAgriculture(city);
  for (let day = 0; day < 35; day++) { step(city); validateAgriculture(city); }
  const startup = createCity(61025); while (!startup.firms.some(f => f.zone === 'T') && startup.tick < 360) step(startup);
  const stall = market(startup), h = startup.households.find(h => h.id === stall.owner!.householdId)!;
  assert.equal(ownerFinance(startup, stall.id)!.distributable, 0); assert.equal(withdrawOwnerProfit(startup, stall.id, 10_000).ok, false);
  startup.accounts[stall.wallet] -= 10_000; startup.accounts[h.wallet] += 10_000; stall.owner!.withdrawn += 10_000;
  startup.ledger.push({ tick: startup.tick, from: stall.wallet, to: h.wallet, amount: 10_000, reason: 'Owner profit distribution' });
  assert.throws(() => validateAgriculture(startup));
});

test('crop journal IDs, chronology, weighted book costs, exact money links and recipe outputs reject tampering', () => {
  for (const mutate of [
    (c: City) => { c.cropLedger[0].id++; },
    (c: City) => { c.cropLedger[0].tick = c.agricultureStartTick; },
    (c: City) => { c.cropLedger.find(e => e.kind === 'trade')!.fromValue++; },
    (c: City) => { c.cropLedger.find(e => e.kind === 'trade')!.toValue++; },
    (c: City) => { c.cropLedger.find(e => e.kind === 'trade')!.cash++; },
    (c: City) => { const e = c.cropLedger.find(e => e.kind === 'trade')!; c.ledger.find(p => p.reason === e.reason)!.amount++; },
    (c: City) => { const e = c.cropLedger.find(e => e.kind === 'consumption')!; c.ledger.push({ ...c.ledger.find(p => p.reason === e.reason)! }); },
    (c: City) => { c.cropLedger.find(e => e.kind === 'process')!.outputQuantity++; },
    (c: City) => { const e = c.cropLedger.find(e => e.kind === 'process')!; c.goodsLedger.find(g => g.reason === e.reason)!.quantity++; },
    (c: City) => { c.goodsLedger.push({ tick: c.tick, from: 'production', to: c.firms.find(f => f.zone === 'I')!.wallet, quantity: 8, reason: 'Unfunded input-free goods' }); },
  ]) rejects(mutate);
});

test('one household basket cannot be duplicated across crops and finished goods on the same day', () => {
  rejects(c => { const e = c.cropLedger.find(e => e.kind === 'consumption')!; c.goodsLedger.push({ tick: e.tick, from: c.firms.find(f => f.zone === 'C')!.wallet, to: e.to, quantity: 1, reason: 'Household final consumption' }); });
  rejects(c => { const h = c.households.find(h => h.lastPurchaseTick > c.agricultureStartTick)!; h.lastPurchaseTick--; });
});

test('a trader cannot resell an acquisition from the same day even with matching cash and crop entries', () => {
  const c = createCity(61025); c.tick = 1;
  for (const id of [100, 101, 102]) c.accounts[`firm:${id}`] = 0;
  c.cropLedger = [
    { id: 1, tick: 1, kind: 'harvest', from: 'environment:crops', to: 'firm:100', quantity: 12, fromValue: 0, toValue: 0, cash: 0, workers: 1, batches: 0, outputQuantity: 0, reason: 'Farm harvest #1' },
    { id: 2, tick: 1, kind: 'trade', from: 'firm:100', to: 'firm:101', quantity: 1, fromValue: 0, toValue: 150, cash: 150, workers: 0, batches: 0, outputQuantity: 0, reason: 'Crop exchange #2' },
    { id: 3, tick: 1, kind: 'trade', from: 'firm:101', to: 'firm:102', quantity: 1, fromValue: 150, toValue: 300, cash: 300, workers: 0, batches: 0, outputQuantity: 0, reason: 'Crop exchange #3' },
  ];
  c.ledger.push({ tick: 1, from: 'firm:101', to: 'firm:100', amount: 150, reason: 'Crop exchange #2' }, { tick: 1, from: 'firm:102', to: 'firm:101', amount: 300, reason: 'Crop exchange #3' });
  assert.throws(() => validateAgriculture(c));
});
