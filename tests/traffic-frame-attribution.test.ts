import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {FrameAttribution,FRAME_STAGES,type FrameContext} from '../src/traffic/frame-attribution.ts';
const context:FrameContext={cityChanged:false,paused:false,advance:false,dirtyAtEntry:false,visible:true,failed:false,busPresent:false,presented:true,reconciled:false,drawnCount:12};
test('one correlated maximum includes every boundary and early epoch reset without dropping startup',()=>{
 const a=new FrameAttribution();a.begin(100);a.resetEpoch();a.next('schedule',109);a.next('sceneSync',110);a.finish(113,13,{...context,cityChanged:true});
 const first=a.snapshot()!;assert.equal(first.totalMs,13);assert.equal(first.stages.clockReset,9);assert.equal(first.stages.schedule,1);assert.equal(first.stages.sceneSync,3);assert.equal(Object.values(first.stages).reduce((a,b)=>a+b,0),13);
 for(let i=0;i<10000;i++){a.begin(200);a.next('sceneSync',201);a.finish(202,2,context);}
 assert.deepEqual(a.snapshot(),first,'all shorter frames preserve the epoch maximum, not only paired sampling');
 a.begin(300);a.finish(313,13,context);assert.deepEqual(a.snapshot(),first,'ties retain first worst record');
 a.begin(400);a.next('submit',401);a.finish(420,20,context);assert.equal(a.snapshot()!.totalMs,20);assert.equal(a.snapshot()!.stages.submit,19);
 assert.deepEqual(Object.keys(a.snapshot()!).sort(),['context','stages','totalMs']);assert.deepEqual(Object.keys(a.snapshot()!.stages),[...FRAME_STAGES]);
 first.context.drawnCount=999;first.stages.clockReset=999;assert.equal(a.snapshot()!.context.drawnCount,12,'snapshots cannot mutate retained evidence');
 a.resetEpoch();assert.equal(a.snapshot(),null);
});
test('failure and skipped stages retain full duration without inventing calls or payloads',()=>{
 const a=new FrameAttribution();a.begin(0);a.next('failure',5);a.finish(8,8,{...context,failed:true,presented:false,drawnCount:0});
 const w=a.snapshot()!;assert.equal(w.stages.clockReset,5);assert.equal(w.stages.failure,3);for(const stage of FRAME_STAGES.filter(s=>!['clockReset','failure'].includes(s)))assert.equal(w.stages[stage],0);
 assert.equal(w.context.failed,true);assert.equal(w.context.presented,false);assert.equal(Object.values(w.stages).reduce((a,b)=>a+b,0),w.totalMs);
});
test('original startup-inclusive total and strict fallback gate remain intact',()=>{
 const layer=readFileSync(new URL('../src/traffic/layer.ts',import.meta.url),'utf8');
 assert.match(layer,/const frameStart=performance\.now\(\);this\.frameAttribution\.begin\(frameStart\)/);
 assert.match(layer,/const end=performance\.now\(\),ms=end-frameStart/);
 assert.match(layer,/this\.timing\.maxFrameMs=Math\.max\(this\.timing\.maxFrameMs,ms\)/);
 const gates=readFileSync(new URL('./traffic-game-fallback-metrics.mjs',import.meta.url),'utf8');assert.match(gates,/timing\.maxFrameMs>=8\|\|timing\.maxProjectionMs>=8/);
});
