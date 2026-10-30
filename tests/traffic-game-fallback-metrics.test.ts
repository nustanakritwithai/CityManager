import test from 'node:test';
import assert from 'node:assert/strict';
import {fallbackMetrics} from './traffic-game-fallback-metrics.mjs';
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
