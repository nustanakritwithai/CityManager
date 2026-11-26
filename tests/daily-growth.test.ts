import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCity, step, buildRoad, zoneCell, access, explainCell, firmWorkerCount, firmCapacity, dailyGrowth, buildReadyParcels, serialize, deserialize, DAILY_BUILDS, DAILY_ARRIVAL_FILL_DAYS, GATEWAY, SIZE, type City, type Zone } from '../src/sim.ts';
import { HAPPINESS_BASE } from '../src/resident-happiness.ts';
import { parcelChecklist } from '../src/place-checklist.ts';
import { thaiMessage } from '../src/event-text.ts';
import { keepSupplied } from './plants.ts';

/**
 * An empty-map city with an L road from the gate and `zones` zoned along it, started in the game (`unlocks`) or not.
 * `placed`: zoned the way the game does it, each parcel followed by the build a player's command makes.
 */
function town(zones: string, game: boolean, placed = false): City {
  const c = createCity(61025, { starter: false });
  if (game) c.unlocks = { version: 1 };
  const gx = GATEWAY % SIZE, gy = Math.floor(GATEWAY / SIZE);
  buildRoad(c, GATEWAY, gy * SIZE + gx + 8); buildRoad(c, gy * SIZE + gx + 8, (gy + 8) * SIZE + gx + 8);
  const free = () => c.cells.map((cell, i) => !cell.road && !cell.zone && cell.building === null && access(c, i) ? i : -1).filter(i => i >= 0);
  for (const z of zones) { const i = free()[2]; assert.ok(zoneCell(c, i, z as Zone).ok); if (placed) buildReadyParcels(c, i); }
  return c;
}
const people = (c: City) => c.households.reduce((n, h) => n + h.members, 0);
const run = (c: City, days: number) => { for (let d = 0; d < days; d++) { step(c); keepSupplied(c); } };

test('a city started in the game builds what the player places at once, and its first two families move in the first night', () => {
  const c = town('RRRRFICC', true, true);
  assert.equal(dailyGrowth(c), true);
  assert.equal(c.tick, 0, 'no day has passed');
  assert.deepEqual(c.buildings.map(b => b.zone).sort(), [...'CCFIRRRR'], 'every parcel rose as it was placed');
  run(c, 1);
  assert.equal(c.households.length, 2, 'the first two households come together');
  assert.equal(people(c), 6, 'two families of three for the open jobs');
  // The same town on the old three-day review: nothing on placement, nobody yet, and one building at the first review.
  const old = town('RRRRFICC', false, true);
  assert.equal(old.buildings.length, 0);
  run(old, 3);
  assert.equal(dailyGrowth(old), false);
  assert.equal(people(old), 0);
  assert.equal(old.buildings.length, 1);
});

test('parcels still waiting in a city started in the game rise at midnight, up to a few a night, without waiting for demand', () => {
  // Zoned without the build a player's command makes, as in a city saved while parcels waited for midnight.
  const c = town('RRRRFICC', true);
  assert.equal(c.buildings.length, 0);
  run(c, 1);
  assert.equal(c.buildings.length, DAILY_BUILDS, 'the first night builds as many as a night allows');
  run(c, 1);
  assert.equal(c.buildings.length, 8, 'the next night builds the rest');
});

test('a city started in the game saves on the night its first families move into homes built that night', () => {
  // Zoned without the build a player's command makes: the night builds the homes, and the families come after the
  // day's happiness was worked out.
  const c = town('RRRRFICC', true);
  run(c, 1);
  assert.equal(c.households.length, 2, 'the first two families came in the night');
  assert.deepEqual(c.happiness?.rows.map(r => r.householdId), c.households.map(h => h.id).sort((a, b) => a - b), 'each has its first day of happiness');
  for (const row of c.happiness!.rows) assert.ok(row.score >= HAPPINESS_BASE - 1 && row.score <= HAPPINESS_BASE + 2, `one day's step from the base: ${row.score}`);
  const saved = serialize(c);
  assert.equal(serialize(deserialize(saved)), saved, 'a valid save that loads back the same');
  run(c, 2);
  assert.equal(c.happiness?.rows.length, c.households.length);
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
  // Every farm rose without waiting for buyers, so the town has many more farm posts than people at first.
  assert.ok(farms.open >= 6 && farms.filled * 10 >= farms.open * 9, `nine farm posts in ten filled by day 10: ${farms.filled}/${farms.open}`);
  assert.ok(people(c) >= 12, `${people(c)} people by day 10`);
  assert.ok(people(old) <= 2, `the three-day review: ${people(old)} people by day 10`);
});

test('the game says a ready parcel is built right away in a city started in the game', () => {
  const c = createCity(61025, { starter: false }); c.unlocks = { version: 1 };
  buildRoad(c, GATEWAY, GATEWAY + 3);
  const i = c.cells.findIndex((cell, i) => !cell.road && !cell.zone && access(c, i));
  const marked = zoneCell(c, i, 'R');
  assert.equal(marked.message, 'R zone marked. Ready parcels are built right away.');
  assert.equal(thaiMessage(marked.message), 'วางโซนบ้านแล้ว เมืองสร้างอาคารทันทีเมื่อแปลงพร้อม');
  // A city saved with the message of the nightly build still reads it in Thai.
  assert.equal(thaiMessage('R zone marked. Ready parcels are built every night.'), 'วางโซนบ้านแล้ว เมืองสร้างอาคารให้ตอนเที่ยงคืนเมื่อแปลงพร้อม');
  const old = createCity(61025, { starter: false }); buildRoad(old, GATEWAY, GATEWAY + 3);
  assert.equal(zoneCell(old, i, 'R').message, 'R zone marked. Growth is evaluated every 3 days.');
});

test('the place panel of a city started in the game checks only what building needs, and the old review counts down', () => {
  const c = town('RRRRFICC', true), old = town('RRRRFICC', false);
  const ready = (city: City) => city.cells.map((cell, i) => cell.zone && cell.building === null ? i : -1).filter(i => i >= 0).map(i => ({ i, list: parcelChecklist(city, i)! })).filter(p => p.list.eligible);
  assert.equal(ready(c).length, 8, 'every waiting parcel of the game town is ready');
  for (const p of ready(c)) {
    assert.equal(p.list.nextReview, 0, 'built with the next command or growth round');
    assert.deepEqual(p.list.checks.filter(check => ['housing-demand', 'income', 'crop-demand', 'owner', 'market-demand'].includes(check.key)), [], 'no demand check: the game builds on placement');
  }
  assert.match(explainCell(c, ready(c)[0].i).at(-2)!, /^Eligible; it is built with your next map command or in the next growth round \(every three game hours\)\.$/);
  assert.ok(ready(old).length > 0 && ready(old).every(p => p.list.nextReview === 3 - old.tick % 3), 'the three-day review counts down');
  // Only the three-day review waits for a shop day; on the daily pace the same parcel is simply ready and the next
  // command builds it.
  const shops = createCity(61025);
  let shop = -1;
  for (let d = 0; d < 30 && shop < 0; d++) {
    shop = shops.cells.findIndex((cell, i) => cell.zone === 'C' && cell.building === null && explainCell(shops, i)[1]?.startsWith('Shop site:'));
    if (shop < 0) run(shops, 1);
  }
  assert.ok(shop >= 0, 'a shop site waits for its shop day');
  assert.match(explainCell(shops, shop)[1], /\(in \d day\(s\)\)/);
  assert.equal(parcelChecklist(shops, shop)!.checks[0].key, 'factory');
  shops.unlocks = { version: 1 };
  assert.doesNotMatch(explainCell(shops, shop)[1] ?? '', /^Shop site:/);
  const list = parcelChecklist(shops, shop)!;
  assert.equal(list.nextReview, 0); assert.equal(list.eligible, true); assert.ok(list.checks.every(check => check.key !== 'factory'));
  assert.ok(buildReadyParcels(shops, shop) >= 1); assert.notEqual(shops.cells[shop].building, null);
});
