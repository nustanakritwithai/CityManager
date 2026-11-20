import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCity, step, serialize, deserialize, buildCivic, civicSiteReason, bulldoze, SIZE, type City } from '../src/sim.ts';
import { civicAt, civicFeeReason } from '../src/civic/sites.ts';
import { leisureTrips } from '../src/commute.ts';
import { driveway } from '../src/parking.ts';
import { roadNeighborsFor } from '../src/road-topology.ts';
import { trafficPlan } from '../src/traffic-plan.ts';

const distance = (a: number, b: number) => Math.abs(a % SIZE - b % SIZE) + Math.abs(Math.floor(a / SIZE) - Math.floor(b / SIZE));
/** The starter city with its factories and farms closed (so residents can staff a venue) and a restaurant beside the homes. */
function restaurantCity(days = 12) {
  const c = createCity(61025); for (let i = 0; i < 60; i++) step(c);
  const home = c.buildings.find(b => b.zone === 'R')!.cell;
  for (const b of c.buildings.filter(b => b.zone === 'I' || b.zone === 'F')) assert.equal(bulldoze(c, b.cell).ok, true);
  const cell = c.cells.map((_, i) => i).filter(i => civicSiteReason(c, i, 'restaurant') === null).sort((a, b) => distance(a, home) - distance(b, home))[0];
  assert.equal(buildCivic(c, cell, 'restaurant').ok, true);
  for (let i = 0; i < days; i++) step(c);
  return { c, site: civicAt(c, cell)! };
}
const feesToday = (c: City, reason: string) => c.ledger.filter(e => e.tick === c.tick && e.reason === reason);

test('every fee paid at a venue today is an evening out from the home driveway to the venue and back', () => {
  const { c, site } = restaurantCity(), fees = feesToday(c, civicFeeReason('restaurant', site.id));
  assert.ok(fees.length > 0, 'households go out to eat');
  const trips = leisureTrips(c);
  assert.equal(trips.length, new Set(fees.map(e => e.from)).size, 'one trip per household that paid');
  for (const t of trips) {
    const h = c.households.find(x => x.id === t.householdId)!;
    assert.ok(fees.some(e => e.from === h.wallet));
    assert.equal(t.siteId, site.id); assert.equal(t.kind, 'restaurant');
    assert.equal(t.from, driveway(c, [c.buildings.find(b => b.id === h.home)!.cell])); assert.equal(t.to, driveway(c, site.cells ?? [site.cell]));
    for (const cell of t.route) assert.equal(c.cells[cell].road, true);
  }
  const before = serialize(c);
  assert.ok(trafficPlan(c).walkers.some(w => w.key.startsWith('outing:')) || trafficPlan(c).cars.some(v => v.key.endsWith(':outing')), 'the outing shows on the map');
  assert.equal(serialize(c), before, 'and planning it changes nothing');
});

test('nobody visits a venue they cannot get to along linked streets', () => {
  const { c, site } = restaurantCity(), twin = deserialize(serialize(c));
  step(twin);
  assert.ok(feesToday(twin, civicFeeReason('restaurant', site.id)).length > 0, 'with its streets the restaurant has guests that day');
  // Dig up every street touching the restaurant: it is still staffed, but no one can reach its door.
  for (const part of site.cells ?? [site.cell]) for (const n of roadNeighborsFor(c, part)) c.cells[n].road = false;
  assert.equal(driveway(c, site.cells ?? [site.cell]), null);
  step(c);
  assert.equal(feesToday(c, civicFeeReason('restaurant', site.id)).length, 0);
  assert.equal(leisureTrips(c).length, 0);
  assert.equal(Object.values(c.accounts).reduce((n, v) => n + v, 0), 0);
});
