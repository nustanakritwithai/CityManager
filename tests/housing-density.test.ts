import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HOUSING_LEVELS, getHousingCapacity } from '../src/housing.ts';
import { buildPark, createCity, deserialize, serialize, step, housingUpgradeStatus, homeOccupancy, householdWorkerCount, housingShortage, residentialGrowthCost, landValues, connectedRoads, SIZE, type City } from '../src/sim.ts';
import { advanceParkRuntime, createParkRuntime, serializeParkSession, deserializeParkSession } from '../src/park-runtime.ts';
import { holdEducationReady } from './education-ready.ts';
import { legacyIndustry } from './legacy-sizes.ts';

function fixture() {
  // Real homes; the old workplaces keep the seeded city's jobs, so its people wait for homes as before.
  const city = legacyIndustry(createCity(61025)); for (let n = 0; n < 119; n++) step(city);
  const home = city.buildings.find(b => b.zone === 'R' && homeOccupancy(city, b.id).households === 1 && city.households.some(h => h.home === b.id && householdWorkerCount(city, h.id) > 0 && city.tick - h.lastPurchaseTick <= 3))!;
  assert.ok(home); return { city, home };
}

test('all residential levels have explicit monotonic dual capacities and strict type pairings', () => {
  assert.deepEqual(HOUSING_LEVELS.map(x => [x.type, x.tierLevel, x.households, x.persons]), [
    ['cottage', 1, 1, 4], ['cottage', 2, 1, 8], ['cottage', 3, 1, 12],
    ['apartment', 1, 40, 120], ['apartment', 2, 40, 160], ['apartment', 3, 40, 200],
    ['condo', 1, 200, 600], ['condo', 2, 200, 800], ['condo', 3, 200, 1000],
  ]);
  for (const [i, x] of HOUSING_LEVELS.entries()) assert.deepEqual(getHousingCapacity(x.type, i + 1), { households: x.households, persons: x.persons });
  assert.throws(() => getHousingCapacity('cottage', 4)); assert.throws(() => getHousingCapacity('apartment', 7));
});

/** Move other existing households into the home until its current household slots are full. */
function fill(city: ReturnType<typeof createCity>, home: { id: number; level: number }): boolean {
  const need = HOUSING_LEVELS[home.level - 1].households - homeOccupancy(city, home.id).households;
  const movers = city.households.filter(h => h.home !== null && h.home !== home.id).slice(0, Math.max(0, need));
  if (movers.length < need) return false;
  for (const h of movers) h.home = home.id;
  return true;
}

test('each autonomous upgrade keeps the same parcel, identity, households and actual funding', () => {
  let upgraded = 0;
  for (let level = 1; level < 9; level++) {
    const { city, home } = fixture(); home.level = level; home.housingType = HOUSING_LEVELS[level - 1].type;
    const full = fill(city, home);
    const id = home.id, cell = home.cell, residents = city.households.filter(h => h.home === id).map(h => [h.id, h.members, h.wallet]);
    const beforeTick = city.tick;
    if (!full) {
      // Not enough households in the city to fill this tier: the occupancy gate must hold it and say why.
      assert.ok(level >= 3, `levels 1-2 are never occupancy gated (${level})`);
      assert.ok(housingUpgradeStatus(city, home).blocked.some(r => r.includes('เต็มทุกช่อง')));
      step(city); assert.equal(home.level, level, `gated ${level}`); continue;
    }
    holdEducationReady(city); step(city);
    assert.equal(home.level, level + 1, `upgrade ${level}`); assert.equal(home.housingType, HOUSING_LEVELS[level].type); upgraded++;
    assert.equal(home.id, id); assert.equal(home.cell, cell); assert.equal(city.cells[cell].building, id);
    assert.deepEqual(city.households.filter(h => h.home === id).map(h => [h.id, h.members, h.wallet]), residents);
    const investment = city.ledger.filter(e => e.tick > beforeTick && e.reason === 'Outside residential height investment');
    assert.ok(investment.length >= 1, 'at least one real height investment occurred');
    // A developer pays for every room added: one for a bigger house, 39 for a 40-room block on a house's plot.
    const costs = new Set([1, 2, 3, 4, 5, 6, 7, 8].map(residentialGrowthCost));
    assert.ok(investment.every(e => e.from === 'outside' && e.to === 'construction' && costs.has(e.amount)));
    assert.ok(investment.some(e => e.amount === residentialGrowthCost(level)), 'this home paid for its own new rooms');
    assert.equal(Object.values(city.accounts).reduce((a, b) => a + b, 0), 0);
    assert.deepEqual(deserialize(serialize(city)), city);
  }
  assert.ok(upgraded >= 3, `cottage 1-2 and at least one filled gated tier upgrade (${upgraded})`);
});

test('apartment and condo tiers upgrade only when every household slot is taken', () => {
  const { city, home } = fixture(); home.level = 4; home.housingType = 'apartment';
  assert.ok(homeOccupancy(city, home.id).households < 40);
  assert.ok(housingUpgradeStatus(city, home).blocked.some(r => r.includes('เต็มทุกช่อง') && r.includes('/40')));
  holdEducationReady(city); step(city); assert.equal(home.level, 4, 'a block with empty rooms is not built higher');
});

/** A free room: an empty house on a lot by a connected road, so no one is waiting for a home. */
function emptyHouse(city: City) {
  const roads = connectedRoads(city), next = (i: number) => [i - 1, i + 1, i - SIZE, i + SIZE];
  const cell = city.cells.findIndex((x, i) => !x.road && x.zone === null && x.building === null && next(i).some(n => roads.has(n)) && !city.parks.some(p => p.cell === i) && !city.plants.some(p => p.cell === i) && !city.education?.campuses.some(k => k.cell === i));
  const id = city.nextId++; city.cells[cell] = { road: false, zone: 'R', building: id };
  city.buildings.push({ id, cell, zone: 'R', level: 1, age: 30, housingType: 'cottage' });
}

test('a full house becomes a 40-room apartment block only while people are waiting for homes', () => {
  const waiting = fixture(), quiet = fixture();
  for (const { city, home } of [waiting, quiet]) { home.level = 3; home.housingType = 'cottage'; holdEducationReady(city); }
  emptyHouse(quiet.city);
  assert.equal(housingShortage(waiting.city), true, 'jobs are open and every room is taken');
  assert.equal(housingShortage(quiet.city), false);
  assert.ok(housingUpgradeStatus(quiet.city, quiet.home).blocked.some(r => r.includes('อพาร์ตเมนต์ 40 ห้อง')));
  const before = waiting.city.tick;
  step(waiting.city); step(quiet.city);
  assert.equal(quiet.home.level, 3, 'no shortage, no rebuild');
  const rebuilt = waiting.city.buildings.filter(b => b.zone === 'R' && b.level === 4);
  assert.equal(rebuilt.length, 1, 'one rebuild a month');
  const investment = waiting.city.ledger.filter(e => e.tick > before && e.reason === 'Outside residential height investment' && e.amount === residentialGrowthCost(3));
  assert.equal(investment.length, 1); assert.equal(investment[0].amount, 39 * 20_000);
});

test('the developer builds on the most valuable full plot', () => {
  const { city } = fixture();
  const houses = city.buildings.filter(b => b.zone === 'R' && homeOccupancy(city, b.id).households === 1 && city.households.some(h => h.home === b.id && householdWorkerCount(city, h.id) > 0 && city.tick - h.lastPurchaseTick <= 3));
  assert.ok(houses.length >= 2);
  for (const b of houses) { b.level = 3; b.housingType = 'cottage'; }
  holdEducationReady(city);
  const worth = landValues(city), best = [...houses].sort((a, b) => worth(b.cell) - worth(a.cell) || a.id - b.id)[0];
  step(city);
  assert.deepEqual(city.buildings.filter(b => b.zone === 'R' && b.level === 4).map(b => b.id), [best.id]);
});

test('upgrade explains and respects road, utility and resident financial conditions', () => {
  const { city, home } = fixture(); home.level = 3; home.housingType = 'cottage';
  assert.equal(housingUpgradeStatus(city, home).next?.type, 'apartment');
  city.households.filter(h => h.home === home.id).forEach(h => { city.accounts[h.wallet] = 0; });
  // Prevent the imminent month-end from paying a wage and making the household eligible;
  // the panel previews that month-end, so it must see the same unpaid state.
  city.firms.forEach(f => { city.accounts[f.wallet] = 0; f.workDays = {}; });
  assert.ok(housingUpgradeStatus(city, home).blocked.some(x => x.includes('200')));
  step(city); assert.equal(home.level, 3);
  const other = fixture(); other.home.level = 3; other.city.utilities.outside = { power: 0, water: 0 };
  assert.ok(housingUpgradeStatus(other.city, other.home).blocked.some(x => x.includes('น้ำและไฟ')));
  step(other.city); assert.equal(other.home.level, 3);
});

/** The genuine v16 session contains only v15-compatible housing levels and no later fields. */
function legacyParkSession() {
  const session = JSON.parse(readFileSync(new URL('./fixtures/housing-v16-park-session.json', import.meta.url), 'utf8'));
  assert.ok(session.buildings.filter((b: Building) => b.zone === 'R').every((b: Building) => b.level <= 3));
  session.version = 15; session.rulesVersion = 'chain-10';
  return session;
}

test('v15 park session migrates without changing state, rejects new housing under old version', () => {
  const session = legacyParkSession(), old = JSON.stringify(session), restored = deserializeParkSession(old);
  const { version: _v, rulesVersion: _r, parkRuntime, ...original } = session;
  const { version, rulesVersion, factoryProgressionStartTick, farmLevelStartTick, commercialUnifiedStartTick, commercialUnifiedBaseline, farmSoilIndependentStartTick, ...actual } = restored.city;
  assert.deepEqual(actual, original); assert.equal(version, 9); assert.equal(rulesVersion, 'chain-4');
  assert.equal(factoryProgressionStartTick, session.tick); assert.equal(farmLevelStartTick, session.tick);
  assert.equal(commercialUnifiedStartTick, session.tick);
  assert.equal(farmSoilIndependentStartTick, session.tick);
  assert.deepEqual(commercialUnifiedBaseline, { moneyEntries: session.ledger.length, cropEntries: session.cropLedger.length, goodsEntries: session.goodsLedger.length });
  assert.deepEqual(JSON.parse(JSON.stringify(restored.runtime)), parkRuntime);
  const saved = serializeParkSession(restored.city, restored.runtime);
  assert.deepEqual(deserializeParkSession(saved), restored);
  const bad = structuredClone(session); const b = bad.buildings.find((x: Building) => x.zone === 'R'); b.level = 4; b.housingType = 'apartment';
  assert.throws(() => deserializeParkSession(JSON.stringify(bad)));
});

test('future and mismatched housing schemas are rejected without changing the saved snapshot', () => {
  const { city, home } = fixture(), original = serialize(city), parsed = JSON.parse(original);
  for (const edit of [
    (v: any) => { v.version = 20; },
    (v: any) => { v.rulesVersion = 'chain-10'; },
    (v: any) => { const b = v.buildings.find((item: any) => item.id === home.id); b.level = 4; b.housingType = 'cottage'; },
    (v: any) => { const b = v.buildings.find((item: any) => item.id === home.id); b.level = 10; b.housingType = 'condo'; },
  ]) { const bad = structuredClone(parsed); edit(bad); assert.throws(() => deserialize(JSON.stringify(bad))); }
  assert.equal(serialize(city), original);
});
