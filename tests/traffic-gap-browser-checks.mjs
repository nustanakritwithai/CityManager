import assert from 'node:assert/strict';
import {trafficGapShortApproachFixture} from './traffic-gap-fixture.ts';
import {trafficRightOfWayFixture,trafficRightOfWayWitness} from './traffic-right-of-way-fixture.ts';
import {busPoses} from '../src/bus/poses.ts';
import {vehicleBox as renderedVehicleBox,boxesOverlap,TRAFFIC_SPACING} from '../src/traffic/spacing.ts';
// Shared rotated full-body bounds; verified independently at 45 degrees below.
export {renderedVehicleBox};
/** Install before app boot. Observe real Worker messages without changing normal delivery.
 * Only a subsequent explicit commitPrevious acknowledges a candidate into the model. */
export function trafficGapBootstrap(){return `(()=>{
 const Native=window.Worker,observation={attempts:0,created:0,terminated:0,committed:[],rendered:[],errors:0,latest:null,gateHold:null,gateResume:null,gateEvidence:[],motion:{nonidle:0,carMoves:0,busMoves:0}};window.__trafficGapObserver=observation;
 window.__trafficGapSampling=false;
 window.__trafficGapStartSampling=()=>{if(window.__trafficGapSampling)return;window.__trafficGapSampling=true;const sample=()=>{
  if(!window.__trafficGapSampling)return;const d=window.cityManager?.traffic?.();
  if(d?.ready&&!d.failure){const row={blocked:d.blocked,congestedLinks:d.congestedLinks,step:d.step,epoch:d.worker?.epoch,presentation:d.presentation,cars:d.cars,busDraw:window.cityManager?.bus?.(),busLedger:d.busLedger,busMinute:d.busMinute,busMovement:d.busMovement,buses:structuredClone(window.cityManager?.busSnapshot?.()??[]),liveIds:observation.latest?.step===d.step?observation.latest.liveIds:null},previous=observation.rendered.at(-1),hold=observation.gateHold;
   const gateRow=r=>({blocked:r.blocked,congestedLinks:r.congestedLinks,epoch:r.epoch,busMinute:r.busMinute,busMovement:r.busMovement,buses:r.buses});
   if(!observation.gateResume&&hold&&row.epoch===hold.epoch&&row.busMovement?.committedDrive>hold.grants){const bus=row.buses.find(b=>b.id===hold.bus.id&&b.phase!=='home');if(bus&&(bus.cell!==hold.bus.cell||bus.next!==hold.bus.next||Math.abs(bus.progress-hold.bus.progress)>1e-7)){observation.gateResume=true;observation.gateEvidence=[...observation.gateEvidence.slice(0,2),gateRow(row)];}}
   if(!observation.gateResume&&!observation.gateHold&&previous?.epoch===row.epoch&&previous.busMovement?.committedDrive>0&&previous.blocked>0&&previous.congestedLinks>0&&row.blocked>0&&row.congestedLinks>0&&row.busMinute>previous.busMinute&&row.busMovement?.heldDrive>previous.busMovement?.heldDrive){for(const bus of row.buses.filter(b=>['toStart','running'].includes(b.phase))){const old=previous.buses.find(b=>b.id===bus.id&&['toStart','running'].includes(b.phase));if(old&&old.cell===bus.cell&&old.next===bus.next&&Math.abs(old.progress-bus.progress)<1e-7){observation.gateHold={epoch:row.epoch,bus:{...bus},grants:row.busMovement.committedDrive};observation.gateEvidence=[gateRow(previous),gateRow(row)];}}}
   row.motion={nonidle:row.presentation?.renderedPoses?.length?1:0,carMoves:0,busMoves:0};
   if(previous?.epoch===row.epoch){
    for(const p of row.presentation?.renderedPoses??[]){const old=previous.presentation?.renderedPoses?.find(q=>q.vehicleId===p.vehicleId);if(old&&Math.hypot(p.x-old.x,p.z-old.z)>1e-6)row.motion.carMoves++;}
    for(const b of row.buses){const old=previous.buses.find(q=>q.id===b.id);if(old&&old.cell===b.cell&&old.next===b.next&&['toStart','running'].includes(old.phase)&&['toStart','running'].includes(b.phase)&&Math.abs(old.progress-b.progress)>1e-7)row.motion.busMoves++;}
   }
   observation.rendered.push(row);if(observation.rendered.length>360)observation.rendered.shift();
   observation.motion=observation.rendered.reduce((sum,r,i)=>({nonidle:sum.nonidle+r.motion.nonidle,carMoves:sum.carMoves+(i?r.motion.carMoves:0),busMoves:sum.busMoves+(i?r.motion.busMoves:0)}),{nonidle:0,carMoves:0,busMoves:0});}
  requestAnimationFrame(sample);
 };requestAnimationFrame(sample);};
 window.Worker=class extends Native{
  constructor(url,options){
   const target=String(url).includes('game-worker-entry');if(target)observation.attempts++;
   if(target&&window.__trafficGapFault==='construct')throw Error('Injected traffic Worker construction failure');
   super(url,options);if(!target)return;observation.created++;let previous=null;
   this.addEventListener('message',event=>{if(event.data?.kind==='frame'){previous=structuredClone(event.data);observation.latest={step:event.data.frame.step,liveIds:event.data.frame.cars.map(c=>'game:'+c.id)};}});
   const post=this.postMessage.bind(this);this.postMessage=(message,...rest)=>{
    if(message?.kind==='compute'&&message.commitPrevious&&previous&&previous.epoch===message.epoch){observation.committed.push({...previous,buses:structuredClone(window.cityManager?.busSnapshot?.()??[])});if(observation.committed.length>32)observation.committed.shift();}
    return post(message,...rest);
   };
   const terminate=this.terminate.bind(this);this.terminate=()=>{observation.terminated++;return terminate();};
   this.addEventListener('error',()=>observation.errors++);
   if(window.__trafficGapFault==='async')queueMicrotask(()=>this.dispatchEvent(new Event('error')));
  }
 };
})()`;}
export function heldThenResumed(samples,stops=[]){
 let held=null;
 for(let i=1;i<samples.length;i++){
  const before=samples[i-1],now=samples[i];if(before.epoch!==now.epoch){held=null;continue;}
  const previous=busPoses((before.buses??[]).filter(b=>b.phase!=='home'),{stops}),active=busPoses((now.buses??[]).filter(b=>b.phase!=='home'),{stops});
  if(held){const bus=active.find(b=>b.id===held.id);if(bus&&now.busMovement.committedDrive>held.committedDrive&&Math.hypot(bus.x-held.x,bus.z-held.z)>1e-7)return{...held,resumedMinute:now.busMinute,resumedX:bus.x,resumedZ:bus.z,resumedCommittedDrive:now.busMovement.committedDrive};}
  if(!held&&before.busMovement?.committedDrive>0&&before.blocked>0&&before.congestedLinks>0&&now.blocked>0&&now.congestedLinks>0&&now.busMinute>before.busMinute&&now.busMovement?.heldDrive>before.busMovement?.heldDrive){
   for(const bus of active){const roadNow=['toStart','running'].includes(now.buses.find(b=>b.id===bus.id)?.phase),roadBefore=['toStart','running'].includes(before.buses.find(b=>b.id===bus.id)?.phase);const old=previous.find(b=>b.id===bus.id);if(roadNow&&roadBefore&&old&&Math.hypot(bus.x-old.x,bus.z-old.z)<1e-7)held={id:bus.id,x:bus.x,z:bus.z,heldMinute:now.busMinute,heldDrive:now.busMovement.heldDrive,committedDrive:now.busMovement.committedDrive};}
  }
 }
 return null;
}
export function inspectTrafficEvidence(records,rendered,stops,{requireBus=true,requireHold=false,gateEvidence=[]}={}){
 assert.ok(records.length>=3,'Several real committed Worker frames required');
 for(const {frame} of records){
  for(const k of ['offered','completed','dropped','cancelled','waiting','moving'])assert.ok(Number.isFinite(frame[k])&&frame[k]>=0,k);
  assert.ok(Math.abs(frame.offered-frame.completed-frame.dropped-frame.cancelled-frame.waiting-frame.moving)<1e-6,'Actual Worker demand mass conserved');
  assert.equal(frame.cars.length,frame.moving);assert.ok(frame.cars.length<=128);
 }
 assert.ok(rendered.length>=4,'Actual render-frame telemetry required');
 let previous=null,nonidle=0,busSamples=0,movement=0;const removed=new Set(),visibility=[];let maxBusIntrusions=0,maxRenderedFrameDisplacement=0,busPositionChanges=0,homeSamples=0,maxHeldDrive=0,maxGrantedDrive=0;
 for(const sample of rendered){
  const d=sample.presentation;assert.ok(d&&Array.isArray(d.renderedPoses),'Read-only actual rendered positions are required');const poses=d.renderedPoses,buses=busPoses((sample.buses??[]).filter(b=>b.phase!=='home'),{stops});
  assert.ok(poses.length<=64);assert.equal(poses.length,sample.cars);assert.deepEqual(poses.map(p=>p.vehicleId),d.renderedIds);assert.deepEqual(d.selectedIds,d.renderedIds,'No admitted vehicle hidden by collision filtering');
  if(poses.length)nonidle++;if(buses.length)busSamples++;
  for(const p of poses){assert.ok([p.x,p.z,p.headingX,p.headingZ].every(Number.isFinite));assert.ok(Math.abs(Math.hypot(p.headingX,p.headingZ)-1)<1e-6);}
  for(let a=0;a<poses.length;a++)for(let b=a+1;b<poses.length;b++){
   const first=renderedVehicleBox(poses[a],TRAFFIC_SPACING.lengths.sedan,.3),second=renderedVehicleBox(poses[b],TRAFFIC_SPACING.lengths.sedan,.3),gap=TRAFFIC_SPACING.standstillGap;
   assert.equal(boxesOverlap({minX:first.minX-gap,maxX:first.maxX+gap,minZ:first.minZ-gap,maxZ:first.maxZ+gap},second,1e-7),false,'Actual displayed car bodies preserve gap between Worker frames');
  }
  for(const p of poses)for(const bus of buses)assert.equal(boxesOverlap(renderedVehicleBox(p,TRAFFIC_SPACING.lengths.sedan,.3),renderedVehicleBox(bus,bus.length,bus.width),1e-7),false,'Movement-gated active bus and visible car must never overlap');
  maxBusIntrusions=Math.max(maxBusIntrusions,d.busIntrusions);assert.equal(d.busIntrusions,0,'No accepted independent bus intrusion remains');
  if(requireBus){
   assert.ok(sample.busDraw&&sample.busLedger&&sample.busMovement,'Actual bus renderer and conservation/movement diagnostics required');
   const stored=(sample.buses??[]).filter(b=>b.phase==='home');homeSamples+=stored.length;
   assert.equal(sample.busDraw.buses,buses.length,'Only actual home-phase storage may omit a bus mesh');assert.equal(sample.busDraw.scene.buses,buses.length,'GPU instances match every active engine bus');
   const ledger=sample.busLedger,e=ledger.engine;
   for(const key of ['splitError','engineError','releaseError'])assert.ok(Math.abs(ledger[key])<1e-6,'Bus bridge '+key);
   for(const key of ['accepted','waiting','onboard','completed','released'])assert.ok(Number.isFinite(e[key])&&e[key]>=0,'Bus ledger '+key);
   assert.equal(e.accepted,e.waiting+e.onboard+e.completed+e.released,'Actual bus passenger mass conserved');
   assert.equal((sample.buses??[]).reduce((n,b)=>n+b.persons,0),e.onboard,'Actual bus snapshots account for onboard riders');
   assert.ok(Number.isFinite(sample.busMinute));for(const key of ['heldDrive','committedDrive'])assert.ok(Number.isFinite(sample.busMovement[key])&&sample.busMovement[key]>=0,'Finite actual movement counter '+key);maxHeldDrive=Math.max(maxHeldDrive,sample.busMovement.heldDrive);maxGrantedDrive=Math.max(maxGrantedDrive,sample.busMovement.committedDrive);
   if(previous?.epoch===sample.epoch){assert.ok(sample.busMinute>=previous.busMinute,'Service clock never rewinds while a bus is held');
    const before=busPoses((previous.buses??[]).filter(b=>b.phase!=='home'),{stops});
    for(const bus of buses){const old=before.find(b=>b.id===bus.id);if(old&&Math.hypot(bus.x-old.x,bus.z-old.z)>1e-7)busPositionChanges++;}
    assert.deepEqual((sample.buses??[]).map(b=>b.id).sort(),(previous.buses??[]).map(b=>b.id).sort(),'Home storage does not delete engine bus identities');
   }
  }
  if(previous?.epoch===sample.epoch){
   for(const p of previous.presentation.renderedPoses){const next=poses.find(q=>q.vehicleId===p.vehicleId);if(next){const distance=Math.hypot(p.x-next.x,p.z-next.z);maxRenderedFrameDisplacement=Math.max(maxRenderedFrameDisplacement,distance);assert.ok(distance<=TRAFFIC_SPACING.maxSpeedTiles*TRAFFIC_SPACING.worldPerTile*.25+1e-6,'Admitted visible car cannot teleport beyond the bounded render timestep');if(distance>1e-6)movement++;}else{assert.ok(sample.liveIds,'Matching authoritative Worker frame required to explain removal');assert.ok(!sample.liveIds.includes(p.vehicleId),'Live admitted ID cannot disappear');assert.ok(d.lastRemoved.includes(p.vehicleId),'Removal must be recorded by bounded retirement');removed.add(p.vehicleId);}}
   for(const p of poses)assert.ok(!removed.has(p.vehicleId),'Removed ID cannot flash back into the same city epoch');
  }else removed.clear();
  if(!previous||JSON.stringify(previous.presentation.renderedIds)!==JSON.stringify(d.renderedIds))visibility.push({step:sample.step,ids:d.renderedIds,retiring:d.retiringIds,deferred:d.deferredIds});
  previous=sample;
 }
 assert.ok(nonidle>=2&&movement>0,'Actual displayed vehicles must move, not merely an idle boot; evidence='+JSON.stringify({nonidle,movement,renderSamples:rendered.length,workerFrames:records.length,firstStep:rendered[0]?.step,lastStep:rendered.at(-1)?.step,firstIds:rendered[0]?.presentation?.renderedIds,lastIds:rendered.at(-1)?.presentation?.renderedIds,busPositionChanges}));if(requireBus)assert.ok(busSamples>0,'Actual bus snapshots required for mixed-scene proof');
 if(requireBus){assert.ok(maxGrantedDrive>0,'Actual engine movement was admitted by the gate');assert.ok(busPositionChanges>0,'Actual active buses moved rather than being hidden or frozen');}
 const holdResume=requireBus?(heldThenResumed(gateEvidence,stops)??heldThenResumed(rendered,stops)):null;if(requireHold)assert.ok(holdResume,'Same real held bus must later be granted and physically resume while global time advances');
 return{holdResume,maxHeldDrive,maxGrantedDrive,busPositionChanges,homeSamples,maxBusIntrusions,maxRenderedFrameDisplacement,frames:records.length,renderSamples:rendered.length,nonidleFrames:nonidle,busSamples,movementSamples:movement,visibility};
}
export function inspectRrtEvidence(records){
 let maxAttempted=0,maxAccepted=0,maxExpanded=0,maxIterations=0;
 assert.ok(records.length>0,'Actual committed Worker frames required for RRT proof');
 for(const {frame} of records){const n=frame.navigation;assert.ok(n,'Actual Worker navigation diagnostics required');
  for(const key of ['attempted','accepted','fallback','unreachable','expanded','iterations','cacheHits','budgetExhausted'])assert.ok(Number.isSafeInteger(n[key])&&n[key]>=0,'Finite nonnegative RRT counter '+key);
  assert.ok(n.accepted<=n.attempted,'Accepted RRT paths cannot exceed attempts');assert.ok(n.expanded<=512&&n.iterations<=2048,'Actual Worker planning respects fixed per-wave RRT budgets');
  maxAttempted=Math.max(maxAttempted,n.attempted);maxAccepted=Math.max(maxAccepted,n.accepted);maxExpanded=Math.max(maxExpanded,n.expanded);maxIterations=Math.max(maxIterations,n.iterations);
 }
 assert.ok(maxAttempted>0&&maxAccepted>0,'Actual Worker must attempt and accept goal-directed RRT routes');
 return{frames:records.length,maxAttempted,maxAccepted,maxExpanded,maxIterations,nodeBudget:512,attemptBudget:2048};
}
export async function trafficWithCleanup(action,cleanup){
 let primary,failed=false,result;
 try{result=await action();}catch(error){primary=error;failed=true;}
 try{await cleanup();}catch(error){if(!failed)throw error;const detail=String(error?.stack??error);if(primary instanceof Error)primary.stack+='\nSecondary traffic cleanup failure: '+detail;else primary=new Error(String(primary)+'\nSecondary traffic cleanup failure: '+detail);}
 if(failed)throw primary;return result;
}
export const TRAFFIC_REVIEW_VIEWPORT=Object.freeze({width:960,height:640,deviceScaleFactor:1,mobile:false});
export async function trafficGapBrowserChecks({send,evaluate,capture,acknowledge,reload,loadFixture,phase=()=>{}}){
 await send('Emulation.setDeviceMetricsOverride',TRAFFIC_REVIEW_VIEWPORT);
 const checks=[],pacing={},partial={status:'running',completed:[]},sleep=ms=>new Promise(r=>setTimeout(r,ms));
 const reportPhase=phase;phase=label=>{partial.phase=label;(partial.phaseHistory??=[]).push(label);if(partial.phaseHistory.length>32)partial.phaseHistory.shift();reportPhase(label);};
 const pacingSnapshot=()=>evaluate('(()=>{const t=window.cityManager?.traffic?.();return {wallMs:performance.now(),busMinute:t?.busMinute,renderFrames:t?.timing?.frames,workerStep:t?.step,viewport:{width:innerWidth,height:innerHeight,pixelRatio:devicePixelRatio,canvasWidth:document.querySelector("canvas")?.width,canvasHeight:document.querySelector("canvas")?.height}}})()');
 const until=async(fn,label,limit=20000)=>{phase(label);const start=Date.now();while(Date.now()-start<limit){if(await fn())return;await sleep(100);}
  let evidence;try{evidence=await evaluate('(()=>{const d=window.cityManager?.traffic?.(),o=window.__trafficGapObserver;return {wallMs:performance.now(),renderTiming:d?.timing,viewport:{width:innerWidth,height:innerHeight,pixelRatio:devicePixelRatio,canvasWidth:document.querySelector("canvas")?.width,canvasHeight:document.querySelector("canvas")?.height},step:d?.step,cars:d?.cars,failure:d?.failure,busMinute:d?.busMinute,busMovement:d?.busMovement,busLedger:d?.busLedger,presentation:d?.presentation,buses:window.cityManager?.busSnapshot?.(),observedFrames:o?.committed.length,observedMotion:o?.motion,renderSamples:o?.rendered.length,gateEvidence:o?.gateEvidence}})()');}catch(error){evidence={diagnosticError:String(error)};}
  throw Error('Traffic gap browser timeout: '+label+'; bounded synthetic evidence='+JSON.stringify({pacing,...evidence}));};
 try{
 const tap=async selector=>{const p=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled||!e.getClientRects().length)throw Error('Traffic control unavailable');e.scrollIntoView({block:'center',inline:'nearest'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y);if(!hit||!e.contains(hit))throw Error('Traffic control is obscured');return{x,y}})()`);for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:1});};
 const paused=()=>evaluate('window.cityManager.parks().paused');
 const pause=async value=>{if(await paused()!==value)await tap('#pause');};
 const traffic=()=>evaluate('window.cityManager.traffic()');
 const observer=()=>evaluate('window.__trafficGapObserver');
 const toggle=async enabled=>{await tap('#toggle-game-menu');const current=await evaluate("document.querySelector('#traffic-game-toggle').getAttribute('aria-pressed')==='true'");if(current!==enabled)await tap('#traffic-game-toggle');await tap('#close-inspector');};
 assert.ok(await observer(),'Preboot passive Worker observer is required');assert.ok(await traffic(),'Traffic is enabled by default without a traffic query override');await pause(true);await toggle(true);
 await until(async()=>!!(await traffic())?.ready,'initial real Worker frame');assert.equal((await observer()).attempts,1,'Exactly one initial city worker');
 await tap('[data-speed="1"]');await evaluate('window.__trafficGapStartSampling()');await pause(false);
 await until(()=>evaluate('(()=>{const o=window.__trafficGapObserver,t=window.cityManager.traffic();return o.committed.length>=4&&t.cars>0&&t.step>=4&&t.busMovement?.committedDrive>0&&o.rendered.length>=4&&o.motion.nonidle>=2&&o.motion.carMoves>0&&o.motion.busMoves>0})()'),'busy real Worker and rendered cars');
 await pause(true);await until(async()=>{const t=await traffic();return t?.paused&&!t.updating;},'pause fence');
 await evaluate('window.__trafficGapSampling=false');const stable=await traffic(),observed=await observer(),records=observed.committed,city=JSON.parse(await evaluate('window.cityManager.sessionSnapshot()'));const proof=inspectTrafficEvidence(records,observed.rendered,city.bus?.stops??[]);assert.equal(await evaluate('window.cityManager.bus()?.drew'),true,'Actual bus renderer is active');
 await sleep(400);const still=await traffic();for(const key of ['step','moving','waiting','completed','dropped','cancelled','busMinute'])assert.equal(still[key],stable[key],'Paused '+key);
 assert.ok(still.cars>0&&still.drawBatches>0,'Actual scene has rendered vehicles, not only model data');await capture('traffic-gap-light-mixed-paused');
 partial.light=proof;partial.completed.push('light-motion-pause');
 checks.push('Native enable/run/pause with real committed Worker frames, conserved mass, nonidle rendered cars and actual rendered-frame clearance and identity lifecycle');
 await pause(false);await until(async()=>(await traffic()).step>stable.step,'resume advances real Worker');await pause(true);
 await toggle(false);assert.equal(await traffic(),null);await sleep(300);const off=(await observer()).attempts;await sleep(300);assert.equal((await observer()).attempts,off,'Disabled feature does not spawn workers');await toggle(true);await until(async()=>!!(await traffic())?.ready,'native re-enable');
 const lightSaved=await acknowledge();
 await loadFixture(trafficGapShortApproachFixture());await reload();await until(async()=>!!(await traffic())?.ready,'synthetic busy fixture entered from actual server ACK');
 pacing.busyStart=await pacingSnapshot();
 await evaluate('window.__trafficGapStartSampling()');await pause(false);
 // Bound the full natural approach/hold/release sequence at the unchanged bus clock.
 await until(()=>evaluate('(()=>{const t=window.cityManager.traffic(),o=window.__trafficGapObserver;return t.step>=6&&o.committed.some(({frame})=>frame.blocked>0&&frame.congestedLinks>0)&&o.committed.length>=4&&o.gateResume===true&&o.motion.nonidle>=2&&o.motion.carMoves>0&&o.motion.busMoves>0})()'),'real busy queue bus hold then later grant and physical resume',30000);
 pacing.busyEnd=await pacingSnapshot();
 await pause(true);await until(async()=>!(await traffic()).updating,'busy queue pause fence');await evaluate('window.__trafficGapSampling=false');
 const busyObserved=await observer(),busyState=await traffic();const busyCity=JSON.parse(await evaluate('window.cityManager.sessionSnapshot()'));const busyProof=inspectTrafficEvidence(busyObserved.committed,busyObserved.rendered,busyCity.bus?.stops??[],{requireHold:true,gateEvidence:busyObserved.gateEvidence});
 assert.ok(busyObserved.committed.some(({frame})=>frame.blocked>0&&frame.congestedLinks>0),'Real observed busy case has stopped traffic, not only synthetic inputs');
 partial.busy=busyProof;partial.pacing=pacing;partial.completed.push('congested-hold-resume');
 await capture('traffic-gap-busy-queue-paused');
 const saved=await acknowledge();assert.equal(saved.version,25);await reload();await until(async()=>!!(await traffic())?.ready,'ACK reload worker');
 const restored=JSON.parse(await evaluate('window.cityManager.sessionSnapshot()'));assert.deepEqual(restored,saved,'Complete paused city/session survives the real server ACK reload unchanged');assert.ok(!('trafficGame' in restored),'Ephemeral game is not a city-save payload');await capture('traffic-gap-server-restored');partial.completed.push('server-ACK-reload');
 checks.push('Native OFF/ON lifecycle and real server ACK/reload preserve city accounts/journal; no browser city backup is used');
 // Dense-grid rendering is a separate bounded sample, not a full-cycle browser claim.
 const denseRaw=trafficRightOfWayFixture(1,true),denseWitness=trafficRightOfWayWitness(denseRaw);
 assert.ok(denseWitness.encounteredConflictNodes>4,'Actual dense bus route crosses more than four conflict nodes');
 await loadFixture(denseRaw);await reload();await until(async()=>!!(await traffic())?.ready,'dense grid entered from real server ACK');
 await evaluate('window.__trafficGapStartSampling()');await pause(false);
 await until(()=>evaluate('(()=>{const t=window.cityManager.traffic(),o=window.__trafficGapObserver;return t.step>=4&&t.cars>0&&o.committed.length>=4&&t.busMovement?.committedDrive>0&&o.rendered.length>=4&&o.motion.nonidle>=2&&o.motion.carMoves>0&&o.motion.busMoves>0})()'),'dense real Worker cars and physically advancing bus');
 await pause(true);await until(async()=>!(await traffic()).updating,'dense pause fence');await evaluate('window.__trafficGapSampling=false');
 const denseObserved=await observer(),denseCity=JSON.parse(await evaluate('window.cityManager.sessionSnapshot()'));
 const denseProof=inspectTrafficEvidence(denseObserved.committed,denseObserved.rendered,denseCity.bus?.stops??[]);
 partial.navigation=inspectRrtEvidence([...records,...busyObserved.committed,...denseObserved.committed]);
 partial.dense={...denseProof,witness:denseWitness};partial.completed.push('dense-render-motion');
 await capture('traffic-gap-dense-grid-paused');
 checks.push('Actual greater-than-four-node dense server seed renders live cars and bus with strict sampled clearance; complete L1/L2/L3 cycles remain mandatory real-engine/layer tests');
 await loadFixture(JSON.stringify(lightSaved));await reload();await until(async()=>!!(await traffic())?.ready,'original light fixture restored through server');
 const faults=[];
 for(const fault of ['construct','async']){
  const script=await send('Page.addScriptToEvaluateOnNewDocument',{source:`window.__trafficGapFault=${JSON.stringify(fault)};`});
  await trafficWithCleanup(async()=>{
   phase('fault '+fault+': reload');await reload();await until(async()=>!!(await traffic())?.failure,'injected '+fault+' failure');
   phase('fault '+fault+': read runtime clock');
   const clock=()=>evaluate(`(()=>{const r=JSON.parse(window.cityManager.sessionSnapshot()).parkRuntime;return r.activity.day*1440+r.activity.minute+r.minuteRemainder})()`),beforeClock=await clock();
   await pause(false);await until(async()=>(await clock())>beforeClock,'economy/runtime continues despite '+fault+' fault');await sleep(2200);phase('fault '+fault+': pause after runtime progress');await pause(true);phase('fault '+fault+': lifecycle assertions');
   const o=await observer(),t=await traffic();assert.equal(o.attempts,1,'Worker fault is latched without retry storm');assert.equal(o.created,fault==='construct'?0:1);assert.ok(t.failure);assert.equal(o.terminated,fault==='construct'?0:1,'Failed owned worker is disposed once');assert.match(await evaluate("document.querySelector('#traffic-game-status [role=status]').textContent"),/แบบจำลองไม่พร้อม.*รถตกแต่งแทน/,'User sees actual fallback status');assert.equal(t.drawBatches,0,'Faulted game fleet is hidden');faults.push({fault,attempts:o.attempts,created:o.created,failure:t.failure});
  },async()=>{phase('fault '+fault+': remove injected script');await send('Page.removeScriptToEvaluateOnNewDocument',{identifier:script.identifier});});
  partial.faults=[...faults];partial.completed.push('fault-'+fault);
 }
 await reload();await until(async()=>!!(await traffic())?.ready,'healthy explicit reload after faults');await pause(true);
 checks.push('Explicit constructor and asynchronous Worker fault injections each make one attempt; normal operation returns only on explicit healthy reload');
 return {status:'passed',checks,pacing,navigation:partial.navigation,light:proof,dense:{...denseProof,witness:denseWitness},busy:{...busyProof,blocked:busyState.blocked,congestedLinks:busyState.congestedLinks},faults,scope:'Browser covers actual rendered sedan/SUV poses and observed bus bodies. Active bus/car clearance and engine passenger conservation are strict. Only actual home-phase storage omits bus meshes; long boarding/dwell/service-end cycles are covered by focused real-engine tests, not claimed from this short browser sample. Truck extents and exhaustive turning/stopping/restart adversarial cases remain separate mandatory source tests; no live truck/speed telemetry is fabricated.'};
 }catch(error){partial.status='failed';const detail='\nPartial traffic evidence (not complete acceptance): '+JSON.stringify(partial);if(error instanceof Error){error.stack+=detail;throw error;}throw new Error(String(error)+detail);}
}
