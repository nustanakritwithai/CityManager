import test from 'node:test';
import assert from 'node:assert/strict';
import { createCity, step, serialize, connectedRoads, SIZE, type City } from '../src/sim.ts';
import { BUS_STOP_SPACING } from '../src/bus/buildings.ts';
import { buildBusDepot, buildBusStop, busDepotReason, busStopSiteReason, defaultBusStopSide } from '../src/bus/placement.ts';
import { commutesToday } from '../src/commute.ts';
import { LiveBusService } from '../src/bus/live-service.ts';
import { presentBuses } from '../src/bus/frame.ts';

const nb = (i: number) => [i - 1, i + 1, i - SIZE, i + SIZE].filter(n => n >= 0 && n < SIZE * SIZE && Math.abs((n % SIZE) - (i % SIZE)) <= 1);
const lots = (c: City) => { const r = connectedRoads(c); return c.cells.flatMap((x, i) => !x.road && x.zone === null && x.building === null && nb(i).some(n => r.has(n)) && busDepotReason(c, i, true) === null ? [i] : []); };
const stopCells = (c: City) => { const out: number[] = []; for (let i = 0; i < SIZE * SIZE; i++) if (busStopSiteReason(c, i, defaultBusStopSide(c, i), true) === null && out.every(o => Math.abs(o % SIZE - i % SIZE) + Math.abs(Math.floor(o / SIZE) - Math.floor(i / SIZE)) >= BUS_STOP_SPACING)) out.push(i); return out; };
/** A grown city with a running line of two buses through three stops. */
function withBus(): City {
  const c = createCity(61025); for (let d = 0; d < 20; d++) step(c);
  const l = lots(c); assert.ok(buildBusDepot(c, l[0], true).ok);
  for (const i of stopCells(c).slice(0, 3)) assert.ok(buildBusStop(c, i, defaultBusStopSide(c, i), true).ok);
  const [a, b, d] = c.bus!.stops.map(x => x.id);
  c.bus!.lines.push({ id: c.nextId++, depotId: c.bus!.depots[0].id, stopIds: [a, b, d], busCount: 2, busLevel: 1 });
  step(c);
  return c;
}
/** Played seconds of real time, in render frames of a quarter second. */
const run = (s: LiveBusService, seconds: number, running = true) => { for (let t = 0; t < seconds; t += .25) s.tick(.25, running); };

test('the buses run on their own and board each of today’s real bus commuters at their stop', () => {
  const c = withBus(), riders = commutesToday(c).filter(t => t.mode === 'bus');
  assert.ok(riders.length > 0, 'someone without a vehicle takes the bus');
  const before = serialize(c), s = new LiveBusService(c);
  run(s, 1);
  assert.equal(s.submitted, Math.min(riders.length, s.submitted), 'no more boardings than real riders');
  assert.ok(s.submitted > 0, 'today’s riders are waiting or aboard');
  assert.ok(s.engine.snapshot().length > 0, 'buses are out on the line');
  assert.equal(serialize(c), before, 'running the buses changes nothing in the city');
});

test('over played time the buses carry their riders to the stop nearest work', () => {
  const c = withBus(), s = new LiveBusService(c);
  run(s, 60 * 20); // twenty played minutes on the bus clock
  const ledger = s.engine.ledger();
  assert.ok(ledger.completed + ledger.onboard > 0, 'riders boarded');
  assert.ok(ledger.completed > 0, 'and got off at their stop');
  assert.ok(presentBuses(s, c).drew, 'the bus scene draws the live fleet');
});

test('a paused game boards nobody and moves no bus; a new day boards that day’s riders', () => {
  const c = withBus(), s = new LiveBusService(c);
  run(s, 5, false);
  assert.equal(s.submitted, 0); assert.equal(s.engine.now, 7 * 60);
  run(s, 1);
  const first = s.submitted;
  step(c); run(s, 1);
  assert.ok(s.submitted >= first, 'the next day’s riders join');
});
