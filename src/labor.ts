/** Aggregate workers belong to individual households, not per-person agents. */
export type Occupation = 'manufacturing' | 'retail';
export type EmploymentRank = 'entry';
export type EmploymentAllocation = {
  householdId: number;
  firmId: number;
  occupation: Occupation;
  rank: EmploymentRank;
  workers: number;
};
export type LaborHousehold = { id: number; workforce: number; accessible: boolean };
export type LaborOffer = { id: number; zone: 'I' | 'C'; slots: number; budgetWorkers: number };

export const OCCUPATION_BY_ZONE = Object.freeze({ I: 'manufacturing', C: 'retail' } as const);
export const EMPLOYMENT_RANKS = Object.freeze(['entry'] as const);

type HouseholdState = { id: number; remaining: number };
type OfferState = { id: number; occupation: Occupation; remaining: number };

function count(value: number, label: string, minimum = 0): void {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new RangeError(`${label} must be a safe integer >= ${minimum}`);
  }
}

function record(value: unknown, label: string): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be a record`);
  }
}

function array(value: unknown): void {
  if (!Array.isArray(value)) throw new TypeError('Labor inputs must be arrays');
}

/**
 * Preserve previous jobs before filling funded vacancies in ascending household/firm ID order.
 *
 * IDs must be positive safe integers. Workforce, slots and budgetWorkers must be
 * nonnegative safe integers; accessible must be boolean. Malformed records,
 * duplicate household/offer IDs and malformed prior allocations throw. Structurally
 * valid prior jobs with missing references, inaccessible homes or changed occupations
 * are stale and ignored. Duplicate prior pairs are coalesced, bounded by the actual
 * household workforce and min(slots, budgetWorkers); cuts favor ascending IDs.
 *
 * The caller has already reduced the road network to accessible household inputs and
 * eligible offers: there are no household/firm-specific route constraints here.
 * Sorting and keyed prior lookups are followed by a two-cursor fill. Each fill step
 * exhausts a household or offer; no loop scales with individual worker counts or H*F.
 * No input object, wallet, inventory or earned wage claim is mutated.
 */
export function allocateEmployment(
  households: readonly LaborHousehold[],
  offers: readonly LaborOffer[],
  previous: readonly EmploymentAllocation[],
): EmploymentAllocation[] {
  array(households); array(offers); array(previous);

  const householdById = new Map<number, HouseholdState>();
  for (const household of households) {
    record(household, 'Household');
    count(household.id, 'Household ID', 1);
    count(household.workforce, 'Household workforce');
    if (typeof household.accessible !== 'boolean') throw new TypeError('Household accessible must be boolean');
    if (householdById.has(household.id)) throw new TypeError(`Duplicate household ID ${household.id}`);
    householdById.set(household.id, { id: household.id, remaining: household.accessible ? household.workforce : 0 });
  }

  const offerById = new Map<number, OfferState>();
  for (const offer of offers) {
    record(offer, 'Offer');
    count(offer.id, 'Firm ID', 1);
    count(offer.slots, 'Offer slots');
    count(offer.budgetWorkers, 'Offer budgetWorkers');
    if (offer.zone !== 'I' && offer.zone !== 'C') throw new TypeError('Offer zone must be I or C');
    if (offerById.has(offer.id)) throw new TypeError(`Duplicate firm ID ${offer.id}`);
    offerById.set(offer.id, {
      id: offer.id,
      occupation: OCCUPATION_BY_ZONE[offer.zone],
      remaining: Math.min(offer.slots, offer.budgetWorkers),
    });
  }

  for (const allocation of previous) {
    record(allocation, 'Prior allocation');
    count(allocation.householdId, 'Prior household ID', 1);
    count(allocation.firmId, 'Prior firm ID', 1);
    count(allocation.workers, 'Prior workers', 1);
    if (allocation.occupation !== 'manufacturing' && allocation.occupation !== 'retail') {
      throw new TypeError('Prior occupation must be manufacturing or retail');
    }
    if (allocation.rank !== 'entry') throw new TypeError('Prior rank must be entry');
  }

  const allocations = new Map<string, EmploymentAllocation>();
  const assign = (household: HouseholdState, offer: OfferState, requested: number): void => {
    const workers = Math.min(requested, household.remaining, offer.remaining);
    if (workers <= 0) return;
    const key = `${household.id}:${offer.id}`;
    const existing = allocations.get(key);
    if (existing) existing.workers += workers;
    else allocations.set(key, {
      householdId: household.id, firmId: offer.id,
      occupation: offer.occupation, rank: 'entry', workers,
    });
    household.remaining -= workers;
    offer.remaining -= workers;
  };

  const priorOrder = [...previous].sort((a, b) => a.householdId - b.householdId || a.firmId - b.firmId);
  for (const allocation of priorOrder) {
    const household = householdById.get(allocation.householdId);
    const offer = offerById.get(allocation.firmId);
    if (household && offer && allocation.occupation === offer.occupation) {
      assign(household, offer, allocation.workers);
    }
  }

  const householdOrder = [...householdById.values()].filter(h => h.remaining > 0).sort((a, b) => a.id - b.id);
  const offerOrder = [...offerById.values()].filter(f => f.remaining > 0).sort((a, b) => a.id - b.id);
  let householdIndex = 0, offerIndex = 0;
  while (householdIndex < householdOrder.length && offerIndex < offerOrder.length) {
    const household = householdOrder[householdIndex], offer = offerOrder[offerIndex];
    assign(household, offer, Math.min(household.remaining, offer.remaining));
    if (household.remaining === 0) householdIndex++;
    if (offer.remaining === 0) offerIndex++;
  }

  return [...allocations.values()].sort((a, b) => a.householdId - b.householdId || a.firmId - b.firmId);
}
