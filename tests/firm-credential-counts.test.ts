import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { createCity, firmCredentialCounts, step } from '../src/sim.ts';
import { createEducation, educationGate, type EducationPeople, type EducationView } from '../src/education.ts';

registerHooks({ load(url, context, nextLoad) { return url.endsWith('.css') ? { format: 'module', source: '', shortCircuit: true } : nextLoad(url, context); } });
const { renderFirmCredentials } = await import('../src/context-panels.ts');

function fixture() {
  const city = createCity(61025); for (let day = 0; day < 60; day++) step(city);
  const household = city.households.find(h => h.workforce === 2)!;
  const [first, second] = [...city.firms].sort((a, b) => a.id - b.id);
  assert.ok(household && first && second);
  city.employment = []; city.ownerLabor = []; city.education = createEducation('new-city');
  const person: EducationPeople = { householdId: household.id, basic: 1, higher: 0, school: 0, university: 0, teacher: 0, professor: 0, campusId: null, progress: 0 };
  city.education.people = [person];
  const employ = (firmId: number) => city.employment.push({ householdId: household.id, firmId, workers: 1, skill: 'general', occupation: 'manufacturing', rank: 'entry' });
  const gate = (firmId: number, rank: 'basic' | 'higher') => {
    const view: EducationView = { tick: city.tick, households: [], buildings: [], posts: [
      ...city.employment.map(e => ({ firmId: e.firmId, householdId: e.householdId, workers: e.workers, owner: false })),
      ...city.ownerLabor.map(e => ({ firmId: e.firmId, householdId: e.householdId, workers: 0, owner: true })),
    ], road: () => true, sparePower: 100, spareWater: 100, treasury: 100_000 };
    return educationGate(city.education, view, { id: firmId, firmId, zone: 'I', level: rank === 'basic' ? 3 : 6 }).have;
  };
  return { city, household, first, second, person, employ, gate };
}

test('the inspector counts an actual owner once, and never an absent owner', () => {
  const { city, household, first, person } = fixture();
  person.basic = person.higher = 2;
  first.owner = { householdId: household.id, capitalContributed: 60_000, capitalReturned: 0, withdrawn: 0, taxPaid: 0 };
  city.ownerLabor.push({ householdId: household.id, firmId: first.id, workers: 1, skill: 'general' });
  assert.deepEqual(firmCredentialCounts(city, first.id), { basic: 1, higher: 1 });
  city.ownerLabor = [];
  assert.deepEqual(firmCredentialCounts(city, first.id), { basic: 0, higher: 0 });
});

test('inspector counts and both gate ranks share one stable allocation across firms', () => {
  const { city, first, second, person, employ, gate } = fixture();
  person.higher = 1;
  employ(second.id); employ(first.id);
  const original = JSON.stringify(city);
  for (const id of [first.id, second.id, second.id, first.id]) {
    const counts = firmCredentialCounts(city, id);
    assert.deepEqual(counts, id === first.id ? { basic: 1, higher: 1 } : { basic: 0, higher: 0 });
    assert.equal(counts.basic, gate(id, 'basic')); assert.equal(counts.higher, gate(id, 'higher'));
  }
  assert.equal(JSON.stringify(city), original, 'inspecting does not spend or mutate diplomas');
  person.basic = 2;
  assert.deepEqual(firmCredentialCounts(city, second.id), { basic: 1, higher: 0 });
});

test('teaching and study reserves cannot appear as business qualifications', () => {
  for (const role of ['teacher', 'university', 'professor'] as const) {
    const { city, first, person, employ, gate } = fixture();
    person[role] = 1; person.higher = role === 'professor' ? 1 : 0; person.campusId = 999;
    employ(first.id);
    assert.deepEqual(firmCredentialCounts(city, first.id), { basic: 0, higher: 0 }, role);
    assert.equal(gate(first.id, 'basic'), 0); assert.equal(gate(first.id, 'higher'), 0);
  }
  const { city, first, person, employ } = fixture();
  person.school = 1; person.campusId = 999; employ(first.id);
  assert.deepEqual(firmCredentialCounts(city, first.id), { basic: 1, higher: 0 }, 'a school pupil has no diploma to take from the qualified working household member');
  delete city.education;
  assert.deepEqual(firmCredentialCounts(city, first.id), { basic: 0, higher: 0 });
});

test('the rendered credential note uses the same available counts as its blocked upgrade', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({ className: '', textContent: '' }) } });
  try {
    const { city, first, second, person, employ, gate } = fixture();
    person.higher = 1; employ(first.id); employ(second.id);
    assert.equal(gate(second.id, 'basic'), 0);
    assert.match(renderFirmCredentials(city, first.id).textContent!, /วุฒิพื้นฐาน 1 คน · วุฒิขั้นสูง 1 คน/);
    assert.match(renderFirmCredentials(city, second.id).textContent!, /วุฒิพื้นฐาน 0 คน · วุฒิขั้นสูง 0 คน/);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'document', previous); else Reflect.deleteProperty(globalThis, 'document');
  }
});
