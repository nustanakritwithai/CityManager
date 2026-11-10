import test from 'node:test';
import assert from 'node:assert/strict';
import {createCity,serialize,zoneCell,step} from '../src/sim.ts';
import {createParkRuntime,serializeParkSession,deserializeParkSession,expandValidatedParkSession,advanceParkRuntime} from '../src/park-runtime.ts';
import {RailNetworkRuntime,GAME_RAIL_POLICY} from '../src/rail/network-runtime.ts';
import {railPath} from '../src/rail/graph.ts';
import {expandedCellAt} from '../src/expanded-map-grid.ts';

function fixture(){
 const city=createCity(61031,{starter:false}),runtime=createParkRuntime(city),rail=RailNetworkRuntime.create(city,'removal-fixture',0);runtime.rail=rail;
 rail.addStation('a',289);rail.addStation('b',293);rail.addTrackPath(289,293);rail.addTrackPath(291,339);
 return {city,runtime,rail};
}
test('straight-run removal is atomic, bidirectional and preserves branches, stations, core city and saved identity',()=>{
 const {city,runtime,rail}=fixture(),core=serialize(city),before=rail.snapshot;
 rail.removeTrackPath(293,289);
 assert.deepEqual(rail.snapshot.graph.links,before.graph.links.filter(l=>l.from>=291&&l.to>=291&&(l.from>=315||l.to>=315)));
 assert.equal(rail.snapshot.revision,before.revision+1);assert.equal(rail.snapshot.graph.revision,before.graph.revision+1);
 assert.deepEqual(rail.snapshot.stations,before.stations);assert.equal(rail.isReserved(290),false);assert.equal(rail.isReserved(291),true);assert.equal(rail.isReserved(289),true);
 assert.equal(serialize(city),core);assert.equal(railPath(rail.snapshot.graph,289,293),null);
 const raw=serializeParkSession(city,runtime),loaded=deserializeParkSession(raw);assert.equal(serializeParkSession(loaded.city,loaded.runtime),raw);
 assert.deepEqual(loaded.runtime.rail!.snapshot,rail.snapshot);assert.equal(zoneCell(loaded.city,290,'R').ok,true);
});
test('missing, diagonal, identical or out-of-bounds selections never partially remove track',()=>{
 const {city,runtime,rail}=fixture();rail.removeTrackPath(291,292);const before=serializeParkSession(city,runtime);
 for(const [a,b] of [[289,293],[289,314],[289,289],[-1,293],[289,576],[NaN,293]]){
  assert.throws(()=>rail.removeTrackPath(a,b));assert.equal(serializeParkSession(city,runtime),before);
 }
 assert.throws(()=>rail.removeTracksAt(400),/not found/);assert.equal(serializeParkSession(city,runtime),before);
});
test('cell demolition removes only touching segments and retains other track and station reservations',()=>{
 const {city,runtime,rail}=fixture(),before=rail.snapshot,core=serialize(city);
 rail.removeTracksAt(291);
 assert.deepEqual(rail.snapshot.graph.links,before.graph.links.filter(l=>l.from!==291&&l.to!==291));
 assert.deepEqual(rail.snapshot.stations,before.stations);assert.equal(rail.isReserved(291),false);
 assert.equal(rail.isReserved(290),true);assert.equal(rail.isReserved(315),true);assert.equal(serialize(city),core);
 const raw=serializeParkSession(city,runtime),loaded=deserializeParkSession(raw);assert.equal(serializeParkSession(loaded.city,loaded.runtime),raw);
});
test('occupied and paused trains reject all removal without losing passengers or reservations; drained removal succeeds',()=>{
 const city=createCity();for(let i=0;i<60;i++)step(city);const runtime=createParkRuntime(city),rail=RailNetworkRuntime.create(city,'occupied-removal',city.tick*1440);runtime.rail=rail;
 rail.addStation('a',315);rail.addStation('b',312);rail.addTrackPath(315,339);rail.addTrackPath(339,336);rail.addTrackPath(336,312);rail.configureGameService();
 advanceParkRuntime(city,runtime,120,()=>step(city));assert.ok(rail.snapshot.service!.snapshot.train.destination);
 for(const paused of [false,true]){
  if(paused)rail.setServiceEnabled(false);const before=serializeParkSession(city,runtime);
  for(const remove of [()=>rail.removeTrackPath(339,336),()=>rail.removeTracksAt(338)]){assert.throws(remove,/occupied/);assert.equal(serializeParkSession(city,runtime),before);assert.equal(rail.isReserved(338),true);}
 }
 rail.setModelAccepting(false);rail.setServiceEnabled(true);advanceParkRuntime(city,runtime,4000,()=>step(city));
 const before=rail.snapshot;assert.equal(before.service!.snapshot.train.destination,null);assert.equal(before.model!.offeredPersons,before.model!.retiredPersons);
 rail.removeTrackPath(339,336);assert.deepEqual(rail.snapshot.service,before.service&&{...before.service,snapshot:{...before.service.snapshot,graphRevision:before.graph.revision+1}});
 assert.deepEqual(rail.snapshot.model,before.model);assert.deepEqual(rail.snapshot.stations,before.stations);
 const raw=serializeParkSession(city,runtime),loaded=deserializeParkSession(raw);assert.equal(serializeParkSession(loaded.city,loaded.runtime),raw);
});
test('removal works across expanded-map seams and graph overflow is atomic',()=>{
 const initial=fixture(),expanded=expandValidatedParkSession(deserializeParkSession(serializeParkSession(initial.city,initial.runtime))),rail=expanded.runtime.rail!;
 const a=expandedCellAt(5,2)!,b=expandedCellAt(5,-2)!;rail.addTrackPath(a,b);rail.removeTrackPath(b,a);assert.equal(rail.isReserved(expandedCellAt(5,-1)!),false);
 const raw=JSON.parse(serializeParkSession(expanded.city,expanded.runtime));raw.parkRuntime.rail.network.graph.revision=Number.MAX_SAFE_INTEGER;
 const loaded=deserializeParkSession(JSON.stringify(raw)),before=serializeParkSession(loaded.city,loaded.runtime);
 assert.throws(()=>loaded.runtime.rail!.removeTracksAt(290),/revision/);assert.equal(serializeParkSession(loaded.city,loaded.runtime),before);
});
test('disconnecting an idle service retains queued people across save/reload and repair',()=>{
 const {city,runtime,rail}=fixture();rail.configureService(GAME_RAIL_POLICY);
 rail.acceptPreparedDemand({id:'queued',from:289,to:293,offeredPersons:4,roadAdmittedPersons:0,leases:[]},{id:'queued',requestId:'queued',leaseId:'queued',from:289,to:293,fromStation:'a',toStation:'b',persons:4,readyAtMinute:0,egressMinutes:3});
 rail.setServiceEnabled(false);const before=rail.snapshot;
 rail.removeTrackPath(290,292);assert.equal(railPath(rail.snapshot.graph,289,293),null);
 assert.deepEqual(rail.snapshot.service!.demands,before.service!.demands);assert.deepEqual(rail.snapshot.service!.snapshot.batches,before.service!.snapshot.batches);
 const raw=serializeParkSession(city,runtime),loaded=deserializeParkSession(raw);assert.equal(serializeParkSession(loaded.city,loaded.runtime),raw);
 loaded.runtime.rail!.addTrackPath(289,293);assert.ok(railPath(loaded.runtime.rail!.snapshot.graph,289,293));assert.deepEqual(loaded.runtime.rail!.snapshot.service!.snapshot.batches,before.service!.snapshot.batches);
});
