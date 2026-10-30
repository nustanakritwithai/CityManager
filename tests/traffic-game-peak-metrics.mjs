/** Deterministic acceptance checks for the validated near-cap browser fixture.
 * Thresholds are broad CI gates, not physical-mobile performance guarantees. */
export function peakMetrics(attainment,off,on,before,after){
 const issues=[];
 if(!attainment||attainment.reason!=='near-cap'||!Number.isFinite(attainment.elapsedMs)||attainment.elapsedMs>25000||attainment.moving!==128||!Number.isFinite(attainment.cars)||attainment.cars<120)issues.push('UNKNOWN or failed: near-cap 128 model / 120 rendered not observed within 25 s');
 for(const [label,frame] of [['start',before],['end',after]])if(!frame||frame.moving!==128||!Number.isFinite(frame.cars)||frame.cars<120)issues.push(`UNKNOWN or failed: near-cap not visible at measurement ${label}`);
 const valid=s=>!!s&&s.count===120&&s.visibility==='visible'&&Number.isFinite(s.p95)&&Number.isFinite(s.max);
 if(!valid(off)||!valid(on))issues.push('UNKNOWN: paired 120 visible frame intervals required');
 const allowedP95=valid(off)?Math.max(off.p95*1.25,off.p95+10):null;
 if(valid(on)&&on.p95>=100)issues.push('ON p95 must be below 100 ms');
 if(allowedP95!==null&&valid(on)&&on.p95>allowedP95)issues.push('ON p95 exceeds max(OFF p95 × 1.25, OFF p95 + 10 ms)');
 const bounded=w=>!!w&&w.failure===null&&w.disposed===false&&typeof w.inflight==='boolean'&&typeof w.pending==='boolean'&&(!w.pending||w.inflight)&&Number.isSafeInteger(w.sent)&&Number.isSafeInteger(w.received)&&Number.isSafeInteger(w.applied)&&w.received>=0&&w.sent>=w.received&&w.sent-w.received<=1&&w.applied<=w.received&&w.applied>=0&&w.inflight===(w.sent-w.received===1);
 for(const t of [before,after]){
  if(!t||t.failure!==null||!bounded(t.worker))issues.push('UNKNOWN or failed: worker failure or queue accounting is not bounded');
  const x=t?.timing;
  if(!x||!Number.isSafeInteger(x.frames)||x.frames<1||!Number.isSafeInteger(x.projections)||x.projections<1||!Number.isFinite(x.maxFrameMs)||!Number.isFinite(x.maxProjectionMs)||x.maxFrameMs<0||x.maxProjectionMs<0||x.maxFrameMs>=8||x.maxProjectionMs>=8)issues.push('UNKNOWN or failed: traffic epoch frame/projection max must be finite and below 8 ms');
 }
 return {issues,allowedP95,trafficMainThreadLimitMs:8,note:'Broad uncalibrated 120-frame CI gates; epoch timing maxima include startup. Emulation is not physical-device performance certification.'};
}
