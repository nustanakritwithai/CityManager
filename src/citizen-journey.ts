/** Passenger lifecycle driven by accepted road movements, never elapsed wall time.
 * A lane/queue solver may deny a move indefinitely; occupants cannot arrive early.
 * This module deliberately does not award wages or create return cars.
 */
import { type RidePlan } from './citizen-trips.ts';
export type JourneyPerson = { citizenId: string; state: 'waiting' | 'in-vehicle' | 'arrived'; cell: number; vehicleId: string | null };
export type JourneyVehicle = { vehicleId: string; ride: RidePlan; routeIndex: number; status: 'waiting' | 'moving' | 'parked'; occupants: string[] };
export type JourneyState = { version: 1; minute: number; people: JourneyPerson[]; vehicles: JourneyVehicle[] };

export function createJourneys(rides: readonly RidePlan[], minute: number): JourneyState {
  if (!Number.isSafeInteger(minute)||minute<0)throw new RangeError('Invalid journey clock');
  const state:JourneyState={version:1,minute,people:[],vehicles:[]};
  const people=new Set<string>(), vehicles=new Set<string>();
  for(const source of rides) {
    const ride=structuredClone(source);
    if(vehicles.has(ride.id)||!ride.id||!ride.route.length||!ride.passengerIds.includes(ride.driverId))throw new Error('Invalid ride identity');
    if(!Number.isSafeInteger(ride.departure)||ride.departure<0||ride.route.some(n=>!Number.isSafeInteger(n)||n<0))throw new Error('Invalid ride route/clock');
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
function dropAtStop(v:JourneyVehicle, people:Map<string,JourneyPerson>):void {
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
export function moveJourneyVehicle(state:JourneyState, vehicleId:string, allows:(from:number,to:number)=>boolean):boolean {
  const v=state.vehicles.find(vehicle=>vehicle.vehicleId===vehicleId);
  if(!v||v.status!=='moving')return false;
  const from=v.ride.route[v.routeIndex],to=v.ride.route[v.routeIndex+1];
  if(to===undefined||!allows(from,to))return false;
  v.routeIndex++;
  const people=new Map(state.people.map(p=>[p.citizenId,p]));
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
    if(v.vehicleId!==manifest.vehicleId||!Number.isSafeInteger(v.routeIndex)||v.routeIndex<0||v.routeIndex>=v.ride.route.length||!['waiting','moving','parked'].includes(v.status)||!Array.isArray(v.occupants))throw new Error('Invalid journey vehicle');
    if(v.status==='waiting'&&(v.routeIndex!==0||v.occupants.length))throw new Error('Waiting car moved');
    if(v.status==='parked'&&(v.routeIndex!==v.ride.route.length-1||v.occupants.length))throw new Error('Parked car not at destination');
    if(v.status==='moving'&&(v.routeIndex===v.ride.route.length-1||v.ride.departure>s.minute))throw new Error('Invalid moving car');
    const expectedOccupants:string[]=[];
    for(const id of v.ride.passengerIds) {
      const person=people.get(id),drop=v.ride.stops.find(stop=>stop.citizenIds.includes(id))!;
      const expected=v.status==='waiting'?'waiting':drop.routeIndex<=v.routeIndex?'arrived':'in-vehicle';
      const cell=expected==='waiting'?v.ride.route[0]:expected==='arrived'?v.ride.route[drop.routeIndex]:v.ride.route[v.routeIndex];
      if(!person||person.state!==expected||person.cell!==cell||person.vehicleId!==(expected==='in-vehicle'?v.vehicleId:null))throw new Error('Journey person state mismatch');
      if(expected==='in-vehicle')expectedOccupants.push(id);
    }
    if([...v.occupants].sort().join('\0')!==expectedOccupants.sort().join('\0'))throw new Error('Journey manifest mismatch');
  }
  return structuredClone(s);
}
