import test from 'node:test';
import assert from 'node:assert/strict';
import { automaticFarmCrop, createCity, deserialize, farmCrop, selectFarmCrop, serialize, step, zoneCell } from '../src/sim.ts';
import { CROPS } from '../src/goods.ts';

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
  const { foodDemandStartTick: _food, ...base } = city;
  const legacy = { ...base, version: 9, rulesVersion: 'chain-4' };
  assert.deepEqual(deserialize(JSON.stringify(legacy)), city);
  const market = { version: 10 as const, rulesVersion: 'chain-5' as const, cityId: 'x', guestId: null, operations: [], escrow: [], receipts: {}, seq: '0' };
  const loaded = deserialize(JSON.stringify({ ...legacy, version: 10, rulesVersion: 'chain-5', market }));
  assert.deepEqual(loaded.market, market);
  assert.equal(loaded.tick, city.tick);
});
