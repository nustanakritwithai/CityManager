import test from 'node:test';
import assert from 'node:assert/strict';
import {
  allocateEmployment, OCCUPATION_BY_ZONE, EMPLOYMENT_RANKS,
  type EmploymentAllocation, type LaborHousehold, type LaborOffer,
} from '../src/labor.ts';

const household = (id: number, workforce = 1, accessible = true): LaborHousehold => ({ id, workforce, accessible });
const offer = (id: number, slots = 1, budgetWorkers = slots, zone: 'I' | 'C' = 'I'): LaborOffer => ({ id, slots, budgetWorkers, zone });
const job = (householdId: number, firmId: number, workers = 1, occupation: 'manufacturing' | 'retail' = 'manufacturing'): EmploymentAllocation => ({
  householdId, firmId, workers, occupation, rank: 'entry',
});
const workersForHousehold = (jobs: EmploymentAllocation[], id: number) => jobs.filter(j => j.householdId === id).reduce((n, j) => n + j.workers, 0);
const workersForFirm = (jobs: EmploymentAllocation[], id: number) => jobs.filter(j => j.firmId === id).reduce((n, j) => n + j.workers, 0);

test('one family can split whole workers across manufacturing and retail establishments', () => {
  assert.deepEqual(OCCUPATION_BY_ZONE, { I: 'manufacturing', C: 'retail' });
  assert.deepEqual(EMPLOYMENT_RANKS, ['entry']);
  assert.deepEqual(allocateEmployment([household(1, 3)], [offer(8, 2), offer(9, 2, 2, 'C')], []), [
    job(1, 8, 2), job(1, 9, 1, 'retail'),
  ]);
});

test('valid prior jobs survive new lower-ID vacancies and new lower-ID households', () => {
  assert.deepEqual(allocateEmployment([household(2, 2), household(1)], [offer(8, 2), offer(3, 2)], [job(2, 8)]), [
    job(1, 3), job(2, 3), job(2, 8),
  ]);
});

test('workforce cannot be counted twice even with excessive or duplicated previous claims', () => {
  const households = [household(1, 3), household(2, 2)];
  const offers = [offer(4, 3), offer(5, 4, 4, 'C')];
  const jobs = allocateEmployment(households, offers, [job(1, 4, 2), job(1, 4, 2), job(1, 5, 3, 'retail'), job(2, 4, 3)]);
  assert.deepEqual(jobs, [job(1, 4, 3), job(2, 5, 2, 'retail')]);
  for (const h of households) assert.ok(workersForHousehold(jobs, h.id) <= h.workforce);
  for (const f of offers) assert.ok(workersForFirm(jobs, f.id) <= Math.min(f.slots, f.budgetWorkers));
  assert.equal(new Set(jobs.map(j => `${j.householdId}:${j.firmId}`)).size, jobs.length);
});

test('disconnected or zero-workforce households cannot retain jobs or take new ones', () => {
  assert.deepEqual(allocateEmployment([household(1, 4, false), household(2, 0), household(3, 2)], [offer(8, 8)], [job(1, 8, 4)]), [job(3, 8, 2)]);
});

test('capacity and funded-worker cuts clamp old jobs before filling other funded vacancies', () => {
  const jobs = allocateEmployment([household(1, 3), household(2, 3)], [offer(8, 5, 2), offer(9, 1, 5, 'C'), offer(10, 5, 0)], [
    job(2, 8, 3), job(1, 8, 3), job(2, 9, 3, 'retail'),
  ]);
  assert.deepEqual(jobs, [job(1, 8, 2), job(2, 9, 1, 'retail')]);
});

test('stale household/firm references and changed occupations are ignored explicitly', () => {
  assert.deepEqual(allocateEmployment([household(1, 2)], [offer(4, 2, 2, 'C'), offer(5)], [
    job(99, 5), job(1, 99), job(1, 4),
  ]), [job(1, 4, 2, 'retail')]);
});

test('input permutations yield identical canonical allocations including cuts', () => {
  const households = [household(5, 4), household(1, 2), household(3, 3)];
  const offers = [offer(7, 5, 3, 'C'), offer(2, 4), offer(9, 2)];
  const previous = [job(5, 7, 2, 'retail'), job(1, 2, 3), job(3, 2, 3), job(5, 7, 2, 'retail')];
  const expected = allocateEmployment(households, offers, previous);
  assert.deepEqual(allocateEmployment([...households].reverse(), [...offers].reverse(), [...previous].reverse()), expected);
  assert.deepEqual(allocateEmployment(households, offers, expected), expected);
});

test('allocation does not mutate caller arrays or frozen source records', () => {
  const households = Object.freeze([Object.freeze(household(1, 2))]);
  const offers = Object.freeze([Object.freeze(offer(4, 2))]);
  const previous = Object.freeze([Object.freeze(job(1, 4))]);
  const before = JSON.stringify({ households, offers, previous });
  const result = allocateEmployment(households, offers, previous);
  assert.deepEqual(result, [job(1, 4, 2)]);
  result[0].workers = 0;
  assert.equal(JSON.stringify({ households, offers, previous }), before);
});

test('empty, unavailable and exhausted sets have no phantom allocations', () => {
  assert.deepEqual(allocateEmployment([], [], []), []);
  assert.deepEqual(allocateEmployment([], [offer(1, 9)], [job(3, 1)]), []);
  assert.deepEqual(allocateEmployment([household(1, 9)], [], [job(1, 3)]), []);
  assert.deepEqual(allocateEmployment([household(1, 9)], [offer(3, 0, 9), offer(4, 9, 0)], []), []);
});

test('unsafe, fractional, negative and malformed entities are rejected', () => {
  for (const value of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => allocateEmployment([household(1, value)], [], []), RangeError);
    assert.throws(() => allocateEmployment([], [offer(1, value)], []), RangeError);
    assert.throws(() => allocateEmployment([], [offer(1, 1, value)], []), RangeError);
    assert.throws(() => allocateEmployment([], [], [job(1, 1, value)]), RangeError);
  }
  assert.throws(() => allocateEmployment([household(0)], [], []), RangeError);
  assert.throws(() => allocateEmployment([], [offer(0)], []), RangeError);
  assert.throws(() => allocateEmployment([], [], [job(1, 1, 0)]), RangeError);
  assert.throws(() => allocateEmployment([household(1), household(1)], [], []), /Duplicate household/);
  assert.throws(() => allocateEmployment([], [offer(1), offer(1)], []), /Duplicate firm/);
  assert.throws(() => allocateEmployment([{ ...household(1), accessible: 1 } as unknown as LaborHousehold], [], []), /accessible/);
  assert.throws(() => allocateEmployment([], [{ ...offer(1), zone: 'R' } as unknown as LaborOffer], []), /zone/);
  assert.throws(() => allocateEmployment([], [], [{ ...job(1, 1), rank: 'senior' } as unknown as EmploymentAllocation]), /rank/);
  assert.throws(() => allocateEmployment([], [], [{ ...job(1, 1), occupation: 'unknown' } as unknown as EmploymentAllocation]), /occupation/);
  assert.throws(() => allocateEmployment([null as unknown as LaborHousehold], [], []), TypeError);
  assert.throws(() => allocateEmployment([], [null as unknown as LaborOffer], []), TypeError);
  assert.throws(() => allocateEmployment([], [], [null as unknown as EmploymentAllocation]), TypeError);
  assert.throws(() => allocateEmployment(null as unknown as LaborHousehold[], [], []), TypeError);
});

test('sparse large worker counts use whole counts and remain exact at safe-integer limits', () => {
  const large = 1_000_000_000_000;
  assert.deepEqual(allocateEmployment([household(101, large), household(9001, large)], [offer(8, large - 1), offer(60, large + 1)], []), [
    job(101, 8, large - 1), job(101, 60, 1), job(9001, 60, large),
  ]);
  const max = Number.MAX_SAFE_INTEGER;
  assert.deepEqual(allocateEmployment([household(1, max)], [offer(9, max)], [job(1, 9, max), job(1, 9, max)]), [job(1, 9, max)]);
});
