// Synthetic loopback-only server entry for existing panel UX checks. No real account/network.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createServerCityService} from '../server/city-saves/service.mjs';
export const PANEL_OWNER='11111111-1111-4111-8111-111111111111';
export function createPanelServerFixture(pageUrl){
 const origin=new URL(pageUrl).origin;assert.equal(new URL(origin).hostname,'127.0.0.1');
 let state,service,allowBeforeUnload=false;const requests=[];
 const reset=()=>{
  state={active:null,receipts:new Map()};let tail=Promise.resolve();
  service=createServerCityService({read:async()=>structuredClone(state.active),transaction:(_,work)=>{
   const job=tail.then(async()=>{const next=structuredClone(state);const result=await work({current:async()=>next.active,deletionFence:async()=>0,wasRetired:async()=>false,request:async id=>next.receipts.get(id),requestCount:async()=>next.receipts.size,bytes:async()=>0,publish:async value=>{next.active=structuredClone(value);},record:async(id,payloadHash,response)=>{next.receipts.set(id,{payloadHash,response:structuredClone(response)});}});state=next;return result;});tail=job.catch(()=>{});return job;
  }});
 };
 reset();
 const seed=async raw=>{reset();const city=JSON.parse(raw),cityId=city.market?.cityId??randomUUID();assert.ok(!city.market?.guestId||city.market.guestId===PANEL_OWNER,'Only synthetic fixture Guest');const ack=await service.mutate(PANEL_OWNER,randomUUID(),{action:'create',cityId,raw,metadata:{name:'panel acceptance fixture',tick:city.tick,population:city.households?.reduce((n,h)=>n+h.members,0)??0}});assert.equal(ack.raw,raw);return ack;};
 const intercept=async(params,send)=>{
  const target=new URL(params.request.url);if(!target.pathname.startsWith('/citymanager-api/'))return false;
  assert.equal(target.origin,origin,'Never mock an external account');
  let response,status=200;const path=target.pathname.slice('/citymanager-api'.length);requests.push({method:params.request.method,path});
  try{
   if(path==='/v1/me'&&params.request.method==='GET')response={guest_id:PANEL_OWNER};
   else if(path==='/v1/city-save'&&params.request.method==='GET')response=await service.read(PANEL_OWNER);
   else if(path==='/v1/city-save'&&params.request.method==='POST'){
    const key=Object.entries(params.request.headers).find(([k])=>k.toLowerCase()==='idempotency-key')?.[1];response=await service.mutate(PANEL_OWNER,key,JSON.parse(params.request.postData));
   }else throw Object.assign(Error('unexpected panel fixture endpoint'),{status:404});
  }catch(error){status=error.status??500;response={error:error.message};}
  await send('Fetch.fulfillRequest',{requestId:params.requestId,responseCode:status,responseHeaders:[{name:'Content-Type',value:'application/json'}],body:Buffer.from(JSON.stringify(response)).toString('base64')});return true;
 };
 const dialog=async(params,send)=>{assert.ok(allowBeforeUnload&&params.type==='beforeunload','Only explicit fixture reseed navigation may accept a dialog');allowBeforeUnload=false;await send('Page.handleJavaScriptDialog',{accept:true});};
 const install=async send=>send('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{window.__panelCityWrites=[];const city=/^citymanager\\.(save\\.|backup\\.|checkpoint\\.|resume-choice)/;for(const method of ['setItem','removeItem','clear']){const original=Storage.prototype[method];Storage.prototype[method]=function(...args){if(method==='clear'||city.test(String(args[0])))window.__panelCityWrites.push(method+':'+args[0]);return original.apply(this,args);};}})()`});
 const load=async(raw,{send,evaluate,button,url})=>{
  const ack=await seed(raw);allowBeforeUnload=true;await send('Page.navigate',{url});
  const wait=async expression=>{const start=Date.now();while(Date.now()-start<30000){try{if(await evaluate(expression))return;}catch(error){let details;try{details=JSON.parse(error.message);}catch{}if(details?.code!==-32000||!['Inspected target navigated or closed','Execution context was destroyed.','Cannot find context with specified id'].includes(details.message))throw error;}await new Promise(r=>setTimeout(r,80));}throw Error('Panel authenticated entry timeout: '+expression);};
  await wait("!!document.querySelector('.guest-entry-card button:not(:disabled)')");await button('.guest-entry-card button');await wait('!!window.cityManager&&window.cityManager.visuals().ready');allowBeforeUnload=false;
  assert.equal(state.active.raw,raw,'Entry reads exact acknowledged server head without rewrite');
  await assertNoCityWrites(evaluate);return ack;
 };
 return {seed,intercept,dialog,install,load,requests,get active(){return structuredClone(state.active);}};
}
export async function assertNoCityWrites(evaluate){assert.deepEqual(await evaluate('window.__panelCityWrites'),[],'Panel flow never writes browser city copies');assert.equal(await evaluate('localStorage.getItem("citymanager.save.v7")'),null,'No local city seed or fallback');}
