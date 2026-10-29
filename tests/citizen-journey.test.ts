import test from 'node:test';
import assert from 'node:assert/strict';
import {planFamilyRides, type TripRequest} from '../src/citizen-trips.ts';
import {createJourneys, departJourneys, moveJourneyVehicle, restoreJourneys, prepareJourneyFrame} from '../src/citizen-journey.ts';
const r=(id:string,route:number[]):TripRequest=>({id,citizenId:id,householdId:1,origin:route[0],destination:route.at(-1)!,route,earliestDeparture:420,latestDeparture:430,canDrive:true});
const fixture=()=>createJourneys(planFamilyRides([r('driver',[1,2,3,4]),r('partner',[1,2,3])]).rides,400);
test('time passing never teleports passengers through traffic',()=>{
 const s=fixture();departJourneys(s,419);assert.equal(s.vehicles[0].status,'waiting');
 departJourneys(s,420);assert.equal(s.people.filter(p=>p.state==='in-vehicle').length,2);
 departJourneys(s,1000);assert.equal(s.vehicles[0].routeIndex,0);
 const before=JSON.stringify(s);assert.equal(moveJourneyVehicle(s,s.vehicles[0].vehicleId,()=>false),false);assert.equal(JSON.stringify(s),before);
});
test('each passenger arrives at own stop and same vehicle remains at final workplace',()=>{
 const s=fixture();departJourneys(s,420);const id=s.vehicles[0].vehicleId;
 moveJourneyVehicle(s,id,()=>true);moveJourneyVehicle(s,id,()=>true);
 assert.equal(s.people.find(p=>p.citizenId==='partner')!.state,'arrived');
 assert.equal(s.people.find(p=>p.citizenId==='driver')!.state,'in-vehicle');
 moveJourneyVehicle(s,id,()=>true);assert.equal(s.vehicles[0].status,'parked');assert.equal(s.vehicles[0].routeIndex,3);
 assert.ok(s.people.every(p=>p.state==='arrived'));assert.equal(moveJourneyVehicle(s,id,()=>true),false);
});
test('mid-trip save restores exactly and rejects duplicated or teleported passengers',()=>{
 const s=fixture();departJourneys(s,420);moveJourneyVehicle(s,s.vehicles[0].vehicleId,()=>true);
 const restored=restoreJourneys(JSON.parse(JSON.stringify(s)));assert.deepEqual(restored,s);
 restored.people[0].cell=999;assert.throws(()=>restoreJourneys(restored));
 const duplicate=structuredClone(s);duplicate.people[1]=duplicate.people[0];assert.throws(()=>restoreJourneys(duplicate));
 const missing=structuredClone(s);missing.vehicles[0].occupants.pop();assert.throws(()=>restoreJourneys(missing));
});
test('co-located origin and destination is an explicit immediate drop, not a road journey',()=>{
 const s=createJourneys(planFamilyRides([r('a',[1])]).rides,400);departJourneys(s,420);
 assert.equal(s.vehicles[0].status,'parked');assert.equal(s.people[0].state,'arrived');assert.deepEqual(restoreJourneys(s),s);
});

test('indexed motion handles 2000 solo drivers without losing identity',()=>{
 const requests=Array.from({length:2000},(_,i)=>({...r(String(i),[1,2,3]),householdId:i}));
 const s=createJourneys(planFamilyRides(requests).rides,400);departJourneys(s,420);
 const frame=prepareJourneyFrame(s);
 for(const v of s.vehicles)assert.equal(moveJourneyVehicle(s,v.vehicleId,()=>true,frame),true);
 assert.equal(s.people.filter(p=>p.state==='in-vehicle'&&p.cell===2).length,2000);
 assert.deepEqual(restoreJourneys(JSON.parse(JSON.stringify(s))),s);
 s.people=[...s.people];assert.throws(()=>moveJourneyVehicle(s,s.vehicles[0].vehicleId,()=>true,frame));
});
