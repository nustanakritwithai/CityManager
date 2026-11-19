/** Test-only fallback smoke heuristics; these are not physical-device FPS certification.
 * p95 over ten samples is noisy; the additive allowance prevents treating small
 * timer noise as a significant relative regression at high frame rates. */
/** Maxima of the traffic frames and projections that happened between two timing readings, from the layer's
 * recent-duration lists, so the one-off cost of the game starting up is not counted against the measured window. */
export function windowTiming(before,after){
 if(!before||!after||!Array.isArray(after.recentFrameMs)||!Array.isArray(after.recentProjectionMs)||!Number.isSafeInteger(before.frames)||!Number.isSafeInteger(before.projections))return null;
 const frames=after.frames-before.frames,projections=after.projections-before.projections;
 if(frames<0||projections<0)return null;
 const last=(list,n)=>n>0?list.slice(-Math.min(n,list.length)):[];
 const f=last(after.recentFrameMs,frames),p=last(after.recentProjectionMs,projections);
 return {frames,projections,maxFrameMs:f.length?Math.max(...f):null,maxProjectionMs:p.length?Math.max(...p):null};
}
export function fallbackMetrics(off,on,timing,before=null){
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
 else{
  // With a reading taken when measurement began, judge only the measured window; otherwise the whole epoch, startup included.
  const window=before?windowTiming(before,timing):null;
  if(before&&(!window||window.frames<1||window.projections<1||window.maxFrameMs===null||window.maxProjectionMs===null))issues.push('UNKNOWN: no traffic frame and projection inside the measured window');
  else if(window?(window.maxFrameMs>=8||window.maxProjectionMs>=8):(timing.maxFrameMs>=8||timing.maxProjectionMs>=8))issues.push(window?'Traffic maximum synchronous frame or projection time in the measured window is at least 8 ms':'Traffic epoch maximum synchronous frame or projection time is at least 8 ms');
 }
 const measured=before?windowTiming(before,timing):null;
 return {offStatus,onStatus,minSamples,allowedP95,allowedTrailing,trafficMainThreadLimitMs:8,window:measured,issues,
  note:'12 s timer per condition (100 ms clock tolerance); floor-index p95 from 10 samples is noisy; 25%/50 ms, 1000 ms trailing and 8 ms limits are broad uncalibrated CI smoke heuristics. The 8 ms limit is judged on the measured window when a starting reading is given; epoch maxima, which include startup, are kept for reference. The prior 100 ms p95 and 1000 ms max boundaries describe this CI smoke only, not physical-device smoothness.'};
}
