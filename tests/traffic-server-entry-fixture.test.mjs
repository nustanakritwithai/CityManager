import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {createTrafficServerFixture,assertNavigationSaveChain,reachTrafficControl,loadedTrafficSession,assertTrafficAutosaveCity} from './traffic-server-entry-fixture.mjs';
const url='http://127.0.0.1:4195/CityManager/';
import {createCity,step} from '../src/sim.ts';
import {createParkRuntime,serializeParkSession} from '../src/park-runtime.ts';
const city=createCity(42),raw=serializeParkSession(city,createParkRuntime(city));
const request=(method,body)=>({requestId:randomUUID(),request:{url:'http://127.0.0.1:4195/citymanager-api/v1/city-save',method,headers:{'Idempotency-Key':randomUUID()},postData:body&&JSON.stringify(body)}});
test('traffic fixture uses real ACK/revision/conflict contracts and preserves its head across reload entry',async()=>{
 const f=createTrafficServerFixture(url),ack=await f.seed(raw),messages=[];
 const send=async(method,params)=>{messages.push({method,params});};
 assert.equal(JSON.parse(raw).version,25);assert.equal(ack.metadata.tick,city.tick);assert.equal(ack.metadata.population,city.households.reduce((n,h)=>n+h.members,0));assert.equal(ack.revision,1);f.assertDurable(raw,1);
 const enter=async()=>{const predicates=[],buttons=[];await f.enter({button:async s=>{buttons.push(s);await f.intercept(request('GET'),send);},evaluate:async e=>{if(e==='window.__panelCityWrites')return [];if(e.startsWith('localStorage'))return null;predicates.push(e);return true;}});assert.deepEqual(buttons,['.guest-entry-card button']);assert.ok(predicates[1].includes('visuals().ready'));};
 await enter();await enter();f.assertDurable(raw,1); // Real reload does not call seed.
 const next=createCity(42);step(next);const changed=serializeParkSession(next,createParkRuntime(next));
 await f.intercept(request('POST',{action:'save',cityId:ack.cityId,expectedRevision:1,raw:changed,metadata:{...ack.metadata,tick:next.tick}}),send);
 assert.equal(messages.at(-1).params.responseCode,200);f.assertDurable(changed,2);
 await assert.rejects(f.intercept(request('POST',{action:'save',cityId:ack.cityId,expectedRevision:1,raw,metadata:ack.metadata}),send),/Unexpected rejected traffic save/);
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

test('reload lifecycle accepts only the captured economically identical migrated session',async()=>{
 const f=createTrafficServerFixture(url),before=await f.seed(raw),live=loadedTrafficSession(raw);
 const outgoing=serializeParkSession(live.city,live.runtime);assert.notEqual(outgoing,before.raw,'legacy seed expands to the real live session');
 const evaluate=async e=>e==='window.__panelCityWrites'?[]:e.startsWith('localStorage')?null:true;
 f.allowNavigation(outgoing);
 const payload={action:'save',cityId:before.cityId,expectedRevision:before.revision,raw:outgoing,metadata:before.metadata};
 await f.enter({evaluate,button:async()=>{await f.intercept(request('POST',payload),async()=>{});await f.intercept(request('GET'),async()=>{});}});
 assert.equal(f.active.raw,outgoing);assert.equal(f.active.revision,2);
 assert.deepEqual(f.navigationEvidence.at(-1),{beforeRevision:1,afterRevision:2,lifecycleSaves:1});
 const changed=structuredClone(live.city);step(changed);
 assert.throws(()=>f.allowNavigation(serializeParkSession(changed,createParkRuntime(changed))),/Autosave changes runtime, not economic City/);
 const g=createTrafficServerFixture(url),other=await g.seed(raw);g.allowNavigation(outgoing);
 await assert.rejects(g.enter({evaluate,button:async()=>{
  await g.intercept(request('POST',{...payload,cityId:other.cityId,raw:outgoing+' '}),async()=>{});
  await g.intercept(request('GET'),async()=>{});
 }}),/Lifecycle flush must match the captured outgoing session/);
});

test('no lifecycle save retains exact original acknowledged bytes',async()=>{
 const f=createTrafficServerFixture(url),before=await f.seed(raw),live=loadedTrafficSession(raw);
 f.allowNavigation(serializeParkSession(live.city,live.runtime));
 await f.enter({button:async()=>{await f.intercept(request('GET'),async()=>{});},evaluate:async e=>e==='window.__panelCityWrites'?[]:e.startsWith('localStorage')?null:true});
 assert.deepEqual(f.active,before);assert.deepEqual(f.navigationEvidence.at(-1),{beforeRevision:1,afterRevision:1,lifecycleSaves:0});
});

test('read-only navigation predicates retry only known destroyed-context errors',async()=>{
 const f=createTrafficServerFixture(url);await f.seed(raw);let calls=0;
 await f.enter({button:async()=>{await f.intercept(request('GET'),async()=>{});},evaluate:async e=>{if(++calls===1)throw Object.assign(Error('navigation'),{cdpError:{code:-32000,message:'Inspected target navigated or closed'}});return e==='window.__panelCityWrites'?[]:e.startsWith('localStorage')?null:true;}});
 assert.equal(f.navigationRetries.length,1);
 await assert.rejects(f.enter({button:async()=>{},evaluate:async()=>{throw Object.assign(Error('runtime failure'),{cdpError:{code:-32000,message:'Unknown error'}});}}),/runtime failure/);
});

test('reload accepts only observed exact same-raw lifecycle ACK chains and the final GET',async()=>{
 const f=createTrafficServerFixture(url),before=await f.seed(raw);f.allowNavigation();
 const payload={action:'save',cityId:before.cityId,expectedRevision:1,raw,metadata:before.metadata};
 const evaluate=async e=>e==='window.__panelCityWrites'?[]:e.startsWith('localStorage')?null:true;
 await f.enter({evaluate,button:async()=>{await f.intercept(request('POST',payload),async()=>{});await f.intercept(request('GET'),async()=>{});}});
 assert.equal(f.active.revision,2);assert.deepEqual(f.navigationEvidence.at(-1),{beforeRevision:1,afterRevision:2,lifecycleSaves:1});
 const after=f.active,event=f.writes[0];
 assert.throws(()=>assertNavigationSaveChain(before,after,[]),/Every revision/);
 for(const invalid of [{...event,status:409},{...event,command:{...event.command,raw:'wrong'}},{...event,command:{...event.command,expectedRevision:0}},{...event,command:{...event.command,action:'delete'}},{...event,response:{...event.response,revision:3}}])assert.throws(()=>assertNavigationSaveChain(before,after,[invalid]));
 const g=createTrafficServerFixture(url),base=await g.seed(raw);g.allowNavigation();
 await assert.rejects(g.enter({evaluate,button:async()=>{await g.intercept(request('GET'),async()=>{});await g.intercept(request('POST',{...payload,cityId:base.cityId}),async()=>{});}}),/Entered GET must match final/);
});

test('exact idempotent lifecycle retries reuse the acknowledged revision without hiding mismatches',async()=>{
 const f=createTrafficServerFixture(url),base=await f.seed(raw),send=async()=>{};
 const post=request('POST',{action:'save',cityId:base.cityId,expectedRevision:1,raw,metadata:base.metadata});
 await f.intercept(post,send);f.allowNavigation();
 const evaluate=async e=>e==='window.__panelCityWrites'?[]:e.startsWith('localStorage')?null:true;
 await f.enter({evaluate,button:async()=>{await f.intercept(post,send);await f.intercept(request('GET'),send);}});
 assert.equal(f.active.revision,2);assert.deepEqual(f.navigationEvidence.at(-1),{beforeRevision:2,afterRevision:2,lifecycleSaves:0});
 const event=f.writes[0],retry=f.writes[1];
 assert.deepEqual(assertNavigationSaveChain(base,f.active,[event,retry]),{beforeRevision:1,afterRevision:2,lifecycleSaves:1});
 const g=createTrafficServerFixture(url),start=await g.seed(raw);g.allowNavigation();
 const same=request('POST',{action:'save',cityId:start.cityId,expectedRevision:start.revision,raw,metadata:start.metadata});
 await g.enter({evaluate,button:async()=>{await g.intercept(same,send);await g.intercept(same,send);await g.intercept(request('GET'),send);}});
 assert.equal(g.active.revision,2);assert.deepEqual(g.navigationEvidence.at(-1),{beforeRevision:1,afterRevision:2,lifecycleSaves:1});

 for(const bad of [
  {...retry,command:{...retry.command,metadata:{...retry.command.metadata,tick:99}}},
  {...retry,response:{...retry.response,revision:3}},
  {...retry,requestKey:randomUUID()},
 ])assert.throws(()=>assertNavigationSaveChain(base,f.active,[event,bad]));
});

test('reload revision failures retain assertion and bounded non-sensitive lifecycle diagnostics',async()=>{
 const f=createTrafficServerFixture(url),base=await f.seed(raw),send=async()=>{};
 const post=request('POST',{action:'save',cityId:base.cityId,expectedRevision:1,raw,metadata:base.metadata});
 await f.intercept(post,send);f.allowNavigation();
 const evaluate=async e=>e==='window.__panelCityWrites'?[]:e.startsWith('localStorage')?null:true;
 await assert.rejects(f.enter({evaluate,button:async()=>{f.writes.push({...f.writes[0],requestKey:randomUUID()});await f.intercept(request('GET'),send);}}),error=>{
  assert.match(error.message,/Lifecycle writes form an exact revision chain/);
  assert.match(error.message,/"baselineRevision":2/);assert.match(error.message,/"repeatedKey":false/);
  assert.equal(error.message.includes(raw),false);assert.equal(error.message.includes(post.request.headers['Idempotency-Key']),false);return true;
 });
});

test('old page unload and in-flight service request settle before a new fixture seed',async()=>{
 const f=createTrafficServerFixture(url),before=await f.seed(raw);let release,blank=false;
 const wait=new Promise(r=>release=r);let mutation;
 await f.leave({evaluate:async e=>e==='!!window.cityManager'||e==='window.cityManager.parks().paused'?true:e==='window.cityManager.sessionSnapshot()'?raw:e==='window.__panelCityWrites'?[]:null,
  send:async()=>{mutation=f.intercept(request('POST',{action:'save',cityId:before.cityId,expectedRevision:1,raw,metadata:before.metadata}),async()=>wait);blank=true;setTimeout(()=>release(),5);},
  until:async()=>assert.equal(blank,true)});
 await mutation;assert.equal(f.active.revision,2);const next=await f.seed(raw);assert.equal(next.revision,1);assert.equal(f.writes.length,0);assert.notEqual(next.cityId,before.cityId);await f.intercept(request('POST',{action:'save',cityId:before.cityId,expectedRevision:2,raw,metadata:before.metadata}),async()=>{});assert.equal(f.evidence.retiredWrites[0].ackRevision,3);assert.equal(f.active.revision,1);assert.equal(f.active.cityId,next.cityId);assert.equal(f.writes.length,0,'Old ACK cannot contaminate current navigation chain');
 await assert.rejects(f.intercept(request('POST',{action:'save',cityId:before.cityId,expectedRevision:3,raw:'wrong',metadata:before.metadata}),async()=>{}),/exact observed outgoing session/);
 await assert.rejects(f.intercept(request('POST',{action:'save',cityId:'22222222-2222-4222-8222-222222222222',expectedRevision:1,raw,metadata:before.metadata}),async()=>{}),/Unexpected rejected traffic save/);assert.equal(f.active.revision,1);
});


test('retired page may retry an exact ACK observed before reseeding, never a changed command',async()=>{
 const f=createTrafficServerFixture(url),before=await f.seed(raw),send=async()=>{};
 const post=request('POST',{action:'save',cityId:before.cityId,expectedRevision:before.revision,raw,metadata:before.metadata});
 await f.intercept(post,send);assert.equal(f.active.revision,2);
 await f.leave({evaluate:async e=>e==='!!window.cityManager'||e==='window.cityManager.parks().paused'?true:e==='window.cityManager.sessionSnapshot()'?raw:e==='window.__panelCityWrites'?[]:null,send:async()=>{},until:async()=>{}});
 const current=await f.seed(raw);await f.intercept(post,send);
 assert.equal(f.evidence.retiredWrites.at(-1).ackRevision,2);assert.deepEqual(f.active,current);
 const altered=structuredClone(post);altered.request.postData=JSON.stringify({...JSON.parse(post.request.postData),metadata:{...before.metadata,tick:99}});
 await assert.rejects(f.intercept(altered,send),/Unexpected rejected traffic save|same command/);assert.deepEqual(f.active,current);
});

test('traffic native Save bypasses only the obsolete local-save waiter; other controls still use reachability',async()=>{
 let evaluated=0,clicked=0;
 assert.equal(await reachTrafficControl(async()=>{evaluated++;throw Error('Legacy Save waiter used');},async()=>{clicked++;},'#save'),false);
 assert.equal(evaluated,0);assert.equal(clicked,0,'caller owns the one hit-tested native click and subsequent ACK wait');
 await assert.rejects(reachTrafficControl(async()=>{evaluated++;throw Error('Reachability delegated');},async()=>{},'#pause'),/Reachability delegated/);assert.equal(evaluated,1);
});

test('actual traffic bootstrap scripts ignore about:blank before accessing secure-origin APIs',async()=>{
 const {readFileSync}=await import('node:fs'),{runInNewContext}=await import('node:vm');
 for(const name of ['traffic-game-smoke.mjs','traffic-default-fault-smoke.mjs']){
  const text=readFileSync(new URL(name,import.meta.url),'utf8'),literal=text.match(/const source=(`[^]*?`);/)?.[1];assert.ok(literal,name);
  const source=runInNewContext(literal,{origin:new URL(url).origin,base:new URL(url),token:'fixture',pref:null,denyGet:false,denySet:false,protectedKeys:{},fault:''});
  const blank={window:{},location:{origin:'null'}};runInNewContext(source,blank);assert.deepEqual(blank.window,{},'blank navigation creates no boot marker or storage/fault hooks');
  let called=0;assert.throws(()=>runInNewContext(source,{window:{},location:{origin:new URL(url).origin},crypto:{randomUUID(){called++;throw Error('trusted boot marker');}}}),/trusted boot marker/);assert.equal(called,1);
 }
});

test('Fetch diagnostic preserves every original error and correlates bounded request/cancel metadata',async()=>{
 const {createTrafficNetworkAudit}=await import('./traffic-server-entry-fixture.mjs');const audit=createTrafficNetworkAudit(()=>({stage:'reload'}));
 const p={requestId:'fetch1',networkId:'network1',frameId:'frame1',resourceType:'Fetch',request:{url:'http://127.0.0.1:4195/citymanager-api/v1/city-save',method:'POST',postData:'must-not-record',headers:{Cookie:'must-not-record'}}};
 audit.observe('Network.loadingFailed',{requestId:'network1',canceled:true,errorText:'net::ERR_ABORTED'});
 const original=Error('Invalid InterceptionId.');await assert.rejects(audit.bind(p,async()=>{throw original;})('Fetch.fulfillRequest',{responseCode:200,body:'must-not-record'}),error=>error===original);
 const evidence=audit.evidence;assert.equal(evidence.failures[0].command,'Fetch.fulfillRequest');assert.equal(evidence.failures[0].method,'POST');assert.equal(evidence.failures[0].networkId,'network1');assert.equal(evidence.failures[0].events[0].canceled,true);assert.equal(JSON.stringify(evidence).includes('must-not-record'),false);
 for(let i=0;i<200;i++)audit.observe('Network.loadingFailed',{requestId:String(i)});assert.equal(audit.evidence.events.length,160);
});

test('late lifecycle ACK is bound to the exact captured dirty outgoing runtime, never the new city',async()=>{
 const f=createTrafficServerFixture(url),old=await f.seed(raw),runtime=createParkRuntime(city);runtime.minuteRemainder=.25;const dirty=serializeParkSession(city,runtime);assert.notEqual(dirty,raw);
 await f.leave({evaluate:async e=>e==='!!window.cityManager'||e==='window.cityManager.parks().paused'?true:e==='window.cityManager.sessionSnapshot()'?dirty:e==='window.__panelCityWrites'?[]:null,send:async()=>{},until:async()=>{}});
 const current=await f.seed(raw);await f.intercept(request('POST',{action:'save',cityId:old.cityId,expectedRevision:1,raw:dirty,metadata:old.metadata}),async()=>{});
 assert.equal(f.evidence.retiredWrites.at(-1).ackRevision,2);assert.deepEqual(f.active,current);assert.equal(f.writes.length,0);
 await assert.rejects(f.intercept(request('POST',{action:'save',cityId:old.cityId,expectedRevision:2,raw:dirty+' ',metadata:old.metadata}),async()=>{}),/exact observed outgoing session/);assert.deepEqual(f.active,current);
});

test('native HTTP adapter retains real ACKs, refuses external forwarding and does not use CDP transport',async()=>{
 const {trafficHttpHandler}=await import('./traffic-server-entry-fixture.mjs'),{EventEmitter}=await import('node:events');const fixture=createTrafficServerFixture(url),ack=await fixture.seed(raw),errors=[],deliveries=[];let forwarded=0;
 const handler=trafficHttpHandler({origin:new URL(url).origin,upstream:url,fixture,errors,deliveries,forward:async target=>{forwarded++;assert.equal(target.origin,new URL(url).origin);return new Response('actual built asset',{headers:{'Content-Type':'text/javascript'}});}});
 const run=async(path,method='GET',body='',host=new URL(url).host)=>{const req={url:path,method,headers:{host,'idempotency-key':randomUUID()},async *[Symbol.asyncIterator](){if(body)yield Buffer.from(body);}};const res=new EventEmitter();res.writeHead=(status,headers)=>{res.status=status;res.headers=headers;res.headersSent=true;};res.end=data=>{res.data=data;res.emit('finish');res.emit('close');};await handler(req,res);return res;};
 const saved=await run('/citymanager-api/v1/city-save','POST',JSON.stringify({action:'save',cityId:ack.cityId,expectedRevision:1,raw,metadata:ack.metadata}));assert.equal(saved.status,200);assert.equal(JSON.parse(saved.data).revision,2);assert.equal(fixture.active.revision,2);assert.equal(deliveries[0].finished,true);
 const asset=await run('/CityManager/assets/test.js');assert.equal(String(asset.data),'actual built asset');assert.equal(forwarded,1);
 await run('https://example.com/private');await run('//example.com/private');await run('/CityManager/','GET','','example.com');assert.equal(forwarded,1);assert.equal(errors.length,3);
});

test('network fence is ordered exact-origin only, requires protocol support and actual inspector blocking',async()=>{
 const {trafficNetworkRules,installTrafficNetworkFence}=await import('./traffic-server-entry-fixture.mjs');const origin=new URL(url).origin,rules=trafficNetworkRules(origin,true);
 const blocked=target=>rules.find(rule=>new URLPattern(rule.urlPattern).test(target))?.block;
 for(const target of ['https://example.com/account','http://127.0.0.1:9999/','http://localhost:4195/'])assert.equal(blocked(target),true);assert.equal(blocked(origin+'/citymanager-api/v1/city-save'),false);assert.equal(blocked(origin+'/CityManager/assets/kenney-city/models/tree.glb?x=1'),true);
 assert.equal(rules[0].block,true);assert.match(rules[0].urlPattern,/models/);assert.deepEqual(rules[1],{urlPattern:origin+'/*',block:false});assert.deepEqual(rules.slice(2).map(x=>x.block),[true,true]);assert.throws(()=>trafficNetworkRules('http://example.com'));
 const denied=[origin+'/api/city-advisor/*',origin+'/chat/completions*'],restricted=trafficNetworkRules(origin,false,denied);
 const decision=target=>restricted.find(rule=>new URLPattern(rule.urlPattern).test(target))?.block;
 assert.equal(decision(origin+'/api/city-advisor/report'),true);assert.equal(decision(origin+'/chat/completions'),true);
 assert.equal(decision(origin+'/citymanager-api/v1/city-save'),false);assert.equal(decision('https://example.com/'),true);
 const protocol={domains:[{domain:'Network',commands:[{name:'setBlockedURLs',parameters:[{name:'urlPatterns'}]}]}]};let evidence,commands=[];
 const options={protocol,origin,send:async(method,params)=>commands.push({method,params}),observeProbe:target=>(evidence={url:target}),evaluate:async expression=>{if(expression.startsWith('fetch'))evidence.failed={blockedReason:'inspector'};return true;}};
 await installTrafficNetworkFence({...options,additionalBlocked:denied});assert.equal(commands[0].method,'Network.setBlockedURLs');assert.deepEqual(commands[0].params.urlPatterns,restricted);assert.equal(new URL(evidence.url).hostname,'localhost');
 await assert.rejects(installTrafficNetworkFence({...options,protocol:{domains:[]}}),/must support/);
 await assert.rejects(installTrafficNetworkFence({...options,evaluate:async expression=>{if(expression.startsWith('fetch'))evidence.failed={blockedReason:'other'};return true;}}),/Must be CDP block/);
});

 test('browser runners never pause API or asset requests through Fetch after native HTTP migration',async()=>{
 const {readFileSync}=await import('node:fs');for(const file of ['traffic-game-smoke.mjs','traffic-default-fault-smoke.mjs']){const source=readFileSync(new URL(file,import.meta.url),'utf8');assert.equal(source.includes("send('Fetch.enable'"),false);assert.equal(source.includes("m.method==='Fetch.requestPaused'"),false);assert.ok(source.includes('installTrafficNetworkFence('));assert.ok(source.includes('httpFixture.errors,[]'));}
 });


test('expected live session applies the real map migration without rewriting server bytes or advancing time', async () => {
 const f=createTrafficServerFixture(url),ack=await f.seed(raw), loaded=loadedTrafficSession(ack.raw);
 assert.equal(JSON.parse(ack.raw).version,25); assert.equal(loaded.city.cells.length,672);
 assert.deepEqual(loaded.city.cells.slice(0,576),city.cells);
 assert.deepEqual(loaded.city.accounts,city.accounts); assert.deepEqual(loaded.city.ledger,city.ledger);
 assert.equal(loaded.city.tick,city.tick); assert.equal(loaded.runtime.activity.minute,0);
 assert.equal(f.active.raw,raw); assert.equal(f.active.revision,1);
 const expandedRaw=serializeParkSession(loaded.city,loaded.runtime);
 assert.deepEqual(loadedTrafficSession(expandedRaw),loaded);
});


test('autosave compares the exact expanded economic city and rejects any economic mutation',()=>{
 const live=loadedTrafficSession(raw), runtime=structuredClone(live.runtime);runtime.minuteRemainder=.25;
 const saved=serializeParkSession(live.city,runtime),restored=loadedTrafficSession(saved);
 assert.deepEqual(assertTrafficAutosaveCity(raw,restored.city),live.city);
 const changed=structuredClone(restored.city);step(changed);
 assert.deepEqual(loadedTrafficSession(serializeParkSession(changed,createParkRuntime(changed))).city,changed,'economic change is a valid, replayable city');
 assert.throws(()=>assertTrafficAutosaveCity(raw,changed),/Autosave changes runtime, not economic City/);
 assert.notEqual(serializeParkSession(live.city,live.runtime),saved,'runtime really changed');
});

test('lifecycle reload waits through fixture entry before checking the new boot marker',async()=>{
 const {readFileSync}=await import('node:fs');
 const source=readFileSync(new URL('./traffic-game-smoke.mjs',import.meta.url),'utf8');
 const start=source.indexOf("setStage('save and server reload')"),end=source.indexOf("setStage('toggle and visit-only preference')",start);
 const segment=source.slice(start,end),reload=segment.indexOf("await send('Page.reload'");
 const entry=segment.indexOf('await serverFixture.enter(',reload),check=segment.indexOf("assert.notEqual(await evaluate('window.__trafficGameBoot'),oldBoot",entry);
 assert.ok(start>=0&&reload>=0&&entry>reload&&check>entry);
 assert.equal(segment.slice(reload,entry).includes('await until('),false,'no unguarded boot poll during navigation');
});

test('manual save and later same-byte ACKs form an exact chain before and across reload',async()=>{
 const {assertTrafficManualSaveChain}=await import('./traffic-server-entry-fixture.mjs');
 const live=loadedTrafficSession(raw),session=serializeParkSession(live.city,live.runtime);
 const f=createTrafficServerFixture(url),before=await f.seed(session),send=async()=>{},cursor=f.writes.length;
 const save=revision=>request('POST',{action:'save',cityId:before.cityId,expectedRevision:revision,raw:session,metadata:before.metadata});
 await f.intercept(save(1),send);const acknowledged=f.active;
 await f.intercept(save(2),send);const beforeReload=f.active;
 assert.deepEqual(assertTrafficManualSaveChain(before,acknowledged,beforeReload,f.writes.slice(cursor),f.writes.slice(0,cursor),session),{beforeRevision:1,afterRevision:3,lifecycleSaves:2});
 const writes=f.writes.slice(cursor);
 assert.throws(()=>assertTrafficManualSaveChain(before,acknowledged,beforeReload,writes.slice(1),[],session));
 assert.throws(()=>assertTrafficManualSaveChain(before,acknowledged,beforeReload,[writes[0],{...writes[1],response:{...writes[1].response,raw:'wrong'}}],[],session));
 assert.throws(()=>assertTrafficManualSaveChain(before,{...acknowledged,revision:99},beforeReload,writes,[],session));
 assert.throws(()=>assertTrafficManualSaveChain(before,acknowledged,{...beforeReload,deleted:true},writes,[],session),/Live heads/);
 assert.throws(()=>assertTrafficManualSaveChain(before,acknowledged,{...beforeReload,revision:4},writes,[],session),/Every revision/);
 f.allowNavigation(session);
 const evaluate=async e=>e==='window.__panelCityWrites'?[]:e.startsWith('localStorage')?null:true;
 await f.enter({evaluate,button:async()=>{await f.intercept(save(3),send);await f.intercept(save(4),send);await f.intercept(request('GET'),send);}});
 assert.deepEqual(f.navigationEvidence.at(-1),{beforeRevision:3,afterRevision:5,lifecycleSaves:2});
 assert.equal(f.active.raw,session);assert.equal(f.active.revision,5);
});


test('a pre-click autosave cannot impersonate successful manual Save',async()=>{
 const {completeTrafficManualSave,assertTrafficManualSaveChain}=await import('./traffic-server-entry-fixture.mjs');
 const live=loadedTrafficSession(raw),session=serializeParkSession(live.city,live.runtime);
 const f=createTrafficServerFixture(url),before=await f.seed(session),send=async()=>{};let manualSuccess=false,manualEnabled=false;
 const evaluate=async()=>manualSuccess;
 const until=async expression=>{assert.match(expression,/#inspector-status/);if(!manualSuccess)throw Error('Manual success not observed');};
 const button=async selector=>{assert.equal(selector,'#save');if(manualEnabled){await f.intercept(request('POST',{action:'save',cityId:before.cityId,expectedRevision:2,raw:session,metadata:before.metadata}),send);manualSuccess=true;}};
 // Autosave lands after the snapshot and before click. It has a valid ACK and
 // same bytes, but absent manual completion still fails the real manual waiter.
 await f.intercept(request('POST',{action:'save',cityId:before.cityId,expectedRevision:1,raw:session,metadata:before.metadata}),send);
 const autosave=f.active;
 assert.deepEqual(assertTrafficManualSaveChain(before,autosave,autosave,f.writes,[],session),{beforeRevision:1,afterRevision:2,lifecycleSaves:1});
 await assert.rejects(completeTrafficManualSave(evaluate,button,until),/Manual success not observed/);
 manualEnabled=true;await completeTrafficManualSave(evaluate,button,until);
 assert.deepEqual(assertTrafficManualSaveChain(before,autosave,f.active,f.writes,[],session),{beforeRevision:1,afterRevision:3,lifecycleSaves:2});
 await assert.rejects(completeTrafficManualSave(evaluate,button,until),/must be fresh/);
});

test('manual-only success signal follows awaited explicit server save',async()=>{
 const {readFileSync}=await import('node:fs');const source=readFileSync(new URL('../src/main.ts',import.meta.url),'utf8');
 const signal='บันทึกเมืองบนเซิร์ฟเวอร์แล้ว · ตลาดยังปิดอยู่';
 assert.equal(source.split(signal).length-1,1,'Success text is exclusive to explicit Save');
 const start=source.indexOf("$('#save').addEventListener('click'"),end=source.indexOf('const campusAction',start);
 const handler=source.slice(start,end);assert.ok(start>=0&&end>start);
 assert.ok(handler.includes(`const saved=await trackedSave(true);sound('ui-save');status(saved.current?'${signal}'`),'Fresh manual success requires the acknowledged bytes to remain current');
 assert.match(source,/route\?\.page === 'game'.*\$\('#inspector-status'\)\.textContent = text/);
});

test('HTTP diagnostics identify partial uploads and asset failures without suppressing errors or recording payloads',async()=>{
 const {createServer,request}=await import('node:http'),{trafficHttpHandler}=await import('./traffic-server-entry-fixture.mjs');
 const errors=[],deliveries=[],failureDetails=[];let handler,serviceCalls=0,bodySeen;
 const received=new Promise(resolve=>{bodySeen=resolve;});
 const http=createServer((req,res)=>{req.once('data',bodySeen);void handler(req,res);});
 await new Promise(resolve=>http.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${http.address().port}`,fixture=createTrafficServerFixture(origin+'/CityManager/'),ack=await fixture.seed(raw),intercept=fixture.intercept;
 fixture.intercept=async(...args)=>{serviceCalls++;return intercept(...args);};
 handler=trafficHttpHandler({origin,upstream:origin+'/CityManager/',fixture,errors,deliveries,failureDetails,forward:async()=>{throw Object.assign(Error('private-message'),{code:'private-code',cause:{code:'UND_ERR_SOCKET'}});}});
 const until=async predicate=>{const deadline=Date.now()+5000;while(!predicate()){assert.ok(Date.now()<deadline,'Diagnostic event arrives');await new Promise(resolve=>setTimeout(resolve,10));}};
 try{
  const partial=request(origin+'/citymanager-api/v1/city-save',{method:'POST',headers:{'content-length':100000,'idempotency-key':'private-key','cookie':'private-cookie'}});partial.on('error',()=>{});partial.write('private-body');
  await Promise.race([received,new Promise((_,reject)=>setTimeout(()=>reject(Error('Incoming body not observed')),5000).unref())]);partial.destroy();await until(()=>errors.length===1);
  assert.match(errors[0],/^Fixture transport failure: Error \(ECONNRESET\)$/);assert.equal(serviceCalls,0);assert.deepEqual(fixture.active,ack);assert.deepEqual(deliveries,[],'Incomplete requests remain outside the service ACK list');
  assert.deepEqual(failureDetails[0],{kind:'city-save',phase:'read-body',method:'POST',bodyBytes:12,bodyComplete:false,requestComplete:false,requestAborted:true,responseHeadersSent:false,responseFinished:false,responseDestroyed:true,serviceStatus:null,errorName:'Error',errorCode:'ECONNRESET',causeCode:null});
  const asset=await fetch(origin+'/CityManager/private-asset?token=private-query');assert.equal(asset.status,500);assert.equal(errors.length,2);assert.equal(failureDetails[1].kind,'asset');assert.equal(failureDetails[1].phase,'forward-asset');assert.equal(failureDetails[1].errorCode,null);assert.equal(failureDetails[1].causeCode,'UND_ERR_SOCKET');
  const response=await fetch(origin+'/citymanager-api/v1/city-save',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':randomUUID()},body:JSON.stringify({action:'save',cityId:ack.cityId,expectedRevision:ack.revision,raw,metadata:ack.metadata})});
  assert.equal(response.status,200);const saved=await response.json();assert.equal(saved.raw,raw);assert.equal(saved.revision,ack.revision+1);assert.equal(serviceCalls,1);assert.equal(errors.length,2,'Later successful save cannot hide earlier failures');assert.throws(()=>assert.deepEqual(errors,[]));
  for(let i=0;i<34;i++)await fetch(origin+'/CityManager/private-asset');
  assert.equal(errors.length,36,'The fail-closed error list is not truncated');assert.equal(failureDetails.length,32,'Only diagnostic details are bounded');
  assert.doesNotMatch(JSON.stringify({errors,failureDetails}),/private-|citymanager-api|idempotency|cookie|token|raw|stack/i);
 }finally{http.closeAllConnections();await new Promise(resolve=>http.close(resolve));}
});
