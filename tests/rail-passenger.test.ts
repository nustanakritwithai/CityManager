import test from 'node:test';
import assert from 'node:assert/strict';
import { createRailGraph, railPath, type RailLink } from '../src/rail/graph.ts';
import { PassengerRail, type PassengerOffer, type PassengerRailConfig } from '../src/rail/passenger.ts';
import { reserveRailDemand, admitRoadDemand, modalDemandSummary, acknowledgeRailService, type ModalDemand } from '../src/rail/demand-contract.ts';
import { createCity, serialize } from '../src/sim.ts';
import { offerLeasedPassengerDemand } from '../src/rail/offer-adapter.ts';

// Explicit TEST tuning, not product balance, costs, fares, level or grade policy.
const config = (): PassengerRailConfig => ({ id: 'test-slice', lineId: 'test-line', trainId: 'test-train', seats: 3,
  minimumDwellMinutes: 2, minimumDepartureIntervalMinutes: 4, maxBatches: 40,
  stations: [{ id: 'a', cell: 0, queueCapacity: 4, boardingPerMinute: 2, alightingPerMinute: 2 }, { id: 'b', cell: 2, queueCapacity: 4, boardingPerMinute: 2, alightingPerMinute: 2 }] });
const links = (minutes = 2): RailLink[] => [{ from: 0, to: 1, minutes }, { from: 1, to: 2, minutes }, { from: 2, to: 1, minutes }, { from: 1, to: 0, minutes }];
const make = (cfg = config(), start = 0) => new PassengerRail(cfg, createRailGraph(1, links()), start);
const offer = (id = 'one', persons = 8, reverse = false): PassengerOffer => ({ id, requestId: `request:${id}`, leaseId: `lease:${id}`, from: reverse ? 578 : 576, to: reverse ? 576 : 578,
  fromStation: reverse ? 'b' : 'a', toStation: reverse ? 'a' : 'b', persons, readyAtMinute: 0, egressMinutes: 2 });
const request = (o = offer()): ModalDemand => ({ id: o.requestId, from: o.from, to: o.to, offeredPersons: o.persons, roadAdmittedPersons: 0, leases: [] });
function conserved(rail: PassengerRail) {
  const d = rail.diagnostics(), s = rail.snapshot;
  assert.equal(d.conservationError, 0); assert.ok(d.onboard <= d.seatCapacity);
  for (const b of s.batches) assert.equal(b.persons, b.outside + b.waiting + b.onboard + b.completed + b.egress.reduce((n, e) => n + e.persons, 0));
  for (const station of ['a', 'b']) assert.ok(s.batches.filter(b => b.fromStation === station).reduce((n, b) => n + b.waiting, 0) <= 4);
  assert.equal(s.train.blockOwner, s.train.destination ? 'test-train' : null);
}

test('rail graph permits explicit corners, rejects row wraps/duplicates and does not invent adjacency', () => {
  const graph = createRailGraph(1, [{ from: 0, to: 1, minutes: 2 }, { from: 1, to: 25, minutes: 3 }]);
  assert.deepEqual(railPath(graph, 0, 25), { cells: [0, 1, 25], minutes: 5 });
  assert.equal(railPath(graph, 25, 0), null);
  assert.throws(() => createRailGraph(1, [{ from: 23, to: 24, minutes: 1 }]));
  assert.throws(() => createRailGraph(1, [...links(), links()[0]]));
  assert.throws(() => createRailGraph(1, [{ from: 0, to: 1, minutes: 0 }]));
});
test('route is deterministic and initial line requires both directions', () => {
  const graph = createRailGraph(1, [{ from: 0, to: 24, minutes: 1 }, { from: 24, to: 25, minutes: 1 }, { from: 0, to: 1, minutes: 1 }, { from: 1, to: 25, minutes: 1 }]);
  assert.deepEqual(railPath(graph, 0, 25)?.cells, [0, 1, 25]);
  assert.throws(() => new PassengerRail(config(), createRailGraph(1, links().slice(0, 2)), 0), /round trip/);
});
test('two stations one train actually boards, transports, alights and completes egress without losing people', () => {
  const rail = make(); rail.offer(offer()); rail.offer(offer('return', 5, true));
  const original = rail.snapshot;
  for (let minute = 1; minute <= 100; minute++) { rail.advanceTo(minute, 1); conserved(rail); }
  assert.equal(rail.diagnostics().completed, 13); assert.equal(rail.diagnostics().unresolved, 0);
  assert.equal(original.minute, 0); assert.equal(original.batches[0].onboard, 0);
});
test('boarding and alighting do not earn road relief until last-mile completion', () => {
  const rail = make(), o = offer('one', 2); rail.offer(o);
  let demand = reserveRailDemand(request(o), o.leaseId, o.persons);
  rail.advanceTo(2, 2); assert.equal(rail.diagnostics().onboard, 2); assert.deepEqual(rail.serviceReceipts(), []);
  assert.equal(modalDemandSummary(demand).roadAssignable, 0); assert.equal(modalDemandSummary(demand).railPending, 2);
  rail.advanceTo(6, 4); assert.equal(rail.diagnostics().egress, 2); assert.deepEqual(rail.serviceReceipts(), []);
  rail.advanceTo(8, 2); demand = acknowledgeRailService(demand, rail.serviceReceipts()[0]);
  assert.equal(modalDemandSummary(demand).completedRailRoadEquivalents, .2);
  assert.equal(modalDemandSummary(demand).railPending, 0);
});
test('finite platform and seats leave excess demand in explicit queues, not discarded', () => {
  const rail = make(); rail.offer(offer('one', 100)); rail.advanceTo(2, 2);
  assert.equal(rail.diagnostics().onboard, 3); assert.ok(rail.diagnostics().outside > 0); conserved(rail);
  rail.advanceTo(3, 1); assert.equal(rail.diagnostics().waiting, 4); conserved(rail);
});
test('loading rate and headway remain bottlenecks when seats are upgraded', () => {
  const cfg = config(); cfg.seats = 20; cfg.minimumDepartureIntervalMinutes = 20;
  cfg.stations[0].boardingPerMinute = 1;
  const rail = make(cfg); rail.offer(offer('one', 40)); rail.advanceTo(2, 2);
  assert.equal(rail.diagnostics().onboard, 2); // bigger train did not conjure boarding capacity
  rail.advanceTo(21, 19); assert.equal(rail.snapshot.train.lastDepartureMinute, 2);
  rail.advanceTo(22, 1); assert.equal(rail.snapshot.train.lastDepartureMinute, 22);
});
test('first-mile readiness is respected and the empty train can reposition for reverse demand', () => {
  const rail = make(); rail.offer({ ...offer('return', 2, true), readyAtMinute: 20 });
  rail.advanceTo(19, 19); assert.equal(rail.diagnostics().onboard, 0); assert.equal(rail.diagnostics().completed, 0);
  rail.advanceTo(40, 21); assert.equal(rail.diagnostics().completed, 2);
});
test('identical offer retry before and after arrival is idempotent; conflicting lease retry is atomic', () => {
  const rail = make(), o = offer(); rail.offer(o); assert.equal(rail.offer({ ...o }).reason, 'retry');
  const before = rail.snapshot;
  assert.throws(() => rail.offer({ ...o, persons: 9 }), /Conflicting/); assert.deepEqual(rail.snapshot, before);
  assert.throws(() => rail.offer({ ...o, id: 'new' }), /Conflicting/);
  rail.advanceTo(100, 100); rail.offer(o); assert.equal(rail.diagnostics().offered, 8); assert.equal(rail.diagnostics().completed, 8);
});
test('bounded batch retention refuses new work without evicting pending people or retry identities', () => {
  const cfg = config(); cfg.maxBatches = 1; const rail = make(cfg); rail.offer(offer());
  const before = rail.snapshot; assert.deepEqual(rail.offer(offer('other')), { accepted: false, reason: 'batch-limit' });
  assert.deepEqual(rail.snapshot, before);
  rail.advanceTo(100, 100); assert.equal(rail.offer(offer()).reason, 'retry');
  assert.equal(rail.offer(offer('other')).accepted, false);
});
test('pause advances nothing; budget resumes same target without dropping or replaying minutes', () => {
  const rail = make(); rail.offer(offer()); const before = rail.snapshot;
  assert.deepEqual(rail.advanceTo(30, 10, true), { processedMinutes: 0, remainingMinutes: 30 }); assert.deepEqual(rail.snapshot, before);
  assert.deepEqual(rail.advanceTo(30, 7), { processedMinutes: 7, remainingMinutes: 23 });
  rail.advanceTo(30, 23); const after = rail.snapshot; rail.advanceTo(30, 10); assert.deepEqual(rail.snapshot, after);
  assert.throws(() => rail.advanceTo(29, 10)); assert.deepEqual(rail.snapshot, after);
});
test('single-minute versus accelerated/budgeted playback has identical authoritative state', () => {
  const a = make(), b = make(); for (const r of [a, b]) { r.offer(offer()); r.offer(offer('return', 9, true)); }
  for (let m = 1; m <= 100; m++) a.advanceTo(m, 1);
  while (b.snapshot.minute < 100) b.advanceTo(100, 17);
  assert.deepEqual(a.snapshot, b.snapshot); assert.deepEqual(a.serviceReceipts(), b.serviceReceipts());
});
test('trip crosses midnight and multiple days without a day-flush', () => {
  const rail = new PassengerRail(config(), createRailGraph(1, links(800)), 1438);
  rail.offer(offer('long', 2)); rail.advanceTo(1440, 2); assert.equal(rail.diagnostics().onboard, 2);
  rail.advanceTo(2880, 1440); assert.equal(rail.diagnostics().onboard, 2); assert.equal(rail.diagnostics().completed, 0);
  rail.advanceTo(3050, 170); assert.equal(rail.diagnostics().completed, 2); conserved(rail);
});
test('graceful line pause drains moving or predeparture riders but does not board waiting riders', () => {
  for (const stopAt of [1, 3]) {
    const rail = make(); rail.offer(offer()); rail.advanceTo(stopAt, stopAt); const boarded = rail.diagnostics().onboard;
    rail.setServiceEnabled(false); rail.advanceTo(50, 50);
    assert.equal(rail.diagnostics().completed, boarded); assert.equal(rail.diagnostics().unresolved, 8 - boarded); conserved(rail);
    rail.setServiceEnabled(true); rail.advanceTo(150, 100); assert.equal(rail.diagnostics().completed, 8);
  }
});
test('closed destination retains riders, reopening resumes unloading without duplicate arrivals', () => {
  const rail = make(); rail.offer(offer('one', 3)); rail.advanceTo(3, 3); rail.setStationOpen('b', false);
  rail.advanceTo(20, 17); assert.equal(rail.diagnostics().onboard, 3); assert.equal(rail.diagnostics().completed, 0); conserved(rail);
  rail.setStationOpen('b', true); rail.advanceTo(30, 10); assert.equal(rail.diagnostics().completed, 3); conserved(rail);
});
test('occupied rail edits reject atomically; docked disconnect holds queue and newer repair invalidates cached route', () => {
  const rail = make(); rail.offer(offer('one', 2)); rail.advanceTo(3, 3); const before = rail.snapshot;
  assert.throws(() => rail.replaceGraph(createRailGraph(2, [])), /occupied/); assert.deepEqual(rail.snapshot, before);
  rail.advanceTo(10, 7); rail.replaceGraph(createRailGraph(2, [])); rail.offer(offer('two', 4, true)); rail.advanceTo(30, 20);
  assert.equal(rail.diagnostics().connected, false); assert.equal(rail.diagnostics().completed, 2); assert.equal(rail.diagnostics().unresolved, 4);
  rail.replaceGraph(createRailGraph(3, links())); rail.advanceTo(100, 70); assert.equal(rail.diagnostics().completed, 6);
});
test('constructor/offer snapshots are defensively copied; invalid inputs leave runtime unchanged', () => {
  const cfg = config(), graph = createRailGraph(1, links()), o = offer(); const rail = new PassengerRail(cfg, graph, 0); rail.offer(o);
  cfg.seats = 999; graph.links.length = 0; o.persons = 999; const s = rail.snapshot; s.batches.length = 0;
  assert.equal(rail.diagnostics().offered, 8); assert.equal(rail.diagnostics().seatCapacity, 3); assert.equal(rail.diagnostics().connected, true);
  const before = rail.snapshot;
  for (const persons of [NaN, Infinity, -1, .5]) assert.throws(() => rail.offer({ ...offer('bad'), persons }));
  assert.throws(() => rail.advanceTo(Number.MAX_SAFE_INTEGER, 1)); assert.deepEqual(rail.snapshot, before);
});
test('mode lease conserves demand, excludes rail riders from road admission and refuses overbooking', () => {
  let d = request(offer('one', 20)); d = admitRoadDemand(d, 4); d = reserveRailDemand(d, 'rail:1', 10);
  assert.deepEqual(modalDemandSummary(d), { offered: 20, roadAdmitted: 4, roadAssignable: 6, railPending: 10, railCompleted: 0, unresolved: 16, completedRailRoadEquivalents: 0, conservationError: 0 });
  const before = structuredClone(d); assert.throws(() => admitRoadDemand(d, 7)); assert.throws(() => reserveRailDemand(d, 'rail:2', 7)); assert.deepEqual(d, before);
  assert.deepEqual(reserveRailDemand(d, 'rail:1', 10), d); assert.throws(() => reserveRailDemand(d, 'rail:1', 11));
});
test('partial completion receipts are cumulative/idempotent/order-safe and source-bound', () => {
  let d = reserveRailDemand(request(), 'lease:one', 8);
  const proof = { requestId: d.id, leaseId: 'lease:one', from: d.from, to: d.to, completedPersons: 3 };
  d = acknowledgeRailService(d, proof); d = acknowledgeRailService(d, proof);
  assert.equal(modalDemandSummary(d).railCompleted, 3); assert.equal(modalDemandSummary(d).railPending, 5);
  d = acknowledgeRailService(d, { ...proof, completedPersons: 6 }); d = acknowledgeRailService(d, proof);
  assert.equal(modalDemandSummary(d).railCompleted, 6); assert.equal(modalDemandSummary(d).conservationError, 0);
  for (const bad of [{ ...proof, from: 1 }, { ...proof, leaseId: 'wrong' }, { ...proof, completedPersons: 9 }]) assert.throws(() => acknowledgeRailService(d, bad));
});
test('prepared module does not alter city/economy/save or require a live traffic toggle', () => {
  const city = createCity(), before = serialize(city); const rail = make(); rail.offer(offer()); rail.advanceTo(100, 100);
  assert.equal(rail.diagnostics().completed, 8); assert.equal(serialize(city), before);
});
test('modal adapter reserves exactly accepted rail demand and rolls back refused/new invalid offers', () => {
  const cfg = config(); cfg.maxBatches = 1; const rail = make(cfg), o = offer();
  const before = request(o), accepted = offerLeasedPassengerDemand(rail, before, o);
  assert.equal(before.leases.length, 0); assert.equal(modalDemandSummary(accepted.demand).roadAssignable, 0);
  assert.equal(offerLeasedPassengerDemand(rail, accepted.demand, o).reason, 'retry');
  const other = offer('other'), rejected = offerLeasedPassengerDemand(rail, request(other), other);
  assert.equal(rejected.accepted, false); assert.equal(modalDemandSummary(rejected.demand).roadAssignable, 8);
  const snapshot = rail.snapshot;
  assert.throws(() => offerLeasedPassengerDemand(rail, request(o), { ...o, from: 999 }));
  assert.throws(() => offerLeasedPassengerDemand(rail, admitRoadDemand(request(o), 8), o));
  assert.deepEqual(rail.snapshot, snapshot);
});
test('opaque station IDs cannot collide in directed path cache keys', () => {
  const cfg = config(); cfg.stations[0].id = 'x:x'; cfg.stations[1].id = 'x';
  const rail = make(cfg); rail.offer({ ...offer('one', 1), fromStation: 'x:x', toStation: 'x' });
  rail.advanceTo(10, 10); rail.offer({ ...offer('reverse', 1, true), fromStation: 'x', toStation: 'x:x' });
  rail.advanceTo(11, 1); assert.deepEqual(rail.snapshot.train.path, [2, 1, 0]);
});
