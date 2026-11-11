import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceParkRecreation, createParkRecreation, restoreParkRecreation, serializeParkRecreation } from '../src/park-recreation.ts';
import { advanceParkRuntime, createParkRuntime, deserializeParkSession, serializeParkSession } from '../src/park-runtime.ts';
import { parkRecreationResidentIds } from '../src/park-recreation-activity.ts';
import { MAX_CITY_HOUSEHOLDS, deserialize, serialize, step, summary } from '../src/sim.ts';
import { assertServerCitySize } from '../src/server-save-size.ts';
import { parkPopulationFixture } from './park-population-fixture.ts';

const roster = (count: number) => Array.from({ length: count }, (_, n) => `h:${n + 1}:m:0`);
const park = { parkId: 1, qualityPermille: 1000, comfortableCapacity: Number.MAX_SAFE_INTEGER };

test('2049 and 4098 real people with a park advance instead of failing at the old roster cap', () => {
  for (const families of [683, 1366]) {
    const city = parkPopulationFixture(families), runtime = createParkRuntime(city), before = serialize(city);
    assert.equal(summary(city).population, families * 3);
    advanceParkRuntime(city, runtime, 1, () => assert.fail('not a daily boundary'));
    assert.equal(runtime.activity.minute, 1);
    assert.equal(runtime.recreation.minute, city.tick * 1440 + 1);
    assert.equal(serialize(city), before, 'recreation does not change population or financial state');
    assert.deepEqual(deserializeParkSession(serializeParkSession(city, runtime)).runtime, runtime);
  }
});

test('4098 people retain deterministic park visits, day stepping, pause and exact session reload', () => {
  const city = parkPopulationFixture(), runtime = createParkRuntime(city), economic = deserialize(serialize(city));
  // Use the actual minute runtime, not fabricated benefit history.
  advanceParkRuntime(city, runtime, 1200.25, () => step(city));
  assert.ok(runtime.activity.completed > 0, 'real people completed real park visits');
  assert.ok(Object.keys(runtime.recreation.citizens).length > 0, 'staffed park visits earned actual benefit');
  const saved = serializeParkSession(city, runtime), resumed = deserializeParkSession(saved);
  const pause = serializeParkSession(resumed.city, resumed.runtime);
  advanceParkRuntime(resumed.city, resumed.runtime, 0, () => assert.fail('pause'));
  assert.equal(serializeParkSession(resumed.city, resumed.runtime), pause);
  advanceParkRuntime(city, runtime, 240, () => step(city));
  for (let n = 0; n < 4; n++) advanceParkRuntime(resumed.city, resumed.runtime, 60, () => step(resumed.city));
  step(economic);
  assert.equal(serialize(city), serialize(economic), 'one day is the unchanged economic step');
  assert.equal(serializeParkSession(resumed.city, resumed.runtime), serializeParkSession(city, runtime));
  assert.equal(summary(city).population, 4098);
  assertServerCitySize(serializeParkSession(city, runtime));
});

test('all structurally supported resident slots can retain scores without a new record cap', () => {
  const residentIds = roster(MAX_CITY_HOUSEHOLDS * 3);
  const visits = residentIds.map(citizenId => ({ citizenId, parkId: 1, eligible: true }));
  const state = advanceParkRecreation(createParkRecreation(), { minute: 1, residentIds, parks: [park], visits });
  assert.equal(Object.keys(state.citizens).length, residentIds.length);
  assert.equal(state.citizens[residentIds.at(-1)!].scoreUnits, 250);
  assert.deepEqual(restoreParkRecreation(JSON.parse(serializeParkRecreation(state)), 1), state);
  const next = advanceParkRecreation(state, { minute: 2, residentIds, parks: [park], visits: [] });
  assert.equal(Object.keys(next.citizens).length, residentIds.length);
  assert.equal(next.citizens[residentIds.at(-1)!].scoreUnits, 247);
});

test('large duplicate observations are still deduplicated and bad tail data rejects atomically', () => {
  const residentIds = roster(4098), visits = residentIds.map(citizenId => ({ citizenId, parkId: 1, eligible: true }));
  const frame = { minute: 1, residentIds, parks: [park], visits: [...visits, ...visits, ...visits] };
  const state = advanceParkRecreation(createParkRecreation(), frame), before = serializeParkRecreation(state);
  assert.equal(Object.keys(state.citizens).length, residentIds.length);
  assert.equal(state.citizens[residentIds.at(-1)!].earnedMinutes, 1);
  for (const bad of [
    { ...frame, minute: 2, residentIds: [...residentIds, residentIds[0]] },
    { ...frame, minute: 2, visits: [...visits, { citizenId: 'ghost', parkId: 1, eligible: true }] },
    { ...frame, minute: 2, visits: [...visits, { ...visits.at(-1)!, eligible: false }] },
  ]) {
    assert.throws(() => advanceParkRecreation(state, bad));
    assert.equal(serializeParkRecreation(state), before);
  }
  const corrupt = JSON.parse(before); corrupt.citizens[residentIds.at(-1)!].scoreUnits = -1;
  assert.throws(() => restoreParkRecreation(corrupt));
  assert.deepEqual(restoreParkRecreation(before, 1), state);
});

test('9000-person canonical session retains every sparse score beyond standalone sidecar size', () => {
  const city = parkPopulationFixture(3000), runtime = createParkRuntime(city);
  const residentIds = parkRecreationResidentIds(city), minute = runtime.recreation.minute + 1;
  // Scoring-unit capacity case: all identities are real, but this is not an activity arrival claim.
  runtime.recreation = advanceParkRecreation(runtime.recreation, {
    minute, residentIds, parks: [{ ...park, parkId: city.parks[0].id }],
    visits: residentIds.map(citizenId => ({ citizenId, parkId: city.parks[0].id, eligible: true })),
  });
  runtime.activity.minute = 1;
  assert.ok(serializeParkRecreation(runtime.recreation).length > 2_000_000);
  const raw = serializeParkSession(city, runtime); assertServerCitySize(raw);
  const restored = deserializeParkSession(raw);
  assert.equal(summary(restored.city).population, 9000);
  assert.equal(Object.keys(restored.runtime.recreation.citizens).length, 9000);
  assert.equal(serializeParkSession(restored.city, restored.runtime), raw);
  advanceParkRuntime(restored.city, restored.runtime, 1, () => assert.fail('not a day boundary'));
  assert.equal(restored.runtime.recreation.minute, minute + 1);
  assert.equal(Object.keys(restored.runtime.recreation.citizens).length, 9000);
});

test('park metadata does not inherit an unrelated resident count ceiling', () => {
  const parks = Array.from({ length: 2049 }, (_, n) => ({ ...park, parkId: n + 1 }));
  const state = advanceParkRecreation(createParkRecreation(), { minute: 1, residentIds: ['last'], parks, visits: [{ citizenId: 'last', parkId: 2049, eligible: true }] });
  assert.equal(state.citizens.last.scoreUnits, 250);
  assert.throws(() => advanceParkRecreation(state, { minute: 2, residentIds: ['last'], parks: [...parks, { ...park, qualityPermille: 1001 }], visits: [] }));
});
