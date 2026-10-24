import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCity, deserialize, bulldoze, householdWorkerCount, housingCapacity, homeOccupancy, moveHousehold } from '../src/sim.ts';
import { flowRows } from '../src/inspector-data.ts';
import { resolvePlace, relatedFlows, cityOverview } from '../src/context-data.ts';

const legacyJson = readFileSync(new URL('./fixtures/legacy-v1-day65.json', import.meta.url), 'utf8');
const populated = () => deserialize(legacyJson);

test('each home resolves only its actual household, and each company only its actual firm', () => {
  const city = populated(), homes = city.buildings.filter(b => b.zone === 'R');
  const a = resolvePlace(city, homes[0].cell), b = resolvePlace(city, homes[1].cell);
  assert.equal(a.building?.id, homes[0].id);
  assert.equal(b.building?.id, homes[1].id);
  assert.deepEqual(a.households, city.households.filter(h => h.home === homes[0].id));
  assert.deepEqual(b.households, city.households.filter(h => h.home === homes[1].id));
  assert.ok(a.households.length > 0 && b.households.length > 0);
  assert.ok(a.households.every(h => !b.households.some(other => other.id === h.id)));
  assert.equal(a.firm, null); assert.equal(b.firm, null);
  const firmA = city.firms[0], firmB = city.firms[1];
  const siteA = city.buildings.find(building => building.id === firmA.building)!;
  const siteB = city.buildings.find(building => building.id === firmB.building)!;
  assert.equal(resolvePlace(city, siteA.cell).firm?.id, firmA.id);
  assert.equal(resolvePlace(city, siteB.cell).firm?.id, firmB.id);
  assert.deepEqual(resolvePlace(city, siteA.cell).households, []);
  assert.notEqual(resolvePlace(city, siteA.cell).firm?.id, firmB.id);
});

test('scoped journals match exact wallet endpoints without household/firm leaks or reindexing', () => {
  const city = createCity();
  city.ledger = [
    { tick: 1, from: 'outside', to: 'household:1', amount: 10000, reason: 'New household arrival savings' },
    { tick: 2, from: 'household:10', to: 'firm:2', amount: 800, reason: 'Household #10 purchase' },
    { tick: 3, from: 'household:1', to: 'firm:2', amount: 800, reason: 'Household #1 purchase' },
    { tick: 3, from: 'firm:20', to: 'household:10', amount: 42000, reason: 'Monthly wages' },
    { tick: 3, from: 'firm:2', to: 'household:1', amount: 42000, reason: 'Monthly wages' },
  ];
  city.goodsLedger = [
    { tick: 2, from: 'firm:2', to: 'household:10', quantity: 1, reason: 'Household final consumption' },
    { tick: 3, from: 'firm:2', to: 'household:1', quantity: 1, reason: 'Household final consumption' },
    { tick: 3, from: 'firm:20', to: 'outside', quantity: 8, reason: 'Exported goods' },
  ];
  assert.deepEqual(relatedFlows(city, 'money', 'household:1').map(row => row.index), [4, 2, 0]);
  assert.deepEqual(relatedFlows(city, 'money', 'firm:2').map(row => row.index), [4, 2, 1]);
  assert.deepEqual(relatedFlows(city, 'goods', 'household:1').map(row => row.index), [1]);
  assert.deepEqual(relatedFlows(city, 'goods', 'firm:2').map(row => row.index), [1, 0]);
  assert.deepEqual(relatedFlows(city, 'money', 'household:'), []);
  assert.deepEqual(relatedFlows(city, 'money', 'missing'), []);
  assert.deepEqual(relatedFlows(city, 'money', 'household:1'), flowRows(city, 'money').filter(row => row.from === 'household:1' || row.to === 'household:1'));
});

test('overview uses inclusive calendar boundaries and actual flows while stocks stay current', () => {
  const city = populated(); city.tick = 40;
  city.accounts.treasury = 98765;
  city.firms.forEach((firm, index) => firm.inventory = (index + 1) * 10);
  city.goods = { produced: 999, imported: 999, consumed: 999, exported: 999 };
  city.ledger = [
    { tick: 10, from: 'outside', to: 'treasury', amount: 99999, reason: 'Old receipt' },
    { tick: 11, from: 'outside', to: 'treasury', amount: 1000, reason: 'Window start receipt' },
    { tick: 40, from: 'firm:1', to: 'treasury', amount: 700, reason: 'Window end receipt' },
    { tick: 11, from: 'treasury', to: 'roadworks', amount: 300, reason: 'Window start expense' },
    { tick: 40, from: 'treasury', to: 'upkeep', amount: 50, reason: 'Window end expense' },
    { tick: 40, from: 'household:1', to: 'firm:2', amount: 800, reason: 'Private purchase' },
    { tick: 41, from: 'outside', to: 'treasury', amount: 88888, reason: 'Future receipt' },
  ];
  city.goodsLedger = [
    { tick: 10, from: 'production', to: 'firm:2', quantity: 100, reason: 'Daily worker production' },
    { tick: 11, from: 'production', to: 'firm:2', quantity: 6, reason: 'Daily worker production' },
    { tick: 40, from: 'outside', to: 'firm:2', quantity: 3, reason: 'Imported shop stock' },
    { tick: 15, from: 'firm:2', to: 'household:1', quantity: 2, reason: 'Household final consumption' },
    { tick: 40, from: 'firm:2', to: 'outside', quantity: 4, reason: 'Exported goods' },
    { tick: 40, from: 'firm:2', to: 'outside', quantity: 50, reason: 'Demolition stock write-off to outside' },
    { tick: 40, from: 'firm:2', to: 'firm:3', quantity: 20, reason: 'Wholesale stock delivery' },
    { tick: 41, from: 'outside', to: 'firm:2', quantity: 200, reason: 'Imported shop stock' },
  ];
  const overview = cityOverview(city);
  assert.deepEqual([overview.fromTick, overview.toTick], [11, 40]);
  assert.deepEqual([overview.income, overview.expense, overview.net], [1700, 350, 1350]);
  assert.deepEqual([overview.produced, overview.imported, overview.consumed, overview.exported], [6, 3, 2, 4]);
  assert.equal(overview.treasury, 98765);
  assert.equal(overview.inventory, city.firms.reduce((sum, firm) => sum + firm.inventory, 0));
  assert.equal(overview.households, city.households.length);
  assert.equal(overview.firms, city.firms.length);
  assert.equal(overview.employed, city.employment.reduce((total, allocation) => total + allocation.workers, 0));
});

test('early overview explicitly includes the tick-zero grant and construction within its period', () => {
  const city = createCity(), overview = cityOverview(city);
  assert.deepEqual([overview.fromTick, overview.toTick], [0, 0]);
  assert.equal(overview.income, 3000000);
  assert.equal(overview.expense, 11 * 5000);
  assert.equal(overview.net, city.accounts.treasury);
  city.tick = 29; assert.equal(cityOverview(city).income, 3000000);
  city.tick = 30; assert.equal(cityOverview(city).income, 0);
});

test('deleted, unbuilt, invalid and stale parcel references cannot resolve an unrelated occupant', () => {
  const city = populated(), home = city.buildings.find(b => b.zone === 'R')!;
  const formerHousehold = city.households.find(h => h.home === home.id)!;
  assert.equal(bulldoze(city, home.cell).ok, true);
  assert.deepEqual(resolvePlace(city, home.cell), { cell: home.cell, building: null, households: [], firm: null });
  assert.equal(city.households.find(h => h.id === formerHousehold.id)?.home, null);
  assert.equal(relatedFlows(city, 'money', formerHousehold.wallet).length, flowRows(city, 'money').filter(row => row.from === formerHousehold.wallet || row.to === formerHousehold.wallet).length);
  for (const cell of [-1, city.cells.length, 1.5]) assert.deepEqual(resolvePlace(city, cell), { cell, building: null, households: [], firm: null });
  const other = city.buildings[0];
  city.cells[home.cell].building = other.id;
  assert.equal(resolvePlace(city, home.cell).building, null);
});

test('context presenters leave frozen source data and RNG unchanged and report actual utility flags', () => {
  const city = populated(); city.utilities.power = false; city.utilities.water = false;
  const before = JSON.stringify(city), rng = city.rng;
  const deepFreeze = (value: unknown): void => {
    if (value && typeof value === 'object') { for (const child of Object.values(value)) deepFreeze(child); Object.freeze(value); }
  };
  deepFreeze(city);
  resolvePlace(city, city.buildings[0].cell);
  relatedFlows(city, 'money', city.households[0].wallet);
  relatedFlows(city, 'goods', city.firms[0].wallet);
  const overview = cityOverview(city);
  assert.equal(overview.power, false); assert.equal(overview.water, false);
  assert.ok(overview.warnings.some(warning => warning.includes('ไฟฟ้า')));
  assert.ok(overview.warnings.some(warning => warning.includes('น้ำ')));
  assert.equal(city.rng, rng); assert.equal(JSON.stringify(city), before);
});

test('migrated legacy people are explicitly assumed without rewriting financial or goods history', () => {
  const legacy = JSON.parse(legacyJson), city = populated(), overview = cityOverview(city);
  assert.equal(city.version, 2);
  assert.ok(city.households.every(household => household.origin === 'legacy-v1' && household.profile === 'legacy-worker' && household.members === 1 && household.workforce === 1 && household.dependents === 0));
  assert.equal(overview.population, legacy.households.length);
  assert.equal(overview.households, legacy.households.length);
  assert.equal(overview.workforce, legacy.households.length);
  assert.equal(overview.dependents, 0);
  assert.equal(overview.legacyHouseholds, legacy.households.length);
  assert.equal(overview.legacyAssumedPersons, legacy.households.length);
  assert.deepEqual(city.accounts, legacy.accounts);
  assert.deepEqual(city.ledger, legacy.ledger);
  assert.deepEqual(city.goodsLedger, legacy.goodsLedger);
  assert.deepEqual(city.goods, legacy.goods);
  assert.deepEqual([city.tick, city.rng, city.nextId], [legacy.tick, legacy.rng, legacy.nextId]);
});

test('people, workforce and multiple employers are counted separately from household rows', () => {
  const city = populated(), original = cityOverview(city), household = city.households[0];
  const factory = city.firms.find(firm => firm.zone === 'I')!, shop = city.firms.find(firm => firm.zone === 'C')!;
  const historical = JSON.stringify({ accounts: city.accounts, ledger: city.ledger, goodsLedger: city.goodsLedger, goods: city.goods, claims: city.firms.map(firm => firm.workDays) });
  // A synthetic current view state exercises family composition without inventing
  // a historical arrival event or retroactively multiplying its old goods basket.
  Object.assign(household, { members: 3, workforce: 2, dependents: 1, profile: 'family', origin: 'arrival' });
  city.employment = city.employment.filter(allocation => allocation.householdId !== household.id);
  city.employment.push(
    { householdId: household.id, firmId: factory.id, occupation: 'manufacturing', rank: 'entry', workers: 1 },
    { householdId: household.id, firmId: shop.id, occupation: 'retail', rank: 'entry', workers: 1 },
  );
  const overview = cityOverview(city);
  assert.equal(overview.population, original.population + 2);
  assert.equal(overview.households, original.households);
  assert.equal(overview.workforce, original.workforce + 1);
  assert.equal(overview.dependents, 1);
  assert.equal(householdWorkerCount(city, household.id), 2);
  assert.equal(overview.employed, original.employed + 1);
  assert.equal(overview.unemployed, overview.workforce - overview.employed);
  assert.equal(overview.legacyHouseholds, original.legacyHouseholds - 1);
  assert.equal(overview.legacyAssumedPersons, original.legacyAssumedPersons - 1);
  assert.equal(city.tick, original.toTick);
  assert.equal(JSON.stringify({ accounts: city.accounts, ledger: city.ledger, goodsLedger: city.goodsLedger, goods: city.goods, claims: city.firms.map(firm => firm.workDays) }), historical);
});

test('same-tick household moves update both housing limits without creating transactions or people', () => {
  const city = populated(), home = city.buildings.find(building => building.zone === 'R' && housingCapacity(building).households >= 2)!;
  assert.ok(home, 'Frozen legacy fixture has a home with a second household slot');
  const household = city.households.find(value => value.home !== home.id)!;
  const before = cityOverview(city), history = JSON.stringify({ accounts: city.accounts, ledger: city.ledger, goodsLedger: city.goodsLedger, goods: city.goods, claims: city.firms.map(firm => firm.workDays) });
  assert.equal(moveHousehold(city, household.id, home.id).ok, true);
  const after = cityOverview(city), residents = resolvePlace(city, home.cell).households;
  assert.equal(residents.length, 2);
  assert.deepEqual(homeOccupancy(city, home.id), { households: 2, persons: residents.reduce((total, value) => total + value.members, 0) });
  assert.equal(after.occupiedHomeSlots, city.households.filter(value => value.home !== null).length);
  assert.equal(after.occupiedPersons, city.households.filter(value => value.home !== null).reduce((total, value) => total + value.members, 0));
  assert.equal(after.housingVacancy, after.homeSlots - after.occupiedHomeSlots);
  assert.equal(after.personVacancy, after.personCapacity - after.occupiedPersons);
  assert.equal(after.population, before.population);
  assert.equal(after.households, before.households);
  assert.equal(after.toTick, before.toTick);
  assert.equal(JSON.stringify({ accounts: city.accounts, ledger: city.ledger, goodsLedger: city.goodsLedger, goods: city.goods, claims: city.firms.map(firm => firm.workDays) }), history);
});

test('displaced families remain in population but not housing occupancy or employed-worker totals', () => {
  const city = populated(), home = city.buildings.find(building => building.zone === 'R')!, occupants = resolvePlace(city, home.cell).households;
  const before = cityOverview(city), removedCapacity = housingCapacity(home), displacedPersons = occupants.reduce((total, household) => total + household.members, 0);
  assert.equal(bulldoze(city, home.cell).ok, true);
  const overview = cityOverview(city);
  assert.equal(overview.population, before.population);
  assert.equal(overview.households, before.households);
  assert.equal(overview.homeless, before.homeless + occupants.length);
  assert.equal(overview.homelessPersons, before.homelessPersons + displacedPersons);
  assert.equal(overview.occupiedHomeSlots, before.occupiedHomeSlots - occupants.length);
  assert.equal(overview.occupiedPersons, before.occupiedPersons - displacedPersons);
  assert.equal(overview.homeSlots, before.homeSlots - removedCapacity.households);
  assert.equal(overview.personCapacity, before.personCapacity - removedCapacity.persons);
  assert.ok(occupants.every(household => household.home === null && householdWorkerCount(city, household.id) === 0));
  assert.ok(overview.warnings.some(warning => warning.includes('ไม่มีบ้านพัก')));
});
