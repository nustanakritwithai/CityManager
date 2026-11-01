import assert from 'node:assert/strict';

/** Read-only observer of the actual production Worker. The browser still
 * constructs, drives and receives every native worker message unchanged. */
export function observeWorkWorker(){
 window.__workFrames=[];window.__workRequests=[];
 const NativeWorker=window.Worker;
 window.Worker=new Proxy(NativeWorker,{construct(target,args,newTarget){
  const worker=Reflect.construct(target,args,newTarget);
  if(String(args[0]).includes('game-worker-entry')){
   const nativePost=worker.postMessage;
   worker.postMessage=function(message,...rest){
    const w=message?.sample?.work;
    if(w){window.__workRequests.push({seq:message.seq,advance:message.advance,paused:message.paused,day:w.day,minute:w.minute,ack:w.ack,crossedWorkDay:w.crossedWorkDay??null,cancelIds:[...(w.cancelIds??[])],owners:window.__workOwnerSnapshot??null,at:performance.now()});if(window.__workRequests.length>160)window.__workRequests.shift();}
    return Reflect.apply(nativePost,this,[message,...rest]);
   };
   worker.addEventListener('message',event=>{
   const frame=event.data?.kind==='frame'?event.data.frame:null;if(!frame)return;
   window.__workFrames.push({seq:event.data.seq,step:frame.step,cars:frame.cars,workTrips:frame.workTrips??[],expiredWorkTrips:frame.expiredWorkTrips??[],phases:frame.signals?.phases??[]});
   if(window.__workFrames.length>160)window.__workFrames.shift();
   });
  }
  return worker;
 }});
}

/** A worker receipt is not a completed acknowledgement until the host sends
 * its sequence back and a later worker frame confirms the cleared tombstone. */
export function workAckEvidence(id,frames,requests,traffic){
 const receipt=frames.flatMap(f=>f.expiredWorkTrips).find(e=>e.id===id);
 const cancel=requests.find(r=>r.cancelIds.includes(id));
 const ack=receipt&&cancel?requests.find(r=>r.seq>cancel.seq&&r.ack>=receipt.sequence):null;
 const frame=ack?frames.find(f=>f.seq===ack.seq):null;
 if(!receipt||!cancel||!ack||!frame||frame.expiredWorkTrips.some(e=>e.id===id)||frame.cars.some(c=>c.id===id)||frame.workTrips.some(c=>c.id===id)||traffic.worker?.inflight||traffic.worker?.pending||traffic.presentation.selectedIds.includes('game:'+id))return null;
 return {receipt,cancel,ack,ackFrame:{seq:frame.seq,expired:frame.expiredWorkTrips}};
}

/** Runs only against the built app and synthetic, server-acknowledged cities.
 * Native Worker messages and presenter diagnostics supply identities; the
 * test never inserts actors or commands into either traffic state machine. */
export async function workExpiryBrowserChecks(h){
 const {signalRaw,closureRaw,closedRoad,navigate,evaluate,until,button,tapCell,screenshot,citizenSpeed,waitModel,waitPausedModel,send,sleep,setStage}=h;
 const checks=[],evidence={};
 const fullAck=id=>`(${workAckEvidence.toString()})(${id},window.__workFrames,window.__workRequests,window.cityManager.traffic())`;
 setStage('work trip red light and pause');await navigate(signalRaw,'?traffic=1');await waitModel();await citizenSpeed();await button('#pause');
 await until(`(()=>{const t=window.cityManager.traffic(),p=window.cityManager.parks(),f=window.__workFrames.at(-1);if(!t||!f||t.step!==f.step)return false;const ids=new Set(f.workTrips.map(x=>x.id));const car=f.cars.find(c=>ids.has(c.id)&&c.blocked&&f.phases.some(s=>s.node===c.to&&(s.state!=='green'||s.approach!==c.from))&&t.presentation.renderedIds.includes('game:'+c.id));if(!car||!(p.day>f.workTrips.find(x=>x.id===car.id).day||p.minute>=1020))return false;const pose=t.presentation.renderedPoses.find(x=>x.vehicleId==='game:'+car.id);if(!pose)return false;window.__workRed={id:car.id,x:pose.x,z:pose.z,step:f.step,day:p.day,minute:p.minute};return true})()`,45000);
 const red=await evaluate('window.__workRed');await screenshot('work-red-wait.png');
 await until(`(()=>{const id=${red.id},t=window.cityManager.traffic(),p=t.presentation.renderedPoses.find(v=>v.vehicleId==='game:'+id);return !!p&&Math.hypot(p.x-${red.x},p.z-${red.z})>.01})()`,45000);
 assert.equal(await evaluate(`window.__workFrames.some(f=>f.expiredWorkTrips.some(x=>x.id===${red.id}))`),false,'Ordinary red-light work car did not expire before moving');
 evidence.red={...red,moved:await evaluate(`window.cityManager.traffic().presentation.renderedPoses.find(v=>v.vehicleId==='game:'+${red.id})`)};
 await button('#pause');await waitPausedModel();const paused=await evaluate('({parks:window.cityManager.parks(),traffic:window.cityManager.traffic()})');await sleep(1500);
 const frozen=await evaluate('({parks:window.cityManager.parks(),traffic:window.cityManager.traffic()})');assert.equal(frozen.parks.day,paused.parks.day);assert.equal(frozen.parks.minute,paused.parks.minute);assert.deepEqual(frozen.traffic.presentation.renderedPoses,paused.traffic.presentation.renderedPoses);checks.push('Overdue red-light work car survives and physically moves; pause freezes clock and bodies');

 setStage('work trip releases its occupied junction');await navigate(closureRaw,'?traffic=1');await waitModel();await citizenSpeed();
 await evaluate(`window.__occupiedStop=false;(()=>{const watch=()=>{const t=window.cityManager.traffic(),f=window.__workFrames.at(-1),selected=t?.presentation.selectedIds??[];const ready=f?.workTrips.some(x=>selected.includes('game:'+x.id));if((t?.step===1&&ready)||t?.step>1){if(!window.cityManager.parks().paused)document.querySelector('#pause').click();window.__occupiedStop=true}else requestAnimationFrame(watch)};requestAnimationFrame(watch)})()`);
 await button('#pause');await until('window.__occupiedStop&&window.cityManager.parks().paused',20000);await waitPausedModel();
 const occupiedBefore=await evaluate(`(()=>{const t=window.cityManager.traffic(),f=window.__workFrames.findLast(x=>x.step===t.step),ids=new Set(f.workTrips.map(x=>x.id));return {step:t.step,cars:f.cars,target:f.cars.find(c=>ids.has(c.id)&&c.destination===${closedRoad+1}&&t.presentation.selectedIds.includes('game:'+c.id))}})()`);
 assert.equal(occupiedBefore.step,1,'Road is closed before a following worker step');assert.ok(occupiedBefore.target);assert.ok(occupiedBefore.cars.every(c=>c.from!==closedRoad&&c.to!==closedRoad));
 await send('Input.dispatchKeyEvent',{type:'keyDown',key:'b',code:'KeyB',windowsVirtualKeyCode:66});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'b',code:'KeyB',windowsVirtualKeyCode:66});await tapCell(closedRoad);await until(`JSON.parse(window.cityManager.snapshot()).cells[${closedRoad}].road===false`);await waitPausedModel();
 await evaluate(`window.__workOwnerWatch=true;window.__workOwnerFrame=0;(()=>{const watch=()=>{if(!window.__workOwnerWatch)return;const t=window.cityManager.traffic();window.__workOwnerSnapshot={frame:++window.__workOwnerFrame,at:performance.now(),owners:t?.presentation.cornerOwners??[]};requestAnimationFrame(watch)};requestAnimationFrame(watch)})()`);await button('#pause');
 await until(`window.cityManager.traffic().presentation.cornerOwners.some(c=>c.owner==='game:'+${occupiedBefore.target.id}&&c.active&&c.entered)`,30000);await screenshot('work-occupied-junction.png');
 await until(fullAck(occupiedBefore.target.id),130000);
 const occupiedAck=await evaluate(fullAck(occupiedBefore.target.id));
 assert.ok(occupiedAck.cancel.owners?.owners.some(c=>c.owner==='game:'+occupiedBefore.target.id&&c.active&&c.entered),'Last observed render frame immediately before cancellation still owns an entered corridor');
 assert.equal(await evaluate(`window.cityManager.traffic().presentation.cornerOwners.some(c=>c.owner==='game:'+${occupiedBefore.target.id})`),false,'Expired owner no longer retains a junction reservation');
 evidence.occupied={id:occupiedBefore.target.id,entered:true,ack:occupiedAck,after:await evaluate('window.cityManager.traffic().presentation.cornerOwners')};await evaluate('window.__workOwnerWatch=false');await screenshot('work-junction-released.png');await button('#pause');await waitPausedModel();checks.push('Overdue work car owns an entered corridor immediately before cancellation; worker ACK round trip releases that exact ownership');

 setStage('work trip blocks at a real future road closure');await navigate(closureRaw,'?traffic=1');await waitModel();await citizenSpeed();
 await evaluate(`window.__workStopped=false;(()=>{const watch=()=>{const t=window.cityManager.traffic();if(t?.step>=3){if(!window.cityManager.parks().paused)document.querySelector('#pause').click();window.__workStopped=true}else requestAnimationFrame(watch)};requestAnimationFrame(watch)})()`);
 await button('#pause');await until('window.__workStopped&&window.cityManager.parks().paused',20000);await waitPausedModel();
 const before=await evaluate(`(()=>{const t=window.cityManager.traffic(),f=window.__workFrames.findLast(x=>x.step===t.step),ids=new Set(f.workTrips.map(x=>x.id));const target=f.cars.find(c=>ids.has(c.id)&&c.destination===${closedRoad+1}&&t.presentation.selectedIds.includes('game:'+c.id));const follower=f.cars.find(c=>!ids.has(c.id)&&c.destination===target?.destination);return {step:t.step,target,follower,cars:f.cars,presentation:t.presentation}})()`);
 assert.ok(before.step>=3&&before.step<=4,JSON.stringify({step:before.step}));assert.ok(before.target&&before.follower,'Real worker supplies visible work car and unrelated same-route follower');assert.ok(before.cars.every(c=>c.from!==closedRoad&&c.to!==closedRoad),'Future road is unoccupied');
 await send('Input.dispatchKeyEvent',{type:'keyDown',key:'b',code:'KeyB',windowsVirtualKeyCode:66});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'b',code:'KeyB',windowsVirtualKeyCode:66});await tapCell(closedRoad);
 await until(`JSON.parse(window.cityManager.snapshot()).cells[${closedRoad}].road===false`);await until(`window.__workFrames.some(f=>f.cars.some(c=>c.id===${before.target.id}&&c.blocked))`);await waitPausedModel();
 const stopped=await evaluate(`({p:window.cityManager.traffic().presentation,expired:window.__workFrames.flatMap(f=>f.expiredWorkTrips).some(x=>x.id===${before.target.id})})`);assert.equal(stopped.expired,false);assert.ok(stopped.p.selectedIds.includes('game:'+before.target.id));await screenshot('work-blocked-paused.png');
 await sleep(1500);const frozenBlocked=await evaluate(`({p:window.cityManager.traffic().presentation,expired:window.__workFrames.flatMap(f=>f.expiredWorkTrips).some(x=>x.id===${before.target.id})})`);assert.equal(frozenBlocked.expired,false);assert.deepEqual(frozenBlocked.p.renderedPoses,stopped.p.renderedPoses);
 await button('#pause');await sleep(10000);assert.equal(await evaluate(`window.__workFrames.some(f=>f.expiredWorkTrips.some(x=>x.id===${before.target.id}))`),false,'A short physical stop is not a sustained stall');
 await until(fullAck(before.target.id),130000);
 evidence.expired={id:before.target.id,follower:before.follower.id,beforeStep:before.step,receipt:await evaluate(`window.__workFrames.flatMap(f=>f.expiredWorkTrips).find(x=>x.id===${before.target.id})`),presentation:await evaluate('window.cityManager.traffic().presentation')};await screenshot('work-expired.png');
 assert.equal(await evaluate(`window.cityManager.traffic().presentation.renderedIds.includes('game:'+${before.target.id})`),false,'Expired body is gone after worker receipt');
 await button('#pause');await waitPausedModel();await button('[data-tool="road"]');await tapCell(closedRoad-1);await tapCell(closedRoad);await until(`JSON.parse(window.cityManager.snapshot()).cells[${closedRoad}].road===true`);await waitPausedModel();
 const followerBefore=await evaluate(`window.__workFrames.findLast(f=>f.cars.some(c=>c.id===${before.follower.id}))?.cars.find(c=>c.id===${before.follower.id})`);assert.ok(followerBefore,'Unrelated follower remains in the worker before reopening');
 const followerPose=await evaluate(`window.cityManager.traffic().presentation.renderedPoses.find(p=>p.vehicleId==='game:'+${before.follower.id})`);assert.ok(followerPose,'Same unrelated follower remains physically visible');const beforeSeq=await evaluate('window.__workFrames.at(-1).seq');
 await button('#pause');await until(`window.__workFrames.some(f=>f.seq>${beforeSeq}&&f.cars.some(c=>c.id===${before.follower.id}&&(c.from!==${followerBefore.from}||c.to!==${followerBefore.to}||(c.progress??0)>${followerBefore.progress??0}+.001)))`,35000);
 await until(`(()=>{const p=window.cityManager.traffic().presentation.renderedPoses.find(v=>v.vehicleId==='game:'+${before.follower.id});return !!p&&Math.hypot(p.x-${followerPose.x},p.z-${followerPose.z})>.01})()`,35000);
 evidence.follower={id:before.follower.id,before:followerBefore,after:await evaluate(`window.__workFrames.findLast(f=>f.cars.some(c=>c.id===${before.follower.id}))?.cars.find(c=>c.id===${before.follower.id})`)};await button('#pause');await waitPausedModel();await screenshot('work-follower-resumed.png');checks.push('Sustained blocked overdue work car receives expiration ACK; same unrelated follower proceeds after road repair');

 setStage('work trip scaled clock crossing');await navigate(closureRaw,'?traffic=1');await waitModel();await button('[data-speed="10"]');
 await evaluate(`(()=>{const p=window.cityManager.parks();window.__workClockTrace={previous:p.day*1440+p.minute+p.minuteRemainder,samples:0,crossings:[],running:true};const watch=()=>{const trace=window.__workClockTrace;if(!trace.running)return;const p=window.cityManager.parks();if(!p.paused){const now=p.day*1440+p.minute+p.minuteRemainder,day=Math.floor((now-1020)/1440),start=day*1440+390,end=day*1440+1020;if(day>=0&&trace.previous<start&&now>=end){trace.crossings.push({day,before:trace.previous,after:now,frame:trace.samples,at:performance.now()});if(trace.crossings.length>80)trace.crossings.shift();}trace.previous=now;trace.samples++;}requestAnimationFrame(watch)};requestAnimationFrame(watch)})()`);
 await send('Emulation.setCPUThrottlingRate',{rate:8});
 let scaled;try{
  await button('#pause');
  await until(`window.__workClockTrace.crossings.some(x=>window.__workRequests.some(r=>r.advance&&r.crossedWorkDay===x.day&&window.__workFrames.some(f=>f.seq>=r.seq&&f.workTrips.some(t=>t.day===x.day))))`,45000);
  scaled=await evaluate(`(()=>{const crossing=window.__workClockTrace.crossings.find(x=>window.__workRequests.some(r=>r.advance&&r.crossedWorkDay===x.day&&window.__workFrames.some(f=>f.seq>=r.seq&&f.workTrips.some(t=>t.day===x.day))));const request=window.__workRequests.find(r=>r.advance&&r.crossedWorkDay===crossing.day),frame=window.__workFrames.find(f=>f.seq>=request.seq&&f.workTrips.some(t=>t.day===crossing.day));return {speed:window.cityManager.parks().speed,crossing,request,frame:{seq:frame.seq,step:frame.step,workTrips:frame.workTrips},samples:window.__workClockTrace.samples}})()`);
  assert.equal(scaled.speed,10);assert.ok(scaled.crossing.before<scaled.crossing.day*1440+390&&scaled.crossing.after>=scaled.crossing.day*1440+1020,'Two consecutive observed application frames skip the complete work period');
 }finally{await send('Emulation.setCPUThrottlingRate',{rate:1});await evaluate('window.__workClockTrace.running=false');}
 await button('#pause');await waitPausedModel();evidence.scaled=scaled;await screenshot('work-scaled-clock.png');checks.push('At real 10x playback, two observed frames cross the full work period and the later worker frame retains that day\'s work label');
 return {checks,evidence};
}
