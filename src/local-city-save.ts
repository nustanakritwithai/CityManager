/** Local saves need no login/network. Existing market operations retain their guard. */
import {type City} from './sim.ts';
import {deserializeParkSession,serializeParkSession,type ParkRuntime} from './park-runtime.ts';
import {type createSaveGuard} from './save-guard.ts';
import {isPristineMarketJournal,type MarketClient} from './market-client.ts';
export async function saveLocalCitySession(city:City,runtime:ParkRuntime,client:MarketClient|undefined,write:(raw:string)=>void):Promise<void>{
 const financial=client&&Boolean(client.journal.operations.length||client.journal.escrow.length||Object.keys(client.journal.receipts).length);
 if(client?.enabled&&financial){await client.saveLocalCity(market=>{write(serializeParkSession(city,runtime,market));city.market=structuredClone(market);});return;}
 const market=city.market??(client?.guestId?client.exportSave():undefined);
 write(serializeParkSession(city,runtime,market));if(market)city.market=structuredClone(market);
}


/** The financial writer remains held through the asynchronous capture consumer. */
export async function withLocalCitySnapshot<T>(city:City,runtime:ParkRuntime,client:MarketClient|undefined,consume:(raw:string)=>Promise<T>):Promise<T>{
 if(client?.enabled){
  let result:T|undefined;
  await client.saveLocalCity(async market=>{
   const hasFinancial=(m:City['market'])=>!!m&&Boolean(m.operations.length||m.escrow.length||Object.keys(m.receipts).length);
   const state=(m:City['market'])=>!!m&&!isPristineMarketJournal(m);
   if(state(city.market)||state(market)){
    if(state(market)&&!city.market)throw Error('saved-city-recovery-required');
    if(city.market?.guestId&&market.guestId&&city.market.guestId!==market.guestId)throw Error('market guest identity mismatch');
    if(city.market&&city.market.cityId!==market.cityId)throw Error('saved-city-recovery-required');
    if(state(city.market)&&!state(market))throw Error('saved-market-reconciliation-required');
    if(city.market&&Object.keys(city.market).sort().join(',')!==Object.keys(market).sort().join(','))throw Error('saved-market-reconciliation-required');
    if(city.market&&BigInt(city.market.seq)>BigInt(market.seq))throw Error('saved-market-reconciliation-required');
   }
   // An unpersisted empty client receives a random cityId at startup. Preserve
   // the city's existing empty journal, or omit it, rather than invent identity.
   result=await consume(serializeParkSession(city,runtime,state(market)?market:city.market));
  });
  return result as T;
 }
 return consume(serializeParkSession(city,runtime,city.market??(client?.guestId?client.exportSave():undefined)));
}
/** Export without writing browser storage or mutating the in-memory city. */
export async function exportLocalCitySession(city:City,runtime:ParkRuntime,client:MarketClient|undefined):Promise<string>{
 return withLocalCitySnapshot(city,runtime,client,async raw=>raw);
}

export async function bindLocalCitySession(client:MarketClient|undefined,loaded:City,apply:()=>void,assertCurrent:()=>void=()=>{}):Promise<void>{
 assertCurrent();
 if(!client?.enabled){apply();return;}
 const hasFinancial=(j:City['market'])=>!!j&&(j.operations.length>0||j.escrow.length>0||Object.keys(j.receipts).length>0);
 if(!hasFinancial(client.journal)&&!hasFinancial(loaded.market)){
   if(client.guestId&&loaded.market?.guestId&&client.guestId!==loaded.market.guestId)throw Error('market guest identity mismatch');
   apply();return;
 }
 await client.bindLoadedCity(loaded.market,apply,assertCurrent);
}

/** Conservative local inventory for the IDB-unavailable escape paths. */
export function hasOnlyKnownNonCityKeys(storage:Pick<Storage,'length'|'key'>,allowMarket:boolean):boolean{
 const benign=new Set(['citymanager.advanced.v1','citymanager.visual.v1','citymanager.audio.v1','citymanager.guide.v1','citymanager.traffic','citymanager.taxi']);
 try{for(let i=0;i<storage.length;i++){const key=storage.key(i);if(key?.startsWith('citymanager.')&&!benign.has(key)&&!(allowMarket&&key==='citymanager.market.v10'))return false;}return true;}catch{return false;}
}
/** A recovery preview must never persist a market journal or replace browser save slots. */
export async function loadRecoveryCityReadOnly(raw:string,client:MarketClient|undefined,guard:ReturnType<typeof createSaveGuard>,apply:(restored:{city:City;runtime:ParkRuntime})=>void):Promise<void>{
 guard.block();const generation=guard.generation;const restored=deserializeParkSession(raw);
 const assertCurrent=()=>{if(guard.generation!==generation)throw Error('City changed while loading; cancelled the older Load');};
 const applyChecked=()=>{assertCurrent();apply(restored);};
 if(client?.enabled)await client.bindLoadedCityReadOnly(restored.city.market,applyChecked,assertCurrent);
 else applyChecked();
}

export async function loadLocalCitySession(raw:string,client:MarketClient|undefined,guard:ReturnType<typeof createSaveGuard>,apply:(restored:{city:City;runtime:ParkRuntime})=>void):Promise<void>{
 // Invalidate pending writers before awaiting the market lock. A failed or
 // superseded Load must never authorize saving the city that was already open.
 guard.block();
 const generation=guard.generation;
 const restored=deserializeParkSession(raw);
 if(restored.city.market)client?.validateSave(restored.city.market);
 const assertCurrent=()=>{if(guard.generation!==generation)throw Error('City changed while loading; cancelled the older Load');};
 await bindLocalCitySession(client,restored.city,()=>{
  assertCurrent();
  try{
   guard.acceptLoaded(raw,true);
   apply(restored);
  }catch(error){guard.block();throw error;}
 },assertCurrent);
}
