import test from 'node:test';
import assert from 'node:assert/strict';
import {TrafficClock} from '../src/traffic/clock.ts';
import type {City} from '../src/sim.ts';
const city = () => ({cells:Array.from({length:576},(_,i)=>({road:[25,26,27,28,50].includes(i)}))}) as City;
const demand = {households:[{cell:25,amount:2000}],jobs:[{cell:28,amount:1000}],schoolSeats:[],parks:[],freight:[],entrance:25};
const clock = () => new TrafficClock({enabled:true,conservedFlow:true,snapshot:()=>demand});

test('representative clock cannot accidentally activate or restore conserved demand',()=>{
  const c=city(), legacy=new TrafficClock({enabled:true,snapshot:()=>demand});
  legacy.advance(c,0); legacy.advance(c,8*60);
  assert.ok(legacy.totals.vehicles>0);
  assert.equal(legacy.flow.snapshot.offered,0);
  assert.throws(()=>legacy.exportState(),/conserved clock/);
  const source=clock();source.advance(c,0);source.advance(c,8*60);
  assert.throws(()=>legacy.restoreState(c,8*60,source.exportState()),/conserved clock/);
});

test('bounded catch-up survives export/restore and drains once without dropping elapsed demand',()=>{
  const c=city(), a=clock(), b=clock(), reference=clock();
  a.advance(c,0); reference.advance(c,0);
  a.advance(c,192*60); assert.equal(a.pendingPeriods,24);
  b.restoreState(c,192*60,JSON.parse(JSON.stringify(a.exportState())));
  assert.equal(b.pendingPeriods,24);
  a.advance(c,192*60); b.advance(c,192*60);
  for(let hour=1;hour<=192;hour++) reference.advance(c,hour*60);
  assert.deepEqual(a.flow.snapshot,reference.flow.snapshot);
  assert.deepEqual(b.exportState(),a.exportState());
  const before=b.exportState();b.advance(c,192*60);assert.deepEqual(b.exportState(),before);
});

test('clock restore rejects missing totals, duplicate routes and a different observed time atomically',()=>{
  const c=city(), original=clock(); original.advance(c,0);original.advance(c,8*60);
  const state=original.exportState(), target=clock(), before=target.exportState();
  const missing=structuredClone(state); delete (missing.totals as Partial<typeof missing.totals>).unserved;
  assert.throws(()=>target.restoreState(c,8*60,missing));
  const duplicate=structuredClone(state); duplicate.routes.push(duplicate.routes[0]);
  assert.throws(()=>target.restoreState(c,8*60,duplicate));
  assert.throws(()=>target.restoreState(c,9*60,state));
  assert.deepEqual(target.exportState(),before);
});
