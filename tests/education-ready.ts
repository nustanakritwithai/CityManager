import { EDUCATION_SUSTAIN_DAYS, initialCampusReport } from '../src/education.ts';
import { SIZE, utilities, type City } from '../src/sim.ts';

const besideRoad = (city: City, index: number) => {
  const x = index % SIZE;
  return [index - 1, index + 1, index - SIZE, index + SIZE].some((next, side) => next >= 0 && next < city.cells.length && city.cells[next]?.road && (side === 0 ? x > 0 : side === 1 ? x < SIZE - 1 : true));
};

/** Keep upgrade gates open for an economy test that is measuring profit, cash, and occupancy.
 * Diplomas and a staffed campus are test setup. This is not a player switch. */
export function holdEducationReady(city: City): void {
  const education = city.education;
  if (!education) return;
  const spare = utilities(city).spare;
  if (spare.power < 6) city.utilities.outside.power += 6 - spare.power;
  if (spare.water < 6) city.utilities.outside.water += 6 - spare.water;
  for (const kind of ['school', 'university'] as const) {
    if (education.campuses.some(campus => campus.kind === kind)) continue;
    const cell = city.cells.findIndex((item, index) => !item.road && item.zone === null && item.building === null && besideRoad(city, index));
    if (cell < 0) continue;
    city.cells[cell].zone = null;
    education.campuses.push({ id: city.nextId++, kind, cell, level: 1, tick: city.tick, open: true, contract: 0, workDays: {}, report: initialCampusReport(kind, 1) });
  }
  education.schoolReadyDays = EDUCATION_SUSTAIN_DAYS;
  education.universityReadyDays = EDUCATION_SUSTAIN_DAYS;
  for (const household of city.households) {
    let person = education.people.find(item => item.householdId === household.id);
    if (!person) {
      person = { householdId: household.id, basic: 0, higher: 0, school: 0, university: 0, teacher: 0, professor: 0, campusId: null, progress: 0 };
      education.people.push(person);
    }
    if (person.school + person.university + person.teacher + person.professor > 0) continue;
    person.basic = household.workforce;
    person.higher = household.workforce;
    person.campusId = null;
    person.progress = 0;
  }
  education.residentBasic = education.people.reduce((sum, person) => sum + person.basic, 0);
  education.residentHigher = education.people.reduce((sum, person) => sum + person.higher, 0);
  education.sustain = city.buildings.map(building => ({ buildingId: building.id, days: EDUCATION_SUSTAIN_DAYS }));
}

export function dropEducation(city: City): City {
  delete city.education;
  return city;
}
