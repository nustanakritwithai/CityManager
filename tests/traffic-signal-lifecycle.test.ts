import test from 'node:test';import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';import {readFileSync} from 'node:fs';import ts from 'typescript';
import {createCity} from '../src/sim.ts';import {signalTopologyKey} from '../src/traffic/adaptive-signals.ts';
import type {TrafficGameInput,TrafficGameFrame} from '../src/traffic/game.ts';import type {GameWorkerInput,GameWorkerOutput} from '../src/traffic/game-worker-client.ts';
import type {SignalHead} from '../src/traffic/signal-display.ts';
registerHooks({load(url,context,next){if(url.endsWith('/scene-citizen-vehicles.ts')||url.endsWith('/traffic/layer.ts'))return {format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(new URL(url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText};return next(url,context);}});
const {TrafficLayer}=await import('../src/traffic/layer.ts');
class Port{
 queue:GameWorkerInput<TrafficGameInput>[]=[];listeners:Record<string,Function[]>={};
 postMessage(m:GameWorkerInput<TrafficGameInput>){this.queue.push(structuredClone(m));}addEventListener(type:string,fn:Function){(this.listeners[type]??=[]).push(fn);}terminate(){}
 emit(m:GameWorkerOutput<TrafficGameFrame>){for(const f of this.listeners.message??[])f({data:m});}
 frame(job=this.queue.shift()!){const map=job.sample.map;return {kind:'frame' as const,epoch:job.epoch,seq:job.seq,frame:{step:job.seq,offered:0,completed:0,dropped:0,cancelled:0,waiting:0,moving:0,blocked:0,clippedRate:0,demandRate:0,roads:5,congestedLinks:0,cars:[],groups:[],loadByCell:[],signals:{topology:signalTopologyKey(map),phases:[{node:300,approach:map.cells[299].road?299:null,state:map.cells[299].road?'green' as const:'all-red' as const}]}}};}
}
test('accepted signal lifecycle hides stale edits, fences epochs, freezes pause, follows OFF and destroys',()=>{
 const city=createCity(910);city.cells.forEach((c,i)=>{c.road=[300,299,301,276,324].includes(i);});let now=0;const ports:Port[]=[];
 const cars={sync:()=>{},setEnabled:()=>{},destroy:()=>{},diagnostics:{cars:0,drawBatches:0,trianglesPerCar:24,capacity:0}};
 let heads:readonly SignalHead[]=[],enabled=true,destroyed=false;const signals={sync:(v:readonly SignalHead[])=>{heads=structuredClone(v);},setEnabled:(v:boolean)=>{enabled=v;},destroy:()=>{destroyed=true;heads=[];},get diagnostics(){return {heads:heads.length,batches:0,materials:0};}};
 const layer=new TrafficLayer({} as never,()=>true,()=>{},()=>{const p=new Port();ports.push(p);return p as never;},cars as never,undefined,()=>now,signals);
 layer.frame(city,0,false,.025);assert.equal(heads.length,0);const first=ports[0].frame();ports[0].emit(first);assert.equal(heads.length,4);assert.equal(heads.filter(h=>h.state==='green').length,1);
 layer.frame(city,0,true,.025);const paused=ports[0].frame();ports[0].emit(paused);const frozen=structuredClone(heads);now+=60000;layer.frame(city,0,true,.025);assert.deepEqual(heads,frozen);
 layer.setVisible(false);assert.equal(enabled,false);layer.setVisible(true);assert.equal(enabled,true);
 layer.frame(city,0,false,.025);ports[0].emit(ports[0].frame());now+=1000;layer.frame(city,0,false,.025);const stale=ports[0].frame();city.cells[299].road=false;layer.afterMapEdit(city);assert.equal(heads.length,0);ports[0].emit(stale);assert.equal(heads.length,0,'matching epoch but old topology remains hidden');
 layer.frame(city,0,false,.025);ports[0].emit(ports[0].frame());assert.equal(heads.length,3);assert.ok(heads.every(h=>h.state==='red'));
 const next=structuredClone(city);layer.frame(next,0,true,.025);assert.equal(heads.length,0);ports[0].emit(first);assert.equal(heads.length,0,'retired worker cannot revive lights');ports[1].emit(ports[1].frame());assert.equal(heads.length,3);
 for(const f of ports[1].listeners.error??[])f();assert.equal(heads.length,0);assert.equal(enabled,false);layer.destroy();assert.equal(destroyed,true);
});
test('lost signal graphics cannot interrupt failure notification or remaining resource cleanup',()=>{
 const city=createCity(911);city.cells.forEach((c,i)=>{c.road=[300,299,301,276,324].includes(i);});const port=new Port();let broken=false,hidden=false,carDestroyed=false,failures=0,signalDestroyCalls=0;
 const cars={sync:()=>{},setEnabled:(v:boolean)=>{if(!v)hidden=true;},destroy:()=>{carDestroyed=true;},diagnostics:{cars:0,drawBatches:0,trianglesPerCar:24,capacity:0}};
 const signals={sync:()=>{if(broken)throw Error('lost signal buffer');},setEnabled:()=>{if(broken)throw Error('lost signal root');},destroy:()=>{signalDestroyCalls++;throw Error('lost signal resource');},diagnostics:{heads:0,batches:0,materials:0}};
 const layer=new TrafficLayer({} as never,()=>true,()=>{failures++;},()=>port as never,cars as never,undefined,()=>0,signals);layer.frame(city,0,false,.025);broken=true;
 assert.doesNotThrow(()=>port.emit(port.frame()));assert.equal(failures,1);assert.equal(hidden,true);assert.match(layer.diagnostics.failure!,/display failed/);assert.equal(layer.diagnostics.signals.heads.length,0);
 assert.doesNotThrow(()=>layer.destroy());assert.equal(carDestroyed,true);assert.equal(signalDestroyCalls,1);
});
