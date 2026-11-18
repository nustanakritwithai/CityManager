import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCity, step, MONTH, type City } from '../src/sim.ts';
import { populationFixture } from './population-capacity-fixture.ts';
import { ARRIVAL_REASON, DEPARTURE_REASON, INCOME_KINDS, SAVINGS_BANDS, SPENDING_KINDS, householdEconomy, incomeKind, savingsBand, spendingKind } from '../src/household-economy.ts';
import { BURGLARY_REASON, MEDICAL_REASON } from '../src/incidents.ts';
import { civicFeeReason, civicDailyWageReason } from '../src/civic/sites.ts';

const grown = (days = 120) => { const c = createCity(61025); for (let i = 0; i < days; i++) step(c); return c; };
const big = () => { const c = populationFixture(60, true); for (let i = 0; i < 31; i++) step(c); return c; };
const sum = (r: Record<string, number>) => Object.values(r).reduce((n, v) => n + v, 0);

test('ledger reasons fall into the expected kinds', () => {
  assert.equal(incomeKind('Monthly wages'), 'wages');
  assert.equal(incomeKind(civicDailyWageReason('cinema', 3)), 'wages');
  assert.equal(incomeKind('Monthly park wages #2'), 'wages');
  assert.equal(incomeKind('Owner profit distribution'), 'business');
  assert.equal(incomeKind(civicFeeReason('restaurant', 4)), 'business', 'an operator takes the visitor fee');
  assert.equal(spendingKind(civicDailyWageReason('cinema', 3)), 'business', 'an operator pays its staff');
  assert.equal(spendingKind('Monthly cinema rent #3'), 'business');
  assert.equal(spendingKind('Household #27 purchase'), 'shopping');
  assert.equal(spendingKind('Monthly household rent'), 'rent');
  assert.equal(spendingKind('Monthly household wage tax'), 'tax');
  assert.equal(spendingKind('Monthly household water and power bill'), 'utilities');
  assert.equal(spendingKind(civicFeeReason('cinema', 9)), 'leisure');
  assert.equal(spendingKind(MEDICAL_REASON), 'incidents'); assert.equal(spendingKind(BURGLARY_REASON), 'incidents');
});

test('every household payment in a grown city is classified, and the totals match the ledger', () => {
  for (const c of [grown(), big()]) {
    const r = householdEconomy(c), from = c.tick - MONTH + 1;
    assert.equal(r.fromTick, from); assert.equal(r.households, c.households.length);
    const all = c.ledger.filter(e => e.tick >= from && e.tick <= c.tick && e.from !== e.to);
    const moves = (reason: string) => all.filter(e => e.reason === reason).reduce((n, e) => n + e.amount, 0);
    assert.equal(r.arrived, moves(ARRIVAL_REASON)); assert.equal(r.departed, moves(DEPARTURE_REASON));
    const window = all.filter(e => e.reason !== ARRIVAL_REASON && e.reason !== DEPARTURE_REASON);
    assert.equal(sum(r.income), window.filter(e => e.to.startsWith('household:')).reduce((n, e) => n + e.amount, 0));
    assert.equal(sum(r.spending), window.filter(e => e.from.startsWith('household:')).reduce((n, e) => n + e.amount, 0));
    assert.equal(r.income.other, 0, 'no household income is left unexplained');
    assert.equal(r.spending.other, 0, 'no household spending is left unexplained');
    assert.ok(r.income.wages > 0 && r.spending.rent > 0);
    assert.deepEqual(Object.keys(r.income), [...INCOME_KINDS]); assert.deepEqual(Object.keys(r.spending), [...SPENDING_KINDS]);
  }
});

test('savings bands, median and at-risk households follow the wallets', () => {
  assert.equal(savingsBand(0), 0); assert.equal(savingsBand(SAVINGS_BANDS[0] - 1), 0); assert.equal(savingsBand(SAVINGS_BANDS[0]), 1);
  assert.equal(savingsBand(SAVINGS_BANDS.at(-1)!), SAVINGS_BANDS.length);
  const c = big(), r = householdEconomy(c);
  assert.equal(r.savings.reduce((a, b) => a + b, 0), c.households.length);
  const wallets = c.households.map(h => c.accounts[h.wallet] ?? 0).sort((a, b) => a - b);
  assert.ok(r.medianSavings >= wallets[0] && r.medianSavings <= wallets.at(-1)!);
  // Empty one household's wallet into the outside: it now cannot pay last month's bills again.
  const poor = c.households.find(h => r.atRisk.every(x => x.id !== h.id))!;
  const before = r.atRisk.length, moved = c.accounts[poor.wallet];
  c.accounts[poor.wallet] = 0; c.accounts.outside += moved;
  const after = householdEconomy(c);
  assert.equal(after.atRisk.length, before + 1);
  assert.equal(after.atRisk[0].id, poor.id); assert.equal(after.atRisk[0].savings, 0);
  assert.ok(after.atRisk.every((x, i, a) => x.savings < x.bills && (!i || a[i - 1].savings <= x.savings)));
});

test('an empty city reports nothing', () => {
  const r = householdEconomy({ tick: 3, ledger: [], households: [], accounts: {} } as unknown as City);
  assert.equal(sum(r.income) + sum(r.spending), 0); assert.equal(r.medianSavings, 0); assert.deepEqual(r.atRisk, []); assert.equal(r.spendingMore, 0); assert.equal(r.arrived + r.departed, 0);
});
