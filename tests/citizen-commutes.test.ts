import test from 'node:test';
import assert from 'node:assert/strict';
import { createCity } from '../src/sim.ts';
import { planCitizenCommutes, citizenDriveRoute } from '../src/citizen-commutes.ts';
import { populationFixture } from './population-capacity-fixture.ts';
import { roadDriveAllowed } from '../src/road-topology.ts';

test('one allocation for two real workers produces two stable citizen requests',()=>{
 const c=populationFixture(1,true),h=c.households[0],f=c.firms[0];
 c.employment=[{householdId:h.id,firmId:f.id,skill:'general',workers:2}];
 const before=JSON.stringify(c), intents=planCitizenCommutes(c);
 assert.equal(intents.length,2);assert.equal(new Set(intents.map(i=>i.citizen.citizenId)).size,2);
 assert.ok(intents.every(i=>i.request&&i.blocked===null));
 assert.ok(intents.every(i=>i.request!.route.slice(1).every((n,j)=>roadDriveAllowed(c,i.request!.route[j],n))));
 assert.equal(JSON.stringify(c),before);
});
test('missing homes and blocked routes retain workers instead of deleting them',()=>{
 const c=populationFixture(1,true),h=c.households[0],f=c.firms[0];
 c.employment=[{householdId:h.id,firmId:f.id,skill:'general',workers:2}];
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
