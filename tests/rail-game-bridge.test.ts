import test from 'node:test';
import assert from 'node:assert/strict';
import {RailGameBridge} from '../src/rail/game-bridge.ts';
import {TrafficGame,type TrafficGameSample} from '../src/traffic/game.ts';
import type {RailNetworkRuntime} from '../src/rail/network-runtime.ts';
const map={cells:Array.from({length:576},(_,i)=>({road:i>=25&&i<=32}))};
const sample:TrafficGameSample={map,demand:[{from:25,to:32,rate:2}]};
function fixture(){
 const calls:any[]=[],bindings:string[]=[],links:{from:number;to:number;minutes:number}[]=[];
 for(let i=49;i<56;i++)links.push({from:i,to:i+1,minutes:1},{from:i+1,to:i,minutes:1});
 const state={cityId:'city',epoch:1,graph:{revision:1,links},stations:[{id:'a',cell:49},{id:'b',cell:56}],model:{accepting:true},service:{snapshot:{enabled:true,openStations:{a:true,b:true}}}};
 const runtime={get snapshot(){return structuredClone(state)},bindTrafficEpoch:(s:string)=>bindings.push(s),acceptTrafficDemand:(offer:any)=>{calls.push(offer);return {accepted:true,reason:'accepted'}}} as unknown as RailNetworkRuntime;
 const bridge=new RailGameBridge('worker-epoch',()=>runtime);
 return {bridge,calls,bindings,state};
}
test('only delivered held offers create one rail rider; result replay is idempotent',()=>{
 const {bridge,calls,bindings}=fixture(),game=new TrafficGame(sample),input=bridge.input()!;game.setRail(input);let frame=game.step();assert.equal(frame.rail!.offers.length,1);bridge.onFrame(frame.rail);bridge.onFrame(frame.rail);assert.equal(calls.length,1);assert.deepEqual(bindings,['worker-epoch']);
 const result=bridge.input()!;assert.deepEqual(result.results,[{id:1,accepted:true}]);game.setRail(result);frame=game.frame;assert.equal(frame.rail!.accepted,1);assert.equal(frame.rail!.offers.length,0);bridge.onFrame(frame.rail);assert.deepEqual(bridge.input()!.results,[]);
});
test('closure or changed infrastructure returns stale held offers, never fabricates riders',()=>{
 const {bridge,calls,state}=fixture(),game=new TrafficGame(sample);game.setRail(bridge.input()!);const frame=game.step();state.service.snapshot.enabled=false;bridge.onFrame(frame.rail);assert.equal(calls.length,0);assert.deepEqual(bridge.input()!.results,[{id:1,accepted:false}]);game.setRail(bridge.input()!);assert.equal(game.frame.rail!.held,0);assert.equal(game.frame.rail!.accepted,0);assert.equal(game.frame.offered,2);
});
test('infrastructure revisions cannot claim offers selected for an old service',()=>{
 const {bridge,calls,state}=fixture(),game=new TrafficGame(sample);game.setRail(bridge.input()!);const frame=game.step();state.graph.revision++;bridge.onFrame(frame.rail);assert.equal(calls.length,0);assert.equal(bridge.input()!.results[0].accepted,false);
});
test('coalesced worker candidates retain offers without creating riders until delivery',async()=>{
 const {createTrafficGameClient}=await import('../src/traffic/game-worker-client.ts');
 const {createTrafficGameWorkerEngine}=await import('../src/traffic/game-worker-engine.ts');
 const {bridge,calls}=fixture(),worker=createTrafficGameWorkerEngine(),queue:any[]=[],listeners:Record<string,Function[]>={},frames:any[]=[];
 const port={postMessage:(m:any)=>queue.push(structuredClone(m)),terminate:()=>{},addEventListener:(type:string,fn:Function)=>(listeners[type]??=[]).push(fn)};
 const flush=()=>{const reply=worker(queue.shift());for(const f of listeners.message??[])f({data:reply});};
 const client=createTrafficGameClient<any,any>(port as never,'worker-epoch',{onFrame:f=>{frames.push(f);bridge.onFrame(f.rail)},onFailure:m=>assert.fail(m)},1000);
 const data=()=>({map,homes:[{cell:25,amount:100}],destinations:[{cell:32,amount:100}],rail:bridge.input()});
 client.submit(data(),{advance:false,paused:false});flush();
 client.submit(data(),{advance:true,paused:false});client.submit(data(),{advance:true,paused:false});flush();assert.equal(calls.length,0,'coalesced frame is not accepted by host');flush();assert.ok(calls.length>0);assert.equal(new Set(calls.map(x=>x.sequence)).size,calls.length);
 client.submit(data(),{advance:false,paused:false});flush();assert.equal(frames.at(-1).rail.accepted,calls.length);assert.equal(frames.at(-1).rail.offers.length,0);client.dispose();
});
test('pause fencing discards undelivered reservations without creating passengers',async()=>{
 const {createTrafficGameClient}=await import('../src/traffic/game-worker-client.ts');
 const {createTrafficGameWorkerEngine}=await import('../src/traffic/game-worker-engine.ts');
 const {bridge,calls}=fixture(),worker=createTrafficGameWorkerEngine(),queue:any[]=[],listeners:Record<string,Function[]>={},frames:any[]=[];
 const port={postMessage:(m:any)=>queue.push(structuredClone(m)),terminate:()=>{},addEventListener:(type:string,fn:Function)=>(listeners[type]??=[]).push(fn)};
 const flush=()=>{const reply=worker(queue.shift());for(const f of listeners.message??[])f({data:reply});};
 const client=createTrafficGameClient<any,any>(port as never,'worker-epoch',{onFrame:f=>{frames.push(f);bridge.onFrame(f.rail)},onFailure:m=>assert.fail(m)},1000);
 const data=()=>({map,homes:[{cell:25,amount:100}],destinations:[{cell:32,amount:100}],rail:bridge.input()});
 client.submit(data(),{advance:false,paused:false});flush();client.submit(data(),{advance:true,paused:false});client.submit(data(),{advance:false,paused:true});flush();flush();assert.equal(calls.length,0);assert.equal(frames.at(-1).step,0);assert.equal(frames.at(-1).rail.held,0);client.dispose();
});
test('paused refresh preserves prior holds without adding rail riders until resume',()=>{
 const {bridge,calls}=fixture(),game=new TrafficGame(sample);game.setRail(bridge.input()!);const frame=game.step();bridge.onFrame(frame.rail,false);assert.equal(calls.length,0);assert.deepEqual(bridge.input()!.results,[]);bridge.onFrame(frame.rail,true);assert.equal(calls.length,1);bridge.onFrame(frame.rail,false);assert.deepEqual(bridge.input()!.results,[{id:1,accepted:true}]);
});
