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
