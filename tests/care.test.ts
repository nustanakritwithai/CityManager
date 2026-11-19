import { test } from 'node:test';
import assert from 'node:assert/strict';
import { populationFixture } from './population-capacity-fixture.ts';
import { step, GATEWAY, SIZE, type City } from '../src/sim.ts';
import { INCIDENT, MEDICAL_REASON, incidentRoll } from '../src/incidents.ts';
import { careTripsToday } from '../src/commute.ts';
import { driveway } from '../src/parking.ts';
import { roadNeighborsFor } from '../src/road-topology.ts';

/** The fixture city the day before someone first falls ill, and who that is. */
function eve(): { c: City; ill: number } {
  const c = populationFixture(32, true); step(c);
  for (let t = c.tick + 1; ; t++) {
    const h = c.households.find(x => x.home !== null && incidentRoll(c.seed, t, x.id, 'illness') < INCIDENT.illness.chance);
    if (h) { while (c.tick < t - 1) step(c); return { c, ill: h.id }; }
  }
}
const homeCell = (c: City, id: number) => c.buildings.find(b => b.id === c.households.find(h => h.id === id)!.home)!.cell;
const near = (a: number, b: number) => Math.abs(a % SIZE - b % SIZE) + Math.abs(Math.floor(a / SIZE) - Math.floor(b / SIZE));
const empty = (c: City, cell: number) => !c.cells[cell].road && c.cells[cell].zone === null && c.cells[cell].building === null;
const billed = (c: City, id: number) => c.ledger.some(e => e.tick === c.tick && e.reason === MEDICAL_REASON && e.from === c.households.find(h => h.id === id)!.wallet);
function addClinic(c: City, cell: number) { c.civic = { version: 1, rules: 'civic-1', sites: [{ id: 900_001, cell, kind: 'clinic', tick: c.tick }] }; }

test('with no clinic in reach someone taken ill travels out to a hospital beyond the gateway and pays the bill', () => {
  const { c, ill } = eve(); step(c);
  assert.ok(billed(c, ill));
  const trip = careTripsToday(c).find(t => t.householdId === ill)!;
  assert.ok(trip, 'the trip out is recorded');
  assert.equal(trip.siteId, null); assert.equal(trip.to, GATEWAY); assert.equal(trip.from, driveway(c, [homeCell(c, ill)]));
  assert.equal(trip.route[0], trip.from); assert.equal(trip.route.at(-1), GATEWAY);
});

test('a clinic covering the home that they can get to treats them in the city: a real trip there, and no bill', () => {
  const { c, ill } = eve(), home = homeCell(c, ill);
  // An empty parcel on a street linked to the home, within the clinic's area.
  const site = c.cells.map((_, i) => i).find(i => empty(c, i) && near(i, home) <= 4 && roadNeighborsFor(c, i).some(n => c.cells[n].road))!;
  assert.ok(site !== undefined); addClinic(c, site); step(c);
  assert.equal(billed(c, ill), false, 'treated at the clinic');
  const trip = careTripsToday(c).find(t => t.householdId === ill)!;
  assert.equal(trip.siteId, 900_001); assert.equal(trip.to, driveway(c, [site]));
  for (const cell of trip.route) assert.equal(c.cells[cell].road, true);
});

test('a clinic covering the home that no street reaches cannot treat them, so they still pay to go outside', () => {
  const { c, ill } = eve(), home = homeCell(c, ill);
  // A clinic within its service area of the home whose streets have been dug up: there is no way in.
  const own = driveway(c, [home]);
  const site = c.cells.map((_, i) => i).find(i => empty(c, i) && near(i, home) >= 2 && near(i, home) <= 7 && !roadNeighborsFor(c, i).includes(own!))!;
  assert.ok(site !== undefined, 'such a parcel exists');
  for (const n of roadNeighborsFor(c, site)) c.cells[n].road = false;
  assert.equal(driveway(c, [site]), null); assert.ok(driveway(c, [home]) !== null, 'the home still has its street');
  addClinic(c, site); step(c);
  assert.ok(billed(c, ill), 'the clinic is in range but there is no way there');
  assert.ok(careTripsToday(c).every(t => t.siteId !== 900_001));
});
