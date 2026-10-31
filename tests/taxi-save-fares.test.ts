import test from 'node:test';
import assert from 'node:assert/strict';
import { collectTaxiFares, createCity, deserialize, serialize, taxiTripFare, TAXI_TRIP_FARE } from '../src/sim.ts';
import { createTaxiSession } from '../src/taxi/session.ts';
import { taxiSiteReason } from '../src/taxi/placement.ts';
import { captureTrafficGameInput, TrafficGame, type TrafficGameSample } from '../src/traffic/game.ts';

test('taxi depots survive snapshot -> load and respawn in the traffic game', () => {
  const city = createCity(61025), session = createTaxiSession();
  session.bind(city);
  const site = city.cells.findIndex((_, i) => taxiSiteReason(city, i, true) === null);
  assert.ok(site >= 0);
  assert.equal(session.place(city, site, true, true).ok, true);
  const id = session.depots()[0].id;
  assert.equal(session.upgrade(id).ok, true);
  const loaded = deserialize(serialize(city));
  assert.deepEqual(loaded.taxi, city.taxi);
  const restored = createTaxiSession(); restored.bind(loaded);
  assert.deepEqual(restored.depots(), [{ id, cell: site, level: 2, open: true }]);
  assert.deepEqual(captureTrafficGameInput(loaded, { taxiEnabled: true }).taxis, [{ id, cell: site, level: 2, open: true }]);
});

test('old saves without a taxi section load with no depots', () => {
  const raw = serialize(createCity(61025));
  assert.equal(raw.includes('"taxi"'), false);
  const loaded = deserialize(raw), session = createTaxiSession(); session.bind(loaded);
  assert.equal(loaded.taxi, undefined);
  assert.deepEqual(session.depots(), []);
});

test('a completed taxi trip credits its fare to the treasury ledger', () => {
  const roads = new Set([25, 26, 27, 28]);
  const sample: TrafficGameSample = { map: { cells: Array.from({ length: 576 }, (_, i) => ({ road: roads.has(i) })) }, demand: [{ from: 25, to: 28, rate: 1, taxiRate: 1 } as TrafficGameSample['demand'][number]] };
  const game = new TrafficGame(sample);
  let f = game.frame;
  for (let i = 0; i < 20 && !f.taxiTrips; i++) { game.step(); f = game.frame; }
  assert.ok(f.taxiTrips && f.taxiTrips.trips >= 1, JSON.stringify(f.taxiTrips));
  const { trips, tiles } = f.taxiTrips!;
  assert.equal(tiles, trips * 3);
  const city = createCity(61025), before = city.accounts.treasury;
  const fare = collectTaxiFares(city, trips, tiles);
  assert.equal(fare, taxiTripFare(trips, tiles));
  assert.equal(fare, trips * TAXI_TRIP_FARE.base + tiles * TAXI_TRIP_FARE.perTile);
  assert.equal(city.accounts.treasury, before + fare);
  assert.deepEqual(city.ledger.at(-1), { tick: city.tick, from: 'outside', to: 'treasury', amount: fare, reason: 'Taxi fares' });
  assert.equal(deserialize(serialize(city)).accounts.treasury, before + fare);
});
