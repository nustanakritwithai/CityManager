import test from 'node:test';
import assert from 'node:assert/strict';
import {createCity} from '../src/sim.ts';
import {planFamilyRides,type TripRequest} from '../src/citizen-trips.ts';
import {createJourneys,departJourneys} from '../src/citizen-journey.ts';
import {createRoadQueue,advanceRoadQueue,restoreRoadQueue} from '../src/citizen-road-queue.ts';
const request=(i:number,route:number[]):TripRequest=>({id:String(i),citizenId:String(i),householdId:i,origin:route[0],destination:route.at(-1)!,route,earliestDeparture:420,latestDeparture:430,canDrive:true});
function setup(count:number){const roads=createCity(1,{starter:false});roads.cells.forEach(c=>c.road=false);for(const n of [50,51,52,53])roads.cells[n].road=true;const s=createJourneys(planFamilyRides(Array.from({length:count},(_,i)=>request(i,[50,51,52,53]))).rides,400);departJourneys(s,420);return {roads,s,q:createRoadQueue()};}
test('same-lane cars queue without overlap or timeout ghosting',()=>{
 const {roads,s,q}=setup(20);
 const first=advanceRoadQueue(s,q,roads);assert.equal(first.moved,1);assert.equal(first.waiting,19);
 for(let i=0;i<100;i++){advanceRoadQueue(s,q,roads);const keys=Object.values(q.positions).map(p=>`${p.cell}:${p.incoming}:${p.lane}`);assert.equal(new Set(keys).size,keys.length);}
 assert.equal(s.vehicles.length,20);assert.ok(s.people.every(p=>p.state==='arrived'&&p.cell===53));
});
test('two one-way lanes admit two cars, not an arbitrary count cap',()=>{
 const {roads,s,q}=setup(20);roads.roadTopology={version:1,blocked:[],oneWay:{50:1,51:1,52:1,53:1}};
 assert.equal(advanceRoadQueue(s,q,roads).moved,2);
 assert.deepEqual(Object.values(q.positions).map(p=>p.lane).sort(),[0,1]);
});
test('road removal preserves every queued passenger until the route is restored',()=>{
 const {roads,s,q}=setup(3);roads.cells[51].road=false;
 for(let i=0;i<10;i++)assert.equal(advanceRoadQueue(s,q,roads).moved,0);
 assert.equal(s.people.filter(p=>p.state==='in-vehicle').length,3);assert.equal(s.vehicles.length,3);
 assert.ok(Object.values(q.blocked).every(reason=>reason==='road-closed'));
 roads.cells[51].road=true;for(let i=0;i<30;i++)advanceRoadQueue(s,q,roads);
 assert.ok(s.people.every(p=>p.state==='arrived'));
});

test('2000 real solo cars remain represented while a narrow road is congested',()=>{
 const {roads,s,q}=setup(2000);
 for(let i=0;i<20;i++)advanceRoadQueue(s,q,roads);
 assert.equal(s.vehicles.length,2000);assert.equal(s.people.length,2000);
 assert.equal(new Set(s.people.map(p=>p.citizenId)).size,2000);
 assert.ok(Object.keys(q.blocked).length>1900);
 assert.equal(s.people.filter(p=>p.state==='arrived').length+s.people.filter(p=>p.state==='in-vehicle').length,2000);
});

test('road queue reload preserves occupancy and rejects missing cars and overlapping slots',()=>{
 const {roads,s,q}=setup(3);advanceRoadQueue(s,q,roads);
 assert.deepEqual(restoreRoadQueue(JSON.parse(JSON.stringify(q)),s),q);
 const missing=structuredClone(q);missing.positions={};assert.throws(()=>restoreRoadQueue(missing,s));
 const invalid=structuredClone(q);Object.values(invalid.positions)[0].lane=4;assert.throws(()=>restoreRoadQueue(invalid,s));
});

test('crossing routes reserve their shared junction and both eventually pass',()=>{
 const roads=createCity(1,{starter:false});roads.cells.forEach(c=>c.road=false);
 for(const n of [27,50,51,52,75])roads.cells[n].road=true;
 const s=createJourneys(planFamilyRides([request(1,[50,51,52]),request(2,[27,51,75])]).rides,400);departJourneys(s,420);
 const q=createRoadQueue();assert.equal(advanceRoadQueue(s,q,roads).moved,1);
 assert.equal(Object.keys(q.positions).length,1);assert.equal(Object.values(q.blocked)[0],'junction');
 for(let i=0;i<8;i++)advanceRoadQueue(s,q,roads);
 assert.ok(s.people.every(p=>p.state==='arrived'));
});
