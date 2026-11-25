/**
 * Month over month, read-only: the same few economy figures for each of the last three 30-day windows, newest
 * last, read straight from the money ledger so firms that have since closed still count in the months they traded.
 */
import { MONTH, type City } from './sim.ts';
import { costKind } from './business-sectors.ts';
import { ARRIVAL_REASON, DEPARTURE_REASON } from './household-economy.ts';
import { ONE_OFF_TREASURY_REASONS } from './treasury-forecast.ts';
import { ledgerRows } from './ledger-parts.ts';

export const TREND_MONTHS = 3;
export const TREND_KEYS = ['householdIncome', 'householdSpending', 'businessTakings', 'businessProfit', 'treasuryNet', 'borderNet'] as const;
export type TrendKey = typeof TREND_KEYS[number];
/** Whether a rise is good news (1), bad news (-1) or neither (0). */
export const TREND_META: Record<TrendKey, { label: string; better: 1 | 0 | -1 }> = {
  householdIncome: { label: 'รายได้ครัวเรือน', better: 1 },
  householdSpending: { label: 'รายจ่ายครัวเรือน', better: 0 },
  businessTakings: { label: 'รายรับกิจการ', better: 1 },
  businessProfit: { label: 'กำไรกิจการ', better: 1 },
  treasuryNet: { label: 'คลังเมืองสุทธิ', better: 1 },
  borderNet: { label: 'เงินเข้าเมืองสุทธิ', better: 1 },
};
export type TrendRow = { key: TrendKey; label: string; better: 1 | 0 | -1; values: number[]; change: number | null };
export type EconomyTrends = {
  /** First and last day of each window, oldest first; a window before day 0 is left out. */
  windows: { fromTick: number; toTick: number }[];
  rows: TrendRow[];
};

/** Percentage change from `before` to `now`, or null when there is nothing to compare against. */
export function percentChange(before: number, now: number): number | null {
  if (!before) return null;
  return Math.round((now - before) / Math.abs(before) * 100);
}

export function economyTrends(city: Pick<City, 'ledger' | 'tick'>): EconomyTrends {
  const windows: EconomyTrends['windows'] = [];
  for (let m = TREND_MONTHS - 1; m >= 0; m--) {
    const toTick = city.tick - m * MONTH, fromTick = toTick - MONTH + 1;
    if (fromTick >= 0) windows.push({ fromTick, toTick });
  }
  const totals = windows.map(() => Object.fromEntries(TREND_KEYS.map(k => [k, 0])) as Record<TrendKey, number>);
  const oldest = windows[0]?.fromTick ?? Infinity;
  const money = ledgerRows(city.ledger);
  for (let i = money.length - 1; i >= 0; i--) {
    const e = money[i];
    if (e.tick < oldest) break;
    const w = windows.findIndex(x => e.tick >= x.fromTick && e.tick <= x.toTick);
    if (w < 0 || e.amount <= 0 || e.from === e.to) continue;
    const t = totals[w], moving = e.reason === ARRIVAL_REASON || e.reason === DEPARTURE_REASON;
    if (!moving && e.to.startsWith('household:')) t.householdIncome += e.amount;
    if (!moving && e.from.startsWith('household:')) t.householdSpending += e.amount;
    if (e.to.startsWith('firm:') && !/ equity investment$/.test(e.reason)) { t.businessTakings += e.amount; t.businessProfit += e.amount; }
    if (e.from.startsWith('firm:') && costKind(e)) t.businessProfit -= e.amount;
    if (!ONE_OFF_TREASURY_REASONS.includes(e.reason)) { if (e.to === 'treasury') t.treasuryNet += e.amount; if (e.from === 'treasury') t.treasuryNet -= e.amount; }
    if (e.from === 'outside') t.borderNet += e.amount; if (e.to === 'outside') t.borderNet -= e.amount;
  }
  const rows = TREND_KEYS.map(key => {
    const values = totals.map(t => t[key]);
    return { key, ...TREND_META[key], values, change: values.length >= 2 ? percentChange(values.at(-2)!, values.at(-1)!) : null };
  });
  return { windows, rows };
}
