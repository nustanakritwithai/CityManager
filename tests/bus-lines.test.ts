import test from 'node:test';
import assert from 'node:assert/strict';
import { configureRoadPath } from '../src/road-topology.ts';
import { buildNetwork } from '../src/traffic/network.ts';
import { linkTimes } from '../src/traffic/routing.ts';
import { createBus, removeStopsFromState, reconcileBusStops } from '../src/bus/buildings.ts';
import { BusRouteCache, busDepotLoad, busHeadway, busLineRoutes, busServiceOrder, createBusLine, deleteBusLine, editBusLine, type BusHost } from '../src/bus/lines.ts';
import { BUS_DEPOT_BUSES, BUS_DWELL_MIN, BUS_LIMITS } from '../src/bus/types.ts';
import { SIZE } from '../src/sim.ts';

const W = SIZE, at = (x: number, y: number) => y * W + x;
const row = (y: number, a: number, b: number) => Array.from({ length: b - a + 1 }, (_, k) => at(a + k, y));
const col = (x: number, a: number, b: number) => Array.from({ length: b - a + 1 }, (_, k) => at(x, a + k));
function host(): BusHost {
  const c: BusHost = { cells: Array.from({ length: W * W }, () => ({ road: false })), nextId: 100 };
  const draw = (p: number[], one = false) => { const f = new Set(p.filter(i => !c.cells[i].road)); for (const i of p) c.cells[i].road = true; configureRoadPath(c, p, f, one); };
  draw(row(2, 0, 20)); draw(row(10, 0, 20)); draw(col(0, 2, 10)); draw(col(20, 2, 10));
  const b = createBus(); c.bus = b;
  b.depots.push({ id: 1, cell: at(5, 1), level: 1, open: true, tick: 0 }, { id: 2, cell: at(5, 11), level: 1, open: true, tick: 0 });
  b.stops.push({ id: 10, cell: at(4, 2), side: 'n', level: 1 }, { id: 11, cell: at(14, 2), side: 'n', level: 1 }, { id: 12, cell: at(20, 6), side: 'e', level: 1 }, { id: 13, cell: at(10, 10), side: 's', level: 1 });
  return c;
}
const spec = (o = {}) => ({ depotId: 1, stopIds: [10, 11, 12], busCount: 2, busLevel: 1 as const, ...o });

test('create/edit/delete with rules: ≥2 stops, existing stops/depot, no adjacent repeats, max 8', () => {
  const c = host();
  const r = createBusLine(c, spec()); assert.ok(r.ok, r.message); assert.equal(r.id, 100); assert.equal(c.nextId, 101);
  assert.equal(createBusLine(c, spec({ stopIds: [10] })).ok, false);
  assert.equal(createBusLine(c, spec({ stopIds: [10, 10] })).ok, false);
  assert.equal(createBusLine(c, spec({ stopIds: [10, 99] })).ok, false);
  assert.equal(createBusLine(c, spec({ depotId: 9 })).ok, false);
  assert.equal(createBusLine(c, spec({ busLevel: 4 as never })).ok, false);
  assert.equal(createBusLine(c, spec({ busCount: -1 })).ok, false);
  assert.ok(editBusLine(c, 100, { stopIds: [12, 11], busLevel: 3 }).ok); assert.deepEqual(c.bus!.lines[0].stopIds, [12, 11]); assert.equal(c.bus!.lines[0].busLevel, 3);
  assert.equal(editBusLine(c, 100, { stopIds: [11] }).ok, false); assert.deepEqual(c.bus!.lines[0].stopIds, [12, 11], 'failed edit leaves line unchanged');
  for (let k = 1; k < BUS_LIMITS.lines; k++) assert.ok(createBusLine(c, spec({ busCount: 0 })).ok);
  assert.match(createBusLine(c, spec({ busCount: 0 })).message, /8/);
  assert.ok(deleteBusLine(c, 100).ok); assert.equal(deleteBusLine(c, 100).ok, false);
  assert.equal(createBusLine({ cells: [], nextId: 1 }, spec()).ok, false, 'no bus section');
});
test('depot capacity: busCount sum ≤ 6/12/20, reported per depot, edit excludes itself', () => {
  const c = host(), cap = BUS_DEPOT_BUSES[1];
  assert.ok(createBusLine(c, spec({ busCount: cap - 2 })).ok);
  const over = createBusLine(c, spec({ busCount: 3 })); assert.equal(over.ok, false); assert.match(over.message, new RegExp(`${cap}`));
  assert.ok(createBusLine(c, spec({ busCount: 2 })).ok);
  assert.ok(editBusLine(c, 100, { busCount: cap - 2 }).ok, 'same count re-saved');
  assert.deepEqual(busDepotLoad(c).find(d => d.depotId === 1), { depotId: 1, level: 1, open: true, capacity: cap, assigned: cap, free: 0, over: 0 });
  c.bus!.depots[0].level = 2; assert.ok(editBusLine(c, 100, { busCount: 10 }).ok);
  assert.equal(busDepotLoad(c)[0].capacity, BUS_DEPOT_BUSES[2]);
});
test('bidirectional route: outbound + return legs on legal links; loop when first == last', () => {
  const c = host(); createBusLine(c, spec());
  const [r] = busLineRoutes(c);
  assert.equal(r.status, 'running'); assert.equal(r.loop, false);
  assert.deepEqual(busServiceOrder([10, 11, 12]), [10, 11, 12, 11, 10]);
  assert.deepEqual(r.legs.map(g => [g.fromStopId, g.toStopId]), [[10, 11], [11, 12], [12, 11], [11, 10]]);
  const net = buildNetwork(c);
  for (const g of r.legs) { for (let k = 1; k < g.path.length; k++) assert.ok(net.links.has(`${g.path[k - 1]}>${g.path[k]}`), 'legal link'); assert.ok(g.seconds > 0); }
  assert.equal(r.stopCalls, 4);
  assert.ok(Math.abs(r.cycleMinutes - (r.legs.reduce((s, g) => s + g.seconds, 0) / 60 + 4 * BUS_DWELL_MIN)) < 1e-9);
  assert.equal(r.headwayMinutes, r.cycleMinutes / 2); assert.equal(r.buses, 2);
  assert.ok(r.fromDepot && r.fromDepot.at(-1) === at(4, 2) && c.cells[r.fromDepot[0]].road);
  assert.equal(r.polyline[0], at(4, 2)); assert.equal(r.polyline.at(-1), at(4, 2));
  assert.ok(Object.isFrozen(r) && Object.isFrozen(r.legs) && Object.isFrozen(r.polyline));
  const lp = createBusLine(c, spec({ stopIds: [10, 11, 13, 10], busCount: 1 })); assert.ok(lp.ok);
  const loop = busLineRoutes(c).find(x => x.lineId === lp.id)!;
  assert.equal(loop.loop, true); assert.deepEqual(loop.legs.map(g => [g.fromStopId, g.toStopId]), [[10, 11], [11, 13], [13, 10]]);
});
test('one-way streets: return leg takes a different legal path', () => {
  const c: BusHost = { cells: Array.from({ length: W * W }, () => ({ road: false })), nextId: 100 };
  const draw = (p: number[], one = false) => { const f = new Set(p.filter(i => !c.cells[i].road)); for (const i of p) c.cells[i].road = true; configureRoadPath(c, p, f, one); };
  draw(row(2, 0, 20), true); draw(row(10, 0, 20)); draw(col(0, 2, 10)); draw(col(20, 2, 10));
  c.bus = createBus(); c.bus.depots.push({ id: 1, cell: at(5, 11), level: 1, open: true, tick: 0 });
  const dir = c.roadTopology!.oneWay[at(6, 2)];
  c.bus.stops.push({ id: 10, cell: at(4, 2), side: dir === 1 ? 'n' : 's', level: 1 }, { id: 11, cell: at(14, 2), side: dir === 1 ? 'n' : 's', level: 1 });
  assert.ok(createBusLine(c, spec({ stopIds: [10, 11] })).ok);
  const [r] = busLineRoutes(c); assert.equal(r.status, 'running');
  const [out, back] = r.legs; assert.ok(back.path.length > out.path.length || out.path.length > back.path.length, 'one direction detours');
  const net = buildNetwork(c); for (const g of r.legs) for (let k = 1; k < g.path.length; k++) assert.ok(net.links.has(`${g.path[k - 1]}>${g.path[k]}`));
});
test('suspended lines: too few stops after removal, closed depot, unreachable, no buses, depot full', () => {
  const c = host(); createBusLine(c, spec({ stopIds: [10, 11] })); createBusLine(c, spec({ depotId: 2, stopIds: [10, 13], busCount: 1 }));
  removeStopsFromState(c.bus!, new Set([11]));
  assert.deepEqual(busLineRoutes(c).map(r => [r.status, r.reason ?? null, r.buses, r.headwayMinutes]), [['suspended', 'tooFewStops', 0, null], ['running', null, 1, busLineRoutes(c)[1].cycleMinutes]]);
  c.bus!.depots[1].open = false; assert.equal(busLineRoutes(c)[1].reason, 'depotClosed');
  c.bus!.depots[1].open = true; c.bus!.lines[1].busCount = 0; assert.equal(busLineRoutes(c)[1].reason, 'noBuses');
  const u = host(); createBusLine(u, spec({ stopIds: [10, 11] })); u.bus!.stops.push({ id: 14, cell: at(10, 20), side: 'n', level: 1 }); u.cells[at(10, 20)].road = true;
  u.bus!.lines[0].stopIds = [10, 14]; const ur = busLineRoutes(u)[0]; assert.equal(ur.reason, 'unreachable'); assert.deepEqual(ur.legs, []);
  // Depot removal reassigns lines; capacity is granted in line-id order and the overflow is suspended.
  const f = host(); createBusLine(f, spec({ busCount: 6 })); createBusLine(f, spec({ depotId: 2, busCount: 6 }));
  f.bus!.lines[1].depotId = 1; // as after removeBusDepotFromState
  const fr = busLineRoutes(f); assert.deepEqual(fr.map(r => [r.buses, r.reason ?? null]), [[6, null], [0, 'depotFull']]);
  assert.equal(busDepotLoad(f)[0].over, 6);
});
test('routes recompute after road edits and stop removal (cache invalidates)', () => {
  const c = host(); createBusLine(c, spec()); const cache = new BusRouteCache();
  const a = cache.get(c); assert.equal(cache.get(c), a, 'memoised while nothing changes');
  c.cells[at(10, 2)].road = false; // cut the top road between stops 10 and 11
  const b = cache.get(c); assert.notEqual(b, a); assert.equal(b[0].status, 'running', 'detours via the bottom road');
  assert.ok(b[0].legs[0].path.length > a[0].legs[0].path.length);
  assert.ok(!b[0].legs.some(g => g.path.includes(at(10, 2))));
  c.bus!.stops[2].side = 'n'; reconcileBusStops(c, W); // wrong side on a vertical road → removed
  const d = cache.get(c); assert.deepEqual(d[0].stops.map(s => s.stopId), [10, 11]); assert.equal(d[0].legs.length, 2);
  const t = linkTimes(buildNetwork(c), new Map()); for (const [k, v] of t) t.set(k, v * 2);
  assert.ok(Math.abs(cache.get(c, { times: t })[0].legs[0].seconds - 2 * d[0].legs[0].seconds) < 1e-6, 'congested times honoured');
});
test('deterministic and headway helper', () => {
  const a = host(), b = host(); createBusLine(a, spec()); createBusLine(b, spec());
  assert.deepEqual(busLineRoutes(a), busLineRoutes(b));
  assert.equal(busHeadway(30, 3), 10); assert.equal(busHeadway(30, 0), null); assert.equal(busHeadway(Infinity, 2), null);
});
test('lines created on a real city round-trip through the save validator', async () => {
  const { createCity, step, serialize, deserialize, connectedRoads } = await import('../src/sim.ts');
  const { buildBusDepot, buildBusStop, busDepotReason, busStopSiteReason, defaultBusStopSide } = await import('../src/bus/placement.ts');
  const c = createCity(61025); for (let d = 0; d < 20; d++) step(c);
  const lot = c.cells.findIndex((_, i) => busDepotReason(c, i, true) === null); assert.ok(buildBusDepot(c, lot, true).ok);
  const cells: number[] = []; for (let i = 0; i < W * W && cells.length < 2; i++) if (busStopSiteReason(c, i, defaultBusStopSide(c, i), true) === null && cells.every(o => Math.abs(o % W - i % W) + Math.abs(Math.floor(o / W) - Math.floor(i / W)) >= 3)) { assert.ok(buildBusStop(c, i, undefined, true).ok); cells.push(i); }
  const r = createBusLine(c, { depotId: c.bus!.depots[0].id, stopIds: c.bus!.stops.map(s => s.id), busCount: 3, busLevel: 2 }); assert.ok(r.ok, r.message);
  const back = deserialize(serialize(c)); assert.deepEqual(back.bus, c.bus);
  const [route] = busLineRoutes(back); assert.ok(route.legs.length === 2 && route.legs.every(g => g.path.every(x => back.cells[x].road)));
  void connectedRoads;
});
