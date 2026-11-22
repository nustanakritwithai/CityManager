import test from 'node:test';
import assert from 'node:assert/strict';
import { createCity, step, serialize, deserialize, adoptSavedEducation, housingUpgradeStatus, housingShortage, homeOccupancy, residentialGrowthCost, productionUpgradeStatus, retailGrowthStatus, isMarket, isRetail, zoneCell, access, type Building } from '../src/sim.ts';
import { factoryLevel } from '../src/factory-levels.ts';
import { RETAIL_MAX_LEVEL } from '../src/retail-capacity.ts';
import { farmStockCapacity, proposeHarvest, proposeRecipe } from '../src/agriculture.ts';
import { HOUSING_LEVELS, redevelopsAt } from '../src/housing.ts';
import { populationFixture } from './population-capacity-fixture.ts';
import { holdEducationReady } from './education-ready.ts';

const maximum = (b: Building) => b.zone === 'R' || b.zone === 'I' ? 9 : b.zone === 'F' ? 6 : RETAIL_MAX_LEVEL;

test('filled apartment and condo tiers upgrade once on the same tile, while absent credentials still block them', () => {
  // Reconciled synthetic census: enough real household records to fill the upper tiers.
  // Normal daily labor, paid retail and migration establish the residents' financial gates.
  const source = populationFixture(240);
  for (let cell = 0; cell < source.cells.length; cell++) {
    const item = source.cells[cell];
    if (!item.road && !item.zone && item.building === null && access(source, cell)) {
      assert.equal(zoneCell(source, cell, 'C').ok, true);
      if (source.cells.filter(item => item.zone === 'C').length === 4) break;
    }
  }
  // Use a month-end outside the weekly relocation day so this scenario
  // isolates the credential/occupancy upgrade gate rather than moving out first.
  while (source.tick < 449) step(source);
  for (let level = 4; level < 9; level++) {
    // Replacing a block with a tower also waits for people needing homes: see the next test.
    if (redevelopsAt(level)) continue;
    const city = structuredClone(source), [home, ...others] = city.buildings.filter(b => b.zone === 'R');
    home.level = level; home.housingType = HOUSING_LEVELS[level - 1].type;
    // Fill this home's rooms; everyone else lives in the other towers, each up to its own rooms.
    const room = new Map(others.map(b => [b.id, HOUSING_LEVELS[b.level - 1].households]));
    for (const [i, h] of city.households.entries()) {
      if (i < HOUSING_LEVELS[level - 1].households) { h.home = home.id; continue; }
      const spare = others.find(b => room.get(b.id)! > 0)!; room.set(spare.id, room.get(spare.id)! - 1); h.home = spare.id;
    }
    holdEducationReady(city);
    assert.deepEqual(deserialize(serialize(city)), city);
    assert.deepEqual(housingUpgradeStatus(city, home).blocked, []);
    const blocked = structuredClone(city);
    for (const person of blocked.education!.people) person.basic = person.higher = 0;
    blocked.education!.residentBasic = blocked.education!.residentHigher = 0;
    assert.ok(housingUpgradeStatus(blocked, blocked.buildings.find(b => b.id === home.id)!).blocked.some(reason => reason.includes('วุฒิ')));
    step(blocked); assert.equal(blocked.buildings.find(b => b.id === home.id)!.level, level);
    const residents = city.households.filter(h => h.home === home.id).map(h => [h.id, h.members, h.wallet]);
    const identity = { id: home.id, cell: home.cell };
    step(city);
    assert.equal(home.level, level + 1); assert.equal(home.housingType, HOUSING_LEVELS[level].type);
    assert.deepEqual({ id: home.id, cell: home.cell }, identity); assert.equal(city.cells[home.cell].building, home.id);
    assert.deepEqual(city.households.filter(h => h.home === home.id).map(h => [h.id, h.members, h.wallet]), residents);
    const investment = city.ledger.filter(e => e.tick === city.tick && e.reason === 'Outside residential height investment');
    assert.equal(investment.length, 1); assert.equal(investment[0].amount, residentialGrowthCost(level));
    assert.deepEqual(deserialize(serialize(city)), city);
  }
});

test('a full 40-room block becomes a 200-room tower when every room in the city is taken and jobs are open', () => {
  const city = populationFixture(40), [home, ...others] = city.buildings.filter(b => b.zone === 'R');
  home.level = 6; home.housingType = 'apartment';
  for (const h of city.households) h.home = home.id;
  // The city's only home: tear down the empty towers.
  for (const b of others) { city.cells[b.cell] = { road: false, zone: null, building: null }; city.buildings.splice(city.buildings.indexOf(b), 1); }
  // Shops for the residents to buy from, as above, then the same month-end.
  for (let cell = 0; cell < city.cells.length && city.cells.filter(item => item.zone === 'C').length < 4; cell++) {
    const item = city.cells[cell];
    if (!item.road && !item.zone && item.building === null && access(city, cell)) assert.equal(zoneCell(city, cell, 'C').ok, true);
  }
  while (city.tick < 449) step(city);
  holdEducationReady(city);
  assert.equal(homeOccupancy(city, home.id).households, 40);
  assert.equal(housingShortage(city), true, 'hiring, no one idle, not one room free');
  assert.deepEqual(housingUpgradeStatus(city, home).blocked, []);
  const before = city.tick; step(city);
  assert.equal(home.level, 7); assert.equal(home.housingType, 'condo');
  assert.deepEqual(city.ledger.filter(e => e.tick > before && e.reason === 'Outside residential height investment').map(e => e.amount), [160 * 20_000]);
  assert.deepEqual(deserialize(serialize(city)), city);
});

test('all maximum levels survive education adoption and monthly review without another upgrade charge', () => {
  const source = createCity(61025); for (let day = 0; day < 119; day++) step(source);
  source.utilities.outside = { power: 1000, water: 1000 };
  delete source.education;
  for (const b of source.buildings) {
    if (b.zone === 'C' && source.firms.some(f => f.building === b.id && isMarket(f))) continue;
    b.level = maximum(b); if (b.zone === 'R') b.housingType = 'condo';
  }
  const raw = serialize(source), envelope = JSON.parse(raw);
  assert.equal(envelope.version, 28); assert.equal(envelope.rulesVersion, 'chain-23');
  assert.equal(envelope.commercialBaseVersion, 24); assert.equal(envelope.historyBaseVersion, 19);
  assert.equal(envelope.education, undefined);
  const city = deserialize(raw), identities = city.buildings.map(b => ({ ...b }));
  const people = city.households.map(h => [h.id, h.members, h.home]);
  const previousTick = city.tick;
  adoptSavedEducation(city);
  assert.deepEqual(city.buildings, identities); assert.equal(city.education!.residentBasic, 0); assert.equal(city.education!.residentHigher, 0);
  for (const b of city.buildings.filter(b => b.zone === 'R')) assert.equal(housingUpgradeStatus(city, b).next, null);
  for (const f of city.firms.filter(f => f.zone === 'I' || f.zone === 'F')) assert.equal(productionUpgradeStatus(city, f).nextLevel, null);
  for (const f of city.firms.filter(isRetail)) assert.equal(retailGrowthStatus(city, f).next, null);
  step(city);
  for (const before of identities) {
    const after = city.buildings.find(b => b.id === before.id)!;
    assert.equal(after.level, before.level); assert.equal(after.cell, before.cell); assert.equal(city.cells[after.cell].building, before.id);
  }
  // Households keep their homes; one with no home yet (real rules) may move into a room the review left free.
  assert.deepEqual(city.households.filter(h => people.some(([id]) => id === h.id)).map(h => [h.id, h.members, people.find(([id]) => id === h.id)![2] === null ? null : h.home]), people);
  const arrivals = city.households.filter(h => !people.some(([id]) => id === h.id));
  assert.equal(arrivals.length, city.ledger.filter(e => e.tick === city.tick && e.reason === 'New household arrival savings').length);
  for (const h of arrivals) assert.ok(city.ledger.some(e => e.tick === city.tick && e.to === h.wallet && e.reason === 'New household arrival savings' && e.amount === 150_000));
  assert.equal(city.ledger.filter(e => e.tick > previousTick && /height investment$/.test(e.reason)).length, 0, 'no new upgrade is charged');
  assert.equal(Object.values(city.accounts).reduce((sum, value) => sum + value, 0), 0);
  assert.deepEqual(deserialize(serialize(city)), city);
  assert.equal(serialize(source), raw, 'loading and migration never alter the original snapshot');
});

test('every building class rejects invalid level boundaries and unknown envelopes without mutation', () => {
  const city = createCity(61025); for (let day = 0; day < 60; day++) step(city);
  const original = serialize(city);
  for (const zone of ['R', 'F', 'I', 'C'] as const) {
    const b = city.buildings.find(b => b.zone === zone && (zone !== 'C' || city.firms.some(f => f.building === b.id && isRetail(f))))!;
    assert.ok(b);
    for (const level of [0, -1, 1.5, maximum(b) + 1]) {
      const parsed = JSON.parse(original); parsed.buildings.find((item: Building) => item.id === b.id).level = level;
      assert.throws(() => deserialize(JSON.stringify(parsed)), `${zone} ${level}`);
    }
  }
  const future = JSON.parse(original); future.version = 999; future.rulesVersion = 'chain-future';
  assert.throws(() => deserialize(JSON.stringify(future)));
  assert.equal(serialize(city), original);
});

test('every factory tier limits output to actual staff and ingredients and rejects a repeated daily operation', () => {
  for (let level = 1; level <= 9; level++) {
    const { jobs, crops } = factoryLevel(level);
    for (const [workers, input, batches] of [[0, crops, 0], [1, crops, 1], [jobs, 1, 0], [jobs, 3, 1], [jobs, crops, jobs]]) {
      const state = { cropInventory: input, cropCost: input * 350, inventory: 0, productionTick: 0 };
      const options = { tick: 1, workers, operational: true, cropCapacity: crops };
      const result = proposeRecipe(state, options);
      assert.equal(result.batches, batches, `level ${level}, workers ${workers}, input ${input}`);
      assert.equal(result.quantity, batches * 2); assert.equal(result.outputQuantity, batches * 8);
      assert.equal(result.next.cropInventory, input - batches * 2);
      const duplicate = proposeRecipe(result.next, options);
      assert.equal(duplicate.ok, false); assert.deepEqual(duplicate.next, result.next);
    }
  }
});

test('every farm tier limits actual harvest by staff and remaining storage exactly once per day', () => {
  for (let level = 1; level <= 6; level++) {
    const capacity = farmStockCapacity(level);
    for (const [workers, stored, produced] of [[0, 0, 0], [1, 0, 24], [level, capacity - 1, 1], [level, capacity, 0]]) {
      const options = { tick: 1, workers, fertility: 100, operational: true, capacity };
      const result = proposeHarvest({ cropInventory: stored, cropCost: 0, productionTick: 0 }, options);
      assert.equal(result.quantity, produced); assert.equal(result.next.cropInventory, stored + produced);
      const duplicate = proposeHarvest(result.next, options);
      assert.equal(duplicate.ok, false); assert.deepEqual(duplicate.next, result.next);
    }
  }
});
