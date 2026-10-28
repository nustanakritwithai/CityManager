import test from 'node:test';
import assert from 'node:assert/strict';
import { createCity, buildPark, step, serialize, deserialize, SIZE, type City } from '../src/sim.ts';
import { parkActivityAbsoluteMinute, parkActivityUnavailableCitizenIds } from '../src/park-activity.ts';
import { createParkActivity, advanceParkActivity, startParkActivityDay, reconcileParkActivity, parkActivityCitizens, parkActivityVisitors, parkActivityDiagnostics, parkPedestrianRoute, serializeParkActivity, restoreParkActivity, MAX_PARK_VISITORS, MAX_PARK_ROUTE_SEARCHES, PARK_VISITOR_CAPACITY, type ParkActivityState } from '../src/park-activity.ts';

function fixture(members = 12): City {
  const c = createCity(100, { starter: false });
  c.buildings = [{ id: 100, cell: 100, zone: 'R', level: 1, age: 0, housingType: 'low-rise' as any }];
  c.cells[100].building = 100;
  c.households = [{ id: 200, home: 100, members, workforce: 3, dependents: members - 3, workerSkills: { general: 2, manufacturing: 1, retail: 0 }, skillSource: 'arrival-profile', profile: 'family', origin: 'arrival', wallet: 'h:200', lastPurchaseTick: -1, needs: 0 }];
  c.employment = [{ householdId: 200, firmId: 302, skill: 'general', workers: 1, occupation: 'manufacturing', rank: 'entry' }, { householdId: 200, firmId: 301, skill: 'manufacturing', workers: 1, occupation: 'manufacturing', rank: 'entry' }];
  c.ownerLabor = [{ householdId: 200, firmId: 300, skill: 'general', workers: 1 }];
  c.parks = [{ id: 400, cell: 104, tick: 0, level: 1 }];
  return c;
}

test('municipal workforce uses remaining skill slots after owner and firm jobs, and never visits on duty', () => {
  const c = fixture(4), h = c.households[0];
  h.workforce = 4; h.dependents = 0; h.workerSkills.general = 3;
  const s = createParkActivity(c, 599); advanceParkActivity(c, s, 1);
  assert.deepEqual(s.visitors.map(v => v.citizenId), ['h:200:m:2']);
  (c.parks[0] as any).staffing = { allocations: [{ householdId: h.id, parkId: 400, skill: 'general', workers: 1 }], workDays: {} };
  const people = parkActivityCitizens(c);
  assert.deepEqual(people.map(p => [p.firmId, p.parkJobId]), [[300, null], [302, null], [null, 400], [301, null]]);
  assert.equal(people.length, h.members);
  assert.equal(parkActivityUnavailableCitizenIds(c, 600).size, 4);
  assert.ok(parkActivityUnavailableCitizenIds(c, 600).has('h:200:m:2'));
  reconcileParkActivity(c, s); assert.equal(s.visitors.length, 0); assert.equal(s.cancelled, 1);
  const evening = createParkActivity(c, 1019), before = JSON.stringify(c);
  advanceParkActivity(c, evening, 1);
  assert.equal(parkActivityUnavailableCitizenIds(c, 1020).size, 0);
  assert.ok(evening.visitors.some(v => v.citizenId === 'h:200:m:2' && v.parkJobId === 400 && v.firmId === null));
  assert.equal(serializeParkActivity(restoreParkActivity(c, serializeParkActivity(evening))), serializeParkActivity(evening));
  assert.equal(JSON.stringify(c), before, 'No staffing allocations, wage claims or money changed');
});

test('absolute game-minute adapter shares a single midnight boundary and rejects unsafe time', () => {
  assert.equal(parkActivityAbsoluteMinute({ day: 180, minute: 1020 }), 260220);
  assert.equal(parkActivityAbsoluteMinute({ day: 180, minute: 1440 }), parkActivityAbsoluteMinute({ day: 181, minute: 0 }));
  assert.throws(() => parkActivityAbsoluteMinute({ day: Number.MAX_SAFE_INTEGER, minute: 0 }));
});
const active = (c: City) => { const s = createParkActivity(c, 599); advanceParkActivity(c, s, 1); return s; };
function invariants(c: City, s: ParkActivityState): void {
  const people = new Map(parkActivityCitizens(c).map(p => [p.citizenId, p]));
  assert.ok(s.visitors.length <= MAX_PARK_VISITORS);
  assert.equal(new Set(s.visitors.map(v => v.citizenId)).size, s.visitors.length);
  for (const park of c.parks) {
    const vs = s.visitors.filter(v => v.parkId === park.id);
    assert.ok(vs.length <= PARK_VISITOR_CAPACITY);
    assert.equal(new Set(vs.map(v => v.slot)).size, vs.length);
    assert.ok(vs.filter(v => v.phase === 'sit').length <= 2);
  }
  for (const v of parkActivityVisitors(s)) {
    assert.ok(people.has(v.citizenId));
    assert.ok(v.x >= 0 && v.x <= SIZE && v.z >= 0 && v.z <= SIZE);
    if (s.minute >= 480 && s.minute < 1020) assert.equal(v.employed, false);
    if (v.phase === 'meet') assert.ok(s.visitors.some(p => p.citizenId === v.partnerId && p.partnerId === v.citizenId && p.phase === 'meet' && p.phaseMinute === v.phaseMinute && p.parkId === v.parkId));
    if (v.phase === 'sit') { assert.ok(v.slot < 2); assert.equal(v.z, Math.floor(v.parkCell / SIZE) + .79); assert.equal(v.headingZ, -1); }
  }
}

test('identities conserve household population and worker/owner slots are stable under row ordering', () => {
  const c = fixture(), people = parkActivityCitizens(c);
  assert.equal(people.length, 12);
  assert.deepEqual(people.slice(0, 3).map(p => [p.citizenId, p.firmId]), [['h:200:m:0', 300], ['h:200:m:1', 302], ['h:200:m:2', 301]]);
  assert.equal(people.filter(p => p.employed).length, 3);
  c.employment.reverse(); assert.deepEqual(parkActivityCitizens(c), people);
});

test('minute-by-minute full day uses real identities, bounded reservations, work exclusions and mutual meetings', () => {
  const c = fixture(), before = structuredClone(c), s = createParkActivity(c);
  const phases = new Set<string>();
  for (let i = 0; i < 1440; i++) { advanceParkActivity(c, s, 1); invariants(c, s); for (const v of s.visitors) phases.add(v.phase); }
  assert.deepEqual([...phases].sort(), ['enter', 'leave', 'meet', 'sit', 'stroll', 'travel', 'wait'].sort());
  assert.equal(s.visitors.length, 0);
  assert.equal(s.completed, 12); assert.equal(s.cancelled, 0);
  assert.equal(s.visited.length, 12); assert.equal(new Set(s.visited).size, 12);
  assert.deepEqual(c, before, 'no accounts, workDays, journals, RNG, population or economic clock mutation');
});

test('arbitrary minute batches, pause, and save/resume are identical to single steps', () => {
  const c = fixture(), a = createParkActivity(c), b = createParkActivity(c), d = createParkActivity(c);
  for (let n = 0; n < 1200; n++) advanceParkActivity(c, a, 1);
  for (const n of [599, 1, 7, 13, 59, 0, 233, 288]) advanceParkActivity(c, b, n);
  advanceParkActivity(c, d, 627);
  const paused = serializeParkActivity(d); advanceParkActivity(c, d, 0); assert.equal(serializeParkActivity(d), paused);
  const restored = restoreParkActivity(c, paused); advanceParkActivity(c, restored, 573);
  assert.deepEqual(b, a); assert.deepEqual(restored, a);
  assert.throws(() => advanceParkActivity(c, a, .5));
  assert.throws(() => advanceParkActivity(c, a, -1));
  assert.throws(() => advanceParkActivity(c, a, 241));
});

test('orthogonal paths avoid buildings, plants and other parks; sealed and overlong routes fail', () => {
  const c = fixture();
  c.buildings.push({ id: 501, cell: 101, zone: 'I', level: 1, age: 0 }); c.cells[101].building = 501;
  c.plants.push({ id: 502, cell: 102 } as any); c.parks.push({ id: 503, cell: 103, tick: 0, level: 1 });
  const path = parkPedestrianRoute(c, 100, 104);
  assert.ok(path.length > 0); assert.equal(path[0], 100); assert.equal(path.at(-1), 104);
  for (const forbidden of [101, 102, 103]) assert.ok(!path.includes(forbidden));
  for (let i = 1; i < path.length; i++) assert.equal(Math.abs(path[i] % SIZE - path[i - 1] % SIZE) + Math.abs(Math.floor(path[i] / SIZE) - Math.floor(path[i - 1] / SIZE)), 1);
  for (const cell of [99, 76, 124]) { c.buildings.push({ id: 600 + cell, cell, zone: 'I', level: 1, age: 0 }); c.cells[cell].building = 600 + cell; }
  assert.deepEqual(parkPedestrianRoute(c, 100, 104), []);
  assert.deepEqual(parkPedestrianRoute(fixture(), 0, SIZE * SIZE - 1), []);
});

test('park/home/resident removal and route obstruction reconcile without phantom actors or fake returns', () => {
  for (const change of [
    (c: City, s: ParkActivityState) => { c.parks = []; },
    (c: City, s: ParkActivityState) => { c.buildings = []; },
    (c: City, s: ParkActivityState) => { c.households = []; },
    (c: City, s: ParkActivityState) => { const cell = s.visitors[0].route[1]; c.cells[cell].building = 999; }
  ]) {
    const c = fixture(), s = active(c), count = s.visitors.length; assert.ok(count > 0);
    change(c, s); reconcileParkActivity(c, s);
    assert.equal(s.visitors.length, 0); assert.equal(s.cancelled, count); assert.equal(s.completed, 0); assert.ok(s.lastCancellation);
  }
});

test('employment update immediately reserves newly working members; lost meeting partners stop meeting', () => {
  const c = fixture(4), s = active(c);
  assert.equal(s.visitors.length, 1);
  c.households[0].workforce = 4; c.households[0].workerSkills.general = 3;
  c.employment.push({ householdId: 200, firmId: 303, skill: 'general', workers: 1, occupation: 'manufacturing', rank: 'entry' });
  reconcileParkActivity(c, s); assert.equal(s.visitors.length, 0); assert.equal(s.cancelled, 1);
  const c2 = fixture(), s2 = active(c2);
  while (!s2.visitors.some(v => v.phase === 'meet')) advanceParkActivity(c2, s2, 1);
  const removed = s2.visitors.find(v => v.phase === 'meet')!;
  // Membership shrink invalidates one or more real slots; all survivors lose stale partner links.
  c2.households[0].members = removed.memberSlot;
  reconcileParkActivity(c2, s2); invariants(c2, s2);
});

test('reservation caps include travellers; global limit spans multiple parks', () => {
  const c = fixture(120);
  c.parks = Array.from({ length: 15 }, (_, i) => ({ id: 400 + i, cell: 110 + i, tick: 0, level: 1 as const }));
  const s = active(c); assert.equal(s.visitors.length, 64); assert.ok(s.visitors.every(v => v.phase === 'travel')); invariants(c, s);
});

test('saved one-minute departure headway prevents same-home shared-route walkers from stacking', () => {
  const c = fixture(), s = active(c);
  assert.equal(s.visitors.length, 6); assert.equal(parkActivityVisitors(s).length, 1, 'scheduled residents remain home until departure');
  assert.equal(new Set(s.visitors.map(v => v.departureMinute)).size, 6);
  const restored = restoreParkActivity(c, serializeParkActivity(s));
  for (let minute = 0; minute < 15; minute++) {
    advanceParkActivity(c, s, 1); advanceParkActivity(c, restored, 1); assert.deepEqual(restored, s);
    const walking = parkActivityVisitors(s).filter(v => v.phase === 'travel');
    for (let a = 0; a < walking.length; a++) for (let b = a + 1; b < walking.length; b++) assert.ok(Math.hypot(walking[a].x - walking[b].x, walking[a].z - walking[b].z) > .01);
  }
});

test('strict restore rejects fake identities, duplicate slots, broken paths, invented meetings and invalid phases', () => {
  const c = fixture(), s = active(c);
  for (const edit of [
    (s: any) => { s.visitors[0].citizenId = 'fake-person'; },
    (s: any) => { s.visitors[1].slot = s.visitors[0].slot; },
    (s: any) => { s.visitors[0].route[1] = 575; },
    (s: any) => { s.visitors[0].phase = 'meet'; s.visitors[0].partnerId = 'fiction'; },
    (s: any) => { s.visitors[0].phase = 'romance'; },
    (s: any) => { s.visitors[0].phaseMinute = 100000; },
    (s: any) => { s.minute = 1441; },
    (s: any) => { s.visited.push(s.visited[0]); }
  ]) { const altered = structuredClone(s); edit(altered); assert.throws(() => restoreParkActivity(c, JSON.stringify(altered)), /Corrupt/); }
  c.parks = []; const restored = restoreParkActivity(c, serializeParkActivity(s));
  assert.equal(restored.visitors.length, 0); assert.equal(restored.cancelled, s.visitors.length);
});

test('economic day changes are explicit and cannot silently advance economic time', () => {
  const c = fixture(), s = createParkActivity(c); advanceParkActivity(c, s, 1440);
  assert.equal(c.tick, 0); assert.throws(() => startParkActivityDay(c, s));
  c.tick++; assert.throws(() => advanceParkActivity(c, s, 1), /day/); assert.throws(() => restoreParkActivity(c, serializeParkActivity(s)), /day/);
  startParkActivityDay(c, s); assert.equal(s.day, 1); assert.equal(s.minute, 0); assert.deepEqual(s.visited, []);
  assert.deepEqual(parkActivityDiagnostics(s), { day: 1, minute: 0, activeReservations: 0, inside: 0, completedReturns: 0, cancelled: 0, lastCancellation: null, meetingPairs: 0, visitedToday: 0, routeSearches: 0 });
});

test('unreachable-park route searches are bounded by homes times parks, independent of members', () => {
  const c = fixture(512);
  c.parks = Array.from({ length: 32 }, (_, i) => ({ id: 400 + i, cell: 300 + i, tick: 0, level: 1 as const }));
  for (const cell of [99, 101, 76, 124]) c.cells[cell].building = 999;
  const s = active(c);
  assert.equal(s.visitors.length, 0); assert.equal(s.routeSearches, 32);
  advanceParkActivity(c, s, 15); assert.equal(s.routeSearches, 64);
  c.cells[101].building = null;
  advanceParkActivity(c, s, 15); assert.ok(s.visitors.length > 0, 'cache cannot retain failed paths after a map edit');
  assert.equal(s.routeSearches, 96); invariants(c, s);
});

test('128-home / 32-unreachable-park benchmark enforces a fixed search budget and rotates deferred homes', t => {
  const c = fixture();
  c.buildings = Array.from({ length: 128 }, (_, i) => ({ id: 600 + i, cell: i, zone: 'R' as const, level: 1, age: 0 }));
  const template = c.households[0];
  c.households = c.buildings.map((b, i) => ({ ...template, id: 1000 + i, home: b.id, members: 4, workforce: 0, dependents: 4, workerSkills: { general: 0, manufacturing: 0, retail: 0 } }));
  c.employment = []; c.ownerLabor = [];
  c.parks = Array.from({ length: 32 }, (_, i) => ({ id: 400 + i, cell: 300 + i, tick: 0, level: 1 as const }));
  // Synthetic obstruction topology: homes and parks are valid grid parcels;
  // every corridor is blocked, so the unreachable searches are deterministic.
  for (const cell of c.cells) cell.building = 999;
  for (const b of c.buildings) c.cells[b.cell].building = b.id;
  for (const p of c.parks) c.cells[p.cell].building = null;
  const s = createParkActivity(c, 599), start = performance.now();
  for (let pass = 0; pass < 16; pass++) {
    const before = s.routeSearches; advanceParkActivity(c, s, pass === 0 ? 1 : 15);
    assert.equal(s.routeSearches - before, MAX_PARK_ROUTE_SEARCHES);
  }
  assert.equal(s.visitors.length, 0); assert.equal(s.routeSearches, 4096);
  t.diagnostic(`128 homes, 512 constituents, 32 unreachable parks: 16 admissions, 4096 searches, ${(performance.now() - start).toFixed(1)} ms observed (no timing assertion)`);
  // Only the final home can access a newly moved park. Rotation must reach it,
  // rather than forever retrying the first eight unreachable homes.
  c.parks[31].cell = 151; c.cells[151].building = null;
  for (let pass = 0; pass < 16 && !s.visited.length; pass++) advanceParkActivity(c, s, 15);
  assert.ok(s.visited.length > 0); assert.ok(s.visited.every(id => id.startsWith('h:1127:'))); invariants(c, s);
});

test('real 180-day city and canonical save round trip retain deterministic recreation without economic changes', () => {
  const c = createCity(61025);
  for (let i = 0; i < 180; i++) step(c);
  assert.ok(c.households.length > 0);
  const home = c.buildings.find(b => b.id === c.households.find(h => h.home !== null)!.home)!;
  const distance = (cell: number) => Math.abs(cell % SIZE - home.cell % SIZE) + Math.abs(Math.floor(cell / SIZE) - Math.floor(home.cell / SIZE));
  const choices = c.cells.map((_, cell) => cell).sort((a, b) => distance(a) - distance(b) || a - b);
  assert.ok(choices.some(cell => buildPark(c, cell).ok));
  const before = serialize(c), s = createParkActivity(c);
  advanceParkActivity(c, s, 1035);
  assert.ok(s.visited.length > 0, 'real housed constituents reach a real park');
  const loadedCity = deserialize(before), loadedActivity = restoreParkActivity(loadedCity, serializeParkActivity(s));
  advanceParkActivity(c, s, 405); advanceParkActivity(loadedCity, loadedActivity, 405);
  assert.deepEqual(loadedActivity, s);
  assert.equal(serialize(c), before); assert.equal(serialize(loadedCity), before);
  assert.ok(s.completed > 0); assert.equal(s.visitors.length, 0);
});
