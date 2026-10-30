/** Read-only cohort accounting. Not an allocator, person roster, schedule or save field. */
import type { City } from './sim.ts';
import type { WorkerSkill, WorkerSkills } from './labor.ts';

export const WORKFORCE_OCCUPATIONS = ['agriculture', 'manufacturing', 'retail', 'market-trading', 'park-maintenance', 'teacher', 'professor'] as const;
export type WorkforceOccupation = typeof WORKFORCE_OCCUPATIONS[number];
export type StudyRole = 'school-student' | 'university-student';
export type WorkplaceKey = `firm:${number}` | `park:${number}` | `campus:${number}`;
export type WorkforceAssignment = Readonly<{
  householdId: number; workplace: WorkplaceKey; count: number;
  role: WorkforceOccupation | StudyRole;
  relationship: 'employee' | 'owner-worker' | 'student';
  /** Education roles have no persisted occupational-skill intersection. */
  skill?: WorkerSkill;
}>;
export type WorkforceCounts = {
  population: number; workforce: number; dependents: number;
  economicWorkers: number; studying: number; unassignedWorkforce: number;
  occupiedWorkforce: number; employeeWorkers: number; ownerWorkers: number;
  schoolStudents: number; universityStudents: number;
};
export type HouseholdWorkforceSummary = Readonly<{
  householdId: number; counts: Readonly<WorkforceCounts>;
  skills: Readonly<WorkerSkills>; credentials: Readonly<{ basic: number; higher: number }>;
  /** Household ownership is not an additional person or an active work assignment. */
  ownedFirmIds: readonly number[]; assignments: readonly WorkforceAssignment[];
}>;
export type WorkplaceWorkforceSummary = Readonly<{
  key: WorkplaceKey; localWorkers: number; learners: number;
  externalTeachers: number; externalProfessors: number;
  assignments: readonly WorkforceAssignment[];
}>;
export type WorkforceIssue = Readonly<{
  code: 'invalid-count' | 'duplicate-household' | 'duplicate-workplace' | 'duplicate-education'
    | 'missing-household' | 'missing-workplace' | 'role-mismatch' | 'population-mismatch'
    | 'skill-total-mismatch' | 'skill-overallocated' | 'workforce-overallocated' | 'credential-mismatch';
  source: string; householdId?: number;
}>;
export type WorkforceSummary = Readonly<{
  counts: Readonly<WorkforceCounts>;
  occupations: Readonly<Record<WorkforceOccupation, number>>;
  externalEducators: Readonly<{ teachers: number; professors: number }>;
  byHousehold: ReadonlyMap<number, HouseholdWorkforceSummary>;
  byWorkplace: ReadonlyMap<WorkplaceKey, WorkplaceWorkforceSummary>;
  /** A game allocation ratio, not a labor-market unemployment statistic. */
  unassignedShare: number | null;
  reconciled: boolean; issues: readonly WorkforceIssue[];
}>;

const emptyCounts = (): WorkforceCounts => ({ population: 0, workforce: 0, dependents: 0, economicWorkers: 0,
  studying: 0, unassignedWorkforce: 0, occupiedWorkforce: 0, employeeWorkers: 0, ownerWorkers: 0,
  schoolStudents: 0, universityStudents: 0 });
const emptySkills = (): WorkerSkills => ({ general: 0, manufacturing: 0, retail: 0 });
type HouseholdRow = { householdId: number; counts: WorkforceCounts; skills: WorkerSkills;
  credentials: { basic: number; higher: number }; ownedFirmIds: number[]; assignments: WorkforceAssignment[]; assignedSkills: WorkerSkills };
type WorkplaceRow = { key: WorkplaceKey; localWorkers: number; learners: number;
  externalTeachers: number; externalProfessors: number; assignments: WorkforceAssignment[] };

/**
 * O(households + workplaces + allocation/cohort rows), not O(population).
 * Call at an observed state/revision boundary; no hidden cache, RNG, serialization,
 * ledger scan, simulation step or member-slot expansion. The returned data is detached.
 * Invalid inputs produce diagnostics, never a repaired city or clamped residual.
 * Consumers must check reconciled before treating the snapshot as authoritative.
 */
export function deriveWorkforceSummary(city: City): WorkforceSummary {
  const issues: WorkforceIssue[] = [];
  const issue = (code: WorkforceIssue['code'], source: string, householdId?: number) => issues.push({ code, source, ...(householdId === undefined ? {} : { householdId }) });
  const count = (value: number, source: string, householdId?: number): number => {
    if (!Number.isSafeInteger(value) || value < 0) { issue('invalid-count', source, householdId); return 0; }
    return value;
  };
  const households = new Map<number, HouseholdRow>();
  const workplaces = new Map<WorkplaceKey, WorkplaceRow>();
  const occupations = Object.fromEntries(WORKFORCE_OCCUPATIONS.map(role => [role, 0])) as Record<WorkforceOccupation, number>;
  const externalEducators = { teachers: 0, professors: 0 };
  const workplace = (key: WorkplaceKey): WorkplaceRow => {
    const previous = workplaces.get(key);
    if (previous) { issue('duplicate-workplace', key); return previous; }
    const row = { key, localWorkers: 0, learners: 0, externalTeachers: 0, externalProfessors: 0, assignments: [] };
    workplaces.set(key, row); return row;
  };
  const household = (id: number, source: string): HouseholdRow | undefined => {
    const row = households.get(id);
    if (!row) issue('missing-household', source, id);
    return row;
  };
  for (const h of city.households) {
    if (households.has(h.id)) { issue('duplicate-household', `household:${h.id}`, h.id); continue; }
    const counts = emptyCounts();
    counts.population = count(h.members, 'members', h.id);
    counts.workforce = count(h.workforce, 'workforce', h.id);
    counts.dependents = count(h.dependents, 'dependents', h.id);
    const skills = emptySkills();
    for (const skill of ['general', 'manufacturing', 'retail'] as const) skills[skill] = count(h.workerSkills[skill], `workerSkills.${skill}`, h.id);
    households.set(h.id, { householdId: h.id, counts, skills, credentials: { basic: 0, higher: 0 }, ownedFirmIds: [], assignments: [], assignedSkills: emptySkills() });
  }
  const firms = new Map(city.firms.map(f => [f.id, f]));
  for (const firm of city.firms) {
    workplace(`firm:${firm.id}`);
    if (firm.owner) household(firm.owner.householdId, `firm:${firm.id}.owner`)?.ownedFirmIds.push(firm.id);
  }
  for (const park of city.parks) workplace(`park:${park.id}`);
  const campuses = new Map(city.education?.campuses.map(campus => [campus.id, campus]) ?? []);
  for (const campus of city.education?.campuses ?? []) {
    const row = workplace(`campus:${campus.id}`), contracted = count(campus.contract, `${row.key}.contract`);
    if (campus.contract > 1) issue('invalid-count', `${row.key}.contract`);
    if (campus.kind === 'school') { row.externalTeachers += contracted; externalEducators.teachers += contracted; }
    else { row.externalProfessors += contracted; externalEducators.professors += contracted; }
  }
  const add = (assignment: WorkforceAssignment) => {
    const h = household(assignment.householdId, assignment.workplace), w = workplaces.get(assignment.workplace);
    if (!w) issue('missing-workplace', assignment.workplace, assignment.householdId);
    const n = count(assignment.count, `${assignment.workplace}.${assignment.role}`, assignment.householdId);
    if (!h || !w || n === 0) return;
    h.assignments.push(assignment); w.assignments.push(assignment);
    if (assignment.role === 'school-student' || assignment.role === 'university-student') {
      h.counts.studying += n; w.learners += n;
      h.counts[assignment.role === 'school-student' ? 'schoolStudents' : 'universityStudents'] += n;
    } else {
      h.counts.economicWorkers += n; w.localWorkers += n; occupations[assignment.role] += n;
      h.counts[assignment.relationship === 'owner-worker' ? 'ownerWorkers' : 'employeeWorkers'] += n;
      if (assignment.skill) h.assignedSkills[assignment.skill] += n;
    }
  };
  const firmRole = (id: number, householdId: number): WorkforceOccupation | null => {
    const firm = firms.get(id);
    if (!firm) { issue('missing-workplace', `firm:${id}`, householdId); return null; }
    return firm.zone === 'F' ? 'agriculture' : firm.zone === 'I' ? 'manufacturing' : firm.commercialKind === 'market' ? 'market-trading' : 'retail';
  };
  for (const allocation of city.employment) {
    const role = firmRole(allocation.firmId, allocation.householdId);
    if (role === null) continue;
    if (allocation.occupation !== (role === 'agriculture' || role === 'manufacturing' ? 'manufacturing' : 'retail') || role === 'market-trading') issue('role-mismatch', `firm:${allocation.firmId}.employment`, allocation.householdId);
    add({ householdId: allocation.householdId, workplace: `firm:${allocation.firmId}`, count: allocation.workers, role, relationship: 'employee', skill: allocation.skill });
  }
  for (const allocation of city.ownerLabor) {
    const role = firmRole(allocation.firmId, allocation.householdId);
    if (role === null) continue;
    if ((role !== 'retail' && role !== 'market-trading') || firms.get(allocation.firmId)?.owner?.householdId !== allocation.householdId || allocation.workers !== 1) issue('role-mismatch', `firm:${allocation.firmId}.ownerLabor`, allocation.householdId);
    add({ householdId: allocation.householdId, workplace: `firm:${allocation.firmId}`, count: allocation.workers, role, relationship: 'owner-worker', skill: allocation.skill });
  }
  for (const park of city.parks) for (const allocation of park.staffing?.allocations ?? []) {
    if (allocation.parkId !== park.id) issue('role-mismatch', `park:${park.id}.allocation`, allocation.householdId);
    add({ householdId: allocation.householdId, workplace: `park:${park.id}`, count: allocation.workers, role: 'park-maintenance', relationship: 'employee', skill: allocation.skill });
  }
  const educationHouseholds = new Set<number>();
  for (const person of city.education?.people ?? []) {
    if (educationHouseholds.has(person.householdId)) issue('duplicate-education', 'education.people', person.householdId);
    educationHouseholds.add(person.householdId);
    const h = household(person.householdId, 'education.people');
    if (!h) continue;
    const basic = count(person.basic, 'education.basic', person.householdId), higher = count(person.higher, 'education.higher', person.householdId);
    h.credentials.basic += basic; h.credentials.higher += higher;
    if (higher > basic || basic + person.school > h.counts.workforce || person.university + person.teacher > basic - higher || person.professor > higher) issue('credential-mismatch', 'education.people', person.householdId);
    for (const [field, role] of [['school', 'school-student'], ['university', 'university-student'], ['teacher', 'teacher'], ['professor', 'professor']] as const) {
      const n = count(person[field], `education.${field}`, person.householdId);
      if (n === 0) continue;
      const campus = person.campusId === null ? undefined : campuses.get(person.campusId);
      if (!campus) { issue('missing-workplace', 'education.campusId', person.householdId); continue; }
      if (campus.kind !== (field === 'school' || field === 'teacher' ? 'school' : 'university')) issue('role-mismatch', `campus:${campus.id}.${field}`, person.householdId);
      add({ householdId: person.householdId, workplace: `campus:${campus.id}`, count: n, role, relationship: field === 'school' || field === 'university' ? 'student' : 'employee' });
    }
  }
  const counts = emptyCounts();
  const byHousehold = new Map<number, HouseholdWorkforceSummary>();
  for (const h of households.values()) {
    const c = h.counts;
    c.occupiedWorkforce = c.economicWorkers + c.studying;
    c.unassignedWorkforce = c.workforce - c.occupiedWorkforce;
    if (c.population !== c.workforce + c.dependents) issue('population-mismatch', 'members', h.householdId);
    if (h.skills.general + h.skills.manufacturing + h.skills.retail !== c.workforce) issue('skill-total-mismatch', 'workerSkills', h.householdId);
    if (c.unassignedWorkforce < 0) issue('workforce-overallocated', 'assignments', h.householdId);
    for (const skill of ['general', 'manufacturing', 'retail'] as const) if (h.assignedSkills[skill] > h.skills[skill]) issue('skill-overallocated', `assignments.${skill}`, h.householdId);
    for (const key of Object.keys(counts) as (keyof WorkforceCounts)[]) counts[key] += c[key];
    const { assignedSkills: _, ...row } = h;
    byHousehold.set(h.householdId, row);
  }
  const denominator = counts.economicWorkers + counts.unassignedWorkforce;
  return { counts, occupations, externalEducators, byHousehold, byWorkplace: workplaces,
    unassignedShare: issues.length || denominator <= 0 ? null : counts.unassignedWorkforce / denominator,
    reconciled: issues.length === 0, issues };
}
