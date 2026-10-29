import test from 'node:test';
import assert from 'node:assert/strict';
import { periodDemand, demandForPeriods, totalVehicles, HOURLY_PROFILE } from '../src/traffic/demand.ts';
import { PEOPLE_PER_VEHICLE, type DemandCarry, type DemandInput, type DemandResult } from '../src/traffic/types.ts';

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

function assertConserved(results: DemandResult[], key: string, expected: number) {
  const [purpose, from, to] = key.split(':');
  const emitted = results.flatMap(r => r.od).filter(e => e.purpose === purpose && e.from === +from && e.to === +to)
    .reduce((sum, e) => sum + e.vehicles, 0);
  const remainder = results.at(-1)!.carry[key] ?? 0;
  assert.equal(emitted, Math.floor(expected + 1e-9), key);
  assert.ok(Math.abs(emitted + remainder - expected) < 1e-9, `${key}: ${emitted} + ${remainder} != ${expected}`);
}

test('commute and school each allocate half the daily trips to each direction', () => {
  const input: DemandInput = { households: [{ cell: 0, amount: 10000 }], jobs: [{ cell: 6, amount: 10000 }],
    schoolSeats: [{ cell: 8, amount: 10000 }], parks: [], freight: [], entrance: 24 };
  const day = demandForPeriods(input, 0, 24);
  for (const [purpose, destination, representatives] of [['commute', 6, 1000], ['school', 8, 200]] as const) {
    assertConserved(day, `${purpose}:0:${destination}`, representatives);
    assertConserved(day, `${purpose}:${destination}:0`, representatives);
    assert.ok(Math.abs(HOURLY_PROFILE[purpose].slice(0, 12).reduce((sum, n) => sum + n, 0) - .5) < 1e-9);
  }
});

test('fractional demand conserves every direction and origin across days', () => {
  const input: DemandInput = { households: [{ cell: 0, amount: 17 }, { cell: 1, amount: 8 }],
    jobs: [{ cell: 6, amount: 13 }], schoolSeats: [{ cell: 8, amount: 3 }], parks: [], freight: [], entrance: 24 };
  const week = demandForPeriods(input, 0, 24 * 7);
  for (const home of input.households) {
    for (const [purpose, destination, people] of [['commute', 6, 13], ['school', 8, 3]] as const) {
      const expected = 7 * people * home.amount / 25 / PEOPLE_PER_VEHICLE;
      assertConserved(week, `${purpose}:${home.cell}:${destination}`, expected);
      assertConserved(week, `${purpose}:${destination}:${home.cell}`, expected);
    }
  }
  const split = [...demandForPeriods(input, 0, 24), ...demandForPeriods(input, 24, 24 * 6, week[23].carry)];
  assert.deepEqual(split, week);
});

test('empty demand preserves fractional carry without emitting vehicles', () => {
  const input: DemandInput = { households: [], jobs: [], schoolSeats: [], parks: [], freight: [], entrance: 24 };
  const carry: DemandCarry = { 'commute:0:6': .7, 'commute:6:0': .7, 'school:0:8': .1, 'school:8:0': .1 };
  const before = { ...carry };
  for (const result of demandForPeriods(input, 0, 48, carry)) {
    assert.deepEqual(result.od, []);
    assert.deepEqual(result.carry, before);
  }
  assert.deepEqual(carry, before);
});

test('changing residents, jobs and seats adds only the available daily demand', () => {
  let carry: DemandCarry = {};
  const results: DemandResult[] = [];
  // Workers per day: 7, 0, 2, 11; pupils: 1, 0, .4, 4.
  for (const [residents, jobs, seats] of [[13, 7, 1], [0, 100, 100], [2, 100, 100], [25, 11, 4]]) {
    const day = demandForPeriods({ households: [{ cell: 0, amount: residents }], jobs: [{ cell: 6, amount: jobs }],
      schoolSeats: [{ cell: 8, amount: seats }], parks: [], freight: [], entrance: 24 }, 0, 24, carry);
    results.push(...day);
    carry = day.at(-1)!.carry;
  }
  for (const key of ['commute:0:6', 'commute:6:0']) assertConserved(results, key, 2);
  for (const key of ['school:0:8', 'school:8:0']) assertConserved(results, key, .54);
  assert.ok(results.slice(24, 48).every(r => r.od.length === 0));
});
