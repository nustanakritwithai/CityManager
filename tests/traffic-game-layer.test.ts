import test from 'node:test';import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';import {readFileSync} from 'node:fs';import ts from 'typescript';
import {createCity,deserialize,serialize,step} from '../src/sim.ts';
import {createParkRuntime,serializeParkSession} from '../src/park-runtime.ts';
import {createTrafficGameWorkerEngine} from '../src/traffic/game-worker-engine.ts';
import type {GameWorkerInput,GameWorkerOutput} from '../src/traffic/game-worker-client.ts';
import type {TrafficGameInput,TrafficGameFrame} from '../src/traffic/game.ts';
registerHooks({load(url,context,next){if(url.endsWith('/scene-citizen-vehicles.ts')||url.endsWith('/traffic/layer.ts'))return {format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(new URL(url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText};return next(url,context);}});
const {TrafficLayer}=await import('../src/traffic/layer.ts');
class FakeWorker {
 engine=createTrafficGameWorkerEngine();queue:GameWorkerInput<TrafficGameInput>[]=[];listeners:Record<string,Function[]>={};terminated=false;
 postMessage(m:GameWorkerInput<TrafficGameInput>){this.queue.push(structuredClone(m));}
 addEventListener(type:string,fn:Function){(this.listeners[type]??=[]).push(fn);}
 terminate(){this.terminated=true;}
 emit(m:GameWorkerOutput<TrafficGameFrame>){for(const fn of this.listeners.message??[])fn({data:m});}
 flush(){while(this.queue.length)this.emit(this.engine(this.queue.shift()!));}
}
test('game layer is save-neutral, pauses, and fences old city workers',()=>{
 const city=createCity(61025),before=serialize(city),workers:FakeWorker[]=[],draws:unknown[]=[],faults:string[]= [];let now=0;
 const scene={sync:(p:unknown)=>draws.push(structuredClone(p)),setEnabled:()=>{},destroy:()=>{},diagnostics:{cars:0,drawBatches:0,trianglesPerCar:24,capacity:0}};
 const layer=new TrafficLayer({} as never,()=>true,m=>faults.push(m),()=>{const w=new FakeWorker();workers.push(w);return w as never;},scene as never,undefined,()=>now);
 layer.frame(city,0,false,.25);workers[0].flush();for(let i=0;i<4;i++){now+=250;layer.frame(city,0,false,.25);}workers[0].flush();
 assert.equal(layer.diagnostics.mode,'allocation-game');assert.ok(layer.diagnostics.step>=1);assert.equal(serialize(city),before);
 const timing=layer.diagnostics.timing;assert.ok(timing.samples>=2&&timing.frames>=5&&timing.projections>=2);assert.ok(timing.maxCaptureSubmitMs>=timing.lastCaptureSubmitMs&&timing.maxFrameMs>=timing.lastFrameMs&&timing.maxProjectionMs>=timing.lastProjectionMs);
 layer.frame(city,0,true,.25);workers[0].flush();layer.frame(city,0,true,.25);const paused=layer.diagnostics.step;
 for(let i=0;i<8;i++)layer.frame(city,0,true,.25);workers[0].flush();assert.equal(layer.diagnostics.step,paused);
 const next=createCity(123);layer.frame(next,0,true,.1);assert.equal(workers[0].terminated,true);workers[1].flush();assert.equal(layer.diagnostics.step,0);assert.equal(layer.diagnostics.timing.samples,1);assert.equal(layer.diagnostics.timing.frames,1);assert.deepEqual(faults,[]);assert.ok(draws.length>0);
 layer.destroy();assert.equal(workers[1].terminated,true);
});
test('worker construction failure falls back without throwing into city simulation',()=>{
 const city=createCity(7),before=serialize(city),faults:string[]=[];
 const scene={sync:()=>{},setEnabled:()=>{},destroy:()=>{},diagnostics:{cars:0,drawBatches:0,trianglesPerCar:24,capacity:0}};
 const layer=new TrafficLayer({} as never,()=>true,m=>faults.push(m),()=>{throw Error('worker unavailable');},scene as never);
 assert.doesNotThrow(()=>layer.frame(city,0,false,.25));assert.match(layer.diagnostics.failure!,/worker unavailable/);assert.equal(faults.length,1);assert.equal(serialize(city),before);layer.destroy();
});

test('running the ephemeral game does not change city, park save or economic replay',()=>{
 const city=createCity(61025),baseline=deserialize(serialize(city)),runtime=createParkRuntime(city),workers:FakeWorker[]=[];
 const scene={sync:()=>{},setEnabled:()=>{},destroy:()=>{},diagnostics:{cars:0,drawBatches:0,trianglesPerCar:24,capacity:0}};
 const layer=new TrafficLayer({} as never,()=>true,()=>{},()=>{const w=new FakeWorker();workers.push(w);return w as never;},scene as never);
 const raw=serializeParkSession(city,runtime);layer.frame(city,0,false,.25);workers[0].flush();
 for(let i=0;i<8;i++){layer.frame(city,0,false,.25);workers[0].flush();}assert.equal(serializeParkSession(city,runtime),raw);
 for(let day=0;day<3;day++){step(city);step(baseline);layer.frame(city,0,false,.25);workers[0].flush();assert.equal(serialize(city),serialize(baseline));}
 layer.destroy();
});
test('visual hide does not disable model or mutate its city',()=>{
 const city=createCity(9),before=serialize(city),workers:FakeWorker[]=[],visible:boolean[]=[];let now=0;
 const scene={sync:()=>{},setEnabled:(v:boolean)=>visible.push(v),destroy:()=>{},diagnostics:{cars:0,drawBatches:0,trianglesPerCar:24,capacity:0}};
 const layer=new TrafficLayer({} as never,()=>true,()=>{},()=>{const w=new FakeWorker();workers.push(w);return w as never;},scene as never,undefined,()=>now);
 layer.frame(city,0,false,.25);workers[0].flush();layer.setVisible(false);for(let i=0;i<4;i++){now+=250;layer.frame(city,0,false,.25);}workers[0].flush();
 assert.equal(visible.at(-1),false);assert.ok(layer.diagnostics.step>0);assert.equal(serialize(city),before);layer.setVisible(true);assert.equal(visible.at(-1),true);layer.destroy();
});
test('dormant taxi preference never applies existing depots; explicit ON includes them without changing save',async()=>{
 const {buildTaxiDepot,taxiSiteReason}=await import('../src/taxi/placement.ts');const city=createCity(61025),site=city.cells.findIndex((_,i)=>taxiSiteReason(city,i,true)===null);assert.ok(site>=0);assert.equal(buildTaxiDepot(city,site,true).ok,true);
 const saved=serialize(city),runtime=createParkRuntime(city),session=serializeParkSession(city,runtime),scene={sync:()=>{},setEnabled:()=>{},destroy:()=>{},diagnostics:{cars:0,drawBatches:0,trianglesPerCar:24,capacity:0}};
 for(const enabled of [false,true]){const worker=new FakeWorker(),layer=new TrafficLayer({} as never,()=>true,()=>{},()=>worker as never,scene as never,enabled);layer.frame(city,0,false,.01);
  assert.equal(worker.queue[0].sample.taxis?.length,enabled?1:0);worker.flush();assert.equal(layer.diagnostics.modal===null,!enabled);assert.equal(serialize(city),saved);assert.equal(serializeParkSession(city,runtime),session);layer.destroy();}
});

test('wall cadence is independent of capped dt, skips gaps and resets on pause/hidden and city change',()=>{
 let now=0;const workers:FakeWorker[]=[],city=createCity(42),other=createCity(43),scene={sync:()=>{},setEnabled:()=>{},destroy:()=>{},diagnostics:{cars:0,drawBatches:0,trianglesPerCar:24,capacity:0}};
 const layer=new TrafficLayer({} as never,()=>true,()=>{},()=>{const w=new FakeWorker();workers.push(w);return w as never;},scene as never,undefined,()=>now);
 const frame=(c:typeof city,pause:boolean,ms:number,dt=.1)=>{now+=ms;layer.frame(c,0,pause,dt);};
 frame(city,false,0);assert.equal(layer.diagnostics.ready,false);assert.equal(layer.diagnostics.updating,true);workers[0].flush();assert.equal(layer.diagnostics.ready,true);
 // 2 FPS while PlayCanvas dt is capped at .1: one real second still advances once.
 frame(city,false,500);workers[0].flush();assert.equal(layer.diagnostics.step,0);frame(city,false,500);workers[0].flush();assert.equal(layer.diagnostics.step,1);
 // A long stall produces one step, never a burst of catch-up frames.
 frame(city,false,10_000);workers[0].flush();assert.equal(layer.diagnostics.step,2);for(let i=0;i<10;i++){frame(city,false,16);workers[0].flush();}assert.equal(layer.diagnostics.step,2);
 // paused=true also represents document.hidden at the host boundary.
 frame(city,true,0);workers[0].flush();frame(city,true,60_000);workers[0].flush();frame(city,false,0);workers[0].flush();assert.equal(layer.diagnostics.step,2);
 frame(city,false,999);workers[0].flush();assert.equal(layer.diagnostics.step,2);frame(city,false,1);workers[0].flush();assert.equal(layer.diagnostics.step,3);
 frame(other,false,10_000);workers[1].flush();assert.equal(layer.diagnostics.step,0);frame(other,false,999);workers[1].flush();assert.equal(layer.diagnostics.step,0);frame(other,false,1);workers[1].flush();assert.equal(layer.diagnostics.step,1);layer.destroy();
});

test('a consistently slow worker publishes progress instead of being starved by fresh cadence ticks',()=>{
 let now=0;const city=createCity(52),workers:FakeWorker[]=[],scene={sync:()=>{},setEnabled:()=>{},destroy:()=>{},diagnostics:{cars:0,drawBatches:0,trianglesPerCar:24,capacity:0}};
 const layer=new TrafficLayer({} as never,()=>true,()=>{},()=>{const w=new FakeWorker();workers.push(w);return w as never;},scene as never,undefined,()=>now);
 layer.frame(city,0,false,.1);const w=workers[0];assert.equal(w.queue.length,1);
 for(let i=0;i<5;i++){now+=1000;layer.frame(city,0,false,.1);}assert.equal(w.queue.length,1);assert.equal(layer.diagnostics.worker?.pending,false);
 w.flush();assert.equal(layer.diagnostics.ready,true);assert.equal(layer.diagnostics.step,0);
 for(let cycle=0;cycle<3;cycle++){now+=1000;layer.frame(city,0,false,.1);assert.equal(w.queue.length,1);for(let i=0;i<3;i++){now+=1000;layer.frame(city,0,false,.1);}assert.equal(w.queue.length,1);assert.equal(layer.diagnostics.worker?.pending,false);w.flush();assert.equal(layer.diagnostics.step,cycle+1);}
 layer.destroy();
});

test('visibility events fence an in-flight step and reset cadence even when no hidden frames run',()=>{
 let now=0;const city=createCity(56),workers:FakeWorker[]=[],scene={sync:()=>{},setEnabled:()=>{},destroy:()=>{},diagnostics:{cars:0,drawBatches:0,trianglesPerCar:24,capacity:0}};
 const layer=new TrafficLayer({} as never,()=>true,()=>{},()=>{const w=new FakeWorker();workers.push(w);return w as never;},scene as never,undefined,()=>now);
 layer.frame(city,0,false,.1);const w=workers[0];w.flush();now=1000;layer.frame(city,0,false,.1);assert.equal(w.queue.length,1);
 layer.pageVisibilityChanged(true);w.flush();assert.equal(layer.diagnostics.step,0,'late in-flight advance is discarded on hide');
 now=60_000;layer.pageVisibilityChanged(false);layer.frame(city,0,false,.1);w.flush();assert.equal(layer.diagnostics.step,0,'resume does not catch up hidden time');
 now+=999;layer.frame(city,0,false,.1);w.flush();assert.equal(layer.diagnostics.step,0);now++;layer.frame(city,0,false,.1);w.flush();assert.equal(layer.diagnostics.step,1);layer.destroy();
});

test('rapid hide/show and ordinary pause/unpause cannot commit a pre-pause in-flight step',()=>{
 let now=0;const city=createCity(57),workers:FakeWorker[]=[],scene={sync:()=>{},setEnabled:()=>{},destroy:()=>{},diagnostics:{cars:0,drawBatches:0,trianglesPerCar:24,capacity:0}};
 const layer=new TrafficLayer({} as never,()=>true,()=>{},()=>{const w=new FakeWorker();workers.push(w);return w as never;},scene as never,undefined,()=>now);
 layer.frame(city,0,false,.1);const w=workers[0];w.flush();now=1000;layer.frame(city,0,false,.1);
 layer.pageVisibilityChanged(true);now=1010;layer.pageVisibilityChanged(false);layer.frame(city,0,false,.1);w.flush();assert.equal(layer.diagnostics.step,0,'hide fence survives a newer visible sample');
 now=2010;layer.frame(city,0,false,.1);layer.frame(city,0,true,.1);layer.frame(city,0,false,.1);w.flush();assert.equal(layer.diagnostics.step,0,'ordinary pause fence survives a newer unpaused sample');
 now=3010;layer.frame(city,0,false,.1);w.flush();assert.equal(layer.diagnostics.step,1,'future steps can proceed after the fence');layer.destroy();
});

test('equal wall time yields equal game steps for finely and coarsely chunked capped frame dt',()=>{
 const run=(chunk:number)=>{let now=0;const city=createCity(61),worker=new FakeWorker(),scene={sync:()=>{},setEnabled:()=>{},destroy:()=>{},diagnostics:{cars:0,drawBatches:0,trianglesPerCar:24,capacity:0}};
  const layer=new TrafficLayer({} as never,()=>true,()=>{},()=>worker as never,scene as never,undefined,()=>now);layer.frame(city,0,false,.1);worker.flush();
  while(now<3000){now+=chunk;layer.frame(city,0,false,.1);worker.flush();}const step=layer.diagnostics.step;layer.destroy();return step;};
 assert.equal(run(100),3);assert.equal(run(500),3);assert.equal(run(1000),3);
});

test('real bus bridge and visible-car presenter share movement permission without save writes',async()=>{
 const {busPoses}=await import('../src/bus/poses.ts');
 const city=deserialize(readFileSync(new URL('./fixtures/save-smoke/bus-optional-day60.json',import.meta.url),'utf8')),before=serialize(city),worker=new FakeWorker();let now=0,moved=false,visibleCars=0;
 const scene={sync:()=>{},setEnabled:()=>{},destroy:()=>{},diagnostics:{cars:0,drawBatches:0,trianglesPerCar:24,capacity:0}};
 const layer=new TrafficLayer({} as never,()=>true,()=>{},()=>worker as never,scene as never,undefined,()=>now);
 const box=(p:{x:number;z:number;headingX:number;headingZ:number},length:number,width:number)=>{const x=(Math.abs(p.headingX)*length+Math.abs(p.headingZ)*width)/2,z=(Math.abs(p.headingZ)*length+Math.abs(p.headingX)*width)/2;return {left:p.x-x,right:p.x+x,top:p.z-z,bottom:p.z+z};};
 let firstBus:string|undefined;
 for(let i=0;i<1600;i++){
  now+=25;layer.frame(city,0,false,.025);worker.flush();assert.equal(layer.diagnostics.failure,null);
  const cars=layer.diagnostics.presentation.renderedPoses,buses=busPoses(layer.bus!.engine.snapshot().filter(b=>b.phase!=='home'),{stops:city.bus!.stops});visibleCars=Math.max(visibleCars,cars.length);
  const current=JSON.stringify(buses.map(b=>[b.x,b.z]));if(firstBus&&current!==firstBus&&buses.length)moved=true;if(buses.length&&!firstBus)firstBus=current;
  for(const car of cars)for(const bus of buses){const a=box(car,.42,.3),b=box(bus,bus.length,bus.width);assert.ok(!(a.left<b.right-1e-7&&b.left<a.right-1e-7&&a.top<b.bottom-1e-7&&b.top<a.bottom-1e-7),'committed bus cannot intrude visible car');}
 }
 assert.ok(moved);assert.ok(visibleCars>0);assert.ok(layer.diagnostics.presentation.busGranted>0);assert.equal(layer.diagnostics.presentation.busIntrusions,0);assert.equal(layer.bus!.ledger().engineError,0);assert.equal(layer.diagnostics.busLedger?.engineError,0);assert.ok(layer.diagnostics.busMovement!.committedDrive>0);assert.equal(layer.diagnostics.busMinute,layer.bus!.engine.now);assert.equal(serialize(city),before);
 const paused=layer.diagnostics.presentation.renderedPoses,busPaused=layer.bus!.engine.snapshot();layer.frame(city,0,true,.25);worker.flush();assert.deepEqual(layer.diagnostics.presentation.renderedPoses,paused);assert.deepEqual(layer.bus!.engine.snapshot(),busPaused);
 layer.setVisible(false);layer.frame(city,0,false,.025);assert.equal(layer.diagnostics.failure,null);layer.destroy();
});

test('busy bus completes its first corner and reaches the stop after natural car hold and resume',async()=>{
 const {busPoses}=await import('../src/bus/poses.ts');
 const {trafficGapBusyFixture}=await import('./traffic-gap-fixture.ts');const {deserializeParkSession}=await import('../src/park-runtime.ts');
 const city=deserializeParkSession(trafficGapBusyFixture()).city,before=serialize(city),worker=new FakeWorker();let now=0,moved=false,visibleCars=0;
 const scene={sync:()=>{},setEnabled:()=>{},destroy:()=>{},diagnostics:{cars:0,drawBatches:0,trianglesPerCar:24,capacity:0}};
 const layer=new TrafficLayer({} as never,()=>true,()=>{},()=>worker as never,scene as never,undefined,()=>now);
 const box=(p:{x:number;z:number;headingX:number;headingZ:number},length:number,width:number)=>{const x=(Math.abs(p.headingX)*length+Math.abs(p.headingZ)*width)/2,z=(Math.abs(p.headingZ)*length+Math.abs(p.headingX)*width)/2;return {left:p.x-x,right:p.x+x,top:p.z-z,bottom:p.z+z};};
 let previousIds=new Set<string>();const seenIds=new Set<string>();
 let firstBus:string|undefined,held=false,resumed=false,heldCommits=0,arrived=false,departed=false;
 // Physical first approach, mandatory 60s dwell, then actual kerb departure: no fake clock shortcut.
 for(let i=0;i<6400;i++){
  now+=25;layer.frame(city,0,false,.025);worker.flush();assert.equal(layer.diagnostics.failure,null);
  const stats=layer.diagnostics.busMovement!;if(!held&&stats.heldDrive+stats.heldTransition>0){held=true;heldCommits=stats.committedDrive;}if(held&&stats.committedDrive>heldCommits)resumed=true;if(layer.bus!.engine.snapshot().some(b=>b.phase==='dwelling'))arrived=true;if(arrived&&layer.bus!.engine.snapshot().some(b=>b.phase==='running'&&b.progress>0))departed=true;
  const cars=layer.diagnostics.presentation.renderedPoses,buses=busPoses(layer.bus!.engine.snapshot().filter(b=>b.phase!=='home'),{stops:city.bus!.stops});visibleCars=Math.max(visibleCars,cars.length);
  const currentIds=new Set(cars.map(c=>c.vehicleId));for(const id of previousIds)if(!currentIds.has(id))assert.ok(layer.diagnostics.presentation.lastRemoved.includes(id),'only real terminal retirement removes an admitted ID');for(const id of currentIds){if(!previousIds.has(id))assert.ok(!seenIds.has(id),'admitted ID never flashes out and reappears');seenIds.add(id);}previousIds=currentIds;
  for(let a=0;a<cars.length;a++)for(let b=a+1;b<cars.length;b++){const x=box(cars[a],.42,.3),y=box(cars[b],.42,.3);assert.ok(!(x.left-.09<y.right-1e-7&&y.left-.09<x.right-1e-7&&x.top-.09<y.bottom-1e-7&&y.top-.09<x.bottom-1e-7),'car body and standstill gap remain clear');}
  const current=JSON.stringify(buses.map(b=>[b.x,b.z]));if(firstBus&&current!==firstBus&&buses.length)moved=true;if(buses.length&&!firstBus)firstBus=current;
  for(const car of cars)for(const bus of buses){const a=box(car,.42,.3),b=box(bus,bus.length,bus.width);assert.ok(!(a.left<b.right-1e-7&&b.left<a.right-1e-7&&a.top<b.bottom-1e-7&&b.top<a.bottom-1e-7),'committed bus cannot intrude visible car');}
 }
 assert.ok(held,'natural busy scenario must exercise a bus hold');assert.ok(resumed,'held bus must resume real driving');assert.ok(departed,'bus must physically depart after its real dwell, not remain permanently merge-blocked');assert.ok(arrived,'bus must clear the second turn and reach actual first stop, not freeze after one resumed frame');assert.ok(moved);assert.ok(visibleCars>0);assert.ok(layer.diagnostics.presentation.busGranted>0);assert.equal(layer.diagnostics.presentation.busIntrusions,0);assert.equal(layer.bus!.ledger().engineError,0);assert.equal(layer.diagnostics.busLedger?.engineError,0);assert.ok(layer.diagnostics.busMovement!.committedDrive>0);assert.equal(layer.diagnostics.busMinute,layer.bus!.engine.now);assert.equal(serialize(city),before);
 const paused=layer.diagnostics.presentation.renderedPoses,busPaused=layer.bus!.engine.snapshot();layer.frame(city,0,true,.25);worker.flush();assert.deepEqual(layer.diagnostics.presentation.renderedPoses,paused);assert.deepEqual(layer.bus!.engine.snapshot(),busPaused);
 layer.setVisible(false);layer.frame(city,0,false,.025);assert.equal(layer.diagnostics.failure,null);layer.destroy();
});

for(const level of [1,2,3] as const)test(`dense 12-junction mixed traffic completes outbound, dwell and return with bus L${level}`,async()=>{
 const {busPoses}=await import('../src/bus/poses.ts');
 const {trafficRightOfWayFixture,trafficRightOfWayWitness}=await import('./traffic-right-of-way-fixture.ts');const {deserializeParkSession}=await import('../src/park-runtime.ts');
 const raw=trafficRightOfWayFixture(level);assert.ok(trafficRightOfWayWitness(raw).encounteredConflictNodes>4);
 const city=deserializeParkSession(raw).city,before=serialize(city),worker=new FakeWorker();let now=0,moved=false,visibleCars=0;
 const scene={sync:()=>{},setEnabled:()=>{},destroy:()=>{},diagnostics:{cars:0,drawBatches:0,trianglesPerCar:24,capacity:0}};
 const layer=new TrafficLayer({} as never,()=>true,()=>{},()=>worker as never,scene as never,undefined,()=>now);
 const box=(p:{x:number;z:number;headingX:number;headingZ:number},length:number,width:number)=>{const x=(Math.abs(p.headingX)*length+Math.abs(p.headingZ)*width)/2,z=(Math.abs(p.headingZ)*length+Math.abs(p.headingX)*width)/2;return {left:p.x-x,right:p.x+x,top:p.z-z,bottom:p.z+z};};
 let previousIds=new Set<string>();const seenIds=new Set<string>();
 let firstBus:string|undefined,held=false,resumed=false,heldCommits=0,arrived=false,departed=false;
 // Physical first approach, mandatory 60s dwell, then actual kerb departure: no fake clock shortcut.
 let stops:number[]=[];let previousStop:number|undefined;let minVisible=Infinity,maxDeferred=0;
 for(let i=0;i<36000;i++){
  now+=25;layer.frame(city,0,false,.025);worker.flush();assert.equal(layer.diagnostics.failure,null);
  const snapshot=layer.bus!.engine.snapshot()[0];if(snapshot?.phase==='dwelling'&&snapshot.cell!==previousStop){stops.push(snapshot.cell);previousStop=snapshot.cell;}if(snapshot?.phase!=='dwelling')previousStop=undefined;
  if(i>400)minVisible=Math.min(minVisible,layer.diagnostics.presentation.renderedIds.length);maxDeferred=Math.max(maxDeferred,layer.diagnostics.presentation.birthDeferredFrames);
  if(i===0){const [from,to]=city.bus!.stops;layer.bus!.engine.submit([{requestId:'dense-proof',purpose:'commute',from:from.cell,to:to.cell,persons:4,lineId:city.bus!.lines[0].id,fromStopId:from.id,toStopId:to.id,fareSatang:0}]);}
  const stats=layer.diagnostics.busMovement!;if(!held&&stats.heldDrive+stats.heldTransition>0){held=true;heldCommits=stats.committedDrive;}if(held&&stats.committedDrive>heldCommits)resumed=true;if(layer.bus!.engine.snapshot().some(b=>b.phase==='dwelling'))arrived=true;if(arrived&&layer.bus!.engine.snapshot().some(b=>b.phase==='running'&&b.progress>0))departed=true;
  const cars=layer.diagnostics.presentation.renderedPoses,buses=busPoses(layer.bus!.engine.snapshot().filter(b=>b.phase!=='home'),{stops:city.bus!.stops});visibleCars=Math.max(visibleCars,cars.length);for(const b of buses){assert.equal(b.level,level);assert.equal(b.capacity,[0,40,60,80][level]);assert.equal(b.length,[0,.78,1.02,1.32][level]);}
  const currentIds=new Set(cars.map(c=>c.vehicleId));for(const id of previousIds)if(!currentIds.has(id))assert.ok(layer.diagnostics.presentation.lastRemoved.includes(id),'only real terminal retirement removes an admitted ID');for(const id of currentIds){if(!previousIds.has(id))assert.ok(!seenIds.has(id),'admitted ID never flashes out and reappears');seenIds.add(id);}previousIds=currentIds;
  for(let a=0;a<cars.length;a++)for(let b=a+1;b<cars.length;b++){const x=box(cars[a],.42,.3),y=box(cars[b],.42,.3);assert.ok(!(x.left-.09<y.right-1e-7&&y.left-.09<x.right-1e-7&&x.top-.09<y.bottom-1e-7&&y.top-.09<x.bottom-1e-7),'car body and standstill gap remain clear');}
  const current=JSON.stringify(buses.map(b=>[b.x,b.z]));if(firstBus&&current!==firstBus&&buses.length)moved=true;if(buses.length&&!firstBus)firstBus=current;
  for(const car of cars)for(const bus of buses){const a=box(car,.42,.3),b=box(bus,bus.length,bus.width);assert.ok(!(a.left<b.right-1e-7&&b.left<a.right-1e-7&&a.top<b.bottom-1e-7&&b.top<a.bottom-1e-7),'committed bus cannot intrude visible car');}
 }
 assert.deepEqual(stops.slice(0,3),[255,341,255],'actual outward and return stop arrivals, with real dwell and no timeout relocation');
 assert.ok(layer.bus!.engine.totals.completed>=4,'submitted passengers reach the second stop');
 console.log(JSON.stringify({fixture:'dense-right-of-way',level,stops,minVisible,maxVisible:visibleCars,birthDeferredFrames:maxDeferred,maxDrainSeconds:layer.diagnostics.presentation.maxDrainSeconds,birthOpportunities:layer.diagnostics.presentation.birthOpportunities,ledger:layer.bus!.ledger(),movement:layer.diagnostics.busMovement}));
 assert.ok(held,'natural busy scenario must exercise a bus hold');assert.ok(resumed,'held bus must resume real driving');assert.ok(departed,'bus must physically depart after its real dwell, not remain permanently merge-blocked');assert.ok(arrived,'bus must clear the second turn and reach actual first stop, not freeze after one resumed frame');assert.ok(moved);assert.ok(visibleCars>0);assert.ok(layer.diagnostics.presentation.busGranted>0);assert.equal(layer.diagnostics.presentation.busIntrusions,0);assert.equal(layer.bus!.ledger().engineError,0);assert.equal(layer.diagnostics.busLedger?.engineError,0);assert.ok(layer.diagnostics.busMovement!.committedDrive>0);assert.equal(layer.diagnostics.busMinute,layer.bus!.engine.now);assert.equal(serialize(city),before);
 const paused=layer.diagnostics.presentation.renderedPoses,busPaused=layer.bus!.engine.snapshot();layer.frame(city,0,true,.25);worker.flush();assert.deepEqual(layer.diagnostics.presentation.renderedPoses,paused);assert.deepEqual(layer.bus!.engine.snapshot(),busPaused);
 layer.setVisible(false);layer.frame(city,0,false,.025);assert.equal(layer.diagnostics.failure,null);layer.destroy();
});


test('short browser approach holds and resumes under measured low render cadence without changing clocks',async()=>{
 const {trafficGapShortApproachFixture}=await import('./traffic-gap-fixture.ts');
 const {deserializeParkSession}=await import('../src/park-runtime.ts');const {busPoses}=await import('../src/bus/poses.ts');
 const {vehicleBox,boxesOverlap}=await import('../src/traffic/spacing.ts');
 const city=deserializeParkSession(trafficGapShortApproachFixture()).city,before=serialize(city),worker=new FakeWorker();let now=0;
 assert.equal(city.bus!.depots[0].cell,320);assert.deepEqual(city.bus!.stops.map(s=>s.cell),[274,295]);
 const scene={sync:()=>{},setEnabled:()=>{},destroy:()=>{},diagnostics:{cars:0,drawBatches:0,trianglesPerCar:24,capacity:0}};
 const layer=new TrafficLayer({} as never,()=>true,()=>{},()=>worker as never,scene as never,undefined,()=>now);
 let previous: {blocked:number;congested:number;held:number;bus:string}|undefined;
 let hold: {wall:number;committed:number;bus:string}|undefined,resume:number|undefined;
 let ids=new Set<string>();const seen=new Set<string>();
 // Actual CI measured 70 frames / 30.4 wall seconds; PlayCanvas caps dt at .1.
 // Wall scheduling and physical dt remain distinct, exactly as in production.
 for(let i=0;i<69;i++){
  now+=435;layer.frame(city,0,false,.1);worker.flush();const d=layer.diagnostics,m=d.busMovement!,snapshot=layer.bus!.engine.snapshot(),bus=JSON.stringify(snapshot);
  assert.equal(d.failure,null);const road=snapshot[0]?.phase==='toStart'||snapshot[0]?.phase==='running';
  if(!hold&&previous&&road&&m.committedDrive>0&&d.blocked>0&&d.congestedLinks>0&&previous.blocked>0&&previous.congested>0&&m.heldDrive>previous.held&&bus===previous.bus)hold={wall:now,committed:m.committedDrive,bus};
  if(hold&&!resume&&road&&d.blocked>0&&d.congestedLinks>0&&m.committedDrive>hold.committed&&bus!==hold.bus)resume=now;
  const cars=d.presentation.renderedPoses,buses=busPoses(snapshot.filter(b=>b.phase!=='home'),{stops:city.bus!.stops});
  const nextIds=new Set(cars.map(c=>c.vehicleId));for(const id of ids)if(!nextIds.has(id))assert.ok(d.presentation.lastRemoved.includes(id));for(const id of nextIds){if(!ids.has(id))assert.ok(!seen.has(id));seen.add(id);}ids=nextIds;
  for(let a=0;a<cars.length;a++)for(let b=a+1;b<cars.length;b++){const x=vehicleBox(cars[a],.42,.3),y=vehicleBox(cars[b],.42,.3);assert.equal(boxesOverlap({minX:x.minX-.09,maxX:x.maxX+.09,minZ:x.minZ-.09,maxZ:x.maxZ+.09},y,1e-7),false);}
  for(const car of cars)for(const b of buses)assert.equal(boxesOverlap(vehicleBox(car,.42,.3),vehicleBox(b,b.length,b.width),1e-7),false);
  assert.equal(d.busLedger!.engineError,0);assert.equal(d.presentation.busIntrusions,0);
  previous={blocked:d.blocked,congested:d.congestedLinks,held:m.heldDrive,bus};
 }
 assert.ok(hold,'previously driven bus must genuinely hold on congested road');assert.ok(resume&&resume<30000,'actual congested hold must resume within unchanged browser wall budget');assert.ok(seen.size>0);assert.equal(serialize(city),before);
 console.log(JSON.stringify({fixture:'short-browser-approach',heldWallMs:hold.wall,resumedWallMs:resume,physicalSeconds:(layer.bus!.engine.now-420)*60}));layer.destroy();
});
