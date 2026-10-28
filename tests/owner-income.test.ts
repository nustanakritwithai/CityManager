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
    assert.ok(paid[0].amount > 0 && paid[0].amount <= 40_000);
    assert.ok(c.accounts[f.wallet] >= 20_000, 'working cash remains protected');
    assert.ok(ownerFinance(c, f.id)!.withdrawn >= paid[0].amount);
  }
  assert.doesNotThrow(() => deserialize(serialize(c)));
});
