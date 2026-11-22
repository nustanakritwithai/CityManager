import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCity, step, serialize, deserialize } from '../src/sim.ts';
import { HOUSEHOLD_BILL, REAL_UNIT, householdMonthlyBill, realPowerBill, realWaterBill } from '../src/utilities.ts';
import { keepSupplied } from './plants.ts';
import { legacyPrices } from './legacy-sizes.ts';

/** Real baht of an amount in satang, at 18.5 real baht to one. */
const real = (satang: number) => satang / 100 * 18.5;
const near = (actual: number, expected: number, what: string) => assert.ok(Math.abs(actual - expected) < 0.1, `${what}: ${actual} against ${expected}`);

test('a month of electricity and water is billed on the real PEA and PWA rates', () => {
  // A home's 200 units: 3.00 baht each, Ft 16.23 satang, service 24.62, VAT 7%.
  near(real(realPowerBill(200, 'home')), (200 * 3 + 200 * .1623 + 24.62) * 1.07, 'home electricity');
  near(real(realPowerBill(500, 'home')), (200 * 3 + 200 * 4.1584 + 100 * 4.3583 + 500 * .1623 + 24.62) * 1.07, 'a heavy home');
  // A shop's 200 units on the small business rate: 150 at 3.2484 and 50 at 4.2218, service 33.29.
  near(real(realPowerBill(200, 'shop')), (150 * 3.2484 + 50 * 4.2218 + 200 * .1623 + 33.29) * 1.07, 'shop electricity');
  // 15 m³: 10 at 10.20 and 5 at 16.00 for a home; 10 at 16.00 and 5 at 19.00 for a shop; VAT 7%.
  near(real(realWaterBill(15, 'home')), (10 * 10.2 + 5 * 16) * 1.07, 'home water');
  near(real(realWaterBill(15, 'shop')), (10 * 16 + 5 * 19) * 1.07, 'shop water');
  near(real(realWaterBill(2, 'home')), 50 * 1.07, 'the 50-baht minimum');
  near(real(realWaterBill(2, 'shop')), 150 * 1.07, 'the 150-baht minimum');
  assert.equal(realPowerBill(0, 'home'), 0); assert.equal(realWaterBill(0, 'shop'), 0);
  // A home's month comes to about 898 baht, near the 905 the average home paid for electricity alone in 2024.
  const c = createCity(61025), old = legacyPrices(createCity(61025));
  assert.equal(householdMonthlyBill(c), realPowerBill(REAL_UNIT.kWh, 'home') + realWaterBill(REAL_UNIT.m3, 'home'));
  assert.equal(Math.round(real(householdMonthlyBill(c))), 898);
  assert.equal(householdMonthlyBill(old), HOUSEHOLD_BILL);
});

test('homes and shops pay the authorities outside the town; mills, farms and the town pay no bill', { timeout: 300_000 }, () => {
  const c = createCity(61025); for (let d = 0; d < 65; d++) { step(c); keepSupplied(c); }
  const home = realPowerBill(REAL_UNIT.kWh, 'home'), water = realWaterBill(REAL_UNIT.m3, 'home');
  const homeBills = c.ledger.filter(e => e.reason === 'Monthly household water and power bill');
  assert.ok(homeBills.length > 0, 'homes were billed');
  for (const e of homeBills) { assert.equal(e.to, 'outside'); assert.ok([home, water, home + water].includes(e.amount), `a home bill of ${e.amount}`); }
  const firmBills = c.ledger.filter(e => e.reason === 'Monthly water and power bill');
  assert.ok(firmBills.length > 0, 'a shop was billed');
  for (const e of firmBills) {
    assert.equal(e.to, 'outside');
    const f = c.firms.find(f => f.wallet === e.from);
    if (f) assert.equal(c.buildings.find(b => b.id === f.building)!.zone, 'C', 'a mill pays its energy and water in its running costs and a farm irrigates free');
  }
  assert.equal(c.ledger.filter(e => /^Outside (power|water) supply$/.test(e.reason)).length, 0, 'the town buys nothing at the gateway');
  const raw = serialize(c); assert.deepEqual(deserialize(raw), c);
  // A shop bill paid to the town is not one the authorities sent.
  const forged = JSON.parse(raw), e = forged.ledger.findLast((x: { reason: string }) => x.reason === 'Monthly water and power bill');
  forged.accounts.outside -= e.amount; forged.accounts.treasury += e.amount; e.to = 'treasury';
  assert.throws(() => deserialize(JSON.stringify(forged)), 'a real-price shop bill paid to the town');
  // A city saved before still sells its water and power, and buys what it lacks at the gateway.
  const old = legacyPrices(createCity(61025)); for (let d = 0; d < 65; d++) { step(old); keepSupplied(old); }
  const oldBills = old.ledger.filter(e => e.reason === 'Monthly household water and power bill' || e.reason === 'Monthly water and power bill');
  assert.ok(oldBills.length > 0 && oldBills.every(e => e.to === 'treasury'));
});
