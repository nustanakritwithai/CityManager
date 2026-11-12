import test from 'node:test';
import assert from 'node:assert/strict';
import { bulldoze, contributeOwnerCapital, deserialize, serialize } from '../src/sim.ts';
import { deserializeParkSession, expandValidatedParkSession } from '../src/park-runtime.ts';
import { captureEntityExplanation } from '../src/entity-explanation-data.ts';
import { browserSnapshotState } from './browser-snapshot.ts';
import { captureCitySignals } from '../src/signal-data.ts';
import { entityExplanationCity, entityInsufficientFixture, entitySignalMetrics } from './entity-explanation-fixture.ts';
import { createPanelServerFixture } from './panel-server-entry-fixture.mjs';

test('entity fixture has real selected entities, supported actions, exact server ACK and load state', async () => {
  const { city, raw } = entityExplanationCity();
  const source = deserialize(raw);
  assert.equal(source.cells.length, 576);
  assert.deepEqual(city.cells.slice(0, 576), source.cells);
  assert.deepEqual(city.resources.fertility.slice(0, 576), source.resources.fertility);
  assert.equal(source.resources.version, 'fertility-1'); assert.equal(city.resources.version, 'fertility-2');
  assert.equal(city.resources.seed, source.resources.seed);
  const { cells: _oldCells, resources: _oldResources, ...oldState } = source;
  const { cells: _newCells, resources: _newResources, ...newState } = city;
  assert.deepEqual(newState, oldState);
  assert.equal(city.tick, 29); assert.equal(city.cells.length, 672);
  const factory = city.buildings.find(b => b.zone === 'I');
  const owner = city.firms.find(f => f.owner);
  const household = city.households.find(h => h.id === owner?.owner?.householdId);
  assert(factory && owner && household);
  assert(captureEntityExplanation(city, { kind: 'building', buildingId: factory.id }));
  assert(captureEntityExplanation(city, { kind: 'household', householdId: household.id, sourceBuildingId: household.home!, sourceCell: city.buildings.find(b => b.id === household.home)!.cell }));
  const contribution = deserialize(raw); assert.equal(contributeOwnerCapital(contribution, owner.id, 10_000).ok, true);
  const demolition = deserialize(raw); assert.equal(bulldoze(demolition, factory.cell).ok, true);
  const server = createPanelServerFixture('http://127.0.0.1:4189/CityManager/');
  const ack = await server.seed(raw); assert.equal(ack.raw, raw);
  const loaded = expandValidatedParkSession(deserializeParkSession(ack.raw)).city;
  assert.deepEqual(loaded, city); assert.deepEqual(browserSnapshotState(serialize(loaded)), city);
  assert.equal(server.active.raw, raw);
});

test('early entity uses real missing evidence and round-trips through validated server loading', () => {
  const { raw, city, building, snapshot } = entityInsufficientFixture();
  assert(snapshot.missing.length > 0);
  const loaded = expandValidatedParkSession(deserializeParkSession(raw)).city;
  assert.deepEqual(loaded, city);
  assert.deepEqual(captureEntityExplanation(loaded, { kind: 'building', buildingId: building.id }), snapshot);
});

test('entity browser retains ten exact city signal facts including initialized happiness',()=>{
  const {city}=entityExplanationCity(),raw=serialize(city),expected=entitySignalMetrics(city),capture=captureCitySignals(city);
  assert.deepEqual(Object.keys(expected).sort(),['averageHappiness','businesses','employed','expensesPerTick','households','housingCapacity','incomePerTick','population','treasury','unemployed']);
  assert.equal(capture.metrics.length,10);
  assert.deepEqual(Object.fromEntries(capture.metrics.map(m=>[m.id,m.value])),expected);
  assert.equal(serialize(city),raw);
  assert.throws(()=>entitySignalMetrics({...city,happiness:undefined}),/initialized happiness/);
});
