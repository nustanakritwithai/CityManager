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
import {deserializeParkSession,expandValidatedParkSession} from '../src/park-runtime.ts';
/** Match the app's validated 24×24 → 24×28 session migration without modifying the server ACK. */
export const loadedTrafficSession = raw => expandValidatedParkSession(deserializeParkSession(raw));
/** Compare all saved economic state against the actual validated live migration. */
export const assertTrafficAutosaveCity = (raw, restoredCity) => {
 const expected = loadedTrafficSession(raw).city;
 assert.equal(serialize(restoredCity),serialize(expected),'Autosave changes runtime, not economic City');
 return expected;
};
import {serialize} from '../src/sim.ts';
import {createPanelServerFixture,assertNoCityWrites as noPanelCityWrites} from './panel-server-entry-fixture.mjs';
export function assertNavigationSaveChain(before,after,writes,priorWrites=[],outgoingRaw=before.raw){
 assert.ok(before&&after&&!before.deleted&&!after.deleted,'Live heads required across navigation');
 assert.equal(after.cityId,before.cityId);
 let revision=before.revision, lifecycleSaves=0, latestRaw=before.raw;
 const acknowledged=new Map();
 for(const event of priorWrites){
  if(event.requestKey&&event.status===200&&event.command?.cityId===before.cityId&&event.response?.cityId===before.cityId&&event.response?.revision<=before.revision){
   const existing=acknowledged.get(event.requestKey);
   if(existing){assert.deepEqual(event.command,existing.command,'Repeated key must have the exact same command');assert.deepEqual(event.response,existing.response,'Repeated key must have the exact same ACK');}
   else acknowledged.set(event.requestKey,event);
  }
 }
 for(const event of writes){
  assert.equal(event.status,200,'Lifecycle save must receive a successful service ACK');
  assert.equal(event.command.action,'save');assert.equal(event.command.cityId,before.cityId);
  assert.equal(event.response.cityId,before.cityId);
  const previous=event.requestKey&&acknowledged.get(event.requestKey);
  if(previous){
   assert.deepEqual(event.command,previous.command,'Repeated key must have the exact same command');
   assert.deepEqual(event.response,previous.response,'Repeated key must have the exact same ACK');
   assert.ok(event.response.revision<=revision,'Retried ACK cannot refer to a future revision');
   continue;
  }
  assert.equal(event.command.expectedRevision,revision,'Lifecycle writes form an exact revision chain');
  assert.equal(event.command.raw,outgoingRaw,'Lifecycle flush must match the captured outgoing session');
  assert.equal(event.response.raw,outgoingRaw,'Service ACK must retain the captured outgoing bytes');
  assert.equal(event.response.revision,++revision,'Each real ACK advances exactly once');
  latestRaw=outgoingRaw;lifecycleSaves++;if(event.requestKey)acknowledged.set(event.requestKey,event);
 }
 assert.equal(after.revision,revision,'Every revision increase must have an observed matching service ACK');
 assert.equal(after.raw,latestRaw,'Final durable bytes must match the last verified ACK');
 return {beforeRevision:before.revision,afterRevision:revision,lifecycleSaves};
}
// Validate every post-click ACK, including a later same-session save arriving
// while the browser reports the first ACK. Navigation begins from the actual
// last observed head, never from a stale status-wait snapshot.
const MANUAL_SAVE_SUCCESS='บันทึกเมืองบนเซิร์ฟเวอร์แล้ว · ตลาดยังปิดอยู่';
// The game-menu status is produced only after the actual native Save handler
// has awaited its explicit server save. An autosave badge alone is not proof.
export async function completeTrafficManualSave(evaluate,button,until){
 const expression=`document.querySelector('#inspector-status')?.textContent===${JSON.stringify(MANUAL_SAVE_SUCCESS)}`;
 assert.equal(await evaluate(expression),false,'Manual success must be fresh before the click');
 await button('#save');
 await until(expression);
}
export function assertTrafficManualSaveChain(before,acknowledged,after,writes,priorWrites,raw){
 assert.ok(acknowledged&&acknowledged.revision>before.revision,'Manual save must advance the server revision');
 assert.equal(acknowledged.cityId,before.cityId);assert.equal(acknowledged.raw,raw);
 assert.ok(writes.some(e=>e.status===200&&e.response?.cityId===before.cityId&&e.response?.revision===acknowledged.revision&&e.response?.raw===raw),'Manual saved revision requires its exact observed ACK');
 const chain=assertNavigationSaveChain(before,after,writes,priorWrites,raw);
 assert.ok(acknowledged.revision<=after.revision,'Manual ACK cannot exceed the durable navigation baseline');
 assert.ok(chain.lifecycleSaves>0,'Manual save must produce an observed new revision');
 return chain;
}
export function createTrafficServerFixture(pageUrl){
 const url=new URL(pageUrl);assert.equal(url.protocol,'http:','Traffic fixture requires loopback HTTP');
 let fixture=createPanelServerFixture(pageUrl),navigationAllowed=false,navigation=null;
 const generations=new Map(),outgoingSnapshots=new Map(),retiredWrites=[],archivedWrites=new Map();
 const writes=[],reads=[],pending=new Set(),navigationEvidence=[];
 const intercept=(params,send)=>{
  const work=(async()=>{
   const post=new URL(params.request.url).pathname==='/citymanager-api/v1/city-save'&&params.request.method==='POST';
   const get=new URL(params.request.url).pathname==='/citymanager-api/v1/city-save'&&params.request.method==='GET';
   const event=post?{command:JSON.parse(params.request.postData),requestKey:Object.entries(params.request.headers??{}).find(([name])=>name.toLowerCase()==='idempotency-key')?.[1]}:get?{}:null;
   const target=post?(generations.get(event.command.cityId)??fixture):fixture,retired=target!==fixture;
   const previous=retired?target.active:null;
   if(retired){assert.equal(event.command.action,'save','Retired scenario permits only lifecycle Save');assert.ok(outgoingSnapshots.has(event.command.cityId),'Retired Save requires an observed outgoing session');assert.equal(event.command.raw,outgoingSnapshots.get(event.command.cityId),'Retired lifecycle Save matches exact observed outgoing session');retiredWrites.push(event);}
   else if(post)writes.push(event);else if(get)reads.push(event);
   const handled=await target.intercept(params,async(method,payload)=>{
    if(event&&method==='Fetch.fulfillRequest'){event.status=payload.responseCode;event.response=JSON.parse(Buffer.from(payload.body,'base64').toString());}
    return send(method,payload);
   });
   if(post)assert.equal(event.status,200,'Unexpected rejected traffic save');
   if(retired)assertNavigationSaveChain({...previous,raw:outgoingSnapshots.get(event.command.cityId)},target.active,[event],[...(archivedWrites.get(event.command.cityId)??[]),...retiredWrites.filter(e=>e!==event)]);
   return handled;
  })();pending.add(work);void work.finally(()=>pending.delete(work)).catch(()=>{});return work;
 };
 const settle=async()=>{const deadline=Date.now()+30000;while(pending.size){if(Date.now()>=deadline)throw Error('Traffic server requests did not settle');await Promise.race([Promise.all([...pending]),new Promise(r=>setTimeout(r,80))]);}};
 const seed=async raw=>{
  await settle();navigation=null;
  if(fixture.active?.cityId)archivedWrites.set(fixture.active.cityId,[...writes]);
  writes.length=0;reads.length=0;
  const restored=deserializeParkSession(raw); // Validate the actual full-session contract, not a version label.
  const priorCityId=fixture.active?.cityId;const next=createPanelServerFixture(pageUrl),ack=await next.seed(raw);
  assert.equal(generations.has(ack.cityId),false,'Scenario identity must be globally fresh');fixture=next;generations.set(ack.cityId,next);
  if(priorCityId)assert.notEqual(ack.cityId,priorCityId,'Each reseeded scenario has a fresh service city identity');
  assert.equal(ack.raw,raw);assert.equal(ack.metadata.tick,restored.city.tick);
  assert.equal(ack.metadata.population,restored.city.households.reduce((n,h)=>n+h.members,0));
  return ack;
 };
 const permitBeforeUnload=(outgoingRaw)=>{
  if(outgoingRaw!==undefined){
   const current=deserializeParkSession(outgoingRaw);
   assertTrafficAutosaveCity(fixture.active.raw,current.city);
  }
  navigationAllowed=true;navigation={head:fixture.active,cursor:writes.length,outgoingRaw};
 };
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
   await settle();try{navigationEvidence.push(assertNavigationSaveChain(head,fixture.active,writes.slice(baseline.cursor),writes.slice(0,baseline.cursor),baseline.outgoingRaw??head.raw));}
   catch(error){
    // Preserve the original failing assertion and attach only synthetic request
    // metadata. In particular, never log raw city bytes or the request key.
    const detail={baselineRevision:head.revision,finalRevision:fixture.active?.revision,cursor:baseline.cursor,totalWrites:writes.length,writes:writes.slice(-40).map((event,offset)=>{const index=Math.max(0,writes.length-40)+offset;return {index,status:event.status,expectedRevision:event.command?.expectedRevision,ackRevision:event.response?.revision,repeatedKey:!!event.requestKey&&writes.slice(0,index).some(other=>other.requestKey===event.requestKey)};})};
    // AssertionError caches its stack before message mutation; print the bounded
    // metadata separately so CI logs retain the same non-sensitive evidence.
    console.error('Traffic lifecycle metadata:',JSON.stringify(detail));
    error.message+=`; lifecycle=${JSON.stringify(detail)}`;throw error;
   }
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

// Native HTTP transport: page-exit keepalive requests outlive their CDP Fetch IDs.
// Reuse exactly the same real-service adapter; never mock a successful ACK.
// Bounded structural diagnostics only. Never retain paths, bodies, headers,
// request keys, city IDs, error messages or stacks. Every error still fails audit.
export function recordFixtureHttpFailure(error,{req,res,errors,failureDetails,kind,phase,bodyBytes,bodyComplete,serviceStatus=null}){
 const errorName=['Error','TypeError','SyntaxError','AbortError','TimeoutError','AssertionError'].includes(error?.name)?error.name:'OtherError';
 const codes=['ECONNRESET','ETIMEDOUT','ABORT_ERR','UND_ERR_SOCKET'];
 const errorCode=codes.includes(error?.code)?error.code:null,causeCode=codes.includes(error?.cause?.code)?error.cause.code:null;
 errors.push(`Fixture transport failure: ${errorName}${errorCode?` (${errorCode})`:''}`);
 failureDetails.push({kind,phase,method:['GET','HEAD','POST'].includes(req.method)?req.method:'OTHER',bodyBytes,bodyComplete,requestComplete:req.complete??null,requestAborted:req.aborted??null,responseHeadersSent:res.headersSent,responseFinished:res.writableFinished??null,responseDestroyed:res.destroyed??null,serviceStatus,errorName,errorCode,causeCode});
 if(failureDetails.length>32)failureDetails.shift();
}
export function trafficHttpHandler({origin,upstream,fixture,errors,deliveries,failureDetails=[],forward=fetch}){
 const base=new URL(upstream);assert.equal(base.hostname,'127.0.0.1');assert.equal(base.protocol,'http:');
 return async(req,res)=>{let kind='unvalidated',phase='validate',bodyBytes=0,bodyComplete=false,serviceStatus=null;try{
  assert.equal(req.headers.host,new URL(origin).host,'Only the exact isolated fixture host is served');
  const target=new URL(req.url,origin);assert.equal(target.origin,origin);assert.ok(req.url.startsWith('/')&&!req.url.startsWith('//'));
  if(target.pathname==='/__traffic_network_fence_page'){kind='fence';assert.equal(req.method,'GET');res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><title>Isolated network fence</title>');return;}
  if(target.pathname.startsWith('/citymanager-api/')){
   kind=target.pathname==='/citymanager-api/v1/city-save'?'city-save':'other-api';phase='read-body';
   let data='';for await(const chunk of req){data+=chunk;bodyBytes+=Buffer.byteLength(chunk);assert.ok(Buffer.byteLength(data)<=10*1024*1024,'Bounded fixture request');}
   bodyComplete=true;phase='service';
   const record={method:req.method,path:target.pathname,finished:false,closed:false};deliveries.push(record);
   res.once('finish',()=>{record.finished=true;});res.once('close',()=>{record.closed=true;});
   assert.equal(await fixture.intercept({requestId:'http-'+deliveries.length,request:{url:target.href,method:req.method,headers:req.headers,postData:data}},async(method,payload)=>{
    assert.equal(method,'Fetch.fulfillRequest');record.status=payload.responseCode;serviceStatus=payload.responseCode;phase='respond';
    res.writeHead(payload.responseCode,Object.fromEntries(payload.responseHeaders.map(h=>[h.name,h.value])));res.end(Buffer.from(payload.body,'base64'));
   }),true);
   return;
  }
  kind='asset';phase='validate-asset';assert.ok(req.method==='GET'||req.method==='HEAD','Asset forwarding is read-only');
  const asset=new URL(target.pathname+target.search,base);assert.equal(asset.origin,base.origin,'No external forwarding');
  phase='forward-asset';const response=await forward(asset,{method:req.method,redirect:'manual',signal:AbortSignal.timeout(30000)});
  assert.ok(response.status<300||response.status>=400,'Fixture assets cannot redirect');
  const headers={};for(const [key,value] of response.headers)if(!['content-encoding','content-length','transfer-encoding','connection'].includes(key))headers[key]=value;
  phase='read-asset';res.writeHead(response.status,headers);res.end(req.method==='HEAD'?undefined:Buffer.from(await response.arrayBuffer()));
 }catch(error){
  recordFixtureHttpFailure(error,{req,res,errors,failureDetails,kind,phase,bodyBytes,bodyComplete,serviceStatus});
  if(!res.headersSent&&!res.destroyed)res.writeHead(500,{'Content-Type':'text/plain'});if(!res.destroyed)res.end('Isolated fixture request failed');
 }};
}
export async function startTrafficHttpFixture(upstream){
 const source=new URL(upstream);assert.equal(source.hostname,'127.0.0.1');assert.equal(source.protocol,'http:');assert.equal(source.username,'');assert.equal(source.password,'');
 const {createServer}=await import('node:http');const errors=[],deliveries=[];let handler;
 const server=createServer((req,res)=>handler(req,res));
 await new Promise((ok,bad)=>{server.once('error',bad);server.listen(0,'127.0.0.1',ok);});
 const origin=`http://127.0.0.1:${server.address().port}`,url=new URL(new URL(upstream).pathname,origin).href,fixture=createTrafficServerFixture(url);
 handler=trafficHttpHandler({origin,upstream,fixture,errors,deliveries});
 return {url,fixture,errors,deliveries,async close(){server.closeAllConnections();await new Promise((ok,bad)=>server.close(error=>error?bad(error):ok()));}};
}
export function trafficNetworkRules(origin,blockedModels=false,additionalBlocked=[]){
 const url=new URL(origin);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.protocol,'http:');
 return [ ...additionalBlocked.map(urlPattern=>({urlPattern,block:true})), ...(blockedModels?[{urlPattern:origin+'/CityManager/assets/kenney-city/models/*.glb',block:true}]:[]),
  {urlPattern:origin+'/*',block:false},{urlPattern:'http://*:*/*',block:true},{urlPattern:'https://*:*/*',block:true}];
}
export async function installTrafficNetworkFence({send,evaluate,protocol,origin,blockedModels=false,additionalBlocked=[],observeProbe}){
 const command=protocol.domains.find(d=>d.domain==='Network')?.commands.find(c=>c.name==='setBlockedURLs');
 assert.ok(command?.parameters.some(p=>p.name==='urlPatterns'),'Browser must support ordered fail-closed network rules');
 await send('Network.setBlockedURLs',{urlPatterns:trafficNetworkRules(origin,blockedModels,additionalBlocked)});
 await send('Page.navigate',{url:origin+'/__traffic_network_fence_page'});
 const readyDeadline=Date.now()+5000;while(!await evaluate(`location.origin===${JSON.stringify(origin)}&&document.readyState==='complete'`)){assert.ok(Date.now()<readyDeadline,'Native fixture fence page must load');await new Promise(r=>setTimeout(r,20));}
 // A different loopback origin proves blocking without contacting any external host.
 const probe=origin.replace('127.0.0.1','localhost')+'/__traffic_network_fence_probe';
 const evidence=observeProbe(probe);evidence.active=true;
 const result=await evaluate(`fetch(${JSON.stringify(probe)}).then(()=>false,()=>true)`);assert.equal(result,true,'Other-origin request must be blocked');
 const deadline=Date.now()+5000;while(!evidence.failed&&Date.now()<deadline)await new Promise(r=>setTimeout(r,20));
 assert.equal(evidence.failed?.blockedReason,'inspector','Must be CDP block, not DNS/CORS/connection failure');evidence.active=false;
 return {rules:trafficNetworkRules(origin,blockedModels,additionalBlocked),probe:evidence};
}
