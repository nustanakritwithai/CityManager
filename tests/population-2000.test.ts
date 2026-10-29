import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {population2000Fixture} from './population-capacity-fixture.ts';
import {step,serialize,deserialize,summary,MONTH} from '../src/sim.ts';
import {createParkRuntime,serializeParkSession,deserializeParkSession} from '../src/park-runtime.ts';

test('2000 actual people retain identity, balanced money, bounded employment and complete saves over payroll',t=>{
 const a=population2000Fixture(),original=new Map(a.households.map(h=>[h.id,{...h}])),first=summary(a);
 assert.equal(first.population,2000);assert.equal(first.households,668);assert.equal(first.workforce,1334);assert.equal(a.firms.length,64);
 const raw=serialize(a);assert.deepEqual(deserialize(raw),a);
 const b=deserialize(raw),times:number[]=[],fullSizeTimes:number[]=[];let checkedMonth=false;
 for(let i=0;i<31;i++){
  const fullSize=summary(a).population===2000,began=performance.now();step(a);const elapsed=performance.now()-began;times.push(elapsed);if(fullSize)fullSizeTimes.push(elapsed);step(b);
  assert.deepEqual(a,b);assert.equal(Object.values(a.accounts).reduce((x,y)=>x+y,0),0);
  assert.ok(Object.entries(a.accounts).every(([k,v])=>Number.isSafeInteger(v)&&(k==='outside'||v>=0)));
  const liveIds=new Set(a.households.map(h=>h.id)),left=[...original.values()].filter(h=>!liveIds.has(h.id));
  assert.equal(summary(a).population,2000-left.reduce((n,h)=>n+h.members,0));
  assert.equal(a.migration.departures??0,left.length);
  for(const h of left){assert.equal(a.accounts[h.wallet],0);assert.equal(a.ledger.filter(e=>e.from===h.wallet&&e.to==='outside'&&e.reason==='Emigration savings').length,1);}
  assert.ok(a.households.every(h=>original.has(h.id)));
  if(a.tick%MONTH===0){assert.deepEqual(deserialize(serialize(a)),a);checkedMonth=true;}
 }
 assert.ok(checkedMonth);assert.equal(a.migration.departures,134);const end=summary(a);assert.equal(end.population,1598);assert.ok(end.employed<=768);assert.ok(end.workforce>end.employed,'Real 64-firm job shortage is not hidden by inflating capacity');
 const started=performance.now(),saved=serializeParkSession(a,createParkRuntime(a)),loaded=deserializeParkSession(saved);const saveLoadMs=performance.now()-started;
 assert.deepEqual(loaded.city,a);assert.equal(serializeParkSession(loaded.city,loaded.runtime),saved);
 const sorted=times.sort((x,y)=>x-y);
 t.diagnostic(JSON.stringify({initialPopulation:2000,finalPopulation:end.population,departedHouseholds:a.migration.departures,households:end.households,workforce:end.workforce,employed:end.employed,unemployed:end.workforce-end.employed,firms:a.firms.length,days:31,ticksAtFullPopulation:fullSizeTimes.length,fullPopulationMedianMs:[...fullSizeTimes].sort((x,y)=>x-y)[Math.floor(fullSizeTimes.length/2)],medianTickMs:sorted[15],p95TickMs:sorted[Math.ceil(sorted.length*.95)-1],maxTickMs:sorted.at(-1),saveLoadMs,saveBytes:Buffer.byteLength(saved),note:'Synthetic funding and utility contract. Real current job caps retained; not natural-growth or physical-phone FPS evidence.'}));
});
