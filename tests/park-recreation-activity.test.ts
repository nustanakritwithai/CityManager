import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPark, createCity, serialize, step, type City } from '../src/sim.ts';
import { observeParkRecreationMinute, parkRecreationMinute, parkRecreationResidentIds, type RecreationActivityObservation } from '../src/park-recreation-activity.ts';

function fixture() {
  const city = createCity(61025);
  for (let i = 0; i < 180; i++) step(city);
  const cell = city.cells.findIndex((c, i) => !c.road && !c.zone && c.building === null && !city.plants.some(p => p.cell === i));
  assert.equal(buildPark(city, cell).ok, true);
  const h = city.households.find(h => h.home !== null)!;
  const home = city.buildings.find(b => b.id === h.home)!;
  const observation: RecreationActivityObservation = { day: city.tick, minute: 1100, visitors: [{
    citizenId: `h:${h.id}:m:0`, householdId: h.id, memberSlot: 0, homeId: home.id,
    homeCell: home.cell, parkId: city.parks[0].id, parkCell: cell, phase: 'sit'
  }] };
  return { city, observation, h };
}

test('adapter samples actual in-park leisure phases, excludes transit and counts entry only as occupancy', () => {
  const { city, observation } = fixture(), before = serialize(city);
  for (const phase of ['travel', 'enter', 'stroll', 'wait', 'meet', 'sit', 'leave'] as const) {
    const frame = observeParkRecreationMinute(city, { ...observation, visitors: [{ ...observation.visitors[0], phase }] });
    assert.equal(frame.minute, city.tick * 1440 + 1101);
    assert.equal(frame.visits.length, ['travel', 'leave'].includes(phase) ? 0 : 1);
    if (frame.visits.length) assert.equal(frame.visits[0].eligible, phase !== 'enter');
  }
  assert.equal(serialize(city), before);
});

test('adapter uses real resident slots and has no effect from a park without visitors', () => {
  const { city, observation } = fixture();
  assert.equal(parkRecreationResidentIds(city).length, city.households.reduce((n, h) => n + h.members, 0));
  assert.deepEqual(observeParkRecreationMinute(city, { ...observation, visitors: [] }).visits, []);
  const noParks: City = { ...city, parks: [] };
  const frame = observeParkRecreationMinute(noParks, { ...observation, visitors: [] });
  assert.deepEqual(frame.parks, []); assert.deepEqual(frame.visits, []);
});

test('adapter reserves actual owner and employed member time and accepts additional municipal reservations', () => {
  const { city, observation, h } = fixture();
  // Bounded contract fixtures: assign slot zero in its actual skill pool.
  const skill = (['general', 'manufacturing', 'retail'] as const).find(k => h.workerSkills[k] > 0)!;
  city.employment = [{ householdId: h.id, firmId: 999, skill, occupation: 'retail', rank: 'entry', workers: 1 }];
  city.ownerLabor = [];
  assert.equal(observeParkRecreationMinute(city, { ...observation, minute: 600 }).visits[0].eligible, false);
  assert.equal(observeParkRecreationMinute(city, { ...observation, minute: 1020 }).visits[0].eligible, true);
  const unavailableCitizenIds = new Set([observation.visitors[0].citizenId]);
  assert.equal(observeParkRecreationMinute(city, observation, { unavailableCitizenIds }).visits[0].eligible, false);
  if (skill !== 'manufacturing') {
    city.employment = []; city.ownerLabor = [{ householdId: h.id, firmId: 999, skill, workers: 1 }];
    assert.equal(observeParkRecreationMinute(city, { ...observation, minute: 600 }).visits[0].eligible, false);
  }
});

test('adapter rejects fake citizen IDs, removed parks/homes, invalid phases and misaligned clocks', () => {
  const { city, observation } = fixture(), v = observation.visitors[0];
  for (const change of [{ citizenId: 'h:999999:m:0' }, { memberSlot: 999 }, { parkId: 999999 }, { parkCell: v.parkCell + 1 }, { homeId: 999999 }, { phase: 'idle' }]) {
    assert.throws(() => observeParkRecreationMinute(city, { ...observation, visitors: [{ ...v, ...change } as typeof v] }));
  }
  assert.throws(() => observeParkRecreationMinute(city, { ...observation, day: city.tick + 1 }));
  assert.throws(() => observeParkRecreationMinute(city, { ...observation, minute: 1440 }));
  for (const [day, minute] of [[-1, 0], [0, -1], [0, 0.5], [0, 1441], [Number.MAX_SAFE_INTEGER, 0]]) {
    assert.throws(() => parkRecreationMinute(day, minute));
  }
  assert.equal(parkRecreationMinute(1, 1440), parkRecreationMinute(2, 0));
});

test('park policy is explicit, configurable and independent of the one-tile footprint', () => {
  const { city, observation } = fixture();
  const parkPolicy = new Map([[city.parks[0].id, { qualityPermille: 700, comfortableCapacity: 2 }]]);
  assert.deepEqual(observeParkRecreationMinute(city, observation, { parkPolicy }).parks,
    [{ parkId: city.parks[0].id, qualityPermille: 700, comfortableCapacity: 2 }]);
  assert.equal(city.parks[0].level, 1);
});
