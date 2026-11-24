import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCity, step, buildRoad, zoneCell, access, explainCell, firmWorkerCount, firmCapacity, dailyGrowth, DAILY_BUILDS, DAILY_ARRIVAL_FILL_DAYS, GATEWAY, SIZE, type City, type Zone } from '../src/sim.ts';
import { parcelChecklist } from '../src/place-checklist.ts';
import { thaiMessage } from '../src/event-text.ts';
import { keepSupplied } from './plants.ts';

/** An empty-map city with an L road from the gate and `zones` zoned along it, started in the game (`unlocks`) or not. */
function town(zones: string, game: boolean): City {
  const c = createCity(61025, { starter: false });
  if (game) c.unlocks = { version: 1 };
  const gx = GATEWAY % SIZE, gy = Math.floor(GATEWAY / SIZE);
  buildRoad(c, GATEWAY, gy * SIZE + gx + 8); buildRoad(c, gy * SIZE + gx + 8, (gy + 8) * SIZE + gx + 8);
  const free = () => c.cells.map((cell, i) => !cell.road && !cell.zone && cell.building === null && access(c, i) ? i : -1).filter(i => i >= 0);
  for (const z of zones) assert.ok(zoneCell(c, free()[2], z as Zone).ok);
  return c;
}
const people = (c: City) => c.households.reduce((n, h) => n + h.members, 0);
const run = (c: City, days: number) => { for (let d = 0; d < days; d++) { step(c); keepSupplied(c); } };

test('a city started in the game builds its ready parcels on the first night and its first two families move in that night', () => {
  const c = town('RRRRFICC', true);
  assert.equal(dailyGrowth(c), true);
  run(c, 1);
  const zones = c.buildings.map(b => b.zone);
  assert.ok(zones.includes('R') && zones.includes('I') && zones.includes('F'), `built the first night: ${zones}`);
  assert.equal(c.households.length, 2, 'the first two households come together');
  assert.equal(people(c), 6, 'two families of three for the open jobs');
  for (const h of c.households) assert.equal(c.buildings.find(b => b.id === h.home)?.age, 0, 'into a house built that night');
  // The same town on the old three-day review: nobody yet, and one building at the first review.
  const old = town('RRRRFICC', false);
  run(old, 3);
  assert.equal(dailyGrowth(old), false);
  assert.equal(people(old), 0);
  assert.equal(old.buildings.length, 1);
});

test('a town with only homes gets its first people the first night', () => {
  const c = town('RR', true); run(c, 1);
  assert.equal(c.households.length, 2);
  const old = town('RR', false); run(old, 3);
  assert.equal(old.households.length, 0, 'the three-day review builds the first house on day 3; its family comes the day after');
});

test('open jobs fill from outside within days, not a month, and at most a few buildings rise each night', { timeout: 300_000 }, () => {
  assert.equal(DAILY_ARRIVAL_FILL_DAYS, 3);
  const farmTown = (game: boolean) => {
    const c = createCity(61025); if (game) c.unlocks = { version: 1 };
    const free = () => c.cells.map((cell, i) => !cell.road && !cell.zone && cell.building === null && access(c, i) ? i : -1).filter(i => i >= 0);
    for (const [zone, n] of [['F', 6], ['R', 2]] as const) { let done = 0; for (const i of free()) { if (done >= n) break; if (zoneCell(c, i, zone).ok) done++; } }
    return c;
  };
  const posts = (c: City) => c.firms.filter(f => f.zone === 'F').reduce((n, f) => ({ filled: n.filled + firmWorkerCount(c, f.id), open: n.open + firmCapacity(c.buildings.find(b => b.id === f.building)!, f, c) }), { filled: 0, open: 0 });
  const c = farmTown(true), old = farmTown(false);
  let most = 0, several = false;
  for (let d = 0; d < 10; d++) {
    const before = c.buildings.length; run(c, 1); run(old, 1);
    most = Math.max(most, c.buildings.length - before); several ||= c.buildings.length - before > 1;
  }
  assert.ok(most <= DAILY_BUILDS, `${most} buildings in one night`);
  assert.ok(several, 'more than one building rises in a night');
  const farms = posts(c);
  assert.ok(farms.open >= 6 && farms.filled === farms.open, `every farm post filled by day 10: ${farms.filled}/${farms.open}`);
  assert.ok(people(c) >= 12, `${people(c)} people by day 10`);
  assert.ok(people(old) <= 2, `the three-day review: ${people(old)} people by day 10`);
});

test('the game says buildings rise every night in a city started in the game', () => {
  const c = createCity(61025, { starter: false }); c.unlocks = { version: 1 };
  buildRoad(c, GATEWAY, GATEWAY + 3);
  const i = c.cells.findIndex((cell, i) => !cell.road && !cell.zone && access(c, i));
  const marked = zoneCell(c, i, 'R');
  assert.equal(marked.message, 'R zone marked. Ready parcels are built every night.');
  assert.equal(thaiMessage(marked.message), 'วางโซนบ้านแล้ว เมืองสร้างอาคารให้ตอนเที่ยงคืนเมื่อแปลงพร้อม');
  const old = createCity(61025, { starter: false }); buildRoad(old, GATEWAY, GATEWAY + 3);
  assert.equal(zoneCell(old, i, 'R').message, 'R zone marked. Growth is evaluated every 3 days.');
});

test('the place panel says a ready parcel is built tonight, shop sites included', () => {
  const c = town('RRRRFICC', true), old = town('RRRRFICC', false);
  const ready = (city: City) => city.cells.map((cell, i) => cell.zone && cell.building === null ? i : -1).filter(i => i >= 0).map(i => ({ i, list: parcelChecklist(city, i)! })).filter(p => p.list.eligible);
  assert.ok(ready(c).length > 0 && ready(c).every(p => p.list.nextReview === 0), 'tonight on the daily pace');
  assert.ok(ready(old).length > 0 && ready(old).every(p => p.list.nextReview === 3 - old.tick % 3), 'the three-day review counts down');
  // A shop site keeps its own checklist on the daily pace. Shops open every night there, so take a town where one is
  // waiting for its shop day and put it on the daily pace: the panel reads the opening as tonight.
  const shops = createCity(61025);
  let shop = -1;
  for (let d = 0; d < 30 && shop < 0; d++) {
    shop = shops.cells.findIndex((cell, i) => cell.zone === 'C' && cell.building === null && explainCell(shops, i)[1]?.startsWith('Shop site:'));
    if (shop < 0) run(shops, 1);
  }
  assert.ok(shop >= 0, 'a shop site waits for its shop day');
  assert.match(explainCell(shops, shop)[1], /\(in \d day\(s\)\)/);
  shops.unlocks = { version: 1 };
  assert.match(explainCell(shops, shop)[1], /\(tonight\)/);
  const list = parcelChecklist(shops, shop)!;
  assert.equal(list.nextReview, 0); assert.equal(list.eligible, true); assert.equal(list.checks[0].key, 'factory');
});
