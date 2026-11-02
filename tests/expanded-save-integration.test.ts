import test from 'node:test';
import assert from 'node:assert/strict';
import { buildParallelRoad, buildRoad, createCity, deserialize, expandValidatedCity, serialize, zoneCell } from '../src/sim.ts';
import { createParkRuntime, deserializeParkSession, serializeParkSession } from '../src/park-runtime.ts';
import { expandedCellAt } from '../src/expanded-map-grid.ts';

test('validated populated legacy save expands without altering legacy state, then expanded construction roundtrips', () => {
  const legacy = createCity(456); const raw = serialize(legacy); const loaded = deserialize(raw);
  const before = structuredClone(loaded); const expanded = expandValidatedCity(loaded);
  assert.deepEqual(loaded,before); assert.deepEqual(expanded.cells.slice(0,576),before.cells);
  assert.deepEqual(expanded.resources.fertility.slice(0,576),before.resources.fertility);
  for (const key of ['seed','rng','tick','nextId','buildings','households','firms','accounts','ledger','goods','goodsLedger','cropLedger','market'] as const) assert.deepEqual(expanded[key], before[key], key);
  const north = expandedCellAt(5,-1)!, parcel = expandedCellAt(6,-1)!;
  assert.equal(buildRoad(expanded,5,north).ok,true);
  assert.equal(zoneCell(expanded,parcel,'R').ok,true);
  const saved = serializeParkSession(expanded,createParkRuntime(expanded));
  assert.equal(JSON.parse(saved).version,26);
  const restored = deserializeParkSession(saved).city;
  assert.deepEqual(restored.cells,expanded.cells); assert.deepEqual(restored.resources,expanded.resources);
  assert.deepEqual(restored.accounts,expanded.accounts); assert.deepEqual(restored.buildings,expanded.buildings);
});

test('expanded topology roundtrips and malformed layout or old-version enlarged grid is rejected', () => {
  const city=expandValidatedCity(deserialize(serialize(createCity(55))));
  assert.equal(buildParallelRoad(city,5,expandedCellAt(5,-2)!,true).ok,true);
  const raw=serialize(city); const restored=deserialize(raw);
  assert.deepEqual(restored.roadTopology,city.roadTopology);
  const obj=JSON.parse(raw);
  for (const bad of [ {...obj,mapLayout:'unknown'}, {...obj,version:25,rulesVersion:'chain-20',mapLayout:undefined,mapBaseVersion:undefined}, {...obj,resources:{...obj.resources,fertility:obj.resources.fertility.slice(0,576)}} ]) assert.throws(()=>deserialize(JSON.stringify(bad)));
});

test('populated legacy bus, market and park fixture survives migration and expanded roundtrip', async () => {
 const {readFileSync}=await import('node:fs');
 const {expandValidatedParkSession}=await import('../src/park-runtime.ts');
 const raw=readFileSync(new URL('./fixtures/save-smoke/bus-optional-day60.json',import.meta.url),'utf8');
 const loaded=deserializeParkSession(raw),before=structuredClone({bus:loaded.city.bus,market:loaded.city.market,buildings:loaded.city.buildings,accounts:loaded.city.accounts,activity:loaded.runtime.activity});
 const expanded=expandValidatedParkSession(loaded),saved=serializeParkSession(expanded.city,expanded.runtime),restored=deserializeParkSession(saved);
 assert.deepEqual({bus:restored.city.bus,market:restored.city.market,buildings:restored.city.buildings,accounts:restored.city.accounts,activity:restored.runtime.activity},before);
 assert.deepEqual(restored.city.cells.slice(0,576),loaded.city.cells);assert.equal(JSON.parse(saved).version,26);
});
