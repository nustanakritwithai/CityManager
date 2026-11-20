import test from 'node:test';
import assert from 'node:assert/strict';
import { createCity, landValues, SIZE, type City } from '../src/sim.ts';
import { commutesToday, householdCommutes, rushLoad, RUSH_HOURS } from '../src/commute.ts';
import { happinessTargets } from '../src/resident-happiness.ts';
import { LANE_CAPACITY_VPH } from '../src/traffic/network.ts';
import { setRoadClass } from '../src/road-classes.ts';

/**
 * One local street (one lane each way, 600 vehicles an hour per lane) from a block of homes to a factory 1.8 km away.
 * `drivers` households each send one worker in their own car along that street every morning.
 */
function street(drivers: number): City {
  const c = createCity(17, { starter: false });
  for (let x = 0; x <= 20; x++) c.cells[12 * SIZE + x].road = true;
  const home = 11 * SIZE + 1, work = 11 * SIZE + 19;
  c.cells[home] = { road: false, zone: 'R', building: 10 }; c.cells[work] = { road: false, zone: 'I', building: 20 };
  c.buildings = [{ id: 10, cell: home, zone: 'R', level: 3, age: 3 }, { id: 20, cell: work, zone: 'I', level: 3, age: 3 }];
  c.households = Array.from({ length: drivers }, (_, k) => ({ id: 100 + k, home: 10, members: 1, workforce: 1, dependents: 0, workerSkills: { general: 1, manufacturing: 0, retail: 0 }, skillSource: 'arrival-profile' as const, profile: 'single-worker' as const, origin: 'arrival' as const, wallet: `household:${100 + k}`, lastPurchaseTick: 0, needs: 0 }));
  c.firms = [{ id: 40, building: 20, zone: 'I', crops: { rice: 0, vegetables: 0, sugarcane: 0 }, products: { 'milled-rice': 0, 'canned-food': 0, sugar: 0 }, wallet: 'firm:40', workDays: {}, inventory: 0, cropInventory: 0, cropCost: 0, productionTick: 0, owner: null, profit: 0, lastMonthProfit: 0, monthlyRevenue: 0, monthlyExpense: 0 }];
  c.employment = c.households.map(h => ({ householdId: h.id, firmId: 40, occupation: 'manufacturing' as const, rank: 'entry' as const, skill: 'general' as const, workers: 1 }));
  c.vehicles = { version: 1, nextId: drivers + 1, fleet: c.households.map((h, k) => ({ id: k + 1, householdId: h.id, kind: 'car' as const, bought: 0, fuelMl: 40_000, odometerM: 0 })) };
  return c;
}

test('a handful of cars on a local street lose no time to traffic', () => {
  const c = street(3), trips = commutesToday(c);
  assert.equal(trips.length, 3); assert.ok(trips.every(t => t.mode === 'drive'));
  for (const t of trips) assert.ok(Math.abs(t.minutes! - t.freeMinutes!) < 1e-6, 'at 1 car an hour the street is empty');
});

test('more cars than a street carries jam it: real loads at real capacity, the time lost follows', () => {
  // 2,400 cars over the three-hour rush is 800 an hour on a 600-an-hour lane.
  const c = street(2400), load = Math.max(...rushLoad(c).values());
  assert.ok(Math.abs(load - 2400 / RUSH_HOURS / LANE_CAPACITY_VPH) < 1e-9, 'v/c is the real cars an hour over the lane’s capacity');
  const trips = commutesToday(c);
  assert.ok(trips.every(t => t.mode === 'drive' && t.minutes! > t.freeMinutes! + 1), 'every driver loses minutes in the jam');
  const row = householdCommutes(c)[0];
  assert.ok(row.averageSeconds! - row.freeFlowSeconds! >= 60);
});

test('the jam costs the drivers happiness and the homes land value, which is what moves people elsewhere', () => {
  const quiet = street(3), jammed = street(2400);
  const calm = happinessTargets(quiet).get(100)!.target, stuck = happinessTargets(jammed).get(100)!.target;
  assert.ok(stuck < calm, `stuck in traffic (${stuck}) is less happy than on an empty street (${calm})`);
  const home = 11 * SIZE + 1;
  assert.ok(landValues(jammed)(home) < landValues(quiet)(home), 'a jammed street outside lowers the parcel’s value');
});

test('upgrading the street to a bigger road class relieves the same jam', () => {
  const narrow = street(2400), wide = street(2400);
  setRoadClass(wide, Array.from({ length: 21 }, (_, x) => 12 * SIZE + x), 'arterial');
  const lost = (c: City) => { const r = householdCommutes(c)[0]; return r.averageSeconds! - r.freeFlowSeconds!; };
  assert.ok(lost(wide) < lost(narrow), 'more lanes carry the same cars with less delay');
});
