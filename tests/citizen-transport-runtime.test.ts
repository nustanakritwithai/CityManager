import test from 'node:test';
import assert from 'node:assert/strict';
import {populationFixture} from './population-capacity-fixture.ts';
import {createCitizenTransport,advanceCitizenTransportMinute,prepareTransportDay,restoreCitizenTransport} from '../src/citizen-transport-runtime.ts';
function city(){const c=populationFixture(1,true),h=c.households[0],f=c.firms[0];c.employment=[{householdId:h.id,firmId:f.id,occupation:'manufacturing' as const,rank:'entry' as const,skill:'general' as const,workers:2}];return c;}
test('canonical day drives family to work and home while preserving money/jobs/city exactly',()=>{
 const c=city(),before=JSON.stringify(c),r=createCitizenTransport(c),base=c.tick*1440;
 const ids=r.fleet.map(car=>car.id);assert.equal(ids.length,1);
 for(let minute=base+1;minute<=base+1200;minute++)advanceCitizenTransportMinute(c,r,minute);
 assert.ok(r.journeys.people.every(p=>p.state==='arrived'));assert.ok(r.fleet.every(car=>car.atHome));
 assert.deepEqual(r.fleet.map(car=>car.id),ids);assert.equal(JSON.stringify(c),before);
 const snapshot=JSON.stringify(r);advanceCitizenTransportMinute(c,r,r.minute);assert.equal(JSON.stringify(r),snapshot);
});
test('new day reuses physical fleet IDs instead of creating a fresh daily car',()=>{
 const c=city(),r=createCitizenTransport(c),base=c.tick*1440;
 for(let minute=base+1;minute<=base+1440;minute++)advanceCitizenTransportMinute(c,r,minute);
 const ids=r.fleet.map(car=>car.id);c.tick++;prepareTransportDay(c,r);
 assert.deepEqual(r.fleet.map(car=>car.id),ids);assert.equal(r.journeys.people.length,2);
 assert.equal(r.journeys.vehicles[0].status,'waiting');
});
test('render ticks cannot skip time or manufacture movements',()=>{
 const c=city(),r=createCitizenTransport(c);assert.throws(()=>advanceCitizenTransportMinute(c,r,r.minute+2));
 assert.equal(r.queue.quantum,0);
});

test('coupled mid-trip snapshot resumes identically without losing vehicle identity',()=>{
 const c=city(),r=createCitizenTransport(c),base=c.tick*1440;
 for(let m=base+1;m<=base+421;m++)advanceCitizenTransportMinute(c,r,m);
 const saved=restoreCitizenTransport(c,JSON.parse(JSON.stringify(r)),r.minute);
 for(let m=r.minute+1;m<=base+1200;m++){advanceCitizenTransportMinute(c,r,m);advanceCitizenTransportMinute(c,saved,m);}
 assert.deepEqual(saved,r);assert.deepEqual(restoreCitizenTransport(c,r,r.minute),r);
});
test('coupled restore rejects wrong clock, foreign people and contradictory car location',()=>{
 const c=city(),r=createCitizenTransport(c);assert.throws(()=>restoreCitizenTransport(c,r,r.minute+1));
 const wrong=structuredClone(r);wrong.fleet[0].cell=999;assert.throws(()=>restoreCitizenTransport(c,wrong,r.minute));
 const foreign=structuredClone(r);foreign.journeys.people[0].citizenId='h:999:m:0';assert.throws(()=>restoreCitizenTransport(c,foreign,r.minute));
});

test('blocked real passengers and the same car survive midnight and return without duplicate morning trips',()=>{
 const c=city(),r=createCitizenTransport(c),base=c.tick*1440,roads=c.cells.map(t=>t.road),ids=r.fleet.map(v=>v.id),people=r.journeys.people.map(p=>p.citizenId);
 c.cells.forEach(t=>t.road=false);
 for(let m=base+1;m<=base+1440;m++)advanceCitizenTransportMinute(c,r,m);
 assert.equal(r.journeys.vehicles[0].status,'moving');assert.equal(r.journeys.vehicles[0].routeIndex,0);
 c.tick++;prepareTransportDay(c,r);assert.deepEqual(r.fleet.map(v=>v.id),ids);assert.deepEqual(r.journeys.people.map(p=>p.citizenId),people);
 assert.deepEqual(restoreCitizenTransport(c,r,r.minute),r);
 c.cells.forEach((t,i)=>t.road=roads[i]);
 for(let m=base+1441;m<=base+2640;m++)advanceCitizenTransportMinute(c,r,m);
 assert.ok(r.fleet.every(v=>v.atHome));assert.equal(r.journeys.people.length,2);assert.equal(r.journeys.vehicles.length,1);
});
test('opening after the work departure window does not replay an already missed morning',()=>{
 const c=city(),r=createCitizenTransport(c,600);assert.equal(r.journeys.vehicles.length,0);assert.equal(r.waiting.length,2);assert.ok(r.waiting.every(p=>p.reason==='missed-departure'));assert.deepEqual(restoreCitizenTransport(c,r,r.minute),r);
});
