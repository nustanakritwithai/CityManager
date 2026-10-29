/** Read/validate first. Never write a fresh city over an unreadable existing save. */
import {type City} from './sim.ts';
import {createParkRuntime,deserializeParkSession,type ParkRuntime} from './park-runtime.ts';
import {readStoredCity} from './save-storage.ts';
import {createSaveGuard} from './save-guard.ts';
export function restoreStartupCity(storage:Pick<Storage,'getItem'|'setItem'>,fresh:()=>City):{
 city:City;runtime:ParkRuntime;guard:ReturnType<typeof createSaveGuard>;restored:boolean;error:string|null;legacyRaw:string|null;
}{
 const guard=createSaveGuard(storage);
 try{
  const saved=readStoredCity(storage);
  if(saved){const restored=deserializeParkSession(saved.raw);guard.acceptLoaded(saved.raw);const version=JSON.parse(saved.raw).version;return {...restored,guard,restored:true,error:null,legacyRaw:version>=1&&version<=6?saved.raw:null};}
  const city=fresh();return {city,runtime:createParkRuntime(city),guard,restored:false,error:null,legacyRaw:null};
 }catch(error){guard.block();const city=fresh();return {city,runtime:createParkRuntime(city),guard,restored:false,error:error instanceof Error?error.message:String(error),legacyRaw:null};}
}
