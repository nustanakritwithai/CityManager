import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCity, step, serialize, deserialize, connectedRoads, SIZE, type City } from '../src/sim.ts';
import { buildTaxiDepot } from '../src/taxi/placement.ts';
import { taxiFareSatang } from '../src/taxi/mode-share.ts';
import { BUS_FARE_SATANG } from '../src/bus/types.ts';
import {
  FUEL_SATANG_PER_LITRE, REAL_BUS_FARE_SATANG, REAL_FUEL_SATANG_PER_LITRE, REAL_TAXI_METER, REAL_VEHICLE_PRICE, VEHICLE, WALK_MAX_M,
  busFare, fuelPrice, fuelReason, planCommutes, runCommutes, taxiFare, vehiclePrice, vehiclePurchaseReason,
} from '../src/commute.ts';
import { legacyPrices } from './legacy-sizes.ts';

/** Real baht of an amount in satang, at 18.5 real baht to one. */
const real = (satang: number) => satang / 100 * 18.5;
const grown = (prepare: (c: City) => City = c => c, days = 60) => { const c = prepare(createCity(61025)); for (let i = 0; i < days; i++) step(c); return c; };
const give = (c: City, wallet: string, amount: number) => { c.accounts.outside = (c.accounts.outside ?? 0) - amount; c.accounts[wallet] = (c.accounts[wallet] ?? 0) + amount; };
const total = (c: City) => Object.values(c.accounts).reduce((n, v) => n + v, 0);
const longTrip = (c: City) => planCommutes(c).find(t => t.distanceM > WALK_MAX_M && t.mode !== 'unreachable');
const pay = (c: City) => (from: string, to: string, amount: number, reason: string) => {
  const paid = Math.min(amount, from === 'outside' ? amount : c.accounts[from] ?? 0);
  c.accounts[from] = (c.accounts[from] ?? 0) - paid; c.accounts[to] = (c.accounts[to] ?? 0) + paid; c.ledger.push({ tick: c.tick, from, to, amount: paid, reason }); return paid;
};

test('fuel, vehicles, a bus ride and the taxi meter cost what they do in Thailand; a city saved before keeps the old prices', () => {
  assert.ok(Math.abs(real(REAL_FUEL_SATANG_PER_LITRE) - 39.34) < 0.1, 'gasohol 95 at 39.34 baht a litre');
  assert.equal(Math.round(real(REAL_VEHICLE_PRICE.motorcycle)), 39_000, 'a Honda Wave110');
  assert.equal(Math.round(real(REAL_VEHICLE_PRICE.car)), 519_000, 'the cheapest new eco car');
  assert.equal(Math.round(real(REAL_BUS_FARE_SATANG)), 8);
  assert.equal(Math.round(real(REAL_TAXI_METER.firstKm)), 35);
  assert.equal(Math.round(real(REAL_TAXI_METER.perKm) * 10) / 10, 6.5);
  assert.equal(Math.round(real(REAL_TAXI_METER.perJamMinute)), 2);
  const c = createCity(61025), old = legacyPrices(createCity(61025));
  assert.equal(c.priceScale, 1); assert.equal(old.priceScale, undefined);
  assert.equal(fuelPrice(c), REAL_FUEL_SATANG_PER_LITRE); assert.equal(fuelPrice(old), FUEL_SATANG_PER_LITRE);
  for (const kind of ['motorcycle', 'car'] as const) { assert.equal(vehiclePrice(kind, c), REAL_VEHICLE_PRICE[kind]); assert.equal(vehiclePrice(kind, old), VEHICLE[kind].price); }
  assert.equal(busFare(c), REAL_BUS_FARE_SATANG); assert.equal(busFare(old), BUS_FARE_SATANG);
  // 4 km: 35 baht for the first kilometre and 6.50 for each of the other three, plus 2 baht a minute stuck in a jam.
  assert.equal(taxiFare(c, 4, 12, 12), REAL_TAXI_METER.firstKm + 3 * REAL_TAXI_METER.perKm);
  assert.equal(taxiFare(c, 4, 20, 12), REAL_TAXI_METER.firstKm + 3 * REAL_TAXI_METER.perKm + 8 * REAL_TAXI_METER.perJamMinute);
  assert.equal(taxiFare(c, .5, 3, 3), REAL_TAXI_METER.firstKm, 'the first kilometre is paid in full');
  assert.equal(taxiFare(old, 4, 12), taxiFareSatang(4, 12));
  assert.deepEqual(deserialize(serialize(c)), c);
  const bad = JSON.parse(serialize(c)); bad.priceScale = 2;
  assert.throws(() => deserialize(JSON.stringify(bad)), 'an unknown price scale');
});

test('a household buys its motorcycle at the real price and fills the tank at the pump price', { timeout: 300_000 }, () => {
  const c = grown(), trip = longTrip(c)!, h = c.households.find(x => x.id === trip.householdId)!;
  delete c.vehicles;
  give(c, h.wallet, REAL_VEHICLE_PRICE.motorcycle * 3);
  const mine = runCommutes(c, pay(c)).bought.filter(v => v.householdId === h.id);
  assert.equal(mine.length, 1); assert.equal(mine[0].kind, 'motorcycle');
  assert.ok(c.ledger.some(e => e.from === h.wallet && e.to === 'outside' && e.amount === REAL_VEHICLE_PRICE.motorcycle && e.reason === vehiclePurchaseReason('motorcycle', mine[0].id)));
  // An empty tank is filled at the pump price: 4 litres of gasohol, about 157 baht.
  mine[0].fuelMl = 0; give(c, h.wallet, 10_000);
  runCommutes(c, pay(c));
  assert.ok(c.ledger.some(e => e.reason === fuelReason(mine[0].id) && e.from === h.wallet && e.amount === Math.round(VEHICLE.motorcycle.tankMl / 1000 * REAL_FUEL_SATANG_PER_LITRE)));
  assert.equal(total(c), 0);
});

const nb = (i: number) => [i - 1, i + 1, i - SIZE, i + SIZE].filter(n => n >= 0 && n < SIZE * SIZE && (Math.abs((n % SIZE) - (i % SIZE)) <= 1));
const depotSite = (c: City) => { const r = connectedRoads(c); return c.cells.findIndex((x, i) => !x.road && x.zone === null && x.building === null && nb(i).some(n => r.has(n)) && !c.parks.some(p => p.cell === i) && !c.plants.some(p => p.cell === i)); };

test('a taxi ride is charged on the meter: the first kilometre, each one after it and the minutes lost in jams', { timeout: 300_000 }, () => {
  const c = grown(c => c, 20); delete c.vehicles;
  assert.ok(buildTaxiDepot(c, depotSite(c), true).ok);
  const day = runCommutes(c, pay(c)), taxis = day.trips.filter(t => t.mode === 'taxi');
  assert.ok(taxis.length > 0, 'someone with no vehicle takes a taxi');
  for (const t of taxis) assert.equal(t.taxi!.fare, taxiFare(c, t.distanceM / 1000, t.minutes!, t.freeMinutes!));
  for (const t of taxis) assert.ok(t.taxi!.fare >= REAL_TAXI_METER.firstKm);
  // A city saved before keeps the old meter.
  const old = grown(legacyPrices, 20); delete old.vehicles;
  assert.ok(buildTaxiDepot(old, depotSite(old), true).ok);
  for (const t of runCommutes(old, pay(old)).trips.filter(t => t.mode === 'taxi')) assert.equal(t.taxi!.fare, taxiFareSatang(t.distanceM / 1000, t.minutes!));
});
