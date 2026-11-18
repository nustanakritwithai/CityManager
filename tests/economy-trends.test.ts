import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCity, step, MONTH } from '../src/sim.ts';
import { moneyFlows } from '../src/economy-flows.ts';
import { householdEconomy } from '../src/household-economy.ts';
import { businessSectors } from '../src/business-sectors.ts';
import { treasuryForecast } from '../src/treasury-forecast.ts';
import { TREND_KEYS, TREND_MONTHS, economyTrends, percentChange } from '../src/economy-trends.ts';

const grown = (days: number) => { const c = createCity(61025); for (let i = 0; i < days; i++) step(c); return c; };
const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);

test('percentage change compares against the earlier month and needs one to compare with', () => {
  assert.equal(percentChange(100, 150), 50); assert.equal(percentChange(200, 100), -50);
  assert.equal(percentChange(-100, -50), 50, 'a smaller loss is a rise'); assert.equal(percentChange(0, 10), null);
});

test('three back-to-back 30-day windows, newest last, whose newest month matches the other analyses', () => {
  const c = grown(130), t = economyTrends(c);
  assert.equal(t.windows.length, TREND_MONTHS);
  assert.deepEqual(t.windows.at(-1), { fromTick: c.tick - MONTH + 1, toTick: c.tick });
  for (let i = 1; i < t.windows.length; i++) assert.equal(t.windows[i].fromTick, t.windows[i - 1].toTick + 1);
  assert.deepEqual(t.rows.map(r => r.key), [...TREND_KEYS]);
  const now = Object.fromEntries(t.rows.map(r => [r.key, r.values.at(-1)!]));
  const homes = householdEconomy(c), biz = businessSectors(c), flows = moneyFlows(c), fc = treasuryForecast(c, 0, 0);
  assert.equal(now.householdIncome, sum(homes.income)); assert.equal(now.householdSpending, sum(homes.spending));
  const traded = new Set(c.ledger.filter(e => e.tick > c.tick - MONTH).flatMap(e => [e.from, e.to]).filter(w => w.startsWith('firm:')));
  assert.ok([...traded].every(w => c.firms.some(f => f.wallet === w)), 'no firm that traded this month has closed');
  assert.equal(now.businessTakings, biz.sectors.reduce((n, s) => n + s.revenue, 0));
  assert.equal(now.businessProfit, biz.sectors.reduce((n, s) => n + s.profit, 0));
  assert.equal(now.treasuryNet, fc.net); assert.equal(now.borderNet, flows.cameIn - flows.leftCity);
  for (const r of t.rows) assert.equal(r.change, percentChange(r.values.at(-2)!, r.values.at(-1)!));
});

test('a young city shows only the months it has lived', () => {
  assert.equal(economyTrends(grown(10)).windows.length, 0);
  const one = economyTrends(grown(MONTH - 1));
  assert.equal(one.windows.length, 1); assert.ok(one.rows.every(r => r.values.length === 1 && r.change === null));
  assert.equal(economyTrends(grown(2 * MONTH - 1)).windows.length, 2);
});
