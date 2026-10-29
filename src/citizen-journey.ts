/** Passenger lifecycle driven by accepted road movements, never elapsed wall time.
 * A lane/queue solver may deny a move indefinitely; occupants cannot arrive early.
 * This module deliberately does not award wages or create return cars.
 */
import { type ReturnItinerary } from './citizen-return.ts';
import { type RidePlan } from './citizen-trips.ts';
export type JourneyPerson = { citizenId: string; state: 'waiting' | 'waiting-return' | 'in-vehicle' | 'arrived'; cell: number; vehicleId: string | null };
export type JourneyVehicle = { vehicleId: string; ride: RidePlan; routeIndex: number; status: 'waiting' | 'moving' | 'parked'; occupants: string[]; returnTrip?: ReturnItinerary };
export type JourneyState = { version: 1; minute: number; people: JourneyPerson[]; vehicles: JourneyVehicle[] };

export type JourneyFrame = { state: JourneyState; people: Map<string, JourneyPerson>; vehicles: Map<string, JourneyVehicle>; peopleArray: JourneyPerson[]; vehicleArray: JourneyVehicle[] };
/** Build once per simulation frame, not once per car. Maps reference canonical objects. */
export function prepareJourneyFrame(state: JourneyState): JourneyFrame {
  return {state,people:new Map(state.people.map(p=>[p.citizenId,p])),vehicles:new Map(state.vehicles.map(v=>[v.vehicleId,v])),peopleArray:state.people,vehicleArray:state.vehicles};
}
function checkFrame(state:JourneyState, frame:JourneyFrame):void {
  if(frame.state!==state||frame.peopleArray!==state.people||frame.vehicleArray!==state.vehicles)throw new Error('Expired journey frame');
}

export function createJourneys(rides: readonly RidePlan[], minute: number): JourneyState {
  if (!Number.isSafeInteger(minute)||minute<0)throw new RangeError('Invalid journey clock');
  const state:JourneyState={version:1,minute,people:[],vehicles:[]};
  const people=new Set<string>(), vehicles=new Set<string>();
  for(const source of rides) {
    const ride=structuredClone(source);
    if(vehicles.has(ride.id)||!ride.id||!ride.route.length||!ride.passengerIds.includes(ride.driverId))throw new Error('Invalid ride identity');
    if(!Number.isSafeInteger(ride.departure)||ride.departure<0||ride.route.some(n=>!Number.isSafeInteger(n)||n<0||n>=576))throw new Error('Invalid ride route/clock');
    vehicles.add(ride.id);
    const drops=ride.stops.flatMap(s=>s.citizenIds);
    if(drops.length!==ride.passengerIds.length||new Set(drops).size!==drops.length||drops.some(p=>!ride.passengerIds.includes(p)))throw new Error('Invalid passenger stops');
    let last=-1;
    for(const stop of ride.stops) {
      if(!Number.isSafeInteger(stop.routeIndex)||stop.routeIndex<=last||stop.routeIndex>=ride.route.length)throw new Error('Invalid stop index');
      last=stop.routeIndex;
    }
    if(!ride.stops.at(-1)?.citizenIds.includes(ride.driverId)||last!==ride.route.length-1)throw new Error('Driver must remain until last stop');
    for(const citizenId of ride.passengerIds) {
      if(!citizenId||people.has(citizenId))throw new Error('Person belongs to multiple vehicles');
      people.add(citizenId);state.people.push({citizenId,state:'waiting',cell:ride.route[0],vehicleId:null});
    }
    state.vehicles.push({vehicleId:ride.id,ride,routeIndex:0,status:'waiting',occupants:[]});
  }
  return state;
}

/** Advance only the authoritative clock and board at origin. No movement occurs. */
export function departJourneys(state: JourneyState, minute: number): void {
  if(!Number.isSafeInteger(minute)||minute<state.minute)throw new RangeError('Journey time cannot reverse');
  state.minute=minute;
  const people=new Map(state.people.map(p=>[p.citizenId,p]));
  for(const v of state.vehicles) if(v.status==='waiting'&&v.ride.departure<=minute) {
    for(const id of v.ride.passengerIds) {
      const p=people.get(id)!;
      if(p.state!=='waiting'||p.cell!==v.ride.route[0]||p.vehicleId!==null)throw new Error('Cannot board absent passenger');
    }
    v.status='moving';v.occupants=[...v.ride.passengerIds];
    for(const id of v.occupants) {const p=people.get(id)!;p.state='in-vehicle';p.vehicleId=v.vehicleId;}
    dropAtStop(v,people);
  }
}
export const journeyRoute=(v:JourneyVehicle):readonly number[]=>v.returnTrip?.route??v.ride.route;

function dropAtStop(v:JourneyVehicle, people:Map<string,JourneyPerson>):void {
  if(v.returnTrip) {
    const pickup=v.returnTrip.pickups.find(stop=>stop.routeIndex===v.routeIndex);
    for(const id of pickup?.citizenIds??[]) {
      const p=people.get(id)!;
      if(p.state!=='waiting-return'||p.vehicleId!==null||p.cell!==v.returnTrip.route[v.routeIndex])throw new Error('Return passenger not at pickup');
      p.state='in-vehicle';p.vehicleId=v.vehicleId;v.occupants.push(id);
    }
    if(v.routeIndex===v.returnTrip.route.length-1) {
      for(const id of v.occupants) {const p=people.get(id)!;p.state='arrived';p.vehicleId=null;p.cell=v.returnTrip.homeCell;}
      v.occupants=[];v.status='parked';
    }
    return;
  }
  const stop=v.ride.stops.find(s=>s.routeIndex===v.routeIndex);
  for(const id of stop?.citizenIds??[]) {
    if(!v.occupants.includes(id))throw new Error('Cannot drop absent passenger');
    const p=people.get(id)!;p.state='arrived';p.vehicleId=null;p.cell=v.ride.route[v.routeIndex];
    v.occupants=v.occupants.filter(occupant=>occupant!==id);
  }
  if(v.routeIndex===v.ride.route.length-1) {
    if(v.occupants.length)throw new Error('Vehicle ended with undelivered passengers');
    v.status='parked';
  }
}
/** Commit one already-admitted directed road step. The road solver owns lane space
 * and intersection permission. A rejection leaves the complete state untouched.
 */
export function moveJourneyVehicle(state:JourneyState, vehicleId:string, allows:(from:number,to:number)=>boolean, frame:JourneyFrame=prepareJourneyFrame(state)):boolean {
  checkFrame(state,frame);
  const v=frame.vehicles.get(vehicleId);
  if(!v||v.status!=='moving')return false;
  const route=journeyRoute(v),from=route[v.routeIndex],to=route[v.routeIndex+1];
  if(to===undefined||!allows(from,to))return false;
  v.routeIndex++;
  const people=frame.people;
  for(const id of v.occupants)people.get(id)!.cell=to;
  dropAtStop(v,people);return true;
}

/** Strict round-trip validation against the original manifest. No financial state
 * is accepted here. Vehicle/person locations and manifest membership must agree.
 */
export function restoreJourneys(value:unknown):JourneyState {
  const s=value as JourneyState;
  if(!s||s.version!==1||!Array.isArray(s.people)||!Array.isArray(s.vehicles)||!Number.isSafeInteger(s.minute)||s.minute<0)throw new Error('Invalid journey snapshot');
  const base=createJourneys(s.vehicles.map(v=>v.ride),s.minute);
  if(s.people.length!==base.people.length)throw new Error('Journey population mismatch');
  const people=new Map(s.people.map(p=>[p.citizenId,p]));
  if(people.size!==s.people.length)throw new Error('Duplicate journey person');
  for(let i=0;i<s.vehicles.length;i++) {
    const v=s.vehicles[i], manifest=base.vehicles[i];
    const route=journeyRoute(v);
    if(v.returnTrip)validateReturnSnapshot(v,s.minute);
    if(v.vehicleId!==manifest.vehicleId||!Number.isSafeInteger(v.routeIndex)||v.routeIndex<0||v.routeIndex>=route.length||!['waiting','moving','parked'].includes(v.status)||!Array.isArray(v.occupants))throw new Error('Invalid journey vehicle');
    if(v.status==='waiting'&&(v.routeIndex!==0||v.occupants.length))throw new Error('Waiting car moved');
    if(v.status!=='waiting'&&v.ride.departure>s.minute)throw new Error('Vehicle departed in the future');
    if(v.status==='parked'&&(v.routeIndex!==route.length-1||v.occupants.length))throw new Error('Parked car not at destination');
    if(v.status==='moving'&&(v.routeIndex===route.length-1||v.ride.departure>s.minute))throw new Error('Invalid moving car');
    const expectedOccupants:string[]=[];
    for(const id of v.ride.passengerIds) {
      const person=people.get(id),drop=v.ride.stops.find(stop=>stop.citizenIds.includes(id))!;
      const pickup=v.returnTrip?.pickups.find(stop=>stop.citizenIds.includes(id));
      const expected=v.returnTrip?(v.status==='parked'?'arrived':pickup!.routeIndex>v.routeIndex?'waiting-return':'in-vehicle'):
        v.status==='waiting'?'waiting':drop.routeIndex<=v.routeIndex?'arrived':'in-vehicle';
      const cell=v.returnTrip?(expected==='waiting-return'?v.returnTrip.route[pickup!.routeIndex]:expected==='arrived'?v.returnTrip.homeCell:route[v.routeIndex]):
        expected==='waiting'?v.ride.route[0]:expected==='arrived'?v.ride.route[drop.routeIndex]:route[v.routeIndex];
      if(!person||person.state!==expected||person.cell!==cell||person.vehicleId!==(expected==='in-vehicle'?v.vehicleId:null))throw new Error('Journey person state mismatch');
      if(expected==='in-vehicle')expectedOccupants.push(id);
    }
    if([...v.occupants].sort().join('\0')!==expectedOccupants.sort().join('\0'))throw new Error('Journey manifest mismatch');
  }
  return structuredClone(s);
}

function validateReturnSnapshot(v:JourneyVehicle,minute:number):void {
 const r=v.returnTrip!;
 if(r.vehicleId!==v.vehicleId||r.driverId!==v.ride.driverId||v.status==='waiting'||!Number.isSafeInteger(r.departure)||r.departure<v.ride.departure||r.departure>minute||!Array.isArray(r.route)||!r.route.length||r.route.some(n=>!Number.isSafeInteger(n)||n<0||n>=576)||r.route[0]!==v.ride.route.at(-1)||r.homeCell!==v.ride.route[0]||r.route.at(-1)!==r.homeCell)throw new Error('Invalid return itinerary');
 if(!Array.isArray(r.pickups)||!Array.isArray(r.passengerIds)||r.passengerIds.length!==v.ride.passengerIds.length||new Set(r.passengerIds).size!==r.passengerIds.length||r.passengerIds.some(id=>!v.ride.passengerIds.includes(id)))throw new Error('Invalid return manifest');
 const ids=r.pickups.flatMap(p=>p.citizenIds);
 if(ids.length!==r.passengerIds.length||new Set(ids).size!==ids.length||ids.some(id=>!r.passengerIds.includes(id)))throw new Error('Invalid pickup manifest');
 let last=-1;
 for(const p of r.pickups) {
   if(!Number.isSafeInteger(p.routeIndex)||p.routeIndex<=last||p.routeIndex>=r.route.length)throw new Error('Invalid pickup index');
   last=p.routeIndex;
   for(const id of p.citizenIds) {const drop=v.ride.stops.find(s=>s.citizenIds.includes(id))!;if(r.route[p.routeIndex]!==v.ride.route[drop.routeIndex])throw new Error('Pickup moved away from workplace');}
 }
 if(r.pickups[0]?.routeIndex!==0||!r.pickups[0].citizenIds.includes(r.driverId))throw new Error('Return driver missing at origin');
}
