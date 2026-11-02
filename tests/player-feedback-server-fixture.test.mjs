import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {readFileSync} from 'node:fs';
import {createFeedbackServerFixture} from './player-feedback-server-fixture.mjs';
import {trafficHttpHandler} from './traffic-server-entry-fixture.mjs';import {EventEmitter} from 'node:events';
import {adoptSavedEducation,buildCampus,campusSiteReason,createCity,deserialize,step} from '../src/sim.ts';import {createParkRuntime,serializeParkSession} from '../src/park-runtime.ts';
import {createCity as oldCity,step as oldStep,serialize as oldSerialize} from '../src/legacy-v4.ts';
const origin='http://127.0.0.1:4176',url=origin+'/CityManager/',city=createCity(42),raw=serializeParkSession(city,createParkRuntime(city));
const request=(body,key)=>({requestId:randomUUID(),request:{url:origin+'/citymanager-api/v1/city-save',method:'POST',headers:{'Idempotency-Key':key},postData:JSON.stringify(body)}});
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
