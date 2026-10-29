import test from 'node:test';
import assert from 'node:assert/strict';
import {planFamilyRides,type TripRequest} from '../src/citizen-trips.ts';
import {createJourneys,departJourneys,moveJourneyVehicle,restoreJourneys} from '../src/citizen-journey.ts';
import {planReturnRide,beginReturnRide} from '../src/citizen-return.ts';
const request=(id:string,route:number[]):TripRequest=>({id,citizenId:id,householdId:1,origin:route[0],destination:route.at(-1)!,route,earliestDeparture:420,latestDeparture:430,canDrive:true});
function arrived(){const s=createJourneys(planFamilyRides([request('driver',[1,2,3,4]),request('partner',[1,2,3])]).rides,400);departJourneys(s,420);while(moveJourneyVehicle(s,s.vehicles[0].vehicleId,()=>true)){}return s;}
test('return picks up actual passengers using same parked vehicle and directed detours',()=>{
 const s=arrived(),before=JSON.stringify(s),id=s.vehicles[0].vehicleId;
 const p=planReturnRide(s,id,1020,(a,b)=>a===4&&b===3?[4,8,7,3]:a===3&&b===1?[3,2,1]:[]);
 assert.equal(p.blocked,null);assert.equal(p.itinerary!.vehicleId,id);
 assert.deepEqual(p.itinerary!.route,[4,8,7,3,2,1]);
 assert.deepEqual(p.itinerary!.pickups,[{routeIndex:0,citizenIds:['driver']},{routeIndex:3,citizenIds:['partner']}]);
 assert.equal(JSON.stringify(s),before);
});
test('road removal blocks return without teleporting anyone or manufacturing a car',()=>{
 const s=arrived(),before=JSON.stringify(s);
 assert.equal(planReturnRide(s,s.vehicles[0].vehicleId,1020,()=>[]).blocked,'no-route');
 assert.equal(JSON.stringify(s),before);
});

test('same car returns, picks up at work, survives reload and delivers everyone home exactly once',()=>{
 let s=arrived();const id=s.vehicles[0].vehicleId;
 const roads=(a:number,b:number)=>a===4&&b===3?[4,8,7,3]:a===3&&b===1?[3,2,1]:[];
 const ready=new Map([['driver',1020],['partner',1020]]);
 assert.equal(beginReturnRide(s,id,1020,roads,ready).blocked,null);
 assert.equal(s.vehicles.length,1);assert.deepEqual(s.vehicles[0].occupants,['driver']);
 assert.equal(s.people.find(p=>p.citizenId==='partner')!.state,'waiting-return');
 assert.equal(s.people.find(p=>p.citizenId==='partner')!.cell,3);
 moveJourneyVehicle(s,id,()=>true);s=restoreJourneys(JSON.parse(JSON.stringify(s)));
 const before=JSON.stringify(s);assert.equal(moveJourneyVehicle(s,id,()=>false),false);assert.equal(JSON.stringify(s),before);
 moveJourneyVehicle(s,id,()=>true);moveJourneyVehicle(s,id,()=>true);
 assert.equal(s.vehicles[0].occupants.length,2);assert.ok(s.people.every(p=>p.state==='in-vehicle'));
 s=restoreJourneys(JSON.parse(JSON.stringify(s)));
 while(moveJourneyVehicle(s,id,()=>true)){}
 assert.ok(s.people.every(p=>p.state==='arrived'&&p.cell===1&&p.vehicleId===null));
 assert.equal(s.vehicles[0].status,'parked');assert.deepEqual(restoreJourneys(s),s);
 assert.equal(beginReturnRide(s,id,1021,roads,ready).blocked,'not-parked');
});
test('late family member delays departure rather than being teleported into car',()=>{
 const s=arrived(),before=JSON.stringify(s);
 const ready=new Map([['driver',1020],['partner',1050]]);
 assert.equal(beginReturnRide(s,s.vehicles[0].vehicleId,1020,()=>[],ready).blocked,'not-ready');
 assert.equal(JSON.stringify(s),before);
});
