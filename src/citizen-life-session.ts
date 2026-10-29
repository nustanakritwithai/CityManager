/** Coupled clock/save codec under test. No storage write or live UI activation here. */
import {type City} from './sim.ts';
import {advanceParkRuntime,serializeParkSession,deserializeParkSession,type ParkRuntime} from './park-runtime.ts';
import {parkActivityAbsoluteMinute} from './park-activity.ts';
import {advanceCitizenTransportMinute,prepareTransportDay,restoreCitizenTransport,type CitizenTransportRuntime} from './citizen-transport-runtime.ts';
export function transportUnavailablePeople(r:CitizenTransportRuntime):Set<string>{
 const available=new Set(r.journeys.vehicles.filter(v=>v.status==='parked'&&v.returnTrip).flatMap(v=>v.ride.passengerIds));
 return new Set(r.journeys.people.filter(p=>!available.has(p.citizenId)).map(p=>p.citizenId));
}
export function advanceCitizenLife(city:City,parks:ParkRuntime,transport:CitizenTransportRuntime,minutes:number,advanceDay:()=>void,afterDay?:()=>boolean|void,continueFrame?:()=>boolean):number {
 if(transport.minute!==parkActivityAbsoluteMinute(parks.activity))throw new Error('City life clocks differ');
 return advanceParkRuntime(city,parks,minutes,advanceDay,afterDay,continueFrame,{
   beforeMinute:minute=>advanceCitizenTransportMinute(city,transport,minute),
   afterDay:()=>prepareTransportDay(city,transport),
   unavailableCitizenIds:()=>transportUnavailablePeople(transport),
 });
}
/** New experiment envelope, intentionally not written to the legacy save slot.
 * Existing city + market + park bytes live together with transport in one object.
 */
export function serializeCitizenLife(city:City,parks:ParkRuntime,transport:CitizenTransportRuntime,market?:City['market']):string {
 const valid=restoreCitizenTransport(city,transport,parkActivityAbsoluteMinute(parks.activity));
 const json=JSON.stringify({format:'citymanager-citizen-life',version:1,citySession:JSON.parse(serializeParkSession(city,parks,market)),transport:valid});
 if(json.length>12_000_000)throw new Error('City life save exceeds 12 MB; prior save must be preserved');return json;
}
export function deserializeCitizenLife(json:string):{city:City;parks:ParkRuntime;transport:CitizenTransportRuntime}{
 if(json.length>12_000_000)throw new Error('City life save exceeds 12 MB');
 const raw=JSON.parse(json);if(!raw||raw.format!=='citymanager-citizen-life'||raw.version!==1||Object.keys(raw).sort().join(',')!=='citySession,format,transport,version')throw new Error('Invalid city life envelope');
 const {city,runtime:parks}=deserializeParkSession(JSON.stringify(raw.citySession));
 const transport=restoreCitizenTransport(city,raw.transport,parkActivityAbsoluteMinute(parks.activity));
 return {city,parks,transport};
}
