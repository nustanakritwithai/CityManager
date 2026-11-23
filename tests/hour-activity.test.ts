import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayCounts, hourActivity, type DayCounts } from '../src/hour-activity.ts';
import { ICONS } from '../src/ui-icons.ts';
import { createCity, step, type City } from '../src/sim.ts';
import { keepSupplied } from './plants.ts';

const town: DayCounts = { people: 40, farm: 12, factory: 4, shop: 0, service: 2, students: 5, shoppers: 9 };

test('every game hour has its own activity: sleep, wake, travel, work, lunch, home, shopping, rest', () => {
  const titles = Array.from({ length: 24 }, (_, h) => hourActivity(h * 60 + 30, town).title);
  assert.deepEqual(titles, [
    'นอนหลับ', 'นอนหลับ', 'นอนหลับ', 'นอนหลับ', 'นอนหลับ', 'ตื่นนอน', 'เดินทางไปทำงาน', 'เดินทางไปทำงาน',
    'ทำงาน', 'ทำงาน', 'ทำงาน', 'ทำงาน', 'พักเที่ยง', 'ทำงาน', 'ทำงาน', 'ทำงาน', 'ทำงาน', 'เลิกงาน',
    'ซื้อของ', 'ซื้อของ', 'พักผ่อน', 'พักผ่อน', 'เข้านอน', 'เข้านอน',
  ]);
  for (let h = 0; h < 24; h++) {
    const a = hourActivity(h * 60 + 59, town);
    assert.equal(a.hour, h); assert.equal(a.clock, `${String(h).padStart(2, '0')}:00`);
    assert.ok(ICONS[a.icon], `icon ${a.icon} at ${a.clock}`);
  }
  assert.equal(hourActivity(1440 + 75, town).clock, '01:00', 'minutes past midnight wrap');
});

test('the hour says how many people do it, from the town as it stands', () => {
  assert.equal(hourActivity(3 * 60, town).detail, '40 คนนอนหลับอยู่บ้าน');
  assert.equal(hourActivity(7 * 60, town).detail, '18 คนออกไปทำงาน · 5 คนไปเรียน');
  // Work hours list only the places that have people at work, then school and the parks.
  assert.equal(hourActivity(10 * 60, town, 3).detail, 'ฟาร์ม 12 · โรงงาน 4 · บริการ 2 คน · เรียน 5 คน · ในสวน 3 คน');
  assert.equal(hourActivity(12 * 60, town).detail, '18 คนพักกินข้าว');
  assert.equal(hourActivity(17 * 60, town).detail, '18 คนเดินทางกลับบ้าน');
  assert.equal(hourActivity(18 * 60, town).detail, '9 ครัวเรือนออกไปซื้อของ');
  assert.equal(hourActivity(5 * 60, town).detail, '40 คนตื่นมาเตรียมตัวออกจากบ้าน');
  assert.equal(hourActivity(21 * 60, town, 2).detail, '40 คนพักผ่อนกับครอบครัว · ในสวน 2 คน');
  assert.equal(hourActivity(23 * 60, town).detail, 'เมืองเงียบลง');
  assert.equal(hourActivity(10 * 60, { ...town, people: 1234, farm: 1234 }).detail.split(' · ')[0], 'ฟาร์ม 1,234');
  const jobless = { ...town, farm: 0, factory: 0, shop: 0, service: 0, students: 0, shoppers: 0 };
  assert.equal(hourActivity(10 * 60, jobless).detail, 'ยังไม่มีคนทำงาน');
  assert.equal(hourActivity(7 * 60, jobless).detail, 'ยังไม่มีงานให้ไป');
  assert.equal(hourActivity(19 * 60, jobless).detail, 'ร้านยังไม่มีคนซื้อ');
  // A town nobody has moved into only keeps the time.
  for (let h = 0; h < 24; h++) assert.equal(hourActivity(h * 60, { ...jobless, people: 0 }).detail, 'ยังไม่มีคนย้ายเข้าเมือง');
});

const sum = (c: City, zone: string) => [...c.employment, ...c.ownerLabor].filter(e => c.firms.find(f => f.id === e.firmId)?.zone === zone).reduce((n, e) => n + e.workers, 0);

test('the counts are the jobs, school places and purchases the economy settled', { timeout: 120_000 }, () => {
  const c = createCity(61025); for (let d = 0; d < 95; d++) { step(c); keepSupplied(c); }
  const counts = dayCounts(c);
  assert.equal(counts.people, c.households.reduce((n, h) => n + h.members, 0));
  assert.deepEqual([counts.farm, counts.factory, counts.shop], [sum(c, 'F'), sum(c, 'I'), sum(c, 'C')]);
  assert.ok(counts.farm + counts.factory + counts.shop > 0, 'people work in this town');
  const buyers = new Set(c.ledger.filter(e => e.tick === c.tick && /^Household #\d+ (?:purchase|other spending)$/.test(e.reason)).map(e => e.reason.split(' ')[1]));
  assert.equal(counts.shoppers, buyers.size);
  assert.ok(counts.shoppers > 0 && counts.shoppers <= c.households.length);
});
