import test from 'node:test';
import assert from 'node:assert/strict';
import {TrafficBridge, createBusLoadSink, type TrafficScope} from '../src/traffic/bridge.ts';
import {buildNetwork, linkKey} from '../src/traffic/network.ts';
import {assignPeriod} from '../src/traffic/routing.ts';
import {TrafficClock} from '../src/traffic/clock.ts';
import {createBusTrafficHook} from '../src/bus/traffic-hook.ts';
import {BUS_ENABLED, BUS_PCU} from '../src/bus/types.ts';
import {createCity} from '../src/sim.ts';

const scope:TrafficScope={cityId:'c',revisionId:'r',epoch:'e'};
const road=()=>buildNetwork({cells:Array.from({length:576},(_,i)=>({road:[25,26,27,28,50].includes(i)}))},{capacityPerLane:30});
const L=linkKey(26,27);
const run=(load?:Map<string,number>,mode:'taxi'|'rail'|'bus'='rail')=>{
  const net=road(),b=new TrafficBridge(scope);
  b.offerPassenger({scope,requestId:'t',purpose:'commute',from:25,to:28,persons:2000});
  b.reserveMode({scope,requestId:'t',leaseId:'l',mode,persons:40});
  if(load)b.busRoadSink().applyBusLoad(0,load);
  b.advanceTo(scope,net,30);return b;
};

test('sink: replace-not-add, empty clears, unknown/bad links ignored, idempotent',()=>{
  const seen:Map<string,number>[]=[],s=createBusLoadSink(l=>seen.push(new Map(l)),k=>k!=='zzz');
  assert.equal(s.acceptsBus,true);
  s.applyBusLoad(1,new Map([[L,BUS_PCU]]));s.applyBusLoad(1,new Map([[L,BUS_PCU]]));
  assert.equal(s.load.get(L),BUS_PCU,'replace, not add');
  s.applyBusLoad(2,new Map([['zzz',4],['x',NaN],['y',-1],[L,4]]));assert.deepEqual([...s.load],[[L,4]]);
  assert.doesNotThrow(()=>s.applyBusLoad(3,null as unknown as Map<string,number>));
  s.applyBusLoad(4,new Map());assert.equal(s.load.size,0);
  assert.deepEqual(seen[0],seen[1],'same call twice → same result');
  // bridge sink with links not in the network: no throw, identical to no load
  assert.deepEqual(run(new Map([['999:998',50]])).passengerReceipt(scope,'t'),run().passengerReceipt(scope,'t'));
});
test('bus mode lease: accepted, counted, conservation 0, snapshot round-trips; taxi/rail unchanged',()=>{
  const b=run(undefined,'bus');let r=b.passengerReceipt(scope,'t');
  assert.equal(r.busPendingPersons,40);assert.equal(r.railPendingPersons,0);assert.equal(r.conservationError,0);
  b.acknowledgeMode({scope,leaseId:'l',boardedPersons:30,releasedPersons:10,completedPersons:30});
  r=b.passengerReceipt(scope,'t');assert.equal(r.busCompletedPersons,30);assert.ok(Math.abs(r.conservationError)<1e-7);
  const back=TrafficBridge.restore(scope,b.exportState());assert.deepEqual(back.passengerReceipt(scope,'t'),r);
  const rail=run(undefined,'rail').passengerReceipt(scope,'t');assert.equal(rail.railPendingPersons,40);assert.equal(rail.busPendingPersons,0);
});
test('bus load creates no passenger moves and keeps flow conservation',()=>{
  const net=road(),with_=run(new Map([[L,8]]));const d=with_.diagnostics(net),s=with_.exportState();
  assert.ok(Math.abs(d.conservationError)<1e-6);assert.equal(s.moves.length,0);assert.equal(s.passengers.length,1);assert.equal(s.flow.offered,run().exportState().flow.offered);
  assert.ok(Math.abs(with_.passengerReceipt(scope,'t').conservationError)<1e-7);
});
test('congestion goes up with buses on (flow throughput and BPR times)',()=>{
  const net=road(),base=run().passengerReceipt(scope,'t'),bus=run(new Map([[L,BUS_PCU*1]])).passengerReceipt(scope,'t');
  assert.ok(bus.privateCompletedPersons<base.privateCompletedPersons,`${bus.privateCompletedPersons} < ${base.privateCompletedPersons}`);
  const od=[{from:25,to:28,vehicles:20}],a=assignPeriod(net,od),b=assignPeriod(net,od,new Map(),0,new Map([[L,400]]));
  assert.ok(b.times.get(L)!>a.times.get(L)!);assert.equal(b.served,a.served);assert.ok(b.vehicleSeconds>a.vehicleSeconds);
  assert.deepEqual(assignPeriod(net,od,new Map(),0,new Map()),a,'empty background = unchanged');
});
test('flag off: no sink connected → traffic clock identical; hook still no-op without sink',()=>{
  assert.equal(BUS_ENABLED,false);
  const go=(connect:boolean)=>{const c=createCity(),k=new TrafficClock({enabled:true});if(connect)k.busRoadSink().applyBusLoad(0,new Map());k.advance(c,0);k.advance(c,8*60);return JSON.stringify([k.totals,k.lastOd]);};
  assert.equal(go(false),go(true));
  const h=createBusTrafficHook();let n=0;h.push(0,()=>{n++;return new Map();});assert.equal(n,0);
  h.connect(new TrafficClock({enabled:true}).busRoadSink());assert.equal(h.active,true);
});
