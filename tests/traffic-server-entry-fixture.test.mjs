import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {createTrafficServerFixture} from './traffic-server-entry-fixture.mjs';
const url='http://127.0.0.1:4195/CityManager/';
import {createCity,step} from '../src/sim.ts';
import {createParkRuntime,serializeParkSession} from '../src/park-runtime.ts';
const city=createCity(42),raw=serializeParkSession(city,createParkRuntime(city));
const request=(method,body)=>({requestId:randomUUID(),request:{url:'http://127.0.0.1:4195/citymanager-api/v1/city-save',method,headers:{'Idempotency-Key':randomUUID()},postData:body&&JSON.stringify(body)}});
test('traffic fixture uses real ACK/revision/conflict contracts and preserves its head across reload entry',async()=>{
 const f=createTrafficServerFixture(url),ack=await f.seed(raw),messages=[];
 const send=async(method,params)=>{messages.push({method,params});};
 assert.equal(JSON.parse(raw).version,25);assert.equal(ack.metadata.tick,city.tick);assert.equal(ack.metadata.population,city.households.reduce((n,h)=>n+h.members,0));assert.equal(ack.revision,1);f.assertDurable(raw,1);
 const enter=async()=>{const predicates=[],buttons=[];await f.enter({button:async s=>buttons.push(s),evaluate:async e=>{if(e==='window.__panelCityWrites')return [];if(e.startsWith('localStorage'))return null;predicates.push(e);return true;}});assert.deepEqual(buttons,['.guest-entry-card button']);assert.ok(predicates[1].includes('visuals().ready'));};
 await enter();await enter();f.assertDurable(raw,1); // Real reload does not call seed.
 const next=createCity(42);step(next);const changed=serializeParkSession(next,createParkRuntime(next));
 await f.intercept(request('POST',{action:'save',cityId:ack.cityId,expectedRevision:1,raw:changed,metadata:{...ack.metadata,tick:next.tick}}),send);
 assert.equal(messages.at(-1).params.responseCode,200);f.assertDurable(changed,2);
 await f.intercept(request('POST',{action:'save',cityId:ack.cityId,expectedRevision:1,raw,metadata:ack.metadata}),send);
 assert.equal(messages.at(-1).params.responseCode,409);f.assertDurable(changed,2);
 await f.intercept(request('GET'),send);assert.equal(JSON.parse(Buffer.from(messages.at(-1).params.body,'base64')).raw,changed);
 const copy=f.active;copy.raw='corrupted';f.assertDurable(changed,2);
 await assert.rejects(f.intercept({request:{url:'https://example.com/citymanager-api/v1/me',method:'GET'}},send),/external account/);
});
test('only explicitly authorized beforeunload is handled, once; entry needs an ACK and browser writes fail',async()=>{
 const f=createTrafficServerFixture(url),sent=[],send=async(...args)=>sent.push(args);
 assert.throws(()=>createTrafficServerFixture('https://127.0.0.1/'),/loopback HTTP/);
 await assert.rejects(f.enter({}),/Seed through real server ACK/);
 await assert.rejects(f.seed(JSON.stringify({version:25,tick:0}))); 
 await assert.rejects(f.dialog({type:'beforeunload'},send),/explicit traffic/);
 f.permitBeforeUnload();await assert.rejects(f.dialog({type:'alert'},send),/explicit traffic/);
 await f.dialog({type:'beforeunload'},send);assert.deepEqual(sent,[['Page.handleJavaScriptDialog',{accept:true}]]);
 await assert.rejects(f.dialog({type:'beforeunload'},send),/explicit traffic/);
 await f.seed(raw);await assert.rejects(f.assertNoCityWrites(async e=>e==='window.__panelCityWrites'?['setItem:citymanager.save.v7']:raw),/never writes browser city copies/);
 await f.install(send);assert.equal(sent.at(-1)[0],'Page.addScriptToEvaluateOnNewDocument');assert.ok(sent.at(-1)[1].source.includes('__panelCityWrites'));
});

test('read-only navigation predicates retry only known destroyed-context errors',async()=>{
 const f=createTrafficServerFixture(url);await f.seed(raw);let calls=0;
 await f.enter({button:async()=>{},evaluate:async e=>{if(++calls===1)throw Object.assign(Error('navigation'),{cdpError:{code:-32000,message:'Inspected target navigated or closed'}});return e==='window.__panelCityWrites'?[]:e.startsWith('localStorage')?null:true;}});
 assert.equal(f.navigationRetries.length,1);
 await assert.rejects(f.enter({button:async()=>{},evaluate:async()=>{throw Object.assign(Error('runtime failure'),{cdpError:{code:-32000,message:'Unknown error'}});}}),/runtime failure/);
});
