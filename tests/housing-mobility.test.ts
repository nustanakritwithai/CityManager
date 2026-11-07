import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildRoad, createCity, deserialize, explainMigration, homeOccupancy, housingCapacity,
  HOUSING_RELOCATION_INTERVAL, HOUSING_RELOCATION_LIMIT, moveHousehold, rebalanceHousing,
  serialize, step, utilities, GATEWAY, SIZE, type City,
} from '../src/sim.ts';

function concentrated() {
  const city = deserialize(readFileSync(new URL('./fixtures/legacy-v3-day180.json', import.meta.url), 'utf8'));
  city.tick = 182;
  const homes = city.buildings.filter(b => b.zone === 'R').sort((a, b) => a.cell - b.cell);
  const source = homes[0]; source.level = 9; source.housingType = 'condo';
  for (const h of city.households) h.home = source.id;
  for (const home of homes.slice(1)) { home.level = 3; home.housingType = 'cottage'; }
  assert.deepEqual(deserialize(serialize(city)), city);
  return { city, homes, source };
}
function withoutAddresses(city: City) {
  return { ...city, households: city.households.map(h => ({ ...h, home: null })) };
}
function validOccupancy(city: City) {
  for (const home of city.buildings.filter(b => b.zone === 'R')) {
    const used = homeOccupancy(city, home.id), room = housingCapacity(home);
    assert.ok(used.households <= room.households); assert.ok(used.persons <= room.persons);
  }
}

test('weekly review fills several new homes from the old tower without changing people, jobs, money or IDs', () => {
  const { city, homes, source } = concentrated(), before = structuredClone(city);
  assert.equal(rebalanceHousing(city), HOUSING_RELOCATION_LIMIT);
  assert.equal(homeOccupancy(city, source.id).households, 2);
  assert.ok(homes.slice(1).every(home => homeOccupancy(city, home.id).households === 1));
  assert.deepEqual(withoutAddresses(city), withoutAddresses(before));
  validOccupancy(city); assert.deepEqual(deserialize(serialize(city)), city);
});

test('balanced homes do not swap their last household or oscillate through repeated weekly reviews', () => {
  const { city } = concentrated(); rebalanceHousing(city);
  const addresses = city.households.map(h => [h.id, h.home]);
  for (let n = 0; n < 104; n++) {
    city.tick += HOUSING_RELOCATION_INTERVAL;
    assert.equal(rebalanceHousing(city), 0);
    assert.deepEqual(city.households.map(h => [h.id, h.home]), addresses);
  }
});

test('real daily steps run the weekly review and replay deterministically after save/load', () => {
  const { city, source } = concentrated(); city.tick--;
  const restored = deserialize(serialize(city));
  step(city); step(restored);
  assert.ok(homeOccupancy(city, source.id).households < 6);
  assert.deepEqual(restored, city);
  for (let n = 0; n < 35; n++) { step(city); step(restored); validOccupancy(city); }
  assert.deepEqual(restored, city);
  assert.deepEqual(deserialize(serialize(city)), city);
});

test('review waits for its weekly day, excludes same-day construction and ignores disconnected homes', () => {
  const { city, homes } = concentrated(); city.tick--;
  const before = serialize(city); assert.equal(rebalanceHousing(city), 0); assert.equal(serialize(city), before);
  city.tick++;
  for (const home of homes.slice(1)) home.age = 0;
  assert.equal(rebalanceHousing(city), 0);
  for (const home of homes.slice(1)) home.age = 1;
  city.cells[GATEWAY + 1].road = false;
  assert.equal(rebalanceHousing(city), 0);
});

test('full destinations and independent member capacity are never exceeded or split', () => {
  const { city, homes, source } = concentrated();
  for (const home of homes.slice(1)) { home.level = 1; home.housingType = 'cottage'; }
  for (const [index, h] of city.households.slice(0, 4).entries()) h.home = homes[index + 1].id;
  const before = serialize(city); assert.equal(rebalanceHousing(city), 0); assert.equal(serialize(city), before);
  // A synthetic large family cannot fit a 4-person cottage even if its slot is empty.
  for (const h of city.households) { h.home = source.id; h.members = 5; h.workforce = 2; h.dependents = 3; }
  const members = city.households.map(h => h.members);
  assert.equal(rebalanceHousing(city), 0); assert.deepEqual(city.households.map(h => h.members), members);
  assert.ok(city.households.every(h => h.home === source.id)); validOccupancy(city);
});

test('an exactly supplied city can move existing residents without requiring extra utility capacity', () => {
  const { city, homes } = concentrated();
  city.utilities.outside = { ...utilities(city).used };
  assert.deepEqual(utilities(city).spare, { power: 0, water: 0 });
  const used = utilities(city).used, before = structuredClone(city);
  assert.equal(moveHousehold(city, city.households[0].id, homes[1].id).ok, true);
  assert.deepEqual(utilities(city).used, used);
  assert.ok([...utilities(city).served.values()].every(s => s.power && s.water));
  assert.deepEqual(withoutAddresses(city), withoutAddresses(before));
});

test('a rejected relocation cannot deprive another building of power or water and leaves state unchanged', () => {
  const { city, homes } = concentrated();
  for (const h of city.households) h.home = homes.at(-1)!.id;
  city.utilities.outside = { power: 1, water: 1 };
  const before = serialize(city), service = utilities(city);
  assert.ok([...service.served.values()].some(s => !s.power || !s.water));
  assert.equal(moveHousehold(city, city.households[0].id, homes[0].id).ok, false);
  assert.equal(serialize(city), before);
});

test('displaced households retain priority over voluntary moves', () => {
  const { city } = concentrated(); city.households[0].home = null;
  const before = serialize(city); assert.equal(rebalanceHousing(city), 0); assert.equal(serialize(city), before);
  city.tick--; step(city);
  assert.ok(city.households.every(h => h.home !== null)); validOccupancy(city);
});

test('new arrivals choose the empty later parcel instead of repeatedly filling the older tower', () => {
  const city = createCity(61025, { starter: false });
  buildRoad(city, GATEWAY, GATEWAY + 8);
  const cells = [11 * SIZE + 2, 11 * SIZE + 6];
  const homes = cells.map((cell, index) => ({ id: city.nextId++, cell, zone: 'R' as const, level: index ? 1 : 3, housingType: 'cottage' as const, age: 0 }));
  city.buildings.push(...homes);
  for (const home of homes) { city.cells[home.cell].zone = 'R'; city.cells[home.cell].building = home.id; }
  step(city); assert.equal(city.households[0].home, homes[0].id);
  step(city); assert.equal(city.households[1].home, homes[1].id);
  assert.equal(city.migration.arrivals, 2);
  assert.equal(city.ledger.filter(e => e.reason === 'New household arrival savings').length, 2);
  assert.deepEqual(deserialize(serialize(city)), city);
});

test('save loading is read-only: concentrated homes change only when simulation runs', () => {
  const { city } = concentrated(), raw = serialize(city), restored = deserialize(raw);
  assert.equal(serialize(restored), raw);
  assert.equal(serialize(deserialize(raw)), raw);
  assert.match(explainMigration(restored, city.buildings.find(b => b.zone === 'R')!.id).join('\n'), /ทุก 7 วัน/);
  assert.equal(serialize(restored), raw, 'the explanation cannot trigger a move');
});

/** Adversarial synthetic network, independent of growth or immigration rules. */
function shortageNetwork(oneViableDonor = false) {
  const city = createCity(1, { starter: false }); city.tick = 7;
  city.cells.forEach(cell => { cell.road = true; cell.zone = null; cell.building = null; });
  const sites = city.cells.map((_, i) => i).filter(i => Math.floor(i / 24) % 2 === 1 && i % 24 !== 23)
    .sort((a, b) => Math.abs(Math.floor(a / 24) - 12) + a % 24 - (Math.abs(Math.floor(b / 24) - 12) + b % 24)).slice(0, 192);
  const template = concentrated().city.households.find(h => h.members === 1)!;
  for (const [index, cell] of sites.entries()) {
    const id = 100 + index, cottage = index < 20;
    city.cells[cell] = { road: false, zone: 'R', building: id };
    city.buildings.push({ id, cell, zone: 'R', level: cottage ? 1 : 9, housingType: cottage ? 'cottage' : 'condo', age: 7 });
    const count = cottage ? 1 : index < 106 ? oneViableDonor && index === 20 ? 2 : 32 : 0;
    for (let n = 0; n < count; n++) city.households.push({ ...template, id: 1000 + index * 32 + n, home: id });
  }
  if (oneViableDonor) city.utilities.outside = { power: 22, water: 22 };
  return city;
}

test('192-home utility shortages bound rejected feasibility work as well as successful moves', () => {
  const city = shortageNetwork(), supply = city.utilities; let reads = 0;
  Object.defineProperty(city, 'utilities', { enumerable: true, get() { reads++; return supply; } });
  assert.equal(rebalanceHousing(city), 0);
  // A full feasibility check reads live supply four times for its baseline and
  // once when copying the candidate city. This checks work, not machine speed.
  assert.ok(reads > 0 && reads <= 32 * 5, `utility snapshot reads: ${reads}`);
});

test('bounded reviews eventually reach a viable lower-occupancy donor after many unusable towers', () => {
  const city = shortageNetwork(true), donor = 120;
  assert.equal(homeOccupancy(city, donor).households, 2); assert.equal(utilities(city).ok(donor), true);
  let moves = 0;
  for (let week = 0; week < 12 && !moves; week++) { moves += rebalanceHousing(city); city.tick += 7; }
  assert.ok(moves > 0, 'rejected high-occupancy pairs must not permanently starve a feasible later pair');
  assert.equal(homeOccupancy(city, donor).households, 1); validOccupancy(city);
});
