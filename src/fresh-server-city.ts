import {createCity} from './sim.ts';
import {createParkRuntime,serializeParkSession} from './park-runtime.ts';
/** Fresh world identity, never copies escrow/receipts/operations or changes server wallet state. */
export function freshServerCityRaw(owner:string,starter=false):string{
 const city=createCity(61025,{starter});
 city.market={version:10,rulesVersion:'chain-5',guestId:owner,cityId:crypto.randomUUID(),operations:[],escrow:[],receipts:{},seq:'0'};
 return serializeParkSession(city,createParkRuntime(city),city.market);
}
