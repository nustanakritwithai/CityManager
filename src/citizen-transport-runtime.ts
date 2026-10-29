/** Canonical-minute transport sidecar. Not yet enabled in the production client.
 * No wallet, job, production or household count is modified by this module.
 */
import {type City} from './sim.ts';
import {parkActivityCitizens,WORK_END_MINUTE} from './park-activity.ts';
import {planCitizenCommutes} from './citizen-commutes.ts';
import {planFamilyRides,type RidePlan} from './citizen-trips.ts';
import {createJourneys,departJourneys,journeyRoute,restoreJourneys,type JourneyState} from './citizen-journey.ts';
import {createRoadQueue,advanceRoadQueue,restoreRoadQueue,type RoadQueueState} from './citizen-road-queue.ts';
import {beginReturnRide} from './citizen-return.ts';
import {roadRoute} from './traffic-plan.ts';
export type FleetCar={id:string;householdId:number;atHome:boolean;cell:number};
export type CitizenTransportRuntime={version:1;minute:number;plannedDay:number;nextCarId:number;fleet:FleetCar[];
  journeys:JourneyState;queue:RoadQueueState;waiting:{citizenId:string;reason:string}[]};
export function createCitizenTransport(city:City,minuteOfDay=0):CitizenTransportRuntime {
 if(!Number.isSafeInteger(minuteOfDay)||minuteOfDay<0||minuteOfDay>=1440)throw new RangeError('Invalid transport start minute');
 const minute=city.tick*1440+minuteOfDay;
 const r:CitizenTransportRuntime={version:1,minute,plannedDay:-1,nextCarId:1,fleet:[],journeys:createJourneys([],minute),queue:createRoadQueue(),waiting:[]};
 prepareTransportDay(city,r);return r;
}
/** Emigration removes only people whose entire household left the canonical city.
 * Active surviving travelers retain their vehicle and location across midnight.
 */
export function prepareTransportDay(city:City,r:CitizenTransportRuntime):void {
 if(r.plannedDay===city.tick)return;
 const households=new Set(city.households.map(h=>h.id));
 const livePeople=new Set(parkActivityCitizens(city).map(p=>p.citizenId));
 const carried=r.journeys.vehicles.filter(v=>households.has(v.ride.householdId)&&!(v.status==='parked'&&v.returnTrip));
 for(const v of carried)if(v.ride.passengerIds.some(id=>!livePeople.has(id)))throw new Error('Active household member roster changed; transport requires reconciliation');
 const carriedPeople=new Set(carried.flatMap(v=>v.ride.passengerIds));
 r.fleet=r.fleet.filter(car=>households.has(car.householdId));
 const busy=new Set(carried.map(v=>v.vehicleId));
 const available=r.fleet.filter(car=>car.atHome&&!busy.has(car.id)).sort((a,b)=>a.id.localeCompare(b.id));
 const intents=planCitizenCommutes(city).filter(i=>!carriedPeople.has(i.citizen.citizenId));
 r.waiting=intents.filter(i=>i.blocked).map(i=>({citizenId:i.citizen.citizenId,reason:i.blocked!}));
 const requests=intents.flatMap(i=>i.request?[i.request]:[]),plans=planFamilyRides(requests);
 for(const wait of plans.waiting){const request=requests.find(q=>q.id===wait.requestId)!;r.waiting.push({citizenId:request.citizenId,reason:wait.reason});}
 const rides:RidePlan[]=plans.rides.map(plan=>{
   let car=available.find(car=>car.householdId===plan.householdId);
   if(car)available.splice(available.indexOf(car),1);
   else {car={id:`vehicle:${r.nextCarId++}`,householdId:plan.householdId,atHome:true,cell:plan.route[0]};r.fleet.push(car);}
   // At home means inside the home garage; its current road frontage is authoritative.
   car.cell=plan.route[0];return {...plan,id:car.id};
 });
 const fresh=createJourneys(rides,r.minute);
 r.journeys={version:1,minute:r.minute,vehicles:[...carried,...fresh.vehicles],people:[...r.journeys.people.filter(p=>carriedPeople.has(p.citizenId)),...fresh.people]};
 const activeIds=new Set(carried.map(v=>v.vehicleId));
 for(const record of [r.queue.positions,r.queue.waiting,r.queue.blocked])for(const id of Object.keys(record))if(!activeIds.has(id))delete record[id];
 r.plannedDay=city.tick;
}
/** Exactly one canonical minute per call. Repeated calls for the same minute are
 * true no-ops; callers cannot make traffic move faster by rendering more frames.
 * Advance the economic day externally before the first minute of its next day.
 */
export function advanceCitizenTransportMinute(city:City,r:CitizenTransportRuntime,minute:number):void {
 if(minute===r.minute)return;
 if(!Number.isSafeInteger(minute)||minute!==r.minute+1)throw new RangeError('Transport requires contiguous game minutes');
 const day=Math.floor(minute/1440);
 if(city.tick!==day&&!(minute%1440===0&&city.tick===day-1))throw new Error('Transport and city days differ');
 prepareTransportDay(city,r);
 departJourneys(r.journeys,minute);
 const roads=new Set(city.cells.flatMap((cell,index)=>cell.road?[index]:[]));
 // Cache only for this immutable road snapshot/minute, never across construction edits.
 const routes=new Map<string,number[]>();
 const between=(a:number,b:number)=>{const key=`${a}:${b}`;let path=routes.get(key);if(!path){path=roadRoute(roads,a,b,city);routes.set(key,path);}return path;};
 for(const v of r.journeys.vehicles) {
   const end=Math.floor(v.ride.departure/1440)*1440+WORK_END_MINUTE;
   if(v.status==='parked'&&!v.returnTrip&&minute>=end)beginReturnRide(r.journeys,v.vehicleId,minute,between,new Map(v.ride.passengerIds.map(id=>[id,end])));
 }
 advanceRoadQueue(r.journeys,r.queue,city);
 const cars=new Map(r.fleet.map(car=>[car.id,car]));
 for(const v of r.journeys.vehicles){const car=cars.get(v.vehicleId)!;car.cell=journeyRoute(v)[v.routeIndex];car.atHome=v.status==='waiting'||(v.status==='parked'&&!!v.returnTrip);}
 r.minute=minute;
}

/** Validates the entire coupled sidecar against canonical people and the same game
 * minute. Saving the separate modules independently is not supported. */
export function restoreCitizenTransport(city:City,value:unknown,expectedMinute:number):CitizenTransportRuntime {
 const r=value as CitizenTransportRuntime;
 if(!r||r.version!==1||!Number.isSafeInteger(r.minute)||r.minute!==expectedMinute||r.minute<0||!Number.isSafeInteger(r.plannedDay)||r.plannedDay<0||r.plannedDay>city.tick||!Number.isSafeInteger(r.nextCarId)||r.nextCarId<1||!Array.isArray(r.fleet)||!Array.isArray(r.waiting))throw new Error('Invalid citizen transport snapshot');
 if(Math.floor(r.minute/1440)!==city.tick||r.plannedDay<city.tick-1||(r.plannedDay!==city.tick&&r.minute%1440!==0))throw new Error('Transport day differs from city');
 const roster=parkActivityCitizens(city),people=new Map(roster.map(p=>[p.citizenId,p])),households=new Set(city.households.map(h=>h.id));
 if(r.fleet.length>roster.length)throw new Error('Fleet exceeds real population');
 const journeys=restoreJourneys(r.journeys);if(journeys.minute!==r.minute)throw new Error('Journey clock differs');
 const queue=restoreRoadQueue(r.queue,journeys),fleet=new Map<string,FleetCar>();
 for(const car of r.fleet){
   if(!car||!/^vehicle:[1-9][0-9]*$/.test(car.id)||Number(car.id.slice(8))>=r.nextCarId||fleet.has(car.id)||!households.has(car.householdId)||typeof car.atHome!=='boolean'||!Number.isSafeInteger(car.cell)||car.cell<0||car.cell>=576)throw new Error('Invalid fleet identity or location');
   fleet.set(car.id,car);
 }
 for(const v of journeys.vehicles){
   const car=fleet.get(v.vehicleId);
   if(!car||car.householdId!==v.ride.householdId||car.cell!==journeyRoute(v)[v.routeIndex]||car.atHome!==(v.status==='waiting'||(v.status==='parked'&&!!v.returnTrip)))throw new Error('Fleet and journey differ');
   for(const id of v.ride.passengerIds)if(people.get(id)?.householdId!==v.ride.householdId)throw new Error('Journey person is not in this real household');
 }
 const usedCars=new Set(journeys.vehicles.map(v=>v.vehicleId));
 for(const car of fleet.values())if(!usedCars.has(car.id)&&!car.atHome)throw new Error('Away car has no active journey');
 const travelling=new Set(journeys.people.map(p=>p.citizenId)),waiting=new Set<string>();
 for(const w of r.waiting){if(!w||!people.has(w.citizenId)||travelling.has(w.citizenId)||waiting.has(w.citizenId)||!['missing-home','missing-workplace','no-route','no-driver'].includes(w.reason))throw new Error('Invalid waiting citizen');waiting.add(w.citizenId);}
 return {...structuredClone(r),journeys,queue};
}
