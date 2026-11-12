import test from 'node:test';
import assert from 'node:assert/strict';
import {buildRoad,createCity,serialize,step} from '../src/sim.ts';
import {createParkRuntime,advanceParkRuntime,serializeParkSession,deserializeParkSession} from '../src/park-runtime.ts';
import {RailNetworkRuntime,type RailTrafficOffer} from '../src/rail/network-runtime.ts';
import {modalDemandSummary} from '../src/rail/demand-contract.ts';

function fixture(){
  const city=createCity(18,{starter:false});assert.equal(buildRoad(city,25,32).ok,true);
  const runtime=createParkRuntime(city),rail=RailNetworkRuntime.create(city,'rail-intake',0);runtime.rail=rail;
  rail.addStation('a',49);rail.addStation('b',56);rail.addTrackPath(49,56);rail.configureGameService();
  return {city,runtime,rail};
}
const offer=(sequence=1,persons=8):RailTrafficOffer=>({epoch:'worker-a',sequence,from:25,to:32,persons});
const counts=(rail:RailNetworkRuntime)=>{const s=rail.snapshot;return {offered:s.model!.offeredPersons,retired:s.model!.retiredPersons,live:s.service!.snapshot.batches.reduce((n,b)=>n+b.persons-b.completed,0),completed:s.service!.snapshot.batches.reduce((n,b)=>n+b.completed,0)};};

test('traffic intake leases exactly accepted whole people with actual access and egress',()=>{
  const {city,runtime,rail}=fixture(),before=serialize(city);
  assert.deepEqual(rail.acceptTrafficDemand(offer()),{accepted:true,reason:'accepted'});
  const state=rail.snapshot,b=state.service!.snapshot.batches[0],d=state.service!.demands[0];
  assert.equal(b.id,'model:0');assert.equal(b.from,25);assert.equal(b.to,32);assert.equal(b.readyAtMinute,1);assert.equal(b.egressMinutes,1);
  assert.equal(b.outside,8);assert.equal(b.waiting,0);assert.equal(state.model!.nextSequence,1);
  assert.equal(modalDemandSummary(d).roadAssignable,0);assert.equal(modalDemandSummary(d).railPending,8);
  assert.equal(serialize(city),before,'traffic leases never mutate the economy');
  advanceParkRuntime(city,runtime,1000,()=>step(city));
  assert.deepEqual(counts(rail),{offered:8,retired:8,live:0,completed:0});
  assert.doesNotThrow(()=>serializeParkSession(city,runtime));
});

test('refused unavailable or uncovered requests leave all saved ownership unchanged',()=>{
  for(const reason of ['disabled','closed','not-accepting','disconnected','uncovered','same-origin','no-service'] as const){
    const {rail}=fixture();let request=offer();
    if(reason==='disabled')rail.setServiceEnabled(false);
    if(reason==='closed')rail.setStationOpen('b',false);
    if(reason==='not-accepting')rail.setModelAccepting(false);
    if(reason==='disconnected')rail.editTrack(52,53,true);
    if(reason==='uncovered')request={...request,from:28}; // Four walking edges to station a.
    if(reason==='same-origin')request={...request,to:request.from};
    if(reason==='no-service')rail.removeService();
    const before=rail.snapshot;
    assert.equal(rail.acceptTrafficDemand(request).accepted,false,reason);
    assert.deepEqual(rail.snapshot,before,reason);
  }
});

test('exact 128-person backlog and 32-batch limits refuse whole requests without eviction',()=>{
  const {rail}=fixture();
  assert.equal(rail.acceptTrafficDemand(offer(1,129)).reason,'capacity');assert.equal(counts(rail).offered,0);
  assert.equal(rail.acceptTrafficDemand(offer(2,128)).accepted,true);
  const full=rail.snapshot;assert.equal(rail.acceptTrafficDemand(offer(3,1)).reason,'capacity');assert.deepEqual(rail.snapshot,full);
  const b=fixture().rail;
  for(let sequence=1;sequence<=32;sequence++)assert.equal(b.acceptTrafficDemand(offer(sequence,1)).accepted,true);
  const batches=b.snapshot;assert.equal(b.acceptTrafficDemand(offer(33,1)).reason,'capacity');assert.deepEqual(b.snapshot,batches);
  assert.equal(counts(b).offered,32);assert.equal(b.snapshot.service!.snapshot.batches.length,32);
});

test('latest result retries are stable after retirement or refusal, and conflicts are atomic',()=>{
  const {rail}=fixture(),request=offer(),accepted=rail.acceptTrafficDemand(request),after=rail.snapshot;
  assert.deepEqual(rail.acceptTrafficDemand({...request}),accepted);assert.deepEqual(rail.snapshot,after);
  assert.throws(()=>rail.acceptTrafficDemand({...request,persons:9}),/Conflicting/);assert.deepEqual(rail.snapshot,after);
  rail.advanceTo(1200);const retired=rail.snapshot;assert.deepEqual(rail.acceptTrafficDemand(request),accepted);assert.deepEqual(rail.snapshot,retired);
  rail.setServiceEnabled(false);const next=offer(2),declined=rail.acceptTrafficDemand(next);assert.equal(declined.accepted,false);
  rail.setServiceEnabled(true);const enabled=rail.snapshot;
  assert.deepEqual(rail.acceptTrafficDemand(next),declined);assert.deepEqual(rail.snapshot,enabled);
  assert.equal(rail.acceptTrafficDemand(offer(3)).accepted,true);
  const final=rail.snapshot;assert.equal(rail.acceptTrafficDemand(request).reason,'stale');assert.deepEqual(rail.snapshot,final);
});

test('explicit worker epoch replacement fences delayed offers and preserves current riders',()=>{
  const {rail}=fixture();rail.bindTrafficEpoch('worker-a');assert.equal(rail.acceptTrafficDemand(offer()).accepted,true);
  const before=rail.snapshot;assert.equal(rail.acceptTrafficDemand({...offer(),epoch:'worker-b'}).reason,'stale');assert.deepEqual(rail.snapshot,before);
  rail.bindTrafficEpoch('worker-b');assert.equal(rail.acceptTrafficDemand({...offer(),epoch:'worker-b'}).accepted,true);
  const after=rail.snapshot;assert.equal(rail.acceptTrafficDemand(offer(2)).reason,'stale');assert.deepEqual(rail.snapshot,after);
  assert.equal(counts(rail).offered,16);assert.equal(after.model!.nextSequence,2);
});

test('legacy illustrative queues round-trip unchanged and drain without replacement riders',()=>{
  const a=fixture(),id='model:0';
  a.rail.acceptPreparedDemand({id,from:49,to:56,offeredPersons:11,roadAdmittedPersons:0,leases:[]},
    {id,requestId:id,leaseId:id,from:49,to:56,fromStation:'a',toStation:'b',persons:11,readyAtMinute:0,egressMinutes:3});
  advanceParkRuntime(a.city,a.runtime,100,()=>step(a.city));
  const raw=serializeParkSession(a.city,a.runtime),b=deserializeParkSession(raw);
  assert.equal(serializeParkSession(b.city,b.runtime),raw,'No saved schema or legacy ownership changes on load');
  assert.ok(b.runtime.rail!.snapshot.service!.snapshot.train.destination);
  for(const x of [a,b])advanceParkRuntime(x.city,x.runtime,3000,()=>step(x.city));
  assert.equal(serializeParkSession(a.city,a.runtime),serializeParkSession(b.city,b.runtime));
  assert.deepEqual(counts(b.runtime.rail!),{offered:11,retired:11,live:0,completed:0});
  assert.equal(b.runtime.rail!.acceptTrafficDemand({...offer(1,2),epoch:'restored-worker'}).accepted,true);
  assert.equal(counts(b.runtime.rail!).offered,13);assert.equal(b.runtime.rail!.snapshot.service!.snapshot.batches[0].id,'model:1');
});

test('fresh worker after load keeps accepted riders and never reuses internal model IDs',()=>{
  const a=fixture();a.rail.acceptTrafficDemand(offer());const raw=serializeParkSession(a.city,a.runtime),b=deserializeParkSession(raw),rail=b.runtime.rail!;
  assert.equal(serializeParkSession(b.city,b.runtime),raw);
  assert.equal(rail.acceptTrafficDemand({...offer(1,2),epoch:'loaded-worker'}).accepted,true);
  assert.equal(counts(rail).offered,10);assert.equal(counts(rail).live,10);
  assert.deepEqual(rail.snapshot.service!.demands.map(d=>d.id),['model:0','model:1']);
  for(const d of rail.snapshot.service!.demands)assert.equal(modalDemandSummary(d).conservationError,0);
});

test('invalid offers and counter overflow cannot partially mutate the rail runtime',()=>{
  const {city,runtime,rail}=fixture();
  for(const patch of [{sequence:0},{sequence:1.5},{persons:0},{persons:1.5},{persons:NaN},{from:-1},{to:city.cells.length},{epoch:'not an id'}]){
    const before=rail.snapshot;assert.throws(()=>rail.acceptTrafficDemand({...offer(),...patch}));assert.deepEqual(rail.snapshot,before);
  }
  const saved=JSON.parse(serializeParkSession(city,runtime));saved.parkRuntime.rail.network.revision=Number.MAX_SAFE_INTEGER;saved.parkRuntime.rail.binding.revision=Number.MAX_SAFE_INTEGER;
  const loaded=deserializeParkSession(JSON.stringify(saved)),full=loaded.runtime.rail!,before=full.snapshot;
  assert.throws(()=>full.acceptTrafficDemand(offer()),/overflow/);assert.deepEqual(full.snapshot,before);
});
