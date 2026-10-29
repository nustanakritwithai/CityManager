import test from 'node:test';
import assert from 'node:assert/strict';
import { periodDemand, demandForPeriods, totalVehicles, HOURLY_PROFILE } from '../src/traffic/demand.ts';
import { PEOPLE_PER_VEHICLE, type DemandInput } from '../src/traffic/types.ts';

const city: DemandInput = {
  households: [{ cell: 10, amount: 300 }, { cell: 50, amount: 200 }],
  jobs: [{ cell: 100, amount: 400 }], schoolSeats: [{ cell: 200, amount: 80 }],
  parks: [{ cell: 300, amount: 1 }], freight: [{ cell: 100, amount: 120 }], entrance: 0,
};
test('profiles sum to one and 1 vehicle = 10 people', () => {
  assert.equal(PEOPLE_PER_VEHICLE, 10);
  for (const p of Object.values(HOURLY_PROFILE)) assert.ok(Math.abs(p.reduce((a, b) => a + b, 0) - 1) < 1e-9);
});
test('deterministic, integer vehicles', () => {
  const a = periodDemand(city, 7), b = periodDemand(city, 7);
  assert.deepEqual(a, b);
  for (const e of a.od) assert.ok(Number.isInteger(e.vehicles) && e.vehicles > 0);
});
test('AM peak goes home->work, PM peak returns', () => {
  const am = periodDemand(city, 7).od.filter(e => e.purpose === 'commute');
  const pm = periodDemand(city, 17).od.filter(e => e.purpose === 'commute');
  assert.ok(am.every(e => e.to === 100) && am.length);
  assert.ok(pm.every(e => e.from === 100) && pm.length);
  assert.ok(totalVehicles(am) > totalVehicles(periodDemand(city, 3).od, 'commute'));
});
test('full day conserves trips with fractional carry (no double counting)', () => {
  const day = demandForPeriods(city, 0, 24);
  const commute = day.reduce((a, r) => a + totalVehicles(r.od, 'commute'), 0);
  // 400 workers * 2 trips / 10 = 80 vehicles; carry keeps at most <1 per OD key.
  assert.ok(commute <= 80 && commute >= 78, String(commute));
  const twoDays = demandForPeriods(city, 0, 48);
  const c2 = twoDays.reduce((a, r) => a + totalVehicles(r.od, 'commute'), 0);
  assert.ok(c2 <= 160 && c2 >= 158, String(c2));
});
test('freight flows via the entrance; empty city has no demand', () => {
  const f = periodDemand(city, 10).od.filter(e => e.purpose === 'freight');
  assert.ok(f.every(e => e.from === 0 || e.to === 0));
  const none = periodDemand({ households: [], jobs: [], schoolSeats: [], parks: [], freight: [], entrance: 0 }, 8);
  assert.deepEqual(none.od, []);
});
