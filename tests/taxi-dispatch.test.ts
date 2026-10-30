import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNetwork, type LinkNetwork } from '../src/traffic/network.ts';
import { linkTimes } from '../src/traffic/routing.ts';
import { configureRoadPath, setRoadJunction, type RoadMap } from '../src/road-topology.ts';
import { dispatchZones, travelTree, treeMinutes, TAXI_DISPATCH_MINUTES } from '../src/taxi/coverage.ts';
import { planRoam } from '../src/taxi/rrt-roam.ts';
import * as dispatchApi from '../src/taxi/dispatch.ts';
import { TaxiEngine, TAXI_ROAM_GAIN, TAXI_SPREAD_RADIUS, TAXI_MAX_WAIT_MIN, DEPOT_UNITS, type TaxiLeaseAdapter, type TaxiRequest } from '../src/taxi/dispatch.ts';

const S = 24, at = (x: number, y: number) => y * S + x;
const blank = (): RoadMap => ({ cells: Array.from({ length: S * S }, () => ({ road: false })) });
function draw(c: RoadMap, path: number[], oneWay = false) { const fresh = new Set(path.filter(i => !c.cells[i].road)); for (const i of path) c.cells[i].road = true; configureRoadPath(c, path, fresh, oneWay); }
const row = (y: number, x0: number, x1: number) => Array.from({ length: x1 - x0 + 1 }, (_, i) => at(x0 + i, y));
const col = (x: number, y0: number, y1: number) => Array.from({ length: y1 - y0 + 1 }, (_, i) => at(x, y0 + i));
function grid() { const c = blank(); for (const y of [2, 6, 10]) draw(c, row(y, 0, 20)); for (const x of [0, 10, 20]) draw(c, col(x, 2, 10)); return c; }
const free = (net: LinkNetwork) => linkTimes(net, new Map());
class Ledger implements TaxiLeaseAdapter {
  reserved = new Map<string, number>(); released = new Map<string, number>(); completed = new Map<string, number>();
  reserve(id: string, n: number) { this.reserved.set(id, (this.reserved.get(id) ?? 0) + n); }
  release(id: string, n: number) { this.released.set(id, (this.released.get(id) ?? 0) + n); }
  complete(id: string, n: number) { assert.ok(n >= (this.completed.get(id) ?? 0)); this.completed.set(id, n); }
  check() { for (const [id, r] of this.reserved) assert.ok((this.released.get(id) ?? 0) + (this.completed.get(id) ?? 0) <= r); }
}
const depot = { id: 1, cell: at(0, 2), level: 1 as const, open: true };
const reqs = (n: number, minute = 0): TaxiRequest[] => Array.from({ length: n }, (_, i) => ({ id: `r${i}`, from: at(2 + (i % 5) * 3, 6), to: at(18, 10 - (i % 3) * 4), persons: 3 + (i % 8), minute }));

test('coverage uses travel time, not radius: one-way detour drops a near cell', () => {
  const c = blank(); draw(c, row(2, 0, 12)); draw(c, row(3, 0, 12), true); // y=3 one-way eastbound, separate road
  draw(c, col(12, 2, 3)); // connected only at the far east end
  const net = buildNetwork(c), z = dispatchZones(net, free(net), [{ id: 1, cell: at(12, 3) }], 2);
  assert.ok(!z.has(at(11, 3)), 'one-way: cannot drive back west'); // geometrically adjacent, unreachable
  const t = travelTree(net, free(net), at(0, 2)); assert.ok(treeMinutes(t, at(12, 2)) > 0);
  const zz = dispatchZones(net, free(net), [{ id: 1, cell: at(0, 2) }], TAXI_DISPATCH_MINUTES);
  assert.ok(zz.has(at(5, 2)) && !zz.has(at(5, 3)), 'adjacent cell on a one-way road with no way in is outside');
});
test('nearest depot wins, ties go to the lower id', () => {
  const net = buildNetwork(grid()), z = dispatchZones(net, free(net), [{ id: 7, cell: at(20, 2) }, { id: 3, cell: at(0, 2) }]);
  assert.equal(z.get(at(1, 2))!.depotId, 3); assert.equal(z.get(at(19, 2))!.depotId, 7); assert.equal(z.get(at(10, 2))!.depotId, 3);
});
test('requests outside coverage are rejected without a lease', () => {
  const c = grid(); draw(c, row(20, 0, 3)); const net = buildNetwork(c), l = new Ledger();
  const e = new TaxiEngine(net, free(net), [depot], 0, { lease: l, width: S });
  const r = e.submit([{ id: 'far', from: at(1, 20), to: at(3, 20), persons: 4, minute: 0 }]);
  assert.deepEqual(r.rejected, ['far']); assert.equal(l.reserved.size, 0);
});
test('deterministic nearest-ETA assignment and people conserved every quantum', () => {
  const run = () => {
    const net = buildNetwork(grid()), l = new Ledger(), e = new TaxiEngine(net, free(net), [depot, { id: 2, cell: at(20, 10), level: 2, open: true }], 0, { lease: l, width: S, seed: 7 });
    e.submit(reqs(12));
    for (let m = 0; m <= 180; m += 5) { e.advanceTo(m); assert.equal(e.ledger().conservationError, 0); l.check(); }
    return { d: e.diagnostics(), legs: e.legs };
  };
  const a = run(); assert.deepEqual(run(), a);
  assert.equal(a.d.units, DEPOT_UNITS[1] + DEPOT_UNITS[2]);
  assert.ok(a.d.completed > 0);
});
test('wait over the max returns people to private cars (never dropped)', () => {
  const net = buildNetwork(grid()), l = new Ledger(), e = new TaxiEngine(net, free(net), [depot], 0, { lease: l, width: S });
  e.submit(reqs(40)); // far more than 4 units can serve in 20 minutes
  e.advanceTo(240);
  const g = e.ledger();
  assert.ok(g.released > 0); assert.equal(g.conservationError, 0); assert.equal(g.waiting, 0);
  assert.equal([...l.released.values()].reduce((a, b) => a + b, 0), g.released);
  assert.equal(g.accepted, g.completed + g.released);
  for (const w of e.waits) assert.ok(w <= TAXI_MAX_WAIT_MIN);
});
test('road edit mid-trip strands a taxi without losing riders; repair resumes', () => {
  const c = grid(); const net = buildNetwork(c), l = new Ledger(), e = new TaxiEngine(net, free(net), [depot], 0, { lease: l, width: S });
  e.submit([{ id: 'x', from: at(1, 2), to: at(20, 10), persons: 5, minute: 0 }]);
  e.advanceTo(5);
  for (const n of [at(20, 9), at(19, 10)]) setRoadJunction(c, at(20, 10), n, false); // isolate destination
  const cut = buildNetwork(c); e.setNetwork(cut, free(cut)); e.advanceTo(60);
  assert.ok(e.units.some(u => u.state === 'stranded')); assert.equal(e.ledger().assigned, 5); assert.equal(e.ledger().conservationError, 0);
  for (const n of [at(20, 9), at(19, 10)]) setRoadJunction(c, at(20, 10), n, true);
  const fixed = buildNetwork(c); e.setNetwork(fixed, free(fixed)); e.advanceTo(200);
  assert.equal(e.ledger().completed, 5); assert.equal(l.completed.get('x'), 5);
});
const legal = (net: LinkNetwork, path: number[]) => { for (let i = 1; i < path.length; i++) assert.ok((net.out.get(path[i - 1]) ?? []).some(l => l.to === path[i]), `illegal step ${path[i - 1]}->${path[i]}`); };
test('RRT roaming is deterministic per (seed, taxi, period) and bounded', () => {
  const net = buildNetwork(grid()), t = free(net), o = { seed: 42, taxiId: 'taxi-1-0', period: 8, width: S, weight: (c: number) => (c === at(10, 6) ? 5 : 0), demandCells: [at(10, 6)] };
  const a = planRoam(net, t, at(0, 2), o); assert.deepEqual(planRoam(net, t, at(0, 2), o), a);
  assert.ok(a.expanded <= 48 && a.minutes <= 15 + 1e-9);
  const others = [1, 2, 3, 4, 5].map(seed => planRoam(net, t, at(0, 6), { ...o, seed, weight: () => 1, demandCells: [] }).path.join());
  assert.ok(new Set(others).size > 1, 'different seeds explore differently');
});
test('RRT roaming only uses legal links (one-way respected)', () => {
  const c = blank(); draw(c, row(2, 0, 12), true); draw(c, row(4, 0, 12)); draw(c, col(0, 2, 4)); draw(c, col(12, 2, 4));
  const net = buildNetwork(c), t = free(net);
  for (let seed = 0; seed < 20; seed++) {
    const p = planRoam(net, t, at(6, 2), { seed, taxiId: 'u', period: 1, width: S, weight: x => (x === at(3, 2) ? 9 : 1), demandCells: [at(3, 2)] });
    legal(net, p.path); assert.ok(!p.path.includes(at(5, 2)), 'never drives west on the eastbound one-way');
  }
});
test('roaming is biased toward expected demand', () => {
  const net = buildNetwork(grid()), hot = at(20, 6);
  const mk = (expected?: (c: number) => number) => { const e = new TaxiEngine(net, free(net), [depot], 8 * 60, { width: S, seed: 3, expected }); e.advanceTo(8 * 60 + 60); return e; };
  const dist = (e: TaxiEngine) => e.units.reduce((n, u) => n + Math.abs((u.target ?? u.cell) % S - 20) + Math.abs(Math.floor((u.target ?? u.cell) / S) - 6), 0);
  const biased = mk(c => (c === hot ? 10 : 0.01)), flat = mk(() => 1);
  assert.ok(dist(biased) < dist(flat), `${dist(biased)} < ${dist(flat)}`);
  for (const l of biased.legs) { assert.ok(!l.loaded); legal(net, l.path); }
  assert.ok(biased.totals.roamLegs > 0 && biased.totals.roamMinutes > 0);
});
test('no stands; depot is home: no demand or night → taxis go home and stay', () => {
  assert.ok(!Object.keys(dispatchApi).some(k => /stand/i.test(k)));
  const net = buildNetwork(grid()), idle = new TaxiEngine(net, free(net), [depot], 0, { width: S });
  idle.advanceTo(24 * 60); assert.equal(idle.legs.length, 0);
  const e = new TaxiEngine(net, free(net), [depot], 20 * 60, { width: S, expected: c => (c === at(10, 6) ? 10 : 0.01) });
  e.advanceTo(23 * 60 + 30); assert.ok(e.totals.roamLegs > 0);
  e.advanceTo(26 * 60); for (const u of e.units) assert.equal(u.cell, depot.cell);
  const n = e.legs.length; e.advanceTo(28 * 60); assert.equal(e.legs.length, n);
});
test('taxis pick up locally: a nearby free taxi takes the request on its own', () => {
  const c = grid(); draw(c, row(14, 0, 23)); draw(c, col(23, 2, 14)); draw(c, row(2, 20, 23));
  const net = buildNetwork(c), l = new Ledger(), e = new TaxiEngine(net, free(net), [depot], 0, { lease: l, width: S });
  e.submit([{ id: 'near', from: at(3, 2), to: at(10, 10), persons: 2, minute: 0 }]);
  e.advanceTo(60); assert.equal(e.ledger().completed, 2);
});
test('legs carry routed paths, loaded and empty, for road loading later', () => {
  const net = buildNetwork(grid()), e = new TaxiEngine(net, free(net), [depot], 0, { width: S });
  e.submit(reqs(3)); e.advanceTo(120);
  assert.ok(e.legs.some(l => l.loaded) && e.legs.some(l => !l.loaded));
  for (const l of e.legs) { assert.equal(l.path[0], l.from); assert.equal(l.path.at(-1), l.to); }
});

const hotspot = (c: number) => (c === at(10, 6) ? 10 : 0.01);
test('uniform demand: idle taxis park instead of roaming (gain threshold)', () => {
  assert.ok(TAXI_ROAM_GAIN > 1);
  const net = buildNetwork(grid()), e = new TaxiEngine(net, free(net), [depot], 8 * 60, { width: S, expected: () => 1 });
  e.advanceTo(12 * 60); assert.equal(e.totals.roamLegs, 0); assert.equal(e.legs.length, 0); assert.ok(e.totals.parked > 0);
  const h = new TaxiEngine(net, free(net), [depot], 8 * 60, { width: S, expected: hotspot }); h.advanceTo(12 * 60); assert.ok(h.totals.roamLegs > 0);
});
test('map width is required', () => {
  const net = buildNetwork(grid());
  assert.throws(() => new TaxiEngine(net, free(net), [depot], 0, undefined as any), /width/);
  assert.throws(() => new TaxiEngine(net, free(net), [depot], 0, { width: 0 }), /width/);
});
test('a roaming taxi is interrupted mid-route and picks up from its current position', () => {
  const net = buildNetwork(grid()), times = linkTimes(net, new Map()), slow = new Map([...times].map(([k, v]) => [k, v * 5]));
  const e = new TaxiEngine(net, slow, [{ id: 1, cell: at(0, 2), level: 1, open: true }], 8 * 60, { width: S, expected: c => (c === at(10, 2) ? 10 : 0.01) });
  e.advanceTo(8 * 60 + 5);
  const u = e.units.find(x => x.state === 'roaming' && x.until > 8 * 60 + 10)!; assert.ok(u, 'some taxi roams a multi-link route');
  const leg = u.leg!, full = leg.path.length;
  const loadedStart = (en: TaxiEngine) => en.legs.find(l => l.loaded)?.from;
  const k = u.route ? (u.at as number[]).filter(m => m <= 8 * 60 + 10).length - 1 : -1; assert.ok(k >= 1 && k < full - 1, 'mid-route');
  const pos = u.route![k];
  e.submit([{ id: 'p', from: pos, to: at(20, 10), persons: 2, minute: 8 * 60 + 5 }]); e.advanceTo(8 * 60 + 10); // taxi is part-way along
  assert.equal(loadedStart(e), pos);
  assert.ok(e.totals.interrupted >= 1);
  assert.equal(leg.to, leg.path.at(-1)); assert.ok(leg.path.length < full, 'roam leg trimmed to the driven part');
  const loaded = e.legs.find(l => l.loaded && l.to === at(20, 10))!; assert.ok(loaded); assert.ok(e.units.some(x => x.job?.requestId === 'p'));
  assert.equal(e.ledger().conservationError, 0);
});
test('road edit: remaining route re-validated, taxi replans from where it is', () => {
  const c = grid(), net = buildNetwork(c), times = free(net), slow = new Map([...times].map(([k, v]) => [k, v * 20]));
  const e = new TaxiEngine(net, slow, [depot], 0, { width: S });
  e.submit([{ id: 'x', from: at(0, 2), to: at(20, 2), persons: 3, minute: 0 }]); e.advanceTo(10);
  const u = e.units.find(x => x.job)!; assert.equal(u.state, 'riding'); assert.ok(u.route!.includes(at(15, 2)));
  setRoadJunction(c, at(14, 2), at(15, 2), false); const cut = buildNetwork(c), cs = linkTimes(cut, new Map()); e.setNetwork(cut, new Map([...cs].map(([k, v]) => [k, v * 20])));
  assert.equal(e.totals.replans, 1);
  assert.ok(u.route![0] !== at(0, 2), 'replanned from the current cell, not the trip start'); assert.ok(!u.route!.includes(at(15, 2)) || u.route!.indexOf(at(15, 2)) < u.route!.indexOf(at(14, 2)) || !u.route!.includes(at(14, 2)));
  for (let i = 1; i < u.route!.length; i++) assert.ok(cut.links.has(`${u.route![i - 1]}>${u.route![i]}`));
  e.advanceTo(400); assert.equal(e.ledger().completed, 3); assert.equal(e.ledger().conservationError, 0);
});
test('stranded taxi resumes from its current position, not the trip start', () => {
  const c = grid(), net = buildNetwork(c), times = free(net), slow = new Map([...times].map(([k, v]) => [k, v * 20]));
  const e = new TaxiEngine(net, slow, [depot], 0, { width: S });
  e.submit([{ id: 'x', from: at(0, 2), to: at(20, 10), persons: 4, minute: 0 }]); e.advanceTo(10);
  for (const n of [at(20, 9), at(19, 10)]) setRoadJunction(c, at(20, 10), n, false);
  const cut = buildNetwork(c); e.setNetwork(cut, new Map([...linkTimes(cut, new Map())].map(([k, v]) => [k, v * 20])));
  const u = e.units.find(x => x.job)!; assert.equal(u.state, 'stranded'); assert.notEqual(u.cell, at(0, 2));
  const stoppedAt = u.cell;
  for (const n of [at(20, 9), at(19, 10)]) setRoadJunction(c, at(20, 10), n, true);
  const ok = buildNetwork(c); e.setNetwork(ok, new Map([...linkTimes(ok, new Map())].map(([k, v]) => [k, v * 20]))); e.advanceTo(15);
  assert.equal(u.route?.[0] ?? u.cell, stoppedAt); e.advanceTo(600); assert.equal(e.ledger().completed, 4);
});
test('dispatch uses the shared taxi site types', async () => {
  const shared = await import('../src/taxi/sites.ts'); assert.equal(DEPOT_UNITS, shared.TAXI_DEPOT_UNITS);
  const saved: import('../src/taxi/sites.ts').TaxiDepot = { id: 4, cell: at(0, 2), tick: 3, level: 2, open: true };
  const net = buildNetwork(grid()); assert.equal(new TaxiEngine(net, free(net), [saved], 0, { width: S }).units.length, 8);
});

test('anti-bunching: taxis from one depot spread over two hotspots, deterministically', () => {
  const net = buildNetwork(grid()), A = at(8, 2), B = at(0, 10), big = { ...depot, level: 2 as const };
  const two = (c: number) => (c === A ? 10 : c === B ? 8 : 0.01);
  const run = () => { const e = new TaxiEngine(net, free(net), [big], 8 * 60, { width: S, seed: 5, expected: two }); e.advanceTo(8 * 60 + 5); return e; };
  const e = run(), near = (c: number, h: number) => Math.abs(c % S - h % S) + Math.abs(Math.floor(c / S) - Math.floor(h / S)) <= TAXI_SPREAD_RADIUS;
  const goal = e.units.filter(u => u.state === 'roaming').map(u => u.target!);
  assert.ok(e.units.length >= 3 && goal.length >= 2, `roamers ${goal.length}`);
  const nA = goal.filter(c => near(c, A)).length, nB = goal.filter(c => near(c, B)).length;
  assert.ok(nA >= 2 && nB >= 2, `A ${nA} B ${nB}`); // demand 10:8 supports both (unspread: 7:1)
  const counts = new Map<number, number>(); for (const c of goal) counts.set(c, (counts.get(c) ?? 0) + 1);
  assert.ok(Math.max(...counts.values()) < goal.length, 'no single cell takes every roamer');
  for (const l of e.legs) legal(net, l.path);
  assert.deepEqual(run().units.map(u => [u.id, u.state, u.target, u.cell]), e.units.map(u => [u.id, u.state, u.target, u.cell]));
});
test('anti-bunching keeps uniform demand parked', () => {
  const net = buildNetwork(grid()), e = new TaxiEngine(net, free(net), [{ ...depot, level: 2 as const }], 8 * 60, { width: S, expected: () => 1 });
  e.advanceTo(12 * 60); assert.equal(e.totals.roamLegs, 0); assert.ok(e.totals.parked > 0);
});
