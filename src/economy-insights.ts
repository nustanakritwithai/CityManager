/**
 * Economy insights, read-only: a few plain Thai sentences drawn from the three 30-day analyses, worst news first.
 * Each names the overview section that explains it, so the panel can link straight there.
 */
import type { MoneyFlows } from './economy-flows.ts';
import type { HouseholdEconomy } from './household-economy.ts';
import { BUSINESS_SECTOR_LABELS, type BusinessSectors } from './business-sectors.ts';
import type { TreasuryForecast } from './treasury-forecast.ts';

export type InsightTone = 'bad' | 'warn' | 'good';
export type Insight = { key: string; tone: InsightTone; text: string; target: 'dash-economy' | 'dash-households' | 'dash-business' | 'dash-finance' };
export const MAX_INSIGHTS = 5;
/** Share of households spending more than they earn before it is worth a warning. */
export const OVERSPEND_SHARE = 0.3;
/** Share of household spending that goes to rent before it is worth a warning. */
export const RENT_SHARE = 0.4;
/** Days of treasury money left, at the current pace, below which it is bad news. */
export const RUNWAY_ALARM_DAYS = 90;

const baht = (satang: number) => `${Math.round(Math.abs(satang) / 100).toLocaleString('th-TH')} ฿`;
const count = (n: number) => n.toLocaleString('th-TH');
const RANK: Record<InsightTone, number> = { bad: 0, warn: 1, good: 2 };

export function economyInsights(flows: MoneyFlows, homes: HouseholdEconomy, business: BusinessSectors, treasury: TreasuryForecast): Insight[] {
  const out: Insight[] = [];
  const add = (key: string, tone: InsightTone, target: Insight['target'], text: string) => out.push({ key, tone, text, target });
  if (homes.atRisk.length) add('at-risk', 'bad', 'dash-households', `${count(homes.atRisk.length)} ครัวเรือนมีเงินเก็บไม่พอจ่ายค่าเช่าและค่าน้ำไฟเดือนหน้า`);
  if (homes.households && homes.spendingMore / homes.households >= OVERSPEND_SHARE)
    add('overspend', 'warn', 'dash-households', `${count(homes.spendingMore)} จาก ${count(homes.households)} ครัวเรือนใช้เงินมากกว่าหาได้ในเดือนนี้`);
  const spent = Object.values(homes.spending).reduce((a, b) => a + b, 0);
  if (spent && homes.spending.rent / spent >= RENT_SHARE) add('rent', 'warn', 'dash-households', `ค่าเช่าบ้านกิน ${Math.round(homes.spending.rent / spent * 100)}% ของรายจ่ายครัวเรือน`);
  const open = business.sectors.filter(s => s.firms > 0);
  const losing = open.filter(s => s.profit < 0);
  for (const s of losing) add(`sector-loss-${s.sector}`, 'bad', 'dash-business', `${BUSINESS_SECTOR_LABELS[s.sector]}ขาดทุนรวม ${baht(s.profit)} ใน 30 วัน`);
  const losers = business.firms.filter(f => f.profit < 0);
  if (losers.length && !losing.length) {
    const worst = losers.at(-1)!;
    add('firm-loss', 'warn', 'dash-business', `${count(losers.length)} กิจการขาดทุน แย่ที่สุดคือ ${worst.label} (−${baht(worst.profit)})`);
  }
  if (treasury.runwayDays !== null && treasury.runwayDays < RUNWAY_ALARM_DAYS)
    add('runway', 'bad', 'dash-finance', `ถ้ายังใช้แบบนี้ เงินคลังจะหมดในราว ${count(treasury.runwayDays)} วัน`);
  else if (treasury.net < 0) add('treasury', 'warn', 'dash-finance', `คลังเมืองจ่ายมากกว่ารับ ${baht(treasury.net)} ใน 30 วัน`);
  else if (treasury.net > 0) add('treasury', 'good', 'dash-finance', `คลังเมืองเก็บเงินได้สุทธิ ${baht(treasury.net)} ใน 30 วัน`);
  const border = flows.cameIn - flows.leftCity;
  if (border < 0) add('border', 'warn', 'dash-economy', `เงินรั่วออกนอกเมืองสุทธิ ${baht(border)} เมืองซื้อจากข้างนอกมากกว่าขาย`);
  else if (border > 0) add('border', 'good', 'dash-economy', `เงินจากนอกเมืองเข้ามาสุทธิ ${baht(border)}`);
  const best = open.filter(s => s.revenue > 0 && s.profit > 0).sort((a, b) => b.profit / b.revenue - a.profit / a.revenue)[0];
  if (best) add('best-sector', 'good', 'dash-business', `${BUSINESS_SECTOR_LABELS[best.sector]}ทำกำไรดีที่สุด ได้กำไร ${Math.round(best.profit / best.revenue * 100)}% ของรายรับ`);
  return out.map((x, i) => ({ x, i })).sort((a, b) => RANK[a.x.tone] - RANK[b.x.tone] || a.i - b.i).slice(0, MAX_INSIGHTS).map(({ x }) => x);
}
