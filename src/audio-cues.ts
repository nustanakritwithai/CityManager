/**
 * Which sounds a stretch of simulated time deserves. Read-only over the city and its ledgers, like
 * the network feed: a snapshot before, the city after, and the cues in between. A limiter keeps
 * 10× speed from turning into a drum roll.
 */
import { MONTH, isMarket, isRetail, type City } from './sim.ts';
import { buildingIssues } from './map-overlay.ts';
import { cityGoals } from './city-goals.ts';

export type CueName = 'ev-build-home' | 'ev-build-business' | 'ev-build-farm' | 'ev-arrival' | 'ev-month' | 'ev-shop' | 'ev-issue' | 'ev-broke' | 'jingle-level' | 'jingle-win';
export type CueSnapshot = { tick: number; ledger: number; buildings: ReadonlySet<number>; shops: ReadonlySet<number>; issues: ReadonlySet<string>; level: number; won: boolean };

const shopIds = (c: City) => new Set(c.firms.filter(isRetail).map(f => f.id));
export function cueSnapshot(c: City): CueSnapshot {
  const goals = cityGoals(c);
  return { tick: c.tick, ledger: c.ledger.length, buildings: new Set(c.buildings.map(b => b.id)), shops: shopIds(c),
    issues: new Set(buildingIssues(c).map(i => `${i.cell}:${i.kind}`)), level: goals.level, won: goals.won };
}

/** Cues for what changed since the snapshot, most important first. A load or reset (time going back) plays nothing. */
export function cityCues(before: CueSnapshot, c: City, after = cueSnapshot(c)): CueName[] {
  if (c.tick <= before.tick || c.ledger.length < before.ledger) return [];
  const out: CueName[] = [];
  if (after.won && !before.won) out.push('jingle-win');
  else if (after.level > before.level) out.push('jingle-level');
  for (const b of c.buildings) {
    if (before.buildings.has(b.id)) continue;
    const f = c.firms.find(f => f.building === b.id);
    out.push(b.zone === 'R' ? 'ev-build-home' : b.zone === 'F' ? 'ev-build-farm' : f && isMarket(f) ? 'ev-build-home' : 'ev-build-business');
  }
  if ([...after.shops].some(id => !before.shops.has(id))) out.push('ev-shop');
  for (let i = before.ledger; i < c.ledger.length; i++) if (c.ledger[i].reason === 'New household arrival savings') { out.push('ev-arrival'); break; }
  if (Math.floor(c.tick / MONTH) > Math.floor(before.tick / MONTH)) out.push('ev-month');
  const fresh = [...after.issues].filter(key => !before.issues.has(key));
  if (fresh.some(key => key.endsWith(':broke'))) out.push('ev-broke');
  else if (fresh.length) out.push('ev-issue');
  return [...new Set(out)];
}

/** At most `perSecond` cues a second and one of each name per `gapMs`. Jingles always get through.
 * The month coin also ignores a full second, but still waits out its own gap. A loaded or new city
 * must call `reset` so the previous city's recent sounds cannot swallow the next month. */
export class CueLimiter {
  private readonly last = new Map<string, number>();
  private window: number[] = [];
  private readonly perSecond: number;
  private readonly gapMs: number;
  constructor(perSecond = 3, gapMs = 900) { this.perSecond = perSecond; this.gapMs = gapMs; }
  reset(): void { this.last.clear(); this.window = []; }
  admit(cues: readonly CueName[], now: number): CueName[] {
    this.window = this.window.filter(t => now - t < 1000);
    const out: CueName[] = [];
    for (const cue of cues) {
      const jingle = cue.startsWith('jingle-');
      const repeat = now - (this.last.get(cue) ?? -Infinity) < this.gapMs;
      if (jingle) { /* a level or win is never held */ }
      else if (cue === 'ev-month') { if (repeat) continue; }
      else if (repeat || this.window.length >= this.perSecond) continue;
      this.last.set(cue, now); this.window.push(now); out.push(cue);
    }
    return out;
  }
}
