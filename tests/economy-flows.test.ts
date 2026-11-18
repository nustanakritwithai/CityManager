import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCity, step, MONTH, type City } from '../src/sim.ts';
import { ECONOMY_SECTORS, moneyFlows, sectorOf } from '../src/economy-flows.ts';

const grown = (days = 90) => { const c = createCity(61025); for (let i = 0; i < days; i++) step(c); return c; };

test('every ledger wallet belongs to one sector', () => {
  assert.equal(sectorOf('household:12'), 'household');
  assert.equal(sectorOf('firm:3'), 'firm');
  assert.equal(sectorOf('treasury'), 'treasury');
  assert.equal(sectorOf('landlord'), 'landlord');
  for (const w of ['construction', 'roadworks', 'upkeep']) assert.equal(sectorOf(w), 'works');
  assert.equal(sectorOf('outside'), 'outside');
  const c = grown();
  for (const wallet of Object.keys(c.accounts)) assert.ok(ECONOMY_SECTORS.includes(sectorOf(wallet)), wallet);
});

test('flows cover exactly the window, balance to zero and match the ledger', () => {
  const c = grown(), f = moneyFlows(c);
  assert.equal(f.toTick, c.tick); assert.equal(f.fromTick, c.tick - MONTH + 1);
  const inWindow = c.ledger.filter(e => e.tick >= f.fromTick && e.tick <= c.tick);
  const crossing = inWindow.filter(e => sectorOf(e.from) !== sectorOf(e.to));
  assert.equal(f.flows.reduce((n, x) => n + x.amount, 0), crossing.reduce((n, e) => n + e.amount, 0));
  assert.equal(f.flows.reduce((n, x) => n + x.entries, 0), crossing.length);
  assert.equal(Object.values(f.within).reduce((n, x) => n + x, 0), inWindow.filter(e => sectorOf(e.from) === sectorOf(e.to)).reduce((n, e) => n + e.amount, 0));
  assert.equal(f.balances.reduce((n, b) => n + b.net, 0), 0, 'money moves between sectors; none appears or vanishes');
  for (const b of f.balances) assert.equal(b.net, b.inflow - b.outflow);
  for (let i = 1; i < f.flows.length; i++) assert.ok(f.flows[i - 1].amount >= f.flows[i].amount, 'largest first');
  assert.ok(f.flows.every(x => x.from !== x.to && x.amount > 0));
  const outside = f.balances.find(b => b.sector === 'outside')!;
  assert.equal(f.leftCity, outside.inflow); assert.equal(f.cameIn, outside.outflow);
  assert.ok(f.flows.some(x => x.from === 'firm' && x.to === 'household'), 'firms pay wages to households');
});

test('each sector net equals the change in its wallets over the window when the window starts at day 0', () => {
  const c = grown(20), f = moneyFlows(c, 1000);
  assert.equal(f.fromTick, 0);
  for (const sector of ECONOMY_SECTORS) {
    const held = Object.entries(c.accounts).filter(([w]) => sectorOf(w) === sector).reduce((n, [, v]) => n + v, 0);
    assert.equal(f.balances.find(b => b.sector === sector)!.net, held, sector);
  }
});

test('a shorter window only counts its own days, and an empty city has no flows', () => {
  const c = grown(), week = moneyFlows(c, 7);
  assert.equal(week.fromTick, c.tick - 6);
  const total = (x: ReturnType<typeof moneyFlows>) => x.flows.reduce((n, y) => n + y.amount, 0);
  assert.ok(total(week) <= total(moneyFlows(c)));
  const empty = { tick: 5, ledger: [] } as unknown as City, none = moneyFlows(empty);
  assert.deepEqual(none.flows, []); assert.equal(none.leftCity, 0); assert.equal(none.cameIn, 0);
  assert.ok(none.balances.every(b => b.net === 0));
});
