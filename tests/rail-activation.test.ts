import test from 'node:test';
import assert from 'node:assert/strict';
import {createCity,step,serialize,buildRoad,zoneCell,buildPark,buildPlant,buildCampus,bulldoze} from '../src/sim.ts';
import {RailNetworkRuntime,GAME_RAIL_POLICY} from '../src/rail/network-runtime.ts';
import {createParkRuntime,advanceParkRuntime,serializeParkSession,deserializeParkSession} from '../src/park-runtime.ts';
import {buildBusDepot} from '../src/bus/placement.ts';
import {buildTaxiDepot} from '../src/taxi/placement.ts';
import {captureTrafficGameInput} from '../src/traffic/game.ts';
function fixture(){
 const city=createCity();for(let i=0;i<60;i++)step(city);
 const runtime=createParkRuntime(city),rail=RailNetworkRuntime.create(city,'model-test',city.tick*1440);runtime.rail=rail;
 rail.addStation('a',315);rail.addStation('b',312);rail.addTrackPath(315,339);rail.addTrackPath(339,336);rail.addTrackPath(336,312);rail.configureGameService();
 return {city,runtime,rail};
}
const count=(rail:RailNetworkRuntime)=>{const s=rail.snapshot;return {offered:s.model!.offeredPersons,completed:s.model!.retiredPersons+s.service!.snapshot.batches.reduce((n,b)=>n+b.completed,0),live:s.service!.snapshot.batches.reduce((n,b)=>n+b.persons-b.completed,0),batches:s.service!.snapshot.batches.length};};
test('enabled shuttle derives bounded modeled riders, moves, and retires completed queues without changing money or road input',()=>{
 const {city,rail}=fixture(),raw=serialize(city),traffic=captureTrafficGameInput(city),start=rail.snapshot.minute;
 let moving=false;for(let t=60;t<=1440*4;t+=60){rail.advanceTo(start+t);moving ||= rail.snapshot.service!.snapshot.train.destination!==null;const c=count(rail);assert.equal(c.offered,c.completed+c.live);assert.ok(c.batches<=32);}
 const totals=count(rail);assert.ok(totals.offered>32);assert.ok(totals.completed>0);assert.ok(rail.snapshot.model!.retiredPersons>0);assert.ok(moving);
 assert.equal(serialize(city),raw);assert.deepEqual(captureTrafficGameInput(city),traffic,'no unsupported traffic-relief claim');
 const before=rail.snapshot;assert.throws(()=>rail.acceptPreparedDemand({id:'model:0',from:315,to:312,offeredPersons:1,roadAdmittedPersons:0,leases:[]},{id:'model:0',requestId:'model:0',leaseId:'model:0',from:315,to:312,fromStation:'a',toStation:'b',persons:1,readyAtMinute:start,egressMinutes:3}),/next sequence/);assert.deepEqual(rail.snapshot,before);
});
test('v25 server session retains moving modeled train, sequence and queues across load and identical continued game time',()=>{
 const a=fixture();advanceParkRuntime(a.city,a.runtime,200,()=>step(a.city));
 const raw=serializeParkSession(a.city,a.runtime);assert.equal(JSON.parse(raw).version,25);const b=deserializeParkSession(raw);assert.equal(serializeParkSession(b.city,b.runtime),raw);
 for(const x of[a,b])advanceParkRuntime(x.city,x.runtime,1600,()=>step(x.city));
 assert.equal(serializeParkSession(a.city,a.runtime),serializeParkSession(b.city,b.runtime));
});
test('closed or paused service creates no new riders, retains waiting passengers and can resume without resets',()=>{
 const {rail}=fixture(),start=rail.snapshot.minute;rail.advanceTo(start+120);const offered=count(rail).offered;assert.ok(offered>0);
 rail.setStationOpen('b',false);rail.advanceTo(start+600);assert.equal(count(rail).offered,offered);assert.throws(()=>rail.removeService());
 rail.setStationOpen('b',true);rail.setServiceEnabled(false);rail.advanceTo(start+1200);assert.equal(count(rail).offered,offered);
 rail.setServiceEnabled(true);rail.advanceTo(start+2500);assert.ok(count(rail).completed>0);assert.ok(count(rail).offered>offered);
});
test('atomic track construction and mutual occupancy reject before mutation, cash or ID allocation',()=>{
 const {city,runtime,rail}=fixture(),raw=serializeParkSession(city,runtime),id=city.nextId;
 for(const command of[()=>rail.addTrackPath(336,288),()=>rail.addTrackPath(336,361)]){assert.throws(command);assert.equal(serializeParkSession(city,runtime),raw);}
 for(const action of[()=>buildRoad(city,336,337),()=>zoneCell(city,336,'C'),()=>buildPark(city,336),()=>buildPlant(city,336,'water'),()=>buildCampus(city,336,'school'),()=>bulldoze(city,336),()=>buildBusDepot(city,336,true),()=>buildTaxiDepot(city,336,true)]){assert.equal(action().ok,false);assert.equal(serializeParkSession(city,runtime),raw);assert.equal(city.nextId,id);}
});
test('disconnected line cannot launch and hostile unbounded service policy rejects',()=>{
 const city=createCity(1,{starter:false}),rail=RailNetworkRuntime.create(city,'empty',0);rail.addStation('a',1);rail.addStation('b',5);assert.throws(()=>rail.configureGameService(),/round trip/);assert.equal(rail.snapshot.service,null);
 rail.addTrackPath(1,5);assert.throws(()=>rail.configureService({...GAME_RAIL_POLICY,seats:Number.MAX_SAFE_INTEGER}),/bounds/);assert.equal(rail.snapshot.service,null);
});
test('modeled restore rejects compensated excessive backlog, altered policy, null model and clock/counter forgery',()=>{
 const {city,runtime,rail}=fixture();advanceParkRuntime(city,runtime,60,()=>step(city));const raw=serializeParkSession(city,runtime),saved=JSON.parse(raw),original=rail.snapshot;
 for(const corrupt of[
   (n:any)=>{const batch=n.service.snapshot.batches[0],d=n.service.demands[0];batch.persons+=128;batch.outside+=128;d.offeredPersons+=128;d.leases[0].persons+=128;n.model.offeredPersons+=128;},
   (n:any)=>{n.service.config.maxBatches=1024;},
   (n:any)=>{n.model=null;},
   (n:any)=>{n.model.nextSequence=0;},
   (n:any)=>{n.model.offeredPersons++;},
   (n:any)=>{n.model.nextOfferMinute=n.minute-1;},
 ]){const value=structuredClone(saved);corrupt(value.parkRuntime.rail.network);assert.throws(()=>deserializeParkSession(JSON.stringify(value)));}
 assert.deepEqual(rail.snapshot,original);assert.equal(serializeParkSession(city,runtime),raw);
});
test('stopping new intake drains all retained riders before safe removal and later reconfiguration',()=>{
 const {city,runtime,rail}=fixture(),start=rail.snapshot.minute;advanceParkRuntime(city,runtime,120,()=>step(city));const offered=count(rail).offered;assert.ok(offered>0);
 rail.setModelAccepting(false);const raw=serializeParkSession(city,runtime),loaded=deserializeParkSession(raw);assert.equal(loaded.runtime.rail!.snapshot.model!.accepting,false);
 rail.advanceTo(start+4000);assert.equal(count(rail).offered,offered);assert.equal(count(rail).live,0);assert.equal(count(rail).completed,offered);
 const fence=rail.snapshot.model!.nextSequence;rail.removeService();assert.equal(rail.snapshot.service,null);rail.configureGameService();assert.equal(rail.snapshot.model!.nextSequence,fence);assert.equal(rail.snapshot.model!.accepting,true);
 rail.advanceTo(start+5000);assert.ok(count(rail).offered>offered);assert.ok(rail.snapshot.model!.nextSequence>fence);
});
test('modeled rail one-minute and batched clocks agree exactly including retired counters',()=>{
 const a=fixture(),b=fixture(),start=a.rail.snapshot.minute;a.rail.advanceTo(start+1440);for(let t=1;t<=1440;t++)b.rail.advanceTo(start+t);assert.deepEqual(a.rail.snapshot,b.rail.snapshot);
 const paused=b.rail.snapshot;advanceParkRuntime(b.city,b.runtime,0,()=>step(b.city));assert.deepEqual(b.rail.snapshot,paused);
});
