/**
 * Cohort education beside occupational workerSkills.
 * Diplomas are separate counts. There are no person records and no ages, so a
 * dependent is not treated as a pupil. A learner or educator reserves one
 * existing workforce count and cannot also hold a job that day.
 *
 * The numbers in EDUCATION_COST are provisional starting values, not a signed-off balance.
 */
import type { WorkerSkill, WorkerSkills } from './labor.ts';

export const EDUCATION_VERSION = 1 as const;
export const EDUCATION_RULES = 'education-1' as const;
export const EDUCATION_SUSTAIN_DAYS = 30;

type Level = { seats: number; staff: number; power: number; water: number };
const SCHOOL_LEVELS: readonly Level[] = Object.freeze([
  Object.freeze({ seats: 8, staff: 1, power: 1, water: 1 }),
  Object.freeze({ seats: 16, staff: 2, power: 2, water: 2 }),
]);
const UNIVERSITY_LEVELS: readonly Level[] = Object.freeze([
  Object.freeze({ seats: 4, staff: 1, power: 2, water: 1 }),
  Object.freeze({ seats: 8, staff: 2, power: 3, water: 2 }),
]);

export const EDUCATION_COST = Object.freeze({
  school: Object.freeze({ build: 200_000, upgrade: 150_000, upkeep: 5_000, studyDays: 60, contractCap: 2, levels: SCHOOL_LEVELS }),
  university: Object.freeze({ build: 400_000, upgrade: 250_000, upkeep: 8_000, studyDays: 90, contractCap: 1, levels: UNIVERSITY_LEVELS }),
  teacherDaily: 1_400,
  professorDaily: 2_000,
  contractTeacherDaily: 2_000,
  contractProfessorDaily: 2_800,
  maxSchools: 8,
  maxUniversities: 4,
});

export type EducationOrigin = 'new-city' | 'migrated-absent';
export type CampusKind = 'school' | 'university';
/** One household row. basic includes everyone with a school diploma, including higher, teachers and university students. */
export type EducationPeople = {
  householdId: number;
  basic: number;
  higher: number;
  school: number;
  university: number;
  teacher: number;
  professor: number;
  campusId: number | null;
  progress: number;
};
export type CampusReport = {
  nominalSeats: number;
  operatingSeats: number;
  enrolled: number;
  progressing: number;
  localStaff: number;
  requiredStaff: number;
  contract: 0 | 1;
  road: boolean;
  utility: boolean;
  open: boolean;
  reasons: string[];
};
export type Campus = {
  id: number;
  kind: CampusKind;
  cell: number;
  level: 1 | 2;
  tick: number;
  open: boolean;
  contract: 0 | 1;
  workDays: Record<string, number>;
  report: CampusReport;
};
export type EducationState = {
  version: typeof EDUCATION_VERSION;
  rules: typeof EDUCATION_RULES;
  origin: EducationOrigin;
  people: EducationPeople[];
  campuses: Campus[];
  schoolReadyDays: number;
  universityReadyDays: number;
  sustain: { buildingId: number; days: number }[];
  completed: { basic: number; higher: number };
  residentBasic: number;
  residentHigher: number;
};
export type EducationHousehold = { id: number; workforce: number; wallet: string; ownsFirm: boolean };
export type EducationBuilding = { id: number; zone: 'R' | 'C' | 'I' | 'F'; level: number; firmId: number | null };
export type EducationPost = { firmId: number; householdId: number; workers: number; owner: boolean };
export type EducationView = {
  tick: number;
  households: readonly EducationHousehold[];
  buildings: readonly EducationBuilding[];
  posts: readonly EducationPost[];
  road: (cell: number) => boolean;
  sparePower: number;
  spareWater: number;
  treasury: number;
};
export type EducationPayment = { amount: number; reason: string; kind: 'contract' | 'upkeep' };
export type EducationGate = { have: number; need: number; sustainDays: number; requiredDays: number; missing: string; blocked: string[] };

const blank = (householdId: number): EducationPeople => ({ householdId, basic: 0, higher: 0, school: 0, university: 0, teacher: 0, professor: 0, campusId: null, progress: 0 });

export function createEducation(origin: EducationOrigin): EducationState {
  return {
    version: EDUCATION_VERSION, rules: EDUCATION_RULES, origin, people: [], campuses: [],
    schoolReadyDays: 0, universityReadyDays: 0, sustain: [], completed: { basic: 0, higher: 0 },
    residentBasic: 0, residentHigher: 0,
  };
}

export function educationLevel(kind: CampusKind, level: number): Level {
  const table = kind === 'school' ? EDUCATION_COST.school.levels : EDUCATION_COST.university.levels;
  if (level !== 1 && level !== 2) throw new RangeError('Education level must be 1 or 2');
  return table[level - 1];
}

export function peopleOf(state: EducationState, householdId: number): EducationPeople {
  return state.people.find(row => row.householdId === householdId) ?? blank(householdId);
}

export function educationOccupied(state: EducationState | undefined, householdId: number): number {
  if (!state) return 0;
  const row = state.people.find(item => item.householdId === householdId);
  return row ? row.school + row.university + row.teacher + row.professor : 0;
}

export function subtractEducationReserve(skills: WorkerSkills, reserved: number): WorkerSkills {
  const next = { ...skills };
  let left = reserved;
  for (const skill of ['general', 'manufacturing', 'retail'] as const satisfies readonly WorkerSkill[]) {
    const take = Math.min(next[skill], left);
    next[skill] -= take;
    left -= take;
  }
  return next;
}

export function educationPayroll(state: EducationState | undefined): number {
  if (!state) return 0;
  return state.campuses.reduce((sum, campus) => {
    const wage = campus.kind === 'school' ? EDUCATION_COST.teacherDaily : EDUCATION_COST.professorDaily;
    return sum + Object.values(campus.workDays).reduce((days, value) => days + value, 0) * wage;
  }, 0);
}

function ensure(state: EducationState, householdId: number): EducationPeople {
  let found = state.people.find(item => item.householdId === householdId);
  if (!found) { found = blank(householdId); state.people.push(found); }
  return found;
}

function recount(state: EducationState): void {
  state.residentBasic = state.people.reduce((sum, item) => sum + item.basic, 0);
  state.residentHigher = state.people.reduce((sum, item) => sum + item.higher, 0);
  state.people = state.people.filter(item => item.basic + item.school + item.university + item.teacher + item.professor > 0);
}

function kindOf(state: EducationState, campusId: number | null): Campus | undefined {
  return campusId === null ? undefined : state.campuses.find(campus => campus.id === campusId);
}

function atCampus(person: EducationPeople, campus: Campus, role: 'school' | 'university' | 'teacher' | 'professor'): boolean {
  return person.campusId === campus.id && person[role] > 0;
}

function freeWorkers(view: EducationView, state: EducationState, household: EducationHousehold): number {
  return household.workforce - (household.ownsFirm ? 1 : 0) - educationOccupied(state, household.id);
}

function bind(person: EducationPeople, campusId: number): boolean {
  if (person.campusId !== null && person.campusId !== campusId) return false;
  person.campusId = campusId;
  return true;
}

export function stepEducation(state: EducationState, view: EducationView): EducationPayment[] {
  const payments: EducationPayment[] = [];
  let budget = view.treasury;
  let power = view.sparePower, water = view.spareWater;
  const served = new Map<number, boolean>();
  for (const campus of [...state.campuses].sort((a, b) => a.id - b.id)) {
    const need = educationLevel(campus.kind, campus.level);
    if (power >= need.power && water >= need.water) { power -= need.power; water -= need.water; served.set(campus.id, true); }
    else served.set(campus.id, false);
  }
  for (const campus of [...state.campuses].sort((a, b) => a.id - b.id)) {
    const level = educationLevel(campus.kind, campus.level);
    const role = campus.kind === 'school' ? 'teacher' : 'professor';
    const road = view.road(campus.cell);
    const utility = served.get(campus.id) === true;
    const reasons: string[] = [];
    if (!campus.open) reasons.push('พักบริการ');
    if (!road) reasons.push('ไม่มีถนนเชื่อมถึงเมือง');
    if (!utility) reasons.push('น้ำหรือไฟสำรองไม่พอ');
    const operable = campus.open && road && utility;
    if (!operable) {
      for (const person of state.people) if (person.campusId === campus.id) { person.teacher = 0; person.professor = 0; }
      campus.contract = 0;
    } else {
      const wage = campus.kind === 'school' ? EDUCATION_COST.teacherDaily : EDUCATION_COST.professorDaily;
      let local = 0;
      // Existing staff also need today's wage; releasing a shift never erases earned claims.
      for (const person of state.people.filter(person => atCampus(person, campus, role)).sort((a, b) => a.householdId - b.householdId)) {
        const funded = Math.min(person[role], Math.floor(budget / wage));
        person[role] = funded; local += funded; budget -= funded * wage;
      }
      while (local < level.staff) {
        if (budget < wage) break;
        const candidate = [...view.households].sort((a, b) => a.id - b.id).find(household => {
          const person = peopleOf(state, household.id);
          if (freeWorkers(view, state, household) <= 0) return false;
          if (role === 'teacher') return person.basic - person.higher - person.university - person.teacher > 0 && bind(person, campus.id);
          return person.higher - person.professor > 0 && bind(person, campus.id);
        });
        if (!candidate) break;
        const person = ensure(state, candidate.id);
        if (!bind(person, campus.id)) break;
        person[role]++;
        budget -= wage;
        local++;
      }
      const cap = campus.kind === 'school' ? EDUCATION_COST.school.contractCap : EDUCATION_COST.university.contractCap;
      const used = state.campuses.filter(item => item.kind === campus.kind && item.id !== campus.id && item.contract === 1).length;
      const contractDaily = campus.kind === 'school' ? EDUCATION_COST.contractTeacherDaily : EDUCATION_COST.contractProfessorDaily;
      campus.contract = local < level.staff && used < cap && budget >= contractDaily ? 1 : 0;
      if (campus.contract === 1) {
        budget -= contractDaily;
        payments.push({ kind: 'contract', amount: contractDaily, reason: campus.kind === 'school' ? `Outside contract teacher #${campus.id}` : `Outside contract professor #${campus.id}` });
      }
      if (local + campus.contract < level.staff) reasons.push(campus.kind === 'school' ? 'ขาดครู' : 'ขาดอาจารย์');
    }
    const localStaff = state.people.filter(person => atCampus(person, campus, role)).reduce((sum, person) => sum + person[role], 0);
    const staffed = localStaff + campus.contract >= level.staff;
    const seatFactor = campus.kind === 'school' ? 8 : 4;
    const operating = operable && staffed ? Math.min(level.seats, (localStaff + campus.contract) * seatFactor) : 0;
    let enrolled = 0;
    for (const household of [...view.households].sort((a, b) => a.id - b.id)) {
      const person = peopleOf(state, household.id);
      const held = campus.kind === 'school' ? person.school : person.university;
      if (held > 0 && person.campusId === campus.id) { enrolled += held; continue; }
      if (enrolled >= operating) continue;
      const pool = campus.kind === 'school' ? household.workforce - person.school - person.basic : person.basic - person.higher - person.university - person.teacher;
      const studyCap = household.workforce > 1 ? household.workforce - 1 : household.workforce;
      const take = Math.min(freeWorkers(view, state, household), pool, operating - enrolled, studyCap - person.school - person.university);
      if (take <= 0 || !bind(peopleOf(state, household.id), campus.id)) continue;
      const target = ensure(state, household.id);
      if (!bind(target, campus.id)) continue;
      if (campus.kind === 'school') target.school += take; else target.university += take;
      enrolled += take;
    }
    const studyDays = campus.kind === 'school' ? EDUCATION_COST.school.studyDays : EDUCATION_COST.university.studyDays;
    let slots = operating;
    for (const person of state.people.filter(item => (campus.kind === 'school' ? item.school : item.university) > 0 && item.campusId === campus.id).sort((a, b) => a.householdId - b.householdId)) {
      if (slots <= 0) break;
      const moving = Math.min(campus.kind === 'school' ? person.school : person.university, slots);
      slots -= moving;
      person.progress += 1;
      if (person.progress >= studyDays) {
        if (campus.kind === 'school') { person.school -= moving; person.basic += moving; state.completed.basic += moving; }
        else { person.university -= moving; person.higher += moving; state.completed.higher += moving; }
        person.progress = 0;
      }
    }
    if (operating > 0) {
      const wageRole = role;
      for (const person of state.people) {
        if (!atCampus(person, campus, wageRole)) continue;
        const household = view.households.find(item => item.id === person.householdId);
        if (!household) continue;
        campus.workDays[household.wallet] = (campus.workDays[household.wallet] ?? 0) + person[wageRole];
      }
    }
    campus.report = {
      nominalSeats: level.seats, operatingSeats: operating, enrolled, progressing: Math.max(0, operating === 0 ? 0 : Math.min(enrolled, operating)),
      localStaff, requiredStaff: level.staff, contract: campus.contract, road, utility, open: campus.open, reasons,
    };
  }
  // A closed day pauses the city apartment streak. It does not throw away days already counted.
  if (state.campuses.some(campus => campus.kind === 'school' && campus.report.operatingSeats > 0)) state.schoolReadyDays++;
  state.universityReadyDays = state.campuses.some(campus => campus.kind === 'university' && campus.report.operatingSeats > 0) ? state.universityReadyDays + 1 : 0;
  const seen = new Set<number>();
  for (const building of view.buildings) {
    seen.add(building.id);
    const ok = predicate(state, view, building).ok;
    let sustain = state.sustain.find(item => item.buildingId === building.id);
    if (!sustain) { sustain = { buildingId: building.id, days: 0 }; state.sustain.push(sustain); }
    sustain.days = ok ? sustain.days + 1 : 0;
  }
  state.sustain = state.sustain.filter(item => seen.has(item.buildingId));
  for (const person of state.people) {
    if (person.school + person.university + person.teacher + person.professor === 0) { person.campusId = null; person.progress = 0; }
    const campus = kindOf(state, person.campusId);
    if (person.campusId !== null && !campus) { person.school = person.university = person.teacher = person.professor = 0; person.campusId = null; person.progress = 0; }
  }
  recount(state);
  return payments;
}

function credentialPosts(state: EducationState, view: EducationView, firmId: number | null, rank: 'basic' | 'higher'): number {
  if (firmId === null) return 0;
  // A higher holder also has a basic diploma, but occupies only one post.
  // After education roles, allocate both ranks together in stable firm order;
  // querying a different firm's gate must not spend the same holder again.
  const pools = new Map(state.people.map(person => [person.householdId, {
    basicOnly: person.basic - person.higher - person.teacher - person.university,
    higher: person.higher - person.professor,
  }]));
  let total = 0;
  for (const post of [...view.posts].sort((a, b) => a.firmId - b.firmId || a.householdId - b.householdId)) {
    const pool = pools.get(post.householdId);
    if (!pool) continue;
    const workers = post.workers + (post.owner ? 1 : 0);
    const higher = Math.min(workers, pool.higher);
    const basicOnly = Math.min(workers - higher, pool.basicOnly);
    pool.higher -= higher; pool.basicOnly -= basicOnly;
    if (post.firmId === firmId) total += rank === 'higher' ? higher : higher + basicOnly;
  }
  return total;
}

function predicate(state: EducationState, view: EducationView, building: EducationBuilding): { ok: boolean; have: number; need: number; missing: string } {
  const next = building.level + 1;
  if (building.zone === 'R' && next <= 3) return { ok: true, have: state.residentBasic, need: 0, missing: '' };
  if (building.zone === 'R' && next <= 6) return { ok: state.residentBasic >= 1, have: state.residentBasic, need: 1, missing: 'ผู้ถือวุฒิพื้นฐานที่ยังอยู่ในเมือง' };
  if (building.zone === 'R') return { ok: state.residentHigher >= 1, have: state.residentHigher, need: 1, missing: 'ผู้ถือวุฒิขั้นสูงที่ยังอยู่ในเมือง' };
  if (building.zone === 'F' && next <= 3) return { ok: true, have: 0, need: 0, missing: '' };
  if (building.zone === 'I' && next <= 3) return { ok: true, have: 0, need: 0, missing: '' };
  if (building.zone === 'C' && next <= 4) return { ok: true, have: 0, need: 0, missing: '' };
  if (building.zone === 'F' || (building.zone === 'I' && next <= 6) || (building.zone === 'C' && next <= 6)) {
    const have = credentialPosts(state, view, building.firmId, 'basic');
    const missing = building.zone === 'F' ? 'แรงงานฟาร์มที่ถือวุฒิพื้นฐาน 1 คน' : building.zone === 'I' ? 'แรงงานโรงงานที่ถือวุฒิพื้นฐาน 1 คน' : 'คนทำงานร้านที่ถือวุฒิพื้นฐาน 1 คน';
    return { ok: have >= 1, have, need: 1, missing };
  }
  const have = credentialPosts(state, view, building.firmId, 'higher');
  return { ok: have >= 1, have, need: 1, missing: building.zone === 'I' ? 'แรงงานโรงงานที่ถือวุฒิขั้นสูง 1 คน' : 'คนทำงานร้านที่ถือวุฒิขั้นสูง 1 คน' };
}

export function educationGate(state: EducationState | undefined, view: EducationView | null, building: EducationBuilding): EducationGate {
  if (!state || !view) return { have: 0, need: 0, sustainDays: 0, requiredDays: 0, missing: '', blocked: [] };
  const check = predicate(state, view, building);
  if (check.need === 0) return { have: check.have, need: 0, sustainDays: 0, requiredDays: 0, missing: '', blocked: [] };
  const serviceDays = building.zone === 'R' && building.level + 1 <= 6 ? state.schoolReadyDays : building.zone === 'R' ? state.universityReadyDays : state.sustain.find(item => item.buildingId === building.id)?.days ?? 0;
  const blocked: string[] = [];
  if (!check.ok) blocked.push(`มี ${check.have}/${check.need} · ขาด${check.missing}`);
  if (building.zone === 'R' && serviceDays < EDUCATION_SUSTAIN_DAYS) blocked.push(`บริการการศึกษายังเปิดต่อเนื่อง ${serviceDays}/${EDUCATION_SUSTAIN_DAYS} วัน`);
  if (building.zone !== 'R' && serviceDays < EDUCATION_SUSTAIN_DAYS) blocked.push(`ต้องมีคนครบเงื่อนไขต่อเนื่องอีก ${EDUCATION_SUSTAIN_DAYS - serviceDays} วัน (${serviceDays}/${EDUCATION_SUSTAIN_DAYS})`);
  return { have: check.have, need: check.need, sustainDays: serviceDays, requiredDays: EDUCATION_SUSTAIN_DAYS, missing: check.missing, blocked };
}

export function educationUpkeep(state: EducationState): EducationPayment[] {
  return state.campuses.map(campus => ({ kind: 'upkeep' as const, amount: campus.kind === 'school' ? EDUCATION_COST.school.upkeep : EDUCATION_COST.university.upkeep, reason: campus.kind === 'school' ? `Monthly school upkeep #${campus.id}` : `Monthly university upkeep #${campus.id}` }));
}

/** Snapshot earned claims; only a successful payment may remove them. */
export function takeEducationWages(state: EducationState, wallet?: string, campusId?: number): { campus: Campus; wallet: string; amount: number }[] {
  const claims: { campus: Campus; wallet: string; amount: number }[] = [];
  for (const campus of state.campuses) {
    if (campusId !== undefined && campus.id !== campusId) continue;
    const wage = campus.kind === 'school' ? EDUCATION_COST.teacherDaily : EDUCATION_COST.professorDaily;
    for (const [claimWallet, days] of Object.entries(campus.workDays)) {
      if (wallet && claimWallet !== wallet) continue;
      claims.push({ campus, wallet: claimWallet, amount: days * wage });
    }
  }
  return claims;
}

export function forgetHouseholdEducation(state: EducationState, householdId: number): void {
  state.people = state.people.filter(item => item.householdId !== householdId);
  recount(state);
}

export function withdrawCampus(state: EducationState, campusId: number): Campus | undefined {
  const campus = state.campuses.find(item => item.id === campusId);
  if (!campus) return undefined;
  for (const person of state.people) {
    if (person.campusId !== campusId) continue;
    person.school = 0; person.university = 0; person.teacher = 0; person.professor = 0; person.campusId = null; person.progress = 0;
  }
  state.campuses = state.campuses.filter(item => item.id !== campusId);
  recount(state);
  return campus;
}

export function assertEducationInvariants(state: EducationState, households: readonly { id: number; workforce: number }[]): void {
  if (state.version !== EDUCATION_VERSION || state.rules !== EDUCATION_RULES) throw new Error('Invalid education rules');
  if (state.origin !== 'new-city' && state.origin !== 'migrated-absent') throw new Error('Invalid education origin');
  const ids = new Set<number>();
  for (const person of state.people) {
    if (!Number.isSafeInteger(person.householdId) || ids.has(person.householdId)) throw new Error('Duplicate education household');
    ids.add(person.householdId);
    for (const value of [person.basic, person.higher, person.school, person.university, person.teacher, person.professor, person.progress]) {
      if (!Number.isSafeInteger(value) || value < 0) throw new Error('Education counts must be nonnegative integers');
    }
    if (person.higher > person.basic) throw new Error('Higher credentials cannot exceed basic credentials');
    if (person.university + person.teacher > person.basic - person.higher) throw new Error('Teachers and university students must be disjoint basic holders');
    if (person.professor > person.higher) throw new Error('Professors must hold a higher credential');
    const household = households.find(item => item.id === person.householdId);
    if (!household) throw new Error('Education household is missing');
    if (person.school + person.basic > household.workforce) throw new Error('Schooling plus diplomas exceed workforce');
    if (person.school + person.university + person.teacher + person.professor > household.workforce) throw new Error('One workforce count is used twice');
    if ((person.school + person.university + person.teacher + person.professor) > 0 && (person.campusId === null || !state.campuses.some(campus => campus.id === person.campusId))) throw new Error('Active education role has no campus');
  }
  if (state.residentBasic !== state.people.reduce((sum, person) => sum + person.basic, 0) || state.residentHigher !== state.people.reduce((sum, person) => sum + person.higher, 0)) throw new Error('Resident credential totals drifted');
  const schools = state.campuses.filter(campus => campus.kind === 'school').length;
  const universities = state.campuses.filter(campus => campus.kind === 'university').length;
  if (schools > EDUCATION_COST.maxSchools || universities > EDUCATION_COST.maxUniversities) throw new Error('Too many campuses');
}

export function initialCampusReport(kind: CampusKind, level: 1 | 2): CampusReport {
  const table = educationLevel(kind, level);
  return { nominalSeats: table.seats, operatingSeats: 0, enrolled: 0, progressing: 0, localStaff: 0, requiredStaff: table.staff, contract: 0, road: false, utility: false, open: true, reasons: ['รอวันจำลองถัดไป'] };
}
