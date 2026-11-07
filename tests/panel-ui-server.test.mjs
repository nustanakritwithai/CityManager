import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createTrafficServerFixture} from './traffic-server-entry-fixture.mjs';
import {assertPanelSaveChain,loadPanelCity,panelEntryCity,saveAndReloadPanel,panelSaveEvidence} from './panel-ui-server.mjs';
import {deserialize,serialize} from '../src/sim.ts';
import {createParkRuntime,serializeParkSession} from '../src/park-runtime.ts';

const url='http://127.0.0.1:4173/CityManager/', historical=readFileSync(new URL('./fixtures/legacy-v1-day65.json',import.meta.url),'utf8'), raw=serialize(deserialize(historical));
const request=(method,body)=>({requestId:randomUUID(),request:{url:new URL('/citymanager-api/v1/city-save',url).href,method,headers:{'Idempotency-Key':randomUUID()},postData:body&&JSON.stringify(body)}});
const sink=async()=>{};
const acknowledgedLabels=['บันทึกบนเซิร์ฟเวอร์แล้ว','ตรวจสอบแล้วว่าเซฟบนเซิร์ฟเวอร์ตรงกัน'];
for(const settledLabel of acknowledgedLabels)test(`historical native Save ACK and full reload remain exact when UI settles as ${settledLabel}`,async()=>{
 const server=createTrafficServerFixture(url), city=panelEntryCity(raw), session=serializeParkSession(city,createParkRuntime(city));let active=false,manualSuccess=false;
 const evaluate=async expression=>{
  if(expression==='!!window.cityManager')return active;
  if(expression==='window.cityManager.snapshot()')return serialize(city);
  if(expression==='window.cityManager.sessionSnapshot()')return session;
  if(expression==='window.cityManager.parks().paused')return true;
  if(expression==='window.__panelCityWrites')return [];
  if(expression.startsWith('localStorage'))return null;
  if(expression.includes('#inspector-status'))return manualSuccess;
  return true;
 };
 const send=async method=>{if(method==='Page.navigate'||method==='Page.reload')active=false;};
 const button=async selector=>{
  if(selector==='.guest-entry-card button'){await server.intercept(request('GET'),sink);active=true;return;}
  assert.equal(selector,'#save');const head=server.active;
  await server.intercept(request('POST',{action:'save',cityId:head.cityId,expectedRevision:head.revision,raw:session,metadata:head.metadata}),sink);
  manualSuccess=true;
 };
 let acknowledgedUiChecks=0;
 const until=async expression=>{
  if(expression.includes('#inspector-status')){assert.equal(manualSuccess,true);return;}
  if(!expression.includes('#autosave-status'))return;
  acknowledgedUiChecks++;
  // Exercise the actual expression sent to the browser, not a parallel copy.
  const predicate=new Function('document',`return ${expression};`);
  const matches=(text,failureVisible=false)=>predicate({querySelector(selector){
   if(selector==='#autosave-status')return text===undefined?null:{textContent:text};
   assert.equal(selector,'#save-failure-banner:not([hidden])');return failureVisible?{}:null;
  }});
  assert.equal(matches(settledLabel+'11:13:29'),true,'A current exact ACK may be followed by the queued verification label');
  for(const label of acknowledgedLabels){
   assert.equal(matches(label+' 12:00:00'),true);
   assert.equal(matches(label,true),false,'A visible failure always blocks settled UI');
  }
  for(const text of [undefined,null,'','กำลังบันทึก…','กำลังบันทึก… · บันทึกบนเซิร์ฟเวอร์แล้ว','บันทึกไม่สำเร็จ · ตรวจสอบแล้วว่าเซฟบนเซิร์ฟเวอร์ตรงกัน','ยืนยันเซฟก่อนหน้าแล้ว · มีการเปลี่ยนแปลงใหม่ที่ยังไม่บันทึก','ยังไม่มีการบันทึกสำเร็จในรอบนี้'])assert.equal(matches(text),false,'Only a current acknowledged prefix may settle: '+text);
 };
 const ack=await loadPanelCity(server,raw,{send,evaluate,button,until,url});
 assert.equal(ack.raw,raw);assert.equal(ack.revision,1);assert.equal(city.cells.length,672);assert.equal(city.tick,65);
 const saved=await saveAndReloadPanel(server,city,{send,evaluate,button,until});
 assert.equal(acknowledgedUiChecks,1,'The actual acknowledgement predicate is checked before reload');
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

test('panel Save failure evidence is bounded and never exposes raw data, IDs or request keys',()=>{
 const before={cityId:'private-city',revision:1,raw:'private-bytes'},event={requestKey:'private-key',status:200,command:{cityId:'private-city',expectedRevision:1,raw:'private-bytes'},response:{cityId:'private-city',revision:2,raw:'private-bytes'}};
 const writes=Array.from({length:60},()=>event),evidence=panelSaveEvidence({active:{...before,revision:2},writes},before,1,'private-bytes');
 assert.equal(evidence.writes.length,40);assert.equal(evidence.writes[0].index,20);assert.equal(evidence.writes[0].repeatedKey,true);assert.equal(evidence.beforeRawMatches,true);assert.equal(evidence.afterRawMatches,true);
 assert.doesNotMatch(JSON.stringify(evidence),/private-(?:city|bytes|key)/);
});

test('panel Save rejects autosave-only acknowledgement and preserves primary failure diagnostics',async()=>{
 const server=createTrafficServerFixture(url),city=panelEntryCity(raw),session=serializeParkSession(city,createParkRuntime(city));await server.seed(session);
 let clicks=0,reloads=0;const primary=Error('Manual completion not observed');
 const evaluate=async expression=>{
  if(expression==='window.cityManager.parks().paused')return true;
  if(expression==='window.cityManager.sessionSnapshot()')return session;
  if(expression.startsWith('document.querySelector'))return false;
  if(expression.includes('savePresent'))return {savePresent:true,disabled:false,visible:true,hit:true,pending:false,failed:false,manualSuccess:false};
  throw Error('Unexpected observation: '+expression);
 };
 const button=async selector=>{assert.equal(selector,'#save');clicks++;const head=server.active;await server.intercept(request('POST',{action:'save',cityId:head.cityId,expectedRevision:head.revision,raw:session,metadata:head.metadata}),sink);};
 await assert.rejects(saveAndReloadPanel(server,city,{evaluate,button,until:async()=>{throw primary;},send:async()=>{reloads++;}}),error=>{
  assert.equal(error,primary);assert.equal(error.panelSaveEvidence.afterRevision,2);assert.equal(error.panelSaveEvidence.writes.length,1);assert.equal(error.panelSaveEvidence.ui.manualSuccess,false);assert.match(error.stack,/Manual completion not observed/);assert.match(error.stack,/Panel Save evidence/);assert.equal(error.stack.includes(session),false);return true;
 });
 assert.equal(clicks,1);assert.equal(reloads,0,'Autosave alone cannot authorize reload');
});
