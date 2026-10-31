import test from 'node:test';
import assert from 'node:assert/strict';
import { configureRoadPath } from '../src/road-topology.ts';
import { createBus } from '../src/bus/buildings.ts';
import { createBusLine, type BusHost } from '../src/bus/lines.ts';
import { BusEngine, type BusSubmission } from '../src/bus/engine.ts';
import { fixtureBusSnapshots } from '../src/bus/fixture.ts';
import { BUS_BODY, BUS_CROWD_CAP, BUS_HOME_PITCH, BUS_KERB, BUS_LANE_OFFSET, busLevelForCapacity, cellCenter } from '../src/bus/geometry.ts';
import { busLineCaption, busOverlay } from '../src/bus/overlay.ts';
import { busPoses, writeBusMatrix, writeLoadMatrix } from '../src/bus/poses.ts';
import { EMPTY_BUS_DRAW, busDrawList, busInstanceCounts } from '../src/bus/draw-list.ts';
import { BusEventFanout, busEngineFrom, presentBuses, subscribeBusEvents, type BusLayerLike } from '../src/bus/frame.ts';
import { BUS_CAPACITY, type BusEvent } from '../src/bus/types.ts';
import { SIZE } from '../src/sim.ts';

const W = SIZE, at = (x: number, y: number) => y * W + x;
const row = (y: number, a: number, b: number) => Array.from({ length: b - a + 1 }, (_, k) => at(a + k, y));
const col = (x: number, a: number, b: number) => Array.from({ length: b - a + 1 }, (_, k) => at(x, a + k));
function host(busCount = 2): BusHost {
  const c: BusHost = { cells: Array.from({ length: W * W }, () => ({ road: false })), nextId: 100 };
  const draw = (p: number[]) => { const fresh = new Set(p.filter(i => !c.cells[i]!.road)); for (const i of p) c.cells[i]!.road = true; configureRoadPath(c, p, fresh, false); };
  draw(row(2, 0, 20)); draw(row(10, 0, 20)); draw(col(0, 2, 10)); draw(col(20, 2, 10));
  c.bus = createBus();
  c.bus.depots.push({ id: 1, cell: at(5, 1), level: 2, open: true, tick: 0 });
  c.bus.stops.push(
    { id: 10, cell: at(4, 2), side: 'n', level: 1 },
    { id: 11, cell: at(14, 2), side: 'n', level: 2 },
    { id: 12, cell: at(20, 6), side: 'e', level: 1 },
  );
  assert.ok(createBusLine(c, { depotId: 1, stopIds: [10, 11, 12], busCount, busLevel: 1 }).ok);
  return c;
}
const req = (id: string, from: number, to: number, persons: number): BusSubmission => ({
  requestId: id, purpose: 'commute', from: 0, to: 0, persons, lineId: 100, fromStopId: from, toStopId: to, fareSatang: 30,
});
const bare = (): BusHost => ({ cells: Array.from({ length: W * W }, () => ({ road: false })), nextId: 1 });

test('trafficLayer.bus null or undefined draws nothing and does not drain', () => {
  const fan = new BusEventFanout();
  let calls = 0;
  fan.subscribe(() => { calls++; });
  const broken = undefined as never;
  const sources: BusLayerLike[] = [undefined, null, {}, { bus: null }, { bus: undefined }, { bus: { engine: null } }, { bus: { engine: undefined } }];
  for (const source of sources) {
    const frame = presentBuses(source, broken, fan);
    assert.equal(frame.drew, false);
    assert.deepEqual(frame.events, []);
    assert.equal(frame.draw, EMPTY_BUS_DRAW);
    assert.equal(busEngineFrom(source), null);
  }
  assert.equal(calls, 0, 'subscribers are not called when there is no engine');
  // A city that does have lines still contributes nothing while bus is undefined.
  const city = host();
  assert.ok(busOverlay(city).lines[0]!.segments.length > 0);
  const hidden = presentBuses({ bus: undefined }, city, fan);
  assert.equal(hidden.drew, false);
  assert.equal(hidden.draw.lines.length, 0);
  assert.equal(hidden.draw.stops.length, 0);
  assert.equal(hidden.draw.buses.length, 0);
  assert.equal(busInstanceCounts(hidden.draw).total, 0);
});

test('fixture poses: interpolate, face next, levels 40/60/80, load, dwell kerb, parked spread', () => {
  assert.equal(busLevelForCapacity(BUS_CAPACITY[1]), 1);
  assert.equal(busLevelForCapacity(BUS_CAPACITY[2]), 2);
  assert.equal(busLevelForCapacity(BUS_CAPACITY[3]), 3);
  const poses = busPoses(fixtureBusSnapshots(), { stops: [{ cell: 50, side: 'n' }], detail: [{ id: 'fix-l1', returning: true }] });
  assert.equal(poses.length, 6);
  const l1 = poses.find(p => p.id === 'fix-l1')!, from = cellCenter(0), to = cellCenter(1);
  assert.equal(l1.level, 1); assert.equal(l1.paint, 0); assert.equal(l1.length, BUS_BODY[1].length);
  assert.equal(l1.headingX, 1); assert.equal(l1.headingZ, 0); assert.equal(l1.returning, true);
  assert.ok(Math.abs(l1.x - (from.x + (to.x - from.x) * 0.25)) < 1e-9);
  assert.ok(Math.abs(l1.z - (from.z - BUS_LANE_OFFSET)) < 1e-9, 'eastbound sits on the north side');
  assert.equal(l1.load, 10 / 40);
  const l2 = poses.find(p => p.id === 'fix-l2')!, l3 = poses.find(p => p.id === 'fix-l3')!;
  assert.equal(l2.level, 2); assert.equal(l2.paint, 1); assert.equal(l2.headingZ, 1); assert.equal(l2.load, 0.5);
  assert.equal(l3.level, 3); assert.equal(l3.paint, 2); assert.ok(l1.length < l2.length && l2.length < l3.length);
  const dwell = cellCenter(50);
  assert.equal(l3.phase, 'dwelling'); assert.equal(l3.x, dwell.x); assert.ok(Math.abs(l3.z - (dwell.z - BUS_KERB)) < 1e-9);
  assert.equal(l3.headingX, 1); assert.equal(l3.load, 0.5);
  const homes = poses.filter(p => p.phase === 'home').sort((a, b) => (a.id < b.id ? -1 : 1));
  const yard = cellCenter(10);
  assert.equal(homes.length, 2);
  assert.ok(Math.abs((homes[0]!.x + homes[1]!.x) / 2 - yard.x) < 1e-9);
  assert.ok(Math.abs(homes[1]!.x - homes[0]!.x - BUS_HOME_PITCH) < 1e-9);
  const start = poses.find(p => p.id === 'fix-start')!;
  assert.equal(start.phase, 'toStart'); assert.equal(start.headingX, 1); assert.equal(start.progress, 0);
  const draw = busDrawList(bare(), fixtureBusSnapshots(), [], () => 0);
  const counts = busInstanceCounts(draw);
  assert.equal(counts.buses, 6);
  assert.deepEqual(counts.byLevel, { 1: 4, 2: 1, 3: 1 });
  assert.equal(counts.loads, 3); assert.equal(counts.dwelling, 1); assert.equal(counts.total, 10);
  const matrix = new Float32Array(16);
  writeBusMatrix(matrix, 0, l1);
  assert.ok(Math.abs(matrix[8]! / l1.length - 1) < 1e-6, 'local +Z points along the heading');
  assert.ok(Math.abs(matrix[10]!) < 1e-6);
  assert.ok(Math.abs(matrix[12]! - l1.x) < 1e-6 && Math.abs(matrix[13]! - l1.y) < 1e-6 && Math.abs(matrix[14]! - l1.z) < 1e-6);
  writeLoadMatrix(matrix, 0, l1);
  assert.ok(Math.abs(matrix[8]! - l1.length * l1.load) < 1e-6, 'roof bar scales with persons/capacity');
});

test('rejects duplicate ids and impossible snapshot fields', () => {
  const [one] = fixtureBusSnapshots();
  assert.ok(one);
  assert.throws(() => busPoses([one, one]), /duplicate/);
  assert.throws(() => busPoses([{ ...one, progress: Number.NaN }]), /progress/);
  assert.throws(() => busPoses([{ ...one, progress: 2 }]), /progress/);
  assert.throws(() => busPoses([{ ...one, cell: -1 }]), /cell/);
  assert.throws(() => busPoses([{ ...one, persons: -1 }]), /load/);
  assert.throws(() => busPoses([{ ...one, phase: 'fly' as never }]), /phase/);
  assert.equal(busPoses([{ ...one, id: 'full', persons: 999, capacity: 40 }])[0]!.load, 1);
});

test('line overlay: polyline, headway, pole vs shelter, paused reason is dashed', () => {
  const city = host();
  const running = busOverlay(city).lines[0]!;
  assert.equal(running.paused, false); assert.equal(running.status, 'running'); assert.equal(running.reason, undefined);
  assert.equal(typeof running.headwayMinutes, 'number'); assert.ok(running.headwayMinutes! > 0);
  assert.match(running.caption, /ทุก .* นาที/);
  assert.equal(busLineCaption(running), running.caption);
  for (let i = 1; i < running.polyline.length; i++) {
    const a = running.polyline[i - 1]!, b = running.polyline[i]!;
    if (a === b) continue;
    assert.ok(running.segments.some(seg => seg.from === a && seg.to === b && !seg.paused), `polyline hop ${a}->${b}`);
  }
  assert.ok(running.segments.some(seg => seg.spur), 'depot spur is drawn');
  assert.ok(running.segments.every(seg => seg.length > 1));
  const stops = busOverlay(city).stops;
  const pole = stops.find(s => s.id === 10)!, shelter = stops.find(s => s.id === 11)!;
  assert.equal(pole.kind, 'pole'); assert.equal(shelter.kind, 'shelter');
  assert.ok(shelter.sx > pole.sx);
  const centre = cellCenter(pole.cell);
  assert.ok(pole.z < centre.z, 'north kerb'); assert.equal(pole.headingZ, 1);
  const east = stops.find(s => s.id === 12)!;
  assert.ok(east.x > cellCenter(east.cell).x); assert.equal(east.headingX, -1);
  const openDepot = busOverlay(city).depots[0]!;
  assert.equal(openDepot.open, true); assert.equal(openDepot.level, 2); assert.ok(openDepot.sy > 0.42);
  city.bus!.depots[0]!.open = false;
  const paused = busOverlay(city).lines[0]!;
  assert.equal(paused.paused, true); assert.equal(paused.status, 'suspended'); assert.equal(paused.reason, 'depotClosed');
  assert.equal(paused.headwayMinutes, null); assert.match(paused.caption, /หยุดวิ่ง · อู่ปิด/);
  assert.ok(paused.segments.length > running.segments.length, 'paused lines are dashed');
  assert.ok(paused.segments.every(seg => seg.paused && seg.length < BUS_MAP_HOP));
  const closed = busOverlay(city).depots[0]!;
  assert.equal(closed.open, false); assert.ok(closed.sy < openDepot.sy);
  const draw = busDrawList(city, [], [], id => (id === 10 ? 20 : 0));
  assert.equal(draw.stops.find(s => s.id === 10)!.waiting, 20);
  assert.equal(draw.crowds.filter(c => c.stopId === 10).length, BUS_CROWD_CAP);
  assert.equal(draw.crowds.filter(c => c.stopId === 11).length, 0);
  const counts = busInstanceCounts(draw);
  assert.equal(counts.poles, 2); assert.equal(counts.shelters, 1); assert.equal(counts.depots, 1);
  assert.equal(counts.crowds, BUS_CROWD_CAP); assert.ok(counts.lineSegments > 0);
});
const BUS_MAP_HOP = 2;

test('presentBuses drains the wired engine once and does not advance it', () => {
  const city = host(1), engine = new BusEngine(city, 4 * 60), fan = new BusEventFanout();
  const now = engine.now;
  const idle = presentBuses({ bus: { engine } }, city, fan);
  assert.equal(idle.drew, true);
  assert.equal(engine.now, now, 'renderer must not tick the engine');
  assert.equal(engine.drainEvents().length, 0);
  assert.ok(idle.draw.depots.length === 1 && idle.draw.stops.length === 3);
  assert.equal(engine.pendingEvents, 0);
  engine.submit([req('p', 10, 11, 4)], 6 * 60);
  engine.advanceTo(9 * 60);
  const batches: BusEvent[][] = [];
  fan.subscribe(events => batches.push(events));
  const frame = presentBuses({ bus: { engine } }, city, fan);
  assert.equal(batches.length, 1);
  assert.equal(batches[0], frame.events);
  assert.ok(frame.events.some(event => event.kind === 'board' || event.kind === 'alight'));
  assert.equal(engine.pendingEvents, 0);
  assert.equal(engine.drainEvents().length, 0, 'the renderer already drained this frame');
  batches.length = 0;
  presentBuses({ bus: { engine } }, city, fan);
  assert.equal(batches.length, 1); assert.deepEqual(batches[0], []);
});

test('engine snapshots place a moving bus between cells and a dwelling bus on the kerb', () => {
  const city = host(1), engine = new BusEngine(city, 5 * 60);
  let moving: ReturnType<BusEngine['snapshot']>[number] | null = null;
  for (let minute = 5 * 60; minute < 5 * 60 + 40 && !moving; minute += 0.25) {
    engine.advanceTo(minute);
    moving = engine.snapshot().find(bus => bus.cell !== bus.next && bus.progress > 0 && bus.progress < 1) ?? null;
  }
  assert.ok(moving, 'expected a bus mid-link');
  const frame = presentBuses({ bus: { engine } }, city, new BusEventFanout());
  const pose = frame.draw.buses.find(bus => bus.id === moving.id)!;
  const from = cellCenter(moving.cell), toward = cellCenter(moving.next);
  const dx = toward.x - from.x, dz = toward.z - from.z, span = Math.hypot(dx, dz);
  assert.ok(Math.abs(pose.x - (from.x + dx * moving.progress + dz / span * BUS_LANE_OFFSET)) < 1e-6);
  assert.ok(Math.abs(pose.z - (from.z + dz * moving.progress - dx / span * BUS_LANE_OFFSET)) < 1e-6);
  assert.ok(Math.abs(pose.headingX - dx / span) < 1e-6 && Math.abs(pose.headingZ - dz / span) < 1e-6);
  assert.equal(pose.capacity, BUS_CAPACITY[1]); assert.equal(pose.level, 1);
  const parked = new BusEngine(city, 5 * 60);
  let dwell: ReturnType<BusEngine['snapshot']>[number] | null = null;
  for (let minute = 5 * 60; minute < 6 * 60 && !dwell; minute += 0.25) {
    parked.advanceTo(minute);
    dwell = parked.snapshot().find(bus => bus.phase === 'dwelling') ?? null;
  }
  assert.ok(dwell); assert.equal(dwell.cell, dwell.next); assert.equal(dwell.progress, 0);
  const shown = presentBuses({ bus: { engine: parked } }, city, new BusEventFanout());
  const atStop = shown.draw.buses.find(bus => bus.id === dwell.id)!;
  const stop = city.bus!.stops.find(item => item.cell === dwell.cell)!;
  assert.equal(atStop.phase, 'dwelling');
  assert.ok(shown.draw.dwelling.some(bus => bus.id === dwell.id));
  if (stop.side === 'n' || stop.side === 's') assert.ok(Math.abs(Math.abs(atStop.z - cellCenter(stop.cell).z) - BUS_KERB) < 1e-6);
  else assert.ok(Math.abs(Math.abs(atStop.x - cellCenter(stop.cell).x) - BUS_KERB) < 1e-6);
});

test('subscribeBusEvents is the UI hook and survives a throwing subscriber', () => {
  const city = host(1), engine = new BusEngine(city, 5 * 60);
  engine.submit([req('q', 10, 12, 2)], 5 * 60);
  engine.advanceTo(9 * 60);
  let seen = 0;
  const unsub = subscribeBusEvents(events => { seen += events.length; });
  const noisy = subscribeBusEvents(() => { throw new Error('ui failed'); });
  try {
    const frame = presentBuses({ bus: { engine } }, city);
    assert.ok(frame.events.length > 0); assert.equal(seen, frame.events.length);
    assert.equal(engine.drainEvents().length, 0);
  } finally { unsub(); noisy(); }
});
