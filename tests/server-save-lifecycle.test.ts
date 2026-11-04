import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createAutosave,installAutosave} from '../src/autosave.ts';
import {ServerCitySaveClient} from '../src/server-city-save.ts';
import {persistServerCity,shouldWarnBeforeUnload,describeServerAcknowledgement} from '../src/server-save-lifecycle.ts';
import {createSaveAttemptQueue} from '../src/save-feedback.ts';
import {createPanelServerFixture,PANEL_OWNER} from './panel-server-entry-fixture.mjs';
const raw='{"version":23,"tick":1}';
const turn=()=>new Promise(r=>setImmediate(r));
const defer=()=>{let release!:()=>void;const promise=new Promise<void>(r=>release=r);return{promise,release};};
async function setup(){
 const fixture=createPanelServerFixture('http://127.0.0.1:4181/CityManager/'),initial=await fixture.seed(raw),metadata=initial.metadata;
 const calls:{method:string;init:any}[]=[];let current=raw,replyHook:null|((method:string)=>Promise<void>)=null;
 const deliver=async(method:string,init:any={})=>{
  let response:any,status=0;
  await fixture.intercept({requestId:randomUUID(),request:{url:'http://127.0.0.1:4181/citymanager-api/v1/city-save',method,headers:init.headers??{},postData:init.body}},async(_method:string,payload:any)=>{status=payload.responseCode;response=JSON.parse(Buffer.from(payload.body,'base64').toString());});
  if(status!==200)throw Object.assign(Error(response.error),{status});return response;
 };
 const client=new ServerCitySaveClient(async(_path,init)=>{const method=init?.method??'GET';calls.push({method,init:structuredClone(init)});const result=await deliver(method,init);if(replyHook)await replyHook(method);return result;},PANEL_OWNER);
 await client.load();const queue=createSaveAttemptQueue();
 const save=(explicit=false)=>queue(async()=>{const {acknowledged:ack}=await persistServerCity(client,()=>({raw:current,metadata}),explicit);if(explicit)auto.markSaved(ack.metadata.tick,ack.raw);return {revision:ack.raw};});
 const auto=createAutosave({save:()=>save(),tick:()=>1,revision:()=>current,needsRetry:()=>client.pending,canSave:()=>!client.conflict,onResult:()=>{}});auto.adoptLoaded();
 const handlers=new Map<string,()=>void>();let timer=()=>{};
 installAutosave({addEventListener:(name,fn)=>handlers.set(name,fn)},{addEventListener:(name,fn)=>handlers.set(name,fn),setInterval:fn=>{timer=fn;return 1;}},auto,()=>true);
 return{client,auto,calls,fixture,save,metadata,set raw(value:string){current=value;},get raw(){return current;},set hook(fn:null|((method:string)=>Promise<void>)){replyHook=fn;},event(name:string){handlers.get(name)!();},timer:()=>timer(),
  async settle(){const end=Date.now()+5000;while(auto.running){assert.ok(Date.now()<end,'Actual automatic work must settle');await turn();}},
  remote:async(value:string)=>deliver('POST',{headers:{'Idempotency-Key':randomUUID()},body:JSON.stringify({action:'save',cityId:fixture.active.cityId,expectedRevision:fixture.active.revision,raw:value,metadata})}),
  warn:()=>shouldWarnBeforeUnload({running:auto.running,failed:auto.last?.ok===false,busy:false,pending:client.pending,conflict:client.conflict,raw:current,confirmedRaw:client.confirmed?.raw})
 };
}
const permutations=[['beforeunload','pagehide','visibilitychange'],['beforeunload','visibilitychange','pagehide'],['pagehide','beforeunload','visibilitychange'],['pagehide','visibilitychange','beforeunload'],['visibilitychange','beforeunload','pagehide'],['visibilitychange','pagehide','beforeunload']];

test('all lifecycle event orders verify clean state and never create post-ACK upload bodies',async()=>{
 for(const dirty of [false,true])for(const order of permutations){
  const h=await setup();if(dirty)h.raw=raw+' ';
  const start=h.calls.length;
  for(const event of order){h.event(event);assert.equal(h.warn(),true,'Queued work is immediately covered by unload warning');await h.settle();assert.equal(h.auto.last?.ok,true);}
  assert.deepEqual(h.calls.slice(start).map(c=>c.method),dirty?['POST','GET','GET']:['GET','GET','GET']);
  assert.equal(h.fixture.active.revision,dirty?2:1);assert.equal(h.fixture.active.raw,h.raw);assert.equal(h.client.pending,false);assert.equal(h.warn(),false);
 }
});

test('overlapping lifecycle work coalesces only while active; a later event still checks a same-byte remote revision',async()=>{
 const h=await setup(),gate=defer();h.hook=async()=>gate.promise;h.event('beforeunload');await turn();
 h.event('pagehide');h.event('visibilitychange');assert.equal(h.calls.filter(c=>c.method==='POST').length,0);assert.equal(h.warn(),true);
 gate.release();await h.settle();h.hook=null;const before=h.calls.length;await h.remote(raw);
 // This also models a cancelled navigation followed by a distinct tab hide:
 // there is no timer/departure latch and no pageshow/visible reset is required.
 h.event('visibilitychange');await h.settle();assert.equal(h.calls.length,before+1);assert.equal(h.client.conflict,true);assert.equal(h.auto.last?.ok,false);assert.equal(h.warn(),true);assert.equal(h.client.confirmed?.revision,1);
});

test('edits during a verification are not marked saved, and the next periodic attempt writes them',async()=>{
 const h=await setup(),gate=defer();h.hook=async()=>gate.promise;const checking=h.auto.run(true);await turn();h.raw=raw+' ';gate.release();await checking;h.hook=null;
 assert.equal(h.client.confirmed?.raw,raw);assert.equal(h.warn(),true);assert.equal((await h.auto.run())?.ok,true);assert.equal(h.client.confirmed?.raw,h.raw);assert.equal(h.calls.at(-1)?.method,'POST');
});

test('edits during an upload remain dirty even if another lifecycle event arrives while it is in flight',async()=>{
 const h=await setup(),gate=defer();h.raw=raw+' ';h.hook=async()=>gate.promise;const saving=h.auto.run(true);await turn();h.raw=raw+'  ';h.event('pagehide');gate.release();await saving;h.hook=null;
 assert.equal(h.client.confirmed?.raw,raw+' ');assert.equal(h.warn(),true);assert.equal((await h.auto.run())?.ok,true);assert.equal(h.client.confirmed?.raw,raw+'  ');assert.equal(h.fixture.active.revision,3);
});

test('late queued captures and explicit saves use exact acknowledged bytes, including a later revert',async()=>{
 const h=await setup();h.raw=raw+' ';await h.save(true);assert.equal(h.fixture.active.revision,2);h.raw=raw;
 assert.equal((await h.auto.run())?.ok,true);assert.equal(h.client.confirmed?.raw,raw);assert.equal(h.fixture.active.revision,3,'Returning to originally loaded bytes is an unsaved edit after manual Save');
});

test('failed or cancelled clean verification keeps warning and is retried rather than cached as success',async()=>{
 for(const error of [Error('offline'),new DOMException('cancelled','AbortError'),Object.assign(Error('unauthorized'),{status:401})]){
  const h=await setup();h.hook=async()=>{throw error;};h.event('beforeunload');await h.settle();assert.equal(h.auto.last?.ok,false);assert.equal(h.warn(),true);assert.equal(h.client.pending,false);assert.equal(h.fixture.active.revision,1);
  h.hook=null;assert.equal((await h.auto.run())?.ok,true);assert.equal(h.warn(),false);assert.equal(h.calls.filter(c=>c.method==='POST').length,0);
 }
});

test('uncertain intent replays exactly before recapturing edits made during the retry',async()=>{
 const h=await setup();h.raw=raw+' ';let lost=true;h.hook=async method=>{if(method==='POST'&&lost){lost=false;throw Error('lost-ack');}};
 await h.auto.run(true);assert.equal(h.client.pending,true);assert.equal(h.fixture.active.revision,2);
 const gate=defer();let held=true;h.raw=raw+'  ';h.hook=async method=>{if(method==='POST'&&held){held=false;await gate.promise;}};
 const retry=h.auto.run();await turn();h.raw=raw+'   ';gate.release();await retry;h.hook=null;
 const posts=h.calls.filter(c=>c.method==='POST');assert.equal(posts.length,3);assert.deepEqual(posts[0].init,posts[1].init);assert.notEqual(posts[1].init.headers['Idempotency-Key'],posts[2].init.headers['Idempotency-Key']);assert.equal(JSON.parse(posts[2].init.body).raw,h.raw);assert.equal(JSON.parse(posts[2].init.body).expectedRevision,2);assert.equal(h.client.confirmed?.raw,h.raw);assert.equal(h.fixture.active.revision,3);
});

test('same-byte uncertain retry verifies the current remote head, and detects an intervening remote save',async()=>{
 for(const remoteChange of [false,true]){
  const h=await setup();h.raw=raw+' ';let lost=true;h.hook=async method=>{if(method==='POST'&&lost){lost=false;throw Error('lost-ack');}};await h.auto.run(true);h.hook=null;
  if(remoteChange)await h.remote(raw+'  ');
  const result=await h.auto.run();const posts=h.calls.filter(c=>c.method==='POST');assert.equal(posts.length,2);assert.deepEqual(posts[0].init,posts[1].init);assert.equal(h.calls.at(-1)?.method,'GET');assert.equal(result?.ok,!remoteChange);assert.equal(h.client.conflict,remoteChange);assert.equal(h.fixture.active.revision,remoteChange?3:2);
 }
});

test('explicit retry preserves the old request and still makes a fresh CAS after it',async()=>{
 const h=await setup();let lost=true;h.hook=async method=>{if(method==='POST'&&lost){lost=false;throw Error('lost-ack');}};await assert.rejects(h.save(true));h.hook=null;await h.save(true);
 const posts=h.calls.filter(c=>c.method==='POST');assert.equal(posts.length,3);assert.deepEqual(posts[0].init,posts[1].init);assert.notEqual(posts[1].init.headers['Idempotency-Key'],posts[2].init.headers['Idempotency-Key']);assert.equal(h.fixture.active.revision,3);
});

test('a timer queued during delayed manual ACK finishes with read-verified feedback, not another write',async()=>{
 const h=await setup(),gate=defer(),start=h.calls.length;
 h.hook=async method=>{if(method==='POST')await gate.promise;};
 const manual=h.save(true);await turn();assert.equal(h.client.pending,true);
 // The unchanged periodic timer still runs because the manual intent is pending.
 const checking=h.auto.run();assert.equal(h.auto.running,true);gate.release();await manual;await checking;
 assert.deepEqual(h.calls.slice(start).map(c=>c.method),['POST','GET']);
 assert.equal(h.calls.at(-1)?.init.cache,'no-store');assert.equal(h.fixture.active.revision,2);assert.equal(h.client.pending,false);assert.equal(h.auto.last?.ok,true);
 assert.deepEqual(h.client.confirmed,h.fixture.active);
 const feedback=describeServerAcknowledgement('verified',h.client.confirmed!.raw,h.raw);
 assert.equal(feedback.current,true);assert.equal(feedback.label,'ตรวจสอบแล้วว่าเซฟบนเซิร์ฟเวอร์ตรงกัน');
 h.raw=raw+' ';assert.equal(describeServerAcknowledgement('verified',h.client.confirmed!.raw,h.raw).current,false,'Edits made in flight must still reject current-save feedback');
});

test('every uncertainty or dirty state preserves the unload warning independently of event ordering',()=>{
 const base={running:false,failed:false,busy:false,pending:false,conflict:false,raw,confirmedRaw:raw};assert.equal(shouldWarnBeforeUnload(base),false);
 for(const key of ['running','failed','busy','pending','conflict'])assert.equal(shouldWarnBeforeUnload({...base,[key]:true}),true,key);
 assert.equal(shouldWarnBeforeUnload({...base,raw:raw+' '}),true);assert.equal(shouldWarnBeforeUnload({...base,confirmedRaw:undefined}),true);
});

test('main wires exact ACK bookkeeping, pending retries and synchronous lifecycle warnings',async()=>{
 const {readFile}=await import('node:fs/promises');const source=await readFile(new URL('../src/main.ts',import.meta.url),'utf8');
 for(const value of ['persistServerCity(serverSave','autosave.markSaved(acknowledged.metadata.tick,acknowledged.raw)','return {revision:acknowledged.raw,current:feedback.current}','needsRetry:()=>serverSave.pending','shouldWarnBeforeUnload({running:autosave.running,failed:autosave.last?.ok===false','const saved=await trackedSave(true);sound(\'ui-save\');status(saved.current?'])assert.ok(source.includes(value),value);
});

test('read verification never claims a new write, and in-flight edits never get current-save success feedback',async()=>{
 assert.deepEqual(describeServerAcknowledgement('verified',raw,raw),{current:true,label:'ตรวจสอบแล้วว่าเซฟบนเซิร์ฟเวอร์ตรงกัน'});
 assert.deepEqual(describeServerAcknowledgement('saved',raw,raw),{current:true,label:'บันทึกบนเซิร์ฟเวอร์แล้ว'});
 for(const operation of ['verified','saved'] as const){
  const feedback=describeServerAcknowledgement(operation,raw,raw+' ');assert.equal(feedback.current,false);assert.match(feedback.label,/มีการเปลี่ยนแปลงใหม่ที่ยังไม่บันทึก/);assert.doesNotMatch(feedback.label,/บันทึกบนเซิร์ฟเวอร์แล้ว|เซฟบนเซิร์ฟเวอร์ตรงกัน/);
 }
 const {readFile}=await import('node:fs/promises'),source=await readFile(new URL('../src/main.ts',import.meta.url),'utf8');
 const compare=source.indexOf('const feedback=describeServerAcknowledgement(operation,acknowledged.raw,serializeParkSession(city,parkRuntime,city.market))');
 assert.ok(compare>=0&&compare<source.indexOf('saveFeedback.succeeded(attempt)',compare));assert.ok(source.includes('()=>saveSuccessLabel'));
});

test('clean departures conservatively warn while verification is outstanding, then clear only on a valid result',async()=>{
 const h=await setup(),gate=defer();assert.equal(h.warn(),false);h.hook=async()=>gate.promise;
 h.event('beforeunload');assert.equal(h.auto.running,true);assert.equal(h.warn(),true,'Intentional user-visible prompt even when local bytes are clean');
 await turn();assert.equal(h.calls.at(-1)?.method,'GET');assert.equal(h.warn(),true);gate.release();await h.settle();assert.equal(h.warn(),false);
});

test('replacing the city while retry is pending prevents capture and any subsequent mixed snapshot POST',async()=>{
 const h=await setup();h.raw=raw+' ';let lost=true;h.hook=async method=>{if(method==='POST'&&lost){lost=false;throw Error('lost-ack');}};await h.auto.run(true);assert.equal(h.client.pending,true);
 const gate=defer();h.hook=async()=>gate.promise;let generation=1,capturedGeneration=1,serialized=false;
 const work=persistServerCity(h.client,()=>{if(generation!==capturedGeneration)throw Error('city-generation-changed');serialized=true;return{raw:raw+'  ',metadata:h.metadata};});
 await turn();generation++;gate.release();await assert.rejects(work,/city-generation-changed/);
 assert.equal(serialized,false);const posts=h.calls.filter(c=>c.method==='POST');assert.equal(posts.length,2);assert.deepEqual(posts[0].init,posts[1].init);assert.equal(h.fixture.active.revision,2);assert.equal(h.fixture.active.raw,raw+' ');
 const {readFile}=await import('node:fs/promises'),source=await readFile(new URL('../src/main.ts',import.meta.url),'utf8');
 assert.ok(source.includes("persistServerCity(serverSave,()=>{if(captured!==city||generation!==cityGeneration)throw Error('เมืองเปลี่ยนระหว่างรอบันทึก');const raw=serializeParkSession(captured,parkRuntime,captured.market)"));
});
