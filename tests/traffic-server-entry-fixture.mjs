// Loopback-only traffic acceptance adapter. Reuses the real server service and
// synthetic existing-owner endpoint fixture; never injects an app session.
import assert from 'node:assert/strict';
import {deserializeParkSession} from '../src/park-runtime.ts';
import {createPanelServerFixture,assertNoCityWrites as noPanelCityWrites} from './panel-server-entry-fixture.mjs';
export function createTrafficServerFixture(pageUrl){
 const url=new URL(pageUrl);assert.equal(url.protocol,'http:','Traffic fixture requires loopback HTTP');
 const fixture=createPanelServerFixture(pageUrl);let navigationAllowed=false;
 const seed=async raw=>{
  const restored=deserializeParkSession(raw); // Validate the actual full-session contract, not a version label.
  const ack=await fixture.seed(raw);
  assert.equal(ack.raw,raw);assert.equal(ack.metadata.tick,restored.city.tick);
  assert.equal(ack.metadata.population,restored.city.households.reduce((n,h)=>n+h.members,0));
  return ack;
 };
 const permitBeforeUnload=()=>{navigationAllowed=true;};
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
  const head=fixture.active;assert.ok(head&&!head.deleted,'Seed through real server ACK before navigation');
  const deadline=Date.now()+timeout;
  const wait=async expression=>{while(Date.now()<deadline){if(await readEntry(evaluate,expression))return;await new Promise(r=>setTimeout(r,80));}throw Error('Traffic server entry timeout: '+expression);};
  try{
   await wait("!!document.querySelector('.guest-entry-card button:not(:disabled)')");
   await button('.guest-entry-card button');
   await wait('!!window.cityManager&&window.cityManager.visuals().ready');
   assertDurable(head.raw,head.revision);
   await noPanelCityWrites(evaluate);
   return fixture.active;
  }finally{navigationAllowed=false;}
 };
 return {seed,intercept:fixture.intercept,install:fixture.install,requests:fixture.requests,
  permitBeforeUnload,allowNavigation:permitBeforeUnload,dialog,enter,assertDurable,navigationRetries,
  assertNoCityWrites:noPanelCityWrites,get active(){return fixture.active;}};
}
