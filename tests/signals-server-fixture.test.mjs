import { panelProviderDenials, isPanelProviderRequest } from './panel-network-denies.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createCity, serialize, step } from '../src/sim.ts';
import { createParkRuntime, serializeParkSession } from '../src/park-runtime.ts';
import { createTrafficServerFixture, loadedTrafficSession, trafficNetworkRules, assertNavigationSaveChain } from './traffic-server-entry-fixture.mjs';

const url='http://127.0.0.1:4187/CityManager/';
const request=(method,command)=>({requestId:randomUUID(),request:{url:new URL('/citymanager-api/v1/city-save',url).href,method,headers:{'Idempotency-Key':randomUUID()},...(command?{postData:JSON.stringify(command)}:{})}});
const sink=async()=>{};
const evaluate=async expression=>expression==='window.__panelCityWrites'?[]:expression.startsWith('localStorage')?null:true;

test('signals fixture preserves old city, obtains exact ACK and reloads the same saved identity',async()=>{
  const source=createCity(61025);for(let i=0;i<65;i++)step(source);
  const raw=serialize(source),city=loadedTrafficSession(raw).city;
  assert.equal(source.cells.length,576);assert.equal(city.cells.length,672);
  assert.deepEqual(city.cells.slice(0,576),source.cells);assert.deepEqual(city.resources.fertility.slice(0,576),source.resources.fertility);
  const {cells:_c,resources:_r,...before}=source,{cells:_d,resources:_s,...after}=city;assert.deepEqual(after,before);
  const f=createTrafficServerFixture(url),ack=await f.seed(raw);assert.equal(ack.raw,raw);assert.equal(ack.revision,1);
  const enter=async()=>f.enter({evaluate,button:async()=>{await f.intercept(request('GET'),sink);}});
  await enter();assert.equal(f.active.raw,raw);await f.assertNoCityWrites(evaluate);
  step(city);const session=serializeParkSession(city,createParkRuntime(city));
  const payload={action:'save',cityId:ack.cityId,expectedRevision:ack.revision,raw:session,metadata:{...ack.metadata,tick:city.tick}};
  await f.intercept(request('POST',payload),sink);const saved=f.active;
  assert.equal(saved.raw,session);assert.equal(saved.revision,2);assert.equal(saved.cityId,ack.cityId);
  assert.deepEqual(assertNavigationSaveChain({...ack,raw:session},saved,f.writes),{beforeRevision:1,afterRevision:2,lifecycleSaves:1});
  assert.throws(()=>assertNavigationSaveChain({...ack,raw:session},saved,[]));
  f.allowNavigation();await enter();assert.deepEqual(f.active,saved);
  assert.equal(f.reads.at(-1).response.raw,session);assert.equal(f.navigationEvidence.at(-1).beforeRevision,saved.revision);
  const invalid={...payload,expectedRevision:1};await assert.rejects(f.intercept(request('POST',invalid),sink),/Unexpected rejected traffic save/);
  assert.deepEqual(f.active,saved);await f.assertNoCityWrites(evaluate);
});

test('signals browser checks keep the feature gate, same-city reload and strict network fence',()=>{
  const source=readFileSync(new URL('./signals-smoke.mjs',import.meta.url),'utf8');
  for(const text of ['Pilot hidden without feature flag','No API/provider request while connection is disabled','Reloading the same city clears capture history','Opening report is read-only','Comparative report is read-only','Disclosures are read-only','server.navigationEvidence.at(-1).beforeRevision','server.assertNoCityWrites','isPanelProviderRequest(requested)','providerRequests.push(requested)','assert.deepEqual(providerRequests, [],','...panelProviderDenials(origin)'])assert.ok(source.includes(text),text);
  assert.doesNotMatch(source,/localStorage\.(?:setItem|removeItem)|button\(['"]#load['"]\)/);
  const origin=new URL(url).origin, deny=[...panelProviderDenials(origin),origin+'/api/city-advisor/*',origin+'/*/api/city-advisor/*'];
  const rules=trafficNetworkRules(origin,false,deny),decision=target=>rules.find(rule=>new URLPattern(rule.urlPattern).test(target))?.block;
  for(const path of ['/api/city-advisor/report','/CityManager/api/city-advisor/report','/x/y/api/city-advisor/report','/chat/completions','/CityManager/chat/completions','/x/y/chat/completions','/api/city-advisor/other']) { assert.equal(decision(origin+path),true,path); assert.equal(isPanelProviderRequest(origin+path),true,path); }
  assert.equal(isPanelProviderRequest('https://provider.example/chat/completions'),true);assert.equal(isPanelProviderRequest(origin+'/citymanager-api/v1/city-save'),false);
  assert.equal(decision(origin+'/citymanager-api/v1/city-save'),false);
  assert.equal(decision('https://example.com/'),true);
});
