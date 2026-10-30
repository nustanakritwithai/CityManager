import test from 'node:test';
import assert from 'node:assert/strict';
import { createCity, serialize } from '../src/sim.ts';
import { taxiSiteReason } from '../src/taxi/placement.ts';
import { createTaxiSession } from '../src/taxi/session.ts';
import { TaxiEngine } from '../src/taxi/dispatch.ts';
import { trafficTaxiPoses } from '../src/taxi/game-visual.ts';
import { buildNetwork } from '../src/traffic/network.ts';
import { linkTimes } from '../src/traffic/routing.ts';
import { gamePoses } from '../src/traffic/game-poses.ts';
import { allocateGameModes, compileGameModal } from '../src/traffic/game-modal.ts';
import { TrafficGame, bindTaxiSessionDepots, captureTrafficGameInput, demandTaxiRate, gameCarIsTaxi, type GameCar, type TrafficGameSample } from '../src/traffic/game.ts';
import type { RoadMap } from '../src/road-topology.ts';

const map = (): RoadMap => ({ cells: Array.from({ length: 576 }, (_, i) => ({ road: [25, 26, 27, 28].includes(i) })) });
const depot = { id: 1, cell: 49, level: 1 as const, open: true };
const demand = (): TrafficGameSample => ({ map: map(), demand: [{ from: 25, to: 28, rate: 4 }, { from: 300, to: 301, rate: 1 }] });

test('taxi demand follows traffic density inside depot coverage only', () => {
  const sample = demand();
  const before = structuredClone(sample);
  const allocated = allocateGameModes(sample, compileGameModal(sample.map, { taxis: [depot], rail: [] }));
  assert.deepEqual(sample, before, 'allocation does not mutate the captured sample');
  const covered = allocated.sample.demand.find(row => row.from === 25 && row.to === 28);
  const remote = allocated.sample.demand.find(row => row.from === 300);
  assert.ok(covered && demandTaxiRate(covered) > 0 && demandTaxiRate(covered) < covered.rate);
  assert.equal(remote ? demandTaxiRate(remote) : 0, 0);
  assert.ok(allocated.stats.taxiDiverted > 0);
  assert.ok(allocated.stats.roadAfter < allocated.stats.roadBefore);
  const closed = allocateGameModes(sample, compileGameModal(sample.map, { taxis: [{ ...depot, open: false }], rail: [] }));
  assert.equal(closed.stats.taxiDiverted, 0);
  assert.equal(demandTaxiRate(closed.sample.demand.find(row => row.from === 25)!), 0);
});

test('dispatch sends taxis along the density OD and lowers private road load', () => {
  const sample = demand();
  const withTaxi = allocateGameModes(sample, compileGameModal(sample.map, { taxis: [depot], rail: [] }));
  const without = allocateGameModes(sample, compileGameModal(sample.map, { taxis: [], rail: [] }));
  const drive = (roads: TrafficGameSample) => {
    const game = new TrafficGame(roads);
    let taxis = 0;
    const seen: { from: number; to: number }[] = [];
    for (let step = 0; step < 40; step++) {
      const frame = game.step();
      for (const car of frame.cars) if (gameCarIsTaxi(car)) { taxis++; seen.push({ from: car.from, to: car.to }); }
    }
    return { offered: game.frame.offered, taxis, seen, private: game.frame.cars.filter(car => !gameCarIsTaxi(car)).length };
  };
  const served = drive(withTaxi.sample), carsOnly = drive(without.sample);
  assert.ok(served.offered < carsOnly.offered, 'taxi service lowers the road load the game offers');
  assert.equal(carsOnly.taxis, 0);
  assert.ok(served.taxis > 0, 'taxis are dispatched onto the covered trip');
  assert.ok(served.seen.every(car => [25, 26, 27, 28].includes(car.from) && [25, 26, 27, 28].includes(car.to)));
  const net = buildNetwork(sample.map);
  const engine = new TaxiEngine(net, linkTimes(net, new Map()), [{ id: 1, cell: 25, level: 1, open: true }], 8 * 60, { width: 24 });
  engine.submit([{ id: 'density', from: 25, to: 28, persons: 2, minute: 8 * 60 }]);
  engine.advanceTo(8 * 60 + 30);
  assert.equal(engine.ledger().conservationError, 0);
  assert.ok(engine.events.some(event => event.kind === 'pickup' && event.requestId === 'density'));
});

test('session depots stay out of the save and do nothing while traffic or the flag is off', () => {
  const city = createCity(61025), before = serialize(city);
  const session = createTaxiSession();
  const site = city.cells.findIndex((_, index) => taxiSiteReason(city, index, true) === null);
  assert.ok(site >= 0);
  assert.equal(session.place(city, site, true, false).ok, false);
  assert.equal(session.depots().length, 0);
  assert.equal(session.place(city, site, false, true).ok, false);
  assert.equal(session.place(city, site, true, true).ok, true);
  assert.equal(serialize(city), before);
  assert.equal(before.includes('"taxi"'), false);
  bindTaxiSessionDepots(session.trafficSites(true, true));
  try {
    assert.equal(captureTrafficGameInput(city).taxis?.length, 0);
    assert.equal(captureTrafficGameInput(city, { taxiEnabled: false }).taxis?.length, 0);
    const live = captureTrafficGameInput(city, { taxiEnabled: true });
    assert.equal(live.taxis?.length, 1);
    assert.equal(live.taxis?.[0].cell, site);
    assert.equal(serialize(city), before);
  } finally { bindTaxiSessionDepots(null); }
  session.upgrade(session.depots()[0].id);
  assert.equal(session.depots()[0].level, 2);
  assert.equal(session.toggle(session.depots()[0].id).ok, true);
  assert.equal(session.removeAt(site).ok, true);
  assert.equal(serialize(city), before);
});

test('yellow taxi poses are separate from the private-car fleet', () => {
  const cars = [
    { id: 1, from: 25, to: 26, blocked: false },
    Object.assign({ id: 2, from: 26, to: 27, blocked: false } satisfies GameCar, { taxi: true }),
  ];
  const groups = [
    { key: '25>26', from: 25, to: 26, amount: 1, queued: 0, storage: 4, closed: false },
    { key: '26>27', from: 26, to: 27, amount: 1, queued: 0, storage: 4, closed: false },
  ];
  const privatePoses = gamePoses(cars, groups);
  assert.ok(privatePoses.every(pose => pose.vehicleId !== 'game:2'));
  assert.ok(privatePoses.some(pose => pose.vehicleId === 'game:1'));
  const yellow = trafficTaxiPoses(cars, groups);
  assert.equal(yellow.length, 1);
  assert.equal(yellow[0].unitId, 'game:2');
  assert.ok(Math.hypot(yellow[0].headingX, yellow[0].headingZ) > 0);
});
