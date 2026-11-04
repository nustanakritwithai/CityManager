import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {readFileSync} from 'node:fs';
import {createFeedbackServerFixture} from './player-feedback-server-fixture.mjs';
import {ServerCitySaveClient} from '../src/server-city-save.ts';
import {persistServerCity} from '../src/server-save-lifecycle.ts';
import {PANEL_OWNER} from './panel-server-entry-fixture.mjs';
import {settleFeedbackProjection} from './player-feedback-projection.mjs';
import {Camera,GraphNode,Vec3,ASPECT_MANUAL} from 'playcanvas';
import {trafficHttpHandler} from './traffic-server-entry-fixture.mjs';import {EventEmitter} from 'node:events';
import {adoptSavedEducation,buildCampus,campusSiteReason,createCity,deserialize,step} from '../src/sim.ts';import {createParkRuntime,serializeParkSession} from '../src/park-runtime.ts';
import {createCity as oldCity,step as oldStep,serialize as oldSerialize} from '../src/legacy-v4.ts';
const origin='http://127.0.0.1:4176',url=origin+'/CityManager/',city=createCity(42),raw=serializeParkSession(city,createParkRuntime(city));
const request=(body,key)=>({requestId:randomUUID(),request:{url:origin+'/citymanager-api/v1/city-save',method:'POST',headers:{'Idempotency-Key':key},postData:JSON.stringify(body)}});
const readRequest=()=>({requestId:randomUUID(),request:{url:origin+'/citymanager-api/v1/city-save',method:'GET',headers:{}}});
test('native cell taps wait for the actual PlayCanvas projection cache after viewport rotation',async()=>{
 const camera=new Camera(),node=new GraphNode();camera.node=node;camera.aspectRatioMode=ASPECT_MANUAL;
 const resize=(width,height)=>{camera.aspectRatio=width/height;const radius=Math.max(42,Math.min(100,42*.86/(width/height)));node.setPosition(-10+Math.sin(Math.PI/4)*radius*Math.cos(.88),radius*Math.sin(.88),Math.cos(Math.PI/4)*radius*Math.cos(.88));node.lookAt(new Vec3(-10,0,0));};
 const target=new Vec3(-5,.1,5);resize(360,740);camera.worldToScreen(target,360,740);resize(844,390);
 const read=async()=>{const p=camera.worldToScreen(target,844,390);return {viewport:[844,390],point:{x:p.x,y:p.y}};};
 const stale=await read();let frames=0;
 const settled=await settleFeedbackProjection({read,afterRender:async()=>{
  frames++;
  // The exact cache invalidation performed by CameraComponent.onAppPrerender.
  camera._viewMatDirty=true;camera._viewProjMatDirty=true;
 }});
 assert.notDeepEqual(settled,stale,'Viewport dimensions alone can accompany stale projected coordinates');
 assert.deepEqual(settled,await read());assert.ok(frames>=2,'One frame cannot establish projection stability');
});

test('projection readiness waits through changing canvas geometry and fails instead of tapping an unstable target',async()=>{
 let frame=0;const read=async()=>({viewport:[844,390],canvas:[frame<3?360:844,390],point:{x:frame<3?frame:42,y:100}});
 const settled=await settleFeedbackProjection({read,afterRender:async()=>{frame++;}});assert.equal(frame,4);assert.equal(settled.point.x,42);
 frame=0;await assert.rejects(settleFeedbackProjection({read:async()=>({point:{x:frame,y:0}}),afterRender:async()=>{frame++;},now:()=>frame,timeout:3}),/did not stabilize/);
});
test('unchanged automatic UX retry replays the exact intent then freshly verifies the same head without a duplicate write',async()=>{
 const f=createFeedbackServerFixture(url),before=await f.core.seed(raw),calls=[];
 const client=new ServerCitySaveClient(async(path,init={})=>{
  calls.push(structuredClone(init));let response,status;
  await f.intercept({requestId:randomUUID(),request:{url:origin+'/citymanager-api'+path,method:init.method??'GET',headers:init.headers??{},postData:init.body}},async(_method,payload)=>{status=payload.responseCode;response=JSON.parse(Buffer.from(payload.body,'base64').toString());});
  if(status!==200)throw Object.assign(Error(response.error),{status});return response;
 },PANEL_OWNER);
 await client.load();const currentRaw=raw+' ',capture=()=>({raw:currentRaw,metadata:before.metadata});
 f.setFault(true);await assert.rejects(persistServerCity(client,capture),error=>error.status===503);assert.deepEqual(f.active,before);assert.equal(client.pending,true);
 f.setFault(false);const result=await persistServerCity(client,capture);
 assert.equal(result.operation,'verified');assert.equal(client.pending,false);assert.equal(f.assertVerifiedRetry(0,before,currentRaw).finalRevision,before.revision+1);
 assert.deepEqual(calls.map(c=>c.method??'GET'),['GET','POST','POST','GET']);assert.deepEqual(calls[1],calls[2]);assert.equal(calls.at(-1).cache,'no-store');
});

test('automatic retry evidence rejects missing, stale, failed or mismatched reads, new writes and changed current bytes',async()=>{
 const f=createFeedbackServerFixture(url),before=await f.core.seed(raw),key=randomUUID(),command={action:'save',cityId:before.cityId,expectedRevision:before.revision,raw,metadata:before.metadata},send=async()=>{};
 f.setFault(true);await f.intercept(request(command,key),send);f.setFault(false);
 await f.intercept(readRequest(),send);await f.intercept(request(command,key),send);
 assert.throws(()=>f.assertVerifiedRetry(0,before,raw),/fresh successful server read/,'A read before the replay ACK cannot prove recovery');
 await f.intercept(readRequest(),send);assert.equal(f.assertVerifiedRetry(0,before,raw).finalRevision,before.revision+1);
 const verified=f.reads.at(-1),response=verified.response;verified.status=503;
 assert.throws(()=>f.assertVerifiedRetry(0,before,raw),/fresh successful server read/);verified.status=200;
 verified.response={...response,revision:response.revision+1};assert.throws(()=>f.assertVerifiedRetry(0,before,raw),/exact retried ACK/);verified.response=response;
 assert.throws(()=>f.assertVerifiedRetry(0,before,raw+' '),/unchanged current session/);
 await f.intercept(request({...command,expectedRevision:f.active.revision},randomUUID()),send);
 assert.throws(()=>f.assertVerifiedRetry(0,before,raw),/must not create a distinct write/);
});

test('synthetic UX outage preserves server head and requires exact retry plus a new fenced save',async()=>{
 const f=createFeedbackServerFixture(url),before=await f.core.seed(raw),key=randomUUID(),command={action:'save',cityId:before.cityId,expectedRevision:before.revision,raw,metadata:before.metadata};let delivered=[];
 const send=async(method,payload)=>{delivered.push(payload.responseCode);};f.setFault(true);await f.intercept(request(command,key),send);assert.deepEqual(f.active,before);assert.equal(delivered.at(-1),503);
 f.setFault(false);await f.intercept(request(command,key),send);const after=f.active;await f.intercept(request({...command,expectedRevision:after.revision},randomUUID()),send);
 assert.equal(f.assertRetry(0,before).finalRevision,before.revision+2);assert.deepEqual(delivered,[503,200,200]);
 const changed=createFeedbackServerFixture(url);const seed=await changed.core.seed(raw);changed.setFault(true);await changed.intercept(request({...command,cityId:seed.cityId},key),send);changed.setFault(false);
 await changed.intercept(request({...command,cityId:seed.cityId,raw:raw+' '},key),send);const revision=changed.active.revision;
 await changed.intercept(request({...command,cityId:seed.cityId,expectedRevision:revision},randomUUID()),send);
 assert.throws(()=>changed.assertRetry(0,seed),/exact request body/,'A forged replay cannot pass the UX fixture contract');
});

test('UX browser suite uses server entry, native retry and retains the full layout matrix',()=>{
 const source=readFileSync(new URL('./player-feedback-smoke.mjs',import.meta.url),'utf8'),reading=readFileSync(new URL('./player-feedback-reading.mjs',import.meta.url),'utf8');
 assert.match(source,/fixtureServer\.core\.seed\(fixture\)/);assert.match(source,/fixtureServer\.core\.enter\(/);assert.match(source,/installTrafficNetworkFence\(/);
 assert.match(source,/button\('#save-failure-retry'\)/);assert.match(source,/fixtureServer\.assertRetry\(/);assert.match(source,/fixtureServer\.core\.assertNoCityWrites\(evaluate\)/);
 assert.match(source,/fixtureServer\.assertVerifiedRetry\(faultContext\.index,faultContext\.before,await evaluate\('cityManager\.sessionSnapshot\(\)'\)\)/);
 assert.match(source,/await settleFeedbackProjection\(/);assert.match(source,/requestAnimationFrame\(\(\)=>setTimeout\(/);
 assert.match(source,/return \{ kind, cell:b\.cell, buildingId:b\.id \}/);assert.match(source,/householdId:family\.id, buildingId:familyHome\.id/);
 for(const runner of [source,reading]){
  assert.match(runner,/dataset\.scope==='place'.*dataset\.cell/);
  assert.match(runner,/assert\.equal\(await evaluate\("document\.querySelector\('#entity-content'\)\.dataset\.entityId"\),String\(entry\.buildingId\)/);
  assert.match(runner,/assert\.equal\(await evaluate\("document\.querySelector\('#entity-content'\)\.dataset\.entityId"\),String\(entry\.householdId\?\?entry\.buildingId\)/);
 }
 assert.doesNotMatch(source,/localStorage\.setItem\(['"]citymanager\.save/);assert.doesNotMatch(source,/button\('#save-failure-export'\)/);
 assert.match(source,/for \(const warning of \[false,true\]\)/);assert.match(reading,/for \(const viewport of views\)/);assert.match(reading,/for \(const name of pages\)/);assert.match(reading,/#save-failure-retry/);
 const css=readFileSync(new URL('../src/player-feedback.css',import.meta.url),'utf8');
 assert.match(css,/factory.*\.cx-metric dt\s*\{[^}]*overflow:visible[^}]*-webkit-line-clamp:unset[^}]*line-clamp:unset/);
 assert.match(css,/factory.*\.cx-metric :is\(dt,dd\)\s*\{\s*line-height:1\.7/);
 assert.match(reading,/primaryTotal,4/);assert.match(reading,/primaryFull,4/);assert.match(reading,/primaryGeometry\.every\(x=>x\.textFits\)/);assert.match(reading,/textGeometry:/);
 const workflow=readFileSync(new URL('../.github/workflows/player-feedback.yml',import.meta.url),'utf8');assert.match(workflow,/tests\/player-feedback-server-fixture\.test\.mjs/);
 for(const path of ['src/server-city-save.ts','src/city-save-auth.ts','server/city-saves/**','tests/traffic-server-entry-fixture.mjs','tests/panel-server-entry-fixture.mjs'])assert.ok(workflow.includes(`'${path}'`),`${path} triggers the UX check`);
});

test('both actual UX city fixtures enter the real synthetic save service',async()=>{
 const campus=createCity(3,{starter:true});const school=campus.cells.findIndex((_,i)=>campusSiteReason(campus,i,'school')===null);assert.ok(buildCampus(campus,school,'school').ok);
 const university=campus.cells.findIndex((_,i)=>campusSiteReason(campus,i,'university')===null);assert.ok(buildCampus(campus,university,'university').ok);for(let i=0;i<12;i++)step(campus);
 const old=oldCity(61025);for(let i=0;i<29;i++)oldStep(old);const cards=deserialize(oldSerialize(old));adoptSavedEducation(cards);
 const f=createFeedbackServerFixture(url);for(const c of [campus,cards]){const snapshot=serializeParkSession(c,createParkRuntime(c)),ack=await f.core.seed(snapshot);assert.equal(ack.raw,snapshot);assert.equal(ack.metadata.tick,c.tick);}
});

test('native loopback adapter delivers failed and acknowledged UX saves without remote forwarding',async()=>{
 const f=createFeedbackServerFixture(url),before=await f.core.seed(raw),errors=[],deliveries=[],key=randomUUID(),command={action:'save',cityId:before.cityId,expectedRevision:before.revision,raw,metadata:before.metadata};
 const handler=trafficHttpHandler({origin,upstream:url,fixture:f,errors,deliveries,forward:async()=>{throw Error('unexpected asset');}});
 const post=async(body,id)=>{const payload=JSON.stringify(body),req={url:'/citymanager-api/v1/city-save',method:'POST',headers:{host:new URL(origin).host,'idempotency-key':id},async *[Symbol.asyncIterator](){yield payload;}},res=new EventEmitter();res.writeHead=(status)=>{res.status=status;res.headersSent=true;};res.end=data=>{res.data=data;res.emit('finish');res.emit('close');};await handler(req,res);return res;};
 f.setFault(true);assert.equal((await post(command,key)).status,503);assert.deepEqual(f.active,before);
 f.setFault(false);assert.equal((await post(command,key)).status,200);assert.equal((await post({...command,expectedRevision:f.active.revision},randomUUID())).status,200);
 assert.equal(f.assertRetry(0,before).finalRevision,before.revision+2);assert.deepEqual(errors,[]);assert.ok(deliveries.every(d=>d.finished));
});
