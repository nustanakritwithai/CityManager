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
 const city=createCity(61025),before=serialize(city),workers:FakeWorker[]=[],draws:unknown[]=[],faults:string[]=[];
 const scene={sync:(p:unknown)=>draws.push(structuredClone(p)),setEnabled:()=>{},destroy:()=>{},diagnostics:{cars:0,drawBatches:0,trianglesPerCar:24,capacity:0}};
 const layer=new TrafficLayer({} as never,()=>true,m=>faults.push(m),()=>{const w=new FakeWorker();workers.push(w);return w as never;},scene as never);
 layer.frame(city,0,false,.25);workers[0].flush();for(let i=0;i<4;i++)layer.frame(city,0,false,.25);workers[0].flush();
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
 const city=createCity(9),before=serialize(city),workers:FakeWorker[]=[],visible:boolean[]=[];
 const scene={sync:()=>{},setEnabled:(v:boolean)=>visible.push(v),destroy:()=>{},diagnostics:{cars:0,drawBatches:0,trianglesPerCar:24,capacity:0}};
 const layer=new TrafficLayer({} as never,()=>true,()=>{},()=>{const w=new FakeWorker();workers.push(w);return w as never;},scene as never);
 layer.frame(city,0,false,.25);workers[0].flush();layer.setVisible(false);for(let i=0;i<4;i++)layer.frame(city,0,false,.25);workers[0].flush();
 assert.equal(visible.at(-1),false);assert.ok(layer.diagnostics.step>0);assert.equal(serialize(city),before);layer.setVisible(true);assert.equal(visible.at(-1),true);layer.destroy();
});
test('dormant taxi preference never applies existing depots; explicit ON includes them without changing save',async()=>{
 const {buildTaxiDepot,taxiSiteReason}=await import('../src/taxi/placement.ts');const city=createCity(61025),site=city.cells.findIndex((_,i)=>taxiSiteReason(city,i,true)===null);assert.ok(site>=0);assert.equal(buildTaxiDepot(city,site,true).ok,true);
 const saved=serialize(city),runtime=createParkRuntime(city),session=serializeParkSession(city,runtime),scene={sync:()=>{},setEnabled:()=>{},destroy:()=>{},diagnostics:{cars:0,drawBatches:0,trianglesPerCar:24,capacity:0}};
 for(const enabled of [false,true]){const worker=new FakeWorker(),layer=new TrafficLayer({} as never,()=>true,()=>{},()=>worker as never,scene as never,enabled);layer.frame(city,0,false,.01);
  assert.equal(worker.queue[0].sample.taxis?.length,enabled?1:0);worker.flush();assert.equal(layer.diagnostics.modal===null,!enabled);assert.equal(serialize(city),saved);assert.equal(serializeParkSession(city,runtime),session);layer.destroy();}
});
