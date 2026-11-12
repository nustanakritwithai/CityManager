import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {ProjectionAttribution,PROJECTION_STAGES,type ProjectionContext} from '../src/traffic/projection-attribution.ts';
const context:ProjectionContext={projectionIndex:1,signalHeadCount:0,paused:true,failed:false,busPresent:false,railPresent:false,inputCars:0,filteredCars:0,expiredCount:0,workTripCount:0};
test('bounded correlated projection maximum preserves startup, ties, incomplete calls and snapshot isolation',()=>{
 const a=new ProjectionAttribution();assert.equal(a.snapshot(),null);a.begin(100);a.next('signalSync',102);a.next('presenter',132);a.finish(134.5,34.5,context);const first=a.snapshot()!;
 assert.equal(first.totalMs,34.5);assert.equal(first.stages.signalSync,30);assert.equal(Object.values(first.stages).reduce((a,b)=>a+b,0),34.5);
 for(let i=0;i<10000;i++){a.begin(200);a.finish(201,1,context);}assert.deepEqual(a.snapshot(),first);
 a.begin(300);a.next('bus',320);assert.deepEqual(a.snapshot(),first,'aborted callbacks never replace completed maximum');
 a.begin(400);a.finish(434.5,34.5,context);assert.deepEqual(a.snapshot(),first,'first maximum retained on tie');
 first.stages.signalSync=999;first.context.inputCars=999;assert.equal(a.snapshot()!.stages.signalSync,30);assert.equal(a.snapshot()!.context.inputCars,0);
 a.begin(500);a.next('bus',501);a.next('caughtFailure',540);a.finish(541,41,{...context,failed:true});assert.equal(a.snapshot()!.totalMs,41);assert.equal(a.snapshot()!.stages.caughtFailure,1);
 assert.deepEqual(Object.keys(a.snapshot()!).sort(),['context','stages','totalMs']);assert.deepEqual(Object.keys(a.snapshot()!.stages),[...PROJECTION_STAGES]);
 a.resetEpoch();assert.equal(a.snapshot(),null);a.begin(600);a.finish(600.5,.5,context);assert.equal(a.snapshot()!.totalMs,.5);
});
test('original completed-projection scope and strict gate are retained',()=>{
 const layer=readFileSync(new URL('../src/traffic/layer.ts',import.meta.url),'utf8');assert.match(layer,/const start=performance\.now\(\);this\.projectionAttribution\.begin\(start\);this\.latest=frame/);assert.match(layer,/const end=performance\.now\(\),ms=end-start;this\.timing\.projections\+\+/);assert.match(layer,/this\.timing\.maxProjectionMs=Math\.max\(this\.timing\.maxProjectionMs,ms\)/);
 const gates=readFileSync(new URL('./traffic-game-fallback-metrics.mjs',import.meta.url),'utf8');assert.match(gates,/timing\.maxFrameMs>=8\|\|timing\.maxProjectionMs>=8/);
});
