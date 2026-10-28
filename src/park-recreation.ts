/** Observational recreation only: this module never reads or changes city finances. */
export const PARK_RECREATION_UNITS_PER_POINT = 1000;
export const PARK_RECREATION_MAX_SCORE_UNITS = 100 * PARK_RECREATION_UNITS_PER_POINT;
export const PARK_RECREATION_MAX_RESIDENTS = 2048;
const MINUTES_PER_DAY = 1440;

export interface ParkRecreationTuning {
  readonly gainUnitsPerMinute: number;
  readonly dailyCapUnits: number;
  readonly decayUnitsPerDay: number;
}
export const DEFAULT_PARK_RECREATION_TUNING: ParkRecreationTuning = Object.freeze({
  gainUnitsPerMinute: 250, dailyCapUnits: 15000, decayUnitsPerDay: 5000,
});

export interface ParkRecreationCitizen {
  readonly scoreUnits: number;
  /** Numerator remaining after integer division by 1440; zero at zero score. */
  readonly decayRemainder: number;
  readonly dailyGainedUnits: number;
  /** Day of the most recently processed interval, including idle intervals. */
  readonly day: number;
  readonly earnedMinutes: number;
  readonly lastBenefitMinute: number;
  readonly lastCreditedParkId: number;
  /** These three diagnostics describe the last positive credit, not a current visit. */
  readonly lastGainUnits: number;
  readonly lastCrowdingPermille: number;
  readonly lastQualityPermille: number;
}
export interface ParkRecreationState {
  readonly version: 1;
  readonly minute: number;
  readonly tuning: ParkRecreationTuning;
  /** Sparse: a resident who never earned benefit has implicit score zero. */
  readonly citizens: Readonly<Record<string, ParkRecreationCitizen>>;
}
export interface ParkRecreationFrame {
  /** End of the observed interval [minute - 1, minute), in absolute game minutes. */
  readonly minute: number;
  readonly residentIds: readonly string[];
  readonly parks: readonly {
    readonly parkId: number;
    readonly qualityPermille: number;
    readonly comfortableCapacity: number;
  }[];
  /** Actual physical presence only. Ineligible people still count toward crowding. */
  readonly visits: readonly { readonly citizenId: string; readonly parkId: number; readonly eligible: boolean }[];
}

function fail(message: string): never { throw new RangeError(`Park recreation: ${message}`); }
function integer(value: unknown, low: number, high: number, name: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < low || (value as number) > high) fail(`invalid ${name}`);
}
function id(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128 || value.trim() !== value || /[\x00-\x1f]/.test(value)) fail(`invalid ${name}`);
}
function shape(value: unknown, keys: readonly string[], name: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`invalid ${name}`);
  const actual = Object.keys(value);
  if (actual.length !== keys.length || actual.some(key => !keys.includes(key))) fail(`invalid ${name} fields`);
}
function dayAt(minute: number): number { return Math.floor(Math.max(0, minute - 1) / MINUTES_PER_DAY); }
function validateTuning(value: unknown): asserts value is ParkRecreationTuning {
  shape(value, ['gainUnitsPerMinute', 'dailyCapUnits', 'decayUnitsPerDay'], 'tuning');
  for (const key of ['gainUnitsPerMinute', 'dailyCapUnits', 'decayUnitsPerDay']) integer(value[key], 0, PARK_RECREATION_MAX_SCORE_UNITS, key);
}
const CITIZEN_KEYS = ['scoreUnits', 'decayRemainder', 'dailyGainedUnits', 'day', 'earnedMinutes', 'lastBenefitMinute', 'lastCreditedParkId', 'lastGainUnits', 'lastCrowdingPermille', 'lastQualityPermille'];
function validateState(value: unknown): asserts value is ParkRecreationState {
  shape(value, ['version', 'minute', 'tuning', 'citizens'], 'state');
  if (value.version !== 1) fail('unsupported version');
  integer(value.minute, 0, Number.MAX_SAFE_INTEGER, 'minute');
  validateTuning(value.tuning);
  if (!value.citizens || typeof value.citizens !== 'object' || Array.isArray(value.citizens)) fail('invalid citizens');
  const entries = Object.entries(value.citizens);
  if (entries.length > PARK_RECREATION_MAX_RESIDENTS) fail('too many citizen records');
  for (const [citizenId, citizen] of entries) {
    id(citizenId, 'citizenId');
    shape(citizen, CITIZEN_KEYS, 'citizen');
    integer(citizen.scoreUnits, 0, PARK_RECREATION_MAX_SCORE_UNITS, 'scoreUnits');
    integer(citizen.decayRemainder, 0, MINUTES_PER_DAY - 1, 'decayRemainder');
    if (citizen.scoreUnits === 0 && citizen.decayRemainder !== 0) fail('zero score cannot carry decay debt');
    integer(citizen.dailyGainedUnits, 0, value.tuning.dailyCapUnits, 'dailyGainedUnits');
    integer(citizen.day, dayAt(value.minute), dayAt(value.minute), 'day');
    integer(citizen.earnedMinutes, 1, value.minute, 'earnedMinutes');
    integer(citizen.lastBenefitMinute, citizen.earnedMinutes, value.minute, 'lastBenefitMinute');
    integer(citizen.lastCreditedParkId, 1, Number.MAX_SAFE_INTEGER, 'lastCreditedParkId');
    integer(citizen.lastGainUnits, 1, Math.min(value.tuning.gainUnitsPerMinute, value.tuning.dailyCapUnits), 'lastGainUnits');
    integer(citizen.lastCrowdingPermille, 1, 1000, 'lastCrowdingPermille');
    integer(citizen.lastQualityPermille, 1, 1000, 'lastQualityPermille');
  }
}
function freezeState(state: ParkRecreationState): ParkRecreationState {
  Object.freeze(state.tuning);
  for (const citizen of Object.values(state.citizens)) Object.freeze(citizen);
  Object.freeze(state.citizens);
  return Object.freeze(state);
}

/** Start at the actual game clock. Missing old sidecars start with no earned benefit. */
export function createParkRecreation(minute = 0, tuning: ParkRecreationTuning = DEFAULT_PARK_RECREATION_TUNING): ParkRecreationState {
  integer(minute, 0, Number.MAX_SAFE_INTEGER, 'minute');
  validateTuning(tuning);
  return freezeState({ version: 1, minute, tuning: { ...tuning }, citizens: Object.create(null) });
}

/**
 * Pure atomic transition. Feed each real game-minute observation in order, at any
 * playback speed; pause means no frames. Never synthesize missing visit history.
 * Exact duplicates collapse. Conflicting eligibility or overlapping parks reject
 * the entire frame rather than awarding an arbitrary park. A repeated processed
 * minute is a no-op, so retrying delivery cannot double-credit or decay.
 */
export function advanceParkRecreation(state: ParkRecreationState, frame: ParkRecreationFrame): ParkRecreationState {
  validateState(state);
  shape(frame, ['minute', 'residentIds', 'parks', 'visits'], 'frame');
  integer(frame.minute, 0, Number.MAX_SAFE_INTEGER, 'frame minute');
  if (frame.minute === state.minute) return state;
  if (frame.minute !== state.minute + 1) fail('frames must advance exactly one game minute');
  if (!Array.isArray(frame.residentIds) || frame.residentIds.length > PARK_RECREATION_MAX_RESIDENTS) fail('invalid resident roster');
  const residents = new Set<string>();
  for (const citizenId of frame.residentIds) {
    id(citizenId, 'residentId');
    if (residents.has(citizenId)) fail('duplicate resident');
    residents.add(citizenId);
  }
  if (!Array.isArray(frame.parks) || frame.parks.length > PARK_RECREATION_MAX_RESIDENTS) fail('invalid parks');
  const parks = new Map<number, ParkRecreationFrame['parks'][number]>();
  for (const park of frame.parks) {
    shape(park, ['parkId', 'qualityPermille', 'comfortableCapacity'], 'park');
    integer(park.parkId, 1, Number.MAX_SAFE_INTEGER, 'parkId');
    integer(park.qualityPermille, 0, 1000, 'qualityPermille');
    integer(park.comfortableCapacity, 0, PARK_RECREATION_MAX_RESIDENTS, 'comfortableCapacity');
    if (parks.has(park.parkId)) fail('duplicate park');
    parks.set(park.parkId, { parkId: park.parkId, qualityPermille: park.qualityPermille, comfortableCapacity: park.comfortableCapacity });
  }
  if (!Array.isArray(frame.visits) || frame.visits.length > PARK_RECREATION_MAX_RESIDENTS * 4) fail('invalid visits');
  const visits = new Map<string, ParkRecreationFrame['visits'][number]>();
  const occupancy = new Map<number, number>();
  for (const visit of frame.visits) {
    shape(visit, ['citizenId', 'parkId', 'eligible'], 'visit');
    id(visit.citizenId, 'visit citizenId');
    integer(visit.parkId, 1, Number.MAX_SAFE_INTEGER, 'visit parkId');
    if (typeof visit.eligible !== 'boolean' || !residents.has(visit.citizenId) || !parks.has(visit.parkId)) fail('visit requires known resident, park, and boolean eligibility');
    const previous = visits.get(visit.citizenId);
    if (previous) {
      if (previous.parkId !== visit.parkId || previous.eligible !== visit.eligible) fail('conflicting visits for one citizen');
      continue;
    }
    visits.set(visit.citizenId, { citizenId: visit.citizenId, parkId: visit.parkId, eligible: visit.eligible });
    occupancy.set(visit.parkId, (occupancy.get(visit.parkId) ?? 0) + 1);
  }
  // Validation has completed before any work on the next state begins.
  const citizens: Record<string, ParkRecreationCitizen> = Object.create(null);
  const day = dayAt(frame.minute);
  for (const citizenId of [...residents].sort()) {
    const previous = Object.hasOwn(state.citizens, citizenId) ? state.citizens[citizenId] : undefined;
    let citizen = previous ? { ...previous, day, dailyGainedUnits: previous.day === day ? previous.dailyGainedUnits : 0 } : undefined;
    if (citizen) {
      const numerator = citizen.decayRemainder + state.tuning.decayUnitsPerDay;
      citizen.scoreUnits = Math.max(0, citizen.scoreUnits - Math.floor(numerator / MINUTES_PER_DAY));
      citizen.decayRemainder = citizen.scoreUnits > 0 ? numerator % MINUTES_PER_DAY : 0;
    }
    const visit = visits.get(citizenId);
    if (visit?.eligible) {
      const park = parks.get(visit.parkId)!;
      const crowding = Math.min(1000, Math.floor(park.comfortableCapacity * 1000 / occupancy.get(park.parkId)!));
      // Bounded operands: the largest intermediate is 100000 * 1000 * 1000.
      const potentialGain = Math.floor(state.tuning.gainUnitsPerMinute * park.qualityPermille * crowding / 1_000_000);
      const gain = Math.min(potentialGain, state.tuning.dailyCapUnits - (citizen?.dailyGainedUnits ?? 0), PARK_RECREATION_MAX_SCORE_UNITS - (citizen?.scoreUnits ?? 0));
      if (gain > 0) {
        citizen = {
          scoreUnits: (citizen?.scoreUnits ?? 0) + gain,
          decayRemainder: citizen?.decayRemainder ?? 0,
          dailyGainedUnits: (citizen?.dailyGainedUnits ?? 0) + gain,
          day, earnedMinutes: (citizen?.earnedMinutes ?? 0) + 1,
          lastBenefitMinute: frame.minute, lastCreditedParkId: park.parkId,
          lastGainUnits: gain, lastCrowdingPermille: crowding, lastQualityPermille: park.qualityPermille,
        };
      }
    }
    if (citizen) citizens[citizenId] = citizen;
  }
  return freezeState({ version: 1, minute: frame.minute, tuning: { ...state.tuning }, citizens });
}

/** Standalone versioned JSON sidecar; does not modify the city's save version. */
export function serializeParkRecreation(state: ParkRecreationState): string {
  validateState(state);
  return JSON.stringify(state);
}

/** Strict restore; an optional clock check prevents attaching stale benefit state. */
export function restoreParkRecreation(sidecar: unknown, expectedMinute?: number): ParkRecreationState {
  let value: unknown = sidecar;
  if (typeof sidecar === 'string') {
    if (sidecar.length > 2_000_000) fail('sidecar too large');
    try { value = JSON.parse(sidecar); } catch { fail('invalid sidecar JSON'); }
  }
  validateState(value);
  if (expectedMinute !== undefined) {
    integer(expectedMinute, 0, Number.MAX_SAFE_INTEGER, 'expected minute');
    if (value.minute !== expectedMinute) fail('sidecar clock mismatch');
  }
  const citizens: Record<string, ParkRecreationCitizen> = Object.create(null);
  for (const citizenId of Object.keys(value.citizens).sort()) citizens[citizenId] = { ...value.citizens[citizenId] };
  return freezeState({ version: 1, minute: value.minute, tuning: { ...value.tuning }, citizens });
}
