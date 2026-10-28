import test from 'node:test';
import assert from 'node:assert/strict';
import {
  allocateEmployment, OCCUPATION_BY_ZONE, EMPLOYMENT_RANKS, WORKER_SKILLS, skillEligible, validateWorkerSkills,
  type EmploymentAllocation, type LaborHousehold, type LaborOffer, type WorkerSkill, type WorkerSkills,
} from '../src/labor.ts';

const skills = (general = 0, manufacturing = 0, retail = 0): WorkerSkills => ({ general, manufacturing, retail });
const household = (id: number, workforce = 1, accessible = true, workerSkills = skills(workforce)): LaborHousehold => ({ id, workforce, workerSkills, accessible });
const offer = (id: number, slots = 1, budgetWorkers = slots, zone: 'I' | 'C' = 'I'): LaborOffer => ({ id, slots, budgetWorkers, zone });
const job = (householdId: number, firmId: number, workers = 1, occupation: 'manufacturing' | 'retail' = 'manufacturing', skill: WorkerSkill = 'general'): EmploymentAllocation => ({ householdId, firmId, workers, occupation, rank: 'entry', skill });
const workersForHousehold = (jobs: EmploymentAllocation[], id: number) => jobs.filter(j => j.householdId === id).reduce((n, j) => n + j.workers, 0);
const workersForFirm = (jobs: EmploymentAllocation[], id: number) => jobs.filter(j => j.firmId === id).reduce((n, j) => n + j.workers, 0);
function invariant(hs: LaborHousehold[], fs: LaborOffer[], jobs: EmploymentAllocation[]): void {
  for (const h of hs) {
    assert.ok(workersForHousehold(jobs, h.id) <= (h.accessible ? h.workforce : 0));
    for (const skill of WORKER_SKILLS) assert.ok(jobs.filter(j => j.householdId === h.id && j.skill === skill).reduce((n, j) => n + j.workers, 0) <= h.workerSkills[skill]);
  }
  for (const f of fs) assert.ok(workersForFirm(jobs, f.id) <= Math.min(f.slots, f.budgetWorkers));
  for (const j of jobs) {
    assert.ok(Number.isSafeInteger(j.workers) && j.workers > 0);
    assert.ok(hs.some(h => h.id === j.householdId) && fs.some(f => f.id === j.firmId));
    assert.ok(skillEligible(j.skill, j.occupation));
  }
  assert.equal(new Set(jobs.map(j => j.householdId + ':' + j.firmId + ':' + j.skill)).size, jobs.length);
}

test('actual two-worker matching splits factory/shop rather than greedily hiring an entire family', () => {
  const hs = [household(1, 2)], fs = [offer(8, 3), offer(9, 3, 3, 'C')];
  const expected = [job(1, 8), job(1, 9, 1, 'retail')];
  assert.deepEqual(allocateEmployment(hs, fs, []), expected);
  assert.deepEqual(allocateEmployment(hs, fs, [job(1, 8, 2)]), expected, 'Existing concentration also rebalances into a real vacancy');
  assert.deepEqual(allocateEmployment(hs, fs, expected), expected);
});

test('explicit exclusive skill groups enter only their eligible occupation', () => {
  assert.deepEqual(OCCUPATION_BY_ZONE, { I: 'manufacturing', C: 'retail', P: 'park-maintenance' });
  assert.deepEqual(EMPLOYMENT_RANKS, ['entry']);
  assert.deepEqual(WORKER_SKILLS, ['general', 'manufacturing', 'retail']);
  const hs = [household(1, 2, true, skills(0, 1, 1))], fs = [offer(8, 5), offer(9, 5, 5, 'C')];
  assert.deepEqual(allocateEmployment(hs, fs, []), [job(1, 8, 1, 'manufacturing', 'manufacturing'), job(1, 9, 1, 'retail', 'retail')]);
  assert.deepEqual(allocateEmployment(hs, [offer(8, 5)], []), [job(1, 8, 1, 'manufacturing', 'manufacturing')], 'Retail worker remains unemployed instead of taking an incompatible job');
});

test('specialist precedence prevents avoidable unemployment even when a general worker held that role', () => {
  const hs = [household(1), household(2, 1, true, skills(0, 1))], fs = [offer(8), offer(9, 1, 1, 'C')];
  assert.deepEqual(allocateEmployment(hs, fs, [job(1, 8)]), [job(1, 9, 1, 'retail'), job(2, 8, 1, 'manufacturing', 'manufacturing')]);
});

test('diversification never dismisses another household from a full workplace', () => {
  const hs = [household(1, 2), household(2)], prior = [job(1, 8, 2), job(2, 9, 1, 'retail')];
  assert.deepEqual(allocateEmployment(hs, [offer(8, 2), offer(9, 1, 1, 'C')], prior), prior);
  assert.deepEqual(allocateEmployment(hs, [offer(8, 2), offer(9, 2, 2, 'C')], prior), [job(1, 8), job(1, 9, 1, 'retail'), job(2, 9, 1, 'retail')]);
});

test('a mixed family can release a general worker while its specialist stays at the source firm', () => {
  const hs = [household(1, 2, true, skills(1, 1))], fs = [offer(8, 2), offer(9, 2, 2, 'C')];
  assert.deepEqual(allocateEmployment(hs, fs, [job(1, 8), job(1, 8, 1, 'manufacturing', 'manufacturing')]), [
    job(1, 8, 1, 'manufacturing', 'manufacturing'), job(1, 9, 1, 'retail'),
  ]);
});

test('one employer and incompatible alternatives do not force fictional diversity', () => {
  assert.deepEqual(allocateEmployment([household(1, 2)], [offer(8, 5)], []), [job(1, 8, 2)]);
  assert.deepEqual(allocateEmployment([household(1, 2, true, skills(0, 2))], [offer(8, 5), offer(9, 5, 5, 'C')], []), [job(1, 8, 2, 'manufacturing', 'manufacturing')]);
});

test('valid scarce prior jobs survive new lower-ID households and vacancies', () => {
  const hs = [household(2), household(1)];
  assert.deepEqual(allocateEmployment(hs, [offer(8), offer(3)], [job(2, 8)]), [job(1, 3), job(2, 8)]);
});

test('cuts and duplicate prior triples obey pool, household, budget and establishment limits', () => {
  const hs = [household(1, 3, true, skills(1, 1, 1)), household(2, 2)], fs = [offer(4, 3, 2), offer(5, 3, 1, 'C')];
  const jobs = allocateEmployment(hs, fs, [job(1, 4, 5, 'manufacturing', 'manufacturing'), job(1, 4, 5, 'manufacturing', 'manufacturing'), job(1, 5, 3, 'retail', 'retail'), job(2, 4, 3)]);
  invariant(hs, fs, jobs);
  assert.equal(workersForFirm(jobs, 4), 2); assert.equal(workersForFirm(jobs, 5), 1);
  assert.equal(jobs.filter(j => j.skill === 'manufacturing').reduce((n, j) => n + j.workers, 0), 1);
});

test('dismissal, disconnected homes, zero workforce and unfunded jobs release allocations without phantom workers', () => {
  const hs = [household(1, 2, false), household(2, 0), household(3, 2)];
  assert.deepEqual(allocateEmployment(hs, [offer(8, 8)], [job(1, 8, 2)]), [job(3, 8, 2)]);
  assert.deepEqual(allocateEmployment(hs, [], [job(3, 8, 2)]), []);
  assert.deepEqual(allocateEmployment(hs, [offer(8, 8, 0)], [job(3, 8, 2)]), []);
});

test('stale IDs, changed occupations and incompatible skill claims are ignored, not fabricated', () => {
  const hs = [household(1, 2, true, skills(1, 1))], fs = [offer(4, 2, 2, 'C')];
  assert.deepEqual(allocateEmployment(hs, fs, [job(99, 4, 1, 'retail'), job(1, 99), job(1, 4), job(1, 4, 1, 'retail', 'manufacturing')]), [job(1, 4, 1, 'retail')]);
});

test('newly freed capacities propagate to a stable edge allocation in the same call', () => {
  const hs = [household(1, 3), household(2, 2)], fs = [offer(4, 3), offer(5, 2, 2, 'C'), offer(6)];
  const jobs = allocateEmployment(hs, fs, [job(1, 4, 3), job(2, 5, 2, 'retail')]);
  assert.deepEqual(jobs, [job(1, 4), job(1, 5, 1, 'retail'), job(1, 6), job(2, 4), job(2, 5, 1, 'retail')]);
  assert.deepEqual(allocateEmployment(hs, fs, jobs), jobs);
});

test('input permutations and repeated allocation preserve canonical deterministic matching', () => {
  const hs = [household(5, 4, true, skills(2, 1, 1)), household(1, 2), household(3, 3, true, skills(1, 2))];
  const fs = [offer(7, 5, 3, 'C'), offer(2, 4), offer(9, 2)];
  const prior = [job(5, 7, 2, 'retail'), job(1, 2, 3), job(3, 2, 3), job(5, 7, 2, 'retail')];
  const expected = allocateEmployment(hs, fs, prior);
  assert.deepEqual(allocateEmployment([...hs].reverse(), [...fs].reverse(), [...prior].reverse()), expected);
  assert.deepEqual(allocateEmployment(hs, fs, expected), expected); invariant(hs, fs, expected);
});

test('frozen input arrays, worker pools and prior records are never mutated', () => {
  const hs = Object.freeze([Object.freeze({ ...household(1, 2), workerSkills: Object.freeze(skills(2)) })]);
  const fs = Object.freeze([Object.freeze(offer(4, 3)), Object.freeze(offer(5, 3, 3, 'C'))]), prior = Object.freeze([Object.freeze(job(1, 4, 2))]);
  const before = JSON.stringify({ hs, fs, prior }), result = allocateEmployment(hs, fs, prior);
  result[0].workers = 0; assert.equal(JSON.stringify({ hs, fs, prior }), before);
});

test('empty or exhausted entity sets return no allocations', () => {
  assert.deepEqual(allocateEmployment([], [], []), []);
  assert.deepEqual(allocateEmployment([], [offer(1, 9)], [job(3, 1)]), []);
  assert.deepEqual(allocateEmployment([household(1, 9)], [], [job(1, 3)]), []);
  assert.deepEqual(allocateEmployment([household(1, 9)], [offer(3, 0, 9), offer(4, 9, 0)], []), []);
});

test('malformed disjoint skill pools, IDs and claims are rejected explicitly', () => {
  for (const bad of [-1, .5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => allocateEmployment([household(1, bad)], [], []), RangeError);
    assert.throws(() => allocateEmployment([], [offer(1, bad)], []), RangeError);
    assert.throws(() => allocateEmployment([], [offer(1, 1, bad)], []), RangeError);
    assert.throws(() => allocateEmployment([], [], [job(1, 1, bad)]), RangeError);
    assert.throws(() => allocateEmployment([household(1, 1, true, skills(bad))], [], []), RangeError);
  }
  assert.throws(() => validateWorkerSkills(skills(1, 1), 1), /sum exactly/);
  assert.throws(() => validateWorkerSkills(skills(0), 1), /sum exactly/);
  assert.throws(() => validateWorkerSkills({ general: 1, manufacturing: 0 } as WorkerSkills, 1), /exactly/);
  assert.throws(() => validateWorkerSkills({ ...skills(1), extra: 0 } as WorkerSkills, 1), /exactly/);
  assert.throws(() => allocateEmployment([household(0)], [], []), RangeError);
  assert.throws(() => allocateEmployment([], [offer(0)], []), RangeError);
  assert.throws(() => allocateEmployment([], [], [job(1, 1, 0)]), RangeError);
  assert.throws(() => allocateEmployment([household(1), household(1)], [], []), /Duplicate household/);
  assert.throws(() => allocateEmployment([], [offer(1), offer(1)], []), /Duplicate firm/);
  assert.throws(() => allocateEmployment([{ ...household(1), accessible: 1 } as unknown as LaborHousehold], [], []), /accessible/);
  assert.throws(() => allocateEmployment([], [{ ...offer(1), zone: 'R' } as unknown as LaborOffer], []), /zone/);
  assert.throws(() => allocateEmployment([], [], [{ ...job(1, 1), rank: 'senior' } as unknown as EmploymentAllocation]), /rank/);
  assert.throws(() => allocateEmployment([], [], [{ ...job(1, 1), occupation: 'unknown' } as unknown as EmploymentAllocation]), /occupation/);
  assert.throws(() => allocateEmployment([], [], [{ ...job(1, 1), skill: 'unknown' } as unknown as EmploymentAllocation]), /skill/);
  assert.throws(() => allocateEmployment([null as unknown as LaborHousehold], [], []), TypeError);
  assert.throws(() => allocateEmployment([], [null as unknown as LaborOffer], []), TypeError);
  assert.throws(() => allocateEmployment([], [], [null as unknown as EmploymentAllocation]), TypeError);
  assert.throws(() => allocateEmployment(null as unknown as LaborHousehold[], [], []), TypeError);
});

test('trillion-count matching and MAX_SAFE_INTEGER duplicates use arithmetic instead of resident loops', () => {
  const large = 1_000_000_000_000;
  assert.deepEqual(allocateEmployment([household(101, large), household(9001, large)], [offer(8, large - 1), offer(60, large + 1)], []), [
    job(101, 8, large - 1), job(101, 60, 1), job(9001, 60, large),
  ]);
  const max = Number.MAX_SAFE_INTEGER;
  assert.deepEqual(allocateEmployment([household(1, max)], [offer(9, max)], [job(1, 9, max), job(1, 9, max)]), [job(1, 9, max)]);
  assert.deepEqual(allocateEmployment([household(1, large)], [offer(4, large), offer(5, large, large, 'C')], [job(1, 4, large)]), [job(1, 4, large / 2), job(1, 5, large / 2, 'retail')]);
});

test('bounded deterministic cases attain the known eligible-employment maximum and remain idempotent', () => {
  let rng = 61025;
  const n = (limit: number) => { rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0; return rng % limit; };
  for (let run = 0; run < 120; run++) {
    const hs = Array.from({ length: 1 + n(5) }, (_, i) => { const s = skills(n(4), n(4), n(4)); return household(i + 1, s.general + s.manufacturing + s.retail, n(5) !== 0, s); });
    const fs = Array.from({ length: 1 + n(5) }, (_, i) => offer(20 + i, n(7), n(7), n(2) ? 'I' : 'C'));
    const jobs = allocateEmployment(hs, fs, []);
    invariant(hs, fs, jobs);
    const capacity = (zone: string) => fs.filter(f => f.zone === zone).reduce((sum, f) => sum + Math.min(f.slots, f.budgetWorkers), 0);
    const supply = (skill: WorkerSkill) => hs.filter(h => h.accessible).reduce((sum, h) => sum + h.workerSkills[skill], 0);
    const restricted = Math.min(supply('manufacturing'), capacity('I')) + Math.min(supply('retail'), capacity('C'));
    assert.equal(jobs.reduce((sum, j) => sum + j.workers, 0), restricted + Math.min(supply('general'), capacity('I') + capacity('C') - restricted));
    assert.deepEqual(allocateEmployment(hs, fs, jobs), jobs, 'Stable result for case ' + run);
    assert.deepEqual(allocateEmployment([...hs].reverse(), [...fs].reverse(), []), jobs);
  }
});
