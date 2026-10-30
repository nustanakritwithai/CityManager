import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNetwork, rebuildRegion, linkKey, type LinkNetwork } from '../src/traffic/network.ts';
import { createFleet, setFleetDemand, stepFleet, fleetPoses, apportion, activeCars, GLOBAL_VEHICLE_CAP, VISUAL_SCALE, VISUAL_TILES_PER_SECOND } from '../src/traffic/fleet.ts';
import { assignPeriod, type OdDemand } from '../src/traffic/routing.ts';
import { LANE_END } from '../src/citizen-road-queue.ts';
import { overlappingPairs } from '../src/citizen-road-queue.ts';
import { configureRoadPath, forgetRoadTopology, type RoadMap } from '../src/road-topology.ts';
import { createCity, step, serialize } from '../src/sim.ts';
import { TrafficClock, gameMinute } from '../src/traffic/clock.ts';
import { cityDemandInput } from '../src/traffic/snapshot.ts';
import { changedRoadCells, trafficModelEnabled, decorativePlan, screenCull, TRAFFIC_STORAGE_KEY } from '../src/traffic/flag.ts';

const S = 24, at = (x: number, y: number) => y * S + x;
const blank = (): RoadMap => ({ cells: Array.from({ length: S * S }, () => ({ road: false })) });
function draw(c: RoadMap, path: number[], oneWay = false) { const fresh = new Set(path.filter(i => !c.cells[i].road)); for (const i of path) c.cells[i].road = true; configureRoadPath(c, path, fresh, oneWay); }
const row = (y: number, x0: number, x1: number) => Array.from({ length: x1 - x0 + 1 }, (_, i) => at(x0 + i, y));
const col = (x: number, y0: number, y1: number) => Array.from({ length: y1 - y0 + 1 }, (_, i) => at(x, y0 + i));
/** Grid with crossings, a one-way street and a parallel non-junction road. */
function grid() { const c = blank(); for (const y of [2, 5, 8]) draw(c, row(y, 1, 12)); for (const x of [2, 6, 10]) draw(c, col(x, 1, 9)); draw(c, row(11, 1, 12), true); draw(c, row(12, 1, 12)); return c; }

/** Use a loaded second assignment to exercise both routed paths with matching current times. */
function routed(net: LinkNetwork, od: OdDemand[]) { const first = assignPeriod(net, od), a = assignPeriod(net, od, first.state, 1); return { od, state: a.assigned, times: a.times }; }
const ods = (v: number): OdDemand[] => [
  { from: at(1, 2), to: at(12, 8), vehicles: v }, { from: at(12, 2), to: at(1, 8), vehicles: v },
  { from: at(2, 9), to: at(10, 1), vehicles: v }, { from: at(10, 9), to: at(2, 1), vehicles: v },
  { from: at(1, 11), to: at(12, 11), vehicles: v }, { from: at(12, 12), to: at(1, 12), vehicles: v }, { from: at(6, 1), to: at(6, 9), vehicles: v }];
const run = (fleet: ReturnType<typeof createFleet>, net: LinkNetwork, seconds: number, each?: () => void) => { for (let t = 0; t < seconds; t += .05) { stepFleet(fleet, net, .05); each?.(); } };

test('visible count is proportional to model vehicles, and 0 for quiet roads', () => {
  assert.equal(apportion(new Map([['a', .4], ['b', .5]])).get('a'), 0);
  const w = new Map([['a', 30], ['b', 10], ['c', 0.6]]), n = apportion(w);
  assert.deepEqual([n.get('a'), n.get('b'), n.get('c')], [15, 5, 0]);
  assert.equal([...apportion(new Map([['a', 1e6]])).values()][0], GLOBAL_VEHICLE_CAP);
  const net = buildNetwork(grid()), f = createFleet(), r = routed(net, ods(1));
  setFleetDemand(f, net, r.od, r.state, r.times);
  const total = [...f.targets.values()].reduce((a, t) => a + t.target, 0);
  assert.equal(total, Math.round(7 / VISUAL_SCALE));
});
test('12-person city shows only a few cars', () => {
  const c = createCity(61025); for (let d = 0; d < 60; d++) step(c);
  const k = new TrafficClock({ enabled: true }); k.advance(c, gameMinute(c.tick, 0)); k.advance(c, gameMinute(c.tick, 8 * 60));
  const f = createFleet(); setFleetDemand(f, k.network!, k.lastOd, k.last!.assigned, k.last!.times);
  const total = [...f.targets.values()].reduce((a, t) => a + t.target, 0);
  assert.ok(total <= 3, String(total));
});
test('continuous movement across links, no overlap, junction squares one car at a time', () => {
  const net = buildNetwork(grid()), f = createFleet(), r = routed(net, ods(60));
  setFleetDemand(f, net, r.od, r.state, r.times);
  const seen = new Map<string, number>(); let handoffs = 0;
  run(f, net, 40, () => {
    const ov = overlappingPairs(fleetPoses(f, net));
    if (ov.length) { const ids = new Set(ov[0]); console.log('DBG', JSON.stringify(f.cars.filter(c => ids.has(c.id)).map(c => ({ id: c.id, i: c.i, s: +c.s.toFixed(3), lane: c.lane, seg: [c.path[c.i - 1], c.path[c.i], c.path[c.i + 1], c.path[c.i + 2]], phase: c.phase }))), JSON.stringify(fleetPoses(f, net).filter(p => ids.has(p.vehicleId)))); }
    assert.deepEqual(ov, []);
    for (const c of f.cars) { const prev = seen.get(c.id); if (prev !== undefined && c.i > prev) handoffs++; seen.set(c.id, c.i); }
  });
  assert.ok(handoffs > 50, String(handoffs));
  assert.ok(activeCars(f) > 10);
  // Positions never jump: per-step displacement is bounded by speed × dt.
  const before = new Map(fleetPoses(f, net).map(p => [p.vehicleId, p]));
  stepFleet(f, net, .05);
  for (const p of fleetPoses(f, net)) { const q = before.get(p.vehicleId); if (q) assert.ok(Math.hypot(p.x - q.x, p.z - q.z) < 2 * VISUAL_TILES_PER_SECOND * .05 * 2 + 1e-6); }
});
test('demand drop: cars drive out and fade, never pop', () => {
  const net = buildNetwork(grid()), f = createFleet(), r = routed(net, ods(40));
  setFleetDemand(f, net, r.od, r.state, r.times); run(f, net, 15);
  const n0 = f.cars.length; assert.ok(n0 > 5);
  setFleetDemand(f, net, [], new Map()); // night
  let prev = new Map(f.cars.map(c => [c.id, c]));
  for (let t = 0; t < 60 && f.cars.length; t += .05) {
    stepFleet(f, net, .05);
    const now = new Set(f.cars.map(c => c.id));
    for (const [id, c] of prev) if (!now.has(id)) assert.ok(c.phase === 'out' && c.fade <= .2, `${id} popped`);
    prev = new Map(f.cars.map(c => [c.id, { ...c }]));
  }
  assert.equal(f.cars.length, 0);
});
test('stress: no overlap at low and saturated demand, incl. one-way and turns', () => {
  for (const v of [5, 30, 500]) {
    const net = buildNetwork(grid()), f = createFleet(), r = routed(net, ods(v));
    setFleetDemand(f, net, r.od, r.state, r.times);
    run(f, net, 60, () => { const ov = overlappingPairs(fleetPoses(f, net)); if (ov.length) { const ids = new Set(ov[0]); console.log('DBG', v, JSON.stringify(f.cars.filter(c => ids.has(c.id)).map(c => ({ id: c.id, i: c.i, s: +c.s.toFixed(3), lane: c.lane, seg: [c.path[c.i - 1], c.path[c.i], c.path[c.i + 1], c.path[c.i + 2]], phase: c.phase, held: [...f.held].filter(([, x]) => x === c.id) }))), JSON.stringify(fleetPoses(f, net).filter(p => ids.has(p.vehicleId)))); } assert.deepEqual(ov, []); });
  }
});
test('stress on the real starter city with dense demand: no overlap', () => {
  const c = createCity(61025); for (let d = 0; d < 60; d++) step(c);
  const base = cityDemandInput(c), dense = { ...base, households: base.households.map(h => ({ ...h, amount: h.amount * 40 })), jobs: base.jobs.map(j => ({ ...j, amount: j.amount * 40 })) };
  const k = new TrafficClock({ enabled: true, snapshot: () => dense }); k.advance(c, gameMinute(c.tick, 0)); k.advance(c, gameMinute(c.tick, 8 * 60));
  const f = createFleet(), net = k.network!; setFleetDemand(f, net, k.lastOd, k.last!.assigned, k.last!.times);
  run(f, net, 60, () => assert.deepEqual(overlappingPairs(fleetPoses(f, net)), []));
  assert.ok(activeCars(f) > 3);
});
test('a full exit stops cars at the stop line before the junction', () => {
  const net = buildNetwork(grid()), f = createFleet(), r = routed(net, ods(200));
  setFleetDemand(f, net, r.od, r.state, r.times);
  run(f, net, 30, () => {
    for (const c of f.cars) if (c.s > LANE_END && c.i < c.path.length - 2) {
      const n = c.path[c.i + 1]; const h = f.held.get(n);
      assert.ok(h === undefined || h === c.id || c.path[c.i + 2] - n === n - c.path[c.i]);
    }
  });
});
test('culling hides poses only; fleet and model unchanged', () => {
  const net = buildNetwork(grid()), a = createFleet(), b = createFleet(), r = routed(net, ods(60));
  setFleetDemand(a, net, r.od, r.state, r.times); setFleetDemand(b, net, r.od, r.state, r.times);
  for (let t = 0; t < 10; t += .05) { stepFleet(a, net, .05); stepFleet(b, net, .05); fleetPoses(a, net); fleetPoses(b, net, cell => cell % 24 < 6); }
  assert.deepEqual(a, b);
  assert.ok(fleetPoses(b, net, cell => cell % 24 < 6).length < fleetPoses(a, net).length);
  const c = createCity(61025); for (let d = 0; d < 30; d++) step(c);
  const k1 = new TrafficClock({ enabled: true }), k2 = new TrafficClock({ enabled: true }); k1.advance(c, 0); k2.advance(c, 0);
  k1.advance(c, 1440); k2.advance(c, 1440); assert.deepEqual(k1.totals, k2.totals);
});
test('decorative plan keeps trucks and smoke when cars are hidden', () => {
  const plan = { cars: [1, 2], trucks: [3], walkers: [4], smoke: [5], signature: 'x' };
  const p = decorativePlan(plan, { cars: false, walkers: true });
  assert.deepEqual(p, { cars: [], trucks: [3], walkers: [4], smoke: [5], signature: 'x' });
  assert.deepEqual(decorativePlan(plan, { cars: true, walkers: true }), plan);
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
test('screen cull uses the projected cell against the canvas', () => {
  const cull = screenCull(i => ({ x: i * 10, y: 0 }), () => ({ width: 100, height: 100 }), 0);
  assert.equal(cull(5), true); assert.equal(cull(50), false);
});
test('economy and saves unchanged with the fleet running every hour for 15 days', () => {
  const run = (on: boolean) => {
    const c = createCity(61025), k = new TrafficClock({ enabled: on }), fleet = createFleet(); k.advance(c, 0);
    let maxCars = 0;
    for (let d = 1; d <= 15; d++) { step(c); for (let h = 0; h < 24; h++) { const r = k.advance(c, gameMinute(c.tick - 1, h * 60)); if (r.length && k.network) { setFleetDemand(fleet, k.network, k.lastOd, k.last!.assigned, k.last!.times); stepFleet(fleet, k.network, .5); fleetPoses(fleet, k.network); maxCars = Math.max(maxCars, fleet.cars.length); } } }
    return { raw: serialize(c), periods: k.totals.periods, vehicles: k.totals.vehicles, maxCars };
  };
  const on = run(true), off = run(false);
  assert.equal(on.raw, off.raw);
  assert.ok(on.periods > 300 && on.vehicles > 0 && on.maxCars > 0, JSON.stringify({ periods: on.periods, vehicles: on.vehicles, maxCars: on.maxCars }));
  assert.equal(off.periods, 0); assert.equal(off.maxCars, 0);
});

const removeRoad = (c: RoadMap, net: LinkNetwork, cell: number) => { c.cells[cell].road = false; forgetRoadTopology(c, cell); rebuildRegion(c, net, [cell]); };
test('deleted destination drains to a valid endpoint and fades, never strands at a missing future link', () => {
  const c = blank(); draw(c, row(1, 1, 4));
  const net = buildNetwork(c), f = createFleet(), od = [{ from: 25, to: 28, vehicles: 2 }], a = assignPeriod(net, od);
  setFleetDemand(f, net, od, a.assigned, a.times); run(f, net, .25);
  assert.equal(f.cars.length, 1); const id = f.cars[0].id;
  removeRoad(c, net, 28);
  stepFleet(f, net, 0); assert.equal(f.cars[0].id, id); assert.notEqual(f.cars[0].phase, 'out');
  assert.equal(f.cars[0].path.at(-1), 26); // drains, not instant removal or a timeout
  run(f, net, 100); assert.equal(f.cars.length, 0); assert.equal(f.held.size, 0);
});

test('broken future link reroutes the same car without a position jump', () => {
  const c = blank(); draw(c, row(1, 1, 4)); draw(c, col(2, 1, 3)); draw(c, row(3, 2, 4)); draw(c, col(4, 1, 3));
  const net = buildNetwork(c), f = createFleet(), od = [{ from: 25, to: 28, vehicles: 2 }], a = assignPeriod(net, od);
  setFleetDemand(f, net, od, a.assigned); run(f, net, .25);
  const id = f.cars[0].id, before = fleetPoses(f, net)[0]; removeRoad(c, net, 27);
  stepFleet(f, net, 0); const car = f.cars.find(c => c.id === id)!;
  assert.ok(car); assert.equal(car.path.at(-1), 28); assert.ok(!car.path.includes(27));
  assert.deepEqual(fleetPoses(f, net)[0], before);
  for (let i = car.i + 1; i < car.path.length; i++) assert.ok(net.links.has(linkKey(car.path[i - 1], car.path[i])));
  setFleetDemand(f, net, [], new Map()); run(f, net, 30); assert.equal(f.cars.length, 0);
});

test('removed committed turn exit fades in place and releases its held junction without respawning', () => {
  const c = blank(); draw(c, row(1, 1, 2)); draw(c, col(2, 1, 3));
  const net = buildNetwork(c), f = createFleet(), od = [{ from: 25, to: 74, vehicles: 2 }], a = assignPeriod(net, od);
  setFleetDemand(f, net, od, a.assigned);
  for (let i = 0; i < 30 && !f.held.size; i++) stepFleet(f, net, .05);
  assert.equal(f.held.size, 1); const car = f.cars[0], before = fleetPoses(f, net)[0];
  assert.ok(car.s > LANE_END); removeRoad(c, net, 50);
  stepFleet(f, net, 0); assert.equal(car.phase, 'out'); assert.deepEqual(fleetPoses(f, net)[0], before);
  run(f, net, 1); assert.equal(f.cars.length, 0); assert.equal(f.held.size, 0);
});

test('visual route weights describe current loaded volumes, not next-period proposals', () => {
  const c = blank(); draw(c, row(1, 1, 4)); draw(c, col(1, 1, 3)); draw(c, row(3, 1, 4)); draw(c, col(4, 1, 3));
  const net = buildNetwork(c), od = [{ from: 25, to: 28, vehicles: 3000 }], a = assignPeriod(net, od), f = createFleet();
  assert.notDeepEqual(a.assigned, a.state);
  setFleetDemand(f, net, od, a.assigned, a.times, 1, 10000);
  const volumes = new Map<string, number>();
  for (const { path, target } of f.targets.values()) for (let i = 1; i < path.length; i++) {
    const k = linkKey(path[i - 1], path[i]); volumes.set(k, (volumes.get(k) ?? 0) + target);
  }
  assert.deepEqual(volumes, a.volumes);
});


test('denied global localStorage getter preserves default-off and explicit traffic query semantics', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new DOMException('Storage denied', 'SecurityError'); } });
  try {
    assert.equal(trafficModelEnabled(''), false);
    assert.equal(trafficModelEnabled('?traffic=0'), false);
    assert.equal(trafficModelEnabled('?traffic=1'), true);
    const mem = new Map<string, string>(), storage = { getItem: (key: string) => mem.get(key) ?? null, setItem: (key: string, value: string) => void mem.set(key, value), removeItem: (key: string) => void mem.delete(key) };
    assert.equal(trafficModelEnabled('?traffic=1', storage), true);
    assert.equal(mem.get(TRAFFIC_STORAGE_KEY), '1');
    assert.equal(trafficModelEnabled('', storage), true);
    assert.equal(trafficModelEnabled('?traffic=0', storage), false);
    assert.equal(mem.get(TRAFFIC_STORAGE_KEY), '0');
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
