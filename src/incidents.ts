/**
 * City incidents: fires, burglaries and illness. Each strikes places a service does not reach, with a chance that
 * comes from a hash of the city seed, the day and the place, so the city's own random stream is never consumed and
 * replays stay identical. Nothing is saved: an incident is one ledger entry and a news line.
 *
 * Incidents begin once a city is large enough to need services (INCIDENT_MIN_POPULATION people), so small and
 * starting cities behave exactly as before.
 */
import type { CivicKind } from './civic/sites.ts';

export type IncidentKind = 'fire' | 'burglary' | 'illness';
export const INCIDENT_MIN_POPULATION = 60;
/** Daily chance for one unprotected building (fire) or household (burglary, illness). */
export const INCIDENT = Object.freeze({
  fire: Object.freeze({ chance: 1 / 400, cost: 30_000, guards: ['fire'] as readonly CivicKind[] }),
  burglary: Object.freeze({ chance: 1 / 500, cost: 5_000, guards: ['police'] as readonly CivicKind[] }),
  illness: Object.freeze({ chance: 1 / 400, cost: 3_000, guards: ['clinic', 'hospital'] as readonly CivicKind[] }),
});
export const INCIDENT_LABELS: Record<IncidentKind, string> = { fire: 'ไฟไหม้', burglary: 'ถูกงัดบ้าน', illness: 'เจ็บป่วย' };
export const fireReason = (buildingId: number) => `Fire damage repair #${buildingId}`;
export const BURGLARY_REASON = 'Burglary loss';
export const MEDICAL_REASON = 'Medical bill';
export const isIncidentReason = (reason: string) => /^Fire damage repair #[1-9]\d*$/.test(reason) || reason === BURGLARY_REASON || reason === MEDICAL_REASON;

const KIND_SALT: Record<IncidentKind, number> = { fire: 0x9e3779b1, burglary: 0x85ebca6b, illness: 0xc2b2ae35 };
/** A number in [0, 1) fixed by seed, day, place and kind. */
export function incidentRoll(seed: number, tick: number, id: number, kind: IncidentKind): number {
  let h = (seed ^ KIND_SALT[kind]) >>> 0;
  for (const v of [tick, id]) { h = Math.imul(h ^ (v >>> 0), 0x01000193) >>> 0; h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d) >>> 0; h ^= h >>> 12; }
  return (h >>> 0) / 4294967296;
}
