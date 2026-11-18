/**
 * Floating money labels, read-only: which parcels gained or lost money in a stretch of ledger, so the map can
 * show "+1,200 ฿" rising from a shop on pay day. Only places with a parcel count: firms at their building,
 * households at their home, and city venues (visitor fees) at their site. The treasury, landlord, outside and
 * works wallets have no parcel and are left out.
 */
import type { City } from './sim.ts';
import { moneyJournalLength } from './city-history.ts';

export type MoneyPop = { cell: number; amount: number };
/** At most this many labels for one stretch, biggest first, and none smaller than MIN_POP (satang). */
export const MAX_POPS = 6;
export const MIN_POP = 10_000;

const visitSite = /^Visit [a-z ]+ #([1-9]\d*)$/;

/** Where the money journal ends now; pass it back as `from` after time has run. */
export const moneyMark = (city: City) => moneyJournalLength(city);
/**
 * Net money per parcel since journal position `from` (from `moneyMark`), biggest change first. Month-end
 * compaction moves old entries into history, so the position is counted over history and ledger together.
 */
export function moneyPops(city: Pick<City, 'ledger' | 'firms' | 'households' | 'buildings' | 'civic' | 'history'>, from: number, max = MAX_POPS, min = MIN_POP): MoneyPop[] {
  const start = Math.max(0, from - (city.history?.moneyCount ?? 0));
  if (start >= city.ledger.length) return [];
  const buildingCell = new Map(city.buildings.map(b => [b.id, b.cell]));
  const walletCell = new Map<string, number>();
  for (const f of city.firms) { const cell = buildingCell.get(f.building); if (cell !== undefined) walletCell.set(f.wallet, cell); }
  for (const h of city.households) { const cell = h.home === null ? undefined : buildingCell.get(h.home); if (cell !== undefined) walletCell.set(h.wallet, cell); }
  const siteCell = new Map((city.civic?.sites ?? []).map(s => [s.id, s.cell]));
  const net = new Map<number, number>(), bump = (cell: number | undefined, amount: number) => { if (cell !== undefined) net.set(cell, (net.get(cell) ?? 0) + amount); };
  for (let i = start; i < city.ledger.length; i++) {
    const e = city.ledger[i];
    if (e.amount <= 0 || e.from === e.to) continue;
    const visit = visitSite.exec(e.reason), site = visit ? siteCell.get(Number(visit[1])) : undefined;
    bump(walletCell.get(e.from), -e.amount);
    // A city-run venue's takings go to the treasury; show them at the venue instead.
    bump(site !== undefined && e.to === 'treasury' ? site : walletCell.get(e.to), e.amount);
  }
  return [...net].filter(([, amount]) => Math.abs(amount) >= min)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]) || a[0] - b[0]).slice(0, max)
    .map(([cell, amount]) => ({ cell, amount }));
}
