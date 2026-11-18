import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCity, step, buildPark, buildCivic, civicSiteReason, homeGrowthAge, housingUpgradeStatus, serialize, deserialize, landValues, access, MONTH, type City } from '../src/sim.ts';
import { POLLUTION, POLLUTION_HAPPINESS_CAP, PRIME_LAND, RENT_BASE, householdRent, landValue, pollutionAt, pollutionHappinessPoints, pollutionMap, pollutionReader } from '../src/environment.ts';
import { happinessTarget, happinessTargets, homeAmenities } from '../src/resident-happiness.ts';
import { mapOverlay, TOOL_OVERLAY } from '../src/map-overlay.ts';
import { expandedCellCoordinate } from '../src/expanded-map-grid.ts';

const grown = () => { const c = createCity(61025); for (let i = 0; i < 120; i++) step(c); return c; };
const distance = (a: number, b: number) => { const x = expandedCellCoordinate(a), y = expandedCellCoordinate(b); return Math.abs(x.x - y.x) + Math.abs(x.z - y.z); };

test('a city with nothing that pollutes has clean air everywhere', () => {
  const c = createCity(61025, { starter: false });
  assert.ok(pollutionMap(c).every(p => p === 0));
});

test('a factory pollutes most at its own parcel and nothing past its radius', () => {
  const c = grown(), factory = c.buildings.find(b => b.zone === 'I')!; assert.ok(factory, 'the starter city grows a factory');
  const read = pollutionReader(c), at = read(factory.cell);
  assert.ok(at > 0 && at <= 100);
  const near = c.cells.map((_, i) => i).filter(i => distance(i, factory.cell) === 2 && !c.parks.some(p => distance(i, p.cell) <= POLLUTION.park.radius));
  const far = c.cells.map((_, i) => i).filter(i => distance(i, factory.cell) > POLLUTION.factory.radius + 2 && !c.buildings.some(b => b.zone === 'I' && distance(i, b.cell) <= POLLUTION.factory.radius) && !c.plants.some(p => p.kind === 'power' && distance(i, p.cell) <= POLLUTION.power.radius));
  for (const i of near) assert.ok(read(i) < at, 'fades with distance');
  for (const i of far) assert.equal(read(i), 0, 'nothing past the radius');
});

test('a park cleans the air around it', () => {
  const c = grown(), factory = c.buildings.find(b => b.zone === 'I')!;
  const spot = c.cells.map((_, i) => i).find(i => distance(i, factory.cell) === 1 && buildPark(deserialize(serialize(c)), i).ok);
  assert.notEqual(spot, undefined, 'a park fits next to the factory');
  const before = pollutionAt(c, factory.cell); assert.equal(buildPark(c, spot!).ok, true);
  assert.equal(pollutionAt(c, factory.cell), Math.max(0, before - POLLUTION.park.cleaning));
});

test('pollution costs a home happiness, a point per five, up to the cap', () => {
  assert.equal(pollutionHappinessPoints(0), 0); assert.equal(pollutionHappinessPoints(4), 0); assert.equal(pollutionHappinessPoints(14), 2);
  assert.equal(pollutionHappinessPoints(100), POLLUTION_HAPPINESS_CAP);
  const amenities = { parkNearby: false, schoolNearby: false, points: 0 };
  assert.equal(happinessTarget(amenities, undefined, 0, 0, 7), happinessTarget(amenities) - 7);
  const c = grown(), homes = new Map(c.buildings.map(b => [b.id, b.cell]));
  for (const [id, facts] of happinessTargets(c)) {
    const h = c.households.find(h => h.id === id)!;
    assert.equal(facts.pollution, h.home === null ? 0 : pollutionAt(c, homes.get(h.home)!));
    assert.equal(facts.pollutionPoints, pollutionHappinessPoints(facts.pollution));
  }
});

test('land value rises with what is in reach and a road, and falls with pollution', () => {
  assert.ok(landValue(20, true, 0) > landValue(0, true, 0));
  assert.ok(landValue(0, true, 0) > landValue(0, false, 0));
  assert.ok(landValue(10, true, 40) < landValue(10, true, 0));
  assert.equal(landValue(0, false, 100), 0); assert.equal(landValue(100, true, 0), 100);
});

test('the park tool shows pollution and service tools show land value; both layers have a legend', () => {
  const c: City = grown();
  assert.equal(TOOL_OVERLAY.park, 'pollution'); assert.equal(TOOL_OVERLAY.hospital, 'landvalue'); assert.equal(TOOL_OVERLAY.cinema, 'landvalue');
  const pollution = mapOverlay(c, 'pollution'), land = mapOverlay(c, 'landvalue');
  assert.ok(pollution.cells.length > 0 && pollution.legend.length === 3);
  assert.ok(land.cells.length > 0 && land.legend.length === 3);
  assert.ok(pollution.cells.every(cell => !c.cells[cell.cell].road));
});

test('the land value reader agrees with the formula for every parcel it is asked about', () => {
  const c = grown(), read = landValues(c), air = pollutionReader(c);
  for (const cell of [0, ...c.buildings.map(b => b.cell)]) assert.equal(read(cell), landValue(homeAmenities(c, cell).points, access(c, cell), air(cell)));
});

test('rent follows land value: 10,000 at 50, from 7,000 to 13,000, and each home pays its own at month end', () => {
  assert.equal(householdRent(50), RENT_BASE); assert.equal(householdRent(0), 7_000); assert.equal(householdRent(100), 13_000);
  assert.equal(householdRent(-5), 7_000); assert.equal(householdRent(140), 13_000);
  const c = createCity(61025); for (let i = 0; i < 59; i++) step(c);
  const worth = landValues(c), homes = new Map(c.households.map(h => [h.wallet, h.home]));
  step(c); // day 60 is a month end
  const rents = c.ledger.filter(e => e.tick === 60 && e.reason === 'Monthly household rent');
  assert.ok(rents.length > 0);
  for (const e of rents) assert.equal(e.amount, householdRent(worth(c.buildings.find(b => b.id === homes.get(e.from))!.cell)), e.from);
});

test('homes on prime land may grow at half the usual age; other homes still wait a month', () => {
  const c = grown(), home = c.buildings.find(b => b.zone === 'R')!;
  c.accounts.treasury += 5_000_000; c.accounts.outside -= 5_000_000;
  // Ring the home with services until its land is prime.
  for (const kind of ['clinic', 'police', 'fire', 'library', 'temple', 'museum'] as const) {
    if (landValues(c)(home.cell) >= PRIME_LAND) break;
    const spot = c.cells.map((_, i) => i).filter(i => civicSiteReason(c, i, kind) === null).sort((a, b) => distance(a, home.cell) - distance(b, home.cell))[0];
    assert.equal(buildCivic(c, spot, kind).ok, true, kind);
  }
  assert.ok(landValues(c)(home.cell) >= PRIME_LAND, 'the home sits on prime land');
  assert.equal(homeGrowthAge(c, home), MONTH / 2);
  const plain = c.buildings.find(b => b.zone === 'R' && landValues(c)(b.cell) < PRIME_LAND);
  if (plain) assert.equal(homeGrowthAge(c, plain), MONTH);
  home.age = MONTH / 2;
  assert.ok(!housingUpgradeStatus(c, home).blocked.some(reason => reason.startsWith('อาคารต้องมีอายุ')), 'half a month is old enough on prime land');
  home.age = MONTH / 2 - 1;
  assert.ok(housingUpgradeStatus(c, home).blocked.some(reason => reason.includes(`${MONTH / 2} วัน`)), 'younger homes are told the shorter wait');
});
