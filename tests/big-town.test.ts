import test from 'node:test';
import assert from 'node:assert/strict';
import { createCity, step, buildRoad, zoneCell, access, buildReadyParcels, serialize, deserialize, utilities, housingCapacity, firmCapacity, firmWorkerCount, householdWorkerCount, workerCounts, maxHouseholds, explainMigration, buildPlant, plantAt, MAX_CITY_HOUSEHOLDS, GATEWAY, SIZE, type City, type Zone } from '../src/sim.ts';
import { freshServerCityRaw } from '../src/fresh-server-city.ts';
import { deserializeParkSession } from '../src/park-runtime.ts';
import { BIG_TOWN_MAX_HOUSEHOLDS, TILE_SCALE, tileScale } from '../src/tile-scale.ts';
import { REAL_CROPS, BIG_TOWN_CROPS, realCrop, farmStaff, millJobsFor } from '../src/industry-scale.ts';
import { retailCapacity } from '../src/retail-capacity.ts';
import { buildingNeed, plantSpec, OUTSIDE_SUPPLY } from '../src/utilities.ts';
import { HOUSEHOLDS, decodeParts, encodeParts, forEachLeg, householdWallet, ledgerRows } from '../src/ledger-parts.ts';
import { keepSupplied } from './plants.ts';

const owner = '11111111-1111-4111-8111-111111111111';
/** A town laid out as a player would: streets every third row, homes, farms, shops and a factory, plants as needed. */
function town(big: boolean, parcels = 60): City {
  const c = createCity(61025, { starter: false }); c.unlocks = { version: 1 };
  if (big) { c.tileScale = TILE_SCALE; c.utilities.outside = { power: OUTSIDE_SUPPLY.power * TILE_SCALE, water: OUTSIDE_SUPPLY.water * TILE_SCALE }; }
  const W = SIZE, H = Math.floor(c.cells.length / SIZE), gy = Math.floor(GATEWAY / SIZE);
  buildRoad(c, GATEWAY, gy * W + 1); buildRoad(c, 1, (H - 1) * W + 1);
  for (let y = 0; y < H; y += 3) buildRoad(c, y * W + 1, y * W + W - 1);
  const pattern = 'RRFRCRIRFRRCRF'; let k = 0, n = 0;
  for (let i = 0; i < c.cells.length && k < parcels; i++) {
    const cell = c.cells[i]; if (cell.road || cell.zone || !access(c, i)) continue;
    if (n++ % 6 === 5) continue;
    if (zoneCell(c, i, pattern[k++ % pattern.length] as Zone).ok) buildReadyParcels(c, i);
    if (keepSupplied(c, 60)) buildReadyParcels(c);
  }
  return c;
}
const run = (c: City, days: number) => { for (let d = 0; d < days; d++) { step(c); if (keepSupplied(c, 60)) buildReadyParcels(c); } };
const people = (c: City) => c.households.reduce((n, h) => n + h.members, 0);

test('a city started on the server is a big town with ten times the gate supply', () => {
  const { city } = deserializeParkSession(freshServerCityRaw(owner));
  assert.equal(city.tileScale, TILE_SCALE); assert.equal(tileScale(city), TILE_SCALE);
  assert.deepEqual(city.utilities.outside, { power: OUTSIDE_SUPPLY.power * TILE_SCALE, water: OUTSIDE_SUPPLY.water * TILE_SCALE });
  assert.ok(city.unlocks);
  assert.equal(maxHouseholds(city), BIG_TOWN_MAX_HOUSEHOLDS);
  assert.equal(maxHouseholds(createCity(61025)), MAX_CITY_HOUSEHOLDS);
});

test('a big town tile holds ten real buildings: farms, mills, shops, homes and plants', () => {
  const big = { industryScale: 1 as const, tileScale: TILE_SCALE }, small = { industryScale: 1 as const };
  for (const [crop, spec] of Object.entries(REAL_CROPS)) {
    const wide = BIG_TOWN_CROPS[crop];
    assert.equal(wide.raiPerTile, spec.raiPerTile * TILE_SCALE, crop);
    assert.deepEqual(wide.hands, spec.hands.map(n => n * TILE_SCALE), crop);
    assert.deepEqual(wide.millTonnesPerDay, spec.millTonnesPerDay.map(n => n * TILE_SCALE), crop);
    assert.equal(realCrop(crop, big), wide); assert.equal(realCrop(crop, small), spec);
    assert.equal(farmStaff(1, big, crop), farmStaff(1, small, crop) * TILE_SCALE, crop);
    assert.ok(millJobsFor(wide, 1) >= millJobsFor(spec, 1) * TILE_SCALE - 1, crop);
  }
  for (const level of [2, 5, 9]) {
    const one = retailCapacity(level), ten = retailCapacity(level, TILE_SCALE);
    assert.equal(ten.workers, one.workers * TILE_SCALE); assert.equal(ten.stock, one.stock * TILE_SCALE);
  }
  const c = town(true, 12), s = town(false, 12);
  const home = c.buildings.find(b => b.zone === 'R')!, plain = s.buildings.find(b => b.zone === 'R')!;
  assert.equal(housingCapacity(home, c).households, housingCapacity(plain, s).households * TILE_SCALE);
  const shop = c.buildings.find(b => b.zone === 'C')!;
  assert.deepEqual(buildingNeed('C', shop.level, 0, c), { power: buildingNeed('C', shop.level, 0, s).power * TILE_SCALE, water: buildingNeed('C', shop.level, 0, s).water * TILE_SCALE });
  assert.equal(firmCapacity(shop, c.firms.find(f => f.building === shop.id), c), firmCapacity(s.buildings.find(b => b.zone === 'C')!, s.firms.find(f => f.zone === 'C'), s) * TILE_SCALE);
  // A plant supplies ten plants' worth.
  for (const kind of ['power', 'water'] as const) {
    const site = c.cells.findIndex((cell, i) => !cell.road && !cell.zone && cell.building === null && !plantAt(c, i) && access(c, i));
    assert.equal(buildPlant(c, site, kind).ok, true, kind);
  }
  for (const kind of ['power', 'water'] as const) assert.equal(utilities(c).plants[kind], c.plants.filter(p => p.kind === kind).reduce((n, p) => n + plantSpec(p).capacity, 0) * TILE_SCALE, kind);
});

test('a big town grows to about a thousand people in a quarter, saves and loads back exactly, and keeps its limits', { timeout: 600_000 }, () => {
  const c = town(true, 120);
  let homeless = 0;
  for (let d = 1; d <= 90; d++) {
    const before = c.households.length; run(c, 1);
    // Never more than a twentieth of the town (twenty while it is small) a night, and few without a home.
    // (The night's second arrival pass, for homes built that night, has the same limit.)
    assert.ok(c.households.length - before <= 2 * Math.max(20, Math.ceil(before * .05)), `day ${d}: ${c.households.length - before} arrivals`);
    homeless = Math.max(homeless, c.households.filter(h => h.home === null).length);
    assert.ok(c.households.filter(h => h.home === null).length <= Math.max(2, Math.floor(c.households.length * .05)), `day ${d}: homeless`);
  }
  assert.ok(people(c) >= 900, `${people(c)} people after 90 days`);
  const json = serialize(c), back = deserialize(json);
  assert.equal(serialize(back), json);
  // The same city plays on the same way after a reload.
  run(c, 2); run(back, 2); assert.equal(serialize(back), serialize(c));
  // The one-pass counts are the one-at-a-time counts.
  const counts = workerCounts(c);
  for (const h of c.households) assert.equal(counts.household(h.id), householdWorkerCount(c, h.id));
  for (const f of c.firms) assert.equal(counts.firm(f.id), firmWorkerCount(c, f.id));
});

test('a big town writes the day\'s shopping as summaries, each household once, and saves them compactly', { timeout: 300_000 }, () => {
  const c = town(true, 40); run(c, 20);
  const summaries = c.ledger.filter(e => e.parts !== undefined && e.tick === c.tick);
  assert.ok(summaries.some(e => e.reason === 'Household purchases' && e.from === HOUSEHOLDS));
  for (const e of summaries) {
    let total = 0; const seen = new Set<string>();
    forEachLeg(e, (from, to, amount) => { const wallet = e.from === HOUSEHOLDS ? from : to; assert.ok(!seen.has(wallet)); seen.add(wallet); assert.ok(wallet in c.accounts); total += amount; });
    assert.equal(total, e.amount);
  }
  // Readers that follow one household see its own rows.
  const h = c.households.find(x => x.lastPurchaseTick === c.tick)!;
  assert.ok(ledgerRows(c.ledger).some(e => e.tick === c.tick && e.from === householdWallet(h.id) && e.reason === `Household #${h.id} purchase`));
  // In the save the parts are text; loading gives the numbers back.
  const saved = JSON.parse(serialize(c)) as { ledger: { parts?: unknown }[]; goodsLedger: { parts?: unknown }[] };
  const written = [...saved.ledger, ...saved.goodsLedger].filter(e => e.parts !== undefined);
  assert.ok(written.length && written.every(e => typeof e.parts === 'string'));
  assert.deepEqual(deserialize(serialize(c)).ledger, c.ledger);
});

test('summary parts have one spelling, and a save with anything else is refused', { timeout: 300_000 }, () => {
  assert.equal(encodeParts([337, 9000, 338, 9000, 340, 18000]), '9d.6y0,1,2.dw0');
  assert.deepEqual(decodeParts('9d.6y0,1,2.dw0'), [337, 9000, 338, 9000, 340, 18000]);
  assert.deepEqual(decodeParts(encodeParts([100, 2, 50, 2, 51, 3])), [100, 2, 50, 2, 51, 3]);
  for (const bad of ['', '01.1', '1.01', '9d.6y0,1.6y0', '-0.5', '1.5,,2', 'X.1', [1, 5]]) assert.equal(decodeParts(bad), null, JSON.stringify(bad));
  const c = town(true, 30); run(c, 12);
  const json = serialize(c), raw = JSON.parse(json) as { ledger: { parts?: string; amount: number }[] };
  const at = raw.ledger.findIndex(e => typeof e.parts === 'string' && e.parts.includes(','));
  assert.ok(at >= 0);
  const tamper = (edit: (e: { parts?: unknown; amount: number }) => void) => { const copy = JSON.parse(json); edit(copy.ledger[at]); return JSON.stringify(copy); };
  for (const bad of [
    tamper(e => { e.parts = decodeParts(e.parts); }), // numbers where the save writes text
    tamper(e => { e.parts = `${e.parts},1`; }), // a household more than the total
    tamper(e => { e.parts = String(e.parts).replace(/^([0-9a-z]+)\./, '0$1.'); }), // another spelling
    tamper(e => { e.amount += 1; }), // a total its parts do not make
  ]) assert.throws(() => deserialize(bad), /corrupt|invalid/i);
});

test('a big town that is full takes in nobody, and says why', { timeout: 300_000 }, () => {
  const c = town(true, 30); run(c, 3);
  // The same town with room takes people in tonight.
  const open = structuredClone(c), first = open.nextId; run(open, 1);
  assert.ok(open.households.some(h => h.id >= first), 'a town with room takes in households');
  // Filled to its limit with households still looking for a home, it takes in nobody.
  while (c.households.length < BIG_TOWN_MAX_HOUSEHOLDS) {
    const id = c.nextId++, wallet = `household:${id}`;
    c.accounts[wallet] = 0;
    c.households.push({ ...structuredClone(c.households[0]), id, home: null, wallet, lastPurchaseTick: -1, needs: 0 });
  }
  const next = c.nextId; run(c, 1);
  assert.ok(!c.households.some(h => h.id >= next), 'a full town takes in no one');
  const home = c.buildings.find(b => b.zone === 'R')!;
  assert.ok(explainMigration(c, home.id).includes(`เมืองใหญ่รับได้สูงสุด ${BIG_TOWN_MAX_HOUSEHOLDS.toLocaleString('en-US')} ครัวเรือน ตอนนี้เต็มแล้ว`));
});
