import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCity, deserialize, expandValidatedCity, serialize, step } from '../src/sim.ts';
import { createParkRuntime, deserializeParkSession, serializeParkSession } from '../src/park-runtime.ts';
import { validateAgriculture } from '../src/agriculture-validation.ts';
import { farmProductionFertility } from '../src/farm-production.ts';

function historicalSave(expanded: boolean) {
  let city = createCity(61025);
  delete city.farmSoilIndependentStartTick;
  for (let day = 0; day < 90; day++) step(city);
  delete city.happiness; // This fixture models a save written before wellbeing existed.
  if (expanded) city = expandValidatedCity(city);
  const envelope = JSON.parse(serialize(city));
  const {farmBaseVersion, farmSoilIndependentStartTick: _boundary, ...base} = envelope;
  return { city, raw: JSON.stringify({...base,version:farmBaseVersion,rulesVersion:expanded?'chain-21':'chain-20'}) };
}

for (const expanded of [false, true]) test(`v${expanded ? 26 : 25} journals survive soil-rule migration without changing historical state`, () => {
  const {city: old, raw} = historicalSave(expanded), originalBytes = raw;
  const city = deserialize(raw), boundary = old.tick;
  assert.equal(city.farmSoilIndependentStartTick,boundary);
  const {farmSoilIndependentStartTick: _boundary, ...unchanged} = city;
  assert.deepEqual(unchanged,old);
  assert.equal(raw,originalBytes);
  assert.ok(city.cropLedger.some(e => e.kind === 'harvest'));
  const oldEntries = structuredClone(city.cropLedger);
  for (let day = 0; day < 10; day++) step(city);
  assert.deepEqual(city.cropLedger.slice(0,oldEntries.length),oldEntries);
  assert.ok(city.cropLedger.some(e => e.kind === 'harvest' && e.tick > boundary));
  validateAgriculture(city,true,true);
  const next = serializeParkSession(city,createParkRuntime(city)), envelope = JSON.parse(next);
  assert.equal(envelope.version,28); assert.equal(envelope.rulesVersion,'chain-23');
  assert.equal(envelope.farmBaseVersion,expanded?26:25);
  const restored = deserializeParkSession(next);
  assert.equal(restored.city.farmSoilIndependentStartTick,boundary);
  assert.deepEqual(restored.city,city);
});

test('actual old park session preserves journals, resources and runtime on soil migration', () => {
  const raw = readFileSync(new URL('./fixtures/retail-v18-park-session.json',import.meta.url),'utf8');
  const old = JSON.parse(raw), loaded = deserializeParkSession(raw);
  assert.equal(loaded.city.farmSoilIndependentStartTick,old.tick);
  for (const key of ['resources','ledger','cropLedger','goodsLedger','accounts','rng','tick'] as const) assert.deepEqual(loaded.city[key],old[key]);
  assert.deepEqual(JSON.parse(JSON.stringify(loaded.runtime)),old.parkRuntime);
  assert.deepEqual(deserializeParkSession(serializeParkSession(loaded.city,loaded.runtime)),loaded);
});

test('v27 requires valid boundary and rejects downgraded or mismatched metadata', () => {
  const city = createCity(61025), raw = JSON.parse(serialize(city));
  assert.equal(raw.farmSoilIndependentStartTick,0);
  for (const boundary of [undefined,null,-1,.5,'0',1,Number.MAX_SAFE_INTEGER+1]) {
    assert.throws(() => deserialize(JSON.stringify({...raw,farmSoilIndependentStartTick:boundary})));
  }
  for (const base of [undefined,19,24,27,'25']) assert.throws(() => deserialize(JSON.stringify({...raw,farmBaseVersion:base})));
  assert.throws(() => deserialize(JSON.stringify({...raw,rulesVersion:'chain-21'})));
  assert.throws(() => deserialize(JSON.stringify({...raw,version:25,rulesVersion:'chain-20'})));
  const {farmBaseVersion: _base, ...downgraded} = raw;
  assert.throws(() => deserialize(JSON.stringify({...downgraded,version:25,rulesVersion:'chain-20'})));
  assert.throws(() => deserialize(JSON.stringify({...raw,farmBaseVersion:26})));
});

test('migration-day harvest retains soil yield and future days use uniform fertility', () => {
  const {raw} = historicalSave(false), city = deserialize(raw), boundary = city.farmSoilIndependentStartTick!;
  const cell = city.resources.fertility.findIndex(f => f < 50);
  assert.equal(farmProductionFertility(city,cell,boundary),50);
  assert.equal(farmProductionFertility(city,cell,boundary+1),100);
  assert.equal(farmProductionFertility(city,cell,boundary-1),50);
});

test('checkpoints preserve the farm boundary after both historical and uniform harvests are compacted', () => {
  const {raw} = historicalSave(true), city = deserialize(raw), boundary = city.farmSoilIndependentStartTick!;
  const before = city.crops.harvested;
  for (let day = 0; day < 100; day++) step(city);
  assert.ok(city.history && city.history.throughTick > boundary);
  assert.ok(city.crops.harvested > before);
  validateAgriculture(city,true,true);
  const restored = deserialize(serialize(city));
  assert.equal(restored.farmSoilIndependentStartTick,boundary);
  assert.deepEqual(restored,city);
  step(restored); validateAgriculture(restored,true,true);
  assert.deepEqual(deserialize(serialize(restored)),restored);
});
