import test from 'node:test';
import assert from 'node:assert/strict';
import { configureRoadPath } from '../src/road-topology.ts';
import { createBus } from '../src/bus/buildings.ts';
import { createBusLine, type BusHost } from '../src/bus/lines.ts';
import { BusIntegration } from '../src/bus/integration.ts';
import { createBusTrafficHook } from '../src/bus/traffic-hook.ts';
import { BUS_ENABLED, busEnabled } from '../src/bus/types.ts';
import { TrafficClock } from '../src/traffic/clock.ts';
import { PEOPLE_PER_VEHICLE, type OdEntry } from '../src/traffic/types.ts';
import { SIZE, createCity } from '../src/sim.ts';

const W = SIZE, at = (x: number, y: number) => y * W + x;
const row = (y: number, a: number, b: number) => Array.from({ length: b - a + 1 }, (_, k) => at(a + k, y));
const col = (x: number, a: number, b: number) => Array.from({ length: b - a + 1 }, (_, k) => at(x, a + k));
function host(busCount = 3): BusHost {
  const c: BusHost = { cells: Array.from({ length: W * W }, () => ({ road: false })), nextId: 100 };
  const draw = (p: number[]) => { const f = new Set(p.filter(i => !c.cells[i].road)); for (const i of p) c.cells[i].road = true; configureRoadPath(c, p, f, false); };
  draw(row(2, 0, 20)); draw(row(10, 0, 20)); draw(col(0, 2, 10)); draw(col(20, 2, 10));
  c.bus = createBus();
  c.bus.depots.push({ id: 1, cell: at(5, 1), level: 1, open: true, tick: 0 });
  c.bus.stops.push({ id: 10, cell: at(4, 2), side: 'n', level: 1 }, { id: 11, cell: at(14, 2), side: 'n', level: 1 }, { id: 12, cell: at(20, 6), side: 'e', level: 1 });
  assert.ok(createBusLine(c, { depotId: 1, stopIds: [10, 11, 12], busCount, busLevel: 1 }).ok);
  return c;
}
const persons = (od: readonly OdEntry[]) => Math.round(od.reduce((n, e) => n + e.vehicles * PEOPLE_PER_VEHICLE, 0));
const OD: OdEntry[] = [{ purpose: 'commute', from: at(4, 3), to: at(20, 7), vehicles: 30 }, { purpose: 'freight', from: at(4, 3), to: at(20, 7), vehicles: 5 }];
const ok = (b: BusIntegration) => { const l = b.ledger(); assert.equal(l.conservationError, 0, JSON.stringify(l)); assert.equal(l.releaseError, 0, JSON.stringify(l)); };

test('flag off by default: BUS_ENABLED false, busEnabled() false without ?bus=1', () => {
  assert.equal(BUS_ENABLED, false);
  const mem = new Map<string, string>(), st = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
  assert.equal(busEnabled('', st), false); assert.equal(busEnabled('?bus=1', st), true); assert.equal(busEnabled('?bus=0', st), false);
});
test('flag off: traffic clock without a filter is identical to before (no bus split)', () => {
  const run = (o: ConstructorParameters<typeof TrafficClock>[0]) => { const c = createCity(), k = new TrafficClock(o); k.advance(c, 0); const r = k.advance(c, 6 * 60); return { r: JSON.stringify(r.map(a => a.unserved)), od: JSON.stringify(k.lastOd), t: JSON.stringify(k.totals) }; };
  assert.deepEqual(run({ enabled: true }), run({ enabled: true }));
  assert.equal(new TrafficClock({ enabled: true }).demandFilter, undefined);
  const city = createCity(); assert.equal(city.version, 9); assert.equal('bus' in city, false);
});
test('flag on: demand is split into bus, rest stays car, freight untouched', () => {
  const b = new BusIntegration(host(), 6 * 60, { width: W }), out = b.filter(OD, 6 * 60);
  assert.ok(b.totals.bus > 0, 'some people ride the bus');
  assert.equal(persons(out) + b.totals.bus, persons(OD));
  assert.equal(out.find(e => e.purpose === 'freight')!.vehicles, 5);
  assert.ok(b.engine.ledger().accepted === b.totals.bus); ok(b);
});
test('released riders go back to car demand (service end) and nobody is lost', () => {
  const b = new BusIntegration(host(1), 22 * 60 + 59, { width: W }); b.filter(OD, 22 * 60 + 59);
  const riders = b.totals.bus; assert.ok(riders > 0);
  b.tick(23 * 60 + 5); // service end → waiting released
  assert.ok(b.pendingReturn > 0); ok(b);
  const next = b.filter([], 23 * 60 + 10); // no new demand; released come back as cars
  assert.equal(persons(next), b.totals.returnedToCar); assert.equal(b.pendingReturn, 0); ok(b);
  const out = b.filter(OD, 23 * 60 + 30); // out of service: all bus share released at once → same period car
  assert.equal(persons(out), persons(OD)); ok(b);
});
test('passenger conservation over a full day with ticks', () => {
  const b = new BusIntegration(host(), 5 * 60, { width: W, maxWaitMinutes: 20 });
  for (let m = 5 * 60; m <= 26 * 60; m += 15) { if (m % 60 === 0) b.filter(OD, m); b.tick(m); ok(b); }
  assert.ok(b.engine.totals.completed > 0); assert.equal(b.engine.ledger().conservationError, 0);
});
test('traffic hook stays a no-op until a bridge sink with mode:bus support connects', () => {
  const b = new BusIntegration(host(), 6 * 60, { width: W }); b.filter(OD, 6 * 60);
  let calls = 0; for (let m = 6 * 60; m < 7 * 60; m++) b.tick(m);
  assert.equal(b.hook.active, false); assert.equal(calls, 0);
  const h = createBusTrafficHook(); let computed = 0; h.push(1, () => { computed++; return new Map(); }); assert.equal(computed, 0, 'load not computed while inactive');
  h.connect({ acceptsBus: true, applyBusLoad: () => { calls++; } }); h.push(1, () => new Map()); assert.equal(calls, 1);
  h.connect(null); h.push(2, () => new Map()); assert.equal(calls, 1);
});
