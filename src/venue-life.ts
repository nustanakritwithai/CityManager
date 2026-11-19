/**
 * Venue life, read-only: how busy each entertainment venue looks today and what the camera should hear near it.
 * Crowds follow today's real visitor fees; sounds follow open venues near the camera and the time of day.
 * Presentation only: nothing is stored and nothing in the simulation changes.
 */
import { civicFeeReason, civicOpen, civicSpec, type CivicKind, type CivicSite } from './civic/sites.ts';
import type { City } from './sim.ts';

/** Kinds that draw visitors, so they can show a crowd. */
export const CROWD_KINDS: readonly CivicKind[] = ['stadium', 'concert', 'amusement', 'nightmarket', 'cinema', 'restaurant'];
/** Visitors that each crowd figure stands for, and the most figures one venue shows. */
export const VISITORS_PER_FIGURE = 2;
export const MAX_FIGURES = 8;

/** Crowd figures per venue site id for today, from the visit fees in today's ledger. Closed venues show none. */
export function venueCrowds(city: Pick<City, 'ledger' | 'tick' | 'civic'>): Map<number, number> {
  const sites = (city.civic?.sites ?? []).filter(s => CROWD_KINDS.includes(s.kind) && civicOpen(s));
  const crowds = new Map<number, number>();
  if (!sites.length) return crowds;
  const visits = new Map<string, number>();
  for (let i = city.ledger.length - 1; i >= 0 && city.ledger[i].tick === city.tick; i--) visits.set(city.ledger[i].reason, (visits.get(city.ledger[i].reason) ?? 0) + 1);
  for (const site of sites) {
    const n = visits.get(civicFeeReason(site.kind, site.id)) ?? 0;
    if (n) crowds.set(site.id, Math.min(MAX_FIGURES, Math.ceil(n / VISITORS_PER_FIGURE)));
  }
  return crowds;
}

export type DayPhase = 'night' | 'dawn' | 'day' | 'dusk';
export type VenueSounds = { crowd: number; chatter: number; temple: number; airport: number };
/** Distance (world units) at which a venue fades out of hearing. */
export const HEARING = 16;
const SOUND_OF: Partial<Record<CivicKind, { layer: keyof VenueSounds; phases: readonly DayPhase[] }>> = {
  stadium: { layer: 'crowd', phases: ['day', 'dusk', 'night'] },
  concert: { layer: 'crowd', phases: ['dusk', 'night'] },
  amusement: { layer: 'crowd', phases: ['dawn', 'day', 'dusk'] },
  nightmarket: { layer: 'chatter', phases: ['dusk', 'night'] },
  restaurant: { layer: 'chatter', phases: ['day', 'dusk'] },
  temple: { layer: 'temple', phases: ['dawn', 'day'] },
  airport: { layer: 'airport', phases: ['dawn', 'day', 'dusk', 'night'] },
};

/**
 * How loud each venue layer is, 0–1: the nearest open venue of that layer to the camera target, at a time of day
 * when it is busy, scaled by how close the camera is zoomed (`closeness`, 0–1).
 */
export function venueSounds(sites: readonly CivicSite[], target: { x: number; z: number }, position: (cell: number) => { x: number; z: number }, phase: DayPhase, closeness: number): VenueSounds {
  const out: VenueSounds = { crowd: 0, chatter: 0, temple: 0, airport: 0 };
  for (const site of sites) {
    const sound = SOUND_OF[site.kind];
    if (!sound || !sound.phases.includes(phase) || (civicSpec(site.kind).staff && !civicOpen(site))) continue;
    const p = position(site.cell), near = Math.max(0, 1 - Math.hypot(p.x - target.x, p.z - target.z) / HEARING);
    out[sound.layer] = Math.max(out[sound.layer], near * Math.max(0, Math.min(1, closeness)));
  }
  return out;
}
