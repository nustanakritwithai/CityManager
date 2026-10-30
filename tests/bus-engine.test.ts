import test from 'node:test';
import assert from 'node:assert/strict';
import { configureRoadPath } from '../src/road-topology.ts';
import { buildNetwork } from '../src/traffic/network.ts';
import { createBus, removeStopsFromState } from '../src/bus/buildings.ts';
import { busLineRoutes, createBusLine, type BusHost } from '../src/bus/lines.ts';
import { BusEngine, busRideMinutes, type BusSubmission } from '../src/bus/engine.ts';
import { BUS_CAPACITY, BUS_DWELL_MIN, BUS_PCU } from '../src/bus/types.ts';
import { SIZE } from '../src/sim.ts';

const W = SIZE, at = (x: number, y: number) => y * W + x;
const row = (y: number, a: number, b: number) => Array.from({ length: b - a + 1 }, (_, k) => at(a + k, y));
const col = (x: number, a: number, b: number) => Array.from({ length: b - a + 1 }, (_, k) => at(x, a + k));
function host(busCount = 3, stopIds = [10, 11, 12]): BusHost {
  const c: BusHost = { cells: Array.from({ length: W * W }, () => ({ road: false })), nextId: 100 };
  const draw = (p: number[]) => { const f = new Set(p.filter(i => !c.cells[i].road)); for (const i of p) c.cells[i].road = true; configureRoadPath(c, p, f, false); };
  draw(row(2, 0, 20)); draw(row(10, 0, 20)); draw(col(0, 2, 10)); draw(col(20, 2, 10));
  c.bus = createBus();
  c.bus.depots.push({ id: 1, cell: at(5, 1), level: 1, open: true, tick: 0 });
  c.bus.stops.push({ id: 10, cell: at(4, 2), side: 'n', level: 1 }, { id: 11, cell: at(14, 2), side: 'n', level: 1 }, { id: 12, cell: at(20, 6), side: 'e', level: 1 }, { id: 13, cell: at(10, 10), side: 's', level: 1 });
  assert.ok(createBusLine(c, { depotId: 1, stopIds, busCount, busLevel: 1 }).ok);
  return c;
}
const LINE = 100;
const req = (id: string, from: number, to: number, persons: number): BusSubmission => ({ requestId: id, purpose: 'commute', from: 0, to: 0, persons, lineId: LINE, fromStopId: from, toStopId: to, fareSatang: 30 });
const conserved = (e: BusEngine) => assert.equal(e.ledger().conservationError, 0, JSON.stringify(e.ledger()));
/** Sample snapshots while advancing (renderer-style). */
function sample(e: BusEngine, from: number, to: number, dt = 0.125) { const tl: { m: number; s: ReturnType<BusEngine['snapshot']> }[] = []; for (let m = from; m <= to + 1e-9; m += dt) { e.advanceTo(m); tl.push({ m, s: e.snapshot(m) }); } return tl; }

test('full day: depart after 05:00, serve, everyone back home by night; people conserved', () => {
  const c = host(), released: [string, number, string][] = [], e = new BusEngine(c, 4 * 60, { release: (r, p, why) => released.push([r, p, why]) });
  assert.ok(e.snapshot().every(s => s.phase === 'home'));
  e.advanceTo(4 * 60 + 59); assert.ok(e.snapshot().every(s => s.phase === 'home'), 'no service before 05:00');
  e.advanceTo(6 * 60); e.submit([req('a', 10, 12, 25), req('b', 12, 10, 7), req('c', 11, 10, 3)]);
  e.advanceTo(12 * 60); conserved(e);
  assert.ok(e.totals.departures >= 3); assert.equal(e.totals.completed, 35); assert.equal(released.length, 0);
  e.advanceTo(23 * 60 + 2); e.submit([req('late', 10, 11, 4)]); // after service: released at once
  assert.deepEqual(released, [['late', 4, 'serviceEnd']]);
  e.advanceTo(24 * 60 + 60); assert.ok(e.snapshot().every(s => s.phase === 'home' && s.persons === 0), JSON.stringify(e.busesDetail()));
  conserved(e);
  e.advanceTo(29 * 60 + 30); assert.ok(e.snapshot().some(s => s.phase !== 'home'), 'next day service resumes');
});
test('headway spacing: bus k leaves k × headway after service start', () => {
  const c = host(3), [r] = busLineRoutes(c), e = new BusEngine(c, 4 * 60), first = new Map<string, number>();
  for (const { m, s } of sample(e, 5 * 60 - 1, 5 * 60 + 2 * r.headwayMinutes! + 2)) for (const b of s) if (b.phase !== 'home' && !first.has(b.id)) first.set(b.id, m);
  const t = [...first.entries()].sort().map(([, m]) => m);
  assert.equal(t.length, 3);
  for (let k = 0; k < 3; k++) assert.ok(Math.abs(t[k] - (5 * 60 + k * r.headwayMinutes!)) <= 0.125 + 1e-9, `${t} vs h=${r.headwayMinutes}`);
});
test('dwell: each stop call is BUS_DWELL_MIN; phases toStart → dwelling → running', () => {
  const e = new BusEngine(host(1), 5 * 60), tl = sample(e, 5 * 60, 6 * 60, 0.0625);
  const ph = tl.map(x => x.s[0].phase), seq = ph.filter((p, i) => p !== ph[i - 1]);
  assert.deepEqual(seq.slice(0, 4), ['toStart', 'dwelling', 'running', 'dwelling']);
  let run = 0; const spans: number[] = []; for (const p of ph) { if (p === 'dwelling') run++; else if (run) { spans.push(run * 0.0625); run = 0; } }
  assert.ok(spans.length >= 3 && spans.every(s => Math.abs(s - BUS_DWELL_MIN) <= 0.0625 + 1e-9), String(spans));
  const moving = tl.filter(x => x.s[0].phase === 'running' && x.s[0].progress > 0); assert.ok(moving.length > 0, 'progress for smooth rendering');
  assert.ok(Object.isFrozen(tl[0].s) && Object.isFrozen(tl[0].s[0]));
});
test('capacity cap and queue carry: 100 people, 40 seats per bus, rest wait for next bus', () => {
  const c = host(3), e = new BusEngine(c, 5 * 60, { maxWaitMinutes: 600 });
  e.submit([req('crowd', 10, 11, 100)], 5 * 60); e.advanceTo(9 * 60);
  const ev = e.drainEvents(), boards = ev.filter(x => x.kind === 'board' && x.stopId === 10);
  assert.ok(boards.every(x => x.persons <= BUS_CAPACITY[1])); assert.equal(boards[0].persons, 40);
  assert.equal(boards.reduce((n, x) => n + x.persons, 0), 100); assert.ok(boards.length >= 3);
  assert.equal(ev.filter(x => x.kind === 'alight' && x.stopId === 11).reduce((n, x) => n + x.persons, 0), 100);
  assert.ok(new Set(boards.slice(0, 3).map(x => x.busId)).size >= 2, 'carried riders board later buses');
  conserved(e);
});
test('direction: a bus heading away does not take riders for stops behind it', () => {
  const e = new BusEngine(host(1), 5 * 60, { maxWaitMinutes: 600 });
  e.submit([req('back', 11, 10, 5), req('fwd', 11, 12, 5)], 5 * 60); e.advanceTo(8 * 60);
  const ev = e.drainEvents(), firstAt11 = ev.find(x => x.kind === 'board' && x.stopId === 11)!;
  assert.equal(firstAt11.persons, 5, 'outbound call boards only the forward riders'); conserved(e);
  assert.equal(e.totals.completed, 10, 'return trip takes the others');
});
test('timeouts and service end release to cars via the hook (counted, nobody lost)', () => {
  const rel: [string, number, string][] = [], e = new BusEngine(host(0), 5 * 60, { maxWaitMinutes: 10, release: (a, b, c) => rel.push([a, b, c]) });
  e.submit([req('x', 10, 11, 3)], 6 * 60); assert.deepEqual(rel, [['x', 3, 'suspended']], 'no buses → suspended line');
  const f = new BusEngine(host(1), 5 * 60, { maxWaitMinutes: 2, release: (a, b, c) => rel.push([a, b, c]) });
  f.submit([req('slow', 12, 10, 2)], 5 * 60); f.advanceTo(5 * 60 + 30); assert.ok(rel.some(x => x[0] === 'slow' && x[2] === 'timeout')); conserved(f);
  const g = new BusEngine(host(1), 22 * 60 + 59, { maxWaitMinutes: 600, release: (a, b, c) => rel.push([a, b, c]) });
  g.submit([req("n", 12, 10, 2)], 22 * 60 + 59); g.advanceTo(23 * 60 + 1); assert.ok(rel.some(x => x[0] === 'n' && x[2] === 'serviceEnd')); conserved(g);
  assert.equal(g.totals.releasedBy.serviceEnd, 2);
});
test('night: buses stop boarding at 23:00, drop riders off, then return home', () => {
  const e = new BusEngine(host(2), 22 * 60, { maxWaitMinutes: 600 });
  e.submit([req('r', 10, 12, 30)], 22 * 60); e.advanceTo(23 * 60);
  const aboard = e.snapshot().reduce((n, s) => n + s.persons, 0);
  e.advanceTo(24 * 60 + 30);
  assert.ok(e.snapshot().every(s => s.phase === 'home' && s.persons === 0)); conserved(e);
  assert.ok(e.totals.completed >= aboard, 'riders aboard at 23:00 still delivered');
  assert.ok(!e.drainEvents().some(x => x.kind === 'board' && x.minute >= 23 * 60));
});
test('suspension: line drops below 2 stops → buses park, riders released as suspended', () => {
  const c = host(2, [10, 11]), rel: string[] = [], e = new BusEngine(c, 5 * 60, { release: (_a, _b, why) => rel.push(why) });
  e.submit([req('s', 10, 11, 5)], 5 * 60); e.advanceTo(5 * 60 + 3);
  removeStopsFromState(c.bus!, new Set([11])); e.advanceTo(5 * 60 + 60);
  assert.equal(busLineRoutes(c)[0].status, 'suspended');
  assert.ok(e.snapshot().every(s => s.phase === 'home' && s.persons === 0), JSON.stringify(e.busesDetail())); conserved(e);
  assert.ok(rel.includes('suspended') || e.totals.completed === 5);
});
test('replan after a road cut: moving bus continues from its current cell on legal links', () => {
  const c = host(1), e = new BusEngine(c, 5 * 60);
  let m = 5 * 60; for (; m < 6 * 60; m += 0.25) { e.advanceTo(m); const s = e.snapshot(m)[0]; if (s.phase === 'running' && s.cell > at(5, 2) && s.cell < at(9, 2)) break; }
  const before = e.snapshot(m)[0]; assert.equal(before.phase, 'running');
  c.cells[at(10, 2)].road = false; // ahead on the top road
  e.advanceTo(m); e.refresh(m);
  const after = e.snapshot(m)[0]; assert.equal(after.cell, before.cell, 'position continuity'); assert.ok(e.totals.replans >= 1);
  const net = buildNetwork(c); let prev = after.cell;
  for (let t = m; t < m + 60; t += 0.02) { e.advanceTo(t); const s = e.snapshot(t)[0]; if (s.cell !== prev) { assert.ok(net.links.has(`${prev}>${s.cell}`) || s.phase === 'home' || s.phase === 'dwelling', `${prev}>${s.cell}`); prev = s.cell; } assert.notEqual(s.cell, at(10, 2)); }
});
test('deterministic: identical runs give identical events and snapshots', () => {
  const run = () => { const e = new BusEngine(host(3), 4 * 60, { maxWaitMinutes: 20 }); e.advanceTo(6 * 60); e.submit([req('a', 10, 12, 50), req('b', 12, 11, 9)]); const tl = sample(e, 6 * 60, 9 * 60, 0.5); return { ev: e.drainEvents(), tl: tl.map(x => x.s), l: e.ledger() }; };
  assert.deepEqual(run(), run());
});
test('event drain: events accumulate across frames and are returned once', () => {
  const e = new BusEngine(host(1), 5 * 60); e.submit([req('a', 10, 11, 4)], 5 * 60);
  for (let m = 5 * 60; m < 6 * 60; m += 0.1) e.advanceTo(m);
  const n = e.pendingEvents; assert.ok(n >= 2);
  const ev = e.drainEvents(); assert.equal(ev.length, n); assert.deepEqual(e.drainEvents(), []); assert.equal(e.pendingEvents, 0);
  assert.deepEqual(ev.map(x => x.kind), ['board', 'alight']); assert.ok(ev.every(x => Object.isFrozen(x)));
});
test('road load hook: PCU per occupied link while moving', () => {
  const e = new BusEngine(host(1), 5 * 60); let m = 5 * 60; while (e.snapshot(m)[0].phase !== 'running' || e.snapshot(m)[0].progress === 0) { m += 0.05; e.advanceTo(m); }
  const load = e.roadLoad(m); assert.ok([...load.values()].every(v => v === BUS_PCU) && load.size === 1);
});
test('loop lines run forward only; ride minutes follow the real direction', () => {
  const c = host(1, [10, 11, 13, 10]), [r] = busLineRoutes(c), ids = c.bus!.lines[0].stopIds;
  assert.equal(r.loop, true);
  const fwd = busRideMinutes(r, ids, 10, 11)!, wrap = busRideMinutes(r, ids, 11, 10)!;
  assert.ok(fwd > 0 && wrap > fwd, 'reverse pair rides the rest of the loop');
  const e = new BusEngine(c, 5 * 60, { maxWaitMinutes: 600 }); e.submit([req('w', 11, 10, 3)], 5 * 60); e.advanceTo(7 * 60); conserved(e);
  assert.equal(e.totals.completed, 3);
  const nl = busLineRoutes(host(1))[0]; assert.ok(busRideMinutes(nl, [10, 11, 12], 12, 10)! > 0 && busRideMinutes(nl, [10, 11, 12], 10, 99) === null);
});
