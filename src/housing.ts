/**
 * Real building sizes. A house is one household; an apartment block has 40 rooms and a condominium tower 200, one
 * household to a room. A room fits a family of three at the first level of a block or tower, four and five at the
 * next: levels within a type are the same building with larger rooms, so a household can grow without moving. Absolute levels 1–9 keep the cottage → apartment → condo order.
 */
export type HousingType = 'cottage' | 'apartment' | 'condo';
export type HousingCapacity = { households: number; persons: number };

export const HOUSING_LEVELS = Object.freeze([
  { type: 'cottage', tierLevel: 1, households: 1, persons: 4 },
  { type: 'cottage', tierLevel: 2, households: 1, persons: 8 },
  { type: 'cottage', tierLevel: 3, households: 1, persons: 12 },
  { type: 'apartment', tierLevel: 1, households: 40, persons: 120 },
  { type: 'apartment', tierLevel: 2, households: 40, persons: 160 },
  { type: 'apartment', tierLevel: 3, households: 40, persons: 200 },
  { type: 'condo', tierLevel: 1, households: 200, persons: 600 },
  { type: 'condo', tierLevel: 2, households: 200, persons: 800 },
  { type: 'condo', tierLevel: 3, households: 200, persons: 1000 },
].map(item => Object.freeze(item))) as readonly Readonly<{ type: HousingType; tierLevel: number; households: number; persons: number }>[];

/** The capacities saves were written under before real sizes (a cottage then held up to three households). Read only to accept and convert those saves. */
export const LEGACY_HOUSING_LEVELS = Object.freeze([
  { households: 1, persons: 4 }, { households: 2, persons: 8 }, { households: 3, persons: 12 },
  { households: 5, persons: 20 }, { households: 8, persons: 32 }, { households: 12, persons: 48 },
  { households: 16, persons: 64 }, { households: 24, persons: 96 }, { households: 32, persons: 128 },
].map(item => Object.freeze(item)));
export function legacyHousingCapacity(type: HousingType, level: number): HousingCapacity {
  housingLevel(type, level);
  const { households, persons } = LEGACY_HOUSING_LEVELS[level - 1];
  return { households, persons };
}
/** True when going up one level replaces the building with a bigger type (house → apartment, apartment → condo). */
export const redevelopsAt = (level: number) => level < HOUSING_LEVELS.length && HOUSING_LEVELS[level].type !== HOUSING_LEVELS[level - 1].type;

export function housingLevel(type: HousingType, level: number) {
  safeCount(level, 'Housing level', 1);
  const entry = HOUSING_LEVELS[level - 1];
  if (!entry || entry.type !== type) throw new RangeError('Invalid housing type and level.');
  return entry;
}

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
  const { households, persons } = housingLevel(type, level);
  return { households, persons };
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
