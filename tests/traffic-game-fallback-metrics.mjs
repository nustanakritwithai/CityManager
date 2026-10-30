/** Test-only fallback smoke heuristics; these are not physical-device FPS certification.
 * p95 over ten samples is noisy; the additive allowance prevents treating small
 * timer noise as a significant relative regression at high frame rates. */
export function fallbackMetrics(off,on,timing){
 const minSamples=10,issues=[];
 const valid=s=>!!s&&Number.isSafeInteger(s.count)&&s.count>=minSamples&&s.visibility==='visible'&&Number.isFinite(s.p95)&&Number.isFinite(s.max)&&Number.isFinite(s.elapsedMs)&&s.elapsedMs>=11900&&Number.isFinite(s.trailingMs)&&s.trailingMs>=0;
 const classify=s=>!valid(s)?'UNKNOWN':s.p95>=100||s.max>=1000||s.trailingMs>=1000?'POOR':'WITHIN_PRIOR_BOUNDARY';
 const offStatus=classify(off),onStatus=classify(on);
 if(!valid(off)||!valid(on))issues.push('UNKNOWN: fewer than 10 valid visible frame intervals or invalid measurements');
 const allowedP95=valid(off)?Math.max(off.p95*1.25,off.p95+50):null;
 if(allowedP95!==null&&valid(on)&&on.p95>allowedP95)issues.push('ON p95 exceeds max(OFF p95 × 1.25, OFF p95 + 50 ms)');
 const allowedTrailing=valid(off)?Math.max(1000,off.trailingMs*1.25,off.trailingMs+50):null;
 if(allowedTrailing!==null&&valid(on)&&on.trailingMs>allowedTrailing)issues.push('ON trailing time since last frame exceeds max(1000 ms, OFF trailing × 1.25, OFF trailing + 50 ms)');
 if(!timing||!Number.isSafeInteger(timing.frames)||timing.frames<1||!Number.isSafeInteger(timing.projections)||timing.projections<1||!Number.isFinite(timing.maxFrameMs)||!Number.isFinite(timing.maxProjectionMs))issues.push('UNKNOWN: missing traffic frame/projection timing');
 else if(timing.maxFrameMs>=8||timing.maxProjectionMs>=8)issues.push('Traffic epoch maximum synchronous frame or projection time is at least 8 ms');
 return {offStatus,onStatus,minSamples,allowedP95,allowedTrailing,trafficMainThreadLimitMs:8,issues,
  note:'12 s timer per condition (100 ms clock tolerance); floor-index p95 from 10 samples is noisy; 25%/50 ms, 1000 ms trailing and 8 ms limits are broad uncalibrated CI smoke heuristics. Epoch timing maxima include startup. The prior 100 ms p95 and 1000 ms max boundaries describe this CI smoke only, not physical-device smoothness.'};
}
