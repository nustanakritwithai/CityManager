import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCity, step } from '../src/sim.ts';
import { moneyFlows } from '../src/economy-flows.ts';
import { householdEconomy } from '../src/household-economy.ts';
import { businessSectors } from '../src/business-sectors.ts';
import { MAX_INSIGHTS, economyInsights } from '../src/economy-insights.ts';

const inputs = () => { const c = createCity(61025); for (let i = 0; i < 120; i++) step(c); return { c, f: moneyFlows(c), h: householdEconomy(c), b: businessSectors(c) }; };
const keys = (xs: { key: string }[]) => xs.map(x => x.key);

test('a grown city gets a few insights, each pointing at an overview section, worst news first', () => {
  const { f, h, b } = inputs(), xs = economyInsights(f, h, b);
  assert.ok(xs.length >= 1 && xs.length <= MAX_INSIGHTS);
  const rank = { bad: 0, warn: 1, good: 2 };
  for (let i = 1; i < xs.length; i++) assert.ok(rank[xs[i - 1].tone] <= rank[xs[i].tone]);
  for (const x of xs) { assert.match(x.target, /^dash-(economy|households|business|finance)$/); assert.ok(x.text.length > 10); }
  assert.equal(new Set(keys(xs)).size, xs.length);
});

test('trouble shows up as bad or warning insights', () => {
  const { f, h, b } = inputs();
  h.atRisk = [{ id: 1, members: 2, savings: 0, bills: 50_000, net: -1 }];
  h.spendingMore = h.households;
  const factory = b.sectors.find(s => s.sector === 'I')!; factory.profit = -100_000; factory.firms = Math.max(1, factory.firms);
  f.balances.find(x => x.sector === 'treasury')!.net = -5_000; f.leftCity = f.cameIn + 10_000;
  const xs = economyInsights(f, h, b), k = keys(xs);
  assert.equal(xs[0].key, 'at-risk'); assert.equal(xs[0].tone, 'bad'); assert.match(xs[0].text, /^1 ครัวเรือน/);
  assert.ok(k.includes('sector-loss-I')); assert.match(xs.find(x => x.key === 'sector-loss-I')!.text, /^โรงงานขาดทุนรวม 1,000 ฿/);
  assert.ok(k.includes('overspend'));
  assert.equal(xs.length, MAX_INSIGHTS, 'capped');
  assert.ok(!k.includes('firm-loss'), 'a losing sector already covers its firms');
});

test('one losing firm in a profitable economy is a warning naming it, and a quiet city still reads sensibly', () => {
  const { f, h, b } = inputs();
  for (const s of b.sectors) s.profit = Math.max(1, s.profit);
  b.firms.push({ id: 99, sector: 'C', label: 'ร้านค้า #99', revenue: 0, costs: 12_300, profit: -12_300, cash: 0, workers: 1 });
  const loss = economyInsights(f, h, b).find(x => x.key === 'firm-loss')!;
  assert.equal(loss.tone, 'warn'); assert.match(loss.text, /ร้านค้า #99 \(−123 ฿\)/);
  const quiet = economyInsights(moneyFlows({ tick: 1, ledger: [] }), householdEconomy({ tick: 1, ledger: [], households: [], accounts: {} }), businessSectors({ tick: 1, ledger: [], firms: [], accounts: {} }));
  assert.deepEqual(quiet, []);
});
