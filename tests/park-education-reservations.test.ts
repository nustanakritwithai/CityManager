import assert from 'node:assert/strict';
import test from 'node:test';
import { createCity, type City } from '../src/sim.ts';
import { initialCampusReport, withdrawCampus, type EducationPeople } from '../src/education.ts';
import { parkActivityCitizens, parkActivityUnavailableCitizenIds, createParkActivity, advanceParkActivity, reconcileParkActivity, serializeParkActivity, restoreParkActivity, WORK_END_MINUTE } from '../src/park-activity.ts';
import { observeParkRecreationMinute } from '../src/park-recreation-activity.ts';
import { createParkRuntime, advanceParkRuntime } from '../src/park-runtime.ts';

function fixture(role: 'school' | 'university' | 'teacher' | 'professor' = 'school'): City {
  const city = createCity(100, { starter: false });
  city.buildings = [{ id: 100, cell: 100, zone: 'R', level: 2, age: 30, housingType: 'cottage' }];
  city.cells[100].building = 100; city.cells[100].zone = 'R';
  city.households = [200, 201].map(id => ({ id, home: 100, members: 1, workforce: 1, dependents: 0, workerSkills: { general: 1, manufacturing: 0, retail: 0 }, skillSource: 'arrival-profile', profile: 'single-worker', origin: 'arrival', wallet: `household:${id}`, lastPurchaseTick: 0, needs: 0 }));
  city.parks = [{ id: 400, cell: 104, tick: 0, level: 1, staffing: { allocations: [{ householdId: 201, parkId: 400, skill: 'general', workers: 1 }], workDays: {} } }];
  const kind = role === 'university' || role === 'professor' ? 'university' : 'school';
  city.education!.campuses = [{ id: 500, kind, cell: 102, level: 1, tick: 0, open: true, contract: 0, workDays: {}, report: { ...initialCampusReport(kind, 1), road: true, utility: true, operatingSeats: 4, progressing: 1 } }];
  const p: EducationPeople = { householdId: 200, basic: role === 'school' ? 0 : 1, higher: role === 'professor' ? 1 : 0, school: 0, university: 0, teacher: 0, professor: 0, campusId: 500, progress: 0 };
  p[role] = 1; city.education!.people = [p]; city.education!.residentBasic = p.basic; city.education!.residentHigher = p.higher;
  return city;
}

test('each actual education role reserves daytime but not evening leisure, without inventing employment or people', () => {
  for (const role of ['school', 'university', 'teacher', 'professor'] as const) {
    const city = fixture(role), before = JSON.stringify(city), citizens = parkActivityCitizens(city);
    assert.equal(citizens.length, 2);
    assert.equal(citizens[0].employed, false, 'education reservation is separate from firm/park job metadata');
    for (const minute of [480, 600, 1019]) assert.ok(parkActivityUnavailableCitizenIds(city, minute).has('h:200:m:0'), `${role} at ${minute}`);
    for (const minute of [479, WORK_END_MINUTE, 1320]) assert.equal(parkActivityUnavailableCitizenIds(city, minute).has('h:200:m:0'), false, `${role} at ${minute}`);
    const activity = createParkActivity(city, 599); advanceParkActivity(city, activity, 1);
    assert.equal(activity.visitors.length, 0, `${role} cannot depart during its reservation`);
    advanceParkActivity(city, activity, WORK_END_MINUTE - 600);
    assert.ok(activity.visitors.some(v => v.citizenId === 'h:200:m:0'), `${role} can depart after the shared work window`);
    assert.equal(JSON.stringify(city), before);
  }
});

test('education reservations occupy only residual real workforce slots, not job slots or dependents', () => {
  const city = fixture(), h = city.households[0];
  h.members = 5; h.workforce = 4; h.dependents = 1; h.workerSkills = { general: 2, manufacturing: 1, retail: 1 };
  city.ownerLabor = [{ householdId: h.id, firmId: 600, skill: 'general', workers: 1 }];
  city.employment = [{ householdId: h.id, firmId: 601, skill: 'manufacturing', workers: 1, occupation: 'manufacturing', rank: 'entry' }];
  city.parks[0].staffing!.allocations = [{ householdId: h.id, parkId: 400, skill: 'retail', workers: 1 }];
  const people = parkActivityCitizens(city).filter(p => p.householdId === h.id);
  const unavailable = parkActivityUnavailableCitizenIds(city, 600);
  assert.deepEqual(people.map(p => [p.firmId, p.parkJobId]), [[600, null], [null, null], [601, null], [null, 400], [null, null]]);
  assert.deepEqual(people.filter(p => unavailable.has(p.citizenId)).map(p => p.memberSlot), [0, 1, 2, 3]);
  city.employment.reverse(); city.households.reverse();
  assert.deepEqual(parkActivityUnavailableCitizenIds(city, 600), unavailable, 'input ordering does not change reservations');
});

test('observer alone rejects on-duty education benefit and accepts evening presence', () => {
  const city = fixture();
  const observation = { day: city.tick, minute: 600, visitors: [{ citizenId: 'h:200:m:0', householdId: 200, memberSlot: 0, homeId: 100, homeCell: 100, parkId: 400, parkCell: 104, phase: 'sit' as const }] };
  assert.equal(observeParkRecreationMinute(city, observation).visits[0].eligible, false);
  assert.equal(observeParkRecreationMinute(city, { ...observation, minute: WORK_END_MINUTE }).visits[0].eligible, true);
});

test('new education reservation cancels a paused active visit and old activity saves reconcile without losing city data', () => {
  const city = fixture(); city.education!.people[0].school = 0;
  const activity = createParkActivity(city, 599); advanceParkActivity(city, activity, 21);
  assert.ok(activity.visitors.some(v => v.citizenId === 'h:200:m:0'));
  const oldActivity = serializeParkActivity(activity);
  city.education!.people[0].school = 1;
  const before = JSON.stringify(city), restored = restoreParkActivity(city, oldActivity);
  assert.equal(restored.visitors.length, 0); assert.equal(restored.cancelled, 1);
  reconcileParkActivity(city, activity);
  assert.equal(activity.visitors.length, 0); assert.equal(activity.cancelled, 1);
  assert.equal(JSON.stringify(city), before);
  // The education model retains enrollment on closure; only canonical release clears the reservation.
  city.education!.campuses[0].open = false;
  assert.ok(parkActivityUnavailableCitizenIds(city, 600).has('h:200:m:0'));
  withdrawCampus(city.education!, 500);
  assert.equal(parkActivityUnavailableCitizenIds(city, 600).has('h:200:m:0'), false);
  const released = createParkActivity(city, 599); advanceParkActivity(city, released, 1);
  assert.ok(released.visitors.some(v => v.citizenId === 'h:200:m:0'), 'campus withdrawal restores daytime eligibility');
});

test('actual runtime awards no education-time recreation but does award evening leisure with unchanged city and clock', () => {
  const city = fixture(), runtime = createParkRuntime(city), before = JSON.stringify(city);
  advanceParkRuntime(city, runtime, WORK_END_MINUTE, () => assert.fail('no economic day expected'));
  assert.equal(runtime.recreation.citizens['h:200:m:0'], undefined);
  advanceParkRuntime(city, runtime, 300, () => assert.fail('no economic day expected'));
  assert.ok(runtime.recreation.citizens['h:200:m:0'].earnedMinutes > 0);
  assert.ok(runtime.recreation.citizens['h:200:m:0'].lastBenefitMinute > WORK_END_MINUTE);
  assert.equal(runtime.activity.minute, 1320); assert.equal(runtime.recreation.minute, 1320);
  assert.equal(JSON.stringify(city), before);
});

test('legacy cities without education keep their exact citizen mapping and job-only availability', () => {
  const city = fixture();
  city.education!.people = [];
  const roster = parkActivityCitizens(city), unavailable = parkActivityUnavailableCitizenIds(city, 600);
  delete city.education;
  assert.deepEqual(parkActivityCitizens(city), roster);
  assert.deepEqual(parkActivityUnavailableCitizenIds(city, 600), unavailable);
});
