import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCampus, createCity, deserialize, householdWorkerCount, serialize, step, toggleCampus, upgradeCampus, type City } from '../src/sim.ts';
import { assertEducationInvariants, createEducation, EDUCATION_COST, educationOccupied, initialCampusReport, stepEducation, withdrawCampus, type CampusKind, type EducationPeople, type EducationView } from '../src/education.ts';
import { marketJournalForTest } from '../src/market-client.ts';
import { createParkRuntime, serializeParkSession } from '../src/park-runtime.ts';
import { restoreStartupCity } from '../src/startup-save.ts';
import { SAVE_KEY } from '../src/save-storage.ts';

const person = (householdId: number, values: Partial<EducationPeople> = {}): EducationPeople => ({ householdId, basic: 0, higher: 0, school: 0, university: 0, teacher: 0, professor: 0, campusId: null, progress: 0, ...values });
function fixture(kind: CampusKind, localStaff: number, treasury: number) {
  const state = createEducation('new-city');
  const campus = { id: 1, kind, cell: 265, level: 2 as const, tick: 0, open: true, contract: 0 as const, workDays: {}, report: initialCampusReport(kind, 2) };
  state.campuses.push(campus);
  const staff = Array.from({ length: localStaff }, (_, index) => person(index + 1, { basic: 1, higher: kind === 'university' ? 1 : 0, [kind === 'school' ? 'teacher' : 'professor']: 1, campusId: campus.id }));
  // Explicit synthetic qualifications isolate capacity; the full-city test below
  // starts with no diplomas and verifies natural graduation separately.
  const learners = Array.from({ length: 20 }, (_, index) => person(index + 10, { basic: kind === 'university' ? 1 : 0 }));
  state.people = [...staff, ...learners];
  state.residentBasic = state.people.reduce((n, row) => n + row.basic, 0);
  state.residentHigher = state.people.reduce((n, row) => n + row.higher, 0);
  const view: EducationView = { tick: 1, households: state.people.map(row => ({ id: row.householdId, workforce: 1, wallet: `household:${row.householdId}`, ownsFirm: false })), buildings: [], posts: [], road: () => true, sparePower: 20, spareWater: 20, treasury };
  assertEducationInvariants(state, view.households);
  return { state, campus, view };
}

for (const kind of ['school', 'university'] as const) {
  test(`${kind}: expanded capacity follows zero, partial and full qualified staffing`, () => {
    const seatsPerStaff = kind === 'school' ? 8 : 4;
    for (const { local, budget, expectedStaff, contract } of [
      { local: 0, budget: 0, expectedStaff: 0, contract: 0 },
      { local: 0, budget: 100_000, expectedStaff: 1, contract: 1 },
      { local: 1, budget: kind === 'school' ? EDUCATION_COST.teacherDaily : EDUCATION_COST.professorDaily, expectedStaff: 1, contract: 0 },
      { local: 1, budget: 100_000, expectedStaff: 2, contract: 1 },
      { local: 2, budget: 100_000, expectedStaff: 2, contract: 0 },
    ]) {
      const { state, campus, view } = fixture(kind, local, budget);
      const payments = stepEducation(state, view);
      assert.equal(campus.report.operatingSeats, expectedStaff * seatsPerStaff, `${local} local, ${contract} contract`);
      assert.equal(campus.report.nominalSeats, seatsPerStaff * 2);
      assert.equal(campus.report.requiredStaff, 2);
      assert.equal(campus.report.localStaff, local);
      assert.equal(campus.report.contract, contract);
      assert.equal(campus.report.enrolled, expectedStaff * seatsPerStaff);
      assert.equal(campus.report.progressing, expectedStaff * seatsPerStaff);
      assert.equal(payments.reduce((n, p) => n + p.amount, 0), contract * (kind === 'school' ? EDUCATION_COST.contractTeacherDaily : EDUCATION_COST.contractProfessorDaily));
      assert.deepEqual(state.completed, { basic: 0, higher: 0 });
      assertEducationInvariants(state, view.households);
      for (const household of view.households) assert.ok(educationOccupied(state, household.id) <= household.workforce);
    }
  });

  test(`${kind}: partial service retains waiting progress and still requires open road-served utilities`, () => {
    const seats = kind === 'school' ? 8 : 4;
    const { state, campus, view } = fixture(kind, 0, 100_000);
    const role = kind === 'school' ? 'school' : 'university';
    // A previously full campus may have more enrolled learners than one teacher
    // can serve. Keep waiting cohorts intact; graduate only those taught today.
    for (const row of state.people.slice(0, seats * 2)) Object.assign(row, { [role]: 1, campusId: campus.id, progress: EDUCATION_COST[kind].studyDays - 1 });
    const held = structuredClone(state.people);
    for (const unavailable of ['closed', 'road', 'power', 'water']) {
      campus.open = unavailable !== 'closed';
      stepEducation(state, { ...view, road: () => unavailable !== 'road', sparePower: unavailable === 'power' ? 0 : 20, spareWater: unavailable === 'water' ? 0 : 20 });
      assert.equal(campus.report.operatingSeats, 0, unavailable);
      assert.deepEqual(state.people.filter(row => row[role] > 0), held.filter(row => row[role] > 0));
      assert.deepEqual(state.completed, { basic: 0, higher: 0 });
    }
    campus.open = true;
    stepEducation(state, view);
    assert.equal(campus.report.operatingSeats, seats);
    assert.equal(state.completed[kind === 'school' ? 'basic' : 'higher'], seats);
    const waiting = state.people.filter(row => row[role] > 0);
    assert.equal(waiting.length, seats);
    assert.ok(waiting.every(row => row.progress === EDUCATION_COST[kind].studyDays - 1));
    const resumed = structuredClone(state);
    stepEducation(state, view); stepEducation(resumed, view);
    assert.deepEqual(resumed, state);
    assert.equal(state.completed[kind === 'school' ? 'basic' : 'higher'], seats * 2);
    assertEducationInvariants(state, view.households);
  });
}

const checkCity = (city: City) => {
  assert.equal(Object.values(city.accounts).reduce((n, amount) => n + amount, 0), 0);
  for (const household of city.households) assert.ok(householdWorkerCount(city, household.id) <= household.workforce, `day ${city.tick}: household ${household.id}`);
};

for (const kind of ['school', 'university'] as const) {
  for (const lastDay of [false, true]) {
    test(`${kind}: a partial multi-person cohort keeps only the teaching days each learner earned (${lastDay ? 'graduation' : 'mid-course'})`, () => {
      const count = kind === 'school' ? 6 : 3;
      const seats = kind === 'school' ? 8 : 4;
      const role = kind === 'school' ? 'school' : 'university';
      const rank = kind === 'school' ? 'basic' : 'higher';
      const days = EDUCATION_COST[kind].studyDays;
      const progress = lastDay ? days - 1 : 10;
      const { state, campus, view } = fixture(kind, 0, 100_000);
      state.people = [1, 2].map(id => person(id, { [role]: count, basic: kind === 'university' ? count : 0, campusId: campus.id, progress }));
      state.residentBasic = kind === 'university' ? count * 2 : 0;
      view.households = state.people.map(row => ({ id: row.householdId, workforce: count + 1, wallet: `household:${row.householdId}`, ownsFirm: false }));
      const cohorts = (row: EducationPeople) => row.studyCohorts ?? [{ count: row[role], progress: row.progress }];
      const earned = () => state.people.reduce((sum, row) => sum + cohorts(row).reduce((n, group) => n + group.count * group.progress, 0), 0) + state.completed[rank] * days;
      assertEducationInvariants(state, view.households);
      const before = earned();
      stepEducation(state, view);
      assert.equal(campus.report.operatingSeats, seats);
      assert.equal(earned() - before, seats, 'exactly one attendance day per served learner; none credited to waiting learners');
      assert.equal(state.completed[rank], lastDay ? seats : 0);
      const waiting = state.people.find(row => row.householdId === 2)!;
      if (lastDay) {
        assert.equal(waiting[role], count * 2 - seats);
        assert.equal(waiting.progress, progress, 'partial graduation preserves every remaining learner\'s earned progress');
      } else {
        assert.deepEqual(cohorts(waiting).slice().sort((a, b) => a.progress - b.progress), [{ count: count * 2 - seats, progress }, { count: seats - count, progress: progress + 1 }]);
      }
      assertEducationInvariants(state, view.households);
      const persisted = JSON.stringify(state), resumed = JSON.parse(persisted);
      assertEducationInvariants(resumed, view.households);
      campus.open = false; resumed.campuses[0].open = false;
      const closed = state.people.map(row => structuredClone(cohorts(row)));
      stepEducation(state, view); stepEducation(resumed, view);
      assert.deepEqual(state.people.map(row => cohorts(row)), closed, 'closing pauses every subcohort');
      assert.deepEqual(resumed, state);
      campus.open = true; resumed.campuses[0].open = true;
      stepEducation(state, view); stepEducation(resumed, view);
      assert.deepEqual(resumed, state, 'serialized progress resumes deterministically without duplicate graduation');
      assertEducationInvariants(state, view.households);
      const completed = structuredClone(state.completed);
      withdrawCampus(state, campus.id);
      assert.ok(state.people.every(row => row.studyCohorts === undefined && row.progress === 0));
      assert.deepEqual(state.completed, completed, 'withdrawal removes study groups without deleting diplomas');
    });
  }
}

test('v22 preserves split study cohorts and rejects inconsistent saved attendance', () => {
  const city = createCity(3);
  assert.equal(buildCampus(city, 265, 'school').ok, true);
  for (let day = 0; day < 40; day++) step(city);
  const household = city.households.find(row => row.workforce === 2 && !city.firms.some(firm => firm.owner?.householdId === row.id))!;
  assert.ok(household);
  const learner = city.education!.people.find(row => row.householdId === household.id)!;
  // A legal two-person saved cohort with different earned attendance days.
  Object.assign(learner, { school: 2, progress: 10, studyCohorts: [{ count: 1, progress: 11 }, { count: 1, progress: 10 }] });
  const raw = serialize(city), restored = deserialize(raw);
  assert.deepEqual(restored.education, city.education);
  assert.deepEqual(restored.accounts, city.accounts);
  assert.deepEqual(restored.households, city.households);
  assert.equal(JSON.parse(raw).version, 22);
  const again = deserialize(serialize(restored));
  step(restored); step(again);
  assert.deepEqual(again.education, restored.education);
  assert.deepEqual(again.accounts, restored.accounts);
  for (const bad of [
    [], [{ count: 2, progress: 11 }], [{ count: 0, progress: 11 }, { count: 2, progress: 10 }],
    [{ count: 1, progress: 10 }, { count: 1, progress: 10 }],
    [{ count: 1, progress: 60 }, { count: 1, progress: 10 }],
    [{ count: 1, progress: 11 }, { count: 2, progress: 10 }],
    [{ count: 1, progress: 11.5 }, { count: 1, progress: 10 }],
  ]) {
    const invalid = JSON.parse(raw);
    invalid.education.people.find((row: EducationPeople) => row.householdId === household.id).studyCohorts = bad;
    assert.throws(() => deserialize(JSON.stringify(invalid)), /study cohort/i);
  }
});

test('seed 3 early school expansion keeps teaching until natural graduates can staff it', () => {
  const firstGraduation: number[] = [];
  for (const expanded of [false, true]) {
    const city = createCity(3);
    assert.equal(buildCampus(city, 265, 'school').ok, true);
    const campus = city.education!.campuses[0];
    if (expanded) {
      const before = city.accounts.treasury;
      assert.equal(upgradeCampus(city, campus.id).ok, true);
      assert.equal(before - city.accounts.treasury, EDUCATION_COST.school.upgrade);
    }
    assert.equal(city.education!.residentBasic, 0);
    let first = 0, staffedFully = false;
    for (let day = 0; day < 90; day++) {
      step(city); checkCity(city);
      if (city.tick === 1) assert.equal(campus.report.operatingSeats, 8);
      if (!first && city.education!.completed.basic > 0) first = city.tick;
      if (campus.report.localStaff > 0 && campus.report.operatingSeats === 16) staffedFully = true;
    }
    assert.ok(first > 0 && first <= 65, `expanded=${expanded}, first graduation=${first}`);
    assert.equal(campus.level, expanded ? 2 : 1);
    if (expanded) assert.ok(staffedFully, 'naturally graduated local teacher unlocks remaining purchased capacity');
    firstGraduation.push(first);
  }
  assert.equal(firstGraduation[1], firstGraduation[0]);
});

test('an already expanded v22 school resumes saved progress without changing original money, identity or bytes', () => {
  const original = createCity(3);
  assert.equal(buildCampus(original, 265, 'school').ok, true);
  for (let day = 0; day < 30; day++) step(original);
  const campus = original.education!.campuses[0];
  assert.equal(upgradeCampus(original, campus.id).ok, true);
  // Shape of an existing expanded save from the all-or-nothing implementation.
  campus.report = { ...campus.report, road: true, utility: true, operatingSeats: 0, reasons: ['ขาดครู'] };
  original.market = marketJournalForTest(null);
  original.market.guestId = '00000000-0000-4000-8000-000000000003';
  const raw = serializeParkSession(original, createParkRuntime(original));
  assert.equal(JSON.parse(raw).version, 22);
  const bytes = new Map([[SAVE_KEY, raw]]);
  const storage = { getItem: (key: string) => bytes.get(key) ?? null, setItem: (key: string, value: string) => { bytes.set(key, value); } };
  const restored = restoreStartupCity(storage, () => { throw Error('saved school was rejected'); });
  assert.equal(restored.restored, true);
  const city = restored.city;
  for (const key of ['accounts', 'ledger', 'households', 'firms', 'goods', 'goodsLedger', 'crops', 'cropLedger', 'buildings', 'education', 'market'] as const) assert.deepEqual(city[key], original[key], key);
  assert.equal(toggleCampus(city, campus.id).ok, true);
  const progress = city.education!.people.map(row => [row.householdId, row.school, row.progress]);
  step(city);
  assert.deepEqual(city.education!.people.map(row => [row.householdId, row.school, row.progress]), progress);
  assert.equal(toggleCampus(city, campus.id).ok, true);
  step(city);
  assert.equal(city.education!.campuses[0].report.operatingSeats, 8);
  assert.ok(city.education!.people.some(row => row.progress > (progress.find(([id]) => id === row.householdId)?.[2] ?? 0)));
  while (!city.education!.people.some(row => row.school > 0 && row.progress === EDUCATION_COST.school.studyDays - 1) && city.tick < 90) { step(city); checkCity(city); }
  assert.ok(city.tick < 90, 'saved learners continue towards graduation');
  const reloaded = deserialize(serialize(city));
  step(city); step(reloaded);
  assert.deepEqual(reloaded.education, city.education);
  assert.ok(city.education!.completed.basic > 0);
  const afterGraduation = deserialize(serialize(city));
  step(city); step(afterGraduation);
  assert.deepEqual(afterGraduation.education, city.education, 'reloading a completed cohort cannot graduate it again');
  assert.equal(city.education!.campuses[0].level, 2);
  assert.deepEqual(city.market, original.market);
  checkCity(city);
  assert.deepEqual([...bytes], [[SAVE_KEY, raw]], 'loading and simulation never rewrote the original stored snapshot');
});
