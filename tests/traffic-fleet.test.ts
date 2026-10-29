import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNetwork, linkKey, type LinkNetwork } from '../src/traffic/network.ts';
import { createFleet, updateFleet, animateFleet, fleetPoses, fleetVehicles, wantedCars, GLOBAL_VEHICLE_CAP } from '../src/traffic/fleet.ts';
import { overlappingPairs } from '../src/citizen-road-queue.ts';
import { configureRoadPath, type RoadMap } from '../src/road-topology.ts';
import { createCity, step, serialize } from '../src/sim.ts';
import { TrafficClock, gameMinute } from '../src/traffic/clock.ts';
import { changedRoadCells, trafficModelEnabled, TRAFFIC_STORAGE_KEY } from '../src/traffic/flag.ts';

const S = 24, at = (x: number, y: number) => y * S + x;
const blank = (): RoadMap => ({ cells: Array.from({ length: S * S }, () => ({ road: false })) });
function draw(c: RoadMap, path: number[], oneWay = false) { const fresh = new Set(path.filter(i => !c.cells[i].road)); for (const i of path) c.cells[i].road = true; configureRoadPath(c, path, fresh, oneWay); }
const row = (y: number, x0: number, x1: number) => Array.from({ length: x1 - x0 + 1 }, (_, i) => at(x0 + i, y));
const col = (x: number, y0: number, y1: number) => Array.from({ length: y1 - y0 + 1 }, (_, i) => at(x, y0 + i));
/** Grid with crossings, a one-way street and a parallel non-junction road. */
function grid() { const c = blank(); for (const y of [2, 5, 8]) draw(c, row(y, 1, 12)); for (const x of [2, 6, 10]) draw(c, col(x, 1, 9)); draw(c, row(11, 1, 12), true); draw(c, row(12, 1, 12)); return c; }
const fill = (net: LinkNetwork, f: (k: string) => number) => new Map([...net.links.keys()].map(k => [k, f(k)]));

test('visual count tracks volume and respects per-link and global caps', () => {
  const net = buildNetwork(grid()), l = net.links.get(linkKey(at(1, 2), at(2, 2)))!;
  const counts = [0, 50, 300, 600, 1200, 5000].map(v => wantedCars(l, v));
  for (let i = 1; i < counts.length; i++) assert.ok(counts[i] >= counts[i - 1]);
  assert.equal(counts[0], 0); assert.ok(counts[1] >= 1);
  const fleet = updateFleet(createFleet(), net, fill(net, () => 5000));
  assert.equal(fleetVehicles(fleet, net).length, Math.min(GLOBAL_VEHICLE_CAP, [...net.links.values()].reduce((n, x) => n + wantedCars(x, 5000), 0)));
  const low = updateFleet(createFleet(), net, fill(net, () => 100)), high = updateFleet(createFleet(), net, fill(net, () => 900));
  assert.ok(fleetVehicles(high, net).length > fleetVehicles(low, net).length);
});
test('fleet is stable across period and day changes: no vanish, no duplicate ids', () => {
  const net = buildNetwork(grid()), fleet = createFleet();
  updateFleet(fleet, net, fill(net, k => 400 + (k.length % 3) * 100));
  const before = fleetVehicles(fleet, net).map(v => v.id);
  updateFleet(fleet, net, fill(net, k => 400 + (k.length % 3) * 100)); // next period, same demand
  assert.deepEqual(fleetVehicles(fleet, net).map(v => v.id), before);
  updateFleet(fleet, net, fill(net, k => 900 + (k.length % 3) * 100)); // busier: only additions
  const after = fleetVehicles(fleet, net).map(v => v.id);
  assert.ok(before.every(id => after.includes(id)));
  assert.equal(new Set(after).size, after.length);
  updateFleet(fleet, net, fill(net, () => 0), l => l.from % 2 === 0); // offscreen links keep ids
  updateFleet(fleet, net, fill(net, k => 900 + (k.length % 3) * 100));
  assert.ok(after.filter(id => fleetVehicles(fleet, net).some(v => v.id === id)).length > 0);
});
test('no overlapping cars in free flow, queues, one-way lanes and junctions', () => {
  const net = buildNetwork(grid()), fleet = createFleet();
  for (const v of [100, 700, 5000]) {
    updateFleet(fleet, net, fill(net, () => v));
    for (let i = 0; i < 30; i++) { animateFleet(fleet, .137); const p = fleetPoses(fleet, net); assert.deepEqual(overlappingPairs(p), []); }
  }
  const oneWay = net.links.get(linkKey(at(3, 11), at(4, 11)))!;
  assert.equal(oneWay.lanes, 2);
  assert.ok(!net.links.has(linkKey(at(3, 12), at(3, 11)))); // parallel road not joined
});
test('congested links queue and approaches to a junction with full exits stop', () => {
  const net = buildNetwork(grid()), fleet = createFleet(), into = linkKey(at(1, 5), at(2, 5));
  const v = fill(net, k => k.startsWith(`${at(2, 5)}>`) ? 5000 : 10);
  updateFleet(fleet, net, v);
  assert.equal(fleet.links.get(into)!.queued, true);
  animateFleet(fleet, 1); assert.equal(fleet.links.get(into)!.phase, 1);
  const free = linkKey(at(3, 8), at(4, 8)); assert.equal(fleet.links.get(free)!.queued, false);
});
test('flag defaults off; dev toggle via ?traffic=1 or localStorage', () => {
  const mem = new Map<string, string>(), st = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
  assert.equal(trafficModelEnabled('', st), false);
  assert.equal(trafficModelEnabled('?traffic=1', st), true); assert.equal(mem.get(TRAFFIC_STORAGE_KEY), '1');
  assert.equal(trafficModelEnabled('', st), true);
  assert.equal(trafficModelEnabled('?traffic=0', st), false); assert.equal(trafficModelEnabled('', st), false);
});
test('changed road cells cover road flags, junction splits and one-way arrows', () => {
  const c = grid(), roads = c.cells.map(x => x.road), topo = JSON.stringify(c.roadTopology ?? '');
  const key = () => c.roadTopology ? JSON.stringify(c.roadTopology) : '';
  const t0 = key(); c.cells[at(20, 20)].road = true; draw(c, row(14, 1, 3), true);
  const changed = changedRoadCells(roads, c.cells.map(x => x.road), t0, key());
  for (const i of [at(20, 20), at(1, 14), at(2, 14), at(3, 14)]) assert.ok(changed.includes(i));
  void topo;
});
test('economy and saves unchanged with the fleet running every hour for 15 days', () => {
  const run = (on: boolean) => {
    const c = createCity(61025), k = new TrafficClock({ enabled: on }), fleet = createFleet(); k.advance(c, 0);
    for (let d = 1; d <= 15; d++) { step(c); for (let h = 0; h < 24; h++) { const r = k.advance(c, gameMinute(c.tick - 1, h * 60)); if (r.length && k.network) { updateFleet(fleet, k.network, r.at(-1)!.volumes); animateFleet(fleet, 1); fleetPoses(fleet, k.network); } } }
    return serialize(c);
  };
  assert.equal(run(true), run(false));
});
