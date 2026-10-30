import test from 'node:test';
import assert from 'node:assert/strict';
import {peakMetrics,peakTriplicateMetrics} from './traffic-game-peak-metrics.mjs';
const attained={reason:'near-cap',elapsedMs:9000,moving:128,cars:64};
const sample=(p95:number)=>({count:120,visibility:'visible',p95,max:p95});
const traffic={failure:null,moving:128,cars:64,worker:{failure:null,disposed:false,inflight:false,pending:false,sent:15,received:15,applied:15},timing:{frames:120,projections:15,maxFrameMs:1.2,maxProjectionMs:.1}};
test('peak smoke passes finite measured real model frame and bounded worker',()=>{
 const m=peakMetrics(attained,sample(83.4),sample(83.4),traffic,traffic);assert.deepEqual(m.issues,[]);assert.equal(m.allowedP95,104.25);
});
test('peak smoke rejects unknown samples, missed cap, regressions and unbounded workers',()=>{
 const check=(a=attained,off=sample(50),on=sample(50),t=traffic)=>peakMetrics(a,off,on,t,t).issues;
 assert.ok(check({...attained,reason:'observation-limit'}).length);
 assert.ok(check({...attained,elapsedMs:25001}).length);
 assert.ok(check({...attained,cars:63}).length);assert.ok(check({...attained,cars:65}).length);
 assert.ok(check(attained,sample(50),sample(50),{...traffic,cars:63}).length);assert.ok(check(attained,sample(50),sample(50),{...traffic,cars:65}).length);
 assert.ok(peakMetrics(attained,sample(50),sample(50),traffic,{...traffic,moving:127}).issues.some((s:string)=>s.includes('measurement end')));
 assert.ok(check(attained,{...sample(50),count:119}).length);
 assert.ok(check(attained,sample(50),sample(63)).length);
 assert.ok(check(attained,sample(90),sample(100)).length);
 assert.ok(check(attained,sample(50),sample(50),{...traffic,timing:{...traffic.timing,maxFrameMs:8}}).length);
 assert.ok(check(attained,sample(50),sample(50),{...traffic,worker:{...traffic.worker,sent:17,inflight:true}}).length);
 assert.ok(check(attained,sample(50),sample(50),{...traffic,worker:{...traffic.worker,pending:true}}).length);
});

test('fixed three pairs require each gate and report medians without discarding failures',()=>{
 const pair=(off:number,on:number)=>({attainment:attained,off:sample(off),on:sample(on),onBefore:{traffic},onAfter:{traffic},cityBytesEqual:true});
 const pass=peakTriplicateMetrics([pair(83.4,83.6),pair(83.4,83.5),pair(83.4,83.5)]);assert.deepEqual(pass.issues,[]);assert.equal(pass.medianOn,83.5);
 const oneMiss=peakTriplicateMetrics([pair(83.4,100),pair(83.4,83.5),pair(83.4,83.5)]);assert.equal(oneMiss.medianOn,83.5);assert.ok(oneMiss.issues.some((s:string)=>s.includes('Pair 1')&&s.includes('below 100')));
 assert.ok(peakTriplicateMetrics([pair(83,100),pair(83,100),pair(83,83)]).issues.some((s:string)=>s.includes('below 100')));
 assert.ok(peakTriplicateMetrics([pair(50,63),pair(50,63),pair(50,50)]).issues.some((s:string)=>s.includes('exceeds')));
 const invalid=pair(83,83);invalid.on.count=119;assert.ok(peakTriplicateMetrics([pair(83,83),pair(83,83),invalid]).issues.some((s:string)=>s.includes('UNKNOWN')));
 assert.ok(peakTriplicateMetrics([pair(83,83),pair(83,83)]).issues.length);
 assert.ok(peakTriplicateMetrics([pair(83,83),pair(83,83),null]).issues.length);
 const unloaded={...traffic,moving:127};const bad=pair(83,83);bad.onAfter={traffic:unloaded};assert.ok(peakTriplicateMetrics([pair(83,83),bad,pair(83,83)]).issues.some((s:string)=>s.includes('Pair 2')));
});
