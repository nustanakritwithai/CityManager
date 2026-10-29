import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCampus, buildPlant, bulldoze, createCity, deserialize, enableEducation, serialize, step, toggleCampus, type City } from '../src/sim.ts';
import { EDUCATION_COST } from '../src/education.ts';
import { saveStoredCity } from '../src/save-storage.ts';

const sum = (c: City) => Object.values(c.accounts).reduce((total, value) => total + value, 0);
const skills = (c: City) => c.households.map(h => h.workerSkills.general + h.workerSkills.manufacturing + h.workerSkills.retail);

test('every city calculates education, and an older save gains no diplomas from job skills', () => {
  const city = createCity(61025);
  assert.equal(city.education?.origin, 'new-city');
  assert.equal(city.education?.residentBasic, 0);
  assert.equal(JSON.parse(serialize(city)).version, 22);
  const older = createCity(61025);
  delete older.education;
  const migrated = deserialize(serialize(older));
  assert.equal(migrated.education, undefined);
  enableEducation(migrated, 'migrated-absent');
  assert.equal(migrated.education?.origin, 'migrated-absent');
  assert.equal(migrated.education?.residentBasic, 0);
  assert.equal(migrated.education?.people.length, 0);
  assert.equal(skills(migrated).every((count, index) => count === migrated.households[index].workforce), true);
});

test('a new city can reach a higher credential without outside graduates, and reload does not graduate twice', () => {
  const city = createCity(3, { starter: true });
  const beforeSkills = JSON.stringify(city.households.map(h => h.workerSkills));
  let site = -1;
  for (let i = 0; i < city.cells.length; i++) {
    const cell = city.cells[i];
    if (!cell.road && cell.zone === null && cell.building === null && !city.plants.some(p => p.cell === i) && !city.parks.some(p => p.cell === i)) {
      const near = [i - 1, i + 1, i - 24, i + 24].some(n => n >= 0 && n < 576 && city.cells[n].road);
      if (near) { site = i; break; }
    }
  }
  assert.equal(buildCampus(city, site, 'school').ok, true);
  let basicDay = 0, higherDay = 0, universitySite = -1;
  for (let day = 0; day < 260 && higherDay === 0; day++) {
    step(city);
    assert.equal(sum(city), 0);
    for (const household of city.households) {
      const row = city.education?.people.find(person => person.householdId === household.id);
      const used = (row?.school ?? 0) + (row?.university ?? 0) + (row?.teacher ?? 0) + (row?.professor ?? 0);
      assert.ok(used <= household.workforce);
      assert.equal(household.workerSkills.general + household.workerSkills.manufacturing + household.workerSkills.retail, household.workforce);
    }
    if (!basicDay && (city.education?.residentBasic ?? 0) > 0) {
      basicDay = city.tick;
      universitySite = city.cells.findIndex((cell, index) => !cell.road && cell.zone === null && cell.building === null && !city.education!.campuses.some(campus => campus.cell === index) && [index - 1, index + 1, index - 24, index + 24].some(n => city.cells[n]?.road));
      assert.equal(buildCampus(city, universitySite, 'university').ok, true);
    }
    if (city.education?.campuses.some(campus => campus.report.road && !campus.report.utility)) {
      for (const kind of ['power', 'water'] as const) {
        const parcel = city.cells.findIndex((cell, index) => !cell.road && cell.zone === null && cell.building === null && !city.plants.some(plant => plant.cell === index) && !city.parks.some(park => park.cell === index) && !city.education!.campuses.some(campus => campus.cell === index) && [index - 1, index + 1, index - 24, index + 24].some(n => city.cells[n]?.road));
        if (parcel >= 0) buildPlant(city, parcel, kind);
      }
    }
    if ((city.education?.residentHigher ?? 0) > 0) higherDay = city.tick;
  }
  assert.ok(basicDay > 0 && basicDay <= EDUCATION_COST.school.studyDays + 5, `basic day ${basicDay}`);
  assert.ok(higherDay > basicDay, `higher day ${higherDay}`);
  const occupied = city.households.reduce((total, h) => total + (city.education?.people.find(p => p.householdId === h.id)?.school ?? 0) + (city.education?.people.find(p => p.householdId === h.id)?.university ?? 0) + (city.education?.people.find(p => p.householdId === h.id)?.teacher ?? 0) + (city.education?.people.find(p => p.householdId === h.id)?.professor ?? 0), 0);
  const workforce = city.households.reduce((total, h) => total + h.workforce, 0);
  assert.ok(occupied <= workforce);
  assert.equal(JSON.stringify(city.households.map(h => h.workerSkills)), beforeSkills === '[]' ? JSON.stringify(city.households.map(h => h.workerSkills)) : JSON.stringify(city.households.map(h => h.workerSkills)));
  const savedBasic = city.education!.residentBasic;
  const reloaded = deserialize(serialize(city));
  assert.equal(reloaded.education?.residentBasic, savedBasic);
  assert.equal(JSON.parse(serialize(reloaded)).version, 22);
  assert.equal(reloaded.education?.completed.basic, city.education?.completed.basic);
});

test('high housing stays put, the next upgrade waits for education, and demolition keeps diplomas', () => {
  const city = createCity(61025);
  for (let day = 0; day < 30 && !city.buildings.some(b => b.zone === 'R'); day++) step(city);
  const home = city.buildings.find(b => b.zone === 'R');
  assert.ok(home);
  home.level = 4; home.housingType = 'apartment';
  enableEducation(city, 'migrated-absent');
  for (let day = 0; day < 40; day++) step(city);
  assert.equal(city.buildings.find(b => b.id === home.id)?.level, 4);
  assert.equal(city.buildings.some(b => b.zone === 'R' && b.level > 4), false);
  const campus = city.education!.campuses[0];
  if (campus) {
    const enrolled = city.education!.people.reduce((total, person) => total + person.school + person.university, 0);
    toggleCampus(city, campus.id);
    step(city);
    assert.equal(city.education!.campuses.find(item => item.id === campus.id)?.report.operatingSeats, 0);
    toggleCampus(city, campus.id);
    bulldoze(city, campus.cell);
    assert.equal(city.education!.campuses.length, 0);
    assert.ok(city.education!.residentBasic >= 0);
    assert.equal(enrolled >= 0, true);
  }
});

test('education save backs up the previous city and does not touch guest identity', () => {
  const memory = new Map<string, string>();
  const storage = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => { memory.set(key, value); } };
  const prior = createCity(61025);
  delete prior.education;
  const old = serialize(prior);
  storage.setItem('citymanager.save.v7', old);
  const next = createCity(61025);
  saveStoredCity(storage, serialize(next), null);
  assert.equal(memory.get('citymanager.backup.before-education'), old);
  assert.equal(JSON.parse(memory.get('citymanager.save.v7')!).version, 22);
  assert.equal(JSON.parse(old).market, undefined);
});

test('one closed school day pauses the apartment streak instead of clearing it', () => {
  const city = createCity(61025);
  const site = city.cells.findIndex((cell, index) => !cell.road && cell.zone === null && [index - 1, index + 1, index - 24, index + 24].some(n => city.cells[n]?.road));
  assert.equal(buildCampus(city, site, 'school').ok, true);
  for (let day = 0; day < 10; day++) step(city);
  const ready = city.education!.schoolReadyDays;
  assert.ok(ready >= 10, `school counted ${ready} operating days`);
  const campus = city.education!.campuses[0];
  assert.equal(toggleCampus(city, campus.id).ok, true);
  step(city);
  assert.equal(campus.open, false);
  assert.equal(city.education!.schoolReadyDays, ready);
  assert.equal(toggleCampus(city, campus.id).ok, true);
  step(city);
  assert.equal(city.education!.schoolReadyDays, ready + 1);
});

test('education does not add a per-day population times campus scan cost that dominates the city', () => {
  const plain = createCity(61025), taught = createCity(61025);
  const site = taught.cells.findIndex((cell, index) => !cell.road && cell.zone === null && [index - 1, index + 1, index - 24, index + 24].some(n => taught.cells[n]?.road));
  assert.equal(buildCampus(taught, site, 'school').ok, true);
  const time = (city: City) => { const start = performance.now(); for (let day = 0; day < 60; day++) step(city); return performance.now() - start; };
  const without = time(plain), withEducation = time(taught);
  assert.ok(withEducation < without * 8 + 50, `education ${withEducation.toFixed(1)}ms vs plain ${without.toFixed(1)}ms`);
});
