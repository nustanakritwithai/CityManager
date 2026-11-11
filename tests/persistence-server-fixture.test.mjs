import test from 'node:test';import assert from 'node:assert/strict';import{randomUUID}from'node:crypto';
import {startPersistenceFixture} from './persistence-server-fixture.mjs';
import {createServer} from 'node:http';
test('loopback persistence fixture creates a real service ACK and injected failure cannot change its head',async()=>{
 const upstream=createServer((req,res)=>res.end('fixture'));await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
 const f=await startPersistenceFixture(`http://127.0.0.1:${upstream.address().port}/CityManager/`);
 try{
  const {createCity,serialize}=await import('../src/sim.ts');const raw=serialize(createCity(61025));
  const ack=await f.fixture.seed(raw);assert.equal(ack.revision,1);assert.equal(ack.raw,raw);
  const before=f.fixture.active,key=randomUUID(),command={action:'save',cityId:ack.cityId,expectedRevision:ack.revision,raw,metadata:ack.metadata};
  const post=(requestKey,body)=>fetch(new URL('/citymanager-api/v1/city-save',f.url),{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':requestKey},body:JSON.stringify(body)});
  f.setSaveFailure(true);const res=await post(key,command);
  assert.equal(res.status,503);assert.deepEqual(await res.json(),{error:'synthetic-save-unavailable'});assert.deepEqual(f.fixture.active,before);assert.equal(f.rejected.length,1);
  assert.equal(f.rejected[0].requestKey,key);assert.deepEqual(f.rejected[0].command,command);
  f.setSaveFailure(false);const retry=await post(key,command);assert.equal(retry.status,200);const first=await retry.json();assert.equal(first.revision,2);assert.equal(first.raw,raw);
  const next=await post(randomUUID(),{...command,expectedRevision:2});assert.equal(next.status,200);const second=await next.json();assert.equal(second.revision,3);assert.equal(second.raw,raw);
  const read=await fetch(new URL('/citymanager-api/v1/city-save',f.url));assert.equal(read.status,200);assert.deepEqual(await read.json(),second);
  assert.deepEqual(f.errors,[]);
 }finally{await f.close();await new Promise(r=>upstream.close(r));}
});
test('fixture refuses non-loopback upstream',async()=>{await assert.rejects(startPersistenceFixture('https://example.com/'));});

test('persistence fixture exposes normal and synthetic failure diagnostics without payloads',async()=>{
 const upstream=createServer((_req,res)=>res.end('fixture'));await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
 const f=await startPersistenceFixture(`http://127.0.0.1:${upstream.address().port}/CityManager/`);
 try{
  const {createCity,serialize}=await import('../src/sim.ts');const raw=serialize(createCity(61025)),before=await f.fixture.seed(raw);
  const post=()=>fetch(new URL('/citymanager-api/v1/city-save',f.url),{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':'private-key'},body:'private-malformed-body'});
  assert.equal((await post()).status,500);assert.equal(f.failureDetails[0].kind,'city-save');assert.equal(f.failureDetails[0].phase,'service');
  f.setSaveFailure(true);assert.equal((await post()).status,500);assert.equal(f.failureDetails[1].phase,'synthetic-reject');
  for(const detail of f.failureDetails){assert.equal(detail.bodyBytes,22);assert.equal(detail.bodyComplete,true);assert.equal(detail.requestComplete,true);assert.equal(detail.requestAborted,false);assert.equal(detail.serviceStatus,null);assert.equal(detail.errorName,'SyntaxError');}
  assert.equal(f.errors.length,2);assert.throws(()=>assert.deepEqual(f.errors,[]));assert.deepEqual(f.fixture.active,before);assert.deepEqual(f.rejected,[]);
  assert.doesNotMatch(JSON.stringify({errors:f.errors,details:f.failureDetails}),/private-|citymanager-api|idempotency|raw|stack/i);
  const {readFile}=await import('node:fs/promises'),source=await readFile(new URL('agriculture-smoke.mjs',import.meta.url),'utf8');
  assert.match(source,/assert\.deepEqual\(server\.errors,\[\]\)/,'Agriculture remains fail-closed');
  assert.match(source,/if\(server\.errors\.length\)console\.error\('HTTP fixture failure details:',JSON\.stringify\(server\.failureDetails\)\)/,'Agriculture exposes safe diagnostics on failure');
 }finally{await f.close();await new Promise(r=>upstream.close(r));}
});

test('lifecycle observer is passive, origin-limited and emits only fixed structural metadata',async()=>{
 const {installSaveLifecycleObserver,SAVE_LIFECYCLE_MARKER}=await import('./save-lifecycle-audit.mjs');const {runInNewContext}=await import('node:vm');
 const handlers=[],messages=[];const listen=target=>({addEventListener:(type,fn)=>handlers.push({target,type,fn})});
 const context={location:{origin:'http://127.0.0.1:4181'},window:listen('window'),document:{...listen('document'),hidden:false},performance:{timeOrigin:123},console:{debug:(...args)=>messages.push(args)}};
 const source=`(${installSaveLifecycleObserver.toString()})('http://127.0.0.1:4181',${JSON.stringify(SAVE_LIFECYCLE_MARKER)})`;
 runInNewContext(source,{...context,location:{origin:'https://example.com'}});assert.deepEqual(handlers,[]);
 runInNewContext(source,context);assert.deepEqual(handlers.map(h=>h.type),['beforeunload','pagehide','pageshow','visibilitychange']);
 for(const {type,fn} of handlers)fn({type,persisted:false,preventDefault(){assert.fail('Observer must not change event behavior');}});
 assert.equal(messages.length,4);for(const [marker,text]of messages){assert.equal(marker,SAVE_LIFECYCLE_MARKER);assert.deepEqual(Object.keys(JSON.parse(text)),['event','at','document','hidden','persisted']);}
});

test('correlation pairs existing request keys in either arrival order without exposing them',async()=>{
 const {createSaveLifecycleAudit,SAVE_LIFECYCLE_MARKER}=await import('./save-lifecycle-audit.mjs');const {EventEmitter}=await import('node:events');
 const origin='http://127.0.0.1:4181',trace=createSaveLifecycleAudit(origin,{now:()=>99});trace.seed(4);trace.navigation('manual-reload');
 trace.observeBrowser('Runtime.consoleAPICalled',{type:'debug',args:[{value:SAVE_LIFECYCLE_MARKER},{value:JSON.stringify({event:'beforeunload',document:1000,hidden:false})}]});
 const start=(id,key)=>trace.observeBrowser('Network.requestWillBeSent',{requestId:id,frameId:'private-frame',loaderId:'private-loader',request:{method:'POST',url:origin+'/citymanager-api/v1/city-save',headers:{'Idempotency-Key':key,Cookie:'private-cookie'},postData:'private-payload'}});
 const http=key=>trace.httpStart({method:'POST',url:'/citymanager-api/v1/city-save',headers:{'idempotency-key':key,authorization:'private-auth'}},new EventEmitter());
 start('private-network-1','private-key-1');const one=http('private-key-1');const two=http('private-key-2');start('private-network-2','private-key-2');assert.notEqual(one,two);
 trace.httpResponse(one,200,Buffer.from(JSON.stringify({revision:5,raw:'private-city',cityId:'private-city-id'})).toString('base64'));
 trace.httpFailure(two,{phase:'read-body',bodyBytes:12,bodyComplete:false,requestComplete:false,requestAborted:true,errorName:'Error',errorCode:'ECONNRESET'});
 trace.observeBrowser('Network.loadingFailed',{requestId:'private-network-2',canceled:true,errorText:'private-error'});
 const evidence=trace.evidence;assert.equal(evidence.requests.length,2);assert.ok(evidence.requests.every(r=>r.http&&r.network));assert.equal(evidence.requests[0].ackRevision,5);
 assert.equal(evidence.failures[0].failure.navigation,'manual-reload');assert.equal(evidence.failures[0].failure.lastLifecycle.type,'beforeunload');assert.equal(evidence.failures[0].failure.lastAck.revision,5);assert.equal(evidence.failures[0].after.at(-1).event,'browser-failed');
 assert.doesNotMatch(JSON.stringify(evidence),/private-|idempotency|cookie|authorization|postData|cityId|headers|"stack"|https?:/i);
});

test('duplicate-key attempts are explicitly ambiguous and diagnostic retention is bounded',async()=>{
 const {createSaveLifecycleAudit}=await import('./save-lifecycle-audit.mjs');const {EventEmitter}=await import('node:events');const trace=createSaveLifecycleAudit('http://127.0.0.1:4181');
 const start=key=>trace.httpStart({method:'POST',url:'/citymanager-api/v1/city-save',headers:{'idempotency-key':key}},new EventEmitter());
 start('same');start('same');assert.ok(trace.evidence.requests.every(r=>r.pairing==='same-key-order-ambiguous'));
 for(let i=0;i<300;i++){trace.navigation('scenario-leave');const id=start('key-'+i);trace.httpFailure(id,{phase:'read-body',bodyBytes:1,bodyComplete:false,requestComplete:false,requestAborted:true,errorName:'Error',errorCode:'ECONNRESET'});}
 const evidence=trace.evidence;assert.equal(evidence.requests.length,64);assert.equal(evidence.timeline.length,240);assert.equal(evidence.failures.length,16);assert.ok(evidence.failures.every(f=>f.before.length<=32&&f.after.length<=24));
});

test('real partial HTTP upload remains an error and correlates navigation, lifecycle and last ACK',async()=>{
 const {request}=await import('node:http');const {SAVE_LIFECYCLE_MARKER}=await import('./save-lifecycle-audit.mjs');
 const upstream=createServer((_req,res)=>res.end('fixture'));await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
 const f=await startPersistenceFixture(`http://127.0.0.1:${upstream.address().port}/CityManager/`,{traceSaves:true});
 const until=async predicate=>{const end=Date.now()+5000;while(!predicate()){assert.ok(Date.now()<end);await new Promise(r=>setTimeout(r,10));}};
 try{
  const {createCity,serialize}=await import('../src/sim.ts');const raw=serialize(createCity(61025)),before=await f.fixture.seed(raw);f.trace.seed(before.revision);f.trace.navigation('scenario-leave');
  f.trace.observeBrowser('Runtime.consoleAPICalled',{type:'debug',args:[{value:SAVE_LIFECYCLE_MARKER},{value:JSON.stringify({event:'beforeunload',document:2000,hidden:false})}]});
  f.trace.observeBrowser('Network.requestWillBeSent',{requestId:'network1',request:{method:'POST',url:new URL('/citymanager-api/v1/city-save',f.url).href,headers:{'Idempotency-Key':'private-key'}}});
  const partial=request(new URL('/citymanager-api/v1/city-save',f.url),{method:'POST',headers:{'content-length':100000,'idempotency-key':'private-key'}});partial.on('error',()=>{});partial.write('private-body');await until(()=>f.trace.evidence.timeline.some(e=>e.event==='http-start'));partial.destroy();await until(()=>f.errors.length===1);
  assert.equal(f.errors.length,1);assert.throws(()=>assert.deepEqual(f.errors,[]));assert.deepEqual(f.fixture.active,before);assert.equal(f.fixture.writes.length,0);
  const failure=f.trace.evidence.failures[0];assert.equal(failure.failure.bodyComplete,false);assert.equal(failure.failure.requestAborted,true);assert.equal(failure.failure.errorCode,'ECONNRESET');assert.equal(failure.failure.lastAck.revision,1);assert.equal(failure.failure.lastLifecycle.type,'beforeunload');assert.equal(failure.failure.navigation,'scenario-leave');assert.ok(f.trace.evidence.requests[0].network);
  assert.doesNotMatch(JSON.stringify(f.trace.evidence),/private-|idempotency|cookie|authorization|raw|cityId|headers|"stack"|https?:/i);
  f.setSaveFailure(true);const response=await fetch(new URL('/citymanager-api/v1/city-save',f.url),{method:'POST',headers:{'Idempotency-Key':'private-rejection'},body:JSON.stringify({action:'save',cityId:before.cityId,expectedRevision:1,raw,metadata:before.metadata})});assert.equal(response.status,503);assert.equal(f.rejected.length,1);assert.equal(f.errors.length,1);assert.equal(f.trace.evidence.requests.at(-1).status,503);assert.deepEqual(f.fixture.active,before);
  f.setSaveFailure(false);const saved=await fetch(new URL('/citymanager-api/v1/city-save',f.url),{method:'POST',headers:{'Idempotency-Key':randomUUID()},body:JSON.stringify({action:'save',cityId:before.cityId,expectedRevision:1,raw,metadata:before.metadata})});assert.equal(saved.status,200);assert.equal((await saved.json()).revision,2);assert.equal(f.trace.evidence.requests.at(-1).ackRevision,2);assert.equal(f.trace.evidence.timeline.filter(e=>e.event==='server-ack').at(-1).revision,2);assert.equal(f.errors.length,1,'Successful follow-up cannot hide the partial upload');
 }finally{await f.close();await new Promise(r=>upstream.close(r));}
});

test('agriculture correlation observes events without adding a navigation barrier or weakening audits',async()=>{
 const {readFile}=await import('node:fs/promises');const source=await readFile(new URL('./agriculture-smoke.mjs',import.meta.url),'utf8');
 for(const text of ['server.trace.observeBrowser(m.method,m.params)','installSaveLifecycleObserver.toString()','server.trace.navigation(\'scenario-leave\')','server.trace.navigation(\'manual-reload\')','assert.deepEqual(server.errors,[])','assert.deepEqual(interceptionErrors,[])','assert.equal(events.length,failOnce?2:1)'])assert.ok(source.includes(text),text);
 assert.doesNotMatch(source,/waitForSave|waitForNavigationSave/);
});

test('v28 wellbeing session survives acknowledged server save and reload',async()=>{
 const upstream=createServer((_req,res)=>res.end('fixture'));await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
 const f=await startPersistenceFixture(`http://127.0.0.1:${upstream.address().port}/CityManager/`);
 try{
  const {createCity,step}=await import('../src/sim.ts');
  const {createParkRuntime,serializeParkSession,deserializeParkSession}=await import('../src/park-runtime.ts');
  const city=createCity(61025);for(let day=0;day<12;day++)step(city);
  const raw=serializeParkSession(city,createParkRuntime(city));assert.equal(JSON.parse(raw).version,28);
  const ack=await f.fixture.seed(raw);
  const command={action:'save',cityId:ack.cityId,expectedRevision:ack.revision,raw,metadata:ack.metadata};
  const response=await fetch(new URL('/citymanager-api/v1/city-save',f.url),{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':randomUUID()},body:JSON.stringify(command)});
  assert.equal(response.status,200);const saved=await response.json();assert.equal(saved.raw,raw);assert.equal(saved.revision,ack.revision+1);
  const read=await fetch(new URL('/citymanager-api/v1/city-save',f.url));const loaded=await read.json();assert.equal(loaded.raw,raw);
  assert.deepEqual(deserializeParkSession(loaded.raw).city,city);assert.deepEqual(f.errors,[]);
 }finally{await f.close();await new Promise(r=>upstream.close(r));}
});
