/**
 * City goals: five stages from first household to a self-reliant city. Read-only over the
 * canonical state and its ledgers; nothing here is saved, so a loaded city shows its real stage.
 */
import { MONTH, isRetail, summary, type City } from './sim.ts';

export type GoalCheck = { label: string; done: boolean; value?: string };
export type GoalStage = { level: number; id: string; name: string; hint: string; checks: GoalCheck[]; done: boolean };
export type CityGoals = { level: number; stages: GoalStage[]; next: GoalStage | null; won: boolean };

/** Thresholds come from seeded runs: a well-run city reaches stage 5 in about 12–18 months. */
export const GOAL_POPULATION = 20;
export const GOAL_EMPLOYMENT = 0.8;
export const GOAL_LOCAL_SALES = 150;
export const GOAL_GROWTH_MONTHS = 3;

const count = (n: number) => n.toLocaleString('th-TH');

/** Treasury balance at the end of each of the last `months + 1` settled months, oldest first. */
export function treasuryAtMonthEnds(c: City, months: number): number[] | null {
  const last = c.tick - c.tick % MONTH;
  if (last < months * MONTH) return null;
  const ends = Array.from({ length: months + 1 }, (_, i) => last - (months - i) * MONTH), out = ends.map(() => 0);
  for (const e of c.ledger) {
    const delta = e.to === 'treasury' ? e.amount : e.from === 'treasury' ? -e.amount : 0;
    if (delta) ends.forEach((end, i) => { if (e.tick <= end) out[i] += delta; });
  }
  return out;
}

export function cityGoals(c: City): CityGoals {
  const since = c.tick - MONTH, s = summary(c);
  const recentCrops = c.cropLedger.filter(e => e.tick > since);
  const shops = new Set(c.firms.filter(isRetail).map(f => f.wallet));
  let wholesale = 0, sold = 0, imported = 0;
  for (let i = c.goodsLedger.length - 1; i >= 0 && c.goodsLedger[i].tick > since; i--) {
    const e = c.goodsLedger[i];
    if (e.reason === 'Wholesale stock delivery') wholesale += e.quantity;
    else if (e.reason === 'Household final consumption' && shops.has(e.from)) sold += e.quantity;
    else if (e.reason === 'Imported shop stock') imported += e.quantity;
  }
  const housed = c.households.filter(h => h.home !== null).length;
  const employment = s.workforce ? s.employed / s.workforce : 0;
  const treasury = treasuryAtMonthEnds(c, GOAL_GROWTH_MONTHS);
  const growing = treasury ? treasury.slice(1).filter((v, i) => v > treasury[i]).length : 0;
  const fullMonth = c.tick >= MONTH;
  const stages: Omit<GoalStage, 'done'>[] = [
    { level: 1, id: 'village', name: 'หมู่บ้าน', hint: 'ต่อถนนจากประตูเมือง วางโซนบ้านข้างถนน แล้วกดเล่น',
      checks: [{ label: 'มีครัวเรือนย้ายเข้าบ้าน', done: housed > 0, value: `${count(housed)} ครัวเรือน` }] },
    { level: 2, id: 'community', name: 'ชุมชน', hint: 'วางฟาร์มบนดินอุดมสมบูรณ์และโรงงานข้างถนน ให้มีคนไปทำงาน',
      checks: [
        { label: 'ฟาร์มเก็บเกี่ยวใน 30 วัน', done: recentCrops.some(e => e.kind === 'harvest') },
        { label: 'โรงงานแปรรูปพืชผลใน 30 วัน', done: recentCrops.some(e => e.kind === 'process') },
      ] },
    { level: 3, id: 'town', name: 'เมืองเล็ก', hint: 'วางโซนพาณิชย์ข้างถนน ร้านค้าจะเปิดเมื่อโรงงานมีคนงาน',
      checks: [{ label: 'ร้านค้าขายสินค้าที่โรงงานในเมืองผลิต', done: wholesale > 0 && sold > 0, value: `ขาย ${count(sold)} หน่วยใน 30 วัน` }] },
    { level: 4, id: 'city', name: 'เมือง', hint: 'เพิ่มบ้านและที่ทำงานให้สมดุล คนว่างงานไม่ย้ายเข้า งานว่างดึงคนเข้าเมือง',
      checks: [
        { label: `ประชากรอย่างน้อย ${count(GOAL_POPULATION)} คน`, done: s.population >= GOAL_POPULATION, value: `${count(s.population)}/${count(GOAL_POPULATION)} คน` },
        { label: `แรงงานมีงานอย่างน้อย ${Math.round(GOAL_EMPLOYMENT * 100)}%`, done: s.workforce > 0 && employment >= GOAL_EMPLOYMENT, value: `${Math.round(employment * 100)}%` },
      ] },
    { level: 5, id: 'self-reliant', name: 'เมืองพึ่งพาตนเองได้', hint: 'ให้โรงงานผลิตพอขาย ไม่ต้องนำเข้า และใช้เงินคลังไม่เกินภาษีที่เก็บได้',
      checks: [
        { label: 'ร้านไม่ต้องนำเข้าสินค้า 30 วัน', done: fullMonth && imported === 0, value: imported ? `นำเข้า ${count(imported)} หน่วย` : undefined },
        { label: `ขายสินค้าในเมืองอย่างน้อย ${count(GOAL_LOCAL_SALES)} หน่วยใน 30 วัน`, done: sold >= GOAL_LOCAL_SALES, value: `${count(sold)}/${count(GOAL_LOCAL_SALES)}` },
        { label: `เงินคลังเพิ่มขึ้น ${GOAL_GROWTH_MONTHS} เดือนติดกัน`, done: growing === GOAL_GROWTH_MONTHS, value: treasury ? `${growing}/${GOAL_GROWTH_MONTHS} เดือน` : 'รอครบ 3 เดือน' },
      ] },
  ];
  // Stages are cumulative: a later stage only counts once every earlier one holds.
  let level = 0;
  const done = stages.map(stage => { const ok = stage.checks.every(check => check.done) && level === stage.level - 1; if (ok) level = stage.level; return { ...stage, done: ok }; });
  return { level, stages: done, next: done.find(stage => !stage.done) ?? null, won: level === stages.length };
}

/**
 * The win screen shows once per city. A loaded city that has already won never shows it, and a
 * city that dips below stage 5 (one import, a treasury dip) and climbs back does not show it again.
 */
export class WinLatch {
  private city: object | null = null;
  private shown = false;
  check(city: object, won: boolean, running: boolean): boolean {
    if (city !== this.city) { this.city = city; this.shown = won; return false; }
    if (!won || this.shown || !running) return false;
    this.shown = true; return true;
  }
}

/** Facts for the win screen, all from the ledgers. */
export function cityRecord(c: City) {
  const s = summary(c);
  return {
    day: c.tick, population: s.population, households: s.households,
    produced: c.goods.produced, soldLocally: c.goods.consumed,
    taxes: c.ledger.reduce((n, e) => n + (e.to === 'treasury' && /tax/i.test(e.reason) ? e.amount : 0), 0),
    treasury: s.treasury,
  };
}
