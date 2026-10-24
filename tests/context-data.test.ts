import test from 'node:test';
import assert from 'node:assert/strict';
import { createCity, step, bulldoze } from '../src/sim.ts';
import { flowRows } from '../src/inspector-data.ts';
import { resolvePlace, relatedFlows, cityOverview } from '../src/context-data.ts';

const populated = () => {
  const city = createCity(61025);
  for (let day = 0; day < 180; day++) step(city);
  return city;
};

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
  assert.equal(overview.employed, city.households.filter(h => h.employer !== null).length);
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
  assert.ok(!city.households.some(h => h.id === formerHousehold.id));
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
