import { strict as assert } from 'node:assert';
import { isCommercial, type City } from '../src/sim.ts';

/** Recorded cash stress before the session checkpoint gives the monthly AI
 * path a real contribution choice. Fully paid monthly profits now correctly
 * offer hold, not a second withdrawal of the development reserve. */
export function stressOwnerCash(city: City) {
  const firm = city.firms.find(f => isCommercial(f) && f.owner !== null)!;
  // At day 209 this seeded firm has two paid employees, each with 29
  // accrued days. Preserve both earned payroll and one more day (60 × 1,400)
  // so settlement can pay in full; this leaves a real subsequent shortfall.
  assert.equal(city.tick, 209);
  assert.equal(Object.values(firm.workDays).reduce((a,b) => a+b,0),58);
  assert.equal(city.employment.filter(e => e.firmId === firm.id).reduce((a,e) => a+e.workers,0),2);
  const protectedPayroll = (58 + 2) * 1_400;
  const amount = city.accounts[firm.wallet] - protectedPayroll;
  assert.ok(amount > 0);
  city.accounts[firm.wallet] -= amount; city.accounts.landlord += amount;
  city.ledger.push({ tick: city.tick, from: firm.wallet, to: 'landlord', amount, reason: 'Synthetic reserve-boundary fixture' });
}
