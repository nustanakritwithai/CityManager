// Loopback-only traffic acceptance adapter. Reuses the real server service and
// synthetic existing-owner endpoint fixture; never injects an app session.
import assert from 'node:assert/strict';
import {reachTouch} from './touch-reach.mjs';
// Server Save callers wait for exact service raw/revision and client ACK after
// the visible, enabled, hit-tested native click; never use the legacy local-save waiter.
export async function reachTrafficControl(evaluate,button,selector){
 if(selector==='#save')return false;
 return reachTouch(evaluate,button,selector);
}
import {deserializeParkSession} from '../src/park-runtime.ts';
import {createPanelServerFixture,assertNoCityWrites as noPanelCityWrites} from './panel-server-entry-fixture.mjs';
export function assertNavigationSaveChain(before,after,writes){
 assert.ok(before&&after&&!before.deleted&&!after.deleted,'Live heads required across navigation');
 assert.equal(after.raw,before.raw,'Navigation cannot replace acknowledged bytes');assert.equal(after.cityId,before.cityId);
 let revision=before.revision;
 for(const event of writes){
  assert.equal(event.status,200,'Lifecycle save must receive a successful service ACK');
  assert.equal(event.command.action,'save');assert.equal(event.command.cityId,before.cityId);
  assert.equal(event.command.expectedRevision,revision,'Lifecycle writes form an exact revision chain');
  assert.equal(event.command.raw,before.raw,'Lifecycle flush retains exact acknowledged session');
  assert.equal(event.response.raw,before.raw);assert.equal(event.response.cityId,before.cityId);
  assert.equal(event.response.revision,++revision,'Each real ACK advances exactly once');
 }
 assert.equal(after.revision,revision,'Every revision increase must have an observed matching service ACK');
 return {beforeRevision:before.revision,afterRevision:revision,lifecycleSaves:writes.length};
}
export function createTrafficServerFixture(pageUrl){
 const url=new URL(pageUrl);assert.equal(url.protocol,'http:','Traffic fixture requires loopback HTTP');
 let fixture=createPanelServerFixture(pageUrl),navigationAllowed=false,navigation=null;
 const generations=new Map(),outgoingSnapshots=new Map(),retiredWrites=[];
 const writes=[],reads=[],pending=new Set(),navigationEvidence=[];
 const intercept=(params,send)=>{
  const work=(async()=>{
   const post=new URL(params.request.url).pathname==='/citymanager-api/v1/city-save'&&params.request.method==='POST';
   const get=new URL(params.request.url).pathname==='/citymanager-api/v1/city-save'&&params.request.method==='GET';
   const event=post?{command:JSON.parse(params.request.postData)}:get?{}:null;
   const target=post?(generations.get(event.command.cityId)??fixture):fixture,retired=target!==fixture;
   const previous=retired?target.active:null;
   if(retired){assert.equal(event.command.action,'save','Retired scenario permits only lifecycle Save');assert.ok(outgoingSnapshots.has(event.command.cityId),'Retired Save requires an observed outgoing session');assert.equal(event.command.raw,outgoingSnapshots.get(event.command.cityId),'Retired lifecycle Save matches exact observed outgoing session');retiredWrites.push(event);}
   else if(post)writes.push(event);else if(get)reads.push(event);
   const handled=await target.intercept(params,async(method,payload)=>{
    if(event&&method==='Fetch.fulfillRequest'){event.status=payload.responseCode;event.response=JSON.parse(Buffer.from(payload.body,'base64').toString());}
    return send(method,payload);
   });
   if(post)assert.equal(event.status,200,'Unexpected rejected traffic save');
   if(retired)assertNavigationSaveChain({...previous,raw:outgoingSnapshots.get(event.command.cityId)},target.active,[event]);
   return handled;
  })();pending.add(work);void work.finally(()=>pending.delete(work)).catch(()=>{});return work;
 };
 const settle=async()=>{const deadline=Date.now()+30000;while(pending.size){if(Date.now()>=deadline)throw Error('Traffic server requests did not settle');await Promise.race([Promise.all([...pending]),new Promise(r=>setTimeout(r,80))]);}};
 const seed=async raw=>{
  await settle();navigation=null;writes.length=0;reads.length=0;
  const restored=deserializeParkSession(raw); // Validate the actual full-session contract, not a version label.
  const priorCityId=fixture.active?.cityId;const next=createPanelServerFixture(pageUrl),ack=await next.seed(raw);
  assert.equal(generations.has(ack.cityId),false,'Scenario identity must be globally fresh');fixture=next;generations.set(ack.cityId,next);
  if(priorCityId)assert.notEqual(ack.cityId,priorCityId,'Each reseeded scenario has a fresh service city identity');
  assert.equal(ack.raw,raw);assert.equal(ack.metadata.tick,restored.city.tick);
  assert.equal(ack.metadata.population,restored.city.households.reduce((n,h)=>n+h.members,0));
  return ack;
 };
 const permitBeforeUnload=()=>{navigationAllowed=true;navigation={head:fixture.active,cursor:writes.length};};
 const dialog=async(params,send)=>{
  assert.ok(navigationAllowed&&params.type==='beforeunload','Only explicit traffic fixture navigation may accept beforeunload');
  navigationAllowed=false;await send('Page.handleJavaScriptDialog',{accept:true});
 };
 const assertDurable=(raw,revision)=>{
  const head=fixture.active;assert.ok(head&&!head.deleted,'An acknowledged server head is required');
  assert.equal(head.raw,raw,'Traffic fixture retains exact acknowledged server bytes');
  if(revision!==undefined)assert.equal(head.revision,revision,'Server revision is unchanged without a save');
  return head;
 };
 const navigationRetries=[];
 const readEntry=async(evaluate,expression)=>{
  try{return await evaluate(expression);}catch(error){
   let detail=error.cdpError;try{detail??=JSON.parse(error.message);}catch{/* Not a CDP JSON error. */}
   if(detail?.code!==-32000||!['Inspected target navigated or closed','Execution context was destroyed.','Cannot find context with specified id'].includes(detail.message))throw error;
   navigationRetries.push({expression,message:detail.message});return false;
  }
 };
 const enter=async({evaluate,button,timeout=30000})=>{
  const baseline=navigation??{head:fixture.active,cursor:writes.length},head=baseline.head;assert.ok(head&&!head.deleted,'Seed through real server ACK before navigation');
  const deadline=Date.now()+timeout;
  const wait=async expression=>{while(Date.now()<deadline){if(await readEntry(evaluate,expression))return;await new Promise(r=>setTimeout(r,80));}throw Error('Traffic server entry timeout: '+expression);};
  try{
   await wait("!!document.querySelector('.guest-entry-card button:not(:disabled)')");
   await settle();const readStart=reads.length;await button('.guest-entry-card button');
   await wait('!!window.cityManager&&window.cityManager.visuals().ready');
   await settle();navigationEvidence.push(assertNavigationSaveChain(head,fixture.active,writes.slice(baseline.cursor)));
   const loaded=reads.slice(readStart).at(-1);assert.equal(loaded?.status,200,'Entry must read a real acknowledged server head');assert.deepEqual(loaded.response,fixture.active,'Entered GET must match final durable revision, not an older racing head');
   await noPanelCityWrites(evaluate);
   return fixture.active;
  }finally{navigationAllowed=false;navigation=null;}
 };
 const leave=async({send,evaluate,until})=>{
  if(!await evaluate('!!window.cityManager'))return;
  await noPanelCityWrites(evaluate);assert.equal(await evaluate('window.cityManager.parks().paused'),true,'Scenario must be paused before capturing outgoing bytes');const outgoing=await evaluate('window.cityManager.sessionSnapshot()');deserializeParkSession(outgoing);outgoingSnapshots.set(fixture.active.cityId,outgoing);permitBeforeUnload();await send('Page.navigate',{url:'about:blank'});
  await until("location.href==='about:blank'");await settle();navigation=null;navigationAllowed=false;
 };
 return {seed,intercept,leave,settle,writes,reads,navigationEvidence,install:fixture.install,get requests(){return [...generations.values()].flatMap(f=>f.requests);},
  permitBeforeUnload,allowNavigation:permitBeforeUnload,dialog,enter,assertDurable,navigationRetries,
  assertNoCityWrites:noPanelCityWrites,get evidence(){return {activeRevision:fixture.active?.revision,generations:generations.size,retiredWrites:retiredWrites.map(e=>({cityId:e.command.cityId,expectedRevision:e.command.expectedRevision,status:e.status,ackRevision:e.response?.revision})),navigationEvidence,writes:writes.map(e=>({action:e.command.action,cityId:e.command.cityId,expectedRevision:e.command.expectedRevision,rawBytes:Buffer.byteLength(e.command.raw??''),status:e.status,ackRevision:e.response?.revision})),reads:reads.map(e=>({status:e.status,revision:e.response?.revision,cityId:e.response?.cityId}))};},get active(){return fixture.active;}};
}

// Diagnostic only: every failed interception remains a failure. Keep no headers,
// cookies, bodies or player bytes; bounded synthetic request lifecycle metadata.
export function createTrafficNetworkAudit(context=()=>null){
 const events=[],failures=[];let seq=0;
 const record=event=>{const entry={seq:++seq,at:Date.now(),...event};events.push(entry);if(events.length>160)events.shift();for(const failure of failures)if(entry.id&&entry.id===failure.networkId){failure.events.push(entry);if(failure.events.length>40)failure.events.shift();}};
 return {
  observe(method,p){
   if(method==='Network.requestWillBeSent')record({event:method,id:p.requestId,url:p.request.url,method:p.request.method,frameId:p.frameId,loaderId:p.loaderId});
   else if(method==='Network.loadingFailed')record({event:method,id:p.requestId,canceled:p.canceled,errorText:p.errorText,type:p.type});
   else if(method==='Page.frameNavigated')record({event:method,frameId:p.frame.id,url:p.frame.url,loaderId:p.frame.loaderId});
  },
  bind(p,send){
   const request={requestId:p.requestId,networkId:p.networkId,url:p.request.url,method:p.request.method,resourceType:p.resourceType,frameId:p.frameId,context:context()};record({event:'Fetch.requestPaused',...request});
   return async(method,params)=>{try{return await send(method,params);}catch(error){const failure={...request,command:method,responseCode:params.responseCode,error:String(error),events:events.slice(-40)};failures.push(failure);if(failures.length>32)failures.shift();error.message+='; interception='+JSON.stringify(failure);throw error;}};
  },
  get evidence(){return {events:structuredClone(events),failures:structuredClone(failures)};}
 };
}
