import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCity, deserialize, serialize, step, MUNICIPAL_SERVICE_PER_RESIDENT } from '../src/sim.ts';
import { treasuryBudget } from '../src/overview-data.ts';
import { keepSupplied } from './plants.ts';

const bill = 'Monthly municipal services';
test('municipal services are charged only at settlement, itemized and preserve save round trips', () => {
  let c = createCity(61025);
  for (let i = 0; i < 29; i++) step(c);
  assert.equal(c.ledger.some(e => e.reason === bill), false);
  const before = c.accounts.treasury;
  c = deserialize(serialize(c));
  assert.equal(c.accounts.treasury, before, 'loading does not charge a back bill');
  step(c);
  const rows = c.ledger.filter(e => e.reason === bill);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].amount, c.households.reduce((n, h) => n + h.members, 0) * MUNICIPAL_SERVICE_PER_RESIDENT);
  assert.equal(rows[0].from, 'treasury'); assert.equal(rows[0].to, 'upkeep');
  assert.equal(treasuryBudget(c).expense.find(e => e.key === 'municipal-services')?.amount, rows[0].amount);
  assert.deepEqual(deserialize(serialize(c)), c);
});

test('a low treasury cannot go negative or create service debt', () => {
  const c = createCity(61025); for (let i = 0; i < 29; i++) step(c);
  // Spend all available cash through the existing ledger, preserving accounting identity.
  const cash = c.accounts.treasury; c.accounts.treasury = 0; c.accounts.upkeep += cash;
  c.ledger.push({ tick: c.tick, from: 'treasury', to: 'upkeep', amount: cash, reason: 'Test spending' });
  step(c);
  const amount = c.ledger.find(e => e.reason === bill && e.tick === 30)?.amount ?? 0;
  const due = c.households.reduce((n, h) => n + h.members, 0) * MUNICIPAL_SERVICE_PER_RESIDENT;
  assert.ok(amount < due); assert.ok(c.accounts.treasury >= 0);
  assert.deepEqual(deserialize(serialize(c)), c);
});

test('seeded mature cities maintain positive, reduced operating surplus', { timeout: 120_000 }, () => {
  for (const seed of [61025, 2026, 42]) {
    const c = createCity(seed);
    for (let i = 0; i < 720; i++) { step(c); keepSupplied(c); }
    const budget = treasuryBudget(c), cost = budget.expense.find(e => e.key === 'municipal-services')?.amount ?? 0;
    assert.equal(cost, 140_000);
    assert.ok(budget.net > 0 && budget.net < 60_000, `seed ${seed}: ${budget.net} satang`);
    assert.ok(c.accounts.treasury > 0);
  }
});


test('an older saved city loads without a retroactive services charge', () => {
  const raw = readFileSync(new URL('./fixtures/legacy-v3-day180.json', import.meta.url), 'utf8');
  const old = JSON.parse(raw), c = deserialize(raw);
  assert.equal(c.accounts.treasury, old.accounts.treasury);
  assert.equal(c.tick, old.tick);
  assert.equal(c.ledger.filter(e => e.reason === bill).length, 0);
  assert.deepEqual(deserialize(serialize(c)), c);
});
