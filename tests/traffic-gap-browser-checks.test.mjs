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
 const window={Worker,__trafficGapFault:fault,cityManager:{busSnapshot:()=>[{id:'observed-bus'}]}};
 runInNewContext(trafficGapBootstrap(),{window,structuredClone,queueMicrotask,Event:class{constructor(type){this.type=type;}}});
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
function samples(){return [0,.1,.2,.3].map((x,step)=>({step,epoch:'city',cars:1,liveIds:['game:1'],buses:[bus()],presentation:{renderedPoses:[pose(x)],renderedIds:['game:1'],selectedIds:['game:1'],deferredIds:[],retiringIds:[],lastRemoved:[],busIntrusions:0}}));}
test('actual-frame verifier requires movement, complete identities and car clearance',()=>{
 const rows=samples();assert.equal(inspectTrafficEvidence(frames,rows,[]).movementSamples,3);
 const hidden=structuredClone(rows);hidden[1].cars=0;hidden[1].presentation.renderedPoses=[];hidden[1].presentation.renderedIds=[];hidden[1].presentation.selectedIds=[];
 assert.throws(()=>inspectTrafficEvidence(frames,hidden,[]),/Live admitted ID cannot disappear/);
 const collision=structuredClone(rows);collision[1].cars=2;collision[1].presentation.renderedPoses.push({...pose(.11),vehicleId:'game:2'});collision[1].presentation.renderedIds.push('game:2');collision[1].presentation.selectedIds.push('game:2');
 assert.throws(()=>inspectTrafficEvidence(frames,collision,[]),/preserve gap/);
 const broken=structuredClone(frames);broken[1].frame.offered=2;assert.throws(()=>inspectTrafficEvidence(broken,rows,[]),/mass conserved/);
});

import {busPoses} from '../src/bus/poses.ts';
test('bus limitation is classified only from actual direction and stationary admitted-car evidence',()=>{
 const rows=samples(),z=busPoses([bus(300)],{})[0].z;
 for(let i=0;i<rows.length;i++){rows[i].presentation.renderedPoses[0]={...pose(i?2.8:2.7),z};rows[i].buses=[bus(i===3?301:300,i>=2?1:0)];rows[i].presentation.busIntrusions=i>=2?1:0;}
 const proof=inspectTrafficEvidence(frames,rows,[]);assert.equal(proof.busDrivenIntrusions.length,1);assert.ok(proof.busDrivenIntrusions[0].bus.direction.dx>0);
 const driving=structuredClone(rows);driving[2].presentation.renderedPoses[0].x=3.1;assert.throws(()=>inspectTrafficEvidence(frames,driving,[]),/Car must not drive/);
 const birth=structuredClone(rows);birth[0].buses=[bus(300,1)];assert.throws(()=>inspectTrafficEvidence(frames,birth,[]),/Newly admitted car/);
 const unknown=samples();unknown[3].presentation.busIntrusions=1;assert.throws(()=>inspectTrafficEvidence(frames,unknown,[]),/requires classified actual pose evidence/);
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
