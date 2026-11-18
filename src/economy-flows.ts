/**
 * Economy analysis, read-only: who paid whom over a recent window, grouped by sector. Every wallet in the money
 * ledger belongs to one sector, so the flows between sectors and each sector's net always add up to zero.
 */
import { MONTH, type City } from './sim.ts';

export const ECONOMY_SECTORS = ['household', 'firm', 'treasury', 'landlord', 'works', 'outside'] as const;
export type EconomySector = typeof ECONOMY_SECTORS[number];
export const SECTOR_LABELS: Record<EconomySector, string> = {
  household: 'ครัวเรือน', firm: 'กิจการ', treasury: 'คลังเมือง', landlord: 'เจ้าของที่ดิน', works: 'ก่อสร้างและบำรุง', outside: 'นอกเมือง',
};
/** The sector a ledger wallet belongs to. Unknown wallets count as outside the city. */
export function sectorOf(wallet: string): EconomySector {
  if (wallet.startsWith('household:')) return 'household';
  if (wallet.startsWith('firm:')) return 'firm';
  if (wallet === 'treasury') return 'treasury';
  if (wallet === 'landlord') return 'landlord';
  if (wallet === 'construction' || wallet === 'roadworks' || wallet === 'upkeep') return 'works';
  return 'outside';
}

export type SectorFlow = { from: EconomySector; to: EconomySector; amount: number; entries: number };
export type SectorBalance = { sector: EconomySector; inflow: number; outflow: number; net: number };
export type MoneyFlows = {
  fromTick: number; toTick: number;
  /** Money that crossed from one sector to another, largest first. */
  flows: SectorFlow[];
  /** Money that stayed inside a sector, such as one firm buying from another. */
  within: Partial<Record<EconomySector, number>>;
  balances: SectorBalance[];
  /** Total paid to and received from places outside the city. */
  leftCity: number; cameIn: number;
};

/** Ledger entries from the last `days` days, today included, grouped by sector. */
export function moneyFlows(city: Pick<City, 'ledger' | 'tick'>, days = MONTH): MoneyFlows {
  const fromTick = Math.max(0, city.tick - days + 1), byPair = new Map<string, SectorFlow>(), within: MoneyFlows['within'] = {};
  const inflow = new Map<EconomySector, number>(), outflow = new Map<EconomySector, number>();
  for (let i = city.ledger.length - 1; i >= 0; i--) {
    const e = city.ledger[i];
    if (e.tick < fromTick) break;
    if (e.tick > city.tick || e.amount <= 0) continue;
    const from = sectorOf(e.from), to = sectorOf(e.to);
    if (from === to) { within[from] = (within[from] ?? 0) + e.amount; continue; }
    const key = `${from}>${to}`, flow = byPair.get(key) ?? { from, to, amount: 0, entries: 0 };
    flow.amount += e.amount; flow.entries++; byPair.set(key, flow);
    outflow.set(from, (outflow.get(from) ?? 0) + e.amount); inflow.set(to, (inflow.get(to) ?? 0) + e.amount);
  }
  const order = (s: EconomySector) => ECONOMY_SECTORS.indexOf(s);
  const flows = [...byPair.values()].sort((a, b) => b.amount - a.amount || order(a.from) - order(b.from) || order(a.to) - order(b.to));
  const balances = ECONOMY_SECTORS.map(sector => {
    const i = inflow.get(sector) ?? 0, o = outflow.get(sector) ?? 0;
    return { sector, inflow: i, outflow: o, net: i - o };
  });
  return { fromTick, toTick: city.tick, flows, within, balances, leftCity: inflow.get('outside') ?? 0, cameIn: outflow.get('outside') ?? 0 };
}
