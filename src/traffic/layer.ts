import type {AppBase} from 'playcanvas';
import type {City} from '../sim.ts';
import {SceneTrafficSignals} from '../scene-traffic-signals.ts';
import {TrafficSignalDisplay} from './signal-display.ts';
import {SceneCitizenVehicles} from '../scene-citizen-vehicles.ts';
import {taxiEnabled} from '../taxi/buildings.ts';
import type {CitizenVehiclePose} from '../citizen-vehicle-poses.ts';
import {captureTrafficGameInput,gameCarIsTaxi,WORK_TRIP_START_MINUTE,WORK_TRIP_END_MINUTE,type TrafficGameInput,type TrafficGameFrame} from './game.ts';
import {gamePoses} from './game-poses.ts';
import {createTrafficGameClient} from './game-worker-client.ts';
import type {BusMovementGate,BusTurnIntent} from '../bus/engine.ts';
import {BusGameBridge} from '../bus/game-bridge.ts';
import {busPoses} from '../bus/poses.ts';
import {busEnabled} from '../bus/types.ts';
import {TrafficPresentation,type PresentationObstacle} from './presentation.ts';
import {WorkStallTracker} from './work-stall.ts';
import {crossedWorkWindowDay} from './work-window.ts';
export {trafficModelEnabled} from './flag.ts';

/** Ephemeral traffic-allocation game, independent of economic state and saves.
 * Work-trip deadlines use the supplied simulated city clock.
 * A dedicated worker handles routing; render objects never drive the model.
 * The model hard-caps 128 actors; a camera-independent spatial sample draws at
 * most 64, so panning does not leave stale viewport-only selection. Mobile frame
 * cost and visual coverage still require browser testing. */
export class TrafficLayer {
 /** Bus on #126's worker game (only when busEnabled(): BUS_ENABLED or ?bus=1). Null = unchanged game.
  * Renderer contract: `bus.engine` → snapshot()/waitingAt(); drainEvents() only via presentBuses. */
 bus:BusGameBridge|null=null;
 /** Bus clock: like this game, real time (1 game second per real second), independent of economy ticks and
  * speed. Starts at 07:00 so service (05:00–23:00) runs; resets with the city epoch. */
 private readonly busOn=busEnabled();private minute=7*60;
 private signalDisplay=new TrafficSignalDisplay();
 private readonly signalScene:Pick<SceneTrafficSignals,'sync'|'setEnabled'|'destroy'|'diagnostics'>|null;
 private readonly cars:Pick<SceneCitizenVehicles,'sync'|'setEnabled'|'destroy'|'diagnostics'>;
 private client:ReturnType<typeof createTrafficGameClient<TrafficGameInput,TrafficGameFrame>>|null=null;
 private city:City|null=null;private latest:TrafficGameFrame|null=null;
 private workClock:{day:number;minute:number}|null=null;private workExpiryAck=0;
 private crossedWorkDay:number|null=null;
 private workCancel=new Set<number>();private workRetired=new Set<number>();
 private workStalls=new WorkStallTracker();
 private presenter=new TrafficPresentation();private drawn:CitizenVehiclePose[]=[];
 private timing={samples:0,lastCaptureSubmitMs:0,maxCaptureSubmitMs:0,lastInputMs:0,maxInputMs:0,lastPostMs:0,maxPostMs:0,frames:0,lastFrameMs:0,maxFrameMs:0,projections:0,lastProjectionMs:0,maxProjectionMs:0};
 private anchor:number|null=null;private paused=true;private visible=true;private dirty=false;private renderDirty=true;private failure:string|null=null;
 constructor(private readonly app:AppBase,_onScreen:(cell:number)=>boolean=()=>true,private readonly onFailure:(message:string)=>void=()=>{},
   private readonly makeWorker:()=>Worker=()=>new Worker(new URL('./game-worker-entry.ts',import.meta.url),{type:'module'}),
   scene?:Pick<SceneCitizenVehicles,'sync'|'setEnabled'|'destroy'|'diagnostics'>,private readonly taxiOn=taxiEnabled(),private readonly now:()=>number=()=>performance.now(),signalScene?:Pick<SceneTrafficSignals,'sync'|'setEnabled'|'destroy'|'diagnostics'>){this.cars=scene??new SceneCitizenVehicles(app);this.signalScene=signalScene??(scene?null:new SceneTrafficSignals(app));}
 private fail(error:unknown):void {
  this.failure=error instanceof Error?error.message:String(error);try{this.client?.dispose();}catch{/* isolated visual feature */}
  this.signalDisplay.clear();try{this.signalScene?.sync([]);}catch{/* lost graphics */}try{this.signalScene?.setEnabled(false);}catch{/* lost graphics */}try{this.cars.setEnabled(false);}catch{/* graphics may be unavailable */}try{this.onFailure(this.failure);}catch{/* never disrupt city simulation */}
 }
 private reset(city:City):void {
  this.timing={samples:0,lastCaptureSubmitMs:0,maxCaptureSubmitMs:0,lastInputMs:0,maxInputMs:0,lastPostMs:0,maxPostMs:0,frames:0,lastFrameMs:0,maxFrameMs:0,projections:0,lastProjectionMs:0,maxProjectionMs:0};
  this.client?.dispose();this.client=null;this.city=city;this.latest=null;this.presenter=new TrafficPresentation();this.workStalls=new WorkStallTracker();this.crossedWorkDay=null;this.drawn=[];this.anchor=null;this.dirty=false;this.renderDirty=true;this.failure=null;this.workExpiryAck=0;this.workCancel.clear();this.workRetired.clear();this.cars.setEnabled(this.visible);this.cars.sync([]);
  this.signalDisplay.reset(city);this.signalScene?.sync([]);this.signalScene?.setEnabled(this.visible);
  this.bus=null;this.minute=7*60; // rebuilt in frame() on the fresh bus clock
  try {
   const worker=this.makeWorker(),epoch=crypto.randomUUID();
   this.client=createTrafficGameClient<TrafficGameInput,TrafficGameFrame>(worker,epoch,{onFrame:frame=>{
    const start=performance.now();this.latest=frame;const expired=frame.expiredWorkTrips??[];
    for(const x of expired){if(frame.cars.some(c=>c.id===x.id))throw Error('Expired work car remains active');this.workCancel.delete(x.id);this.workExpiryAck=Math.max(this.workExpiryAck,x.sequence);}
    this.presenter.expire(expired.map(x=>`game:${x.id}`));
    const outstanding=new Set((frame.workTrips??[]).map(t=>t.id));for(const id of this.workRetired)if(!outstanding.has(id))this.workRetired.delete(id);
    const cars=frame.cars.filter(c=>!this.workCancel.has(c.id));const signalHeads=this.signalDisplay.accept(frame.signals);this.signalScene?.sync(signalHeads);try{this.bus?.onFrame(frame.bus,this.minute);}catch(error){this.fail(error);}this.presenter.update(gamePoses(cars,frame.groups,24,2,128),gamePoses(cars,frame.groups),cars.filter(c=>!gameCarIsTaxi(c)).map(c=>`game:${c.id}`));this.renderDirty=true;
    const ms=performance.now()-start;this.timing.projections++;this.timing.lastProjectionMs=ms;this.timing.maxProjectionMs=Math.max(this.timing.maxProjectionMs,ms);
   },onFailure:message=>this.fail(message)});
   this.submit(city,false,this.paused);
  } catch(error){this.fail(error);}
 }
 private submit(city:City,advance:boolean,paused:boolean):void {
  const start=performance.now();const input=captureTrafficGameInput(city,{taxiEnabled:this.taxiOn,...(this.workClock?{workClock:{...this.workClock,ack:this.workExpiryAck,...(this.crossedWorkDay===null?{}:{crossedWorkDay:this.crossedWorkDay})}}:{})});if(input.work){input.work.cancelIds=[...this.workCancel];input.work.retiredIds=[...this.workRetired];}if(this.bus)input.bus=this.bus.input();const prepared=performance.now();this.client?.submit(input,{advance,paused});
  const end=performance.now(),ms=end-start,inputMs=prepared-start,postMs=end-prepared;this.timing.samples++;this.timing.lastCaptureSubmitMs=ms;this.timing.maxCaptureSubmitMs=Math.max(this.timing.maxCaptureSubmitMs,ms);this.timing.lastInputMs=inputMs;this.timing.maxInputMs=Math.max(this.timing.maxInputMs,inputMs);this.timing.lastPostMs=postMs;this.timing.maxPostMs=Math.max(this.timing.maxPostMs,postMs);
 }
 /** Every city replacement starts a fresh game epoch; nothing is read from or
  * written to the player's save. Map edits replace the current sample. */
 afterMapEdit(city:City,paused=this.paused):void {
  try{if(city!==this.city){this.workClock=null;this.paused=paused;this.reset(city);return;}this.signalDisplay.reset(city);this.signalScene?.sync([]);this.dirty=true;}catch(error){this.fail(error);}
 }
 setVisible(visible:boolean):void {if(this.visible===visible)return;this.visible=visible;this.renderDirty=true;try{this.cars.setEnabled(visible&&!this.failure);this.signalScene?.setEnabled(visible&&!this.failure);}catch(error){this.fail(error);}}
 /** Visibility can change when the renderer is not receiving frames. Fence an
  * in-flight step immediately on hide and reset wall-time on both transitions. */
 pageVisibilityChanged(hidden:boolean):void {
  this.anchor=null;
  if(hidden&&this.city&&this.client&&!this.failure){this.paused=true;try{this.submit(this.city,false,true);}catch(error){this.fail(error);}}
 }
 frame(city:City,minuteOfDay:number,paused:boolean,dt:number,day=city.tick):void {
  const frameStart=performance.now();
  try{const previousClock=this.workClock,cityChanged=city!==this.city,nextClock=paused&&!cityChanged&&previousClock?previousClock:{day,minute:minuteOfDay};this.workClock=!cityChanged&&previousClock&&previousClock.day*1440+previousClock.minute>nextClock.day*1440+nextClock.minute?previousClock:nextClock;if(cityChanged){this.paused=paused;this.reset(city);}
  if(!cityChanged&&!paused&&previousClock){const crossed=crossedWorkWindowDay(previousClock.day*1440+previousClock.minute,this.workClock.day*1440+this.workClock.minute);if(crossed!==null)this.crossedWorkDay=Math.max(this.crossedWorkDay??-1,crossed);}
  const effective=this.workClock;const timeBoundary=!cityChanged&&(!previousClock||previousClock.day!==effective.day||(previousClock.minute<WORK_TRIP_START_MINUTE&&effective.minute>=WORK_TRIP_START_MINUTE)||(previousClock.minute<WORK_TRIP_END_MINUTE&&effective.minute>=WORK_TRIP_END_MINUTE));
  const pauseChanged=paused!==this.paused;this.paused=paused;let advance=false;
  if(paused){this.anchor=null;}
  else if(this.client&&!this.failure){
   // PlayCanvas caps dt under low FPS. Use monotonic wall time for this cosmetic
   // game only, and drop excess elapsed time rather than bursting on return.
   const now=this.now();if(!Number.isFinite(now))throw Error('Invalid traffic clock');
   if(this.anchor===null||now<this.anchor)this.anchor=now;
   else if(now-this.anchor>=1000){this.anchor=now;const worker=this.client.status;advance=!worker.inflight&&!worker.pending;}

  }
  if(this.busOn&&!this.bus&&!this.failure)this.bus=new BusGameBridge(city,this.minute,this.busMovementGate,()=>this.presenter.clearBusReservations());
  if(this.bus)this.presenter.reconcileBuses(this.bus.engine.snapshot().map(b=>b.id));
  if(this.bus&&!paused&&!this.failure){this.minute+=Math.min(.25,Math.max(0,dt))/60;this.bus.tick(this.minute);}
  // The presenter evaluates expiry on every physical frame. Clock boundaries
  // alone need no worker request; a proven cancellation queues one immediately.
  if(timeBoundary&&paused)this.renderDirty=true;
  if((advance||pauseChanged||this.dirty)&&this.client&&!this.failure){this.dirty=false;this.submit(city,advance,paused);}
  if(!this.failure&&(this.renderDirty||!paused)){
   this.drawn=this.presenter.frame(dt,paused,this.busObstacles());
   if(this.reconcileWorkTrips(paused?0:dt)){this.drawn=this.presenter.frame(0,true);if(this.client)this.submit(city,false,paused);}
   if(this.visible)this.cars.sync(this.drawn);this.renderDirty=false;
  }
  }catch(error){this.fail(error);}finally{const ms=performance.now()-frameStart;this.timing.frames++;this.timing.lastFrameMs=ms;this.timing.maxFrameMs=Math.max(this.timing.maxFrameMs,ms);}
 }
 /** Use sustained lack of physical progress and a full-car-length reset; a car
  * must also be blocked now. Paused frames accumulate no time. */
 private reconcileWorkTrips(dt:number):boolean {
  if(!this.latest||!this.workClock)return false;
  const cars=new Map(this.latest.cars.map(c=>[c.id,c])),trips=this.latest.workTrips??[];this.workStalls.retain(new Set(trips.map(t=>t.id)));let changed=false;
  for(const trip of trips){
   if(this.workCancel.has(trip.id)||this.workRetired.has(trip.id))continue;
   const car=cars.get(trip.id),motion=this.presenter.motionState(`game:${trip.id}`);
   if(!car&&motion==='absent'){this.workRetired.add(trip.id);changed=true;continue;}
   const overdue=this.workClock.day>trip.day||this.workClock.day===trip.day&&this.workClock.minute>=WORK_TRIP_END_MINUTE;
   const blocked=motion==='blocked'||!!car?.blocked&&motion!=='moving';
   const stalled=this.workStalls.observe(trip.id,this.presenter.traveledDistance(`game:${trip.id}`),blocked,dt);
   if(overdue&&stalled){
    this.workCancel.add(trip.id);this.presenter.expire([`game:${trip.id}`]);changed=true;
   }
  }
  return changed;
 }
 /** Production geometry is used for both movement proposals and actual visible bodies.
  * The engine commits time/arrival only after this gate grants the complete sweep. */
 private busIntentGeometry=new WeakMap<BusTurnIntent,{id:string;samples:readonly PresentationObstacle[]}>();
 private busMovementGate:BusMovementGate=(proposal,others)=>{
  const peers=others.filter(b=>b.id!==proposal.busId&&b.phase!=='home'),options={stops:this.city?.bus?.stops??[]};
  const project=(snapshot:typeof proposal.from)=>busPoses([snapshot],options)[0];
  return this.presenter.allowBusMovement(proposal.busId,project(proposal.from),project(proposal.to),busPoses(peers,options),proposal.samples.map(project),proposal.turns?.map(turn=>{let geometry=this.busIntentGeometry.get(turn);if(!geometry){geometry={id:turn.id,samples:turn.samples.map(project)};this.busIntentGeometry.set(turn,geometry);}return geometry;}));
 };
 private busObstacles(){
  if(!this.bus||!this.city)return [];
  return busPoses(this.bus.engine.snapshot(this.minute).filter(b=>b.phase!=='home'),{stops:this.city.bus?.stops??[]});
 }

 destroy():void {try{this.client?.dispose();}catch{/* best effort */}this.client=null;this.signalDisplay.clear();try{this.signalScene?.destroy();}catch{/* best-effort owned graphics cleanup */}try{this.cars.destroy();}catch{/* visual cleanup must not affect city */}}
 get diagnostics(){const f=this.latest,worker=this.client?.status??null,presenter=this.presenter,bus=this.bus,signalDisplay=this.signalDisplay,signalScene=this.signalScene;return {...this.cars.diagnostics,mode:'allocation-game' as const,get presentation(){return presenter.diagnostics;},paused:this.paused,
  get signals(){return signalDisplay.diagnostics;},get signalRendering(){return signalScene?.diagnostics??null;},get busLedger(){return bus?.ledger()??null;},get busMovement(){return bus?.engine.movementStats??null;},busMinute:bus?.engine.now??null,busStranded:bus?.engine.strandedCount??0,ready:f!==null,updating:f===null||!!worker?.inflight||!!worker?.pending,step:f?.step??0,demandRate:f?.demandRate??0,waiting:f?.waiting??0,blocked:f?.blocked??0,moving:f?.moving??0,
  completed:f?.completed??0,dropped:f?.dropped??0,cancelled:f?.cancelled??0,clippedRate:f?.clippedRate??0,
  roads:f?.roads??0,congestedLinks:f?.congestedLinks??0,loadByCell:f?.loadByCell??[],modal:f?.modal??null,failure:this.failure,worker,timing:{...this.timing}};}
 /** Cumulative completed taxi trips on the latest frame (resets with the game). */
 taxiTrips():{trips:number;tiles:number} {return this.latest?.taxiTrips??{trips:0,tiles:0};}
 /** Taxi cars already tagged on the latest frame. Null when the taxi flag is off. Bus does not use this. */
 taxiFleet(): {cars: TrafficGameFrame['cars']; groups: TrafficGameFrame['groups']} | null {
  if(!this.taxiOn||!this.latest)return null;
  return {cars:this.latest.cars.filter(c=>gameCarIsTaxi(c)),groups:this.latest.groups};
 }
}
