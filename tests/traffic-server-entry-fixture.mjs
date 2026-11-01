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
 const fixture=createPanelServerFixture(pageUrl);let navigationAllowed=false,navigation=null;
 const writes=[],reads=[],pending=new Set(),navigationEvidence=[];
 const intercept=(params,send)=>{
  const work=(async()=>{
   const post=new URL(params.request.url).pathname==='/citymanager-api/v1/city-save'&&params.request.method==='POST';
   const get=new URL(params.request.url).pathname==='/citymanager-api/v1/city-save'&&params.request.method==='GET';
   const event=post?{command:JSON.parse(params.request.postData)}:get?{}:null;
   if(post)writes.push(event);else if(get)reads.push(event);
   const handled=await fixture.intercept(params,async(method,payload)=>{
    if(event&&method==='Fetch.fulfillRequest'){event.status=payload.responseCode;event.response=JSON.parse(Buffer.from(payload.body,'base64').toString());}
    return send(method,payload);
   });
   if(post)assert.equal(event.status,200,'Unexpected rejected traffic save (including a stale outgoing scenario)');
   return handled;
  })();pending.add(work);void work.finally(()=>pending.delete(work)).catch(()=>{});return work;
 };
 const settle=async()=>{const deadline=Date.now()+30000;while(pending.size){if(Date.now()>=deadline)throw Error('Traffic server requests did not settle');await Promise.race([Promise.all([...pending]),new Promise(r=>setTimeout(r,80))]);}};
 const seed=async raw=>{
  await settle();navigation=null;writes.length=0;reads.length=0;
  const restored=deserializeParkSession(raw); // Validate the actual full-session contract, not a version label.
  const priorCityId=fixture.active?.cityId;const ack=await fixture.seed(raw);
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
  await noPanelCityWrites(evaluate);permitBeforeUnload();await send('Page.navigate',{url:'about:blank'});
  await until("location.href==='about:blank'");await settle();navigation=null;navigationAllowed=false;
 };
 return {seed,intercept,leave,settle,writes,reads,navigationEvidence,install:fixture.install,requests:fixture.requests,
  permitBeforeUnload,allowNavigation:permitBeforeUnload,dialog,enter,assertDurable,navigationRetries,
  assertNoCityWrites:noPanelCityWrites,get evidence(){return {activeRevision:fixture.active?.revision,navigationEvidence,writes:writes.map(e=>({action:e.command.action,cityId:e.command.cityId,expectedRevision:e.command.expectedRevision,rawBytes:Buffer.byteLength(e.command.raw??''),status:e.status,ackRevision:e.response?.revision})),reads:reads.map(e=>({status:e.status,revision:e.response?.revision,cityId:e.response?.cityId}))};},get active(){return fixture.active;}};
}
