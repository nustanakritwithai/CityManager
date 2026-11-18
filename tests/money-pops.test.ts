import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCity, step, MONTH, type City } from '../src/sim.ts';
import { MAX_POPS, MIN_POP, moneyMark, moneyPops } from '../src/money-pops.ts';

const grown = (days = 80) => { const c = createCity(61025); for (let i = 0; i < days; i++) step(c); return c; };

test('pay day shows the biggest money changes at real parcels, capped and above the floor', () => {
  const c = grown(); while (c.tick % MONTH !== MONTH - 1) step(c);
  const from = moneyMark(c); step(c);
  const pops = moneyPops(c, from), cells = new Set(c.buildings.map(b => b.cell));
  assert.ok(pops.length > 0 && pops.length <= MAX_POPS);
  for (const p of pops) { assert.ok(cells.has(p.cell), `pop at a building ${p.cell}`); assert.ok(Math.abs(p.amount) >= MIN_POP); }
  for (let i = 1; i < pops.length; i++) assert.ok(Math.abs(pops[i - 1].amount) >= Math.abs(pops[i].amount));
  assert.equal(new Set(pops.map(p => p.cell)).size, pops.length, 'one label per parcel');
});

test('each label is the net of everything that parcel paid and received', () => {
  const c = grown(), home = c.households.find(h => h.home !== null)!, cell = c.buildings.find(b => b.id === home.home)!.cell;
  const shop = c.firms[0], shopCell = c.buildings.find(b => b.id === shop.building)!.cell;
  const from = moneyMark(c);
  c.ledger.push({ tick: c.tick, from: shop.wallet, to: home.wallet, amount: 50_000, reason: 'Monthly wages' });
  c.ledger.push({ tick: c.tick, from: home.wallet, to: shop.wallet, amount: 20_000, reason: `Household #${home.id} purchase` });
  c.ledger.push({ tick: c.tick, from: home.wallet, to: 'landlord', amount: 5_000, reason: 'Monthly household rent' });
  const pops = new Map(moneyPops(c, from, 10, 1).map(p => [p.cell, p.amount]));
  assert.equal(pops.get(cell), 25_000); assert.equal(pops.get(shopCell), -30_000);
  assert.deepEqual(moneyPops(c, from, 10, 40_000), [], 'small changes stay quiet');
  assert.deepEqual(moneyPops(c, moneyMark(c)), [], 'nothing new, nothing shown');
});

test('a city-run venue shows its visitor takings at the site, not at the treasury', () => {
  const c = grown(), home = c.households.find(h => h.home !== null)!;
  c.civic = { version: 1, sites: [{ id: 4, kind: 'cinema', cell: 300, tick: c.tick } as never] } as City['civic'];
  const from = moneyMark(c);
  for (let k = 0; k < 3; k++) c.ledger.push({ tick: c.tick, from: home.wallet, to: 'treasury', amount: 6_000, reason: 'Visit cinema #4' });
  const site = moneyPops(c, from, 10, 1).find(p => p.cell === 300);
  assert.equal(site?.amount, 18_000);
});
