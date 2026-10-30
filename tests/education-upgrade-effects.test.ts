import assert from 'node:assert/strict';
import test from 'node:test';
import { createEducation, educationGate, initialCampusReport, stepEducation, withdrawCampus, forgetHouseholdEducation, type Campus, type EducationBuilding, type EducationPeople, type EducationView } from '../src/education.ts';
import { createCity, step, type City } from '../src/sim.ts';

const person = (changes: Partial<EducationPeople> = {}): EducationPeople => ({ householdId: 1, basic: 1, higher: 0, school: 0, university: 0, teacher: 0, professor: 0, campusId: null, progress: 0, ...changes });
const campus = (id: number, kind: Campus['kind']): Campus => ({ id, kind, cell: id, level: 1, tick: 0, open: true, contract: 0, workDays: {}, report: initialCampusReport(kind, 1) });
const building = (zone: EducationBuilding['zone'], next: number): EducationBuilding => ({ id: 10, zone, level: next - 1, firmId: zone === 'R' ? null : 20 });
function fixture(b: EducationBuilding) {
  const state = createEducation('new-city');
  state.people = [person()]; state.residentBasic = 1;
  state.schoolReadyDays = state.universityReadyDays = 30;
  state.sustain = [{ buildingId: b.id, days: 30 }];
  const view: EducationView = { tick: 30, households: [{ id: 1, workforce: 1, wallet: 'household:1', ownsFirm: false }], buildings: [b], posts: [{ firmId: 20, householdId: 1, workers: 1, owner: false }], road: () => true, sparePower: 10, spareWater: 10, treasury: 1_000_000 };
  return { state, view };
}

test('all next-level education bands distinguish basic, higher and ungated entry buildings', () => {
  for (const [zone, max, basicFrom, higherFrom] of [['R', 9, 4, 7], ['F', 6, 4, 7], ['I', 9, 4, 7], ['C', 7, 5, 7]] as const) {
    for (let next = 2; next <= max; next++) {
      const b = building(zone, next), { state, view } = fixture(b);
      const before = JSON.stringify(view), basic = educationGate(state, view, b);
      assert.equal(basic.need, next < basicFrom ? 0 : 1, `${zone} -> ${next} requirement`);
      assert.equal(basic.blocked.length === 0, next < higherFrom, `${zone} -> ${next} basic`);
      // Changing only the diploma rank changes higher-tier eligibility, not jobs or people.
      state.people[0].higher = state.residentHigher = 1;
      assert.deepEqual(educationGate(state, view, b).blocked, [], `${zone} -> ${next} higher`);
      state.people[0].higher = state.residentHigher = 0;
      state.people[0].basic = state.residentBasic = 0;
      assert.equal(educationGate(state, view, b).blocked.length === 0, next < basicFrom, `${zone} -> ${next} no diploma`);
      assert.equal(JSON.stringify(view), before, 'the gate does not mutate workforce, ownership or buildings');
    }
  }
});

test('housing explanations name accumulated school days and consecutive university days', () => {
  const b = building('R', 4), { state, view } = fixture(b);
  state.schoolReadyDays = 10;
  state.universityReadyDays = 10;
  const apartment = educationGate(state, view, b);
  assert.deepEqual(apartment.blocked, ['โรงเรียนให้บริการสะสม 10/30 วัน (วันที่หยุดบริการไม่ล้างวันที่สะสม)']);
  assert.equal(apartment.sustainDays, 10);
  state.people[0].higher = state.residentHigher = 1;
  assert.deepEqual(educationGate(state, view, building('R', 7)).blocked, ['มหาวิทยาลัยให้บริการต่อเนื่อง 10/30 วัน']);
});

test('school closure pauses accumulated days, university closure resets consecutive days, and reopening resumes correctly', () => {
  const state = createEducation('new-city');
  state.campuses = [campus(1, 'school'), campus(2, 'university')];
  const view: EducationView = { tick: 1, households: [], buildings: [], posts: [], road: () => true, sparePower: 3, spareWater: 2, treasury: 100_000 };
  for (let day = 0; day < 10; day++) stepEducation(state, view);
  assert.deepEqual([state.schoolReadyDays, state.universityReadyDays], [10, 10]);
  state.campuses.forEach(c => { c.open = false; });
  stepEducation(state, view);
  assert.deepEqual(state.campuses.map(c => c.report.operatingSeats), [0, 0]);
  assert.deepEqual([state.schoolReadyDays, state.universityReadyDays], [10, 0]);
  state.campuses.forEach(c => { c.open = true; });
  stepEducation(state, view);
  assert.deepEqual([state.schoolReadyDays, state.universityReadyDays], [11, 1]);
});

test('a firm needs its own current qualified post for all 30 days, and job loss resets progress', () => {
  const b = building('F', 4), { state, view } = fixture(b);
  state.sustain[0].days = 0;
  for (let day = 0; day < 29; day++) stepEducation(state, view);
  assert.equal(educationGate(state, view, b).sustainDays, 29);
  assert.match(educationGate(state, view, b).blocked.join(' '), /อีก 1 วัน \(29\/30\)/);
  stepEducation(state, view);
  assert.deepEqual(educationGate(state, view, b).blocked, []);
  // Household and qualifications stay the same; only its workplace changes.
  view.posts = [{ firmId: 21, householdId: 1, workers: 1, owner: false }];
  stepEducation(state, view);
  const missing = educationGate(state, view, b);
  assert.equal(missing.have, 0); assert.equal(missing.sustainDays, 0);
  assert.match(missing.blocked.join(' '), /มี 0\/1 · ขาดแรงงานฟาร์มที่ถือวุฒิพื้นฐาน 1 คน/);
  view.posts = [{ firmId: 20, householdId: 1, workers: 1, owner: false }];
  stepEducation(state, view);
  assert.equal(educationGate(state, view, b).sustainDays, 1);
});

test('demolition withdraws unfinished study but preserves resident diplomas; departure removes their upgrade qualification', () => {
  const b = building('R', 4), { state, view } = fixture(b);
  state.campuses = [campus(2, 'school')];
  state.people = [person({ school: 1, campusId: 2, progress: 59 })];
  view.households = [{ ...view.households[0], workforce: 2 }];
  withdrawCampus(state, 2);
  assert.equal(state.campuses.length, 0);
  assert.deepEqual(state.people, [person()]);
  assert.equal(state.residentBasic, 1);
  assert.equal(state.schoolReadyDays, 30, 'demolition does not erase documented cumulative service history');
  forgetHouseholdEducation(state, 1);
  assert.equal(educationGate(state, view, b).have, 0);
  assert.match(educationGate(state, view, b).blocked.join(' '), /ผู้ถือวุฒิพื้นฐานที่ยังอยู่ในเมือง/);
});

test('only changing resident diplomas changes real month-end home and farm upgrades, not jobs or economic flows', () => {
  const ready = createCity(61025);
  for (let day = 0; day < 119; day++) step(ready);
  ready.education!.people = ready.households.map(h => person({ householdId: h.id, basic: h.workforce }));
  ready.education!.residentBasic = ready.households.reduce((sum, h) => sum + h.workforce, 0);
  ready.education!.schoolReadyDays = 30;
  ready.education!.sustain = ready.buildings.map(b => ({ buildingId: b.id, days: 30 }));
  const missing = structuredClone(ready);
  for (const p of missing.education!.people) p.basic = 0;
  missing.education!.residentBasic = 0;
  const before = ready.buildings.map(b => ({ id: b.id, zone: b.zone, level: b.level }));
  step(ready); step(missing);
  for (const zone of ['R', 'F']) {
    const upgraded = before.filter(b => b.zone === zone && b.level === 3 && ready.buildings.find(next => next.id === b.id)!.level === 4);
    assert.ok(upgraded.length > 0, `${zone} has a real qualified upgrade`);
    for (const b of upgraded) assert.equal(missing.buildings.find(next => next.id === b.id)!.level, 3);
  }
  for (const key of ['employment', 'ownerLabor', 'households', 'goods', 'goodsLedger', 'crops', 'cropLedger'] as const) assert.deepEqual(ready[key], missing[key], key);
  // Remove only the actual, recorded height-investment transfers to compare all other money.
  const withoutInvestments = (city: City) => {
    const accounts = { ...city.accounts };
    for (const e of city.ledger.filter(e => e.tick === 120 && e.to === 'construction' && e.reason.includes('height investment'))) {
      accounts[e.from] += e.amount; accounts[e.to] -= e.amount;
    }
    return accounts;
  };
  assert.deepEqual(withoutInvestments(ready), withoutInvestments(missing));
});
