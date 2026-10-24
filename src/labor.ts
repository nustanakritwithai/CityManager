/** Disjoint worker-count pools belong to households; there are no person agents. */
export type Occupation = 'manufacturing' | 'retail';
export type EmploymentRank = 'entry';
export type WorkerSkill = 'general' | 'manufacturing' | 'retail';
export type WorkerSkills = { general: number; manufacturing: number; retail: number };
export type EmploymentAllocation = { householdId: number; firmId: number; occupation: Occupation; rank: EmploymentRank; skill: WorkerSkill; workers: number };
export type LaborHousehold = { id: number; workforce: number; workerSkills: WorkerSkills; accessible: boolean };
export type LaborOffer = { id: number; zone: 'I' | 'C'; slots: number; budgetWorkers: number };
export const OCCUPATION_BY_ZONE = Object.freeze({ I: 'manufacturing', C: 'retail' } as const);
export const EMPLOYMENT_RANKS = Object.freeze(['entry'] as const);
export const WORKER_SKILLS = Object.freeze(['general', 'manufacturing', 'retail'] as const);
export const skillEligible = (skill: WorkerSkill, occupation: Occupation): boolean => skill === 'general' || skill === occupation;
type HouseholdState = { id: number; remaining: WorkerSkills };
type OfferState = { id: number; occupation: Occupation; remaining: number };
function count(value: number, label: string, minimum = 0): void {
  if (!Number.isSafeInteger(value) || value < minimum) throw new RangeError(label + ' must be a safe integer >= ' + minimum);
}
function record(value: unknown, label: string): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(label + ' must be a record');
}
function array(value: unknown): void { if (!Array.isArray(value)) throw new TypeError('Labor inputs must be arrays'); }
export function validateWorkerSkills(skills: WorkerSkills, workforce: number): void {
  record(skills, 'Worker skills'); count(workforce, 'Household workforce');
  if (Object.keys(skills).length !== WORKER_SKILLS.length || Object.keys(skills).some(key => !WORKER_SKILLS.includes(key as WorkerSkill))) throw new TypeError('Worker skills must contain exactly general, manufacturing and retail');
  // Subtraction avoids an unsafe intermediate sum near MAX_SAFE_INTEGER.
  let remaining = workforce;
  for (const skill of WORKER_SKILLS) {
    count(skills[skill], 'Worker skill count');
    if (skills[skill] > remaining) throw new RangeError('Worker skills must sum exactly to workforce');
    remaining -= skills[skill];
  }
  if (remaining !== 0) throw new RangeError('Worker skills must sum exactly to workforce');
}
/**
 * Match aggregate skill counts, never entire families or person agents.
 *
 * Restricted pools fill matching occupations before general workers; within each
 * pool valid prior jobs are retained before ID-ordered vacancies are filled.
 * This maximizes eligible employment for this two-occupation eligibility catalog.
 * Then surplus workers may move to a new eligible employer with a genuinely free
 * funded seat. Other households are not evicted for diversity, and each source
 * employer retains at least one worker from that household.
 *
 * Each move uses whole-count arithmetic. Diversification is bounded by new
 * household/employer edges, not population count, and reaches a fixed point.
 * Its bounded entity-pair scans are not a million-population performance claim.
 * Missing references/incompatible old jobs are stale and ignored; malformed
 * records throw. Duplicate old triples coalesce within real pool/capacity.
 * No caller object, money, inventory or earned wage claim is mutated.
 */
export function allocateEmployment(households: readonly LaborHousehold[], offers: readonly LaborOffer[], previous: readonly EmploymentAllocation[]): EmploymentAllocation[] {
  array(households); array(offers); array(previous);
  const householdById = new Map<number, HouseholdState>();
  for (const h of households) {
    record(h, 'Household'); count(h.id, 'Household ID', 1); validateWorkerSkills(h.workerSkills, h.workforce);
    if (typeof h.accessible !== 'boolean') throw new TypeError('Household accessible must be boolean');
    if (householdById.has(h.id)) throw new TypeError('Duplicate household ID ' + h.id);
    householdById.set(h.id, { id: h.id, remaining: h.accessible ? { ...h.workerSkills } : { general: 0, manufacturing: 0, retail: 0 } });
  }
  const offerById = new Map<number, OfferState>();
  for (const f of offers) {
    record(f, 'Offer'); count(f.id, 'Firm ID', 1); count(f.slots, 'Offer slots'); count(f.budgetWorkers, 'Offer budgetWorkers');
    if (f.zone !== 'I' && f.zone !== 'C') throw new TypeError('Offer zone must be I or C');
    if (offerById.has(f.id)) throw new TypeError('Duplicate firm ID ' + f.id);
    offerById.set(f.id, { id: f.id, occupation: OCCUPATION_BY_ZONE[f.zone], remaining: Math.min(f.slots, f.budgetWorkers) });
  }
  for (const a of previous) {
    record(a, 'Prior allocation'); count(a.householdId, 'Prior household ID', 1); count(a.firmId, 'Prior firm ID', 1); count(a.workers, 'Prior workers', 1);
    if (a.occupation !== 'manufacturing' && a.occupation !== 'retail') throw new TypeError('Prior occupation must be manufacturing or retail');
    if (a.rank !== 'entry') throw new TypeError('Prior rank must be entry');
    if (!WORKER_SKILLS.includes(a.skill)) throw new TypeError('Prior worker skill is invalid');
  }
  const allocations = new Map<string, EmploymentAllocation>();
  const keyFor = (h: number, f: number, s: WorkerSkill) => h + ':' + f + ':' + s;
  const add = (householdId: number, offer: OfferState, skill: WorkerSkill, workers: number): void => {
    const key = keyFor(householdId, offer.id, skill), existing = allocations.get(key);
    if (existing) existing.workers += workers;
    else allocations.set(key, { householdId, firmId: offer.id, occupation: offer.occupation, rank: 'entry', skill, workers });
  };
  const assign = (h: HouseholdState, f: OfferState, skill: WorkerSkill, requested: number): void => {
    if (!skillEligible(skill, f.occupation)) return;
    const workers = Math.min(requested, h.remaining[skill], f.remaining);
    if (workers <= 0) return;
    add(h.id, f, skill, workers); h.remaining[skill] -= workers; f.remaining -= workers;
  };
  const hs = [...householdById.values()].sort((a, b) => a.id - b.id);
  const fs = [...offerById.values()].sort((a, b) => a.id - b.id);
  const prior = [...previous].sort((a, b) => a.householdId - b.householdId || a.firmId - b.firmId || a.skill.localeCompare(b.skill));
  for (const skill of ['manufacturing', 'retail', 'general'] as const) {
    for (const a of prior) {
      if (a.skill !== skill) continue;
      const h = householdById.get(a.householdId), f = offerById.get(a.firmId);
      if (h && f && a.occupation === f.occupation) assign(h, f, skill, a.workers);
    }
    const eligible = fs.filter(f => skillEligible(skill, f.occupation));
    let hi = 0, fi = 0;
    while (hi < hs.length && fi < eligible.length) {
      const h = hs[hi], f = eligible[fi]; assign(h, f, skill, h.remaining[skill]);
      if (h.remaining[skill] === 0) hi++;
      if (f.remaining === 0) fi++;
    }
  }
  // Only add employer edges, never remove a household's last worker at a source.
  // Thus at most H*F successful edge additions occur before a stable result.
  let changed = true;
  while (changed) {
    changed = false;
    for (const h of hs) {
      const rows = [...allocations.values()].filter(a => a.householdId === h.id);
      const employers = new Map<number, number>();
      for (const a of rows) employers.set(a.firmId, (employers.get(a.firmId) ?? 0) + a.workers);
      if (![...employers.values()].some(n => n > 1)) continue;
      const targets = fs.filter(f => f.remaining > 0 && !employers.has(f.id) && rows.some(a => skillEligible(a.skill, f.occupation) && (employers.get(a.firmId) ?? 0) > 1));
      if (!targets.length) continue;
      const total = [...employers.values()].reduce((sum, n) => sum + n, 0), divisor = employers.size + targets.length;
      const share = Math.floor(total / divisor) + (total % divisor ? 1 : 0);
      for (const target of targets) {
        let wanted = Math.min(share, target.remaining), moved = 0;
        const sources = [...allocations.values()].filter(a => a.householdId === h.id && a.firmId !== target.id && skillEligible(a.skill, target.occupation))
          .sort((a, b) => (employers.get(b.firmId) ?? 0) - (employers.get(a.firmId) ?? 0) || a.firmId - b.firmId || a.skill.localeCompare(b.skill));
        for (const source of sources) {
          const workers = Math.min(wanted, source.workers, Math.max(0, (employers.get(source.firmId) ?? 0) - 1));
          if (workers <= 0) continue;
          source.workers -= workers;
          if (source.workers === 0) allocations.delete(keyFor(source.householdId, source.firmId, source.skill));
          employers.set(source.firmId, employers.get(source.firmId)! - workers);
          offerById.get(source.firmId)!.remaining += workers;
          add(h.id, target, source.skill, workers); target.remaining -= workers; wanted -= workers; moved += workers;
          if (wanted === 0) break;
        }
        if (moved) { employers.set(target.id, moved); changed = true; }
      }
    }
  }
  return [...allocations.values()].sort((a, b) => a.householdId - b.householdId || a.firmId - b.firmId || a.skill.localeCompare(b.skill));
}
