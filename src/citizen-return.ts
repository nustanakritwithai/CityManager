/** Return itinerary for the same parked vehicle and identified outward passengers.
 * Routes must be supplied by the current directed road graph. A missing route
 * leaves the vehicle at work; no return car or passenger is spawned at home.
 */
import {type JourneyState} from './citizen-journey.ts';
export type ReturnItinerary={vehicleId:string;driverId:string;departure:number;route:number[];
  pickups:{routeIndex:number;citizenIds:string[]}[];homeCell:number;passengerIds:string[]};
export type ReturnPlan={itinerary:ReturnItinerary|null;blocked:'not-parked'|'missing-person'|'no-route'|null};
export function planReturnRide(state:JourneyState,vehicleId:string,departure:number,routeBetween:(from:number,to:number)=>number[]):ReturnPlan {
  if(!Number.isSafeInteger(departure)||departure<state.minute)throw new RangeError('Invalid return departure');
  const v=state.vehicles.find(v=>v.vehicleId===vehicleId);
  if(!v||v.status!=='parked')return {itinerary:null,blocked:'not-parked'};
  const people=new Map(state.people.map(p=>[p.citizenId,p]));
  const driver=people.get(v.ride.driverId), parked=v.ride.route[v.routeIndex];
  if(!driver||driver.state!=='arrived'||driver.cell!==parked||driver.vehicleId!==null)return {itinerary:null,blocked:'missing-person'};
  const pickups=new Map<number,string[]>(), locations=new Map<number,string[]>();
  for(const id of v.ride.passengerIds) {
    const p=people.get(id);
    if(!p||p.state!=='arrived'||p.vehicleId!==null)return {itinerary:null,blocked:'missing-person'};
    const occupants=locations.get(p.cell)??[];occupants.push(id);locations.set(p.cell,occupants);
  }
  const route=[parked];
  const append=(to:number):boolean=>{
    const from=route.at(-1)!;
    if(from===to)return true;
    const segment=routeBetween(from,to);
    if(segment.length<2||segment[0]!==from||segment.at(-1)!==to||segment.some(n=>!Number.isSafeInteger(n)||n<0))return false;
    route.push(...segment.slice(1));return true;
  };
  // Reverse outward drop order. All route segments are recalculated, not reversed:
  // one-way roads may require a completely different homeward path.
  const order=[parked,...v.ride.stops.slice().reverse().map(s=>v.ride.route[s.routeIndex])];
  for(const cell of [...new Set(order)]) {
    const ids=locations.get(cell);if(!ids)continue;
    if(!append(cell))return {itinerary:null,blocked:'no-route'};
    pickups.set(route.length-1,[...ids].sort());locations.delete(cell);
  }
  if(locations.size)return {itinerary:null,blocked:'missing-person'};
  const homeCell=v.ride.route[0];if(!append(homeCell))return {itinerary:null,blocked:'no-route'};
  return {blocked:null,itinerary:{vehicleId,driverId:v.ride.driverId,departure,route,
    pickups:[...pickups].map(([routeIndex,citizenIds])=>({routeIndex,citizenIds})),homeCell,passengerIds:[...v.ride.passengerIds]}};
}
