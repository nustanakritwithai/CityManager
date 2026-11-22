import test from 'node:test';
import assert from 'node:assert/strict';
import { createCity, step, serialize, connectedRoads, SIZE, type City } from '../src/sim.ts';
import { buildTaxiDepot } from '../src/taxi/placement.ts';
import { TAXI_DEPOT_UNITS } from '../src/taxi/sites.ts';
import { TAXI_FARE_REASON, TAXI_TRIPS_PER_CAR, WALK_MAX_M, planCommutes, runCommutes, taxiFare } from '../src/commute.ts';
import { trafficPlan } from '../src/traffic-plan.ts';
import { TILE_LENGTH_M } from '../src/traffic/network.ts';

const nb = (i: number) => [i - 1, i + 1, i - SIZE, i + SIZE].filter(n => n >= 0 && n < SIZE * SIZE && (Math.abs((n % SIZE) - (i % SIZE)) <= 1));
const sites = (c: City) => { const r = connectedRoads(c); return c.cells.flatMap((x, i) => !x.road && x.zone === null && x.building === null && nb(i).some(n => r.has(n)) && !c.parks.some(p => p.cell === i) && !c.plants.some(p => p.cell === i) && !c.education?.campuses.some(k => k.cell === i) ? [i] : []); };
/** A grown city whose households have no vehicles yet, with one taxi depot. */
function withDepot(): City {
  const c = createCity(61025); for (let d = 0; d < 20; d++) step(c);
  delete c.vehicles;
  assert.ok(buildTaxiDepot(c, sites(c)[0], true).ok);
  return c;
}
const pay = (c: City) => (from: string, to: string, amount: number, reason: string) => {
  const paid = Math.min(amount, from === 'outside' ? amount : c.accounts[from] ?? 0);
  c.accounts[from] = (c.accounts[from] ?? 0) - paid; c.accounts[to] = (c.accounts[to] ?? 0) + paid; c.ledger.push({ tick: c.tick, from, to, amount: paid, reason }); return paid;
};

test('someone with no vehicle and no bus for a long trip takes a taxi there and back on a legal route', () => {
  const c = withDepot(), trips = planCommutes(c), taxis = trips.filter(t => t.mode === 'taxi');
  assert.ok(taxis.length > 0, 'a long trip is taken by taxi');
  for (const t of taxis) {
    assert.ok(t.distanceM > WALK_MAX_M, 'only beyond walking distance');
    assert.equal(t.distanceM, (t.route!.length - 1) * TILE_LENGTH_M);
    const minutes = t.minutes!, km = t.distanceM / 1000;
    assert.equal(t.taxi!.fare, taxiFare(c, km, minutes, t.freeMinutes!), 'the meter: the first kilometre, each one after it and the minutes lost in jams');
  }
  assert.equal(trips.filter(t => t.mode === 'walk-long').length, 0, 'nobody is left to walk a long way while a taxi is free');
});

test('a depot’s taxis make only so many trips each morning', () => {
  const c = withDepot(), depot = c.taxi!.depots[0], cap = TAXI_DEPOT_UNITS[depot.level] * TAXI_TRIPS_PER_CAR;
  // Many more long commutes than the depot can carry: the extra people walk.
  const job = c.employment[0];
  c.employment.push({ ...job, workers: cap * 3 });
  const taxis = planCommutes(c).filter(t => t.mode === 'taxi');
  assert.ok(taxis.length <= cap);
});

test('the fare there and back goes to the city, and a household that cannot pay walks instead', () => {
  const c = withDepot(), riders = planCommutes(c).filter(t => t.mode === 'taxi'), before = c.accounts.treasury;
  const poor = riders[0].householdId, wallet = c.households.find(h => h.id === poor)!.wallet;
  c.accounts.outside += c.accounts[wallet]; c.accounts[wallet] = 0;
  const day = runCommutes(c, pay(c));
  const fares = c.ledger.filter(e => e.reason === TAXI_FARE_REASON);
  assert.ok(fares.every(e => e.to === 'treasury'));
  assert.equal(c.accounts.treasury - before, fares.reduce((n, e) => n + e.amount, 0));
  assert.ok(day.trips.filter(t => t.householdId === poor).every(t => t.mode !== 'taxi'), 'no money, no taxi');
  assert.equal(Object.values(c.accounts).reduce((n, v) => n + v, 0), 0);
});

test('taxis carrying commuters drive on the map in taxi livery, and planning changes nothing', () => {
  const c = withDepot(), before = serialize(c);
  const plan = trafficPlan(c), taxis = plan.cars.filter(v => v.key.startsWith('taxi:'));
  assert.ok(taxis.length > 0);
  for (const v of taxis) assert.ok(v.route.length > 1);
  assert.equal(serialize(c), before);
});
