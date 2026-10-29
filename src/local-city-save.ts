/** Local saves need no login/network. Existing market operations retain their guard. */
import {type City} from './sim.ts';
import {deserializeParkSession,serializeParkSession,type ParkRuntime} from './park-runtime.ts';
import {type createSaveGuard} from './save-guard.ts';
import {type MarketClient} from './market-client.ts';
export async function saveLocalCitySession(city:City,runtime:ParkRuntime,client:MarketClient|undefined,write:(raw:string)=>void):Promise<void>{
 const financial=client&&Boolean(client.journal.operations.length||client.journal.escrow.length||Object.keys(client.journal.receipts).length);
 if(client?.enabled&&financial){await client.saveLocalCity(market=>{write(serializeParkSession(city,runtime,market));city.market=structuredClone(market);});return;}
 const market=city.market??(client?.guestId?client.exportSave():undefined);
 write(serializeParkSession(city,runtime,market));if(market)city.market=structuredClone(market);
}

export async function bindLocalCitySession(client:MarketClient|undefined,loaded:City,apply:()=>void):Promise<void>{
 if(!client?.enabled){apply();return;}
 const hasFinancial=(j:City['market'])=>!!j&&(j.operations.length>0||j.escrow.length>0||Object.keys(j.receipts).length>0);
 if(!hasFinancial(client.journal)&&!hasFinancial(loaded.market)){
   if(client.guestId&&loaded.market?.guestId&&client.guestId!==loaded.market.guestId)throw Error('market guest identity mismatch');
   apply();return;
 }
 await client.bindLoadedCity(loaded.market,apply);
}

export async function loadLocalCitySession(raw:string,client:MarketClient|undefined,guard:ReturnType<typeof createSaveGuard>,apply:(restored:{city:City;runtime:ParkRuntime})=>void):Promise<void>{
 // Invalidate pending writers before awaiting the market lock. A failed or
 // superseded Load must never authorize saving the city that was already open.
 guard.block();
 const generation=guard.generation;
 const restored=deserializeParkSession(raw);
 if(restored.city.market)client?.validateSave(restored.city.market);
 await bindLocalCitySession(client,restored.city,()=>{
  if(guard.generation!==generation)throw Error('City changed while loading; cancelled the older Load');
  try{
   guard.acceptLoaded(raw,true);
   apply(restored);
  }catch(error){guard.block();throw error;}
 });
}
