import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCampus, buildPark, buildPlant, bulldoze, createCity, deserialize, serialize, step, toggleCampus, type City } from '../src/sim.ts';
import { createEducation, educationPayroll, initialCampusReport, stepEducation, takeEducationWages, type CampusKind, type EducationView } from '../src/education.ts';

function staff(kind: CampusKind) {
  const state = createEducation('new-city'), role = kind === 'school' ? 'teacher' : 'professor';
  state.people.push({ householdId: 1, basic: 1, higher: kind === 'university' ? 1 : 0, school: 0, university: 0, teacher: 0, professor: 0, campusId: 1, progress: 0, [role]: 1 });
  state.residentBasic = 1; state.residentHigher = kind === 'university' ? 1 : 0;
  state.campuses.push({ id: 1, kind, cell: 265, level: 1, tick: 0, open: true, contract: 0, workDays: { 'household:1': 3 }, report: initialCampusReport(kind, 1) });
  const view: EducationView = { tick: 4, households: [{ id: 1, workforce: 1, wallet: 'household:1', ownsFirm: false }], buildings: [], posts: [], road: () => true, sparePower: 10, spareWater: 10, treasury: 0 };
  return { state, view, role, wage: kind === 'school' ? 1400 : 2000 };
}

for (const kind of ['school', 'university'] as const) {
  test(`existing ${kind} staff need a funded shift; earned claims survive a shortage`, () => {
    const { state, view, role, wage } = staff(kind);
    view.treasury = wage - 1;
    stepEducation(state, view);
    assert.equal(state.people[0][role], 0);
    assert.deepEqual(state.campuses[0].workDays, { 'household:1': 3 });
    assert.equal(state.campuses[0].report.operatingSeats, 0);
    assert.equal(educationPayroll(state), 3 * wage);
  });
  test(`a funded existing ${kind} shift accrues exactly once into its existing claim`, () => {
    const { state, view, wage } = staff(kind); view.treasury = wage;
    assert.deepEqual(stepEducation(state, view), []);
    assert.equal(state.campuses[0].workDays['household:1'], 4);
    assert.equal(educationPayroll(state), 4 * wage);
  });
}

test('several existing campuses cannot promise the same daily treasury budget', () => {
  const { state, view } = staff('school');
  state.people.push({ ...state.people[0], householdId: 2, campusId: 2 }); state.residentBasic++;
  state.campuses.push({ ...state.campuses[0], id: 2, cell: 266, workDays: { 'household:2': 3 } });
  view.households = [...view.households, { id: 2, workforce: 1, wallet: 'household:2', ownsFirm: false }]; view.treasury = 1400;
  stepEducation(state, view);
  assert.equal(state.campuses[0].workDays['household:1'], 4);
  assert.equal(state.campuses[1].workDays['household:2'], 3);
  assert.equal(state.people.find(p => p.householdId === 2)!.teacher, 0);
});

test('reading earned wage claims never deletes a liability before payment', () => {
  const { state } = staff('school'), before = structuredClone(state);
  const claims = takeEducationWages(state);
  assert.equal(claims[0].amount, 4200);
  assert.deepEqual(state, before);
});

let seedCity: City | undefined;
function fixture(): City {
  if (!seedCity) {
    const c = createCity(3);
    const site = () => c.cells.findIndex((p, i) => !p.road && !p.zone && p.building === null && !c.plants.some(x => x.cell === i) && !c.education!.campuses.some(x => x.cell === i) && [i - 1, i + 1, i - 24, i + 24].some(n => c.cells[n]?.road));
    assert.equal(buildCampus(c, site(), 'school').ok, true);
    for (let n = 0; n < 180 && !c.education!.people.some(p => p.teacher > 0); n++) {
      step(c);
      if (c.education!.campuses.some(p => !p.report.utility)) for (const kind of ['power', 'water'] as const) assert.equal(buildPlant(c, site(), kind).ok, true);
    }
    assert.equal(c.tick, 65, 'seed 3 reaches its first resident teacher with the #97 staffing fix');
    for (const [i, p] of c.cells.entries()) if (p.zone && p.zone !== 'R') assert.equal(bulldoze(c, i).ok, true);
    seedCity = deserialize(serialize(c));
  }
  return deserialize(serialize(seedCity));
}
function cash(c: City, amount: number, wallet = 'treasury') {
  const delta = amount - c.accounts[wallet];
  if (!delta) return;
  c.accounts[wallet] += delta; c.accounts.outside -= delta;
  c.ledger.push({ tick: c.tick, from: delta > 0 ? 'outside' : wallet, to: delta > 0 ? wallet : 'outside', amount: Math.abs(delta), reason: 'Synthetic payroll funding stress' });
}
function until(c: City, tick: number) { while (c.tick < tick) step(c); }
function payments(c: City) { return c.ledger.filter(e => /^Monthly (school|university) wages #/.test(e.reason)); }
function reconcile(c: City) {
  const balances: Record<string, number> = {};
  for (const e of c.ledger) { balances[e.from] = (balances[e.from] ?? 0) - e.amount; balances[e.to] = (balances[e.to] ?? 0) + e.amount; }
  for (const key of new Set([...Object.keys(c.accounts), ...Object.keys(balances)])) assert.equal(c.accounts[key] ?? 0, balances[key] ?? 0, key);
  assert.equal(Object.values(c.accounts).reduce((a, b) => a + b, 0), 0);
}

test('seed 3 treasury stress stops new shifts, pays the funded earned claim, and stays replayable', () => {
  const c = fixture(); cash(c, 1400); step(c);
  assert.equal(c.tick, 66); assert.equal(educationPayroll(c.education), 1400);
  const loaded = deserialize(serialize(c)); until(c, 90); until(loaded, 90);
  assert.equal(serialize(c), serialize(loaded));
  assert.equal(payments(c).reduce((n, e) => n + e.amount, 0), 1400);
  assert.equal(educationPayroll(c.education), 0); reconcile(c);
});

test('normal funded teacher payroll is exact and is not paid again after reload', () => {
  const c = fixture(); until(c, 90);
  assert.deepEqual(payments(c).map(e => e.amount), [36400]);
  assert.equal(educationPayroll(c.education), 0);
  toggleCampus(c, c.education!.campuses[0].id);
  const loaded = deserialize(serialize(c)); until(c, 120); until(loaded, 120);
  assert.equal(serialize(c), serialize(loaded)); assert.equal(payments(c).length, 1); reconcile(c);
});

test('closed school and university settle their distinct earned daily rates exactly once', () => {
  const c = fixture(), school = c.education!.campuses[0], wallet = Object.keys(school.workDays)[0];
  toggleCampus(c, school.id);
  const site = c.cells.findIndex((p, i) => !p.road && !p.zone && p.building === null && !c.plants.some(x => x.cell === i) && school.cell !== i && [i - 1, i + 1, i - 24, i + 24].some(n => c.cells[n]?.road));
  assert.equal(buildCampus(c, site, 'university').ok, true);
  const university = c.education!.campuses.find(p => p.kind === 'university')!;
  university.workDays[wallet] = 3; toggleCampus(c, university.id); cash(c, 7400);
  const loaded = deserialize(serialize(c)); until(c, 90); until(loaded, 90);
  assert.equal(serialize(c), serialize(loaded));
  assert.deepEqual(payments(c).map(e => e.amount), [1400, 6000]);
  assert.equal(educationPayroll(c.education), 0);
  assert.deepEqual(payments(c).map(e => c.ledger[c.ledger.indexOf(e) + 1].amount), [140, 600]);
  until(c, 120); assert.equal(payments(c).length, 2); deserialize(serialize(c)); reconcile(c);
});

test('legacy unfunded liabilities survive settlements, reload and departure review until fully funded', () => {
  let c = fixture(); const campus = c.education!.campuses[0], wallet = Object.keys(campus.workDays)[0];
  campus.workDays[wallet] = 16; cash(c, 1400); toggleCampus(c, campus.id);
  // Remove household bill income so the shortage remains controlled across months.
  for (const h of c.households) cash(c, 0, h.wallet);
  c = deserialize(serialize(c)); assert.equal(educationPayroll(c.education), 22400);
  for (const day of [90, 120, 150]) {
    until(c, day); c = deserialize(serialize(c));
    assert.equal(educationPayroll(c.education), 22400); assert.equal(payments(c).length, 0);
    assert.ok(c.households.some(h => h.wallet === wallet), 'an unpaid creditor keeps its identity'); reconcile(c);
  }
  cash(c, 27400); until(c, 180);
  assert.deepEqual(payments(c).map(e => e.amount), [22400]); assert.equal(educationPayroll(c.education), 0);
  c = deserialize(serialize(c)); until(c, 210); assert.equal(payments(c).length, 1); reconcile(c);
});

test('demolition rejects insufficient cash without mutation and settles earned claims once when funded', () => {
  const c = fixture(), campus = c.education!.campuses[0];
  campus.workDays[Object.keys(campus.workDays)[0]] = 16; cash(c, 1400);
  const before = serialize(c); assert.equal(bulldoze(c, campus.cell).ok, false); assert.equal(serialize(c), before);
  cash(c, 24400); assert.equal(bulldoze(c, campus.cell).ok, true);
  assert.equal(c.education!.campuses.length, 0); assert.deepEqual(payments(c).map(e => e.amount), [22400]);
  bulldoze(c, campus.cell); assert.equal(payments(c).length, 1); deserialize(serialize(c)); reconcile(c);
});

test('a late settlement exception rolls back every wallet, journal entry and earned claim', () => {
  const c = fixture(), campus = c.education!.campuses[0];
  const second = c.households.find(h => !Object.hasOwn(campus.workDays, h.wallet))!;
  campus.workDays[second.wallet] = 2;
  const before = serialize(c), push = c.ledger.push; let taxes = 0;
  c.ledger.push = function (...entries) {
    if (entries.some(e => e.reason === 'Monthly household wage tax') && ++taxes === 2) throw new Error('Synthetic journal failure');
    return push.apply(this, entries);
  };
  assert.throws(() => bulldoze(c, campus.cell), /Synthetic journal failure/);
  c.ledger.push = push;
  assert.equal(serialize(c), before); reconcile(c);
  assert.equal(bulldoze(c, campus.cell).ok, true); assert.deepEqual(payments(c).map(e => e.amount), [1400, 2800]);
  deserialize(serialize(c)); reconcile(c);
});

test('legacy education arrears preserve already reserved park pay and a loadable month-end', () => {
  const c = fixture(), campus = c.education!.campuses[0];
  const site = c.cells.findIndex((p, i) => !p.road && !p.zone && p.building === null && !c.plants.some(x => x.cell === i) && campus.cell !== i);
  assert.equal(buildPark(c, site).ok, true); step(c);
  const park = c.parks[0], days = Object.values(park.staffing!.workDays).reduce((n, d) => n + d, 0);
  assert.equal(days, 1);
  campus.workDays[Object.keys(campus.workDays)[0]] = 16;
  toggleCampus(c, campus.id); cash(c, 2800);
  for (const h of c.households) cash(c, 0, h.wallet);
  const loaded = deserialize(serialize(c)); until(c, 90); until(loaded, 90);
  assert.equal(serialize(c), serialize(loaded));
  assert.deepEqual(c.ledger.filter(e => e.reason === `Monthly park wages #${park.id}`).map(e => e.amount), [1400]);
  assert.deepEqual(park.staffing!.workDays, {}); assert.equal(educationPayroll(c.education), 22400);
  assert.equal(payments(c).length, 0); deserialize(serialize(c)); reconcile(c);
});
