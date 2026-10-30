/** Read-only boundary to the separately reviewed park-activity candidate.
 * Samples ONE real activity minute, before the activity engine advances it.
 * Rendering, park proximity and completed-return counts are never visit evidence.
 */
import type { City } from './sim.ts';
import { parkActivityUnavailableCitizenIds, type ParkActivityContext } from './park-activity.ts';
import type { ParkRecreationFrame } from './park-recreation.ts';

export const RECREATION_MINUTES_PER_DAY = 1440;
/** Proposed comfort, independent of the activity engine's six reservations. */
export const PROPOSED_PARK_COMFORT = 3;
export type RecreationActivityPhase = 'travel' | 'enter' | 'stroll' | 'wait' | 'meet' | 'sit' | 'leave';
export type RecreationActivityObservation = {
  day: number; minute: number;
  visitors: readonly {
    citizenId: string; householdId: number; memberSlot: number;
    homeId: number; homeCell: number; parkId: number; parkCell: number;
    phase: RecreationActivityPhase;
  }[];
};
export type RecreationParkPolicy = { qualityPermille: number; comfortableCapacity: number };
export type RecreationObservationOptions = {
  /** Values are design inputs. They must not be inferred from render quality. */
  parkPolicy?: ReadonlyMap<number, RecreationParkPolicy>;
  /** Additional real workforce reservations, e.g. a reviewed municipal assignment.
   * Unioned with existing private/owner work reservations; never unreserves work.
   */
  unavailableCitizenIds?: ReadonlySet<string>;
  /** Shared read-only roster for this synchronous advance; never reuse after city edits. */
  activityContext?: ParkActivityContext;
};

const safe = (n: number) => Number.isSafeInteger(n) && n >= 0;
const phases = new Set(['travel', 'enter', 'stroll', 'wait', 'meet', 'sit', 'leave']);
const eligible = new Set(['stroll', 'wait', 'meet', 'sit']);
const id = (householdId: number, memberSlot: number) => `h:${householdId}:m:${memberSlot}`;

export function parkRecreationResidentIds(city: City): string[] {
  return [...city.households].sort((a, b) => a.id - b.id)
    .flatMap(h => Array.from({ length: h.members }, (_, slot) => id(h.id, slot)));
}

export function parkRecreationMinute(day: number, minute: number): number {
  if (!safe(day) || !safe(minute) || minute > RECREATION_MINUTES_PER_DAY || !safe(day * RECREATION_MINUTES_PER_DAY + minute)) {
    throw new RangeError('Invalid recreation game clock');
  }
  return day * RECREATION_MINUTES_PER_DAY + minute;
}

/** Caller must reconcile activity after demolition/displacement and before this
 * read. Stale references fail closed instead of fabricating a completed visit.
 * Call once for EVERY elapsed game minute, regardless of selected display speed.
 */
export function observeParkRecreationMinute(
  city: City, activity: RecreationActivityObservation, options: RecreationObservationOptions = {}
): ParkRecreationFrame {
  const start = parkRecreationMinute(activity.day, activity.minute);
  if (activity.day !== city.tick || activity.minute === RECREATION_MINUTES_PER_DAY || !safe(start + 1)) {
    throw new RangeError('Recreation observation must match the current city day before its final boundary');
  }
  const residentIds = parkRecreationResidentIds(city), known = new Set(residentIds);
  const unavailable = parkActivityUnavailableCitizenIds(city, activity.minute, options.activityContext);
  const parks = city.parks.map(p => ({ parkId: p.id, ...(options.parkPolicy?.get(p.id) ?? {
    qualityPermille: 1000, comfortableCapacity: PROPOSED_PARK_COMFORT
  }) }));
  const visits: Array<ParkRecreationFrame['visits'][number]> = [];
  for (const v of activity.visitors) {
    const h = city.households.find(h => h.id === v.householdId);
    const home = city.buildings.find(b => b.id === v.homeId && b.zone === 'R');
    const park = city.parks.find(p => p.id === v.parkId);
    if (!safe(v.memberSlot) || !known.has(v.citizenId) || v.citizenId !== id(v.householdId, v.memberSlot)
      || !h || h.home !== v.homeId || home?.cell !== v.homeCell || park?.cell !== v.parkCell || !phases.has(v.phase)) {
      throw new Error('Stale or invalid recreation activity; reconcile the real activity state before sampling');
    }
    if (v.phase === 'travel' || v.phase === 'leave') continue;
    visits.push({ citizenId: v.citizenId, parkId: v.parkId,
      eligible: eligible.has(v.phase) && !unavailable.has(v.citizenId) && !options.unavailableCitizenIds?.has(v.citizenId) });
  }
  return { minute: start + 1, residentIds, parks, visits };
}
