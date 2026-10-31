import test from 'node:test';
import assert from 'node:assert/strict';
import {createCity,buildRoad,buildParallelRoad,zoneCell,buildPark,buildPlant,buildCampus,bulldoze,serialize,step} from '../src/sim.ts';
import {createParkRuntime,serializeParkSession,deserializeParkSession,advanceParkRuntime} from '../src/park-runtime.ts';
import {RailNetworkRuntime,type RailServicePolicy} from '../src/rail/network-runtime.ts';
import {modalDemandSummary} from '../src/rail/demand-contract.ts';

const policy:RailServicePolicy={seats:8,queueCapacity:12,boardingPerMinute:4,alightingPerMinute:4,minimumDwellMinutes:2,minimumDepartureIntervalMinutes:4,maxBatches:128};
function fixture(){
  const city=createCity(61025,{starter:false}),runtime=createParkRuntime(city);
  buildRoad(city,288,264);buildRoad(city,264,281);
  const rail=RailNetworkRuntime.create(city,'test-city-a',city.tick*1440);runtime.rail=rail;
  rail.addStation('a',245);rail.addStation('b',255);
  for(let from=245;from<255;from++)rail.editTrack(from,from+1,false,2);
  rail.configureService(policy);return {city,runtime,rail};
}
function passengers(rail:RailNetworkRuntime){return rail.acceptPreparedDemand({id:'trip:1',from:291,to:305,offeredPersons:32,roadAdmittedPersons:0,leases:[]},{id:'batch:1',requestId:'trip:1',leaseId:'lease:1',from:291,to:305,fromStation:'a',toStation:'b',persons:32,readyAtMinute:0,egressMinutes:5});}

test('old application saves remain byte-equivalent and have no rail identity',()=>{
  const city=createCity(11),runtime=createParkRuntime(city),raw=serializeParkSession(city,runtime),restored=deserializeParkSession(raw);
  assert.equal(restored.runtime.rail,undefined);assert.equal(serializeParkSession(restored.city,restored.runtime),raw);
  assert.ok(!raw.includes('railSession'));assert.ok(!raw.includes('cityRevision'));
});
test('one atomic city payload resumes moving/full rail deterministically through midnight',()=>{
  const a=fixture();const demand=passengers(a.rail);assert.equal(modalDemandSummary(demand).roadAssignable,0);
  advanceParkRuntime(a.city,a.runtime,7,()=>step(a.city));
  assert.ok(a.rail.snapshot.service!.snapshot.train.destination);
  const raw=serializeParkSession(a.city,a.runtime),b=deserializeParkSession(raw);
  assert.equal(serializeParkSession(b.city,b.runtime),raw);
  for(const state of [a,b])advanceParkRuntime(state.city,state.runtime,1500,()=>step(state.city),()=>{assert.doesNotThrow(()=>serializeParkSession(state.city,state.runtime));});
  assert.equal(serializeParkSession(a.city,a.runtime),serializeParkSession(b.city,b.runtime));
  const sum=modalDemandSummary(a.rail.snapshot.service!.demands[0]);assert.equal(sum.railCompleted,32);assert.equal(sum.conservationError,0);
});
test('rail restore rejects another city revision, unowned batches, clocks and binding edits',()=>{
  const {city,runtime,rail}=fixture();passengers(rail);const raw=serializeParkSession(city,runtime);
  for(const mutate of [
    (x:any)=>{x.seed++;},
    (x:any)=>{x.parkRuntime.rail.binding.cityId='another-city';},
    (x:any)=>{x.parkRuntime.rail.network.revision++;},
    (x:any)=>{x.parkRuntime.rail.network.service.snapshot.minute++;},
    (x:any)=>{x.parkRuntime.rail.network.service.demands=[];},
    (x:any)=>{x.parkRuntime.rail.network.service=false;},
  ]){const x=JSON.parse(raw);mutate(x);assert.throws(()=>deserializeParkSession(JSON.stringify(x)));}
  assert.equal(serializeParkSession(city,runtime),raw);
  assert.throws(()=>serializeParkSession(createCity(12),runtime),/different city/);
});
test('paused management persists without money changes; occupied edits fail atomically',()=>{
  const {city,runtime,rail}=fixture(),before=serialize(city);passengers(rail);
  rail.setStationOpen('a',false);const saved=serializeParkSession(city,runtime);assert.equal(serialize(city),before);
  advanceParkRuntime(city,runtime,0,()=>step(city));assert.equal(serializeParkSession(city,runtime),saved);
  rail.setStationOpen('a',true);advanceParkRuntime(city,runtime,7,()=>step(city));
  const occupied=rail.snapshot;assert.throws(()=>rail.editTrack(249,250,true));assert.deepEqual(rail.snapshot,occupied);
  assert.throws(()=>rail.removeStation('a'));assert.throws(()=>rail.removeService());
});
test('station access follows pedestrian roads and disabled/closed services retain queued people',()=>{
  const {city,runtime,rail}=fixture();assert.ok(rail.planTrip(291,305,16,2));assert.equal(rail.planTrip(0,575,16,2),null);
  passengers(rail);rail.setStationOpen('a',false);assert.equal(rail.planTrip(291,305,16,2),null);
  advanceParkRuntime(city,runtime,20,()=>step(city));assert.equal(modalDemandSummary(rail.snapshot.service!.demands[0]).railPending,32);
  rail.setStationOpen('a',true);rail.setServiceEnabled(false);assert.equal(rail.planTrip(291,305,16,2),null);
  const restored=deserializeParkSession(serializeParkSession(city,runtime));assert.equal(restored.runtime.rail!.snapshot.service!.snapshot.enabled,false);
});
test('placement refuses occupied parcels, duplicate sites, invalid tracks and implicit policy',()=>{
  const city=createCity(1,{starter:false}),rail=RailNetworkRuntime.create(city,'placement',0);
  buildRoad(city,264,281);const before=rail.snapshot;
  assert.throws(()=>rail.addStation('road',269));assert.deepEqual(rail.snapshot,before);
  rail.addStation('a',245);assert.throws(()=>rail.addStation('a',255));rail.addStation('b',255);
  assert.throws(()=>rail.editTrack(245,255,false,2));assert.throws(()=>rail.editTrack(245,246,false));assert.throws(()=>rail.configureService(policy));
  rail.removeStation('b');assert.equal(rail.snapshot.stations.length,1);
});
test('rejected ownership and overflow commands leave the entire runtime unchanged',()=>{
  const {city,runtime,rail}=fixture(),before=rail.snapshot;
  assert.throws(()=>rail.acceptPreparedDemand({id:'bad',from:291,to:305,offeredPersons:10,roadAdmittedPersons:0,leases:[{id:'unknown',persons:2,completedPersons:0}]},
    {id:'new',requestId:'bad',leaseId:'new',from:291,to:305,fromStation:'a',toStation:'b',persons:8,readyAtMinute:0,egressMinutes:2}),/lease mismatch/);
  assert.deepEqual(rail.snapshot,before);assert.doesNotThrow(()=>serializeParkSession(city,runtime));
  const save=JSON.parse(serializeParkSession(city,runtime));save.parkRuntime.rail.binding.revision=Number.MAX_SAFE_INTEGER;save.parkRuntime.rail.network.revision=Number.MAX_SAFE_INTEGER;
  const restored=deserializeParkSession(JSON.stringify(save)),max=restored.runtime.rail!,snapshot=max.snapshot;
  for(const command of [()=>max.removeService(),()=>max.setServiceEnabled(false),()=>max.editTrack(249,250,true),()=>max.advanceTo(1)]){
    assert.throws(command,/overflow/);assert.deepEqual(max.snapshot,snapshot);
  }
});
test('all construction paths respect rail parcels before spending or changing core city',()=>{
  const {city,runtime,rail}=fixture(),before=serialize(city);
  for(const command of [()=>buildRoad(city,244,246),()=>buildParallelRoad(city,244,246),()=>zoneCell(city,245,'R'),()=>buildPlant(city,245,'power'),()=>buildPark(city,245),()=>buildCampus(city,245,'school'),()=>bulldoze(city,245)]){
    assert.equal(command().ok,false);assert.equal(serialize(city),before);
  }
  const restored=deserializeParkSession(serializeParkSession(city,runtime));assert.equal(buildRoad(restored.city,244,246).ok,false);
  rail.removeService();rail.removeStation('a');rail.editTrack(245,246,true);assert.equal(zoneCell(city,245,'R').ok,true);
});
test('rail session bytes are independent of frame batching and accepted offer retries',()=>{
 const a=fixture(),offered=passengers(a.rail),before=a.rail.snapshot;
 a.rail.acceptPreparedDemand(offered,{id:'batch:1',requestId:'trip:1',leaseId:'lease:1',from:291,to:305,fromStation:'a',toStation:'b',persons:32,readyAtMinute:0,egressMinutes:5});assert.deepEqual(a.rail.snapshot,before);
 const b=deserializeParkSession(serializeParkSession(a.city,a.runtime));
 advanceParkRuntime(a.city,a.runtime,1500,()=>step(a.city));
 for(let minute=0;minute<1500;minute++)advanceParkRuntime(b.city,b.runtime,1,()=>step(b.city));
 assert.equal(serializeParkSession(a.city,a.runtime),serializeParkSession(b.city,b.runtime));
});
