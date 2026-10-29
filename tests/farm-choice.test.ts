import test from 'node:test';
import assert from 'node:assert/strict';
import { access, automaticFarmCrop, createCity, deserialize, farmCrop, firmWorkerCount, isMarket, selectFarmCrop, serialize, step, summary, zoneCell } from '../src/sim.ts';
import { CROPS } from '../src/goods.ts';

test('farm demand retains published accounting before any farm reaches a new tier', () => {
  const city = createCity(61025); let checked = 0;
  for (let day = 0; day < 120; day++) {
    const farms = city.firms.filter(f => f.zone === 'F');
    if (farms.some(f => city.buildings.find(b => b.id === f.building)!.level > 3)) break;
    const buyers = city.firms.some(f => f.zone === 'I' || isMarket(f)) ||
      city.households.some(h => h.home !== null && access(city, city.buildings.find(b => b.id === h.home)!.cell)) && city.cells.some((cell, i) => cell.zone === 'C' && access(city, i));
    const needed = city.households.reduce((n, h) => n + h.members, 0) + city.firms.filter(f => f.zone === 'I').reduce((n, f) => n + firmWorkerCount(city, f.id) * 2, 0);
    const oldCapacity = farms.reduce((n, f) => { const b = city.buildings.find(b => b.id === f.building)!; return n + Math.floor(24 * Math.max(50, city.resources.fertility[b.cell]) / 100); }, 0);
    assert.equal(summary(city).demand.F, buyers && (!farms.length || needed > oldCapacity) ? 1 : 0);
    checked++; step(city);
  }
  assert.ok(checked >= 30, 'compared old-tier behavior across multiple simulated days');
});

test('automatic choice balances farm types and manual override can return to auto', () => {
  const city = createCity(61025);
  for (let i = 0; i < 60; i++) step(city);
  const farm = city.firms.find(f => f.zone === 'F')!;
  assert.ok(farm);
  assert.equal(farm.cropMode, 'auto');
  const stock = structuredClone(farm.crops);
  const crop = farmCrop(city, farm);
  const remaining = CROPS.filter(value => value !== crop);
  assert.equal(automaticFarmCrop(city), remaining[0], 'new farms prefer an underrepresented crop');
  assert.equal(selectFarmCrop(city, farm.id, crop).ok, true);
  assert.equal(farm.cropMode, 'manual', 'selecting the current crop still opts out of automation');
  const proposed = automaticFarmCrop(city, farm.id);
  assert.equal(selectFarmCrop(city, farm.id, 'auto').ok, true);
  assert.equal(farm.cropMode, 'auto');
  assert.equal(farmCrop(city, farm), proposed);
  assert.deepEqual(farm.crops, stock);
  assert.deepEqual(deserialize(serialize(city)), city);
  const malformed = JSON.parse(serialize(city));
  malformed.firms.find((f: { id: number }) => f.id === farm.id).cropMode = 'unknown';
  assert.throws(() => deserialize(JSON.stringify(malformed)), /corrupt/);
});

test('choose a farm crop while preserving stock and history across save and future ticks', () => {
  const city = createCity(61025);
  for (let i = 0; i < 60; i++) step(city);
  const farm = city.firms.find(f => f.zone === 'F' && f.cropInventory > 0)!;
  assert.ok(farm);
  const oldCrop = farmCrop(city, farm);
  const selected = CROPS.find(crop => crop !== oldCrop)!;
  const before = structuredClone(farm.crops);
  assert.equal(selectFarmCrop(city, farm.id, selected).ok, true);
  assert.deepEqual(farm.crops, before);
  assert.equal(farmCrop(city, farm), selected);
  assert.equal(selectFarmCrop(city, farm.id, selected).ok, true);
  assert.deepEqual(farm.crops, before);
  const loaded = deserialize(serialize(city));
  assert.equal(farmCrop(loaded, loaded.firms.find(f => f.id === farm.id)!), selected);
  for (let i = 0; i < 30; i++) step(loaded);
  assert.ok(loaded.cropLedger.some(e => e.kind === 'harvest' && e.to === farm.wallet && e.crop === selected));
  assert.deepEqual(deserialize(serialize(loaded)), loaded);
});

test('farm zone accepts low fertility and invalid selection changes nothing', () => {
  const city = createCity(61025, { starter: false });
  const cell = city.cells.findIndex((c, i) => !c.road && city.resources.fertility[i] < 50);
  assert.ok(cell >= 0);
  assert.equal(zoneCell(city, cell, 'F').ok, true);
  const before = serialize(city);
  assert.equal(selectFarmCrop(city, -1, 'rice').ok, false);
  assert.equal(serialize(city), before);
});

test('legacy v9 and v10 retain their market identity and load without advancing time', () => {
  const city = createCity(61025, { starter: false });
  const { foodDemandStartTick: _food, factoryProgressionStartTick: _factory, farmLevelStartTick: _farmLevelStart, ...base } = city;
  const legacy = { ...base, version: 9, rulesVersion: 'chain-4' };
  assert.deepEqual(deserialize(JSON.stringify(legacy)), city);
  const market = { version: 10 as const, rulesVersion: 'chain-5' as const, cityId: 'x', guestId: null, operations: [], escrow: [], receipts: {}, seq: '0' };
  const loaded = deserialize(JSON.stringify({ ...legacy, version: 10, rulesVersion: 'chain-5', market }));
  assert.deepEqual(loaded.market, market);
  assert.equal(loaded.tick, city.tick);
});
