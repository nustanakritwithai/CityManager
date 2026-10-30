import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { splitTaxiDemand } from '../src/taxi/mode-share.ts';
import { busAccess, busShare, splitModeDemand, type ModeCarry } from '../src/bus/mode-share.ts';
import * as bus from '../src/bus/types.ts';
import { demandForPeriods } from '../src/traffic/demand.ts';
import type { DemandInput, OdEntry } from '../src/traffic/types.ts';

const W = 24, at = (x: number, y: number) => y * W + x;
class Mem { m = new Map<string, string>(); getItem(k: string) { return this.m.get(k) ?? null; } setItem(k: string, v: string) { this.m.set(k, v); } removeItem(k: string) { this.m.delete(k); } }

test('constants match the design placeholders', () => {
  assert.equal(bus.BUS_ENABLED, true);
  assert.equal(bus.BUS_WALK_RADIUS, 4); assert.equal(bus.BUS_DWELL_MIN, 1);
  assert.deepEqual({ ...bus.BUS_SERVICE }, { from: 300, to: 1380 });
  assert.deepEqual({ ...bus.BUS_CAPACITY }, { 1: 40, 2: 60, 3: 80 });
  assert.deepEqual({ ...bus.BUS_DEPOT_BUSES }, { 1: 6, 2: 12, 3: 20 });
  assert.deepEqual({ ...bus.BUS_LIMITS }, { depots: 4, stops: 40, lines: 8 });
  assert.equal(bus.BUS_PCU, 2);
  assert.ok(!bus.BUS_PURPOSES.has('freight'));
  for (const o of [bus.BUS_SERVICE, bus.BUS_CAPACITY, bus.BUS_DEPOT_BUSES, bus.BUS_LIMITS]) assert.ok(Object.isFrozen(o));
});
test('flag: on by default, ?bus=1 remembered, ?bus=0 remembered opt-out, denied storage never throws', () => {
  const s = new Mem();
  assert.equal(bus.busEnabled('', s), true);
  assert.equal(bus.busEnabled('?bus=1', s), true); assert.equal(bus.busEnabled('', s), true);
  assert.equal(bus.busEnabled('?bus=0', s), false); assert.equal(bus.busEnabled('', s), false);
  const bad = { getItem() { throw Error('denied'); }, setItem() { throw Error('denied'); }, removeItem() { throw Error('denied'); } };
  assert.equal(bus.busEnabled('?bus=1', bad), true); assert.equal(bus.busEnabled('', bad), true);
  assert.equal(bus.busEnabled('?taxi=1', s), false); // still opted out from ?bus=0 above
});
test('flag has a single source: BUS_ENABLED is defined only in src/bus/types.ts', () => {
  const hits = readdirSync('src', { recursive: true }).map(String).filter(f => f.endsWith('.ts')).filter(f => /BUS_ENABLED\s*=/.test(readFileSync(`src/${f}`, 'utf8')));
  assert.deepEqual(hits.map(f => f.replace(/\\/g, '/')), ['bus/types.ts']);
});

const stops: bus.BusStop[] = [{ id: 1, cell: at(2, 2), side: 'n', level: 1 }, { id: 2, cell: at(12, 2), side: 'n', level: 1 }, { id: 3, cell: at(20, 20), side: 's', level: 1 }];
const lines: bus.BusLine[] = [{ id: 7, depotId: 1, stopIds: [1, 2], busCount: 2, busLevel: 1 }];
test('access: both ends within the walk radius of stops on one common line', () => {
  const a = busAccess(at(3, 4), at(12, 5), stops, lines, W)!;
  assert.deepEqual(a, { lineId: 7, fromStopId: 1, toStopId: 2, walkCells: 6, walkMinutes: 6 * bus.BUS_WALK_MIN_PER_CELL });
  assert.ok(busAccess(at(3, 4), at(12, 5), stops, lines, W)!.walkCells <= 2 * bus.BUS_WALK_RADIUS);
  assert.equal(busAccess(at(2, 7), at(12, 2), stops, lines, W), null, '5 cells away: out of radius');
  assert.equal(busAccess(at(2, 2), at(20, 20), stops, lines, W), null, 'stop 3 is on no line');
  assert.equal(busAccess(at(2, 2), at(3, 2), stops, lines, W), null, 'same stop both ends is not a bus trip');
  assert.equal(busAccess(at(2, 2), at(12, 2), stops, [{ ...lines[0], busCount: 0 }], W), null, 'line without buses');
  assert.throws(() => busAccess(0, 1, stops, lines, 0));
});
const car = 20, bc = (o: Partial<bus.BusOdCost> = {}): bus.BusOdCost => ({ lineId: 7, fromStopId: 1, toStopId: 2, walkMinutes: 5, waitMinutes: 5, rideMinutes: 12, seats: 1e6, ...o });
const taxiC = { carMinutes: car, taxiMinutes: 12, waitMinutes: 5, km: 3 };
test('bus share in [0, cap]; falls with walk/wait/fare, rises with car time; taxi competes', () => {
  for (const c of [0, 10, 60, 600]) for (const w of [0, 30, 300]) { const p = busShare(c, bc({ waitMinutes: w })); assert.ok(p >= 0 && p <= bus.BUS_AVAILABILITY_CAP); }
  assert.ok(busShare(car, bc({ walkMinutes: 2 })) > busShare(car, bc({ walkMinutes: 15 })));
  assert.ok(busShare(car, bc({ waitMinutes: 2 })) > busShare(car, bc({ waitMinutes: 20 })));
  assert.ok(busShare(car, bc({ fareSatang: 0 })) > busShare(car, bc({ fareSatang: 2_000 })));
  assert.ok(busShare(60, bc()) > busShare(10, bc()));
  assert.ok(busShare(car, bc(), taxiC) < busShare(car, bc()), 'adding taxi lowers bus share (MNL)');
  assert.equal(busShare(car, bc({ rideMinutes: Infinity })), 0); assert.equal(busShare(NaN, bc()), 0);
  assert.ok(Number.isFinite(busShare(1e6, bc())), 'no overflow on extreme utilities');
});
const od: OdEntry[] = [
  { purpose: 'commute', from: at(3, 4), to: at(12, 5), vehicles: 7 }, { purpose: 'school', from: at(2, 2), to: at(12, 2), vehicles: 3 },
  { purpose: 'park', from: at(20, 20), to: at(12, 2), vehicles: 2 }, { purpose: 'freight', from: at(2, 2), to: at(12, 2), vehicles: 9 }];
const busCost = (seats = 1e6) => (f: number, t: number) => { const a = busAccess(f, t, stops, lines, W); return a && bc({ walkMinutes: a.walkMinutes, seats }); };
const costs = (seats?: number, taxi = true) => ({ car: () => car, taxi: () => (taxi ? taxiC : null), bus: busCost(seats) });
test('3-way split conserves whole people per OD; freight never on bus or taxi', () => {
  const s = splitModeDemand(od, costs());
  assert.ok(s.busPersons > 0 && s.taxiPersons > 0);
  assert.equal(s.busPersons + s.taxiPersons + s.roadPersons.reduce((n, r) => n + r.persons, 0), s.offeredPersons);
  for (const e of od) {
    const k = (r: { purpose: string; from: number; to: number }) => r.purpose === e.purpose && r.from === e.from && r.to === e.to;
    const sum = [...s.bus, ...s.taxi, ...s.roadPersons].filter(k).reduce((n, r) => n + r.persons, 0);
    assert.equal(sum, e.vehicles * 10);
  }
  for (const m of [...s.bus, ...s.taxi]) { assert.ok(Number.isInteger(m.persons) && m.persons > 0); assert.notEqual(m.purpose, 'freight'); }
  assert.ok(!s.bus.some(b => b.from === at(20, 20)), 'no stop near origin → no bus');
  assert.ok(s.bus.every(b => b.lineId === 7 && b.fromStopId === 1 && b.toStopId === 2 && b.fareSatang === bus.BUS_FARE_SATANG));
});
test('no bus offered → taxi and road exactly as splitTaxiDemand (taxi semantics unchanged)', () => {
  const s = splitModeDemand(od, { car: () => car, taxi: () => taxiC, bus: () => null }), t = splitTaxiDemand(od, () => taxiC);
  assert.equal(s.busPersons, 0); assert.deepEqual(s.bus, []); assert.deepEqual(s.carry.bus, {});
  assert.deepEqual(s.taxi, t.taxi); assert.deepEqual(s.roadPersons, t.roadPersons); assert.deepEqual(s.carry.taxi, t.carry); assert.equal(s.taxiPersons, t.taxiPersons);
});
test('bus without taxi works; bus takes riders that taxi would otherwise get', () => {
  const nb = splitModeDemand(od, costs(undefined, false)); assert.ok(nb.busPersons > 0 && nb.taxiPersons === 0);
  const withBus = splitModeDemand(od, costs()), noBus = splitTaxiDemand(od, () => taxiC);
  assert.ok(withBus.taxiPersons <= noBus.taxiPersons);
});
test('seat cap binds: bus persons ≤ seats, and no phantom backlog is carried', () => {
  const s = splitModeDemand(od, costs(2));
  for (const b of s.bus) assert.ok(b.persons <= 2);
  for (const k of Object.keys(s.carry.bus)) assert.ok(!k.startsWith('commute') && !k.startsWith('school'), `capped key ${k} carried`);
  const z = splitModeDemand(od, costs(0)); assert.equal(z.busPersons, 0);
});
test('deterministic regardless of input order', () => assert.deepEqual(splitModeDemand(od, costs()), splitModeDemand([...od].reverse(), costs())));
test('fractional carry: 1x and 10x batching give identical bus and taxi totals over a day', () => {
  const city: DemandInput = { households: [{ cell: at(3, 4), amount: 130 }, { cell: at(2, 2), amount: 70 }], jobs: [{ cell: at(12, 5), amount: 150 }], schoolSeats: [{ cell: at(12, 2), amount: 20 }], parks: [{ cell: at(13, 3), amount: 1 }], freight: [{ cell: at(12, 2), amount: 40 }], entrance: 0 };
  const run = (chunks: number[]) => {
    let carry: ModeCarry = { bus: {}, taxi: {} }, b = 0, t = 0, offered = 0, dc = {}, hour = 0;
    for (const n of chunks) for (const r of demandForPeriods(city, hour, n, dc)) { dc = r.carry; const s = splitModeDemand(r.od, costs(), carry); carry = s.carry; b += s.busPersons; t += s.taxiPersons; offered += s.offeredPersons; hour++; }
    return { b, t, offered, carry };
  };
  const slow = run(Array(24).fill(1));
  assert.ok(slow.b > 0 && slow.t > 0);
  assert.deepEqual(run([10, 10, 4]), slow); assert.deepEqual(run([24]), slow);
});
