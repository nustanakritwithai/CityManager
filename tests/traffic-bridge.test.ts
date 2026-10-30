import test from 'node:test';
import assert from 'node:assert/strict';
import {TrafficBridge, type TrafficScope} from '../src/traffic/bridge.ts';
import {buildNetwork} from '../src/traffic/network.ts';

const scope:TrafficScope={cityId:'synthetic-city',revisionId:'revision-1',epoch:'test-epoch'};
const road=()=>buildNetwork({cells:Array.from({length:576},(_,i)=>({road:[25,26,27,28,50].includes(i)}))},{capacityPerLane:30});
const passenger={scope,requestId:'trip-1',purpose:'commute' as const,from:25,to:28,persons:100};
const reserve={scope,requestId:'trip-1',leaseId:'lease-1',mode:'rail' as const,persons:40};
const check=(b:TrafficBridge)=>assert.ok(Math.abs(b.passengerReceipt(scope,'trip-1').conservationError)<1e-7);

test('exclusive mode reservation and duplicate release preserve passenger demand',()=>{
  const b=new TrafficBridge(scope);b.offerPassenger(passenger);b.offerPassenger(passenger);
  b.reserveMode(reserve);b.reserveMode(reserve);
  assert.equal(b.passengerReceipt(scope,'trip-1').privateWaitingPersons,60);
  const receipt={scope,leaseId:'lease-1',boardedPersons:20,releasedPersons:20,completedPersons:0};
  b.acknowledgeMode(receipt);b.acknowledgeMode(receipt);
  assert.equal(b.passengerReceipt(scope,'trip-1').privateWaitingPersons,80);
  b.acknowledgeMode({...receipt,completedPersons:20});
  b.acknowledgeMode({...receipt,boardedPersons:0,releasedPersons:0});
  assert.equal(b.passengerReceipt(scope,'trip-1').railCompletedPersons,20);check(b);
  const before=b.exportState();assert.throws(()=>b.acknowledgeMode({...receipt,releasedPersons:21}));assert.deepEqual(b.exportState(),before);
});

test('admitted passengers cannot be leased, and freight never appears in passenger ownership',()=>{
  const b=new TrafficBridge(scope);b.offerPassenger(passenger);b.offerFreight({scope,requestId:'goods',from:25,to:28,vehicleUnits:100});
  b.advanceTo(scope,road(),60);
  const p=b.passengerReceipt(scope,'trip-1');assert.ok(p.privateAdmittedPersons>0);
  assert.throws(()=>b.reserveMode({...reserve,persons:Math.floor(p.privateWaitingPersons)+1}));
  assert.throws(()=>b.reserveMode({...reserve,requestId:'goods'}));
  assert.equal(p.offeredPersons,100);check(b);
});

test('empty taxi load competes with private road traffic without adding passengers',()=>{
  const run=(empty:boolean)=>{
    const b=new TrafficBridge(scope);b.offerPassenger({...passenger,persons:1000});
    if(empty)for(let i=0;i<20;i++) {
      b.registerTaxi({scope,unitId:`cab-${i}`,cell:25});
      b.requestTaxiMove(road(),{scope,moveId:`empty-${i}`,unitId:`cab-${i}`,from:25,to:28,carriedPersons:0});
    }
    b.advanceTo(scope,road(),60);check(b);return b;
  };
  const a=run(false),b=run(true);
  assert.equal(a.passengerReceipt(scope,'trip-1').offeredPersons,b.passengerReceipt(scope,'trip-1').offeredPersons);
  assert.equal(b.diagnostics(road()).offered-a.diagnostics(road()).offered,20);
  assert.ok(b.passengerReceipt(scope,'trip-1').privateCompletedPersons<a.passengerReceipt(scope,'trip-1').privateCompletedPersons);
  assert.ok(b.diagnostics(road()).completed<=30);
});

test('taxi drop-off cannot complete before actual loaded road arrival; roads cuts preserve riders',()=>{
  const b=new TrafficBridge(scope);b.offerPassenger({...passenger,persons:10});
  b.reserveMode({...reserve,mode:'taxi',persons:10});
  const service={scope,leaseId:'lease-1',boardedPersons:10,releasedPersons:0,completedPersons:0};
  b.acknowledgeMode(service);b.registerTaxi({scope,unitId:'cab',cell:25});
  const move={scope,moveId:'loaded',unitId:'cab',from:25,to:28,carriedPersons:10,leaseId:'lease-1'};
  b.requestTaxiMove(road(),move);b.requestTaxiMove(road(),move);
  assert.throws(()=>b.acknowledgeMode({...service,completedPersons:10}));
  b.advanceTo(scope,road(),1);
  const closed=buildNetwork({cells:Array.from({length:576},(_,i)=>({road:[25,26].includes(i)}))},{capacityPerLane:30});
  b.advanceTo(scope,closed,61);assert.equal(b.roadReceipt(scope,'loaded').arrived,false);check(b);
  assert.throws(()=>b.acknowledgeMode({...service,releasedPersons:10}));
  b.advanceTo(scope,road(),121);assert.equal(b.roadReceipt(scope,'loaded').arrived,true);
  b.acknowledgeMode({...service,completedPersons:10});b.acknowledgeMode({...service,completedPersons:10});
  assert.equal(b.passengerReceipt(scope,'trip-1').taxiCompletedPersons,10);
  assert.equal(b.passengerReceipt(scope,'trip-1').privateCompletedPersons,0);check(b);
});

test('scope mismatch, duplicate payloads and concurrent moves reject without mutation',()=>{
  const b=new TrafficBridge(scope);b.offerPassenger(passenger);const before=b.exportState();
  assert.throws(()=>b.reserveMode({...reserve,scope:{...scope,epoch:'stale'}}));
  assert.throws(()=>b.offerPassenger({...passenger,persons:101}));assert.deepEqual(b.exportState(),before);
  b.registerTaxi({scope,unitId:'cab',cell:25});b.requestTaxiMove(road(),{scope,moveId:'first',unitId:'cab',from:25,to:28,carriedPersons:0});
  const busy=b.exportState();assert.throws(()=>b.requestTaxiMove(road(),{scope,moveId:'second',unitId:'cab',from:25,to:27,carriedPersons:0}));assert.deepEqual(b.exportState(),busy);
});

test('bridge reload continues exact queues, lease tombstones and receipt counters',()=>{
  const a=new TrafficBridge(scope,100);a.offerPassenger(passenger);a.reserveMode(reserve);a.advanceTo(scope,road(),103);
  a.acknowledgeMode({scope,leaseId:'lease-1',boardedPersons:10,releasedPersons:30,completedPersons:0});
  const saved=JSON.parse(JSON.stringify(a.exportState())),b=TrafficBridge.restore(scope,saved);
  a.advanceTo(scope,road(),160);b.advanceTo(scope,road(),160);assert.deepEqual(b.exportState(),a.exportState());
  b.offerPassenger(passenger);b.reserveMode(reserve);assert.deepEqual(b.exportState(),a.exportState());
  assert.throws(()=>TrafficBridge.restore({...scope,cityId:'another-city'},saved));
  const corrupt=structuredClone(saved);corrupt.leases[0].completedPersons=20;assert.throws(()=>TrafficBridge.restore(scope,corrupt));
  const omitted=structuredClone(saved);omitted.passengers=[];assert.throws(()=>TrafficBridge.restore(scope,omitted));
});

test('bounded catch-up and pause retain observed time without replaying road admission',()=>{
  const b=new TrafficBridge(scope);b.offerPassenger(passenger);b.advanceTo(scope,road(),1500,true);
  assert.equal(b.passengerReceipt(scope,'trip-1').privateAdmittedPersons,0);
  assert.equal(b.advanceTo(scope,road(),1500).pendingMinutes,60);
  const c=TrafficBridge.restore(scope,b.exportState());c.advanceTo(scope,road(),1500);
  const before=c.exportState();c.advanceTo(scope,road(),1500);assert.deepEqual(c.exportState(),before);check(c);
});

test('renewing the accepted epoch rejects stale mode callbacks without dropping the ledger',()=>{
  const b=new TrafficBridge(scope);b.offerPassenger(passenger);b.reserveMode(reserve);
  const fresh=b.renewEpoch(scope,'after-load'),before=b.exportState();
  assert.throws(()=>b.acknowledgeMode({scope,leaseId:'lease-1',boardedPersons:40,releasedPersons:0,completedPersons:40}));
  assert.deepEqual(b.exportState(),before);
  b.acknowledgeMode({scope:fresh,leaseId:'lease-1',boardedPersons:40,releasedPersons:0,completedPersons:40});
  assert.equal(b.passengerReceipt(fresh,'trip-1').railCompletedPersons,40);
});

test('contradictory individually valid old receipts cannot board released passengers',()=>{
  const b=new TrafficBridge(scope);b.offerPassenger(passenger);b.reserveMode(reserve);
  b.acknowledgeMode({scope,leaseId:'lease-1',boardedPersons:0,releasedPersons:40,completedPersons:0});
  const before=b.exportState();
  assert.throws(()=>b.acknowledgeMode({scope,leaseId:'lease-1',boardedPersons:40,releasedPersons:0,completedPersons:0}));
  assert.deepEqual(b.exportState(),before);check(b);
});

test('restoring completed taxi receipts rejects changed passenger endpoints and unowned load',()=>{
  const b=new TrafficBridge(scope);b.offerPassenger({...passenger,persons:10});b.reserveMode({...reserve,mode:'taxi',persons:10});
  b.acknowledgeMode({scope,leaseId:'lease-1',boardedPersons:10,releasedPersons:0,completedPersons:0});
  b.registerTaxi({scope,unitId:'cab',cell:25});b.requestTaxiMove(road(),{scope,moveId:'loaded',unitId:'cab',from:25,to:28,carriedPersons:10,leaseId:'lease-1'});b.advanceTo(scope,road(),60);
  const saved=b.exportState();assert.deepEqual(TrafficBridge.restore(scope,saved).exportState(),saved);
  const wrong=structuredClone(saved);wrong.moves[0].to=27;wrong.flow.requests.find(r=>r.requestId==='["taxi","loaded"]')!.to=27;
  assert.throws(()=>TrafficBridge.restore(scope,wrong),/endpoints/);
  const missing=structuredClone(saved);missing.moves=[];missing.taxis[0].moveIds=[];
  assert.throws(()=>TrafficBridge.restore(scope,missing),/Unowned/);
});
