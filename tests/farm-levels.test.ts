import test from 'node:test';
import assert from 'node:assert/strict';
import { createCity, deserialize, serialize, step, farmCrop, selectFarmCrop, firmCapacity, firmWorkerCount, bulldoze } from '../src/sim.ts';
import { farmStockCapacity, harvestYield, proposeHarvest } from '../src/agriculture.ts';
import { buildingNeed } from '../src/utilities.ts';
import { createParkRuntime, deserializeParkSession, serializeParkSession } from '../src/park-runtime.ts';
import { FARM_LEVEL_BACKUP_KEY, SAVE_KEY, readStoredCity, saveStoredCity } from '../src/save-storage.ts';
import { validateAgriculture } from '../src/agriculture-validation.ts';
import { holdEducationReady } from './education-ready.ts';

test('farm levels preserve old capacities and add worker, water and storage slots', () => {
  assert.deepEqual([1,2,3,4,5,6].map(farmStockCapacity), [96,96,96,120,144,168]);
  for (let level = 1; level <= 6; level++) {
    assert.equal(firmCapacity({ id: 1, cell: 0, zone: 'F', level, age: 0 }), level);
    assert.deepEqual(buildingNeed('F', level), { power: 0, water: level });
  }
  for (let workers = 0; workers <= 6; workers++) {
    const p = proposeHarvest({ cropInventory: 0, cropCost: 0, productionTick: 0 }, { tick: 1, workers, fertility: 100, operational: true, capacity: 168 });
    assert.equal(p.quantity, workers * 24);
    assert.equal(proposeHarvest(p.next, { tick: 1, workers, fertility: 100, operational: true, capacity: 168 }).ok, false);
  }
  assert.equal(proposeHarvest({ cropInventory: 167, cropCost: 0, productionTick: 0 }, { tick: 1, workers: 6, fertility: 100, operational: true, capacity: 168 }).quantity, 1);
  assert.equal(proposeHarvest({ cropInventory: 168, cropCost: 0, productionTick: 0 }, { tick: 1, workers: 6, fertility: 100, operational: true, capacity: 168 }).reason, 'stock-cap');
  assert.equal(harvestYield(50, 6), 72);
});

test('upgraded farm keeps identity, selection and historical journal through park-session saves', () => {
  const c = createCity(61025);
  for (let i = 0; i < 119; i++) step(c);
  const f = c.firms.find(f => f.zone === 'F')!, b = c.buildings.find(b => b.id === f.building)!;
  assert.equal(b.level, 3);
  assert.equal(selectFarmCrop(c, f.id, 'sugarcane').ok, true);
  holdEducationReady(c);
  const identity = { id: f.id, building: f.building, wallet: f.wallet, owner: structuredClone(f.owner), cell: b.cell };
  step(c); assert.equal(b.level, 4);
  assert.deepEqual({ id: f.id, building: f.building, wallet: f.wallet, owner: f.owner, cell: b.cell }, identity);
  assert.equal(farmCrop(c, f), 'sugarcane');
  const migrated = JSON.parse(serialize(c)); delete migrated.education; migrated.version = 15; migrated.rulesVersion = 'chain-10';
  delete migrated.farmLevelStartTick; delete migrated.factoryProgressionStartTick;
  assert.throws(() => deserialize(JSON.stringify(migrated)), /corrupt/);
  const old = createCity(61025); for (let i = 0; i < 60; i++) step(old);
  const oldEnvelope = JSON.parse(serialize(old)); delete oldEnvelope.education; oldEnvelope.version = 15; oldEnvelope.rulesVersion = 'chain-10';
  delete oldEnvelope.farmLevelStartTick; delete oldEnvelope.factoryProgressionStartTick;
  const comparable = { ...old, factoryProgressionStartTick: old.tick, farmLevelStartTick: old.tick }; delete comparable.education;
  assert.deepEqual(deserialize(JSON.stringify(oldEnvelope)), comparable);
  const runtime = createParkRuntime(c), session = deserializeParkSession(serializeParkSession(c, runtime));
  assert.deepEqual(session.city, c); assert.deepEqual(session.runtime, runtime);
  assert.equal(selectFarmCrop(c, f.id, 'auto').ok, true);
  assert.equal(f.cropMode, 'auto'); assert.deepEqual(deserialize(serialize(c)), c);
});

test('farm expansion requires water and sufficient retained working cash', () => {
  const initial = createCity(61025); for (let i = 0; i < 119; i++) step(initial);
  const dry = structuredClone(initial), dryFarm = dry.firms.find(f => f.zone === 'F')!, dryBuilding = dry.buildings.find(b => b.id === dryFarm.building)!;
  dry.utilities.outside.water = 0;
  step(dry); assert.equal(dryBuilding.level, 3);
  const poor = structuredClone(initial), poorFarm = poor.firms.find(f => f.zone === 'F')!, poorBuilding = poor.buildings.find(b => b.id === poorFarm.building)!;
  // Preserve payroll and operating cash; after settlement this profitable, staffed farm
  // can pay construction but cannot also retain the required working reserve.
  poor.accounts[poorFarm.wallet] = Object.values(poorFarm.workDays).reduce((n, days) => n + days * 1400, 0) + 60_000;
  step(poor); assert.equal(poorBuilding.level, 3);
  assert.ok(firmWorkerCount(poor, poorFarm.id) > 0 && poorFarm.lastMonthProfit > 42_000);
  assert.ok(poor.accounts[poorFarm.wallet] >= 20_000 && poor.accounts[poorFarm.wallet] < 40_000);
});

test('profitable farms autonomously reach level six when water is available', () => {
  const c = createCity(61025); c.utilities.outside.water = 100;
  for (let i = 0; i < 119; i++) step(c);
  const f = c.firms.find(f => f.zone === 'F')!, b = c.buildings.find(b => b.id === f.building)!;
  assert.equal(selectFarmCrop(c, f.id, 'vegetables').ok, true);
  const id = f.id, wallet = f.wallet, cell = b.cell;
  for (let level = 4; level <= 6; level++) {
    for (let i = 0; i < (level === 4 ? 1 : 30); i++) { holdEducationReady(c); step(c); }
    assert.equal(b.level, level); assert.equal(f.id, id); assert.equal(f.wallet, wallet); assert.equal(b.cell, cell);
    assert.equal(farmCrop(c, f), 'vegetables');
    assert.deepEqual(deserialize(serialize(c)), c);
  }
  const investments = c.ledger.filter(e => e.from === wallet && e.reason === 'Profitable firm height investment');
  assert.equal(investments.length, 5); assert.ok(investments.every(e => e.amount === 20_000));
});

test('six actual allocations harvest once and replay survives later demolition', () => {
  const c = createCity(61025); for (let i = 0; i < 120; i++) step(c);
  const f = c.firms.find(f => f.zone === 'F')!, b = c.buildings.find(b => b.id === f.building)!;
  b.level = 6;
  const needed = 6 - firmWorkerCount(c, f.id);
  const candidates = c.employment.filter(e => e.firmId !== f.id && e.occupation === 'manufacturing').slice(0, needed);
  assert.equal(candidates.length, needed);
  for (const allocation of candidates) allocation.firmId = f.id;
  step(c);
  const events = c.cropLedger.filter(e => e.tick === c.tick && e.kind === 'harvest' && e.to === f.wallet);
  assert.equal(events.length, 1); assert.equal(events[0].workers, 6);
  assert.deepEqual(deserialize(serialize(c)), c);
  const total = c.crops.harvested - c.crops.processed - c.crops.consumed - c.crops.writtenOff - (c.crops.exported ?? 0);
  assert.equal(total, c.firms.reduce((n, firm) => n + firm.cropInventory, 0));
  assert.equal(Object.values(c.accounts).reduce((a, n) => a + n, 0), 0);
  assert.equal(bulldoze(c, b.cell).ok, true);
  assert.deepEqual(deserialize(serialize(c)), c);
});

test('replay rejects a six-worker harvest truncated to the three-worker store', () => {
  const c = createCity(61025); for (let i = 0; i < 120; i++) step(c);
  const f = c.firms.find(f => f.zone === 'F')!, b = c.buildings.find(b => b.id === f.building)!;
  b.level = 6;
  const needed = 6 - firmWorkerCount(c, f.id);
  for (const a of c.employment.filter(e => e.firmId !== f.id && e.occupation === 'manufacturing').slice(0, needed)) a.firmId = f.id;
  step(c);
  const bad = structuredClone(c), harvest = bad.cropLedger.find(e => e.tick === bad.tick && e.kind === 'harvest' && e.to === f.wallet)!;
  const exported = bad.cropLedger.find(e => e.tick === bad.tick && e.kind === 'export' && e.from === f.wallet)!;
  assert.equal(harvest.quantity, 120); assert.equal(exported.quantity, 120);
  // Rebalance the journal, money and totals so only the level/worker combination is impossible.
  harvest.quantity = 48; exported.quantity = 48; exported.cash = exported.toValue = 48 * 120;
  const payment = bad.ledger.find(e => e.reason === exported.reason)!; payment.amount = exported.cash;
  const difference = 72 * 120;
  bad.accounts[f.wallet] -= difference; bad.accounts.outside += difference;
  bad.firms.find(item => item.id === f.id)!.monthlyRevenue -= difference;
  bad.crops.harvested -= 72; bad.crops.exported! -= 72;
  assert.equal(Object.values(bad.accounts).reduce((a, value) => a + value, 0), 0);
  assert.equal(bad.crops.harvested - bad.crops.processed - bad.crops.consumed - bad.crops.writtenOff - (bad.crops.exported ?? 0), bad.firms.reduce((n, firm) => n + firm.cropInventory, 0));
  assert.throws(() => validateAgriculture(bad));
  harvest.workers = 3; assert.doesNotThrow(() => validateAgriculture(bad));
  const earlier = structuredClone(c); earlier.farmLevelStartTick = earlier.tick;
  assert.throws(() => deserialize(serialize(earlier)), /corrupt/);
  assert.deepEqual(deserialize(serialize(c)), c);
});

test('v15 migration fixes the boundary and admits valid pre- and post-upgrade harvests', () => {
  const original = createCity(61025); for (let i = 0; i < 119; i++) step(original);
  const old = JSON.parse(serialize(original)); delete old.education; old.version = 15; old.rulesVersion = 'chain-10'; delete old.farmLevelStartTick; delete old.factoryProgressionStartTick;
  const c = deserialize(JSON.stringify(old)); assert.equal(c.farmLevelStartTick, 119);
  assert.deepEqual(c.cropLedger, original.cropLedger);
  step(c);
  const f = c.firms.find(f => f.zone === 'F')!, b = c.buildings.find(b => b.id === f.building)!;
  assert.equal(b.level, 4); b.level = 6;
  const needed = 6 - firmWorkerCount(c, f.id);
  for (const a of c.employment.filter(e => e.firmId !== f.id && e.occupation === 'manufacturing').slice(0, needed)) a.firmId = f.id;
  step(c);
  assert.ok(c.cropLedger.some(e => e.kind === 'harvest' && e.tick === c.tick && e.workers === 6));
  assert.deepEqual(deserialize(serialize(c)), c);
  const bad = JSON.parse(serialize(c)); delete bad.farmLevelStartTick;
  assert.throws(() => deserialize(JSON.stringify(bad)), /farm progression boundary/);
  bad.farmLevelStartTick = c.tick + 1;
  assert.throws(() => deserialize(JSON.stringify(bad)), /farm progression boundary/);
});

test('v15 bytes are backed up before the first new save and survive a backup failure', () => {
  const c = createCity(61025), old = JSON.parse(serialize(c)); old.version = 15; old.rulesVersion = 'chain-10';
  delete old.farmLevelStartTick; delete old.factoryProgressionStartTick;
  const raw = JSON.stringify(old), fresh = serialize(c), values = new Map([[SAVE_KEY, raw]]);
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  saveStoredCity(storage, fresh, null);
  assert.equal(values.get(FARM_LEVEL_BACKUP_KEY), raw); assert.equal(readStoredCity(storage, 'backup')?.raw, raw);
  const failed = new Map([[SAVE_KEY, raw]]);
  assert.throws(() => saveStoredCity({ getItem: key => failed.get(key) ?? null, setItem: () => { throw new Error('quota'); } }, fresh, null));
  assert.equal(failed.get(SAVE_KEY), raw);
});
