import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCity, step, zoneCell, access, firmWorkerCount, firmCapacity, wagesFor, OTHER_SPENDING, REAL_DAILY_SPENDING, MONTH, type City } from '../src/sim.ts';
import { scheduleCityTaxes, taxRatesAt, DEFAULT_TAX_RATES } from '../src/city-tax-policy.ts';
import { householdMonthlyBill } from '../src/utilities.ts';
import { keepSupplied } from './plants.ts';

/** A farming town: six farm plots and two home plots zoned on the first free road frontage. */
function farmTown(): City {
  const c = createCity(61025);
  const free = () => c.cells.map((cell, i) => !cell.road && !cell.zone && cell.building === null && access(c, i) ? i : -1).filter(i => i >= 0);
  for (const [zone, n] of [['F', 6], ['R', 2]] as const) { let done = 0; for (const i of free()) { if (done >= n) break; if (zoneCell(c, i, zone).ok) done++; } }
  return c;
}
const run = (c: City, days: number) => { for (let d = 0; d < days; d++) { step(c); keepSupplied(c); } };
const farmPosts = (c: City) => c.firms.filter(f => f.zone === 'F').reduce((n, f) => ({ filled: n.filled + firmWorkerCount(c, f.id), posts: n.posts + firmCapacity(c.buildings.find(b => b.id === f.building)!, f, c) }), { filled: 0, posts: 0 });
const people = (c: City) => c.households.reduce((n, h) => n + h.members, 0);

test('a farm job pays enough after tax for what a newcomer really spends a month', () => {
  const c = createCity(61025);
  // The survey's 139 baht a person a day is 7.50 at the game's scale: 0.50 of kilo foods and 7.00 of everything else.
  assert.equal(REAL_DAILY_SPENDING, OTHER_SPENDING.price + 50);
  const gross = wagesFor(c).F, net = gross - Math.round(gross * DEFAULT_TAX_RATES.wage / 100);
  const needs = MONTH * REAL_DAILY_SPENDING + 10_000 + householdMonthlyBill(c);
  assert.ok(net >= needs, `a farm hand keeps ${net} and needs ${needs}`);
  assert.ok(net < MONTH * 800 + 10_000 + householdMonthlyBill(c), 'the old 8-baht basket priced farm hands out of town');
});

test('newcomers come to work the farms the town zones', { timeout: 300_000 }, () => {
  const c = farmTown(); run(c, 120);
  const { filled, posts } = farmPosts(c);
  assert.ok(posts >= 15 && filled >= posts * .85, `farm posts filled ${filled}/${posts}`);
  assert.ok(people(c) > 20, `${people(c)} people`);
});

test('when the wage tax leaves a farm hand short, people looking for work still come and take the farm jobs', { timeout: 300_000 }, () => {
  const c = farmTown(); scheduleCityTaxes(c, { wage: 25, profit: DEFAULT_TAX_RATES.profit });
  const gross = wagesFor(c).F, rate = taxRatesAt(c.taxPolicy, MONTH).wage;
  assert.equal(rate, 25);
  assert.ok(gross - Math.round(gross * rate / 100) < MONTH * REAL_DAILY_SPENDING + 10_000 + householdMonthlyBill(c), 'no one is hired in for a farm job at this tax');
  run(c, 120);
  const { filled, posts } = farmPosts(c);
  assert.ok(filled >= posts * .75, `farm posts filled ${filled}/${posts}`);
});
