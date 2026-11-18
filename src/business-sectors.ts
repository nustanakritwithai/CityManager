/**
 * Business sectors, read-only: what farms, factories and shops took in and paid out over a recent window, and which
 * firms did best and worst. Owner payouts and new investment are kept apart from running costs, and outside equity
 * is capital, not takings, so profit here is takings less running costs.
 */
import { MONTH, isWageReason, type City, type Firm } from './sim.ts';
import { sectorOf } from './economy-flows.ts';

export const BUSINESS_SECTORS = ['F', 'I', 'C'] as const;
export type BusinessSector = typeof BUSINESS_SECTORS[number];
export const BUSINESS_SECTOR_LABELS: Record<BusinessSector, string> = { F: 'ฟาร์ม', I: 'โรงงาน', C: 'ร้านค้า' };
export const BUYERS = ['household', 'firm', 'outside'] as const;
export type Buyer = typeof BUYERS[number];
export const BUYER_LABELS: Record<Buyer, string> = { household: 'ครัวเรือนซื้อ', firm: 'กิจการอื่นซื้อ', outside: 'ขายออกนอกเมือง' };
export const COST_KINDS = ['wages', 'supplies', 'rent', 'tax', 'utilities', 'other'] as const;
export type CostKind = typeof COST_KINDS[number];
export const COST_LABELS: Record<CostKind, string> = { wages: 'ค่าจ้าง', supplies: 'ซื้อวัตถุดิบและสินค้า', rent: 'ค่าเช่า', tax: 'ภาษี', utilities: 'ค่าน้ำไฟ', other: 'อื่น ๆ' };

const isEquity = (reason: string) => / equity investment$/.test(reason);
const isPayout = (reason: string) => reason === 'Owner profit distribution' || reason === 'Closing owner profit distribution';
/** A firm's running cost, or null for money that is not one (owner payouts and investment in the building). */
export function costKind(e: { to: string; reason: string }): CostKind | null {
  if (isPayout(e.reason) || e.to === 'construction') return null;
  if (isWageReason(e.reason)) return 'wages';
  if (/ tax$/.test(e.reason)) return 'tax';
  if (/ rent$/.test(e.reason)) return 'rent';
  if (e.reason === 'Monthly water and power bill') return 'utilities';
  if (e.to.startsWith('firm:') || e.to === 'outside') return 'supplies';
  return 'other';
}

export type FirmResult = { id: number; sector: BusinessSector; label: string; revenue: number; costs: number; profit: number; cash: number; workers: number };
export type SectorResult = {
  sector: BusinessSector; firms: number; workers: number; revenue: number; costs: number; profit: number;
  buyers: Record<Buyer, number>; costKinds: Record<CostKind, number>; payouts: number; investment: number;
};
export type BusinessSectors = { fromTick: number; toTick: number; sectors: SectorResult[]; firms: FirmResult[] };

const zero = <K extends string>(keys: readonly K[]) => Object.fromEntries(keys.map(k => [k, 0])) as Record<K, number>;
/** Firm name for lists: its recipe or zone and its number. */
export function firmLabel(f: Pick<Firm, 'id' | 'zone' | 'recipe'>, recipeLabels: Readonly<Record<string, string>> = {}): string {
  return `${(f.recipe && recipeLabels[f.recipe]) || BUSINESS_SECTOR_LABELS[f.zone]} #${f.id}`;
}

/** Results of the firms open today over the last `days` days, today included. Firms sorted by profit, highest first. */
export function businessSectors(city: Pick<City, 'ledger' | 'tick' | 'firms' | 'accounts'>, days = MONTH, recipeLabels: Readonly<Record<string, string>> = {}): BusinessSectors {
  const fromTick = Math.max(0, city.tick - days + 1), byWallet = new Map(city.firms.map(f => [f.wallet, f]));
  const sectors = new Map<BusinessSector, SectorResult>(BUSINESS_SECTORS.map(sector => [sector, { sector, firms: 0, workers: 0, revenue: 0, costs: 0, profit: 0, buyers: zero(BUYERS), costKinds: zero(COST_KINDS), payouts: 0, investment: 0 }]));
  const firms = new Map<string, FirmResult>(city.firms.map(f => [f.wallet, { id: f.id, sector: f.zone, label: firmLabel(f, recipeLabels), revenue: 0, costs: 0, profit: 0, cash: city.accounts[f.wallet] ?? 0, workers: Object.keys(f.workDays ?? {}).length }]));
  for (let i = city.ledger.length - 1; i >= 0; i--) {
    const e = city.ledger[i];
    if (e.tick < fromTick) break;
    if (e.tick > city.tick || e.amount <= 0 || e.from === e.to) continue;
    const seller = byWallet.get(e.to);
    if (seller && !isEquity(e.reason)) {
      const s = sectors.get(seller.zone)!, buyer = sectorOf(e.from);
      s.buyers[buyer === 'household' || buyer === 'firm' ? buyer : 'outside'] += e.amount; s.revenue += e.amount; firms.get(e.to)!.revenue += e.amount;
    }
    const payer = byWallet.get(e.from);
    if (payer) {
      const s = sectors.get(payer.zone)!, kind = costKind(e);
      if (kind) { s.costKinds[kind] += e.amount; s.costs += e.amount; firms.get(e.from)!.costs += e.amount; }
      else if (isPayout(e.reason)) s.payouts += e.amount;
      else s.investment += e.amount;
    }
  }
  for (const f of firms.values()) { f.profit = f.revenue - f.costs; const s = sectors.get(f.sector)!; s.firms++; s.workers += f.workers; }
  for (const s of sectors.values()) s.profit = s.revenue - s.costs;
  return { fromTick, toTick: city.tick, sectors: [...sectors.values()], firms: [...firms.values()].sort((a, b) => b.profit - a.profit || a.id - b.id) };
}
