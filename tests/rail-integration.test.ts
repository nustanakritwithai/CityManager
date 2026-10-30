import test from 'node:test';
import assert from 'node:assert/strict';
import { PassengerRail, type PassengerRailConfig } from '../src/rail/passenger.ts';
import { createRailGraph } from '../src/rail/graph.ts';
import { railTrainPose } from '../src/rail/presentation.ts';
import { railAccessPath } from '../src/rail/access.ts';
import { serializeRailPreview, restoreRailPreview } from '../src/rail/preview-session.ts';
import { createCity, step } from '../src/sim.ts';
import { createParkRuntime, serializeParkSession } from '../src/park-runtime.ts';
import { RailPreviewRuntime, PASSENGER_RAIL_ENABLED } from '../src/rail/preview-runtime.ts';

const config: PassengerRailConfig = { id:'preview',lineId:'line',trainId:'train',seats:3,minimumDwellMinutes:2,minimumDepartureIntervalMinutes:4,maxBatches:40,
  stations:[{id:'a',cell:0,queueCapacity:4,boardingPerMinute:2,alightingPerMinute:1},{id:'b',cell:25,queueCapacity:4,boardingPerMinute:2,alightingPerMinute:1}] };
const graph = createRailGraph(1,[{from:0,to:1,minutes:2},{from:1,to:25,minutes:6},{from:25,to:1,minutes:6},{from:1,to:0,minutes:2}]);
function make(start=0) { const rail = new PassengerRail(config,graph,start);rail.offer({id:'batch',requestId:'request',leaseId:'lease',from:2,to:26,fromStation:'a',toStation:'b',persons:12,readyAtMinute:start+1,egressMinutes:3});return rail; }

test('rail restore continues the exact moving, full-train, closed-station and egress states across midnight',()=>{
  for(const elapsed of [0,2,5,10,11,13,20]) {
    const original=make(1435);original.advanceTo(1435+elapsed,elapsed);original.setStationOpen('b',false);
    const restored=PassengerRail.restore(config,graph,original.snapshot);
    assert.deepEqual(restored.snapshot,original.snapshot);
    original.setStationOpen('b',true);restored.setStationOpen('b',true);
    for(let n=1;n<=90;n++){original.advanceTo(1435+elapsed+n,1);restored.advanceTo(1435+elapsed+n,1);assert.deepEqual(restored.snapshot,original.snapshot);}
  }
});
test('rail restore rejects corrupt ownership, counts, clocks, geometry and unknown fields',()=>{
  const rail=make();rail.advanceTo(3,3);const snapshot=rail.snapshot;
  const bad=[(s:any)=>s.batches[0].waiting++,(s:any)=>s.batches[0].onboard=99,(s:any)=>s.batches.push(structuredClone(s.batches[0])),
    (s:any)=>s.train.path=[0,25],(s:any)=>s.train.remainingMinutes=100,(s:any)=>s.train.blockOwner=null,(s:any)=>s.graphRevision=2,
    (s:any)=>s.minute=-1,(s:any)=>s.openStations.extra=true,(s:any)=>s.train.extra=1,(s:any)=>s.train.dwellUntil=100000,(s:any)=>s.batches=[],(s:any)=>s.batches[0].egress.push({persons:0,readyAtMinute:10})];
  for(const mutate of bad){const s=structuredClone(snapshot);mutate(s);assert.throws(()=>PassengerRail.restore(config,graph,s));}
  assert.deepEqual(rail.snapshot,snapshot);
});
test('disconnected empty line restores without erasing passengers and resumes after repair',()=>{
  const rail=make();const broken=createRailGraph(2,[]);rail.replaceGraph(broken);
  const restored=PassengerRail.restore(config,broken,rail.snapshot);assert.equal(restored.diagnostics().outside,12);
  restored.replaceGraph(createRailGraph(3,graph.links));restored.advanceTo(100,100);assert.equal(restored.diagnostics().completed,12);
});
test('train pose follows weighted directed segments continuously and never advances simulation',()=>{
  const rail=make();rail.advanceTo(2,2);const snap=rail.snapshot;
  const p=railTrainPose(config,graph,snap,.5);assert.equal(p.x,.25);assert.equal(p.z,0);
  rail.advanceTo(4,2);const corner=railTrainPose(config,graph,rail.snapshot);assert.equal(corner.x,1);assert.equal(corner.z,0);
  rail.advanceTo(7,3);const mid=railTrainPose(config,graph,rail.snapshot);assert.equal(mid.x,1);assert.equal(mid.z,.5);
  assert.deepEqual(railTrainPose(config,graph,snap,.5),p);assert.equal(snap.minute,2);
  assert.throws(()=>railTrainPose(config,createRailGraph(2,[]),snap));
});
test('station access uses connected pedestrian road edges and refuses missing links',()=>{
  const city=createCity(123);for(const c of city.cells)c.road=false;
  for(const n of [24,25,26])city.cells[n].road=true;
  assert.deepEqual(railAccessPath(city,0,2),[0,24,25,26,2]);
  city.roadTopology={version:1,blocked:[24*576+25],oneWay:{25:1}};
  assert.equal(railAccessPath(city,0,2),null);
  city.roadTopology.blocked=[];assert.deepEqual(railAccessPath(city,2,0),[2,26,25,24,0]);
  assert.equal(railAccessPath(city,0,575),null);
});
test('synthetic session reload binds the exact city bytes, identity, revision and clock without storage access',()=>{
  const city=createCity(123),parks=createParkRuntime(city),rail=make(city.tick*1440);
  const cityRaw=serializeParkSession(city,parks);
  const raw=serializeRailPreview({sessionId:'fixture-city',revision:3,cityRaw,config,graph,rail:rail.snapshot,demands:[{id:'request',from:2,to:26,offeredPersons:12,roadAdmittedPersons:0,leases:[{id:'lease',persons:12,completedPersons:0}]}]});
  const restored=restoreRailPreview(raw,{sessionId:'fixture-city',revision:3,cityRaw});assert.deepEqual(restored.rail.snapshot,rail.snapshot);
  for(const expected of [{sessionId:'another',revision:3,cityRaw},{sessionId:'fixture-city',revision:4,cityRaw},{sessionId:'fixture-city',revision:3,cityRaw:cityRaw+' '}])assert.throws(()=>restoreRailPreview(raw,expected));
  const corrupt=JSON.parse(raw);corrupt.rail.minute++;assert.throws(()=>restoreRailPreview(JSON.stringify(corrupt),{sessionId:'fixture-city',revision:3,cityRaw}));
  corrupt.rail.minute--;corrupt.demands[0].leases[0].persons=11;assert.throws(()=>restoreRailPreview(JSON.stringify(corrupt),{sessionId:'fixture-city',revision:3,cityRaw}));
  assert.equal(serializeParkSession(city,parks),cityRaw);
});

test('preview host follows the actual city clock at pause, speed, frame interruption and reload',()=>{
  assert.equal(PASSENGER_RAIL_ENABLED,false);
  const slow=new RailPreviewRuntime(),fast=new RailPreviewRuntime();
  for(const host of [slow,fast]){assert.equal(host.offerTrip(291,305,24),true);assert.equal(host.offerTrip(0,575,10),false);}
  const paused=slow.capture();slow.advance(1440,true);assert.equal(slow.capture().raw,paused.raw);
  for(let n=0;n<1440;n++)slow.advance(1);fast.advance(1440);
  assert.deepEqual(slow.rail.snapshot,fast.rail.snapshot);assert.deepEqual(slow.city,fast.city);assert.equal(fast.diagnostics().roadAssignable,10);
  assert.equal(fast.diagnostics().completed,24);assert.equal(fast.diagnostics().modalConservationError,0);
  const capture=fast.capture();fast.advance(1440);fast.restore(capture);assert.equal(fast.capture().raw,capture.raw);
  fast.advance(3000,false,()=>false);assert.equal(fast.rail.snapshot.minute,fast.city.tick*1440+fast.parks.activity.minute);
  assert.ok(fast.rail.snapshot.minute<4320);
});

test('rail preview leaves the economy identical to the same synthetic city stepped without rail',()=>{
  const host=new RailPreviewRuntime(),baseline=structuredClone(host.city);
  host.offerTrip(291,305,24);host.advance(4320);
  for(let day=0;day<3;day++)step(baseline);
  assert.deepEqual(host.city,baseline);assert.equal(host.diagnostics().completed,24);
});
