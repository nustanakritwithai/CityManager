import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {createCity,serialize} from '../src/sim.ts';
import {fallbackMetrics} from './traffic-game-fallback-metrics.mjs';
registerHooks({load(url,context,next){if(url.endsWith('/scene-citizen-vehicles.ts')||url.endsWith('/traffic/layer.ts'))return {format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(new URL(url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText};return next(url,context);}});
const {TrafficLayer}=await import('../src/traffic/layer.ts');

test('maximum frame context separates reset, nested capture and runtime phases without changing the epoch maximum',()=>{
 const old=Object.getOwnPropertyDescriptor(performance,'now');let clock=0,postDelay=2,workerDelay=3,sceneDelay=1;
 Object.defineProperty(performance,'now',{configurable:true,value:()=>clock});
 const city=createCity(44),saved=serialize(city),scene={sync:()=>{clock+=sceneDelay;},setEnabled:()=>{},destroy:()=>{},diagnostics:{cars:0,drawBatches:0,trianglesPerCar:24,capacity:0}};
 const worker={postMessage:()=>{clock+=postDelay;},addEventListener:()=>{},terminate:()=>{}};
 const layer=new TrafficLayer({} as never,()=>true,()=>{},()=>{clock+=workerDelay;return worker as never;},scene as never,false,()=>0);
 try{
  layer.frame(city,0,true,.1);
  const first=layer.diagnostics.timing;
  assert.equal(first.maxFrameMs,7);
  assert.deepEqual(first.maxFrameDetails,{frame:1,frameMs:7,dt:.1,paused:true,cityChanged:true,resetMs:4,captureSubmitMs:2,busMs:0,presenterMs:0,reconcileMs:0,sceneMs:1,otherMs:0,interrupted:false});
  const internal=layer as any;internal.client.submit=()=>{clock+=postDelay;return true;};postDelay=0;sceneDelay=4;
  internal.busObstacles=()=>{clock+=1;return [];};
  internal.presenter.frame=()=>{clock+=3;return [];};
  internal.reconcileWorkTrips=()=>{clock+=2;return false;};
  layer.frame(city,0,false,.1);
  const timing=layer.diagnostics.timing;
  assert.deepEqual(timing.maxFrameDetails,{frame:2,frameMs:10,dt:.1,paused:false,cityChanged:false,resetMs:0,captureSubmitMs:0,busMs:1,presenterMs:3,reconcileMs:2,sceneMs:4,otherMs:0,interrupted:false});
  assert.equal(timing.maxFrameMs,10);
  assert.equal(typeof Object.getOwnPropertyDescriptor(timing,'maxFrameDetails')?.get,'function','Ordinary HUD access does not copy the detail record');
  timing.maxFrameDetails!.sceneMs=999;
  assert.equal(layer.diagnostics.timing.maxFrameDetails!.sceneMs,4,'Returned details are detached');
  sceneDelay=1;layer.frame(city,0,false,.1);
  assert.equal(layer.diagnostics.timing.lastFrameMs,7);
  assert.equal(layer.diagnostics.timing.maxFrameDetails!.frame,2,'A smaller frame retains the maximum context');
  sceneDelay=4;layer.frame(city,0,false,.1);
  assert.equal(layer.diagnostics.timing.maxFrameDetails!.frame,2,'A tied frame does not replace the maximum context');
  postDelay=2;internal.reconcileWorkTrips=()=>{clock+=2;return true;};
  layer.frame(city,0,false,.1);
  const nested=layer.diagnostics.timing.maxFrameDetails!;
  assert.equal(nested.frameMs,15);assert.equal(nested.captureSubmitMs,2);assert.equal(nested.reconcileMs,5);assert.equal(nested.otherMs,0);
  assert.equal(serialize(city),saved);
  const sample={count:20,p95:50,max:100,elapsedMs:12000,trailingMs:0,visibility:'visible'};
  assert.ok(fallbackMetrics(sample,sample,{...layer.diagnostics.timing,projections:1}).issues.some((s:string)=>s.includes('8 ms')),'The unchanged gate still rejects the full epoch maximum');
  workerDelay=1;postDelay=1;sceneDelay=0;internal.busObstacles=()=>[];internal.reconcileWorkTrips=()=>false;
  layer.frame(createCity(45),0,true,.1);
  assert.equal(layer.diagnostics.timing.frames,1);assert.equal(layer.diagnostics.timing.maxFrameMs,2);
  assert.equal(layer.diagnostics.timing.maxFrameDetails!.cityChanged,true);
  assert.equal(layer.diagnostics.timing.maxFrameDetails!.resetMs,1);
  assert.equal(layer.diagnostics.timing.maxFrameDetails!.captureSubmitMs,1);
  assert.equal(first.maxFrameDetails!.frameMs,7,'An earlier diagnostics snapshot remains stable');
 }finally{layer.destroy();if(old)Object.defineProperty(performance,'now',old);else delete (performance as any).now;}
});

test('interrupted phase includes partial cost while failure cleanup remains in the original whole-frame time',()=>{
 const old=Object.getOwnPropertyDescriptor(performance,'now');let clock=0,fail=false;
 Object.defineProperty(performance,'now',{configurable:true,value:()=>clock});
 const scene={sync:()=>{if(fail){clock+=9;throw Error('injected scene fault');}},setEnabled:()=>{if(fail)clock+=2;},destroy:()=>{},diagnostics:{cars:0,drawBatches:0,trianglesPerCar:24,capacity:0}};
 const worker={postMessage:()=>{},addEventListener:()=>{},terminate:()=>{}};
 const city=createCity(55),layer=new TrafficLayer({} as never,()=>true,()=>{},()=>worker as never,scene as never,false,()=>0);
 try{
  layer.frame(city,0,false,.1);fail=true;layer.frame(city,0,false,.1);
  const timing=layer.diagnostics.timing,record=timing.maxFrameDetails!;
  assert.equal(record.interrupted,true);assert.equal(record.sceneMs,9);assert.equal(record.otherMs,2);assert.equal(record.frameMs,11);assert.equal(timing.maxFrameMs,11);
  assert.match(layer.diagnostics.failure!,/injected scene fault/);
 }finally{layer.destroy();if(old)Object.defineProperty(performance,'now',old);else delete (performance as any).now;}
});

test('reset-contained worker failures retain partial capture attribution and mark interruption',()=>{
 const old=Object.getOwnPropertyDescriptor(performance,'now');let clock=0;
 Object.defineProperty(performance,'now',{configurable:true,value:()=>clock});
 try{for(const fault of ['construction','submission']){
  const scene={sync:()=>{},setEnabled:()=>{},destroy:()=>{},diagnostics:{cars:0,drawBatches:0,trianglesPerCar:24,capacity:0}};
  const worker={postMessage:()=>{clock+=9;throw Error('injected submission fault');},addEventListener:()=>{},terminate:()=>{}};
  const layer=new TrafficLayer({} as never,()=>true,()=>{},()=>{if(fault==='construction'){clock+=9;throw Error('injected construction fault');}return worker as never;},scene as never,false,()=>0);
  try{
   layer.frame(createCity(56),0,true,.1);const timing=layer.diagnostics.timing,detail=timing.maxFrameDetails!;
   assert.equal(timing.maxFrameMs,9);assert.equal(timing.samples,fault==='construction'?0:1,'Keep the existing client fault and successful-capture sample accounting');
   assert.equal(detail.interrupted,true);assert.equal(detail.captureSubmitMs,fault==='submission'?9:0);assert.equal(detail.resetMs,fault==='construction'?9:0);assert.equal(detail.otherMs,0);
   assert.match(layer.diagnostics.failure!,fault==='construction'?/injected/:/worker could not start/);
  }finally{layer.destroy();}
 }}finally{if(old)Object.defineProperty(performance,'now',old);else delete (performance as any).now;}
});

test('escaping submission error retains partial capture without adding a completed sample',()=>{
 const old=Object.getOwnPropertyDescriptor(performance,'now');let clock=0;
 Object.defineProperty(performance,'now',{configurable:true,value:()=>clock});
 const scene={sync:()=>{},setEnabled:()=>{},destroy:()=>{},diagnostics:{cars:0,drawBatches:0,trianglesPerCar:24,capacity:0}},worker={postMessage:()=>{},addEventListener:()=>{},terminate:()=>{}};
 const city=createCity(57),layer=new TrafficLayer({} as never,()=>true,()=>{},()=>worker as never,scene as never,false,()=>0);
 try{
  layer.frame(city,0,true,.1);const samples=layer.diagnostics.timing.samples;
  (layer as any).client.submit=()=>{clock+=9;throw Error('injected escaping submit');};
  layer.frame(city,0,false,.1);const timing=layer.diagnostics.timing,detail=timing.maxFrameDetails!;
  assert.equal(timing.samples,samples);assert.equal(timing.maxFrameMs,9);assert.equal(detail.captureSubmitMs,9);assert.equal(detail.otherMs,0);assert.equal(detail.interrupted,true);
 }finally{layer.destroy();if(old)Object.defineProperty(performance,'now',old);else delete (performance as any).now;}
});
