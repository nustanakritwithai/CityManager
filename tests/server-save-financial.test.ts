import assert from 'node:assert/strict';
import test from 'node:test';
import {createCity,serialize} from '../src/sim.ts';
import {MarketClient} from '../src/market-client.ts';
import {createCityOutbox} from '../src/server-save-outbox.ts';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('financial ACK requires confirmed bytes from its city, not pending local upload',async()=>{
 const values=new Map<string,string>();const storage={getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>void values.set(k,v)};
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:storage});Object.defineProperty(globalThis,'document',{configurable:true,value:{cookie:'cm_csrf=test'}});
 const locks={request:async<T>(_key:string,_o:{mode:'exclusive'},fn:()=>Promise<T>)=>fn()};
 const city=createCity(1,{starter:false}), client=new MarketClient(()=>city,'http://127.0.0.1:4317',{readDurableCity:()=>box.readConfirmed()});
 client.guestId=id(1);client.journal.guestId=id(1);const receipt=id(4);client.journal.receipts[receipt]={claimId:id(5),state:'applied',firmId:2,itemId:'crop:rice',quantity:1};city.market=client.exportSave();
 const box=createCityOutbox(storage,locks,id(1),client.journal.cityId,()=>id(6));const raw=serialize(city,city.market), metadata={name:'Town',tick:0,population:0};
 const pending=await box.enqueue(null,{action:'create',cityId:client.journal.cityId,slot:1,raw,metadata});const original=JSON.stringify(client.journal);let calls=0, old=globalThis.fetch;
 globalThis.fetch=async()=>{calls++;return new Response('{}');};
 try {
  await assert.rejects(client.ack(receipt),/saved-city-recovery-required/);assert.equal(calls,0);assert.equal(JSON.stringify(client.journal),original);
  await box.flush(pending,async()=>({cityId:client.journal.cityId,slot:1,revision:1,deleted:false}));
  await client.ack(receipt);assert.equal(calls,1);assert.equal(client.journal.receipts[receipt].state,'delivered');
 }finally{globalThis.fetch=old;}
});
