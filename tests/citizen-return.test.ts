import test from 'node:test';
import assert from 'node:assert/strict';
import {planFamilyRides,type TripRequest} from '../src/citizen-trips.ts';
import {createJourneys,departJourneys,moveJourneyVehicle} from '../src/citizen-journey.ts';
import {planReturnRide} from '../src/citizen-return.ts';
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
