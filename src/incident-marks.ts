/**
 * Incident marks, read-only: where on the map each incident in a stretch of the money journal happened, so
 * the scene can show smoke on a burning building, police lights at a burgled home and an ambulance light at a
 * sick household's home. Read from the same ledger entries the incidents already write; nothing is stored.
 */
import type { City } from './sim.ts';
import { BURGLARY_REASON, MEDICAL_REASON, type IncidentKind } from './incidents.ts';

export type IncidentMark = { cell: number; kind: IncidentKind };
/** At most this many marks for one stretch, fires first. */
export const MAX_INCIDENT_MARKS = 6;
const FIRE = /^Fire damage repair #([1-9]\d*)$/;
const ORDER: Record<IncidentKind, number> = { fire: 0, burglary: 1, illness: 2 };

/** Marks for incidents since journal position `from` (history and ledger counted together), one per parcel. */
export function incidentMarks(city: Pick<City, 'ledger' | 'households' | 'buildings' | 'history'>, from: number, max = MAX_INCIDENT_MARKS): IncidentMark[] {
  const start = Math.max(0, from - (city.history?.moneyCount ?? 0));
  if (start >= city.ledger.length) return [];
  const cellOf = new Map(city.buildings.map(b => [b.id, b.cell]));
  const homeOf = new Map(city.households.flatMap(h => h.home === null ? [] : [[h.wallet, cellOf.get(h.home)] as const]));
  const marks = new Map<number, IncidentKind>();
  const add = (cell: number | undefined, kind: IncidentKind) => { if (cell === undefined) return; const had = marks.get(cell); if (had === undefined || ORDER[kind] < ORDER[had]) marks.set(cell, kind); };
  for (let i = start; i < city.ledger.length; i++) {
    const e = city.ledger[i], fire = FIRE.exec(e.reason);
    if (fire) add(cellOf.get(Number(fire[1])), 'fire');
    else if (e.reason === BURGLARY_REASON) add(homeOf.get(e.from), 'burglary');
    else if (e.reason === MEDICAL_REASON) add(homeOf.get(e.from), 'illness');
  }
  return [...marks].map(([cell, kind]) => ({ cell, kind })).sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || a.cell - b.cell).slice(0, max);
}

/** How long each mark stays on the map, in seconds of real time. */
export const INCIDENT_SECONDS: Record<IncidentKind, number> = { fire: 6, burglary: 4.5, illness: 4.5 };
/** Fades every mark in over its first quarter second and out over its last second. */
export const markFade = (kind: IncidentKind, t: number) => Math.max(0, Math.min(1, t / .25, (INCIDENT_SECONDS[kind] - t) / 1));
/** Flame `k` of a fire flickers between 0.55 and 1.15 of its height, each out of step with the others. */
export const flameHeight = (k: number, t: number) => .85 + .3 * Math.sin(t * (9 + k * 2.3) + k * 1.7);
/** Smoke puff `k` of `n` loops upward every 2.4 s: it rises 2.6 units, swells, then thins away at the top. */
export function smokePuff(k: number, n: number, t: number): { y: number; drift: number; size: number } {
  const u = ((t / 2.4) + k / n) % 1;
  return { y: u * 2.6, drift: Math.sin(u * Math.PI) * .35, size: (.3 + .55 * u) * Math.sin(Math.min(1, u * 1.15) * Math.PI) };
}
/** Which of a pair of warning lights is lit at `t`: they swap four times a second. */
export const lightLit = (t: number) => (Math.floor(t * 4) % 2) as 0 | 1;
