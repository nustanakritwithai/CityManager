import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCity, step, MONTH, type City } from '../src/sim.ts';
import { populationFixture } from './population-capacity-fixture.ts';
import { BUSINESS_SECTORS, businessSectors, costKind, firmLabel } from '../src/business-sectors.ts';
import { RECIPE_LABELS } from '../src/goods.ts';

const grown = (days = 120) => { const c = createCity(61025); for (let i = 0; i < days; i++) step(c); return c; };
const big = () => { const c = populationFixture(60, true); for (let i = 0; i < 31; i++) step(c); return c; };

test('firm payments fall into running costs, payouts or investment', () => {
  assert.equal(costKind({ to: 'household:3', reason: 'Monthly wages' }), 'wages');
  assert.equal(costKind({ to: 'treasury', reason: 'Monthly firm profit tax' }), 'tax');
  assert.equal(costKind({ to: 'landlord', reason: 'Monthly firm rent' }), 'rent');
  assert.equal(costKind({ to: 'treasury', reason: 'Monthly water and power bill' }), 'utilities');
  assert.equal(costKind({ to: 'firm:4', reason: 'Crop exchange #12' }), 'supplies');
  assert.equal(costKind({ to: 'outside', reason: 'Outside goods import' }), 'supplies');
  assert.equal(costKind({ to: 'household:3', reason: 'Owner profit distribution' }), null);
  assert.equal(costKind({ to: 'construction', reason: 'Profitable firm height investment' }), null);
  assert.equal(firmLabel({ id: 7, zone: 'I', recipe: 'cannery' }, RECIPE_LABELS), 'โรงงานอาหารกระป๋อง #7');
  assert.equal(firmLabel({ id: 8, zone: 'C' }), 'ร้านค้า #8');
});

test('sector totals add up to their firms and to the ledger, with nothing unexplained', () => {
  for (const c of [grown(), big()]) {
    const r = businessSectors(c, MONTH, RECIPE_LABELS), from = c.tick - MONTH + 1, wallets = new Set(c.firms.map(f => f.wallet));
    assert.equal(r.fromTick, from);
    assert.deepEqual(r.sectors.map(s => s.sector), [...BUSINESS_SECTORS]);
    assert.equal(r.firms.length, c.firms.length);
    assert.equal(r.sectors.reduce((n, s) => n + s.firms, 0), c.firms.length);
    const window = c.ledger.filter(e => e.tick >= from && e.tick <= c.tick && e.from !== e.to);
    const out = window.filter(e => wallets.has(e.from)).reduce((n, e) => n + e.amount, 0);
    const into = window.filter(e => wallets.has(e.to) && !/ equity investment$/.test(e.reason)).reduce((n, e) => n + e.amount, 0);
    assert.equal(r.sectors.reduce((n, s) => n + s.costs + s.payouts + s.investment, 0), out);
    assert.equal(r.sectors.reduce((n, s) => n + s.revenue, 0), into);
    for (const s of r.sectors) {
      const mine = r.firms.filter(f => f.sector === s.sector);
      assert.equal(s.revenue, mine.reduce((n, f) => n + f.revenue, 0)); assert.equal(s.costs, mine.reduce((n, f) => n + f.costs, 0));
      assert.equal(s.profit, s.revenue - s.costs);
      assert.equal(Object.values(s.buyers).reduce((a, b) => a + b, 0), s.revenue);
      assert.equal(Object.values(s.costKinds).reduce((a, b) => a + b, 0), s.costs);
      assert.equal(s.costKinds.other, 0, `${s.sector} has no unexplained cost`);
    }
    for (let i = 1; i < r.firms.length; i++) assert.ok(r.firms[i - 1].profit >= r.firms[i].profit);
    for (const f of r.firms) assert.equal(f.cash, c.accounts[c.firms.find(x => x.id === f.id)!.wallet]);
  }
});

test('a firm with no trade in the window shows zero, and an empty city has no sectors with firms', () => {
  const c = grown(), r = businessSectors(c, 0);
  assert.ok(r.firms.every(f => f.revenue === 0 && f.costs === 0));
  const empty = businessSectors({ tick: 4, ledger: [], firms: [], accounts: {} } as unknown as City);
  assert.ok(empty.sectors.every(s => s.firms === 0 && s.revenue === 0)); assert.deepEqual(empty.firms, []);
});
