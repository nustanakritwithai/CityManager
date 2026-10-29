import test from 'node:test';
import assert from 'node:assert/strict';
import { createCity } from '../src/sim.ts';
import { planCitizenCommutes, citizenDriveRoute } from '../src/citizen-commutes.ts';
import { populationFixture } from './population-capacity-fixture.ts';
import { roadDriveAllowed } from '../src/road-topology.ts';

test('one allocation for two real workers produces two stable citizen requests',()=>{
 const c=populationFixture(1,true),h=c.households[0],f=c.firms[0];
 c.employment=[{householdId:h.id,firmId:f.id,occupation:'manufacturing' as const,rank:'entry' as const,skill:'general',workers:2}];
 const before=JSON.stringify(c), intents=planCitizenCommutes(c);
 assert.equal(intents.length,2);assert.equal(new Set(intents.map(i=>i.citizen.citizenId)).size,2);
 assert.ok(intents.every(i=>i.request&&i.blocked===null));
 assert.ok(intents.every(i=>i.request!.route.slice(1).every((n,j)=>roadDriveAllowed(c,i.request!.route[j],n))));
 assert.equal(JSON.stringify(c),before);
});
test('missing homes and blocked routes retain workers instead of deleting them',()=>{
 const c=populationFixture(1,true),h=c.households[0],f=c.firms[0];
 c.employment=[{householdId:h.id,firmId:f.id,occupation:'manufacturing' as const,rank:'entry' as const,skill:'general',workers:2}];
 c.cells.forEach(cell=>cell.road=false);
 assert.deepEqual(planCitizenCommutes(c).map(i=>i.blocked),['no-route','no-route']);
 h.home=null;assert.deepEqual(planCitizenCommutes(c).map(i=>i.blocked),['missing-home','missing-home']);
});
test('directed local route does not require the external city gateway',()=>{
 const c=createCity(1,{starter:false});c.cells.forEach(cell=>cell.road=false);
 for(const i of [50,51,52])c.cells[i].road=true;
 c.roadTopology={version:1,blocked:[],oneWay:{50:1,51:1,52:1}};
 assert.deepEqual(citizenDriveRoute(c,50,52),[50,51,52]);
 assert.deepEqual(citizenDriveRoute(c,52,50),[]);
});

test('a real reserved teacher is a commuter, not a second copy of the employed member',async()=>{
 const {enableEducation,buildCampus}=await import('../src/sim.ts');
 const c=populationFixture(1,true),h=c.households[0],f=c.firms[0];
 c.employment=[{householdId:h.id,firmId:f.id,occupation:'manufacturing',rank:'entry',skill:'general',workers:1}];
 enableEducation(c);const site=c.cells.findIndex((cell,i)=>!cell.road&&cell.building===null&&cell.zone===null&&[i-1,i+1,i-24,i+24].some(n=>c.cells[n]?.road));assert.equal(buildCampus(c,site,'school').ok,true);
 const campus=c.education!.campuses[0];c.education!.people=[{householdId:h.id,basic:1,higher:0,school:0,university:0,teacher:1,professor:0,campusId:campus.id,progress:0}];
 const before=JSON.stringify(c),intents=planCitizenCommutes(c);assert.equal(intents.length,2);assert.equal(new Set(intents.map(i=>i.citizen.citizenId)).size,2);assert.ok(intents.some(i=>i.workCell===site&&i.citizen.campusJobId===campus.id));assert.equal(JSON.stringify(c),before);
});
