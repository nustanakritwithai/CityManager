import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCity, step, serialize, deserialize, buildCivic, buildPark, civicSiteReason, setCityBudget, budgetSummary, MONTH, type City } from '../src/sim.ts';
import { PARK } from '../src/parks.ts';
import { BUDGET_DEPARTMENTS, BUDGET_LEVELS, budgetLevel, validateBudget } from '../src/budget.ts';
import { CIVIC, civicCoverage, civicReach, civicFundedPoints, civicUpkeepReason } from '../src/civic/sites.ts';
import { homeAmenities } from '../src/resident-happiness.ts';
import { expandedCellCoordinate } from '../src/expanded-map-grid.ts';

const grown = () => { const c = createCity(61025); for (let i = 0; i < 40; i++) step(c); return c; };
const distance = (a: number, b: number) => { const x = expandedCellCoordinate(a), y = expandedCellCoordinate(b); return Math.abs(x.x - y.x) + Math.abs(x.z - y.z); };
const spotFor = (c: City, kind: 'clinic' | 'police', near: number) => c.cells.map((_, i) => i).filter(i => civicSiteReason(c, i, kind) === null).sort((a, b) => distance(a, near) - distance(b, near))[0];

test('a city that never touches the budget keeps a byte-identical save and full funding everywhere', () => {
  const c = grown(), before = serialize(c);
  assert.equal('budget' in c, false);
  for (const d of BUDGET_DEPARTMENTS) assert.equal(budgetLevel(c, d), 100);
  assert.equal(serialize(deserialize(before)), before);
});

test('setting a department back to 100% removes the section again', () => {
  const c = grown();
  assert.equal(setCityBudget(c, 'health', 50).ok, true); assert.deepEqual(c.budget, { version: 1, levels: { health: 50 } });
  assert.equal(setCityBudget(c, 'safety', 150).ok, true); assert.deepEqual(c.budget!.levels, { health: 50, safety: 150 });
  setCityBudget(c, 'health', 100); setCityBudget(c, 'safety', 100); assert.equal('budget' in c, false);
  assert.equal(setCityBudget(c, 'health', 60 as never).ok, false, 'only the five steps are allowed');
});

test('funding scales reach, happiness and the month-end bill of each service, and survives a save', () => {
  const c = grown(), home = c.buildings.find(b => b.zone === 'R')!.cell;
  assert.equal(buildCivic(c, spotFor(c, 'clinic', home), 'clinic').ok, true);
  const clinic = c.civic!.sites[0];
  setCityBudget(c, 'health', 50);
  assert.equal(civicReach(c, 'clinic'), Math.round(CIVIC.clinic.radius / 2)); assert.equal(civicFundedPoints(c, 'clinic'), Math.round(CIVIC.clinic.points / 2));
  setCityBudget(c, 'health', 150);
  assert.equal(civicReach(c, 'clinic'), Math.round(CIVIC.clinic.radius * 1.5)); assert.equal(civicFundedPoints(c, 'clinic'), Math.round(CIVIC.clinic.points * 1.5));
  assert.equal(civicReach(c, 'police'), CIVIC.police.radius, 'other departments are untouched');
  // A home just past the clinic's usual reach is covered only while health is funded above 100%.
  const edge = c.cells.map((_, i) => i).find(i => { const d = distance(i, clinic.cell); return d > CIVIC.clinic.radius && d <= civicReach(c, 'clinic'); })!;
  assert.equal(civicCoverage(c, edge, distance).clinic, true);
  setCityBudget(c, 'health', 100); assert.equal(civicCoverage(c, edge, distance).clinic, false);
  setCityBudget(c, 'health', 75);
  const saved = serialize(c); assert.equal(serialize(deserialize(saved)), saved); assert.deepEqual(deserialize(saved).budget, c.budget);
  while (c.tick % MONTH !== MONTH - 1) step(c);
  step(c);
  const bill = c.ledger.find(e => e.tick === c.tick && e.reason === civicUpkeepReason('clinic', clinic.id))!;
  assert.equal(bill.amount, Math.round(CIVIC.clinic.upkeep * 0.75));
  assert.equal(Object.values(c.accounts).reduce((a, b) => a + b, 0), 0);
});

test('park funding scales the park bonus, its reach and its upkeep, which the save validator accepts up to 150%', () => {
  const c = grown(), home = c.buildings.find(b => b.zone === 'R')!.cell;
  const spot = c.cells.map((_, i) => i).filter(i => buildPark(deserialize(serialize(c)), i).ok).sort((a, b) => distance(a, home) - distance(b, home))[0];
  assert.equal(buildPark(c, spot).ok, true);
  const near = homeAmenities(c, spot).points;
  setCityBudget(c, 'parks', 150); assert.equal(homeAmenities(c, spot).points, near + 5);
  setCityBudget(c, 'parks', 50); assert.equal(homeAmenities(c, spot).points, near - 5);
  setCityBudget(c, 'parks', 150);
  while (c.tick % MONTH !== MONTH - 1) step(c);
  step(c);
  assert.equal(c.ledger.find(e => e.tick === c.tick && e.reason === `Monthly park upkeep #${c.parks[0].id}`)!.amount, PARK.upkeep * 1.5);
  const saved = serialize(c); assert.equal(serialize(deserialize(saved)), saved);
  assert.deepEqual(budgetSummary(c).find(row => row.department === 'parks'), { department: 'parks', label: 'สวนสาธารณะ', level: 150, places: 1, base: PARK.upkeep, monthly: PARK.upkeep * 1.5 });
});

test('a malformed budget section is rejected', () => {
  for (const bad of [null, [], { version: 2, levels: { health: 50 } }, { version: 1 }, { version: 1, levels: {} }, { version: 1, levels: { health: 100 } }, { version: 1, levels: { health: 60 } }, { version: 1, levels: { roads: 50 } }, { version: 1, levels: { health: 50 }, extra: 1 }])
    assert.throws(() => validateBudget(bad), /Invalid budget save/, JSON.stringify(bad));
  for (const level of BUDGET_LEVELS) if (level !== 100) validateBudget({ version: 1, levels: { culture: level } });
  const c = grown(), raw = JSON.parse(serialize(c)); raw.budget = { version: 1, levels: { health: 60 } };
  assert.throws(() => deserialize(JSON.stringify(raw)), /Invalid budget save/);
});
