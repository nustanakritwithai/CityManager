import test from 'node:test';
import assert from 'node:assert/strict';
import { createCity, step, serialize, deserialize, buildCivic, civicSiteReason, buildCampus, buildPark, buildPlant, bulldoze, access, MONTH, SIZE, TEACHER_PAY_SUBSIDY_REASON } from '../src/sim.ts';
import { CIVIC, civicAt, civicFeeReason, civicWageReason, venueStaff, REAL_VENUE_STAFF } from '../src/civic/sites.ts';
import { parkStaff, PARK_STAFF, REAL_PARK_STAFF } from '../src/parks.ts';
import { educationWages, REAL_EDUCATION_WAGES, LEGACY_EDUCATION_WAGES } from '../src/education.ts';
import { treasuryBudget } from '../src/overview-data.ts';
import { legacyWages } from './legacy-sizes.ts';
import { keepSupplied } from './plants.ts';

/** Real baht a month of a daily game wage in satang, at 18.5 real baht to one. */
const real = (satangPerDay: number) => satangPerDay * MONTH / 100 * 18.5;
const distance = (a: number, b: number) => Math.abs(a % SIZE - b % SIZE) + Math.abs(Math.floor(a / SIZE) - Math.floor(b / SIZE));

test('teachers, professors, park keepers and venue staff earn the real average of their trade, a whole satang a day', () => {
  for (const [daily, actual] of [
    [REAL_EDUCATION_WAGES.teacherDaily, 23_202.68], [REAL_EDUCATION_WAGES.professorDaily, 28_156.82], [REAL_PARK_STAFF.dailyWage, 14_010.77],
    [REAL_VENUE_STAFF.restaurant!.dailyWage, 12_511.87], [REAL_VENUE_STAFF.nightmarket!.dailyWage, 12_511.87],
    [REAL_VENUE_STAFF.cinema!.dailyWage, 13_831.06], [REAL_VENUE_STAFF.concert!.dailyWage, 13_831.06],
  ] as const) assert.ok(Math.abs(real(daily) - actual) < 10, `${real(daily)} against ${actual}`);
  assert.equal(REAL_PARK_STAFF.monthlyWage, REAL_PARK_STAFF.dailyWage * MONTH);
  assert.equal(Math.round(REAL_VENUE_STAFF.cinema!.fee / 100 * 18.5), 198, 'a cinema seat about 200 baht');
  const c = createCity(61025), old = legacyWages(createCity(61025));
  assert.deepEqual(educationWages(c), REAL_EDUCATION_WAGES); assert.deepEqual(educationWages(old), LEGACY_EDUCATION_WAGES);
  assert.equal(parkStaff(c), REAL_PARK_STAFF); assert.equal(parkStaff(old), PARK_STAFF);
  assert.equal(venueStaff('cinema', old), CIVIC.cinema.staff);
  assert.deepEqual(venueStaff('cinema', c), { ...CIVIC.cinema.staff, ...REAL_VENUE_STAFF.cinema });
});

test('a restaurant charges a real meal and pays its staff the real wage of food service', { timeout: 300_000 }, () => {
  const c = createCity(61025); for (let d = 0; d < 60; d++) { step(c); keepSupplied(c); }
  const home = c.buildings.find(b => b.zone === 'R')!.cell;
  for (const b of c.buildings.filter(b => b.zone === 'I' || b.zone === 'F')) assert.equal(bulldoze(c, b.cell).ok, true);
  const cell = c.cells.map((_, i) => i).filter(i => civicSiteReason(c, i, 'restaurant') === null).sort((a, b) => distance(a, home) - distance(b, home))[0];
  assert.equal(buildCivic(c, cell, 'restaurant').ok, true);
  for (let d = 0; d < MONTH + 2; d++) { step(c); keepSupplied(c); }
  const site = civicAt(c, cell)!, staff = venueStaff('restaurant', c)!;
  const fees = c.ledger.filter(e => e.reason === civicFeeReason('restaurant', site.id)), wages = c.ledger.filter(e => e.reason === civicWageReason('restaurant', site.id));
  assert.ok(fees.length > 0 && wages.length > 0);
  for (const e of fees) assert.equal(e.amount, staff.fee);
  for (const e of wages) assert.equal(e.amount % staff.dailyWage, 0);
  assert.deepEqual(deserialize(serialize(c)), c);
});

test('the national government sends back what the town pays its teachers', { timeout: 300_000 }, () => {
  const c = createCity(3), wages = educationWages(c);
  const site = () => c.cells.findIndex((p, i) => !p.road && !p.zone && p.building === null && !c.plants.some(x => x.cell === i) && !c.education!.campuses.some(x => x.cell === i) && access(c, i));
  assert.equal(buildCampus(c, site(), 'school').ok, true);
  for (let n = 0; n < 240; n++) {
    step(c);
    if (c.education!.campuses.some(p => !p.report.utility)) for (const kind of ['power', 'water'] as const) buildPlant(c, site(), kind);
  }
  const school = c.ledger.filter(e => /^Monthly school wages #/.test(e.reason)), contracts = c.ledger.filter(e => /^Outside contract teacher #/.test(e.reason));
  assert.ok(school.length + contracts.length > 0, 'the school paid its teachers');
  for (const e of school) assert.equal(e.amount % wages.teacherDaily, 0);
  for (const e of contracts) assert.equal(e.amount, wages.contractTeacherDaily);
  const subsidy = c.ledger.filter(e => e.reason === TEACHER_PAY_SUBSIDY_REASON);
  for (const e of subsidy) { assert.equal(e.from, 'outside'); assert.equal(e.to, 'treasury'); }
  const byTick = (rows: typeof c.ledger) => { const m = new Map<number, number>(); for (const e of rows) m.set(e.tick, (m.get(e.tick) ?? 0) + e.amount); return m; };
  const paid = byTick([...school, ...contracts]), back = byTick(subsidy);
  for (const [tick, amount] of paid) assert.equal(back.get(tick), amount, `day ${tick}: the subsidy matches the teacher pay`);
  const budget = treasuryBudget(c), line = (rows: readonly { key: string; amount: number }[], key: string) => rows.find(l => l.key === key)?.amount ?? 0;
  assert.equal(line(budget.income, 'teacher-subsidy'), line(budget.expense, 'education-wages'), 'the budget shows the subsidy against the teacher pay');
  const raw = serialize(c); assert.deepEqual(deserialize(raw), c);
  const forged = JSON.parse(raw), extra = forged.ledger.findLast((e: { reason: string }) => e.reason === TEACHER_PAY_SUBSIDY_REASON);
  extra.amount += 100; forged.accounts.treasury += 100; forged.accounts.outside -= 100;
  assert.throws(() => deserialize(JSON.stringify(forged)), 'a subsidy above the teacher pay');
  // A city saved before pays its teachers itself.
  const old = legacyWages(createCity(3));
  assert.equal(buildCampus(old, old.cells.findIndex((p, i) => !p.road && !p.zone && p.building === null && access(old, i)), 'school').ok, true);
  for (let n = 0; n < 120; n++) step(old);
  assert.equal(old.ledger.filter(e => e.reason === TEACHER_PAY_SUBSIDY_REASON).length, 0);
});

test('a park keeper is paid the real wage of support services, and a save paying the old rate is rejected', { timeout: 300_000 }, () => {
  const c = createCity(61025); for (let d = 0; d < 30; d++) { step(c); keepSupplied(c); }
  const cell = c.cells.findIndex((p, i) => !p.road && !p.zone && p.building === null && !c.plants.some(x => x.cell === i) && access(c, i));
  assert.equal(buildPark(c, cell).ok, true);
  // Wait for the first month the park had a keeper: parks hire from the labour farms and firms leave.
  let paid: typeof c.ledger = [];
  for (let d = 0; d < MONTH * 4 && !paid.length; d++) { step(c); keepSupplied(c); paid = c.ledger.filter(e => e.tick === c.tick && /^Monthly park wages #/.test(e.reason)); }
  assert.ok(paid.length > 0, 'the park keeper was paid');
  for (const e of paid) assert.equal(e.amount % REAL_PARK_STAFF.dailyWage, 0);
  const raw = serialize(c); assert.deepEqual(deserialize(raw), c);
  const bad = JSON.parse(raw), e = bad.ledger.findLast((x: { reason: string }) => /^Monthly park wages #/.test(x.reason)), cut = e.amount - (e.amount / REAL_PARK_STAFF.dailyWage) * PARK_STAFF.dailyWage;
  e.amount -= cut; bad.accounts.treasury += cut; bad.accounts[e.to] -= cut;
  assert.throws(() => deserialize(JSON.stringify(bad)), 'park wages at the old rate');
});
