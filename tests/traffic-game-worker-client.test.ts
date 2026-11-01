import test from 'node:test';
import assert from 'node:assert/strict';
import {createTrafficGameClient,type GameWorkerInput,type GameWorkerOutput} from '../src/traffic/game-worker-client.ts';
class Port {
 commands:GameWorkerInput<{value:number}>[]=[];listeners:Record<string,Function[]>={};terminated=0;
 postMessage(m:GameWorkerInput<{value:number}>){this.commands.push(structuredClone(m));}
 addEventListener(type:string,fn:Function){(this.listeners[type]??=[]).push(fn);}
 terminate(){this.terminated++;}
 emit(m:GameWorkerOutput<{value:number}>){for(const f of this.listeners.message??[])f({data:m});}
 error(){for(const f of this.listeners.error??[])f();}
}
const open=(p:Port,frames:number[]=[],faults:string[]=[],timeout=200)=>createTrafficGameClient(p as never,'city-a',{onFrame:(f:{value:number})=>frames.push(f.value),onFailure:m=>faults.push(m)},timeout);

test('one in-flight plus one latest detached sample; obsolete results never publish',()=>{
 const p=new Port(),frames:number[]=[],client=open(p,frames);const s={value:1};client.submit(s,{advance:true,paused:false});s.value=99;
 client.submit({value:2},{advance:true,paused:false});client.submit({value:3},{advance:true,paused:false});
 assert.equal(p.commands.length,1);assert.equal(p.commands[0].sample.value,1);assert.equal(client.status.coalesced,1);assert.equal(client.status.pending,true);
 p.emit({kind:'frame',epoch:'city-a',seq:1,frame:{value:1}});assert.deepEqual(frames,[]);assert.equal(p.commands[1].seq,3);assert.equal(p.commands[1].sample.value,3);assert.equal(p.commands[1].commitPrevious,true);
 p.emit({kind:'frame',epoch:'city-a',seq:3,frame:{value:3}});assert.deepEqual(frames,[3]);assert.equal(client.status.pending,false);
 assert.equal(client.status.sent,2);assert.equal(client.status.received,2);assert.ok(client.status.lastRoundTripMs>=0);assert.ok(client.status.maxRoundTripMs>=client.status.lastRoundTripMs);
});

test('pause and road edits supersede pending steps and old city replies are fenced',()=>{
 const p=new Port(),frames:number[]=[],faults:string[]=[],client=open(p,frames,faults);client.submit({value:1},{advance:true,paused:false});
 client.submit({value:2},{advance:true,paused:false});client.submit({value:3},{advance:false,paused:true});
 p.emit({kind:'frame',epoch:'old-city',seq:1,frame:{value:9}});assert.equal(client.status.inflight,true);
 p.emit({kind:'frame',epoch:'city-a',seq:1,frame:{value:1}});assert.equal(p.commands[1].seq,3);assert.equal(p.commands[1].advance,false);assert.equal(p.commands[1].paused,true);assert.equal(p.commands[1].commitPrevious,false);
 p.emit({kind:'frame',epoch:'city-a',seq:3,frame:{value:3}});assert.deepEqual(frames,[3]);assert.deepEqual(faults,[]);
 assert.throws(()=>client.submit({value:4},{advance:true,paused:true}),/action/);client.dispose();p.error();p.emit({kind:'frame',epoch:'city-a',seq:3,frame:{value:4}});assert.deepEqual(frames,[3]);assert.deepEqual(faults,[]);assert.equal(p.terminated,1);
});

test('worker hangs and protocol errors fail only the ephemeral feature, fence later replies',async()=>{
 const p=new Port(),frames:number[]=[],faults:string[]=[],client=open(p,frames,faults,20);client.submit({value:1},{advance:true,paused:false});
 await new Promise(r=>setTimeout(r,35));assert.match(client.status.failure??'',/timed out/);assert.equal(faults.length,1);assert.equal(p.terminated,1);
 p.emit({kind:'frame',epoch:'city-a',seq:1,frame:{value:1}});assert.deepEqual(frames,[]);assert.equal(client.submit({value:2},{advance:true,paused:false}),false);
 const q=new Port(),qfault:string[]=[],second=open(q,[],qfault);second.submit({value:1},{advance:true,paused:false});q.emit({kind:'frame',epoch:'city-a',seq:2,frame:{value:2}});assert.match(qfault[0],/mismatch/);second.dispose();
});

test('a frame callback may synchronously request next sample without losing committed state',()=>{
 const p=new Port();let client:ReturnType<typeof createTrafficGameClient<{value:number},{value:number}>>;
 client=createTrafficGameClient(p as never,'city-a',{onFrame:()=>{client.submit({value:2},{advance:true,paused:false});},onFailure:()=>{}},200);
 client.submit({value:1},{advance:true,paused:false});p.emit({kind:'frame',epoch:'city-a',seq:1,frame:{value:1}});
 assert.equal(p.commands[1].commitPrevious,true);client.dispose();
});

test('pause fence survives an unpause replacement until the pre-pause candidate is discarded',()=>{
 const p=new Port(),frames:number[]=[],client=open(p,frames);client.submit({value:1},{advance:true,paused:false});
 client.submit({value:2},{advance:false,paused:true});client.submit({value:3},{advance:false,paused:false});
 p.emit({kind:'frame',epoch:'city-a',seq:1,frame:{value:1}});assert.equal(p.commands.length,2);assert.equal(p.commands[1].seq,3);assert.equal(p.commands[1].commitPrevious,false);assert.deepEqual(frames,[]);
 p.emit({kind:'frame',epoch:'city-a',seq:3,frame:{value:3}});assert.deepEqual(frames,[3]);
 client.submit({value:4},{advance:true,paused:false});assert.equal(p.commands[2].commitPrevious,true,'later accepted candidate can advance normally');client.dispose();
});

test('failure cleanup is exactly once when the owning layer synchronously disposes the client',()=>{
 const p=new Port(),frames:number[]=[],faults:string[]=[];
 let client:ReturnType<typeof createTrafficGameClient<{value:number},{value:number}>>;
 client=createTrafficGameClient(p as never,'city-a',{onFrame:f=>frames.push(f.value),onFailure:message=>{faults.push(message);client.dispose();}},200);
 client.submit({value:1},{advance:true,paused:false});client.submit({value:2},{advance:true,paused:false});
 p.error();assert.equal(p.terminated,1,'stop and reentrant layer dispose share one owned-worker termination');
 assert.equal(client.status.disposed,true);assert.equal(client.status.inflight,false);assert.equal(client.status.pending,false);
 assert.match(client.status.failure??'',/worker failed/);assert.equal(faults.length,1);
 p.error();p.emit({kind:'frame',epoch:'city-a',seq:1,frame:{value:99}});client.dispose();client.dispose();
 assert.equal(p.terminated,1,'late faults and city destroy must not terminate again');assert.equal(faults.length,1);assert.deepEqual(frames,[]);
 assert.equal(client.submit({value:3},{advance:true,paused:false}),false,'cleanup never restarts a failed worker');
});

test('throwing termination remains latched before reentrant failure cleanup',()=>{
 const p=new Port();p.terminate=()=>{p.terminated++;throw Error('injected terminate failure');};let faults=0;
 let client:ReturnType<typeof createTrafficGameClient<{value:number},{value:number}>>;
 client=createTrafficGameClient(p as never,'city-a',{onFrame:()=>assert.fail('failed worker must not publish'),onFailure:()=>{faults++;client.dispose();}},200);
 client.submit({value:1},{advance:true,paused:false});assert.doesNotThrow(()=>p.error());client.dispose();p.error();
 assert.equal(p.terminated,1);assert.equal(faults,1);assert.equal(client.status.disposed,true);assert.equal(client.status.inflight,false);
 assert.equal(client.submit({value:2},{advance:true,paused:false}),false);
});
