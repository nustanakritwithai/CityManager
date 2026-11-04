import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createTrafficServerFixture} from './traffic-server-entry-fixture.mjs';
import {assertPanelSaveChain,loadPanelCity,panelEntryCity,saveAndReloadPanel} from './panel-ui-server.mjs';
import {deserialize,serialize} from '../src/sim.ts';
import {createParkRuntime,serializeParkSession} from '../src/park-runtime.ts';

const url='http://127.0.0.1:4173/CityManager/', historical=readFileSync(new URL('./fixtures/legacy-v1-day65.json',import.meta.url),'utf8'), raw=serialize(deserialize(historical));
const request=(method,body)=>({requestId:randomUUID(),request:{url:new URL('/citymanager-api/v1/city-save',url).href,method,headers:{'Idempotency-Key':randomUUID()},postData:body&&JSON.stringify(body)}});
const sink=async()=>{};
test('historical fixture enters through real service then native Save ACK and reload preserve the whole city',async()=>{
 const server=createTrafficServerFixture(url), city=panelEntryCity(raw), session=serializeParkSession(city,createParkRuntime(city));let active=false;
 const evaluate=async expression=>{
  if(expression==='!!window.cityManager')return active;
  if(expression==='window.cityManager.snapshot()')return serialize(city);
  if(expression==='window.cityManager.sessionSnapshot()')return session;
  if(expression==='window.cityManager.parks().paused')return true;
  if(expression==='window.__panelCityWrites')return [];
  if(expression.startsWith('localStorage'))return null;
  return true;
 };
 const send=async method=>{if(method==='Page.navigate'||method==='Page.reload')active=false;};
 const button=async selector=>{
  if(selector==='.guest-entry-card button'){await server.intercept(request('GET'),sink);active=true;return;}
  assert.equal(selector,'#save');const head=server.active;
  await server.intercept(request('POST',{action:'save',cityId:head.cityId,expectedRevision:head.revision,raw:session,metadata:head.metadata}),sink);
 };
 const until=async()=>{};const ack=await loadPanelCity(server,raw,{send,evaluate,button,until,url});
 assert.equal(ack.raw,raw);assert.equal(ack.revision,1);assert.equal(city.cells.length,672);assert.equal(city.tick,65);
 const saved=await saveAndReloadPanel(server,city,{send,evaluate,button,until});
 assert.equal(saved.raw,session);assert.equal(saved.revision,2);assert.equal(server.reads.at(-1).response.raw,session);
});
test('manual save chain rejects missing ACKs, wrong bytes, wrong revisions and altered retries',()=>{
 const before={cityId:'city',revision:1,raw:'old'},after={cityId:'city',revision:2,raw:'new'};
 const event={requestKey:'key',status:200,command:{action:'save',cityId:'city',expectedRevision:1,raw:'new'},response:{cityId:'city',revision:2,raw:'new'}};
 assert.deepEqual(assertPanelSaveChain(before,after,[event,event],'new'),{beforeRevision:1,afterRevision:2,saves:1});
 for(const bad of [[],[{...event,status:409}],[{...event,command:{...event.command,raw:'different'}}],[{...event,command:{...event.command,expectedRevision:0}}],[{...event,response:{...event.response,raw:'different'}}],[{...event,response:{...event.response,cityId:'other'}}],[event,{...event,requestKey:'different'}],[event,{...event,response:{...event.response,revision:3}}]])assert.throws(()=>assertPanelSaveChain(before,after,bad,'new'));
 assert.throws(()=>assertPanelSaveChain(before,{...after,revision:3},[event],'new'));
});
test('compact historical baseline and candidate paths remain distinct and cancellation is non-destructive',()=>{
 const compact=readFileSync(new URL('./compact-smoke.mjs',import.meta.url),'utf8'),context=readFileSync(new URL('./context-smoke.mjs',import.meta.url),'utf8');
 assert.match(compact,/mode === 'baseline' \? legacyRaw : serialize\(migrated\)/);assert.match(compact,/citymanager\.save\.v1/);assert.match(compact,/panelEntryCity\(fixture\)/);
 assert.equal(compact.includes("dialog button:first-of-type"),false);assert.ok(compact.includes("#save-management-cancel"));assert.ok(compact.includes('Cancel leaves the server head and revision unchanged'));
 for(const source of [compact,context]){assert.ok(source.includes('saveAndReloadPanel(server,'));assert.ok(source.includes('loadPanelCity(server,'));assert.ok(source.includes('installTrafficNetworkFence('));}
});
