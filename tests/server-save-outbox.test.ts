import assert from 'node:assert/strict';
import test from 'node:test';
import {createCityOutbox} from '../src/server-save-outbox.ts';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const metadata={name:'City',population:0,tick:0}, owner=id(1), city=id(2);
function setup(){
 const data=new Map<string,string>();let tail=Promise.resolve(),failWrite=false;
 const storage={getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{if(failWrite)throw Error('quota');data.set(k,v);}};
 const locks={request<T>(_key:string,_opts:{mode:'exclusive'},work:()=>Promise<T>):Promise<T>{const next=tail.then(work);tail=next.then(()=>{},()=>{});return next;}};
 const box=createCityOutbox(storage,locks,owner,city,()=>id(3));
 return {box,data,storage,locks,fail:(v:boolean)=>{failWrite=v;}};
}
const initial={action:'create' as const,cityId:city,slot:1,raw:'{ "version":99 }',metadata};
test('lost response and reload preserve exact bytes and the original idempotency key until ACK',async()=>{
 const {box,storage,locks}=setup();const pending=await box.enqueue(null,initial);let sent='';
 await assert.rejects(box.flush(pending,async rid=>{sent=rid;throw Error('offline');}),/offline/);assert.equal(box.read(),pending);
 const resumed=createCityOutbox(storage,locks,owner,city,()=>id(5));
 const done=await resumed.flush(pending,async(rid,command)=>{assert.equal(rid,sent);assert.equal(command.raw,initial.raw);return {cityId:city,slot:1,revision:1,deleted:false};});
 assert.equal(resumed.inspect(done)?.revision,1);assert.equal(resumed.inspect(done)?.raw,initial.raw);assert.equal(resumed.inspect(done)?.pending,null);
});
test('stale tabs, pending updates and conflicts never replace a durable upload',async()=>{
 const {box}=setup();const pending=await box.enqueue(null,initial);
 await assert.rejects(box.enqueue(null,initial),/outbox-changed-reload/);
 await assert.rejects(box.enqueue(pending,initial),/outbox-pending/);
 await assert.rejects(box.flush(pending,async()=>{throw Object.assign(Error('conflict'),{status:409});}),/conflict/);
 const conflict=box.read()!;assert.equal(box.inspect(conflict)?.pending?.conflict,true);
 await assert.rejects(box.flush(conflict,async()=>{throw Error('must not send');}),/resolution-required/);
 assert.equal(box.inspect(conflict)?.raw,initial.raw);
});
test('invalid ACK and failed local write cannot report server success',async()=>{
 const {box,fail}=setup();const pending=await box.enqueue(null,initial);
 await assert.rejects(box.flush(pending,async()=>({cityId:id(8),slot:1,revision:1,deleted:false})),/invalid-ack/);assert.equal(box.read(),pending);
 fail(true);await assert.rejects(box.flush(pending,async()=>({cityId:city,slot:1,revision:1,deleted:false})),/quota/);
 fail(false);assert.equal(box.read(),pending);
 const done=await box.flush(pending,async()=>({cityId:city,slot:1,revision:1,deleted:false}));
 await assert.rejects(box.enqueue(done,{action:'save',cityId:city,expectedRevision:2,raw:'{}',metadata}),/outbox-conflict/);
});
test('explicit conflict resolution archives both originals and keeps local choices unsynced',async()=>{
 const {box}=setup();let current=await box.enqueue(null,initial);
 current=await box.flush(current,async()=>({cityId:city,slot:1,revision:1,deleted:false}));
 const pending=await box.enqueue(current,{action:'save',cityId:city,expectedRevision:1,raw:'{"local":true}',metadata});
 await assert.rejects(box.flush(pending,async()=>{throw Object.assign(Error('conflict'),{status:409});}),/conflict/);
 const conflict=box.read()!;
 await assert.rejects(box.resolveConflict(conflict,{cityId:city,revision:2,raw:'{"server":true}',deleted:true},'keep-local'),/invalid-remote/);
 const resolved=await box.resolveConflict(conflict,{cityId:city,revision:2,raw:'{"server":true}',deleted:false},'keep-local');
 const state=box.inspect(resolved)!;assert.equal(state.synced,false);assert.equal(state.raw,'{"local":true}');assert.equal(state.revision,2);
 assert.equal(state.conflicts[0].localRaw,'{"local":true}');assert.equal(state.conflicts[0].remoteRaw,'{"server":true}');
 const next=await box.enqueue(resolved,{action:'save',cityId:city,expectedRevision:2,raw:state.raw,metadata});assert.equal(box.inspect(next)?.pending?.command.action,'save');
});

test('only ACKed bytes are available to receipt durability checks',async()=>{
 const {box}=setup();let pending=await box.enqueue(null,initial);
 assert.equal(box.readConfirmed(),null);
 let done=await box.flush(pending,async()=>({cityId:city,slot:1,revision:1,deleted:false}));
 assert.equal(box.readConfirmed(),initial.raw);
 pending=await box.enqueue(done,{action:'save',cityId:city,expectedRevision:1,raw:'{"pending":true}',metadata});
 assert.equal(box.readConfirmed(),initial.raw);
 await assert.rejects(box.flush(pending,async()=>{throw Error('response lost');}),/response lost/);
 assert.equal(box.readConfirmed(),initial.raw);
 done=await box.flush(pending,async()=>({cityId:city,slot:1,revision:2,deleted:false}));
 assert.equal(box.readConfirmed(),'{"pending":true}');assert.equal(box.inspect(done)?.synced,true);
});
test('offline autosaves advance while an earlier request retains its exact retry payload',async()=>{
 const {box}=setup();const first=await box.enqueue(null,initial);const newer=await box.saveLocal(first,'{"day":2}');
 assert.equal(box.inspect(newer)?.raw,'{"day":2}');assert.equal(box.inspect(newer)?.pending?.command.raw,initial.raw);assert.equal(box.readConfirmed(),null);
 await assert.rejects(box.flush(newer,async()=>{throw Error('offline');}),/offline/);assert.equal(box.read(),newer);
 const after=await box.flush(newer,async(_id,command)=>{assert.equal(command.raw,initial.raw);return {cityId:city,revision:1,slot:1,deleted:false};});
 assert.equal(box.inspect(after)?.raw,'{"day":2}');assert.equal(box.inspect(after)?.synced,false);assert.equal(box.readConfirmed(),initial.raw);
 const second=await box.enqueue(after,{action:'save',cityId:city,expectedRevision:1,raw:'{"day":2}',metadata});assert.equal(box.inspect(second)?.pending?.command.raw,'{"day":2}');
});
