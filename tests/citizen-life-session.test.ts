import test from 'node:test';
import assert from 'node:assert/strict';
import {populationFixture} from './population-capacity-fixture.ts';
import {step,serialize,buildPark} from '../src/sim.ts';
import {createParkRuntime,advanceParkRuntime} from '../src/park-runtime.ts';
import {createCitizenTransport} from '../src/citizen-transport-runtime.ts';
import {advanceCitizenLife,serializeCitizenLife,deserializeCitizenLife} from '../src/citizen-life-session.ts';
function fixture(){const c=populationFixture(1,true),h=c.households[0],f=c.firms[0];c.employment=[{householdId:h.id,firmId:f.id,occupation:'manufacturing' as const,rank:'entry' as const,skill:'general' as const,workers:2}];return c;}
test('coupled traffic clock preserves daily economy exactly against existing park runtime',()=>{
 const a=fixture(),b=structuredClone(a),pa=createParkRuntime(a),pb=createParkRuntime(b),transport=createCitizenTransport(b);
 advanceParkRuntime(a,pa,1440,()=>step(a));advanceCitizenLife(b,pb,transport,1440,()=>step(b));
 assert.equal(serialize(b),serialize(a));assert.equal(transport.minute,b.tick*1440);assert.equal(pb.activity.minute,0);
 assert.deepEqual(pa,pb);
});
test('atomic city life codec resumes mid-trip and rejects mismatched clock without modifying input',()=>{
 const c=fixture(),p=createParkRuntime(c),t=createCitizenTransport(c);advanceCitizenLife(c,p,t,421,()=>step(c));
 const json=serializeCitizenLife(c,p,t),restored=deserializeCitizenLife(json);
 assert.equal(serializeCitizenLife(restored.city,restored.parks,restored.transport),json);
 advanceCitizenLife(c,p,t,779,()=>step(c));advanceCitizenLife(restored.city,restored.parks,restored.transport,779,()=>step(restored.city));
 assert.equal(serializeCitizenLife(restored.city,restored.parks,restored.transport),serializeCitizenLife(c,p,t));
 const bad=JSON.parse(json);bad.transport.minute++;assert.throws(()=>deserializeCitizenLife(JSON.stringify(bad)));
});

test('commuters stuck at work cannot also appear as park visitors after shift end',()=>{
 const c=fixture(),home=c.buildings.find(b=>b.id===c.households[0].home)!;
 const candidates=c.cells.map((_,i)=>i).sort((a,b)=>(Math.abs(a%24-home.cell%24)+Math.abs(Math.floor(a/24)-Math.floor(home.cell/24)))-(Math.abs(b%24-home.cell%24)+Math.abs(Math.floor(b/24)-Math.floor(home.cell/24))));
 assert.ok(candidates.some(i=>buildPark(c,i).ok));
 const p=createParkRuntime(c),t=createCitizenTransport(c),workers=new Set(t.journeys.people.map(p=>p.citizenId));
 advanceCitizenLife(c,p,t,600,()=>step(c));
 assert.ok(t.journeys.vehicles.every(v=>v.status==='parked'&&!v.returnTrip));
 c.cells.forEach(cell=>cell.road=false);
 advanceCitizenLife(c,p,t,600,()=>step(c));
 assert.ok(p.activity.visitors.every(v=>!workers.has(v.citizenId)));
 assert.ok(t.journeys.vehicles.every(v=>!v.returnTrip));
});
