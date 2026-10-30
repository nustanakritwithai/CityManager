import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNetwork, type LinkNetwork } from '../src/traffic/network.ts';
import { linkTimes } from '../src/traffic/routing.ts';
import { configureRoadPath, setRoadJunction, type RoadMap } from '../src/road-topology.ts';
import { dispatchZones, travelTree, treeMinutes, TAXI_DISPATCH_MINUTES } from '../src/taxi/coverage.ts';
import { TaxiEngine, TAXI_MAX_WAIT_MIN, DEPOT_UNITS, type TaxiLeaseAdapter, type TaxiRequest } from '../src/taxi/dispatch.ts';

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
  const e = new TaxiEngine(net, free(net), [depot], [], 0, l);
  const r = e.submit([{ id: 'far', from: at(1, 20), to: at(3, 20), persons: 4, minute: 0 }]);
  assert.deepEqual(r.rejected, ['far']); assert.equal(l.reserved.size, 0);
});
test('deterministic nearest-ETA assignment and people conserved every quantum', () => {
  const run = () => {
    const net = buildNetwork(grid()), l = new Ledger(), e = new TaxiEngine(net, free(net), [depot, { id: 2, cell: at(20, 10), level: 2, open: true }], [{ id: 9, cell: at(10, 6), open: true }], 0, l);
    e.submit(reqs(12));
    for (let m = 0; m <= 180; m += 5) { e.advanceTo(m); assert.equal(e.ledger().conservationError, 0); l.check(); }
    return { d: e.diagnostics(), legs: e.legs };
  };
  const a = run(); assert.deepEqual(run(), a);
  assert.equal(a.d.units, DEPOT_UNITS[1] + DEPOT_UNITS[2]);
  assert.ok(a.d.completed > 0);
});
test('wait over the max returns people to private cars (never dropped)', () => {
  const net = buildNetwork(grid()), l = new Ledger(), e = new TaxiEngine(net, free(net), [depot], [], 0, l);
  e.submit(reqs(40)); // far more than 4 units can serve in 20 minutes
  e.advanceTo(240);
  const g = e.ledger();
  assert.ok(g.released > 0); assert.equal(g.conservationError, 0); assert.equal(g.waiting, 0);
  assert.equal([...l.released.values()].reduce((a, b) => a + b, 0), g.released);
  assert.equal(g.accepted, g.completed + g.released);
  for (const w of e.waits) assert.ok(w <= TAXI_MAX_WAIT_MIN);
});
test('road edit mid-trip strands a taxi without losing riders; repair resumes', () => {
  const c = grid(); const net = buildNetwork(c), l = new Ledger(), e = new TaxiEngine(net, free(net), [depot], [], 0, l);
  e.submit([{ id: 'x', from: at(1, 2), to: at(20, 10), persons: 5, minute: 0 }]);
  e.advanceTo(5);
  for (const n of [at(20, 9), at(19, 10)]) setRoadJunction(c, at(20, 10), n, false); // isolate destination
  const cut = buildNetwork(c); e.setNetwork(cut, free(cut)); e.advanceTo(60);
  assert.ok(e.units.some(u => u.state === 'stranded')); assert.equal(e.ledger().assigned, 5); assert.equal(e.ledger().conservationError, 0);
  for (const n of [at(20, 9), at(19, 10)]) setRoadJunction(c, at(20, 10), n, true);
  const fixed = buildNetwork(c); e.setNetwork(fixed, free(fixed)); e.advanceTo(200);
  assert.equal(e.ledger().completed, 5); assert.equal(l.completed.get('x'), 5);
});
test('idle taxis never cruise: no legs without requests or stands', () => {
  const net = buildNetwork(grid()), e = new TaxiEngine(net, free(net), [depot], [], 0);
  e.advanceTo(24 * 60); assert.equal(e.legs.length, 0);
  const withStand = new TaxiEngine(net, free(net), [depot], [{ id: 5, cell: at(10, 6), open: true }], 0);
  withStand.advanceTo(24 * 60); assert.equal(withStand.legs.length, 2); // fill the stand's 2 slots once, then stay
});
test('pause makes no progress; 1x vs 10x stepping gives identical totals', () => {
  const mk = () => { const net = buildNetwork(grid()), e = new TaxiEngine(net, free(net), [depot], [{ id: 9, cell: at(10, 6), open: true }], 0); e.submit(reqs(15)); return e; };
  const p = mk(); p.advanceTo(300, true); assert.equal(p.now, 0); assert.equal(p.legs.length, 0);
  const slow = mk(), fast = mk();
  for (let m = 0; m <= 600; m++) slow.advanceTo(m);
  for (let m = 0; m <= 600; m += 97) fast.advanceTo(m); fast.advanceTo(600);
  assert.deepEqual(fast.diagnostics(), slow.diagnostics()); assert.deepEqual(fast.legs, slow.legs);
});
test('legs carry routed paths, loaded and empty, for road loading later', () => {
  const net = buildNetwork(grid()), e = new TaxiEngine(net, free(net), [depot], [], 0);
  e.submit(reqs(3)); e.advanceTo(120);
  assert.ok(e.legs.some(l => l.loaded) && e.legs.some(l => !l.loaded));
  for (const l of e.legs) { assert.equal(l.path[0], l.from); assert.equal(l.path.at(-1), l.to); }
});
