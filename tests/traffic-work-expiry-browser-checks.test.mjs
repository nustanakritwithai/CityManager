import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {observeWorkWorker,workAckEvidence} from './traffic-work-expiry-browser-checks.mjs';

test('work browser observer leaves native Worker messages untouched and bounded',()=>{
 class WorkerFixture{constructor(url,options){this.url=url;this.options=options;this.listeners=[];}addEventListener(type,fn){if(type==='message')this.listeners.push(fn);}emit(data){for(const fn of this.listeners)fn({data});}postMessage(...args){this.sent=args;return 17;}}
 const window={Worker:WorkerFixture};runInNewContext(`(${observeWorkWorker.toString()})()`,{window,Proxy,Reflect,String,performance:{now:()=>42}});
 const ordinary=new window.Worker('unrelated.js',{type:'module'});assert.equal(ordinary.listeners.length,0);
 const worker=new window.Worker('/assets/game-worker-entry-abcd.js',{type:'module'});assert.equal(worker.url,'/assets/game-worker-entry-abcd.js');assert.deepEqual(worker.options,{type:'module'});
 const outbound=Object.freeze({seq:3,advance:false,paused:true,sample:Object.freeze({work:Object.freeze({day:2,minute:1020,ack:1,cancelIds:Object.freeze([7])})})});const transfer=[];
 assert.equal(worker.postMessage(outbound,transfer),17);assert.equal(worker.sent[0],outbound);assert.equal(worker.sent[1],transfer);assert.equal(window.__workRequests[0].ack,1);assert.deepEqual([...window.__workRequests[0].cancelIds],[7]);
 const frame=Object.freeze({step:1,cars:Object.freeze([]),workTrips:Object.freeze([{id:7,day:2}]),expiredWorkTrips:Object.freeze([]),signals:Object.freeze({phases:Object.freeze([])})});
 for(let i=0;i<200;i++)worker.emit(Object.freeze({kind:'frame',frame}));
 assert.equal(window.__workFrames.length,160);assert.equal(window.__workFrames[0].workTrips[0].id,7);assert.equal(frame.step,1);
});

test('work receipt requires a later acknowledged worker frame and a removed body',()=>{
 const receipt={sequence:2,id:7},frames=[{seq:4,cars:[],workTrips:[],expiredWorkTrips:[receipt]},{seq:5,cars:[],workTrips:[],expiredWorkTrips:[]}];
 const requests=[{seq:4,ack:0,cancelIds:[7]},{seq:5,ack:2,cancelIds:[]}],traffic={worker:{inflight:false,pending:false},presentation:{selectedIds:[]}};
 assert.equal(workAckEvidence(7,frames,requests,traffic)?.ackFrame.seq,5);
 assert.equal(workAckEvidence(7,frames,requests.slice(0,1),traffic),null,'Receipt alone is insufficient');
 assert.equal(workAckEvidence(7,frames.slice(0,1),requests,traffic),null,'ACK requires its worker response');
 assert.equal(workAckEvidence(7,frames,[requests[0],{...requests[1],ack:1}],traffic),null,'Stale ACK is insufficient');
 assert.equal(workAckEvidence(7,frames,requests,{...traffic,worker:{inflight:true,pending:false}}),null,'In-flight frames do not prove acceptance');
 assert.equal(workAckEvidence(7,frames,requests,{...traffic,presentation:{selectedIds:['game:7']}}),null,'A retained physical body cannot pass');
 assert.equal(workAckEvidence(7,[frames[0],{...frames[1],expiredWorkTrips:[receipt]}],requests,traffic),null,'Uncleared receipt is not an ACK round trip');
});
