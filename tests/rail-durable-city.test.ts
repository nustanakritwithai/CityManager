import test from 'node:test';
import assert from 'node:assert/strict';
import {createCity,serialize,deserialize,step} from '../src/sim.ts';
import {createParkRuntime,serializeParkSession,advanceParkRuntime} from '../src/park-runtime.ts';
import {RailNetworkRuntime} from '../src/rail/network-runtime.ts';
import {MarketClient,marketJournalForTest,MARKET_SAVE_KEY} from '../src/market-client.ts';
import {durableCityProjection} from '../src/rail/durable-city.ts';

function fixture(){
  const city=createCity(61025,{starter:false}),runtime=createParkRuntime(city);
  const rail=RailNetworkRuntime.create(city,'durable-fixture',city.tick*1440);runtime.rail=rail;
  rail.addStation('a',245);rail.addStation('b',255);
  for(let from=245;from<255;from++)rail.editTrack(from,from+1,false,2);
  rail.configureService({seats:8,queueCapacity:12,boardingPerMinute:4,alightingPerMinute:4,minimumDwellMinutes:2,minimumDepartureIntervalMinutes:4,maxBatches:128});
  rail.acceptPreparedDemand({id:'trip:1',from:291,to:305,offeredPersons:32,roadAdmittedPersons:0,leases:[]},
    {id:'batch:1',requestId:'trip:1',leaseId:'lease:1',from:291,to:305,fromStation:'a',toStation:'b',persons:32,readyAtMinute:0,egressMinutes:5});
  advanceParkRuntime(city,runtime,7,()=>step(city));
  return {city,runtime,rail};
}

test('durable projection preserves city and Guest journal and strips only validated application state',()=>{
  const city=createCity(1),runtime=createParkRuntime(city),journal=marketJournalForTest(null);
  journal.guestId='00000000-0000-4000-8000-000000000003';city.market=journal;
  const raw=serializeParkSession(city,runtime),before=serialize(city);
  const projected=durableCityProjection(raw,journal.cityId)!;
  assert.equal(projected,before);assert.equal(Object.hasOwn(JSON.parse(projected),'parkRuntime'),false);
  assert.deepEqual(deserialize(projected).market,journal);assert.equal(serializeParkSession(city,runtime),raw);
  assert.equal(durableCityProjection(serialize(city),journal.cityId),before,'core-only legacy session is accepted');
});

test('durable projection accepts a complete moving rail session without leaking or mutating rail state',()=>{
  const {city,runtime,rail}=fixture();city.market=marketJournalForTest(null);
  city.market.guestId='00000000-0000-4000-8000-000000000003';
  const raw=serializeParkSession(city,runtime),state=rail.snapshot;
  assert.ok(state.service!.snapshot.train.destination);
  assert.equal(durableCityProjection(raw,city.market.cityId),serialize(city));
  assert.deepEqual(rail.snapshot,state);assert.equal(serializeParkSession(city,runtime),raw);
});

test('durable projection returns null only for absence and rejects corruption or a different market city',()=>{
  const {city,runtime}=fixture();city.market=marketJournalForTest(null);
  const raw=serializeParkSession(city,runtime);
  assert.equal(durableCityProjection(null,city.market.cityId),null);
  assert.throws(()=>durableCityProjection(raw,'00000000-0000-4000-8000-000000000099'),/identity/);
  assert.throws(()=>durableCityProjection('{broken',city.market!.cityId));
  const noMarket=createCity(2);assert.throws(()=>durableCityProjection(serialize(noMarket),city.market!.cityId),/identity/);
  const invalid=JSON.parse(raw);invalid.parkRuntime.rail.network.service.demands=[];
  assert.throws(()=>durableCityProjection(JSON.stringify(invalid),city.market!.cityId),/Unowned rail/);
});

test('PR118 durable reader validates rail before receipt ACK and keeps Guest and city checks',async()=>{
  const {city,runtime}=fixture(),store=new Map<string,string>();
  const originalStorage=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  const originalDocument=Object.getOwnPropertyDescriptor(globalThis,'document');
  const originalFetch=globalThis.fetch;let requests=0,selected:string|null=null,requestedCity='';
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(key:string)=>store.get(key)??null,setItem:(key:string,value:string)=>void store.set(key,value)}});
  Object.defineProperty(globalThis,'document',{configurable:true,value:{cookie:'cm_csrf=fixture'}});
  globalThis.fetch=async()=>{requests++;return new Response('{}',{status:200});};
  try{
    const client=new MarketClient(()=>city,'http://127.0.0.1:4317',{readDurableCity:id=>{requestedCity=id;return durableCityProjection(selected,id);}});
    client.guestId='00000000-0000-4000-8000-000000000003';client.journal.guestId=client.guestId;
    const receipt='00000000-0000-4000-8000-000000000004';
    client.journal.receipts[receipt]={claimId:'00000000-0000-4000-8000-000000000005',state:'applied',firmId:2,itemId:'crop:rice',quantity:1};
    city.market=client.exportSave();const valid=serializeParkSession(city,runtime),before=JSON.stringify(client.journal);
    const invalid=JSON.parse(valid);invalid.parkRuntime.rail.network.service.demands=[];selected=JSON.stringify(invalid);
    await assert.rejects(client.ack(receipt),/saved-city-recovery-required/);
    assert.equal(requestedCity,city.market.cityId);assert.equal(requests,0);
    assert.equal(JSON.stringify(client.journal),before);assert.equal(store.has(MARKET_SAVE_KEY),false);
    for(const field of ['cityId','guestId'] as const){
      const other=structuredClone(city.market);other[field]='00000000-0000-4000-8000-000000000099';
      selected=serializeParkSession(city,runtime,other);
      await assert.rejects(client.ack(receipt),/saved-city-recovery-required/);
      assert.equal(requests,0);assert.equal(JSON.stringify(client.journal),before);
    }
    selected=valid;await client.ack(receipt);assert.equal(requests,1);
    assert.equal(client.guestId,city.market.guestId);assert.equal(client.journal.receipts[receipt].state,'delivered');
  }finally{
    globalThis.fetch=originalFetch;
    if(originalStorage)Object.defineProperty(globalThis,'localStorage',originalStorage);else Reflect.deleteProperty(globalThis,'localStorage');
    if(originalDocument)Object.defineProperty(globalThis,'document',originalDocument);else Reflect.deleteProperty(globalThis,'document');
  }
});
