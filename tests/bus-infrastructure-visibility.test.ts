import test from 'node:test';
import assert from 'node:assert/strict';
import { busCommuteBrowserFixture } from './bus-commute-browser-fixture.ts';
import { deserializeParkSession, serializeParkSession } from '../src/park-runtime.ts';
import { BusEngine } from '../src/bus/engine.ts';
import { BusEventFanout, presentBuses } from '../src/bus/frame.ts';
import { publishBusMap } from '../src/bus/map-state.ts';
import { busCellNote } from '../src/bus/map-paint.ts';

test('a saved city retains stop and depot markers across traffic off, reload and on', () => {
  const {city,runtime}=deserializeParkSession(busCommuteBrowserFixture().raw);
  const before=serializeParkSession(city,runtime), stops=city.bus!.stops.map(s=>s.id), depots=city.bus!.depots.map(d=>d.id);
  const fan=new BusEventFanout();let calls=0;fan.subscribe(()=>calls++);
  const off=presentBuses(null,city,fan);
  assert.deepEqual(off.draw.stops.map(s=>s.id),stops); assert.deepEqual(off.draw.depots.map(d=>d.id),depots);
  assert.deepEqual(off.draw.buses,[]);assert.deepEqual(off.draw.crowds,[]);assert.deepEqual(off.draw.lines,[]);assert.deepEqual(off.draw.captions,[]);assert.equal(calls,0);
  assert.ok(off.draw.stops.every(s=>s.waiting===null));
  publishBusMap(off.draw);try { const note=busCellNote(city.bus!.stops[0].cell);assert.match(note!,/ป้ายรถเมล์/);assert.doesNotMatch(note!,/รอ/); } finally {publishBusMap(null);}
  assert.equal(serializeParkSession(city,runtime),before,'drawing does not alter the save');
  const reloaded=deserializeParkSession(before),reloadedOff=presentBuses(null,reloaded.city,fan);
  assert.deepEqual(reloadedOff.draw.stops.map(s=>s.id),stops); assert.deepEqual(reloadedOff.draw.depots.map(d=>d.id),depots);
  const engine=new BusEngine(reloaded.city,420),on=presentBuses({bus:{engine}},reloaded.city,fan);
  assert.deepEqual(on.draw.stops.map(s=>s.id),stops);assert.deepEqual(on.draw.depots.map(d=>d.id),depots);
  assert.equal(serializeParkSession(reloaded.city,reloaded.runtime),before);assert.equal(calls,1);
});

test('offline infrastructure does not plan routes or read traffic state', () => {
  const {city}=deserializeParkSession(busCommuteBrowserFixture().raw);
  const bus=city.bus!;
  Object.defineProperty(bus,'lines',{get(){throw Error('must not plan routes while traffic is off');}});
  const frame=presentBuses(null,city);
  assert.equal(frame.draw.stops.length,2);assert.equal(frame.draw.depots.length,1);
  assert.deepEqual(frame.draw.lines,[]);assert.deepEqual(frame.draw.captions,[]);
});
