import test from 'node:test';
import assert from 'node:assert/strict';
import { planFamilyRides, type TripRequest } from '../src/citizen-trips.ts';
const trip = (id: string, overrides: Partial<TripRequest> = {}): TripRequest => ({ id, citizenId: `person:${id}`, householdId: 1,
  origin: 10, destination: 13, route: [10,11,12,13], earliestDeparture: 420, latestDeparture: 430, canDrive: true, ...overrides });

test('actual family members share one ride with ordered individual dropoffs', () => {
  const input = [trip('driver'), trip('child', {canDrive:false, destination:11, route:[10,11]}), trip('partner')];
  const before = JSON.stringify(input), result = planFamilyRides(input);
  assert.equal(result.rides.length,1); assert.equal(result.waiting.length,0);
  assert.equal(result.rides[0].passengerIds.length,3);
  assert.deepEqual(result.rides[0].stops,[{routeIndex:1,citizenIds:['person:child']},{routeIndex:3,citizenIds:['person:driver','person:partner']}]);
  assert.equal(JSON.stringify(input),before);
  assert.deepEqual(planFamilyRides([...input].reverse()), result);
});
test('different families, routes and departure windows do not get pooled', () => {
  const r = planFamilyRides([trip('a'),trip('b',{householdId:2}),trip('c',{route:[10,9,8],destination:8}),trip('d',{earliestDeparture:440,latestDeparture:450})]);
  assert.equal(r.rides.length,4); assert.equal(r.waiting.length,0);
});
test('capacity includes driver and preserves every person beyond first vehicle', () => {
  const input = Array.from({length:9},(_,i)=>trip(String(i)));
  const r = planFamilyRides(input);
  assert.deepEqual(r.rides.map(v=>v.passengerIds.length),[4,4,1]);
  assert.equal(new Set(r.rides.flatMap(v=>v.passengerIds)).size,9);
});
test('unreachable and non-driving people remain explicit waiting requests', () => {
  assert.deepEqual(planFamilyRides([trip('a',{route:[]}),trip('b',{canDrive:false})]).waiting,
    [{requestId:'a',reason:'no-route'},{requestId:'b',reason:'no-driver'}]);
});
test('duplicate people and invalid time or routes are rejected', () => {
  assert.throws(()=>planFamilyRides([trip('a'),trip('b',{citizenId:'person:a'})]));
  assert.throws(()=>planFamilyRides([trip('a',{latestDeparture:0})]));
  assert.throws(()=>planFamilyRides([trip('a',{route:[11,12,13]})]));
  assert.throws(()=>planFamilyRides([],0));
});
test('2000 simultaneous people have no hidden count cap', () => {
  const requests=Array.from({length:2000},(_,i)=>trip(String(i),{householdId:Math.floor(i/3)}));
  const r=planFamilyRides(requests);
  assert.equal(r.waiting.length,0); assert.equal(r.rides.length,667);
  assert.equal(new Set(r.rides.flatMap(v=>v.passengerIds)).size,2000);
  assert.equal(r.rides.flatMap(v=>v.stops.flatMap(s=>s.citizenIds)).length,2000);
});
