/** Proposed household-1 game balance; these capacities are not CSII facts. */
export type HousingType = 'cottage';
export type HousingCapacity = { households: number; persons: number };

const cottageCapacities: readonly Readonly<HousingCapacity>[] = Object.freeze([
  Object.freeze({ households: 1, persons: 4 }),
  Object.freeze({ households: 2, persons: 8 }),
  Object.freeze({ households: 3, persons: 12 }),
]);

function safeCount(value: unknown, label: string, minimum = 0): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) throw new RangeError(`${label} must be a safe integer >= ${minimum}.`);
}
function validateCapacity(value: Readonly<HousingCapacity>, label: string): void {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must contain household and person counts.`);
  safeCount(value.households, `${label}.households`);
  safeCount(value.persons, `${label}.persons`);
}

/** Returns an independent capacity object; callers cannot modify the balance table. */
export function getHousingCapacity(type: HousingType, level: number): HousingCapacity {
  if (type !== 'cottage') throw new TypeError('Unknown housing type.');
  safeCount(level, 'Housing level', 1);
  if (level > cottageCapacities.length) throw new RangeError('Cottage housing level must be 1, 2 or 3.');
  return { ...cottageCapacities[level - 1] };
}

/**
 * Rebuild from one entry per canonical household, never from cached occupancy.
 * Null homes remain displaced; identical compositions can be distinct families.
 */
export function buildOccupancyIndex(households: readonly Readonly<{ home: number | null; members: number }>[]): Map<number, HousingCapacity> {
  if (!Array.isArray(households)) throw new TypeError('Households must be an array.');
  const index = new Map<number, HousingCapacity>();
  for (const household of households) {
    if (household === null || typeof household !== 'object' || Array.isArray(household)) throw new TypeError('Each household must contain its home and member count.');
    safeCount(household.members, 'Household members', 1);
    if (household.home === null) continue;
    safeCount(household.home, 'Home ID');
    const occupied = index.get(household.home) ?? { households: 0, persons: 0 };
    const nextHouseholds = occupied.households + 1, nextPersons = occupied.persons + household.members;
    safeCount(nextHouseholds, 'Occupied households'); safeCount(nextPersons, 'Occupied persons');
    index.set(household.home, { households: nextHouseholds, persons: nextPersons });
  }
  return index;
}

/** A whole incoming household must fit both independent limits. No state changes. */
export function canAccommodate(capacity: Readonly<HousingCapacity>, occupied: Readonly<HousingCapacity>, incomingMembers: number): boolean {
  validateCapacity(capacity, 'Capacity'); validateCapacity(occupied, 'Occupancy');
  safeCount(incomingMembers, 'Incoming household members', 1);
  // Compare remaining space, avoiding overflow from summing safe input integers.
  return occupied.households < capacity.households && occupied.persons <= capacity.persons && incomingMembers <= capacity.persons - occupied.persons;
}
