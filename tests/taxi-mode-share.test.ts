import test from 'node:test';
import assert from 'node:assert/strict';
import { splitTaxiDemand, taxiShare, taxiFareSatang } from '../src/taxi/mode-share.ts';
import { TAXI_ENABLED, TAXI_AVAILABILITY_CAP, type TaxiCarry } from '../src/taxi/types.ts';
import { demandForPeriods } from '../src/traffic/demand.ts';
import type { DemandInput, OdEntry } from '../src/traffic/types.ts';

const base = { carMinutes: 10, taxiMinutes: 10, waitMinutes: 5, km: 3 };
test('flag defaults on', () => assert.equal(TAXI_ENABLED, true));
test('share stays within [0, cap] and fare is integer satang', () => {
  for (const car of [0, 5, 30, 300]) for (const wait of [0, 20, 200]) { const p = taxiShare({ ...base, carMinutes: car, waitMinutes: wait }); assert.ok(p >= 0 && p <= TAXI_AVAILABILITY_CAP); }
  assert.ok(Number.isInteger(taxiFareSatang(2.37, 7.1)));
  assert.equal(taxiShare({ ...base, waitMinutes: Infinity }), 0);
});
test('share falls with wait and fare, rises with car time', () => {
  assert.ok(taxiShare({ ...base, waitMinutes: 2 }) > taxiShare({ ...base, waitMinutes: 15 }));
  assert.ok(taxiShare(base, 1_000) > taxiShare(base, 20_000));
  assert.ok(taxiShare({ ...base, carMinutes: 40 }) > taxiShare({ ...base, carMinutes: 10 }));
});
const od: OdEntry[] = [
  { purpose: 'commute', from: 10, to: 100, vehicles: 7 }, { purpose: 'school', from: 10, to: 200, vehicles: 3 },
  { purpose: 'park', from: 50, to: 300, vehicles: 1 }, { purpose: 'freight', from: 0, to: 100, vehicles: 9 }];
test('freight never uses taxi; school allowed; people conserved and whole', () => {
  const s = splitTaxiDemand(od, () => ({ ...base, carMinutes: 60 }));
  assert.ok(!s.taxi.some(t => t.purpose === 'freight'));
  assert.ok(s.taxi.some(t => t.purpose === 'school'));
  assert.equal(s.taxiPersons + s.roadPersons.reduce((n, r) => n + r.persons, 0), s.offeredPersons);
  for (const t of s.taxi) { assert.ok(Number.isInteger(t.persons) && t.persons > 0); const off = od.find(e => e.purpose === t.purpose && e.from === t.from)!; assert.ok(t.persons <= Math.ceil(off.vehicles * 10 * TAXI_AVAILABILITY_CAP)); }
});
test('no taxi offered (null cost) keeps everyone on the road', () => {
  const s = splitTaxiDemand(od, () => null);
  assert.equal(s.taxiPersons, 0); assert.deepEqual(s.carry, {});
});
test('deterministic regardless of input order', () => {
  const f = () => ({ ...base, carMinutes: 25 });
  assert.deepEqual(splitTaxiDemand(od, f), splitTaxiDemand([...od].reverse(), f));
});
test('fractional carry: 1x and 10x batching give identical taxi totals over a day', () => {
  const city: DemandInput = { households: [{ cell: 10, amount: 130 }, { cell: 50, amount: 70 }], jobs: [{ cell: 100, amount: 150 }], schoolSeats: [{ cell: 200, amount: 20 }], parks: [{ cell: 300, amount: 1 }], freight: [{ cell: 100, amount: 40 }], entrance: 0 };
  const cost = () => ({ ...base, carMinutes: 18 });
  const run = (chunks: number[]) => {
    let carry: TaxiCarry = {}, hour = 0, total = 0, offered = 0, dc = {};
    for (const n of chunks) for (const r of demandForPeriods(city, hour, n, dc)) { dc = r.carry; const s = splitTaxiDemand(r.od, cost, carry); carry = s.carry; total += s.taxiPersons; offered += s.offeredPersons; hour++; }
    return { total, offered, carry };
  };
  const slow = run(Array(24).fill(1)), fast = run([10, 10, 4]);
  assert.deepEqual(fast, slow);
  assert.ok(slow.total > 0 && slow.total <= slow.offered * TAXI_AVAILABILITY_CAP + 1);
});
