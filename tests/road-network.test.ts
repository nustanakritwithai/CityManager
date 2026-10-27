import test from 'node:test';
import assert from 'node:assert/strict';
import { SIZE, GATEWAY, createCity, buildRoad, bulldoze, serialize } from '../src/sim.ts';
import { roadFacts } from '../src/place-checklist.ts';
import { shortestRoadRoute, roadDistance, gatewayRoadRoute, gatewayRoadDistance } from '../src/road-network.ts';

test('gateway and parcel frontage distances count real connected road edges', () => {
  const city = createCity();
  assert.deepEqual(shortestRoadRoute(city, GATEWAY, GATEWAY + 4), [GATEWAY, GATEWAY + 1, GATEWAY + 2, GATEWAY + 3, GATEWAY + 4]);
  const home = 11 * SIZE + 4, shop = 13 * SIZE + 4;
  assert.deepEqual(gatewayRoadRoute(city, home), [GATEWAY, GATEWAY + 1, GATEWAY + 2, GATEWAY + 3, GATEWAY + 4]);
  assert.equal(gatewayRoadDistance(city, home), 5);
  assert.equal(roadDistance(city, home, shop), 2);
  assert.equal(gatewayRoadDistance(city, GATEWAY), 0);
  for (const [index, cell] of city.cells.entries()) if (cell.road) {
    assert.equal(gatewayRoadDistance(city, index), roadFacts(city, index)!.stepsToGateway);
  }
});

test('routing picks the shortest frontage, including on disconnected road islands', () => {
  const city = createCity();
  for (const cell of city.cells) cell.road = false;
  const parcel = 4 * SIZE + 4;
  const roads = [parcel - SIZE, parcel - SIZE + 1, parcel - SIZE + 2, parcel + 1, parcel + 2];
  for (const i of roads) city.cells[i].road = true;
  assert.deepEqual(shortestRoadRoute(city, parcel, parcel + 2), [parcel + 1, parcel + 2]);
  assert.equal(roadDistance(city, parcel, parcel + 2), 2);
  assert.equal(gatewayRoadDistance(city, parcel), null);
});

test('disconnected, malformed, non-road and wraparound endpoints cannot invent routes', () => {
  const city = createCity();
  assert.equal(gatewayRoadDistance(city, 1), null);
  assert.equal(roadDistance(city, -1, GATEWAY), null);
  assert.equal(roadDistance(city, GATEWAY, SIZE * SIZE), null);
  assert.equal(roadDistance(city, 1.25, GATEWAY), null);
  assert.equal(buildRoad(city, 23, 23).ok, true);
  assert.equal(buildRoad(city, 24, 24).ok, true);
  assert.deepEqual(shortestRoadRoute(city, 23, 24), []);
  assert.equal(bulldoze(city, GATEWAY + 1).ok, true);
  assert.equal(gatewayRoadDistance(city, 11 * SIZE + 9), null);
});

test('route queries preserve the entire saved state and seeded RNG', () => {
  const city = createCity(61025), before = serialize(city), rng = city.rng;
  for (let i = 0; i < 40; i++) {
    shortestRoadRoute(city, GATEWAY, GATEWAY + 10);
    gatewayRoadRoute(city, 11 * SIZE + 4);
    gatewayRoadDistance(city, 13 * SIZE + 7);
    roadDistance(city, GATEWAY + 1, 13 * SIZE + 2);
  }
  assert.equal(serialize(city), before);
  assert.equal(city.rng, rng);
});
