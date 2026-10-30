import assert from 'node:assert/strict';
import test from 'node:test';
import { createEducation, educationLevel, educationUtilityAvailability, initialCampusReport, stepEducation, type Campus, type EducationView } from '../src/education.ts';

const campus = (id: number, kind: Campus['kind'] = 'school', level: 1 | 2 = 1): Campus => ({ id, kind, cell: id, level, tick: 0, open: true, contract: 0, workDays: {}, report: initialCampusReport(kind, level) });
function fixture() {
  const state = createEducation('new-city');
  state.campuses = [campus(1), campus(2)];
  const view: EducationView = { tick: 1, households: [], buildings: [], posts: [], road: () => true, sparePower: 1, spareWater: 1, treasury: 100_000 };
  return { state, view };
}

test('closing only the lower-ID campus releases its utilities to the active school and service-day gate', () => {
  const { state, view } = fixture(), beforeView = JSON.stringify(view);
  state.campuses[0].open = false;
  const removed = structuredClone(state); removed.campuses.shift();
  stepEducation(state, view); stepEducation(removed, view);
  assert.equal(state.campuses[0].report.operatingSeats, 0);
  assert.equal(state.campuses[1].report.operatingSeats, 8);
  assert.deepEqual(state.campuses[1].report, removed.campuses[0].report);
  assert.equal(state.schoolReadyDays, 1);
  assert.equal(JSON.stringify(view), beforeView, 'source supply and treasury are read-only');
});

test('disconnecting only the lower-ID campus releases utility without pretending it operates', () => {
  const { state, view } = fixture(); view.road = cell => cell !== 1;
  const map = educationUtilityAvailability(state, view);
  assert.equal(map.get(1)!.road, false); assert.equal(map.get(1)!.reserved, false);
  assert.deepEqual(map.get(2), { road: true, utility: true, availablePower: 1, availableWater: 1, reserved: true });
  stepEducation(state, view);
  assert.equal(state.campuses[0].report.operatingSeats, 0);
  assert.equal(state.campuses[1].report.operatingSeats, 8);
  assert.equal(state.schoolReadyDays, 1);
});

test('reopening and reconnection restore unchanged active-campus ID priority, independent of array order', () => {
  const { state, view } = fixture();
  state.campuses[0].open = false;
  assert.equal(educationUtilityAvailability(state, view).get(2)!.reserved, true);
  state.campuses[0].open = true;
  const reopened = educationUtilityAvailability(state, view);
  assert.equal(reopened.get(1)!.reserved, true); assert.equal(reopened.get(2)!.reserved, false);
  state.campuses.reverse();
  assert.deepEqual(educationUtilityAvailability(state, view), reopened);
  view.road = () => false;
  assert.equal([...educationUtilityAvailability(state, view).values()].some(v => v.reserved), false);
  view.road = () => true;
  assert.deepEqual(educationUtilityAvailability(state, view), reopened);
});

test('pure utility preview consumes both resources atomically and never double reserves scarce supply', () => {
  const { state, view } = fixture();
  state.campuses = [campus(3, 'school', 2), campus(2), campus(1, 'university')];
  const before = JSON.stringify(state);
  for (const [power, water] of [[0, 0], [1, 2], [2, 1], [3, 2], [5, 4]]) {
    view.sparePower = power; view.spareWater = water;
    const result = educationUtilityAvailability(state, view);
    let remainingPower = power, remainingWater = water;
    for (const c of [...state.campuses].sort((a, b) => a.id - b.id)) {
      const row = result.get(c.id)!, need = educationLevel(c.kind, c.level);
      assert.equal(row.availablePower, remainingPower); assert.equal(row.availableWater, remainingWater);
      if (row.reserved) { remainingPower -= need.power; remainingWater -= need.water; }
      assert.ok(remainingPower >= 0 && remainingWater >= 0);
    }
    assert.equal(view.sparePower, power); assert.equal(view.spareWater, water);
  }
  assert.equal(JSON.stringify(state), before, 'preview does not refresh reports, mutate cohorts, allocate staff or write wages');
  view.sparePower = 1; view.spareWater = 2;
  const partial = educationUtilityAvailability(state, view);
  assert.equal(partial.get(1)!.reserved, false, 'university cannot take only its water while power is short');
  assert.equal(partial.get(2)!.reserved, true, 'school can use the untouched supply');
});

test('live preview ignores stale campus reports and matches stepEducation utility decisions', () => {
  const { state, view } = fixture();
  state.campuses[0].open = false;
  state.campuses[0].report = { ...state.campuses[0].report, open: true, road: true, utility: true, operatingSeats: 8 };
  state.campuses[1].report = { ...state.campuses[1].report, road: false, utility: false };
  const preview = educationUtilityAvailability(state, view);
  stepEducation(state, view);
  for (const c of state.campuses) {
    assert.equal(c.report.road, preview.get(c.id)!.road);
    assert.equal(c.report.utility, preview.get(c.id)!.utility);
  }
  assert.equal(state.campuses[1].report.operatingSeats, 8);
});
