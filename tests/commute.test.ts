import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCity, step, serialize, deserialize, type City } from '../src/sim.ts';
import { TILE_LENGTH_M } from '../src/traffic/network.ts';
import { driveway } from '../src/parking.ts';
import { VEHICLE, WALK_MAX_M, commutesToday, liveVehicles, planCommutes, runCommutes, validateVehicles, vehiclePurchaseReason, fuelReason, type Trip } from '../src/commute.ts';

const grown = (days = 60) => { const c = createCity(61025); for (let i = 0; i < days; i++) step(c); return c; };
/** Move money in from outside, as an arrival's savings would, keeping every account summing to zero. */
const give = (c: City, wallet: string, amount: number) => { c.accounts.outside = (c.accounts.outside ?? 0) - amount; c.accounts[wallet] = (c.accounts[wallet] ?? 0) + amount; };
const total = (c: City) => Object.values(c.accounts).reduce((n, v) => n + v, 0);
const longTrip = (c: City) => planCommutes(c).find(t => t.distanceM > WALK_MAX_M && t.mode !== 'unreachable');
const pay = (c: City) => (from: string, to: string, amount: number, reason: string) => {
  const paid = Math.min(amount, from === 'outside' ? amount : c.accounts[from] ?? 0);
  c.accounts[from] = (c.accounts[from] ?? 0) - paid; c.accounts[to] = (c.accounts[to] ?? 0) + paid; c.ledger.push({ tick: c.tick, from, to, amount: paid, reason }); return paid;
};

test('every worker gets a trip from the home driveway to the workplace driveway along a real road route', () => {
  const c = grown(), trips = planCommutes(c);
  const workers = c.employment.reduce((n, a) => n + a.workers, 0) + c.ownerLabor.length;
  assert.ok(trips.length >= workers && workers > 0);
  for (const t of trips) {
    if (t.mode === 'unreachable') continue;
    const h = c.households.find(x => x.id === t.householdId)!, home = c.buildings.find(b => b.id === h.home)!;
    assert.equal(t.from, driveway(c, [home.cell]));
    assert.equal(t.route![0], t.from); assert.equal(t.route!.at(-1), t.to);
    for (const cell of t.route!) assert.equal(c.cells[cell].road, true);
    assert.equal(t.distanceM, (t.route!.length - 1) * TILE_LENGTH_M);
    if (t.distanceM <= WALK_MAX_M) assert.equal(t.mode, 'walk', 'a short trip is walked');
    assert.ok(t.minutes !== null && t.minutes >= 0);
  }
  assert.deepEqual(planCommutes(c), trips, 'the same city always plans the same trips');
});

test('a household with a long trip buys a motorcycle once its savings cover the price after a month of spending, and only that', () => {
  const c = grown(), trip = longTrip(c);
  assert.ok(trip, 'the grown city has a commute over 500 m');
  const h = c.households.find(x => x.id === trip.householdId)!;
  // Strip the fleet so the purchase is this test's own.
  delete c.vehicles;
  const before = c.accounts[h.wallet];
  give(c, h.wallet, VEHICLE.motorcycle.price * 3);
  const day = runCommutes(c, pay(c));
  const mine = day.bought.filter(v => v.householdId === h.id);
  assert.equal(mine.length, 1); assert.equal(mine[0].kind, 'motorcycle'); assert.equal(mine[0].fuelMl, VEHICLE.motorcycle.tankMl, 'sold with a full tank');
  assert.ok(c.ledger.some(e => e.from === h.wallet && e.to === 'outside' && e.amount === VEHICLE.motorcycle.price && e.reason === vehiclePurchaseReason('motorcycle', mine[0].id)));
  assert.ok(c.accounts[h.wallet] >= before + VEHICLE.motorcycle.price * 3 - VEHICLE.motorcycle.price - 2 * 30, 'only the vehicle (and at most a bus fare) left the wallet');
  assert.equal(total(c), 0);
  // The next day the longest trip of that household is driven.
  const next = planCommutes(c).filter(t => t.householdId === h.id && t.distanceM > WALK_MAX_M);
  assert.equal(next[0].mode, 'drive'); assert.equal(next[0].vehicleId, mine[0].id);
});

test('a household that can only just cover the price keeps a month of its spending back and buys nothing', () => {
  const c = grown(), trip = longTrip(c)!, h = c.households.find(x => x.id === trip.householdId)!;
  delete c.vehicles;
  c.accounts.outside += c.accounts[h.wallet]; c.accounts[h.wallet] = 0; give(c, h.wallet, VEHICLE.motorcycle.price);
  const spent = c.ledger.filter(e => e.from === h.wallet && e.tick > c.tick - 30).reduce((n, e) => n + e.amount, 0);
  const day = runCommutes(c, pay(c));
  if (spent > 2 * 30) assert.equal(day.bought.filter(v => v.householdId === h.id).length, 0);
  assert.equal(total(c), 0);
});

test('home parking holds one car or two motorcycles, and a rich household buys a car', () => {
  const c = grown(), trip = longTrip(c)!, h = c.households.find(x => x.id === trip.householdId)!;
  delete c.vehicles;
  give(c, h.wallet, VEHICLE.car.price * 3);
  assert.equal(runCommutes(c, pay(c)).bought.find(v => v.householdId === h.id)?.kind, 'car');
  for (let k = 0; k < 3; k++) assert.equal(runCommutes(c, pay(c)).bought.filter(v => v.householdId === h.id).length, 0, 'no room for another');
  const d = grown(), t2 = longTrip(d)!, h2 = d.households.find(x => x.id === t2.householdId)!;
  d.vehicles = { version: 1, nextId: 2, fleet: [{ id: 1, householdId: h2.id, kind: 'motorcycle', bought: d.tick, fuelMl: 0, odometerM: 0 }] };
  give(d, h2.wallet, VEHICLE.car.price * 3);
  const extra = runCommutes(d, pay(d)).bought.filter(v => v.householdId === h2.id);
  assert.ok(extra.every(v => v.kind === 'motorcycle'), 'beside a motorcycle there is room only for a second one');
});

test('driving burns fuel by distance, a dry tank is refilled and paid for, and the odometer counts both ways', () => {
  const c = grown(), trip = longTrip(c)!, h = c.households.find(x => x.id === trip.householdId)!;
  c.vehicles = { version: 1, nextId: 2, fleet: [{ id: 1, householdId: h.id, kind: 'motorcycle', bought: c.tick, fuelMl: 0, odometerM: 0 }] };
  give(c, h.wallet, 10_000);
  const day = runCommutes(c, pay(c)), driven = day.trips.find(t => t.vehicleId === 1 && t.mode === 'drive')!;
  assert.ok(driven);
  const v = c.vehicles!.fleet[0], spec = VEHICLE.motorcycle, need = Math.round(2 * driven.distanceM * spec.mlPerKm / 1000);
  assert.equal(v.fuelMl, spec.tankMl - need); assert.equal(v.odometerM, 2 * driven.distanceM);
  assert.ok(c.ledger.some(e => e.reason === fuelReason(1) && e.from === h.wallet && e.to === 'outside' && e.amount === Math.round(spec.tankMl / 1000 * 150)));
  assert.equal(total(c), 0);
});

test('a household that cannot pay for fuel leaves the vehicle at home and its people go another way', () => {
  const c = grown(), trip = longTrip(c)!, h = c.households.find(x => x.id === trip.householdId)!;
  c.vehicles = { version: 1, nextId: 2, fleet: [{ id: 1, householdId: h.id, kind: 'car', bought: c.tick, fuelMl: 0, odometerM: 0 }] };
  c.accounts.outside += c.accounts[h.wallet]; c.accounts[h.wallet] = 0;
  const day = runCommutes(c, pay(c));
  assert.ok(day.trips.filter(t => t.householdId === h.id).every(t => t.mode !== 'drive' && t.mode !== 'passenger'));
  assert.equal(c.vehicles!.fleet[0].odometerM, 0);
});

test('a relative bound for the same workplace rides along while seats remain', () => {
  const c = grown(), trip = longTrip(c)!;
  assert.equal(trip.workplace.kind, 'firm');
  // Two more people from the same home work at the same place (the plan only reads who works where).
  const job = [...c.employment, ...c.ownerLabor].find(a => a.householdId === trip.householdId && a.firmId === trip.workplace.id)!;
  c.employment.push({ ...(c.employment.find(a => a === job) ?? c.employment[0]), householdId: trip.householdId, firmId: trip.workplace.id, workers: 2 });
  c.vehicles = { version: 1, nextId: 2, fleet: [{ id: 1, householdId: trip.householdId, kind: 'motorcycle', bought: c.tick, fuelMl: 4_000, odometerM: 0 }] };
  const mine = planCommutes(c).filter(t => t.householdId === trip.householdId && t.to === trip.to);
  assert.ok(mine.length >= 3);
  assert.deepEqual(mine.map(t => t.mode).filter(m => m === 'drive' || m === 'passenger').sort(), ['drive', 'passenger'], 'a motorcycle carries its rider and one passenger');
  assert.ok(mine.filter(t => t.mode === 'passenger').every(t => t.vehicleId === 1));
  c.vehicles.fleet[0].kind = 'car'; c.vehicles.fleet[0].fuelMl = 40_000;
  assert.equal(planCommutes(c).filter(t => t.householdId === trip.householdId && t.to === trip.to && t.mode === 'passenger').length, Math.min(3, mine.length - 1), 'a car carries up to three passengers');
});

test('vehicles survive a save, the section is absent until the first purchase, and a departed household’s vehicles leave with it', () => {
  const c = grown(5);
  if (!c.vehicles) assert.equal('vehicles' in JSON.parse(serialize(c)), false);
  const d = grown(400);
  assert.ok(d.vehicles && d.vehicles.fleet.length > 0, 'a grown city has bought some');
  const saved = serialize(d); assert.equal(serialize(deserialize(saved)), saved);
  assert.deepEqual(deserialize(saved).vehicles, d.vehicles);
  const gone = d.vehicles!.fleet[0].householdId, view = { vehicles: d.vehicles, households: d.households.filter(h => h.id !== gone) };
  const kept = liveVehicles(view)!;
  assert.ok(kept.fleet.every(v => v.householdId !== gone), 'its vehicles left with it');
  assert.equal(kept.nextId, d.vehicles!.nextId, 'ids are never reused');
  validateVehicles(kept, { households: view.households, tick: d.tick });
});

test('a malformed vehicle section is rejected', () => {
  const c = grown(), h = c.households[0].id;
  const good = { id: 1, householdId: h, kind: 'motorcycle', bought: 0, fuelMl: 100, odometerM: 0 };
  for (const bad of [null, [], { version: 2, nextId: 2, fleet: [good] }, { version: 1, nextId: 1, fleet: [] }, { version: 1, nextId: 2, fleet: [{ ...good, kind: 'tank' }] },
    { version: 1, nextId: 2, fleet: [{ ...good, householdId: 999_999 }] }, { version: 1, nextId: 2, fleet: [{ ...good, fuelMl: 99_999 }] }, { version: 1, nextId: 2, fleet: [{ ...good, bought: c.tick + 1 }] },
    { version: 1, nextId: 3, fleet: [good, { ...good, id: 1 }] }, { version: 1, nextId: 3, fleet: [{ ...good, kind: 'car' }, { ...good, id: 2 }] }, { version: 1, nextId: 2, fleet: [{ ...good, extra: 1 }] }])
    assert.throws(() => validateVehicles(bad, c), /Invalid vehicles save/, JSON.stringify(bad));
  validateVehicles({ version: 1, nextId: 3, fleet: [good, { ...good, id: 2 }] }, c);
  const raw = JSON.parse(serialize(c)); raw.vehicles = { version: 1, nextId: 2, fleet: [{ ...good, kind: 'tank' }] };
  assert.throws(() => deserialize(JSON.stringify(raw)), /Invalid vehicles save/);
});

test('the day’s trips are kept after a step so the screen shows what really happened', () => {
  const c = grown(); step(c);
  const shown = commutesToday(c);
  assert.equal(commutesToday(c), shown, 'the stored day, not a fresh plan');
  assert.ok(shown.length > 0);
});
