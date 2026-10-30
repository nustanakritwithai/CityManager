import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSaveFeedback, type SaveFeedbackState } from '../src/save-feedback.ts';
import { educationPanelData } from '../src/education-panel-data.ts';
import { buildCampus, campusSiteReason, createCity, serialize, step, toggleCampus } from '../src/sim.ts';
import { pocketPark } from '../src/scene-decor.ts';
import { assertEducationInvariants, stepEducation, type EducationPeople, type EducationView } from '../src/education.ts';

test('save failure stays visible during retries, and only a later successful write clears it', () => {
  let state: SaveFeedbackState = { pending: 0, lastSuccess: null, failure: null }, clock = 100;
  const feedback = createSaveFeedback(next => { state = next; }, () => clock);
  const first = feedback.begin();
  assert.equal(state.lastSuccess, null, 'starting a pending write is not success');
  feedback.succeeded(first);
  clock = 200;
  const failed = feedback.begin(); feedback.failed('quota', failed);
  assert.equal(state.lastSuccess, 100);
  const retry = feedback.begin();
  assert.equal(state.failure, 'quota');
  assert.equal(state.pending, 1);
  feedback.succeeded(retry);
  assert.equal(state.failure, null);
  assert.equal(state.lastSuccess, 200);
});

test('overlapping completions cannot erase a newer failure or resurrect an older failure', () => {
  let state: SaveFeedbackState = { pending: 0, lastSuccess: null, failure: null };
  const feedback = createSaveFeedback(next => { state = next; });
  const old = feedback.begin(), newer = feedback.begin();
  feedback.failed('new failure', newer); feedback.succeeded(old);
  assert.equal(state.failure, 'new failure');
  const oldRetry = feedback.begin(), newRetry = feedback.begin();
  feedback.succeeded(newRetry); feedback.failed('old failure', oldRetry);
  assert.equal(state.failure, null);
  feedback.failed('serialization failed before write');
  assert.equal(state.failure, 'serialization failed before write');
  assert.equal(state.pending, 0);
});

test('education presentation reads actual cohorts and paused progress without changing the city', () => {
  const city = createCity(3, { starter: true });
  const site = city.cells.findIndex((_, index) => campusSiteReason(city, index, 'school') === null);
  assert.equal(buildCampus(city, site, 'school').ok, true);
  const campus = city.education!.campuses[0];
  for (let day = 0; day < 12; day++) step(city);
  const before = serialize(city), data = educationPanelData(city, campus);
  assert.equal(serialize(city), before, 'the view must not spend, assign workers, or advance progress');
  assert.ok(data.cohorts.length > 0);
  assert.ok(data.cohorts.every(cohort => cohort.days > 0 && cohort.days < data.studyDays));
  assert.equal(data.operatingSeats, campus.report.operatingSeats);
  assert.equal(data.enrolled, campus.report.enrolled);
  assert.equal(data.progressing, campus.report.progressing);
  assert.equal(pocketPark(city, site), false, 'a real campus never becomes decorative vacant land');
  assert.equal(toggleCampus(city, campus.id).ok, true);
  const paused = educationPanelData(city, campus).cohorts;
  step(city); step(city);
  assert.deepEqual(educationPanelData(city, campus).cohorts, paused, 'a closed campus must not be displayed as progressing');
  assert.equal(data.upgrade, 150_000);
  assert.equal(data.studyDays, 60);
  assert.equal(data.next?.seats, 16);
});

for (const kind of ['school', 'university'] as const) test(`${kind} panel preserves split progress and legacy single-cohort progress`, () => {
  const city = createCity(3, { starter: true });
  const site = city.cells.findIndex((_, index) => campusSiteReason(city, index, kind) === null);
  assert.equal(buildCampus(city, site, kind).ok, true);
  const education = city.education!, campus = education.campuses[0];
  campus.level = 2;
  const count = kind === 'school' ? 6 : 3, servedFromSecond = kind === 'school' ? 2 : 1;
  // A valid education-domain fixture: partial staffing actually creates the
  // split. This is a read-model check, not a whole-city save fixture.
  education.people = [101, 102].map((householdId): EducationPeople => ({
    householdId, basic:kind === 'university' ? count : 0, higher:0,
    school:kind === 'school' ? count : 0, university:kind === 'university' ? count : 0,
    teacher:0, professor:0, campusId:campus.id, progress:10,
  }));
  education.residentBasic = kind === 'university' ? count * 2 : 0;
  const view: EducationView = { tick:1, households:education.people.map(person => ({ id:person.householdId, workforce:count, wallet:`household:${person.householdId}`, ownsFirm:false })), buildings:[], posts:[], road:()=>true, sparePower:20, spareWater:20, treasury:100_000 };
  stepEducation(education, view); assertEducationInvariants(education, view.households);
  assert.equal(education.people[0].studyCohorts, undefined, 'uniform/legacy representation stays supported');
  assert.equal(education.people[1].studyCohorts?.length, 2);
  const before = JSON.stringify(city), data = educationPanelData(city, campus);
  assert.deepEqual(data.cohorts, [
    { householdId:101, learners:count, days:11 },
    { householdId:102, learners:servedFromSecond, days:11 },
    { householdId:102, learners:count - servedFromSecond, days:10 },
  ], 'advanced learners must not be displayed at the household minimum');
  assert.equal(JSON.stringify(city), before, 'reading split progress never changes it');
  campus.open = false; stepEducation(education, { ...view, tick:2 });
  assert.deepEqual(educationPanelData(city, campus).cohorts, data.cohorts, 'closed service preserves both earned progress groups');
});
