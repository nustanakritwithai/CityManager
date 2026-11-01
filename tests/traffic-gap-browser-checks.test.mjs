import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {trafficGapBootstrap} from './traffic-gap-browser-checks.mjs';
function setup(fault){
 class Worker {
  listeners={};messages=[];stopped=false;
  addEventListener(name,callback){(this.listeners[name]??=[]).push(callback);}
  dispatchEvent(event){for(const callback of this.listeners[event.type]??[])callback(event);return true;}
  postMessage(...args){this.messages.push(args);}
  terminate(){this.stopped=true;}
 }
 const callbacks=[];const window={Worker,__runFrame:()=>callbacks.shift()?.(),__trafficGapFault:fault,cityManager:{busSnapshot:()=>[{id:'observed-bus'}]}};
 runInNewContext(trafficGapBootstrap(),{window,structuredClone,queueMicrotask,requestAnimationFrame:callback=>callbacks.push(callback),Event:class{constructor(type){this.type=type;}}});
 return window;
}
test('passive traffic observer records only committed real responses without mutating commands or replaying frames',()=>{
 const w=setup(),worker=new w.Worker('/assets/game-worker-entry-hash.js');
 const frame={kind:'frame',epoch:'city-1',seq:1,frame:{step:1,cars:[{id:4}]}};
 worker.dispatchEvent({type:'message',data:frame});assert.equal(w.__trafficGapObserver.committed.length,0);
 const command={kind:'compute',epoch:'city-1',commitPrevious:false};worker.postMessage(command);
 assert.equal(w.__trafficGapObserver.committed.length,0);assert.equal(worker.messages[0][0],command);
 const commit={...command,commitPrevious:true};worker.postMessage(commit);
 assert.equal(worker.messages[1][0],commit);assert.equal(w.__trafficGapObserver.committed.length,1);
 assert.deepEqual(JSON.parse(JSON.stringify(w.__trafficGapObserver.committed[0].frame)),frame.frame);
 frame.frame.cars[0].id=99;assert.equal(w.__trafficGapObserver.committed[0].frame.cars[0].id,4);
 worker.postMessage({...commit,epoch:'other-city'});assert.equal(w.__trafficGapObserver.committed.length,1);
 for(let i=0;i<40;i++)worker.postMessage(commit);assert.equal(w.__trafficGapObserver.committed.length,32);
 worker.terminate();assert.equal(worker.stopped,true);assert.equal(w.__trafficGapObserver.terminated,1);
});
test('fault injection is scoped to the traffic worker and records actual construction/error lifecycle',async()=>{
 const failed=setup('construct');new failed.Worker('/other-worker.js');assert.equal(failed.__trafficGapObserver.attempts,0);
 assert.throws(()=>new failed.Worker('/game-worker-entry.js'),/Injected/);assert.equal(failed.__trafficGapObserver.attempts,1);assert.equal(failed.__trafficGapObserver.created,0);
 const asynchronous=setup('async');new asynchronous.Worker('/game-worker-entry.js');await new Promise(resolve=>queueMicrotask(resolve));
 assert.equal(asynchronous.__trafficGapObserver.created,1);assert.equal(asynchronous.__trafficGapObserver.errors,1);
});

import {inspectTrafficEvidence} from './traffic-gap-browser-checks.mjs';
// Synthetic verifier tests only: browser acceptance still requires actual recorded frames.
const pose=x=>({vehicleId:'game:1',x,z:0,headingX:1,headingZ:0,paint:0});
const bus=(cell=300,progress=0)=>({id:'bus:1',cell,next:cell+1,progress,persons:0,capacity:40,phase:'running'});
const frames=Array.from({length:3},(_,step)=>({frame:{step,offered:1,completed:0,dropped:0,cancelled:0,waiting:0,moving:1,cars:[{id:1}]}}));
function samples(){return [0,.1,.2,.3].map((x,step)=>({blocked:2,congestedLinks:1,step,epoch:'city',cars:1,liveIds:['game:1'],buses:[bus(300,step*.01)],busDraw:{buses:1,scene:{buses:1}},busMinute:420+step/60,busMovement:{heldDrive:0,committedDrive:step+1},busLedger:{splitError:0,engineError:0,releaseError:0,engine:{accepted:0,waiting:0,onboard:0,completed:0,released:0}},presentation:{renderedPoses:[pose(x)],renderedIds:['game:1'],selectedIds:['game:1'],deferredIds:[],retiringIds:[],lastRemoved:[],busIntrusions:0}}));}
test('actual-frame verifier requires movement, complete identities and car clearance',()=>{
 const rows=samples();assert.equal(inspectTrafficEvidence(frames,rows,[]).movementSamples,3);
 const hidden=structuredClone(rows);hidden[1].cars=0;hidden[1].presentation.renderedPoses=[];hidden[1].presentation.renderedIds=[];hidden[1].presentation.selectedIds=[];
 assert.throws(()=>inspectTrafficEvidence(frames,hidden,[]),/Live admitted ID cannot disappear/);
 const collision=structuredClone(rows);collision[1].cars=2;collision[1].presentation.renderedPoses.push({...pose(.11),vehicleId:'game:2'});collision[1].presentation.renderedIds.push('game:2');collision[1].presentation.selectedIds.push('game:2');
 assert.throws(()=>inspectTrafficEvidence(frames,collision,[]),/preserve gap/);
 const broken=structuredClone(frames);broken[1].frame.offered=2;assert.throws(()=>inspectTrafficEvidence(broken,rows,[]),/mass conserved/);
});

import {busPoses} from '../src/bus/poses.ts';
test('movement authority rejects every active bus intrusion and preserves home engine identities',()=>{
 const rows=samples(),z=busPoses([bus(300)],{})[0].z;
 for(let i=0;i<rows.length;i++){rows[i].presentation.renderedPoses[0]={...pose(i?2.8:2.7),z};rows[i].buses=[bus(i===3?301:300,i>=2?1:0)];}
 assert.throws(()=>inspectTrafficEvidence(frames,rows,[]),/Movement-gated active bus/,'The previously tolerated moving-bus intrusion now fails');
 const home=samples();home[0].buses[0].phase='home';home[0].busDraw={buses:0,scene:{buses:0}};assert.equal(inspectTrafficEvidence(frames,home,[]).homeSamples,1);
 const hidden=samples();hidden[1].busDraw={buses:0,scene:{buses:0}};assert.throws(()=>inspectTrafficEvidence(frames,hidden,[]),/Only actual home-phase/);
 const deleted=samples();deleted[1].buses=[];deleted[1].busDraw={buses:0,scene:{buses:0}};assert.throws(()=>inspectTrafficEvidence(frames,deleted,[]),/does not delete engine/);
 const broken=samples();broken[2].busLedger.engine.accepted=1;assert.throws(()=>inspectTrafficEvidence(frames,broken,[]),/passenger mass conserved/);
 const diagnostic=samples();diagnostic[1].presentation.busIntrusions=1;assert.throws(()=>inspectTrafficEvidence(frames,diagnostic,[]),/No accepted independent bus intrusion/);
});

import {renderedVehicleBox} from './traffic-gap-browser-checks.mjs';
test('rounded 45-degree render headings use rotated footprints rather than grid-axis approximations',()=>{
 const diagonal={...pose(0),headingX:Math.SQRT1_2,headingZ:Math.SQRT1_2},box=renderedVehicleBox(diagonal,.42,.3);
 assert.ok(Math.abs(box.maxX-(.42+.3)*Math.SQRT1_2/2)<1e-12);assert.equal(box.maxX,box.maxZ);
 const rows=samples();rows[1].cars=2;rows[1].presentation.renderedPoses=[diagonal,{...diagonal,vehicleId:'game:2',z:.45}];rows[1].presentation.selectedIds=['game:1','game:2'];rows[1].presentation.renderedIds=['game:1','game:2'];
 assert.throws(()=>inspectTrafficEvidence(frames,rows,[]),/preserve gap/,'Dominant-axis boxes would incorrectly permit this rounded-turn overlap');
});

import {trafficGapBusyFixture} from './traffic-gap-fixture.ts';
import {deserializeParkSession,serializeParkSession} from '../src/park-runtime.ts';
import {TrafficGame,captureTrafficGameSample} from '../src/traffic/game.ts';
test('busy browser fixture is a fully validated server session with real bounded queue demand',()=>{
 const raw=trafficGapBusyFixture(),{city,runtime,market}=deserializeParkSession(raw);
 assert.equal(serializeParkSession(city,runtime,market),raw);assert.equal(city.households.length,32);
 const game=new TrafficGame(captureTrafficGameSample(city));for(let i=0;i<6;i++)game.step();
 assert.ok(game.frame.blocked>0);assert.ok(game.frame.congestedLinks>0);assert.ok(game.frame.moving<=128);
 assert.equal(serializeParkSession(city,runtime,market),raw,'Traffic model must not mutate synthetic city/session');
});

import {heldThenResumed} from './traffic-gap-browser-checks.mjs';
test('gate proof requires the same held bus to move after a later grant, not earlier aggregate success',()=>{
 assert.equal(heldThenResumed(samples()),null,'Movement without a real held frame is not contention proof');
 const rows=samples();rows[1].buses[0].progress=0;rows[1].busMovement={heldDrive:1,committedDrive:1};
 const result=heldThenResumed(rows);assert.ok(result);assert.equal(result.id,'bus:1');assert.ok(result.resumedMinute>result.heldMinute);assert.ok(result.resumedCommittedDrive>result.committedDrive);
 const approach=structuredClone(rows);for(const row of approach)row.buses[0].phase='toStart';assert.ok(heldThenResumed(approach),'Actual driven depot approach is on-road contention');
 const free=structuredClone(rows);for(const row of free){row.blocked=0;row.congestedLinks=0;}assert.equal(heldThenResumed(free),null,'Already-driven admission handshake without observed congestion is not proof');
 const startup=structuredClone(rows);startup[0].busMovement.committedDrive=0;assert.equal(heldThenResumed(startup),null,'Initial admission handshake before any drive cannot count as traffic contention');
 const dwell=structuredClone(rows);dwell[0].buses[0].phase='dwelling';dwell[1].buses[0].phase='dwelling';assert.equal(heldThenResumed(dwell),null,'Dwell scheduling is not an on-road held bus');
 const frozen=structuredClone(rows);for(const row of frozen.slice(2))row.buses[0].progress=0;assert.equal(heldThenResumed(frozen),null,'Granted counter without actual bus movement cannot pass');
 const noGrant=structuredClone(rows);for(const row of noGrant.slice(2))row.busMovement.committedDrive=1;assert.equal(heldThenResumed(noGrant),null,'Movement without later gate grant cannot pass');
});

test('passive browser sampler latches compact hold/release evidence beyond its bounded render ring',()=>{
 const w=setup(),rows=samples();rows[1].buses[0].progress=0;rows[1].busMovement={heldDrive:1,committedDrive:1};let index=0;
 w.cityManager={traffic:()=>({...rows[index],worker:{epoch:'city'},ready:true,failure:null}),busSnapshot:()=>rows[index].buses,bus:()=>rows[index].busDraw};
 w.__trafficGapStartSampling();for(index=0;index<3;index++)w.__runFrame();index=3;
 for(let i=0;i<500;i++)w.__runFrame();w.__trafficGapSampling=false;
 assert.equal(w.__trafficGapObserver.rendered.length,360);assert.equal(w.__trafficGapObserver.gateEvidence.length,3);assert.equal(w.__trafficGapObserver.gateResume,true);
 assert.ok(heldThenResumed(w.__trafficGapObserver.gateEvidence),'Strict actual-position verifier can still read the retained event');
});

import {trafficRightOfWayFixture,trafficRightOfWayWitness} from './traffic-right-of-way-fixture.ts';
test('dense browser seed is canonical and witnesses more than four route conflicts for every real bus class',()=>{
 for(const level of [1,2,3]){
  const raw=trafficRightOfWayFixture(level,true),witness=trafficRightOfWayWitness(raw);
  const session=deserializeParkSession(raw);
  assert.equal(witness.level,level);assert.ok(witness.encounteredConflictNodes>4);
  assert.equal(session.city.bus.lines[0].busLevel,level);
  assert.equal(serializeParkSession(session.city,session.runtime,session.market),raw);
 }
});
