import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {createTrafficServerFixture,assertNavigationSaveChain,reachTrafficControl} from './traffic-server-entry-fixture.mjs';
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
 const protocol={domains:[{domain:'Network',commands:[{name:'setBlockedURLs',parameters:[{name:'urlPatterns'}]}]}]};let evidence,commands=[];
 const options={protocol,origin,send:async(method,params)=>commands.push({method,params}),observeProbe:target=>(evidence={url:target}),evaluate:async expression=>{if(expression.startsWith('fetch'))evidence.failed={blockedReason:'inspector'};return true;}};
 await installTrafficNetworkFence(options);assert.equal(commands[0].method,'Network.setBlockedURLs');assert.equal(new URL(evidence.url).hostname,'localhost');
 await assert.rejects(installTrafficNetworkFence({...options,protocol:{domains:[]}}),/must support/);
 await assert.rejects(installTrafficNetworkFence({...options,evaluate:async expression=>{if(expression.startsWith('fetch'))evidence.failed={blockedReason:'other'};return true;}}),/Must be CDP block/);
});

 test('browser runners never pause API or asset requests through Fetch after native HTTP migration',async()=>{
 const {readFileSync}=await import('node:fs');for(const file of ['traffic-game-smoke.mjs','traffic-default-fault-smoke.mjs']){const source=readFileSync(new URL(file,import.meta.url),'utf8');assert.equal(source.includes("send('Fetch.enable'"),false);assert.equal(source.includes("m.method==='Fetch.requestPaused'"),false);assert.ok(source.includes('installTrafficNetworkFence('));assert.ok(source.includes('httpFixture.errors,[]'));}
 });
