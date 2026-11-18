/**
 * City progression: in a city started with progression on, larger places open as the population grows.
 * The flag is the optional `city.unlocks` section, written only for newly started cities, so existing saves and
 * every test city keep every tool open exactly as before.
 */
import { CIVIC_KINDS, type CivicKind } from './civic/sites.ts';

export type UnlockState = { version: 1 };
/** People a city needs before each place can be built. Kinds not listed are open from the start. */
export const UNLOCK_POPULATION: Partial<Record<CivicKind, number>> = {
  police: 15, fire: 15, library: 20, restaurant: 25, nightmarket: 35, museum: 50, cinema: 50,
  stadium: 80, hospital: 100, concert: 120, amusement: 150, airport: 200,
};
type Host = { unlocks?: UnlockState; households: readonly { members: number }[] };
export const cityPopulation = (c: Pick<Host, 'households'>) => c.households.reduce((n, h) => n + h.members, 0);
/** People still needed before `kind` opens in this city; 0 when it is open. */
export function peopleToUnlock(c: Host, kind: CivicKind): number {
  if (!c.unlocks) return 0;
  return Math.max(0, (UNLOCK_POPULATION[kind] ?? 0) - cityPopulation(c));
}
/** Kinds that opened while the population went from `before` to `after`, smallest threshold first. */
export function newlyUnlocked(c: Pick<Host, 'unlocks'>, before: number, after: number): CivicKind[] {
  if (!c.unlocks || after <= before) return [];
  return CIVIC_KINDS.filter(kind => { const need = UNLOCK_POPULATION[kind]; return need !== undefined && before < need && after >= need; })
    .sort((a, b) => UNLOCK_POPULATION[a]! - UNLOCK_POPULATION[b]!);
}
export function validateUnlocks(value: unknown): asserts value is UnlockState {
  const s = value as UnlockState;
  if (!s || typeof s !== 'object' || Array.isArray(s) || Object.keys(s).join(',') !== 'version' || s.version !== 1) throw new Error('Invalid unlocks save');
}
