import test from 'node:test';
import assert from 'node:assert/strict';
import {createTrafficGameWorkerEngine} from '../src/traffic/game-worker-engine.ts';
import type {TrafficGameInput} from '../src/traffic/game.ts';
const sample=():TrafficGameInput=>({map:{cells:Array.from({length:576},(_,i)=>({road:[25,26,27,28].includes(i)}))},homes:[{cell:25,amount:100}],destinations:[{cell:28,amount:100}]});

test('pause racing an advance discards its candidate, while paused road edits do not move actors',()=>{
 const engine=createTrafficGameWorkerEngine(),s=sample(),call=(seq:number,advance:boolean,paused:boolean,commitPrevious:boolean,input=s)=>engine({kind:'compute',epoch:'x',seq,advance,paused,commitPrevious,sample:input});
 const init=call(1,false,true,false);assert.equal(init.kind,'frame');if(init.kind==='frame')assert.equal(init.frame.step,0);
 const advance=call(2,true,false,true);assert.equal(advance.kind,'frame');if(advance.kind==='frame')assert.equal(advance.frame.step,1);
 const cut=sample();cut.map.cells[27].road=false;const paused=call(3,false,true,false,cut);assert.equal(paused.kind,'frame');if(paused.kind==='frame'){assert.equal(paused.frame.step,0);assert.equal(paused.frame.moving,0);assert.equal(paused.frame.roads,3);}
 const pausedAgain=call(4,false,true,true,cut);assert.equal(pausedAgain.kind,'frame');if(pausedAgain.kind==='frame')assert.equal(pausedAgain.frame.step,0);
 const resumed=call(5,true,false,true,cut);assert.equal(resumed.kind,'frame');if(resumed.kind==='frame')assert.equal(resumed.frame.step,1);
});

test('frames are detached and epoch or sequence mistakes permanently fail the game worker',()=>{
 const engine=createTrafficGameWorkerEngine(),s=sample();const first=engine({kind:'compute',epoch:'x',seq:1,advance:true,paused:false,commitPrevious:false,sample:s});
 assert.equal(first.kind,'frame');if(first.kind==='frame'){first.frame.cars.length=0;first.frame.offered=123456;}
 const next=engine({kind:'compute',epoch:'x',seq:2,advance:false,paused:true,commitPrevious:true,sample:s});assert.equal(next.kind,'frame');if(next.kind==='frame')assert.notEqual(next.frame.offered,123456);
 assert.equal(engine({kind:'compute',epoch:'stale',seq:3,advance:false,paused:true,commitPrevious:true,sample:s}).kind,'error');
 assert.equal(engine({kind:'compute',epoch:'x',seq:4,advance:false,paused:true,commitPrevious:true,sample:s}).kind,'error');
});

test('actual client/engine interleaving rejects a late advancing frame at pause',async()=>{
 const {createTrafficGameClient}=await import('../src/traffic/game-worker-client.ts'),engine=createTrafficGameWorkerEngine(),queue:any[]=[],listeners:Record<string,Function[]>={},frames:number[]=[];
 const port={postMessage:(m:any)=>queue.push(structuredClone(m)),terminate:()=>{},addEventListener:(type:string,fn:Function)=>(listeners[type]??=[]).push(fn)};
 const flush=()=>{const reply=engine(queue.shift());for(const f of listeners.message??[])f({data:reply});};
 const client=createTrafficGameClient<TrafficGameInput,import('../src/traffic/game.ts').TrafficGameFrame>(port as never,'x',{onFrame:f=>frames.push(f.step),onFailure:m=>assert.fail(m)},1000);
 const s=sample();client.submit(s,{advance:false,paused:false});flush();assert.deepEqual(frames,[0]);
 client.submit(s,{advance:true,paused:false});const cut=sample();cut.map.cells[27].road=false;client.submit(cut,{advance:false,paused:true});
 flush();assert.deepEqual(frames,[0]);assert.equal(queue[0].commitPrevious,false);flush();assert.deepEqual(frames,[0,0]);client.dispose();
});

test('existing taxi depot changes only the simulated road demand and reports its own road load',()=>{
 const s=sample(),original=structuredClone(s),engine=createTrafficGameWorkerEngine();
 s.taxis=[{id:1,cell:49,level:1,open:true}];
 const reply=engine({kind:'compute',epoch:'taxi',seq:1,advance:false,paused:false,commitPrevious:false,sample:s});
 assert.equal(reply.kind,'frame');if(reply.kind!=='frame')return;
 assert.ok(reply.frame.modal);const m=reply.frame.modal!;
 assert.ok(m.taxiDiverted>0);assert.ok(m.taxiLoaded>0);assert.ok(m.taxiEmpty>0);assert.ok(m.roadAfter<m.roadBefore);
 assert.equal(reply.frame.clippedRate,m.clippedRate);assert.ok(Math.abs(reply.frame.demandRate-m.roadAfter)<1e-9);
 assert.deepEqual(s.map,original.map);assert.deepEqual(s.homes,original.homes);assert.deepEqual(s.destinations,original.destinations);
});

test('malformed taxi snapshot faults rather than silently applying a fabricated benefit',()=>{const input=sample() as TrafficGameInput & {taxis:unknown};input.taxis={} as never;const r=createTrafficGameWorkerEngine()({kind:'compute',epoch:'bad',seq:1,advance:false,paused:true,commitPrevious:false,sample:input});assert.equal(r.kind,'error');});

test('existing validated taxi depot is read-only across city save and reload',async()=>{
 const {createCity,serialize,deserialize}=await import('../src/sim.ts');
 const {createParkRuntime,serializeParkSession}=await import('../src/park-runtime.ts');
 const {buildTaxiDepot,taxiSiteReason}=await import('../src/taxi/placement.ts');
 const {captureTrafficGameInput}=await import('../src/traffic/game.ts');
 const city=createCity(61025),site=city.cells.findIndex((_,i)=>taxiSiteReason(city,i,true)===null);assert.ok(site>=0);
 assert.equal(buildTaxiDepot(city,site,true).ok,true);const runtime=createParkRuntime(city),beforeCity=serialize(city),beforeSession=serializeParkSession(city,runtime);
 const off=captureTrafficGameInput(city);assert.deepEqual(off.taxis,[]);const disabled=createTrafficGameWorkerEngine()({kind:'compute',epoch:'off',seq:1,advance:false,paused:false,commitPrevious:false,sample:off});assert.equal(disabled.kind,'frame');if(disabled.kind==='frame')assert.equal(disabled.frame.modal,null);
 const input=captureTrafficGameInput(city,{taxiEnabled:true});assert.equal(input.taxis?.length,1);
 const reply=createTrafficGameWorkerEngine()({kind:'compute',epoch:'read-only',seq:1,advance:false,paused:false,commitPrevious:false,sample:input});assert.equal(reply.kind,'frame');
 assert.equal(serialize(city),beforeCity);assert.equal(serializeParkSession(city,runtime),beforeSession);
 const restored=deserialize(beforeCity);assert.deepEqual(captureTrafficGameInput(restored,{taxiEnabled:true}).taxis,input.taxis);
});
