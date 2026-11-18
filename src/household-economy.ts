/**
 * Household economy, read-only: what households earned and spent over a recent window by kind, how their savings
 * are spread, and which households cannot cover next month's fixed bills (rent and water/power) from savings.
 * Savings carried in by arriving households and out by leaving ones are counted apart: they are moves, not earning or spending.
 */
import { MONTH, isWageReason, type City } from './sim.ts';
import { isIncidentReason } from './incidents.ts';

export const INCOME_KINDS = ['wages', 'business', 'other'] as const;
export const SPENDING_KINDS = ['shopping', 'rent', 'tax', 'utilities', 'leisure', 'business', 'incidents', 'other'] as const;
export type IncomeKind = typeof INCOME_KINDS[number];
export type SpendingKind = typeof SPENDING_KINDS[number];
export const INCOME_LABELS: Record<IncomeKind, string> = { wages: 'ค่าจ้าง', business: 'รายได้กิจการ', other: 'อื่น ๆ' };
export const SPENDING_LABELS: Record<SpendingKind, string> = { shopping: 'ซื้อสินค้า', rent: 'ค่าเช่าบ้าน', tax: 'ภาษี', utilities: 'ค่าน้ำไฟ', leisure: 'ค่าเที่ยว', business: 'ต้นทุนกิจการ', incidents: 'เหตุร้าย', other: 'อื่น ๆ' };

const isLeisure = (reason: string) => /^Visit [a-z ]+ #[1-9]\d*$/.test(reason);
export const ARRIVAL_REASON = 'New household arrival savings', DEPARTURE_REASON = 'Emigration savings';
export function incomeKind(reason: string): IncomeKind {
  if (isWageReason(reason)) return 'wages';
  if (reason === 'Owner profit distribution' || reason === 'Closing owner profit distribution' || isLeisure(reason)) return 'business';
  return 'other';
}
export function spendingKind(reason: string): SpendingKind {
  if (/^Household #[1-9]\d* purchase$/.test(reason)) return 'shopping';
  if (reason === 'Monthly household rent') return 'rent';
  if (/ tax$/.test(reason)) return 'tax';
  if (reason === 'Monthly household water and power bill') return 'utilities';
  if (isLeisure(reason)) return 'leisure';
  // A household running a venue pays its staff and the venue rent.
  if (isWageReason(reason) || /^Monthly [a-z ]+ rent #[1-9]\d*$/.test(reason)) return 'business';
  if (isIncidentReason(reason)) return 'incidents';
  return 'other';
}

/** Savings bands in satang: under 1,000 ฿, under 5,000 ฿, under 20,000 ฿, under 50,000 ฿, and above. */
export const SAVINGS_BANDS = [100_000, 500_000, 2_000_000, 5_000_000] as const;
export const SAVINGS_BAND_LABELS = ['ต่ำกว่า 1,000 ฿', '1,000–5,000 ฿', '5,000–20,000 ฿', '20,000–50,000 ฿', '50,000 ฿ ขึ้นไป'] as const;
export const savingsBand = (satang: number) => { let i = 0; while (i < SAVINGS_BANDS.length && satang >= SAVINGS_BANDS[i]) i++; return i; };

export type AtRiskHousehold = { id: number; members: number; savings: number; bills: number; net: number };
export type HouseholdEconomy = {
  fromTick: number; toTick: number; households: number;
  income: Record<IncomeKind, number>; spending: Record<SpendingKind, number>;
  /** Households in each savings band, lowest first. */
  savings: number[]; medianSavings: number;
  /** Savings below the rent and water/power bills they paid in the window, fewest savings first. */
  atRisk: AtRiskHousehold[];
  /** Households that spent more than they earned in the window. */
  spendingMore: number;
  /** Savings carried in by households that arrived and out by households that left. */
  arrived: number; departed: number;
};

/** Money households received and paid over the last `days` days, today included. Moves between two households count on both sides. */
export function householdEconomy(city: Pick<City, 'ledger' | 'tick' | 'households' | 'accounts'>, days = MONTH): HouseholdEconomy {
  const fromTick = Math.max(0, city.tick - days + 1);
  const income = Object.fromEntries(INCOME_KINDS.map(k => [k, 0])) as Record<IncomeKind, number>;
  const spending = Object.fromEntries(SPENDING_KINDS.map(k => [k, 0])) as Record<SpendingKind, number>;
  let arrived = 0, departed = 0;
  const earned = new Map<string, number>(), spent = new Map<string, number>(), bills = new Map<string, number>();
  for (let i = city.ledger.length - 1; i >= 0; i--) {
    const e = city.ledger[i];
    if (e.tick < fromTick) break;
    if (e.tick > city.tick || e.amount <= 0 || e.from === e.to) continue;
    if (e.reason === ARRIVAL_REASON) { arrived += e.amount; continue; }
    if (e.reason === DEPARTURE_REASON) { departed += e.amount; continue; }
    if (e.to.startsWith('household:')) {
      income[incomeKind(e.reason)] += e.amount; earned.set(e.to, (earned.get(e.to) ?? 0) + e.amount);
    }
    if (e.from.startsWith('household:')) {
      const kind = spendingKind(e.reason); spending[kind] += e.amount;
      spent.set(e.from, (spent.get(e.from) ?? 0) + e.amount);
      if (kind === 'rent' || kind === 'utilities') bills.set(e.from, (bills.get(e.from) ?? 0) + e.amount);
    }
  }
  const savings = SAVINGS_BAND_LABELS.map(() => 0), held: number[] = [], atRisk: AtRiskHousehold[] = [];
  let spendingMore = 0;
  for (const h of city.households) {
    const wallet = city.accounts[h.wallet] ?? 0, net = (earned.get(h.wallet) ?? 0) - (spent.get(h.wallet) ?? 0), bill = bills.get(h.wallet) ?? 0;
    savings[savingsBand(wallet)]++; held.push(wallet);
    if (net < 0) spendingMore++;
    if (bill > 0 && wallet < bill) atRisk.push({ id: h.id, members: h.members, savings: wallet, bills: bill, net });
  }
  held.sort((a, b) => a - b);
  const mid = held.length >> 1, medianSavings = !held.length ? 0 : held.length % 2 ? held[mid] : Math.round((held[mid - 1] + held[mid]) / 2);
  atRisk.sort((a, b) => a.savings - b.savings || a.id - b.id);
  return { fromTick, toTick: city.tick, households: city.households.length, income, spending, savings, medianSavings, atRisk, spendingMore, arrived, departed };
}
