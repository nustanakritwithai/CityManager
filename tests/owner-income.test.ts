import test from 'node:test';
import assert from 'node:assert/strict';
import { createCity, step, serialize, deserialize, isMarket, isRetail, ownerFinance } from '../src/sim.ts';

test('monthly owner income pays both market and retail from earned available profit and survives save replay', () => {
  const c = createCity(42); for (let i = 0; i < 209; i++) step(c);
  const owners = c.firms.filter(f => f.owner && (isMarket(f) || isRetail(f)));
  assert.ok(owners.some(isMarket) && owners.some(isRetail));
  const loaded = deserialize(serialize(c)); step(c); step(loaded);
  assert.equal(serialize(c), serialize(loaded));
  for (const f of owners) {
    const paid = c.ledger.filter(e => e.tick === 210 && e.reason === 'Owner profit distribution' && e.from === f.wallet && e.to === `household:${f.owner!.householdId}`);
    assert.equal(paid.length, 1, `firm ${f.id} receives one monthly distribution`);
    const tax = c.ledger.filter(e => e.tick === 210 && e.from === f.wallet && e.reason === 'Monthly firm profit tax').reduce((n, e) => n + e.amount, 0);
    const netProfit = Math.max(0, f.lastMonthProfit - tax);
    const retained = Math.ceil(netProfit / 4);
    assert.ok(paid[0].amount > 0 && paid[0].amount <= netProfit - retained);
    assert.ok(c.accounts[f.wallet] >= 20_000 + retained, 'development funds and operating cash remain');
    assert.ok(c.accounts[f.wallet] >= 20_000, 'working cash remains protected');
    assert.ok(ownerFinance(c, f.id)!.withdrawn >= paid[0].amount);
  }
  assert.doesNotThrow(() => deserialize(serialize(c)));
});

test('distributions never exceed the current month net profit after development savings', () => {
  for (const seed of [42, 61025, 2026]) {
    const city = createCity(seed);
    for (let day = 1; day <= 240; day++) {
      step(city);
      if (day % 30) continue;
      for (const firm of city.firms.filter(f => f.owner)) {
        const tax = city.ledger.filter(e => e.tick === day && e.from === firm.wallet && e.reason === 'Monthly firm profit tax').reduce((n, e) => n + e.amount, 0);
        const distributions = city.ledger.filter(e => e.tick === day && e.from === firm.wallet && e.reason === 'Owner profit distribution');
        const net = Math.max(0, firm.lastMonthProfit - tax);
        assert.ok(distributions.reduce((n, e) => n + e.amount, 0) <= net - Math.ceil(net / 4));
      }
    }
    assert.doesNotThrow(() => deserialize(serialize(city)));
  }
});
