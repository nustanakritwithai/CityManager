import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCity, step, serialize, deserialize, buildParallelRoad, GATEWAY, SIZE, type City } from '../src/sim.ts';
import { WALK_MAX_M, canWalk, freightRoute, shoppingTrips } from '../src/commute.ts';
import { driveway } from '../src/parking.ts';
import { TILE_LENGTH_M } from '../src/traffic/network.ts';

const grown = (days = 60) => { const c = createCity(61025); for (let i = 0; i < days; i++) step(c); return c; };
const cellOfBuilding = (c: City, id: number) => c.buildings.find(b => b.id === id)!.cell;
const purchasesToday = (c: City) => {
  const out = new Set<string>();
  for (const e of c.ledger) {
    const m = /^Household #([1-9]\d*) purchase$/.exec(e.reason);
    const h = c.households.find(x => x.wallet === e.from), shop = c.firms.find(f => f.wallet === e.to);
    if (e.tick === c.tick && m && h && shop) out.add(`${h.id}:${shop.id}`);
  }
  for (const e of c.cropLedger) {
    const h = c.households.find(x => x.wallet === e.to), shop = c.firms.find(f => f.wallet === e.from);
    if (e.tick === c.tick && e.kind === 'consumption' && h && shop) out.add(`${h.id}:${shop.id}`);
  }
  return out;
};

test('every purchase today is a real trip from the home driveway to the shop and back, and every trip is a purchase', () => {
  const c = grown(), trips = shoppingTrips(c), bought = purchasesToday(c);
  assert.ok(trips.length > 0, 'households shop');
  assert.deepEqual(new Set(trips.map(t => `${t.householdId}:${t.shopFirmId}`)), bought);
  for (const t of trips) {
    const h = c.households.find(x => x.id === t.householdId)!, shop = c.firms.find(f => f.id === t.shopFirmId)!;
    assert.equal(t.from, driveway(c, [cellOfBuilding(c, h.home!)])); assert.equal(t.to, driveway(c, [cellOfBuilding(c, shop.building)]));
    assert.equal(t.route[0], t.from); assert.equal(t.route.at(-1), t.to);
    for (const cell of t.route) assert.equal(c.cells[cell].road, true);
    assert.equal(t.distanceM, (t.route.length - 1) * TILE_LENGTH_M);
    if (t.mode === 'drive') {
      assert.ok(t.distanceM > WALK_MAX_M, 'a vehicle only beyond walking distance');
      assert.ok(c.vehicles?.fleet.some(v => v.id === t.vehicleId && v.householdId === h.id), 'the household’s own vehicle');
      assert.ok(freightRoute(c, [t.to], [t.from]), 'and it can legally drive home again');
    }
    assert.ok(t.minutes > 0 || t.distanceM === 0);
  }
  assert.deepEqual(shoppingTrips(c), trips, 'the same day always gives the same trips');
});

test('on foot a one-way street can be walked either way; a street dug up cannot be crossed', () => {
  const c = grown();
  const roads = c.cells.map((x, i) => (x.road ? i : -1)).filter(i => i >= 0);
  const d = (a: number, b: number) => Math.abs(a % SIZE - b % SIZE) + Math.abs(Math.floor(a / SIZE) - Math.floor(b / SIZE));
  const far = roads.reduce((a, b) => (d(b, GATEWAY) > d(a, GATEWAY) ? b : a));
  assert.equal(buildParallelRoad(c, far, GATEWAY, true).ok, true);
  assert.equal(freightRoute(c, [GATEWAY], [far]), null, 'a truck cannot drive in against the one-way');
  assert.equal(canWalk(c, [GATEWAY], [far]), true, 'but a person can walk in');
  const middle = roads.find(i => i !== GATEWAY && i !== far && d(i, GATEWAY) === Math.floor(d(far, GATEWAY) / 2))!;
  c.cells[middle].road = false;
  assert.equal(canWalk(c, [GATEWAY], [far]), false, 'with the street dug up nobody gets across');
});

test('shopping trips change nothing in the city or its save', () => {
  const c = grown(), before = serialize(c);
  shoppingTrips(c); shoppingTrips(c);
  assert.equal(serialize(c), before);
  assert.equal(serialize(deserialize(before)), before);
});
