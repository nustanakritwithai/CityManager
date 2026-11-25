/**
 * What the town is doing at this hour, read from the city as it stands: who works where, who studies, who shopped on
 * the last day and who is in the parks now. Read-only; the economy itself still settles once a day at midnight.
 */
import { venues, type City } from './sim.ts';
import { WORK_START_MINUTE, WORK_END_MINUTE } from './park-activity.ts';
import { clockLabel } from './game-clock.ts';
import { ledgerRows } from './ledger-parts.ts';

export type DayCounts = { people: number; farm: number; factory: number; shop: number; service: number; students: number; shoppers: number };
export type HourActivity = { hour: number; clock: string; icon: string; title: string; detail: string };

const HOUSEHOLD_SPENDING = /^Household #([1-9]\d*) (?:purchase|other spending)$/;

/** Workers by the kind of place they work, students, and households that bought food or goods on the day just settled. */
export function dayCounts(city: City): DayCounts {
  const zone = new Map(city.firms.map(f => [f.id, f.zone]));
  const counts: DayCounts = { people: city.households.reduce((n, h) => n + h.members, 0), farm: 0, factory: 0, shop: 0, service: 0, students: 0, shoppers: 0 };
  const job = (firmId: number, workers: number) => { const z = zone.get(firmId); if (z === 'F') counts.farm += workers; else if (z === 'I') counts.factory += workers; else if (z === 'C') counts.shop += workers; };
  for (const e of city.employment) job(e.firmId, e.workers);
  for (const e of city.ownerLabor) job(e.firmId, e.workers);
  for (const p of city.parks) for (const a of p.staffing?.allocations ?? []) counts.service += a.workers;
  for (const site of venues(city)) for (const a of site.staffing?.allocations ?? []) counts.service += a.workers;
  for (const person of city.education?.people ?? []) { counts.service += person.teacher + person.professor; counts.students += person.school + person.university; }
  const shoppers = new Set<string>();
  const rows = ledgerRows(city.ledger);
  for (let i = rows.length - 1; i >= 0 && rows[i].tick === city.tick; i--) { const m = HOUSEHOLD_SPENDING.exec(rows[i].reason); if (m) shoppers.add(m[1]); }
  counts.shoppers = shoppers.size;
  return counts;
}

const n = (value: number) => value.toLocaleString('th-TH');

/** The activity of the hour `minuteOfDay` falls in. Work runs 08:00–17:00 (park-activity.ts); people travel the hours either side. */
export function hourActivity(minuteOfDay: number, counts: DayCounts, parkVisitors = 0): HourActivity {
  const hour = Math.floor((((minuteOfDay % 1440) + 1440) % 1440) / 60), clock = clockLabel(hour * 60);
  const workers = counts.farm + counts.factory + counts.shop + counts.service;
  const start = WORK_START_MINUTE / 60, end = WORK_END_MINUTE / 60;
  // A town nobody has moved into yet only keeps the time.
  const at = (icon: string, title: string, detail: string): HourActivity => ({ hour, clock, icon, title, detail: counts.people ? detail : 'ยังไม่มีคน · ครอบครัวแรกมาตอนเที่ยงคืนเมื่อมีบ้านติดถนน' });
  const park = parkVisitors ? ` · ในสวน ${n(parkVisitors)} คน` : '';
  const study = counts.students ? ` · เรียน ${n(counts.students)} คน` : '';
  if (hour < 5) return at('moon', 'นอนหลับ', `${n(counts.people)} คนนอนหลับอยู่บ้าน`);
  if (hour < start - 2) return at('sun', 'ตื่นนอน', `${n(counts.people)} คนตื่นมาเตรียมตัวออกจากบ้าน`);
  if (hour < start) return at('worker', 'เดินทางไปทำงาน', workers ? `${n(workers)} คนออกไปทำงาน${counts.students ? ` · ${n(counts.students)} คนไปเรียน` : ''}` : 'ยังไม่มีงานให้ไป');
  if (hour === 12) return at('people', 'พักเที่ยง', workers ? `${n(workers)} คนพักกินข้าว${park}` : `ยังไม่มีคนทำงาน${park}`);
  if (hour < end) {
    const parts = [['ฟาร์ม', counts.farm], ['โรงงาน', counts.factory], ['ร้าน', counts.shop], ['บริการ', counts.service]].filter(([, v]) => (v as number) > 0).map(([label, v]) => `${label} ${n(v as number)}`);
    return at('gear', 'ทำงาน', parts.length ? `${parts.join(' · ')} คน${study}${park}` : `ยังไม่มีคนทำงาน${study}${park}`);
  }
  if (hour === end) return at('worker', 'เลิกงาน', workers ? `${n(workers)} คนเดินทางกลับบ้าน${park}` : `กลับบ้าน${park}`);
  if (hour < 20) return at('shop', 'ซื้อของ', counts.shoppers ? `${n(counts.shoppers)} ครัวเรือนออกไปซื้อของ${park}` : `ร้านยังไม่มีคนซื้อ${park}`);
  if (hour < 22) return at('household', 'พักผ่อน', `${n(counts.people)} คนพักผ่อนกับครอบครัว${park}`);
  return at('moon', 'เข้านอน', 'เมืองเงียบลง');
}
