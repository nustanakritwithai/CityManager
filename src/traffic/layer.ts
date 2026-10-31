import type {AppBase} from 'playcanvas';
import type {City} from '../sim.ts';
import {SceneCitizenVehicles} from '../scene-citizen-vehicles.ts';
import {taxiEnabled} from '../taxi/buildings.ts';
import type {CitizenVehiclePose} from '../citizen-vehicle-poses.ts';
import {captureTrafficGameInput,gameCarIsTaxi,type TrafficGameInput,type TrafficGameFrame} from './game.ts';
import {gamePoses,blendGamePoses} from './game-poses.ts';
import {createTrafficGameClient} from './game-worker-client.ts';
import {BusGameBridge} from '../bus/game-bridge.ts';
import {busPoses} from '../bus/poses.ts';
import {busEnabled} from '../bus/types.ts';
import {separateCarsFromBuses} from './spacing.ts';
export {trafficModelEnabled} from './flag.ts';

/** Ephemeral traffic-allocation game, independent of economic time and saves.
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
 private readonly cars:Pick<SceneCitizenVehicles,'sync'|'setEnabled'|'destroy'|'diagnostics'>;
 private client:ReturnType<typeof createTrafficGameClient<TrafficGameInput,TrafficGameFrame>>|null=null;
 private city:City|null=null;private latest:TrafficGameFrame|null=null;
 private previous:CitizenVehiclePose[]=[];private target:CitizenVehiclePose[]=[];private drawn:CitizenVehiclePose[]=[];
 private timing={samples:0,lastCaptureSubmitMs:0,maxCaptureSubmitMs:0,frames:0,lastFrameMs:0,maxFrameMs:0,projections:0,lastProjectionMs:0,maxProjectionMs:0};
 private anchor:number|null=null;private phase=1;private paused=true;private visible=true;private dirty=false;private renderDirty=true;private failure:string|null=null;
 constructor(private readonly app:AppBase,_onScreen:(cell:number)=>boolean=()=>true,private readonly onFailure:(message:string)=>void=()=>{},
   private readonly makeWorker:()=>Worker=()=>new Worker(new URL('./game-worker-entry.ts',import.meta.url),{type:'module'}),
   scene?:Pick<SceneCitizenVehicles,'sync'|'setEnabled'|'destroy'|'diagnostics'>,private readonly taxiOn=taxiEnabled(),private readonly now:()=>number=()=>performance.now()){this.cars=scene??new SceneCitizenVehicles(app);}
 private fail(error:unknown):void {
  this.failure=error instanceof Error?error.message:String(error);try{this.client?.dispose();}catch{/* isolated visual feature */}
  try{this.cars.setEnabled(false);}catch{/* graphics may be unavailable */}try{this.onFailure(this.failure);}catch{/* never disrupt city simulation */}
 }
 private reset(city:City):void {
  this.timing={samples:0,lastCaptureSubmitMs:0,maxCaptureSubmitMs:0,frames:0,lastFrameMs:0,maxFrameMs:0,projections:0,lastProjectionMs:0,maxProjectionMs:0};
  this.client?.dispose();this.client=null;this.city=city;this.latest=null;this.previous=[];this.target=[];this.drawn=[];this.anchor=null;this.phase=1;this.dirty=false;this.renderDirty=true;this.failure=null;this.cars.setEnabled(this.visible);this.cars.sync([]);
  this.bus=null;this.minute=7*60; // rebuilt in frame() on the fresh bus clock
  try {
   const worker=this.makeWorker(),epoch=crypto.randomUUID();
   this.client=createTrafficGameClient<TrafficGameInput,TrafficGameFrame>(worker,epoch,{onFrame:frame=>{
    const start=performance.now();this.latest=frame;try{this.bus?.onFrame(frame.bus,this.minute);}catch(error){this.fail(error);}this.previous=this.drawn;this.target=gamePoses(frame.cars,frame.groups);this.phase=0;this.renderDirty=true;
    const ms=performance.now()-start;this.timing.projections++;this.timing.lastProjectionMs=ms;this.timing.maxProjectionMs=Math.max(this.timing.maxProjectionMs,ms);
   },onFailure:message=>this.fail(message)});
   this.submit(city,false,this.paused);
  } catch(error){this.fail(error);}
 }
 private submit(city:City,advance:boolean,paused:boolean):void {
  const start=performance.now();const input=captureTrafficGameInput(city,{taxiEnabled:this.taxiOn});if(this.bus)input.bus=this.bus.input();this.client?.submit(input,{advance,paused});
  const ms=performance.now()-start;this.timing.samples++;this.timing.lastCaptureSubmitMs=ms;this.timing.maxCaptureSubmitMs=Math.max(this.timing.maxCaptureSubmitMs,ms);
 }
 /** Every city replacement starts a fresh game epoch; nothing is read from or
  * written to the player's save. Map edits replace the current sample. */
 afterMapEdit(city:City,paused=this.paused):void {
  try{if(city!==this.city){this.paused=paused;this.reset(city);return;}this.dirty=true;}catch(error){this.fail(error);}
 }
 setVisible(visible:boolean):void {if(this.visible===visible)return;this.visible=visible;this.renderDirty=true;try{this.cars.setEnabled(visible&&!this.failure);}catch(error){this.fail(error);}}
 /** Visibility can change when the renderer is not receiving frames. Fence an
  * in-flight step immediately on hide and reset wall-time on both transitions. */
 pageVisibilityChanged(hidden:boolean):void {
  this.anchor=null;
  if(hidden&&this.city&&this.client&&!this.failure){this.paused=true;try{this.submit(this.city,false,true);}catch(error){this.fail(error);}}
 }
 frame(city:City,_minuteOfDay:number,paused:boolean,dt:number):void {
  const frameStart=performance.now();
  try{if(city!==this.city){this.paused=paused;this.reset(city);}
  const pauseChanged=paused!==this.paused;this.paused=paused;let advance=false;
  if(paused){this.anchor=null;}
  else if(this.client&&!this.failure){
   // PlayCanvas caps dt under low FPS. Use monotonic wall time for this cosmetic
   // game only, and drop excess elapsed time rather than bursting on return.
   const now=this.now();if(!Number.isFinite(now))throw Error('Invalid traffic clock');
   if(this.anchor===null||now<this.anchor)this.anchor=now;
   else if(now-this.anchor>=1000){this.anchor=now;const worker=this.client.status;advance=!worker.inflight&&!worker.pending;}
   this.phase=Math.min(1,this.phase+Math.min(.25,Math.max(0,dt)));
  }
  if(this.busOn&&!this.bus&&!this.failure)this.bus=new BusGameBridge(city,this.minute);
  if(this.bus&&!paused&&!this.failure){this.minute+=Math.min(.25,Math.max(0,dt))/60;this.bus.tick(this.minute);}
  if((advance||pauseChanged||this.dirty)&&this.client&&!this.failure){this.dirty=false;this.submit(city,advance,paused);}
  if(this.visible&&!this.failure&&(this.renderDirty||(!paused&&this.phase<1))){this.drawn=this.clearOfBuses(blendGamePoses(this.previous,this.target,this.phase));this.cars.sync(this.drawn);this.renderDirty=false;}
  }catch(error){this.fail(error);}finally{const ms=performance.now()-frameStart;this.timing.frames++;this.timing.lastFrameMs=ms;this.timing.maxFrameMs=Math.max(this.timing.maxFrameMs,ms);}
 }
 /** Buses keep their stop pose. Cars slide back along the lane until the bodies no longer intersect. */
 private clearOfBuses(poses:CitizenVehiclePose[]):CitizenVehiclePose[] {
  if(!this.bus||!this.city||!poses.length)return poses;
  try {
   const buses=busPoses(this.bus.engine.snapshot(this.minute),{stops:this.city.bus?.stops??[]});
   return buses.length?separateCarsFromBuses(poses,buses):poses;
  } catch { return poses; }
 }
 destroy():void {try{this.client?.dispose();}catch{/* best effort */}this.client=null;try{this.cars.destroy();}catch{/* visual cleanup must not affect city */}}
 get diagnostics(){const f=this.latest,worker=this.client?.status??null;return {...this.cars.diagnostics,mode:'allocation-game' as const,paused:this.paused,
  ready:f!==null,updating:f===null||!!worker?.inflight||!!worker?.pending,step:f?.step??0,demandRate:f?.demandRate??0,waiting:f?.waiting??0,blocked:f?.blocked??0,moving:f?.moving??0,
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
