import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createHostDiagnostics, browserResponsivenessSource, ringPush } from './plant-responsiveness-diagnostics.mjs';

test('bounded ring retains newest metadata', () => {
  const rows=[]; for(let i=0;i<100;i++) ringPush(rows,i);
  assert.equal(rows.length,64); assert.equal(rows[0],36);
});
test('host sampling is bounded, idempotent and preserves failures', async () => {
  let clock=0, callback, starts=0, stops=0;
  const d=createHostDiagnostics({now:()=>clock,cpu:()=>({user:clock*100,system:clock*10}),memory:()=>123,free:()=>456,hostCpu:()=>({totalMs:clock*4,idleMs:clock}),every:fn=>{callback=fn;starts++;return 7;},cancel:id=>{assert.equal(id,7);stops++;}});
  d.start();d.start();assert.equal(starts,1);
  for(let i=0;i<80;i++){clock+=1200;callback();}
  const samples=d.snapshot().samples;assert.equal(samples.length,64);assert.equal(samples.at(-1).eventLoopDelayMs,200);assert.equal(samples.at(-1).cpuUserMs,120);assert.equal(samples.at(-1).rssBytes,123);assert.equal(samples.at(-1).hostBusyFraction,0.75);
  const error=Error('primary failure');await assert.rejects(d.operation('png-validation',()=>{clock+=15;throw error;}),e=>e===error);
  assert.deepEqual(d.snapshot().operations[0],{name:'png-validation',status:'error',durationMs:15,cpuUserMs:1.5,cpuSystemMs:0.15});
  assert.equal(await d.operation('png-write',()=>42),42);d.stop();d.stop();assert.equal(stops,1);
});
test('late replies are metadata only, bounded and never revive expired commands',()=>{
  let clock=0;const d=createHostDiagnostics({now:()=>clock});
  for(let id=0;id<40;id++)d.expired({id,method:'Runtime.evaluate',phase:'test',expression:'private value'});
  clock=15;d.late({id:0,result:'must not store'});assert.equal(d.snapshot().lateReplies.length,0);
  for(let id=8;id<40;id++)d.late({id,result:{value:'must not store'}});
  const rows=d.snapshot().lateReplies;assert.equal(rows.length,32);assert.equal(rows[0].arrivedAfterTimeoutMs,15);
  assert.deepEqual(Object.keys(rows[0]).sort(),['id','method','phase','expiredAtMs','arrivedAfterTimeoutMs','error'].sort());
  d.late({id:8,result:123});assert.equal(d.snapshot().lateReplies.length,32);
});
function browser(supported) {
  let frame, observer, loss, time=0;
  class Observer {static supportedEntryTypes=supported?['longtask']:[];constructor(fn){observer=fn;}observe() {}}
  const context={window:{},document:{hidden:false,addEventListener:(type,fn)=>{assert.equal(type,'webglcontextlost');loss=fn;}},performance:{now:()=>time,timeOrigin:12345},PerformanceObserver:Observer,requestAnimationFrame:fn=>{frame=fn;}};
  vm.runInNewContext(browserResponsivenessSource,context);
  return {context,frame:at=>{time=at;frame(at);},tasks:rows=>observer({getEntries:()=>rows}),loss:()=>loss(),snapshot:()=>JSON.parse(JSON.stringify(context.window.__plantResponsivenessSnapshot()))};
}
test('browser observers retain bounded numeric evidence without app calls',()=>{
  const b=browser(true);b.frame(0);b.frame(16);for(let i=1;i<=50;i++)b.frame(16+i*300);
  b.tasks(Array.from({length:50},(_,i)=>({startTime:i,duration:70,name:'not retained',attribution:['not retained']})));b.loss();
  const s=b.snapshot();assert.equal(s.timeOrigin,12345);assert.equal(s.longTasksSupported,true);assert.equal(s.contextLosses,1);assert.equal(s.frameCount,52);assert.equal(s.frameGaps.length,32);assert.equal(s.longTasks.length,32);assert.deepEqual(s.longTasks[0],{atMs:18,durationMs:70});assert.equal(s.frameGaps[0].gapMs,300);
});
test('unsupported longtask observation is explicit and frame observation continues',()=>{
  const b=browser(false);b.frame(0);b.frame(300);const s=b.snapshot();assert.equal(s.longTasksSupported,false);assert.equal(s.frameGaps.length,1);assert.deepEqual(s.longTasks,[]);
});

test('primary failure snapshot is pinned once and detached from later telemetry and readers', () => {
  let clock=0, callback;
  const d=createHostDiagnostics({now:()=>clock,cpu:()=>({user:0,system:0}),memory:()=>123,free:()=>456,hostCpu:()=>({totalMs:clock,idleMs:0}),every:fn=>{callback=fn;return 1;},cancel:()=>{}});
  d.start();clock=1000;callback();d.pinFailure();
  const original=d.snapshot().firstFailure;assert.ok(Number.isFinite(original.timeOrigin));assert.equal(original.samples.length,1);assert.equal(original.firstFailure,null);
  for(let i=0;i<80;i++){clock+=1000;callback();}
  d.pinFailure();assert.deepEqual(d.snapshot().firstFailure,original);
  const read=d.snapshot();read.firstFailure.samples[0].rssBytes=999;read.firstFailure.samples.push({});
  assert.deepEqual(d.snapshot().firstFailure,original);assert.equal(d.snapshot().samples.length,64);d.stop();
});
