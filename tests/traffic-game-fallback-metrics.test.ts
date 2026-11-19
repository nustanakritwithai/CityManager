import test from 'node:test';
import assert from 'node:assert/strict';
import {fallbackMetrics,windowTiming} from './traffic-game-fallback-metrics.mjs';
const sample=(p95:number,count=12,max=p95)=>({p95,count,max,visibility:'visible',elapsedMs:12000,trailingMs:10});
const timing={frames:50,projections:2,maxFrameMs:2,maxProjectionMs:1};
test('fallback reports poor baseline honestly while allowing bounded increment',()=>{
 const m=fallbackMetrics(sample(200),sample(245),timing);assert.equal(m.offStatus,'POOR');assert.equal(m.onStatus,'POOR');assert.equal(m.allowedP95,250);assert.deepEqual(m.issues,[]);
});
test('fallback rejects relative slowdown, incomplete sample and missing timing',()=>{
 assert.ok(fallbackMetrics(sample(200),sample(251),timing).issues.some((s:string)=>s.includes('exceeds')));
 const m=fallbackMetrics(sample(50,9),sample(50),timing);assert.equal(m.offStatus,'UNKNOWN');assert.ok(m.issues.length);
 assert.ok(fallbackMetrics(sample(50),sample(50),null).issues.some((s:string)=>s.includes('UNKNOWN')));
 assert.ok(fallbackMetrics(sample(50),sample(50),{...timing,maxFrameMs:8}).issues.length);
 assert.equal(fallbackMetrics(sample(50),sample(50),timing).onStatus,'WITHIN_PRIOR_BOUNDARY');
 assert.ok(fallbackMetrics(sample(50),{...sample(50),trailingMs:1500},timing).issues.some((s:string)=>s.includes('trailing')));
});
test('the 8 ms limit is judged on the measured window, not the one-off startup cost before it',()=>{
 // Startup: 5 projections, one of 18 ms, before measuring; then 12 more projections and 35 frames, all under 8 ms.
 const before={frames:89,projections:5,maxFrameMs:4.7,maxProjectionMs:18,recentFrameMs:Array(89).fill(2),recentProjectionMs:[18,3,2,2,2]};
 const after={frames:124,projections:17,maxFrameMs:4.7,maxProjectionMs:18,recentFrameMs:[...Array(89).fill(2),...Array(35).fill(4.7)],recentProjectionMs:[18,3,2,2,2,...Array(12).fill(3)]};
 assert.deepEqual(windowTiming(before,after),{frames:35,projections:12,maxFrameMs:4.7,maxProjectionMs:3});
 assert.deepEqual(fallbackMetrics(sample(50),sample(50),after,before).issues,[],'a startup spike before measuring does not fail the window');
 assert.ok(fallbackMetrics(sample(50),sample(50),after).issues.some((s:string)=>s.includes('epoch')),'without a starting reading the whole epoch still counts');
 const slow={...after,recentProjectionMs:[...after.recentProjectionMs.slice(0,-1),9]};
 assert.ok(fallbackMetrics(sample(50),sample(50),slow,before).issues.some((s:string)=>s.includes('measured window')),'a slow projection inside the window still fails');
 assert.ok(fallbackMetrics(sample(50),sample(50),{...after,projections:5,recentProjectionMs:before.recentProjectionMs},before).issues.some((s:string)=>s.includes('UNKNOWN')),'no projection while measuring is unknown, not a pass');
});
