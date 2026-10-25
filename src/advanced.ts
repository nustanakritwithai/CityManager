/**
 * Experimental features (city signals and questions, AI explanations, Typhoon owner decisions) live
 * behind one per-browser switch in the game menu, off by default. `?advanced=1` turns them on for one
 * visit without storing anything; `?signals=1` keeps working as before.
 */
export const ADVANCED_KEY = 'citymanager.advanced.v1';

function params() { try { return new URLSearchParams(location.search); } catch { return new URLSearchParams(); } }

export function advancedFromUrl(): boolean {
  const p = params(); return p.get('advanced') === '1' || p.get('signals') === '1';
}
export function advancedEnabled(): boolean {
  if (advancedFromUrl()) return true;
  try { return localStorage.getItem(ADVANCED_KEY) === '1'; } catch { return false; }
}
export function storeAdvanced(on: boolean): void {
  try { if (on) localStorage.setItem(ADVANCED_KEY, '1'); else localStorage.removeItem(ADVANCED_KEY); } catch { /* the switch still works for this visit */ }
}
