import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCity, step, ownerFinance, withdrawOwnerProfit, contributeOwnerCapital, serialize, deserialize, firmWage, type City, type Firm } from '../src/sim.ts';

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
const wages = (f: Firm) => sum(Object.values(f.workDays)) * firmWage(f) / 30;
const seeded = (day: number) => { const c = createCity(42); for (let i = 0; i < day; i++) step(c); return c; };
function conserved(c: City) {
  const replay: Record<string, number> = {...c.history?.accounts};
  for (const e of c.ledger) { replay[e.from] = (replay[e.from] ?? 0) - e.amount; replay[e.to] = (replay[e.to] ?? 0) + e.amount; }
  for (const wallet of new Set([...Object.keys(replay), ...Object.keys(c.accounts)])) assert.equal(c.accounts[wallet] ?? 0, replay[wallet] ?? 0);
  assert.equal(sum(Object.values(c.accounts)), 0);
  for (const f of c.firms) assert.ok(c.accounts[f.wallet] >= wages(f));
}

// Small accounting fixtures use the same recorded operating/investment reasons as
// the runtime. They isolate finance math; full-world replay is covered separately.
function fixture() {
  const c = seeded(62), f = c.firms.find(f => f.id === 16)!;
  c.tick = 35; delete c.history; c.ledger = []; c.cropLedger = [];
  f.profit = 0; f.lastMonthProfit = 0; f.monthlyRevenue = 0; f.monthlyExpense = 0; f.workDays = {};
  Object.assign(f.owner!, { withdrawn: 0, taxPaid: 0, capitalContributed: 60_000, capitalReturned: 0 });
  c.accounts[f.wallet] = 60_000;
  return { c, f, h: c.households.find(h => h.id === f.owner!.householdId)! };
}
function entry(c: City, f: Firm, tick: number, amount: number, reason: string, incoming = false) {
  const counterparty = reason === 'Owner profit distribution' ? `household:${f.owner!.householdId}`
    : reason === 'Monthly firm profit tax' ? 'treasury' : /investment|conversion/.test(reason) ? 'construction' : 'outside';
  c.ledger.push({ tick, from: incoming ? counterparty : f.wallet, to: incoming ? f.wallet : counterparty, amount, reason });
}

test('seed 42 day 62 firm 16 accrues the 1400 unpaid wages in profit and tax exactly once', () => {
  const c = seeded(62), f = c.firms.find(f => f.id === 16)!;
  assert.equal(f.monthlyRevenue, 15_200); assert.equal(f.monthlyExpense, 8_400); assert.equal(wages(f), 1_400);
  const facts = ownerFinance(c, f.id)!;
  assert.equal(facts.realizedProfit, f.profit + 5_400);
  assert.equal(facts.taxReserve, 1_080);
  assert.ok(facts.withdrawAvailable <= 15_100);
  const before = serialize(c);
  assert.equal(withdrawOwnerProfit(c, f.id, 16_220).ok, false);
  assert.equal(serialize(c), before);
});

test('seed 42 day 210 firm 12 cannot manually withdraw the automatic development retention', () => {
  const c = seeded(210), f = c.firms.find(f => f.id === 12)!;
  const tax = sum(c.ledger.filter(e => e.tick === 210 && e.from === f.wallet && e.reason === 'Monthly firm profit tax').map(e => e.amount));
  const retained = Math.ceil(Math.max(0, f.lastMonthProfit - tax) / 4), facts = ownerFinance(c, f.id)!;
  assert.ok(facts.developmentReserve >= retained);
  assert.equal(withdrawOwnerProfit(c, f.id, 93_010).ok, false);
  if (facts.withdrawAvailable) assert.equal(withdrawOwnerProfit(c, f.id, facts.withdrawAvailable).ok, true);
  assert.ok(c.accounts[f.wallet] >= 20_000 + facts.developmentReserve);
  assert.equal(ownerFinance(c, f.id)!.withdrawAvailable, 0);
  conserved(c); assert.equal(serialize(deserialize(serialize(c))), serialize(c));
});

test('partial-month accrual, settlement, rounding and repeated draws share one budget', () => {
  const { c, f, h } = fixture();
  entry(c, f, 35, 20_003, 'Household #1 purchase', true); f.monthlyRevenue = 20_003; f.workDays[h.wallet] = 1;
  const before = ownerFinance(c, f.id)!;
  assert.equal(before.taxReserve, 3_720); assert.equal(before.developmentReserve, 3_721);
  assert.equal(before.distributable, 11_162);
  delete f.workDays[h.wallet]; f.monthlyExpense = 1_400; c.accounts[f.wallet] -= 1_400;
  entry(c, f, 35, 1_400, 'Monthly wages');
  assert.equal(ownerFinance(c, f.id)!.distributable, before.distributable, 'paid wage replaces the claim, not a second cost');
  assert.equal(withdrawOwnerProfit(c, f.id, 5_000).ok, true);
  assert.equal(withdrawOwnerProfit(c, f.id, 6_162).ok, true);
  assert.equal(withdrawOwnerProfit(c, f.id, 1).ok, false);
  assert.equal(f.owner!.withdrawn, 11_162);
});

test('retention carries across months and only recorded development spending consumes it', () => {
  const { c, f } = fixture();
  entry(c, f, 20, 100_000, 'Household #1 purchase', true); entry(c, f, 30, 20_000, 'Monthly firm profit tax');
  f.profit = 100_000; f.owner!.taxPaid = 20_000; c.accounts[f.wallet] = 140_000;
  assert.equal(ownerFinance(c, f.id)!.developmentReserve, 20_000);
  c.tick = 61;
  assert.equal(ownerFinance(c, f.id)!.developmentReserve, 20_000, 'a new month does not release it');
  entry(c, f, 61, 7_000, 'Unrelated cash movement');
  assert.equal(ownerFinance(c, f.id)!.developmentReserve, 20_000);
  entry(c, f, 61, 8_000, 'Profitable firm height investment'); c.accounts[f.wallet] -= 8_000;
  assert.equal(ownerFinance(c, f.id)!.developmentReserve, 12_000);
  assert.equal(ownerFinance(c, f.id)!.distributable, 60_000, 'spent reserve does not become withdrawable profit');
  entry(c, f, 61, 20_000, 'Market to shop conversion'); c.accounts[f.wallet] -= 20_000;
  assert.equal(ownerFinance(c, f.id)!.developmentReserve, 0);
  assert.equal(ownerFinance(c, f.id)!.distributable, 52_000, 'investment beyond the reserve also spends earned funds');
  c.tick = 65; f.monthlyRevenue = 40_000; entry(c, f, 65, 40_000, 'Household #1 purchase', true);
  assert.equal(ownerFinance(c, f.id)!.developmentReserve, 0, 'same-month investment offsets current retention');
  c.tick = 91; f.profit += 40_000; f.monthlyRevenue = 0; f.owner!.taxPaid += 8_000; entry(c, f, 90, 8_000, 'Monthly firm profit tax');
  f.monthlyRevenue = 40_000; entry(c, f, 91, 40_000, 'Household #1 purchase', true);
  assert.equal(ownerFinance(c, f.id)!.developmentReserve, 8_000, 'excess spending never pre-releases future months');
});

test('negative earnings, principal, old excess draws, tax and short cash cannot fund withdrawals', () => {
  const { c, f } = fixture();
  assert.equal(ownerFinance(c, f.id)!.withdrawAvailable, 0, 'opening principal is not profit');
  f.monthlyRevenue = 10_000; entry(c, f, 35, 10_000, 'Household #1 purchase', true);
  f.monthlyExpense = 12_000; entry(c, f, 35, 12_000, 'Monthly wages');
  assert.equal(ownerFinance(c, f.id)!.withdrawAvailable, 0);
  f.monthlyRevenue += 30_000; entry(c, f, 35, 30_000, 'Household #1 purchase', true);
  c.accounts[f.wallet] = 25_000;
  assert.equal(ownerFinance(c, f.id)!.withdrawAvailable, 0, 'tax plus retention and working cash exceed cash');
  c.accounts[f.wallet] = 100_000; f.owner!.withdrawn = 100_000;
  assert.equal(ownerFinance(c, f.id)!.withdrawAvailable, 0, 'legacy overdraw is not clawed back or paid twice');
});

test('cash cap preserves wages, tax, retention and working cash together', () => {
  const { c, f, h } = fixture();
  f.monthlyRevenue = 20_003; f.workDays[h.wallet] = 1; c.accounts[f.wallet] = 30_000;
  entry(c, f, 35, 20_003, 'Household #1 purchase', true);
  assert.equal(ownerFinance(c, f.id)!.withdrawAvailable, 1_159);
  assert.equal(withdrawOwnerProfit(c, f.id, 1_159).ok, true);
  assert.equal(c.accounts[f.wallet], 20_000 + 1_400 + 3_720 + 3_721);
  assert.equal(ownerFinance(c, f.id)!.withdrawAvailable, 0);
});

test('a closed loss does not unlock an earlier development reserve', () => {
  const { c, f } = fixture(); c.tick = 61;
  entry(c, f, 20, 100_000, 'Household #1 purchase', true); entry(c, f, 30, 20_000, 'Monthly firm profit tax');
  entry(c, f, 60, 5_000, 'Monthly firm rent'); f.profit = 95_000; f.owner!.taxPaid = 20_000;
  assert.equal(ownerFinance(c, f.id)!.developmentReserve, 20_000);
  assert.equal(ownerFinance(c, f.id)!.distributable, 55_000);
});

test('month close subtracts manual payouts from the automatic monthly allowance', () => {
  const c = seeded(59), f = c.firms.find(f => f.owner && ownerFinance(c, f.id)!.withdrawAvailable >= 5_000)!;
  assert.ok(f); assert.equal(withdrawOwnerProfit(c, f.id, 5_000).ok, true);
  step(c);
  const tax = sum(c.ledger.filter(e => e.tick === 60 && e.from === f.wallet && e.reason === 'Monthly firm profit tax').map(e => e.amount));
  const net = Math.max(0, f.lastMonthProfit - tax);
  const auto = sum(c.ledger.filter(e => e.tick === 60 && e.from === f.wallet && e.reason === 'Owner profit distribution').map(e => e.amount));
  assert.ok(auto > 0); assert.ok(auto + 5_000 <= net - Math.ceil(net / 4));
  assert.equal(ownerFinance(c, f.id)!.withdrawAvailable, 0);
  conserved(c); assert.doesNotThrow(() => deserialize(serialize(c)));
});

test('unreconciled legacy earnings leave balances and saves intact and disable new payouts', () => {
  const { c, f } = fixture(); f.profit = 1_000_000;
  const before = serialize(c);
  assert.equal(ownerFinance(c, f.id)!.historyReconciled, false);
  assert.equal(withdrawOwnerProfit(c, f.id, 1).ok, false);
  assert.equal(serialize(c), before);
});

test('published v15 owned-shop save reconstructs retention and actual conversion without any state migration', () => {
  const c = deserialize(readFileSync(new URL('./fixtures/retail-v15.json', import.meta.url), 'utf8'));
  const before = serialize(c), accounts = structuredClone(c.accounts), ledger = structuredClone(c.ledger);
  const owners = c.firms.filter(f => f.owner); assert.ok(owners.length > 0);
  for (const f of owners) assert.equal(ownerFinance(c, f.id)!.historyReconciled, true);
  const converted = owners.find(f => f.convertedAt !== undefined)!;
  const facts = ownerFinance(c, converted.id)!;
  assert.equal(facts.developmentSpent, 20_000); assert.equal(facts.developmentReserve, 25_420);
  assert.equal(serialize(c), before); assert.deepEqual(c.accounts, accounts); assert.deepEqual(c.ledger, ledger);
  const loaded = deserialize(before); step(c); step(loaded);
  assert.equal(serialize(c), serialize(loaded)); conserved(c);
});

test('manual and automatic payouts across month close preserve claims, reserves and deterministic replay', () => {
  const c = seeded(59), loaded = deserialize(serialize(c));
  for (const city of [c, loaded]) {
    for (let day = 60; day <= 95; day++) {
      for (const f of city.firms.filter(f => f.owner)) {
        const facts = ownerFinance(city, f.id)!;
        if (facts.withdrawAvailable > 0) assert.equal(withdrawOwnerProfit(city, f.id, facts.withdrawAvailable).ok, true);
        assert.equal(withdrawOwnerProfit(city, f.id, 1).ok, false);
      }
      step(city); conserved(city);
      assert.equal(serialize(deserialize(serialize(city))), serialize(city));
    }
  }
  assert.equal(serialize(c), serialize(loaded));
  const f = c.firms.find(f => f.owner)!;
  const before = ownerFinance(c, f.id)!.distributable;
  assert.equal(contributeOwnerCapital(c, f.id, 1).ok, true);
  assert.equal(ownerFinance(c, f.id)!.distributable, before, 'new principal never raises earned profit');
});
