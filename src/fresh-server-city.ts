import {createCity} from './sim.ts';
import {createParkRuntime,serializeParkSession} from './park-runtime.ts';
/** A new city opens at seven in the morning, so its first game hours are in daylight. */
export const FRESH_CITY_START_MINUTE=7*60;
/** Fresh world identity, never copies escrow/receipts/operations or changes server wallet state. */
export function freshServerCityRaw(owner:string,starter=false):string{
 const city=createCity(61025,{starter});
 // A newly started city opens larger places as its population grows; existing saves keep every tool open.
 city.unlocks={version:1};
 city.market={version:10,rulesVersion:'chain-5',guestId:owner,cityId:crypto.randomUUID(),operations:[],escrow:[],receipts:{},seq:'0'};
 return serializeParkSession(city,createParkRuntime(city,FRESH_CITY_START_MINUTE),city.market);
}
