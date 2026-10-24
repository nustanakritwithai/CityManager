import test from 'node:test';
import assert from 'node:assert/strict';
import { SIZE, GATEWAY, createCity, buildRoad, bulldoze, serialize } from '../src/sim.ts';
import { shortestRoadRoute, roadDistance, gatewayRoadRoute, gatewayRoadDistance } from '../src/road-network.ts';

test('gateway and parcel frontage distances count real connected road edges', () => {
  const city = createCity();
  assert.deepEqual(shortestRoadRoute(city, GATEWAY, GATEWAY + 4), [
    GATEWAY, GATEWAY + 1, GATEWAY + 2, GATEWAY + 3, GATEWAY + 4,
  ]);
  assert.equal(roadDistance(city, GATEWAY, GATEWAY + 4), 4);
  const home = 11 * SIZE + 4;
  const shop = 13 * SIZE + 4;
  assert.deepEqual(gatewayRoadRoute(city, home), [
    GATEWAY, GATEWAY + 1, GATEWAY + 2, GATEWAY + 3, GATEWAY + 4,
  ]);
  assert.equal(gatewayRoadDistance(city, home), 5); // four road edges + one frontage
  assert.equal(roadDistance(city, home, shop), 2); // two frontages on the same road
  assert.equal(gatewayRoadDistance(city, GATEWAY), 0);
});

test('the router chooses the shortest connected path rather than construction order', () => {
  const city = createCity();
  const left = GATEWAY + 2 * SIZE + 2;
  const right = GATEWAY + 2 * SIZE + 5;
  assert.equal(buildRoad(city, GATEWAY + 2, left).ok, true);
  assert.equal(buildRoad(city, GATEWAY + 5, right).ok, true);
  assert.equal(buildRoad(city, left, right).ok, true);
  assert.deepEqual(shortestRoadRoute(city, left, right), [left, left + 1, left + 2, right]);
  assert.equal(roadDistance(city, left, right), 3);
  assert.equal(roadDistance(city, right, left), 3);
});

test('disconnected, malformed, non-road and wraparound endpoints cannot invent delivery routes', () => {
  const city = createCity();
  assert.deepEqual(gatewayRoadRoute(city, 1), []);
  assert.equal(gatewayRoadDistance(city, 1), null);
  assert.equal(roadDistance(city, -1, GATEWAY), null);
  assert.equal(roadDistance(city, GATEWAY, SIZE * SIZE), null);
  assert.equal(roadDistance(city, 1.25, GATEWAY), null);

  // Consecutive flat array indices 23 and 24 are NOT adjacent on the grid.
  assert.equal(buildRoad(city, 23, 23).ok, true);
  assert.equal(buildRoad(city, 24, 24).ok, true);
  assert.deepEqual(shortestRoadRoute(city, 23, 24), []);
  assert.equal(roadDistance(city, 23, 24), null);

  assert.equal(bulldoze(city, GATEWAY + 1).ok, true);
  assert.deepEqual(gatewayRoadRoute(city, GATEWAY + 10), []);
  assert.equal(gatewayRoadDistance(city, 11 * SIZE + 9), null);
});

test('route queries do not change balances, ledgers, save schema or seeded RNG', () => {
  const city = createCity(61025);
  const before = serialize(city), rng = city.rng;
  for (let i = 0; i < 40; i++) {
    shortestRoadRoute(city, GATEWAY, GATEWAY + 10);
    gatewayRoadRoute(city, 11 * SIZE + 4);
    gatewayRoadDistance(city, 13 * SIZE + 7);
    roadDistance(city, GATEWAY + 1, 13 * SIZE + 2);
  }
  assert.equal(serialize(city), before);
  assert.equal(city.rng, rng);
});
