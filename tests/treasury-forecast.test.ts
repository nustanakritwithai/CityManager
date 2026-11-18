import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCity, step, budgetSummary, treasurySpendable, MONTH, type City } from '../src/sim.ts';
import { treasuryForecast } from '../src/treasury-forecast.ts';

const grown = (days: number) => { const c = createCity(61025); for (let i = 0; i < days; i++) step(c); return c; };
const forecast = (c: City) => treasuryForecast(c, treasurySpendable(c), budgetSummary(c).reduce((n, r) => n + r.monthly, 0));

test('the forecast repeats the last 30 days of treasury money, without the founding grant', () => {
  const c = grown(95), f = forecast(c), from = c.tick - MONTH + 1;
  const window = c.ledger.filter(e => e.tick >= from && e.tick <= c.tick);
  assert.equal(f.windowDays, MONTH);
  assert.equal(f.income, window.filter(e => e.to === 'treasury').reduce((n, e) => n + e.amount, 0));
  assert.equal(f.spending, window.filter(e => e.from === 'treasury').reduce((n, e) => n + e.amount, 0));
  assert.equal(f.net, f.income - f.spending); assert.equal(f.nextMonth, f.balance + f.net);
  assert.equal(f.balance, c.accounts.treasury); assert.equal(f.spendable, treasurySpendable(c));
  const young = grown(5), y = forecast(young);
  assert.equal(y.windowDays, young.tick + 1);
  assert.ok(young.ledger.some(e => e.reason === 'Initial municipal grant'));
  assert.ok(y.income < 3_000_000, 'the founding grant is not counted as income');
});

test('runway counts the days left only when the balance is falling', () => {
  const c = grown(60), base = forecast(c);
  const falling = { ...c, ledger: [...c.ledger, { tick: c.tick, from: 'treasury', to: 'upkeep', amount: base.income + 3_000_000, reason: 'test spend' }] };
  const f = treasuryForecast(falling, 0, 0);
  assert.ok(f.daily < 0); assert.equal(f.runwayDays, Math.floor(f.balance / -f.daily));
  const rising = { ...c, ledger: [...c.ledger, { tick: c.tick, from: 'outside', to: 'treasury', amount: base.spending + 1, reason: 'test grant' }] };
  assert.equal(treasuryForecast(rising, 0, 0).runwayDays, null);
});

test('the next settlement is counted to the next day that is a multiple of a month', () => {
  for (const [tick, left] of [[0, MONTH], [1, MONTH - 1], [MONTH - 1, 1], [MONTH, MONTH]] as const)
    assert.equal(treasuryForecast({ tick, ledger: [], accounts: { treasury: 0 } }, 0, 0).settlementIn, left, `tick ${tick}`);
  const c = grown(40); while (c.tick % MONTH !== MONTH - 1) step(c);
  assert.equal(forecast(c).settlementIn, 1); step(c);
  assert.ok(c.ledger.some(e => e.tick === c.tick && e.reason === 'Monthly household rent'), 'rent posts on that day');
});
