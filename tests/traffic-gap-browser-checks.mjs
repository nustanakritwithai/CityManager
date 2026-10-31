import assert from 'node:assert/strict';
import {trafficGapBusyFixture} from './traffic-gap-fixture.ts';
import {busPoses} from '../src/bus/poses.ts';
import {vehicleBox as renderedVehicleBox,boxesOverlap,TRAFFIC_SPACING} from '../src/traffic/spacing.ts';
// Shared rotated full-body bounds; verified independently at 45 degrees below.
export {renderedVehicleBox};
/** Install before app boot. Observe real Worker messages without changing normal delivery.
 * Only a subsequent explicit commitPrevious acknowledges a candidate into the model. */
export function trafficGapBootstrap(){return `(()=>{
 const Native=window.Worker,observation={attempts:0,created:0,terminated:0,committed:[],rendered:[],errors:0,latest:null};window.__trafficGapObserver=observation;
 window.__trafficGapSampling=false;
 window.__trafficGapStartSampling=()=>{if(window.__trafficGapSampling)return;window.__trafficGapSampling=true;const sample=()=>{
  if(!window.__trafficGapSampling)return;const d=window.cityManager?.traffic?.();
  if(d?.ready&&!d.failure){observation.rendered.push({step:d.step,epoch:d.worker?.epoch,presentation:d.presentation,cars:d.cars,buses:structuredClone(window.cityManager?.busSnapshot?.()??[]),liveIds:observation.latest?.step===d.step?observation.latest.liveIds:null});if(observation.rendered.length>360)observation.rendered.shift();}
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
export function inspectTrafficEvidence(records,rendered,stops,{requireBus=true}={}){
 assert.ok(records.length>=3,'Several real committed Worker frames required');
 for(const {frame} of records){
  for(const k of ['offered','completed','dropped','cancelled','waiting','moving'])assert.ok(Number.isFinite(frame[k])&&frame[k]>=0,k);
  assert.ok(Math.abs(frame.offered-frame.completed-frame.dropped-frame.cancelled-frame.waiting-frame.moving)<1e-6,'Actual Worker demand mass conserved');
  assert.equal(frame.cars.length,frame.moving);assert.ok(frame.cars.length<=128);
 }
 assert.ok(rendered.length>=4,'Actual render-frame telemetry required');
 let previous=null,nonidle=0,busSamples=0,movement=0;const removed=new Set(),visibility=[],busDrivenIntrusions=[],ongoingBusIntrusions=new Set();let maxBusIntrusions=0,maxRenderedFrameDisplacement=0;
 for(const sample of rendered){
  const d=sample.presentation;assert.ok(d&&Array.isArray(d.renderedPoses),'Read-only actual rendered positions are required');const poses=d.renderedPoses,buses=busPoses(sample.buses??[],{stops});
  assert.ok(poses.length<=64);assert.equal(poses.length,sample.cars);assert.deepEqual(poses.map(p=>p.vehicleId),d.renderedIds);assert.deepEqual(d.selectedIds,d.renderedIds,'No admitted vehicle hidden by collision filtering');
  if(poses.length)nonidle++;if(buses.length)busSamples++;
  for(const p of poses){assert.ok([p.x,p.z,p.headingX,p.headingZ].every(Number.isFinite));assert.ok(Math.abs(Math.hypot(p.headingX,p.headingZ)-1)<1e-6);}
  for(let a=0;a<poses.length;a++)for(let b=a+1;b<poses.length;b++){
   const first=renderedVehicleBox(poses[a],TRAFFIC_SPACING.lengths.sedan,.3),second=renderedVehicleBox(poses[b],TRAFFIC_SPACING.lengths.sedan,.3),gap=TRAFFIC_SPACING.standstillGap;
   assert.equal(boxesOverlap({minX:first.minX-gap,maxX:first.maxX+gap,minZ:first.minZ-gap,maxZ:first.maxZ+gap},second,1e-7),false,'Actual displayed car bodies preserve gap between Worker frames');
  }
  const overlapping=new Set();
  for(const p of poses)for(const bus of buses){
   if(!boxesOverlap(renderedVehicleBox(p,TRAFFIC_SPACING.lengths.sedan,.3),renderedVehicleBox(bus,bus.length,bus.width),1e-7))continue;
   const key=p.vehicleId+'|'+bus.id;overlapping.add(key);
   const oldCar=previous?.presentation.renderedPoses.find(q=>q.vehicleId===p.vehicleId),oldBus=previous?busPoses(previous.buses??[],{stops}).find(q=>q.id===bus.id):null;
   assert.ok(oldCar&&oldBus,'Newly admitted car cannot overlap a bus');
   assert.ok(Math.hypot(p.x-oldCar.x,p.z-oldCar.z)<1e-7&&Math.hypot(p.headingX-oldCar.headingX,p.headingZ-oldCar.headingZ)<1e-7,'Car must not drive or rotate into a bus');
   if(!ongoingBusIntrusions.has(key)){
    const dx=bus.x-oldBus.x,dz=bus.z-oldBus.z;
    assert.ok(Math.hypot(dx,dz)>1e-7,'Unclassified stationary bus overlap is a failure');
    assert.equal(boxesOverlap(renderedVehicleBox(oldCar,TRAFFIC_SPACING.lengths.sedan,.3),renderedVehicleBox(oldBus,oldBus.length,oldBus.width),1e-7),false,'New intrusion must start from clear bodies');
    assert.ok(d.busIntrusions>0,'Independent bus intrusion is explicitly reported, never hidden');
    busDrivenIntrusions.push({step:sample.step,car:{id:p.vehicleId,x:p.x,z:p.z},bus:{id:bus.id,length:bus.length,width:bus.width,from:{x:oldBus.x,z:oldBus.z},to:{x:bus.x,z:bus.z},direction:{dx,dz}}});
   }
  }
  ongoingBusIntrusions.clear();for(const key of overlapping)ongoingBusIntrusions.add(key);
  maxBusIntrusions=Math.max(maxBusIntrusions,d.busIntrusions);
  if(previous?.epoch===sample.epoch){
   for(const p of previous.presentation.renderedPoses){const next=poses.find(q=>q.vehicleId===p.vehicleId);if(next){const distance=Math.hypot(p.x-next.x,p.z-next.z);maxRenderedFrameDisplacement=Math.max(maxRenderedFrameDisplacement,distance);assert.ok(distance<=TRAFFIC_SPACING.maxSpeedTiles*TRAFFIC_SPACING.worldPerTile*.25+1e-6,'Admitted visible car cannot teleport beyond the bounded render timestep');if(distance>1e-6)movement++;}else{assert.ok(sample.liveIds,'Matching authoritative Worker frame required to explain removal');assert.ok(!sample.liveIds.includes(p.vehicleId),'Live admitted ID cannot disappear');assert.ok(d.lastRemoved.includes(p.vehicleId),'Removal must be recorded by bounded retirement');removed.add(p.vehicleId);}}
   for(const p of poses)assert.ok(!removed.has(p.vehicleId),'Removed ID cannot flash back into the same city epoch');
  }else removed.clear();
  if(!previous||JSON.stringify(previous.presentation.renderedIds)!==JSON.stringify(d.renderedIds))visibility.push({step:sample.step,ids:d.renderedIds,retiring:d.retiringIds,deferred:d.deferredIds});
  previous=sample;
 }
 assert.ok(nonidle>=2&&movement>0,'Actual displayed vehicles must move, not merely an idle boot');if(requireBus)assert.ok(busSamples>0,'Actual bus snapshots required for mixed-scene proof');
 assert.ok(maxBusIntrusions===0||busDrivenIntrusions.length>0,'Any observed intrusion diagnostic requires classified actual pose evidence');
 return{busDrivenIntrusions,maxBusIntrusions,maxRenderedFrameDisplacement,frames:records.length,renderSamples:rendered.length,nonidleFrames:nonidle,busSamples,movementSamples:movement,visibility};
}
export async function trafficGapBrowserChecks({send,evaluate,capture,acknowledge,reload,loadFixture,phase=()=>{}}){
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 const checks=[],sleep=ms=>new Promise(r=>setTimeout(r,ms));
 const until=async(fn,label)=>{phase(label);const start=Date.now();while(Date.now()-start<20000){if(await fn())return;await sleep(100);}throw Error('Traffic gap browser timeout: '+label);};
 const tap=async selector=>{const p=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled||!e.getClientRects().length)throw Error('Traffic control unavailable');e.scrollIntoView({block:'center',inline:'nearest'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y);if(!hit||!e.contains(hit))throw Error('Traffic control is obscured');return{x,y}})()`);for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:1});};
 const paused=()=>evaluate('window.cityManager.parks().paused');
 const pause=async value=>{if(await paused()!==value)await tap('#pause');};
 const traffic=()=>evaluate('window.cityManager.traffic()');
 const observer=()=>evaluate('window.__trafficGapObserver');
 const toggle=async enabled=>{await tap('#toggle-game-menu');const current=await evaluate("document.querySelector('#traffic-game-toggle').getAttribute('aria-pressed')==='true'");if(current!==enabled)await tap('#traffic-game-toggle');await tap('#close-inspector');};
 assert.ok(await observer(),'Preboot passive Worker observer is required');assert.ok(await traffic(),'Traffic is enabled by default without a traffic query override');await pause(true);await toggle(true);
 await until(async()=>!!(await traffic())?.ready,'initial real Worker frame');assert.equal((await observer()).attempts,1,'Exactly one initial city worker');
 await tap('[data-speed="1"]');await evaluate('window.__trafficGapStartSampling()');await pause(false);
 await until(async()=>{const o=await observer(),t=await traffic();return o.committed.length>=4&&t?.cars>0&&t?.step>=4;},'busy real Worker and rendered cars');
 await pause(true);await until(async()=>{const t=await traffic();return t?.paused&&!t.updating;},'pause fence');
 await evaluate('window.__trafficGapSampling=false');const stable=await traffic(),observed=await observer(),records=observed.committed,city=JSON.parse(await evaluate('window.cityManager.sessionSnapshot()'));const proof=inspectTrafficEvidence(records,observed.rendered,city.bus?.stops??[]);assert.equal(await evaluate('window.cityManager.bus()?.drew'),true,'Actual bus renderer is active');
 await sleep(400);const still=await traffic();for(const key of ['step','moving','waiting','completed','dropped','cancelled'])assert.equal(still[key],stable[key],'Paused '+key);
 assert.ok(still.cars>0&&still.drawBatches>0,'Actual scene has rendered vehicles, not only model data');await capture('traffic-gap-light-mixed-paused');
 checks.push('Native enable/run/pause with real committed Worker frames, conserved mass, nonidle rendered cars and actual rendered-frame clearance and identity lifecycle');
 await pause(false);await until(async()=>(await traffic()).step>stable.step,'resume advances real Worker');await pause(true);
 await toggle(false);assert.equal(await traffic(),null);await sleep(300);const off=(await observer()).attempts;await sleep(300);assert.equal((await observer()).attempts,off,'Disabled feature does not spawn workers');await toggle(true);await until(async()=>!!(await traffic())?.ready,'native re-enable');
 const lightSaved=await acknowledge();
 await loadFixture(trafficGapBusyFixture());await reload();await until(async()=>!!(await traffic())?.ready,'synthetic busy fixture entered from actual server ACK');
 await evaluate('window.__trafficGapStartSampling()');await pause(false);
 await until(async()=>{const t=await traffic(),o=await observer();return t?.step>=6&&t.blocked>0&&t.congestedLinks>0&&o.committed.length>=4;},'genuine busy queue and junctions through production Worker');
 await pause(true);await until(async()=>!(await traffic()).updating,'busy queue pause fence');await evaluate('window.__trafficGapSampling=false');
 const busyObserved=await observer(),busyState=await traffic();const busyProof=inspectTrafficEvidence(busyObserved.committed,busyObserved.rendered,[],{requireBus:false});
 assert.ok(busyObserved.committed.some(({frame})=>frame.blocked>0&&frame.congestedLinks>0),'Real observed busy case has stopped traffic, not only synthetic inputs');
 await capture('traffic-gap-busy-queue-paused');
 const saved=await acknowledge();assert.equal(saved.version,25);await reload();await until(async()=>!!(await traffic())?.ready,'ACK reload worker');
 const restored=JSON.parse(await evaluate('window.cityManager.sessionSnapshot()'));assert.deepEqual(restored,saved,'Complete paused city/session survives the real server ACK reload unchanged');assert.ok(!('trafficGame' in restored),'Ephemeral game is not a city-save payload');await capture('traffic-gap-server-restored');
 checks.push('Native OFF/ON lifecycle and real server ACK/reload preserve city accounts/journal; no browser city backup is used');
 await loadFixture(JSON.stringify(lightSaved));await reload();await until(async()=>!!(await traffic())?.ready,'original light fixture restored through server');
 const faults=[];
 for(const fault of ['construct','async']){
  const script=await send('Page.addScriptToEvaluateOnNewDocument',{source:`window.__trafficGapFault=${JSON.stringify(fault)};`});
  try{
   await reload();await until(async()=>!!(await traffic())?.failure,'injected '+fault+' failure');
   const clock=()=>evaluate(`(()=>{const r=JSON.parse(window.cityManager.sessionSnapshot()).parkRuntime;return r.activity.day*1440+r.activity.minute+r.minuteRemainder})()`),beforeClock=await clock();
   await pause(false);await until(async()=>(await clock())>beforeClock,'economy/runtime continues despite '+fault+' fault');await sleep(2200);await pause(true);
   const o=await observer(),t=await traffic();assert.equal(o.attempts,1,'Worker fault is latched without retry storm');assert.equal(o.created,fault==='construct'?0:1);assert.ok(t.failure);assert.equal(o.terminated,fault==='construct'?0:1,'Failed owned worker is disposed once');assert.match(await evaluate("document.querySelector('#traffic-game-status [role=status]').textContent"),/แบบจำลองไม่พร้อม.*รถตกแต่งแทน/,'User sees actual fallback status');assert.equal(t.drawBatches,0,'Faulted game fleet is hidden');faults.push({fault,attempts:o.attempts,created:o.created,failure:t.failure});
  }finally{await send('Page.removeScriptToEvaluateOnNewDocument',{identifier:script.identifier});}
 }
 await reload();await until(async()=>!!(await traffic())?.ready,'healthy explicit reload after faults');await pause(true);
 checks.push('Explicit constructor and asynchronous Worker fault injections each make one attempt; normal operation returns only on explicit healthy reload');
 return {status:'passed',checks,light:proof,busy:{...busyProof,blocked:busyState.blocked,congestedLinks:busyState.congestedLinks},faults,scope:'Browser covers actual rendered sedan/SUV poses and observed bus bodies. Any independent bus-driven intrusion is explicitly classified with stationary-car and moving-bus direction evidence; it is not universal bus right-of-way acceptance. Truck extents and exhaustive turning/stopping/restart adversarial cases remain separate mandatory source tests; no live truck/speed telemetry is fabricated.'};
}
