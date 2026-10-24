import test from 'node:test';
import assert from 'node:assert/strict';
import { createCity, step, serialize, type City } from '../src/sim.ts';
import { buildingCardData, householdCardData, cardWindow } from '../src/building-card-data.ts';

const actual = createCity(61025);
for (let day = 0; day < 180; day++) step(actual);
const snapshot = serialize(actual), city = (): City => JSON.parse(snapshot);
function freeze(value: unknown): void {
  if (value && typeof value === 'object') { Object.freeze(value); for (const child of Object.values(value)) freeze(child); }
}
const walletsFor = (c: City, id: number) => c.households.filter(h => h.home === id).map(h => h.wallet);

test('all six card kinds use actual selected identities, stocks and linked household records', () => {
  const c = city(), kinds = new Set<string>();
  for (const b of c.buildings) {
    const card = buildingCardData(c, b.id)!; kinds.add(card.kind); assert.equal(card.identity.buildingId, b.id); assert.equal(card.identity.cell, b.cell);
    if (card.kind === 'house') {
      assert.deepEqual(card.households.map(h => h.identity.householdId), c.households.filter(h => h.home === b.id).map(h => h.id));
      assert.deepEqual(card.cash.wallets, walletsFor(c, b.id)); assert.equal(card.scope, 'current-linked-household-wallets');
    } else {
      const f = c.firms.find(f => f.building === b.id)!; assert.equal(card.identity.firmId, f.id);
      assert.deepEqual(card.stocks, { goods: f.inventory, crops: f.cropInventory, cropCostSatang: f.cropCost }); assert.deepEqual(card.cash.wallets, [f.wallet]);
    }
  }
  const h = householdCardData(c, c.households[0].id)!; kinds.add(h.kind); assert.equal(h.identity.householdId, c.households[0].id);
  assert.deepEqual([...kinds].sort(), ['factory', 'farm', 'house', 'household', 'market', 'shop']);
  assert.deepEqual(h.stocks, { goods: null, crops: null, cropCostSatang: null }, 'Household held inventory is not modeled');
});

test('house A/B and firm A/B stay isolated instead of leaking another selection or citywide balances', () => {
  const c = city(), houses = c.buildings.filter(b => b.zone === 'R'), firms = c.firms.filter(f => f.zone === 'C');
  assert.ok(houses.length > 1 && firms.length > 1);
  const a = buildingCardData(c, houses[0].id)!, b = buildingCardData(c, houses[1].id)!;
  assert.deepEqual(a.cash.wallets, walletsFor(c, houses[0].id)); assert.deepEqual(b.cash.wallets, walletsFor(c, houses[1].id));
  assert.ok(a.cash.wallets.every(wallet => !b.cash.wallets.includes(wallet)));
  for (const f of firms.slice(0, 2)) {
    const card = buildingCardData(c, f.building)!; assert.equal(card.cash.current, c.accounts[f.wallet]); assert.deepEqual(card.cash.wallets, [f.wallet]);
    const first = card.cash.current; c.accounts[c.firms.find(other => other.id !== f.id)!.wallet] += 1;
    assert.equal(buildingCardData(c, f.building)!.cash.current, first);
  }
  assert.notEqual(a.cash.current, c.accounts.treasury);
});

test('trailing windows include day30 and day31 boundaries without a reversed or fabricated tick0 period', () => {
  assert.deepEqual(cardWindow(0), { fromTick: 0, toTick: 0, inclusive: true, maxDays: 30, empty: true });
  assert.equal(cardWindow(30)!.fromTick, 1); assert.equal(cardWindow(30)!.toTick, 30);
  assert.equal(cardWindow(31)!.fromTick, 2); assert.equal(cardWindow(31)!.toTick, 31);
  for (const invalid of [-1, .5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.equal(cardWindow(invalid), null);
  const c = city(), h = c.households[0], before = householdCardData(c, h.id)!;
  assert.deepEqual(before.window, { fromTick: 151, toTick: 180, inclusive: true, maxDays: 30, empty: false });
  const income = c.ledger.filter(e => e.to === h.wallet && e.tick >= 151 && e.tick <= 180).reduce((sum, e) => sum + e.amount, 0);
  const expense = c.ledger.filter(e => e.from === h.wallet && e.tick >= 151 && e.tick <= 180).reduce((sum, e) => sum + e.amount, 0);
  assert.equal(before.cash.inflow, income); assert.equal(before.cash.outflow, expense); assert.equal(before.cash.net, income - expense);
  assert.equal(before.cash.current, c.accounts[h.wallet]); assert.notEqual(before.cash.current, before.cash.net, 'Current balance is not period flow');
});

test('house combined wallet boundary excludes internal family transfers while each household keeps its own flows', () => {
  const c = city(), b = c.buildings.find(b => c.households.filter(h => h.home === b.id).length >= 2)!, members = c.households.filter(h => h.home === b.id);
  const before = buildingCardData(c, b.id)!, first = householdCardData(c, members[0].id)!, second = householdCardData(c, members[1].id)!;
  c.ledger.push({ tick: c.tick, from: members[0].wallet, to: members[1].wallet, amount: 100, reason: 'Explicit test wallet transfer' });
  c.accounts[members[0].wallet] -= 100; c.accounts[members[1].wallet] += 100;
  const after = buildingCardData(c, b.id)!;
  assert.deepEqual(after.cash, before.cash); assert.equal(householdCardData(c, members[0].id)!.cash.outflow, first.cash.outflow! + 100);
  assert.equal(householdCardData(c, members[1].id)!.cash.inflow, second.cash.inflow! + 100);
});

test('owner capital is real cash flow rather than operating profit or property value', () => {
  const c = createCity(61025);
  while (!c.firms.some(f => f.zone === 'T') && c.tick < 180) step(c);
  const f = c.firms.find(f => f.zone === 'T')!, card = buildingCardData(c, f.building)!;
  assert.equal(card.kind, 'market'); assert.equal(card.cash.basis, 'wallet-boundary');
  assert.equal(card.cash.inflow, 60000); assert.equal(card.cash.outflow, 10000); assert.equal(card.cash.current, 50000);
  assert.equal(f.profit, 0); assert.equal(f.monthlyRevenue, 0); assert.equal(f.monthlyExpense, 0);
});

test('today output comes from actual physical journals, while stock and workforce remain current canonical counts', () => {
  const c = city();
  for (const f of c.firms) {
    const card = buildingCardData(c, f.building)!;
    assert.equal(card.today.cropHarvested, c.cropLedger.filter(e => e.tick === c.tick && e.kind === 'harvest' && e.to === f.wallet).reduce((sum, e) => sum + e.quantity, 0));
    assert.equal(card.today.cropProcessed, c.cropLedger.filter(e => e.tick === c.tick && e.kind === 'process' && e.from === f.wallet).reduce((sum, e) => sum + e.quantity, 0));
    assert.equal(card.today.goodsProduced, c.goodsLedger.filter(e => e.tick === c.tick && e.from === 'production' && e.to === f.wallet).reduce((sum, e) => sum + e.quantity, 0));
    const employees = c.employment.filter(e => e.firmId === f.id).reduce((sum, e) => sum + e.workers, 0), owners = c.ownerLabor.filter(e => e.firmId === f.id).length;
    assert.equal(card.workforce.employeeWorkers, employees); assert.equal(card.workforce.ownerWorkers, owners); assert.equal(card.workforce.employed, employees + owners);
  }
  const owner = c.households.find(h => c.ownerLabor.some(e => e.householdId === h.id))!, detail = householdCardData(c, owner.id)!;
  assert.equal(detail.workforce.members, owner.members); assert.equal(detail.workforce.dependents, owner.dependents);
  assert.equal(detail.workforce.employed, c.employment.filter(e => e.householdId === owner.id).reduce((sum, e) => sum + e.workers, 0) + 1);
});

test('prices require actual unambiguous paired cash and goods/crop journals, not constants or guessed history', () => {
  const c = city(), shop = c.firms.find(f => f.zone === 'C')!, farm = c.firms.find(f => f.zone === 'F')!, trader = c.firms.find(f => f.zone === 'T')!;
  assert.equal(buildingCardData(c, shop.building)!.prices.goodsSell.unitSatang, 800);
  assert.equal(buildingCardData(c, farm.building)!.prices.cropsSell.unitSatang, 150);
  assert.equal(buildingCardData(c, trader.building)!.prices.cropsBuy.unitSatang, 150);
  const sale = c.ledger.find(e => e.tick >= 151 && e.to === shop.wallet && /^Household #/.test(e.reason))!;
  c.ledger.push({ ...sale });
  const ambiguous = buildingCardData(c, shop.building)!.prices.goodsSell;
  assert.equal(ambiguous.status, 'ambiguous'); assert.equal(ambiguous.unitSatang, null); assert.equal(ambiguous.cashSatang, null);
  const missing = city(); missing.ledger = missing.ledger.filter(e => !(e.to === shop.wallet && /^Household #/.test(e.reason)));
  assert.equal(buildingCardData(missing, shop.building)!.prices.goodsSell.unitSatang, null);
});

test('missing identities/data and unsafe aggregate amounts remain missing instead of invented zeros or prices', () => {
  const c = city(), h = c.households[0], f = c.firms[0];
  assert.equal(buildingCardData(c, 999999), null); assert.equal(householdCardData(c, 999999), null);
  assert.equal(buildingCardData(c, NaN), null); assert.equal(householdCardData(c, .5), null);
  delete c.accounts[h.wallet]; assert.equal(householdCardData(c, h.id)!.cash.current, null);
  c.firms = c.firms.filter(other => other.id !== f.id);
  const absent = buildingCardData(c, f.building)!; assert.equal(absent.identity.firmId, null); assert.equal(absent.cash.current, null); assert.ok(absent.missing.includes('firm'));
  const overflow = city(), b = overflow.buildings.find(b => overflow.households.filter(h => h.home === b.id).length >= 2)!;
  for (const member of overflow.households.filter(h => h.home === b.id)) overflow.accounts[member.wallet] = Number.MAX_SAFE_INTEGER;
  assert.equal(buildingCardData(overflow, b.id)!.cash.current, null);
});

test('deeply frozen real city snapshots are read without mutation or aliasing returned child data', () => {
  const c = city(), before = JSON.stringify(c); freeze(c);
  for (const b of c.buildings) assert.doesNotThrow(() => buildingCardData(c, b.id));
  for (const h of c.households) assert.doesNotThrow(() => householdCardData(c, h.id));
  const detail = householdCardData(c, c.households[0].id)!; detail.cash.wallets.push('test:detached'); detail.identity.householdId = -1;
  assert.equal(JSON.stringify(c), before); assert.equal(serialize(c), snapshot);
});
