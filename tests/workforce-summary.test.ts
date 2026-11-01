import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCampus, createCity, deserialize, householdWorkerCount, serialize, step, toggleCampus, type City, type Firm, type Household } from '../src/sim.ts';
import { createEducation, initialCampusReport, type EducationPeople } from '../src/education.ts';
import { emptyCrops, emptyProducts } from '../src/goods.ts';
import { deriveWorkforceSummary, type WorkforceSummary } from '../src/workforce-summary.ts';

const household = (id: number, workforce = 2, dependents = 1): Household => ({ id, home: null, members: workforce + dependents,
  workforce, dependents, workerSkills: { general: workforce, manufacturing: 0, retail: 0 }, skillSource: 'arrival-profile',
  profile: workforce === 1 ? 'single-worker' : 'family', origin: 'arrival', wallet: `household:${id}`, lastPurchaseTick: 0, needs: 0 });
const firm = (id: number, zone: Firm['zone'], commercialKind?: Firm['commercialKind'], ownerId?: number): Firm => ({ id, building: id + 100,
  zone, ...(commercialKind ? { commercialKind } : {}), crops: emptyCrops(), products: emptyProducts(), wallet: `firm:${id}`, workDays: {},
  inventory: 0, cropInventory: 0, cropCost: 0, productionTick: 0,
  owner: ownerId === undefined ? null : { householdId: ownerId, capitalContributed: 0, capitalReturned: 0, withdrawn: 0, taxPaid: 0 },
  profit: 0, lastMonthProfit: 0, monthlyRevenue: 0, monthlyExpense: 0 });
const person = (householdId: number, values: Partial<EducationPeople> = {}): EducationPeople => ({ householdId,
  basic: 0, higher: 0, school: 0, university: 0, teacher: 0, professor: 0, campusId: null, progress: 0, ...values });
function fixture(): City {
  const city = createCity(3, { starter: false });
  // Synthetic cohorts exercise every existing role without manufacturing persistent person IDs.
  city.households = [household(1), household(2), household(3, 2, 0), household(4), household(5), household(6, 1, 0)];
  city.firms = [firm(10, 'C', 'market', 1), firm(11, 'F'), firm(12, 'I'), firm(13, 'C', 'retail'), firm(14, 'C', 'retail', 6), firm(15, 'I', undefined, 6)];
  city.ownerLabor = [{ householdId: 1, firmId: 10, skill: 'general', workers: 1 }];
  city.employment = [
    { householdId: 1, firmId: 11, occupation: 'manufacturing', rank: 'entry', skill: 'general', workers: 1 },
    { householdId: 4, firmId: 12, occupation: 'manufacturing', rank: 'entry', skill: 'general', workers: 1 },
    { householdId: 5, firmId: 13, occupation: 'retail', rank: 'entry', skill: 'general', workers: 1 },
  ];
  city.parks = [{ id: 20, cell: 0, tick: 0, level: 1, staffing: { allocations: [{ householdId: 4, parkId: 20, skill: 'general', workers: 1 }], workDays: {} } }];
  city.education = createEducation('new-city');
  city.education.campuses = ['school', 'university'].map((kind, index) => ({ id: 30 + index, kind: kind as 'school' | 'university',
    cell: index + 1, level: 1, tick: 0, open: true, contract: 1, workDays: {}, report: initialCampusReport(kind as 'school' | 'university', 1) }));
  city.education.people = [person(2, { basic: 1, teacher: 1, school: 1, campusId: 30 }),
    person(3, { basic: 2, higher: 1, professor: 1, university: 1, campusId: 31 })];
  return city;
}
function reconcile(summary: WorkforceSummary) {
  assert.equal(summary.reconciled, true, JSON.stringify(summary.issues));
  for (const counts of [summary.counts, ...[...summary.byHousehold.values()].map(h => h.counts)]) {
    assert.equal(counts.population, counts.workforce + counts.dependents);
    assert.equal(counts.workforce, counts.economicWorkers + counts.studying + counts.unassignedWorkforce);
    assert.equal(counts.occupiedWorkforce, counts.economicWorkers + counts.studying);
    assert.equal(counts.economicWorkers, counts.employeeWorkers + counts.ownerWorkers);
    assert.equal(counts.studying, counts.schoolStudents + counts.universityStudents);
  }
  assert.equal([...summary.byWorkplace.values()].reduce((n, row) => n + row.localWorkers, 0), summary.counts.economicWorkers);
  assert.equal([...summary.byWorkplace.values()].reduce((n, row) => n + row.learners, 0), summary.counts.studying);
  assert.equal(Object.values(summary.occupations).reduce((n, count) => n + count, 0), summary.counts.economicWorkers);
}
function freeze(value: unknown): void {
  if (value !== null && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
}

test('all real roles reconcile across household and workplace indexes without counting students as jobs', () => {
  const city = fixture(), summary = deriveWorkforceSummary(city); reconcile(summary);
  assert.deepEqual(summary.counts, { population: 15, workforce: 11, dependents: 4, economicWorkers: 7, studying: 2,
    unassignedWorkforce: 2, occupiedWorkforce: 9, employeeWorkers: 6, ownerWorkers: 1, schoolStudents: 1, universityStudents: 1 });
  assert.deepEqual(summary.occupations, { agriculture: 1, manufacturing: 1, retail: 2, 'park-maintenance': 1, teacher: 1, professor: 1 });
  assert.equal(summary.unassignedShare, 2 / 9, 'excludes studying and dependents from the denominator');
  assert.equal(summary.byWorkplace.get('campus:30')!.localWorkers, 1);
  assert.equal(summary.byWorkplace.get('campus:30')!.learners, 1);
  assert.equal(summary.byHousehold.get(2)!.counts.economicWorkers, 1, 'teacher is employed');
  assert.equal(summary.byHousehold.get(3)!.counts.economicWorkers, 1, 'professor is employed');
});

test('deeply frozen cohort inputs are readable without modifying allocation order or nested records', () => {
  const city = fixture(); freeze(city);
  const first = deriveWorkforceSummary(city), second = deriveWorkforceSummary(city);
  reconcile(first); assert.deepEqual(second, first);
});

test('ownership is a household relationship; owner labor counts once and passive owners add no workers', () => {
  const summary = deriveWorkforceSummary(fixture());
  const working = summary.byHousehold.get(1)!, passive = summary.byHousehold.get(6)!;
  assert.deepEqual(working.ownedFirmIds, [10]);
  assert.equal(working.counts.ownerWorkers, 1);
  assert.equal(working.counts.employeeWorkers, 1, 'another cohort count can be an employee');
  assert.deepEqual(passive.ownedFirmIds, [14, 15]);
  assert.equal(passive.counts.population, 1);
  assert.equal(passive.counts.economicWorkers, 0);
  assert.equal(passive.counts.unassignedWorkforce, 1, 'two owned firms do not create two people');
});

test('external educators fill a separate count, never resident employment or population', () => {
  const city = fixture(), withContracts = deriveWorkforceSummary(city);
  assert.deepEqual(withContracts.externalEducators, { teachers: 1, professors: 1 });
  assert.equal(withContracts.byWorkplace.get('campus:30')!.externalTeachers, 1);
  assert.equal(withContracts.byWorkplace.get('campus:31')!.externalProfessors, 1);
  city.education!.campuses.forEach(campus => { campus.contract = 0; });
  assert.deepEqual(deriveWorkforceSummary(city).counts, withContracts.counts);
});

test('skills and nested credentials remain separate, detached counts without invented person intersections', () => {
  const city = fixture(), before = structuredClone(city), summary = deriveWorkforceSummary(city);
  const row = summary.byHousehold.get(3)!;
  assert.deepEqual(row.credentials, { basic: 2, higher: 1 });
  assert.deepEqual(row.skills, { general: 2, manufacturing: 0, retail: 0 });
  assert.ok(row.assignments.every(a => !('skill' in a)), 'education has no persisted skill intersection');
  assert.equal(row.counts.population, 2, 'higher holders are already included in basic');
  (row.skills as { general: number }).general = 999;
  (row.credentials as { basic: number }).basic = 999;
  assert.deepEqual(city, before, 'even changing detached output cannot rewrite stored skills or diplomas');
});

test('overlapping work and study is diagnosed, with negative residual exposed rather than clamped', () => {
  const city = fixture();
  city.employment.push({ householdId: 2, firmId: 12, occupation: 'manufacturing', rank: 'entry', skill: 'general', workers: 1 });
  const before = structuredClone(city), summary = deriveWorkforceSummary(city);
  assert.equal(summary.reconciled, false);
  assert.ok(summary.issues.some(issue => issue.code === 'workforce-overallocated' && issue.householdId === 2));
  assert.equal(summary.byHousehold.get(2)!.counts.unassignedWorkforce, -1);
  assert.equal(summary.unassignedShare, null, 'an invalid snapshot cannot advertise an allocation rate');
  assert.deepEqual(city, before, 'the reader does not release jobs or repair saved data');
});

test('per-skill over-allocation and population/skill total drift are exposed independently', () => {
  const city = fixture(); city.households[0].workerSkills = { general: 1, manufacturing: 1, retail: 0 };
  let summary = deriveWorkforceSummary(city);
  assert.ok(summary.issues.some(issue => issue.code === 'skill-overallocated' && issue.householdId === 1));
  assert.equal(summary.byHousehold.get(1)!.counts.unassignedWorkforce, 0, 'aggregate headcount alone cannot detect the skill overlap');
  city.households[0].members++; city.households[0].workerSkills.retail++;
  summary = deriveWorkforceSummary(city);
  assert.ok(summary.issues.some(issue => issue.code === 'population-mismatch'));
  assert.ok(summary.issues.some(issue => issue.code === 'skill-total-mismatch'));
});

test('broken references and duplicate cohorts never silently create households or valid totals', () => {
  const city = fixture();
  city.employment.push({ householdId: 999, firmId: 12, occupation: 'manufacturing', rank: 'entry', skill: 'general', workers: 1 });
  city.employment.push({ householdId: 1, firmId: 999, occupation: 'manufacturing', rank: 'entry', skill: 'general', workers: 1 });
  city.education!.people.push({ ...city.education!.people[0] });
  const summary = deriveWorkforceSummary(city);
  assert.equal(summary.reconciled, false); assert.equal(summary.unassignedShare, null);
  assert.equal(summary.byHousehold.has(999), false); assert.equal(summary.byWorkplace.has('firm:999'), false);
  for (const code of ['missing-household', 'missing-workplace', 'duplicate-education']) assert.ok(summary.issues.some(issue => issue.code === code));
});

test('student-only and empty populations have no denominator; no education field remains absent', () => {
  const city = createCity(3, { starter: false }); delete city.education;
  const legacyBytes = serialize(city);
  let summary = deriveWorkforceSummary(city); reconcile(summary); assert.equal(summary.unassignedShare, null);
  assert.equal(serialize(city), legacyBytes, 'reading an education-absent city preserves its exact save bytes');
  assert.equal('education' in city, false);
  city.households = [household(1, 1, 0)];
  summary = deriveWorkforceSummary(city); reconcile(summary); assert.equal(summary.unassignedShare, 1);
  assert.deepEqual(summary.byHousehold.get(1)!.credentials, { basic: 0, higher: 0 });
  assert.equal('education' in city, false, 'summary must not adopt education on behalf of an old save');
  city.education = createEducation('new-city');
  city.education.campuses = [{ id: 30, kind: 'school', cell: 1, level: 1, tick: 0, open: false, contract: 0, workDays: {}, report: initialCampusReport('school', 1) }];
  city.education.people = [person(1, { school: 1, campusId: 30 })];
  summary = deriveWorkforceSummary(city); reconcile(summary);
  assert.equal(summary.counts.studying, 1); assert.equal(summary.counts.unassignedWorkforce, 0);
  assert.equal(summary.unassignedShare, null);
  assert.equal(householdWorkerCount(city, 1), 1, 'existing occupied helper and gates keep their semantics');
});

test('non-integer counts and incompatible source roles invalidate the snapshot without normalizing City', () => {
  const city = fixture();
  city.employment[0].workers = 0.5;
  city.employment[1].occupation = 'retail';
  city.parks[0].staffing!.allocations[0].parkId = 999;
  const before = structuredClone(city), summary = deriveWorkforceSummary(city);
  assert.equal(summary.reconciled, false); assert.equal(summary.unassignedShare, null);
  assert.ok(summary.issues.some(issue => issue.code === 'invalid-count'));
  assert.ok(summary.issues.some(issue => issue.code === 'role-mismatch'));
  assert.deepEqual(city, before);
});

test('large cohorts produce allocation rows, not member records; fresh calls observe same-tick changes', () => {
  const city = createCity(3, { starter: false });
  city.households = [household(1, 1_000_000, 0)]; city.firms = [firm(10, 'I')];
  city.employment = [{ householdId: 1, firmId: 10, occupation: 'manufacturing', rank: 'entry', skill: 'general', workers: 999_999 }];
  const first = deriveWorkforceSummary(city); reconcile(first);
  assert.equal(first.byHousehold.size, 1); assert.equal(first.byHousehold.get(1)!.assignments.length, 1);
  assert.equal(first.counts.unassignedWorkforce, 1);
  city.employment[0].workers--;
  assert.equal(deriveWorkforceSummary(city).counts.unassignedWorkforce, 2);
  assert.equal(first.counts.unassignedWorkforce, 1, 'snapshots do not share mutable source rows');
});

test('natural education city and save round trip remain byte-identical and deterministic after reads', () => {
  const city = createCity(3); assert.equal(buildCampus(city, 265, 'school').ok, true);
  for (let day = 0; day < 75; day++) step(city);
  assert.ok(city.education!.people.some(row => row.teacher > 0));
  const saved = serialize(city), before = structuredClone(city), control = deserialize(saved);
  for (let n = 0; n < 3; n++) reconcile(deriveWorkforceSummary(city));
  assert.equal(serialize(city), saved); assert.deepEqual(city, before, 'includes money, claims, RNG, IDs, skills and diploma/progress counts');
  const claims = structuredClone(city.education!.campuses.map(campus => campus.workDays));
  assert.equal(toggleCampus(city, city.education!.campuses[0].id).ok, true);
  const closed = serialize(city); deriveWorkforceSummary(city);
  assert.equal(serialize(city), closed); assert.deepEqual(city.education!.campuses.map(campus => campus.workDays), claims);
  toggleCampus(city, city.education!.campuses[0].id);
  // Restore identical baseline to compare subsequent simulation, not toggle metadata.
  const resumed = deserialize(saved); deriveWorkforceSummary(resumed);
  for (let n = 0; n < 3; n++) { step(resumed); step(control); }
  assert.equal(serialize(resumed), serialize(control));
});


test('commercial occupation ignores old market/retail tags while retaining owner versus employee relationships', () => {
  const city = fixture(), before = deriveWorkforceSummary(city);
  for (const firm of city.firms) if (firm.zone === 'C') firm.commercialKind = firm.commercialKind === 'market' ? 'retail' : 'market';
  const after = deriveWorkforceSummary(city);assert.deepEqual(after,before);
});
