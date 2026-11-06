/** Built-bundle server-only acceptance. No live URL, real login, or external service.
 * npm run build && node tests/server-save-browser-smoke.mjs
 * node tests/server-save-browser-smoke.mjs --self-test (no browser or sockets)
 * CITYMANAGER_BROWSER selects a locally installed Chrome/Edge binary.
 * A browser/socket failure FAILS this test; never counts as passing UI acceptance.
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { inflateSync, deflateSync } from 'node:zlib';
import { createServerCityService, hash } from '../server/city-saves/service.mjs';
let landEvidence={status:'not-run'};
let trafficGapEvidence={status:'not-run',reason:'Bumper-gap acceptance is opt-in for the exact traffic transition.'};
let railEvidence={status:'not-run',reason:'Rail UI acceptance is opt-in for the exact rail transition.'};
let toolbarEvidence={status:'not-run',reason:'Unchanged toolbar matrix remains in visual PR167 coverage; this runner checks server-save UI only.'};
const diagnostics={phase:'initialization',lastExpression:null,dialogs:[],navigationRetries:[],captures:[],runtimeErrors:[],saveNetwork:[],renderers:[],cdp:[],server:null};
const OWNER='11111111-1111-4111-8111-111111111111', COOKIE='fixture-existing-owner', CSRF='fixture-csrf';
const expectedReloadDialog=(type,scope)=>scope===true&&type==='beforeunload';
const runLostAckNextSave=env=>env.CITYMANAGER_RUN_LOST_ACK_NEXT_SAVE==='1';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
// Match the existing Windows native-input smokes: let Edge choose its graphics
// backend instead of forcing the cross-platform SwiftShader implementation.
// The fallback permission remains; Linux keeps its exact existing flags.
const graphicsArgs=(platform=process.platform)=>platform==='win32'?['--enable-unsafe-swiftshader']:['--use-angle=swiftshader','--enable-unsafe-swiftshader'];
function rendererMetadata(value){
 const v=value&&typeof value==='object'?value:{};
 const text=key=>typeof v[key]==='string'?v[key].slice(0,512):null;
 const bool=key=>typeof v[key]==='boolean'?v[key]:null;
 const number=key=>Number.isFinite(v[key])?v[key]:null;
 return {renderer:text('renderer'),quality:text('quality'),requestedQuality:text('requestedQuality'),shadows:bool('shadows'),postProcessing:bool('postProcessing'),traffic:bool('traffic'),paused:bool('paused'),width:number('width'),height:number('height'),visibility:text('visibility'),contextLosses:number('contextLosses')};
}
function rememberCdp(log,event){log.push(event);if(log.length>80)log.splice(0,log.length-80);}
// A queued automatic check can truthfully replace the manual-write label after
// its ACK. Neither pending work nor acknowledgement of older bytes is settled.
function acknowledgedSaveUi(text,failureVisible){
 return !failureVisible&&['บันทึกบนเซิร์ฟเวอร์แล้ว','ตรวจสอบแล้วว่าเซฟบนเซิร์ฟเวอร์ตรงกัน'].some(label=>text?.startsWith(label));
}
// Synthetic browser fixture only. Record the visible retry click and the
// forwarded Save click without capturing cookies, keys, or city bytes.
function installSaveClickTrace(){
 window.__saveClickTrace=[];for(const type of ['pointerdown','pointerup','mousedown','mouseup','click'])document.addEventListener(type,event=>{
  const target=event.target,button=target?.closest?.('#save-failure-retry,#save');
  window.__saveClickTrace.push({type,id:button?.id??target?.id??'',tag:target?.tagName??'',trusted:event.isTrusted,disabled:button?.disabled??false,pointerId:event.pointerId,pointerType:event.pointerType,x:event.clientX,y:event.clientY,at:Date.now()});
  if(window.__saveClickTrace.length>40)window.__saveClickTrace.shift();
 },true);
}
// Only read-only entry predicates immediately following our explicit reload may retry.
async function reloadEntryRead(read,onRetry=()=>{}){
 try{return await read();}catch(error){
  if(error?.cdpError?.code!==-32000||!['Inspected target navigated or closed','Execution context was destroyed.','Cannot find context with specified id'].includes(error.cdpError.message))throw error;
  onRetry(error.cdpError);return false;
 }
}
function pngEvidence(png){
 assert.ok(png.length>24&&png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'Actual PNG evidence required');
 const width=png.readUInt32BE(16),height=png.readUInt32BE(20),channels=png[25]===2?3:png[25]===6?4:0;
 assert.ok(width>0&&height>0&&width*height<=16_000_000&&png[24]===8&&channels&&png[28]===0,'Supported bounded RGB/RGBA PNG required');
 const chunks=[];for(let i=8;i+12<=png.length;){const n=png.readUInt32BE(i);assert.ok(i+12+n<=png.length);if(png.toString('ascii',i+4,i+8)==='IDAT')chunks.push(png.subarray(i+8,i+8+n));i+=n+12;}
 const stride=width*channels,raw=inflateSync(Buffer.concat(chunks),{maxOutputLength:(stride+1)*height});assert.equal(raw.length,(stride+1)*height);
 let previous=Buffer.alloc(stride),minLuma=255,maxLuma=0;const colors=new Set();
 for(let y=0;y<height;y++){
  const filter=raw[y*(stride+1)],row=Buffer.from(raw.subarray(y*(stride+1)+1,(y+1)*(stride+1)));assert.ok(filter<=4);
  for(let x=0;x<stride;x++){const a=x>=channels?row[x-channels]:0,b=previous[x],c=x>=channels?previous[x-channels]:0,p=a+b-c;const predictor=filter===0?0:filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):Math.abs(p-a)<=Math.abs(p-b)&&Math.abs(p-a)<=Math.abs(p-c)?a:Math.abs(p-b)<=Math.abs(p-c)?b:c;row[x]=(row[x]+predictor)&255;}
  for(let x=0;x<stride;x+=channels){const r=row[x],g=row[x+1],b=row[x+2],luma=(54*r+183*g+19*b)>>8;minLuma=Math.min(minLuma,luma);maxLuma=Math.max(maxLuma,luma);if(colors.size<64)colors.add(((r>>4)<<8)|((g>>4)<<4)|(b>>4));}previous=row;
 }
 const evidence={width,height,quantizedColors:colors.size,luminanceRange:maxLuma-minLuma};
 // Neutral compositor rectangles can contain two colors but no game or UI.
 // Grayscale text/UI is valid: diversity and contrast, not color saturation, are required.
 assert.ok(colors.size>=8&&evidence.luminanceRange>=32,'Blank or low-information screenshot is not visual proof: '+JSON.stringify(evidence));return {...evidence,nonblank:true};
}
// Edge view readback returned a blank compositor backing despite healthy DOM/WebGL.
// Retry only a surface timeout, once, with an explicit live viewport clip.
async function screenshotReadback(send,probe,record){
 record.mode='surface';record.health=await probe();
 try{return await send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false,optimizeForSpeed:true});}
 catch(error){
  record.primaryError=String(error);if(error?.cdpTimeoutMethod!=='Page.captureScreenshot')throw error;
  let health;try{health=await probe();record.healthAfterTimeout=health;
   assert.ok(Number.isSafeInteger(health.width)&&health.width>0&&Number.isSafeInteger(health.height)&&health.height>0&&health.width*health.height<=16_000_000,'Bounded live viewport required for surface retry');
  }catch(probeError){record.healthProbeError=String(probeError);if(error instanceof Error)error.stack+='\nSecondary capture health failure: '+String(probeError?.stack??probeError);throw error;}
  record.mode='surface-viewport';
  return await send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false,optimizeForSpeed:true,clip:{x:0,y:0,width:health.width,height:health.height,scale:1}});
 }
}
const failureAfterCleanup=(primary,errors)=>primary??(errors.length?new AggregateError(errors,'Browser fixture cleanup failed'):null);
async function stopBrowser(child,ws,{platform=process.platform,spawnProcess=spawn,wait=sleep}={}){
 if(!child)return;
 const alive=()=>child.exitCode===null&&child.signalCode===null;
 // Ask the owned browser to shut down its children before removing its profile.
 try{if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify({id:2147483647,method:'Browser.close'}));}catch{/* The bounded owned-process fallback below still runs. */}
 for(let i=0;i<30&&alive();i++)await wait(100);
 if(alive()){
  if(!Number.isSafeInteger(child.pid)||child.pid<=0)throw Error('Owned browser is still running without a valid PID');
  let killFailure=null;
  if(platform==='win32'){
   // Never target image names or unrelated browser processes.
   const result=await new Promise((ok,bad)=>{const killer=spawnProcess('taskkill',['/PID',String(child.pid),'/T','/F'],{stdio:['ignore','ignore','pipe']});let stderr='',denialTail='',accessDenied=false;killer.stderr?.on('data',chunk=>{const text=denialTail+String(chunk);accessDenied||=/access (?:is )?denied/i.test(text);denialTail=text.slice(-32);stderr=(stderr+String(chunk)).slice(0,4096);});const timer=setTimeout(()=>{killer.kill();bad(Error('Owned browser tree termination timed out'));},5000);killer.once('error',e=>{clearTimeout(timer);bad(e);});killer.once('close',code=>{clearTimeout(timer);ok({code,stderr,accessDenied});});});
   if(result.code!==0||result.accessDenied){killFailure=Error(`Owned browser taskkill exited ${result.code}${result.accessDenied?' (access denied)':''}${result.stderr?': '+result.stderr.trim():''}`);if(result.accessDenied)throw killFailure;}
  }else child.kill('SIGTERM');
  // Browser.close and taskkill race with delivery of the owned child's exit
  // event. A nonzero taskkill is not success unless that child actually exits.
  for(let i=0;i<30&&alive();i++)await wait(100);
  if(alive())throw killFailure??Error('Owned browser did not exit');
 }
}

// A browser/network stack can retransmit a POST before JavaScript observes its
// failure. Group by idempotency key, never by assumed array positions.
function verifyLostAckPosts(posts, original, expectedNextRevision){
 assert.ok(posts.length>=3,'original, at least one replay and next save required');
 assert.deepEqual(posts[0],original,'first observed command is the lost save');
 const replays=posts.filter(p=>p.key===original.key),following=posts.filter(p=>p.key!==original.key);
 assert.ok(replays.length>=2,'the exact lost command was retried');
 for(const post of replays)assert.deepEqual(post,original,'every replay keeps the exact id and body');
 assert.ok(following.length>=1,'a subsequent current-state save must occur');
 const next=following[0];assert.ok(next.key&&next.key!==original.key,'subsequent save has a distinct key');
 for(const post of following)assert.deepEqual(post,next,'only one distinct subsequent intent is permitted');
 assert.equal(next.data.action,'save');assert.equal(next.data.expectedRevision,expectedNextRevision,'next save fences against the committed lost-ACK revision');
 return {next,replays:replays.length,subsequentAttempts:following.length};
}
function fixtureService(){
 let resetAllowed=true;
 let state={active:null,fence:0,snapshots:[],requests:new Map(),archives:new Map()},tail=Promise.resolve();
 const store={read:async()=>structuredClone(state.active),listArchives:async()=>[...state.archives.values()].map(({raw,...info})=>structuredClone(info)),readArchive:async(_,id)=>structuredClone(state.archives.get(id)??null),
  transaction:(_,work)=>{const job=tail.then(async()=>{const next=structuredClone(state);const result=await work({request:async id=>next.requests.get(id),requestCount:async()=>next.requests.size,current:async()=>next.active,deletionFence:async()=>next.fence,wasRetired:async cityId=>[...next.requests.values()].some(r=>r.response.deleted&&r.response.cityId===cityId),resetAllowed:async()=>resetAllowed,bytes:async()=>0,publish:async v=>{next.active=structuredClone(v);next.snapshots.push(structuredClone(v));next.snapshots=next.snapshots.slice(-2);},retire:async marker=>{for(const copy of next.snapshots){const archived=next.archives.get(copy.rawHash)??{hash:copy.rawHash,raw:copy.raw,sources:[]};assert.equal(archived.raw,copy.raw);const source=`deleted:${copy.cityId}:${marker.revision}:snapshot:${copy.revision}`;if(!archived.sources.includes(source))archived.sources.push(source);next.archives.set(copy.rawHash,archived);}next.snapshots=[];next.active=structuredClone(marker);next.fence=marker.revision;},record:async(id,payloadHash,response)=>{const {raw,...receipt}=response;next.requests.set(id,{payloadHash,response:structuredClone(receipt)});},hasArchive:async id=>next.archives.has(id),archive:async(id,raw,source)=>{const old=next.archives.get(id)??{hash:id,raw,sources:[]};if(!old.sources.includes(source))old.sources.push(source);next.archives.set(id,old);}});state=next;return result;});tail=job.catch(()=>{});return job;}};
 const service=createServerCityService(store);
 return {service,setResetAllowed(value){resetAllowed=value;},get state(){return structuredClone(state);},mode:'ok',delay:0,posts:[],acknowledged:0,traceSave:false,postAudit:[]};
}
async function selfTest(){
 assert.deepEqual(graphicsArgs('win32'),['--enable-unsafe-swiftshader'],'Windows uses the browser default backend, with the existing software fallback permission');
 assert.deepEqual(graphicsArgs('linux'),['--use-angle=swiftshader','--enable-unsafe-swiftshader'],'Linux graphics arguments stay unchanged');
 const renderer={renderer:'ANGLE test renderer',quality:'low',requestedQuality:'auto',shadows:false,postProcessing:false,traffic:true,paused:true,width:390,height:844,visibility:'visible',contextLosses:0};
 assert.deepEqual(rendererMetadata({...renderer,raw:'must not be retained',cookies:'must not be retained'}),renderer,'Only renderer and viewport metadata is retained');
 assert.equal(rendererMetadata({renderer:'x'.repeat(600)}).renderer.length,512,'Renderer text is bounded');
 assert.ok(Object.values(rendererMetadata(null)).every(value=>value===null));
 assert.equal(rendererMetadata({width:Infinity,paused:'false'}).width,null);assert.equal(rendererMetadata({width:Infinity,paused:'false'}).paused,null);
 const telemetry=[];for(let i=0;i<100;i++)rememberCdp(telemetry,{id:i,method:'Runtime.evaluate',status:i===99?'timeout':'ok',durationMs:i});
 assert.equal(telemetry.length,80);assert.equal(telemetry[0].id,20);assert.equal(telemetry.at(-1).status,'timeout','Bounded telemetry preserves the latest failure');
 for(const label of ['บันทึกบนเซิร์ฟเวอร์แล้ว','ตรวจสอบแล้วว่าเซฟบนเซิร์ฟเวอร์ตรงกัน']){
  assert.equal(acknowledgedSaveUi(label+' 12:00:00',false),true);assert.equal(acknowledgedSaveUi(label,true),false);
 }
 for(const text of [undefined,'','กำลังบันทึก… · บันทึกบนเซิร์ฟเวอร์แล้ว','บันทึกไม่สำเร็จ · ตรวจสอบแล้วว่าเซฟบนเซิร์ฟเวอร์ตรงกัน','ยืนยันเซฟก่อนหน้าแล้ว · มีการเปลี่ยนแปลงใหม่ที่ยังไม่บันทึก','ยังไม่มีการบันทึกสำเร็จในรอบนี้'])assert.equal(acknowledgedSaveUi(text,false),false);
 assert.equal(runLostAckNextSave({}),false);assert.equal(runLostAckNextSave({CITYMANAGER_RUN_LOST_ACK_NEXT_SAVE:'0'}),false);assert.equal(runLostAckNextSave({CITYMANAGER_RUN_LOST_ACK_NEXT_SAVE:'1'}),true);
 const listeners=[],syntheticWindow={},syntheticDocument={addEventListener:(type,fn,capture)=>listeners.push({type,fn,capture})};
 Function('window','document','Date',`(${installSaveClickTrace.toString()})()`)(syntheticWindow,syntheticDocument,Date);
 const clickListener=listeners.find(x=>x.type==='click');assert.ok(clickListener);assert.equal(clickListener.capture,true);
 clickListener.fn({target:{closest:()=>({id:'save-failure-retry',disabled:false})},isTrusted:true});
 clickListener.fn({target:{closest:()=>({id:'save',disabled:false})},isTrusted:false});
 assert.deepEqual(syntheticWindow.__saveClickTrace.map(({id,trusted,disabled})=>({id,trusted,disabled})),[{id:'save-failure-retry',trusted:true,disabled:false},{id:'save',trusted:false,disabled:false}]);
 assert.equal(JSON.stringify(syntheticWindow.__saveClickTrace).includes('cookie'),false,'Retry diagnostics contain no request credentials');
 const samplePng=(width,height,pixel)=>{const chunk=(type,data)=>{const out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);out.write(type,4);data.copy(out,8);return out;};const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=2;const raw=Buffer.alloc((width*3+1)*height);for(let y=0;y<height;y++)for(let x=0;x<width;x++)raw.set(pixel(x,y),y*(width*3+1)+1+x*3);return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);};
 const grayscale=pngEvidence(samplePng(16,16,x=>[x*17,x*17,x*17]));assert.equal(grayscale.nonblank,true);assert.equal(grayscale.quantizedColors,16,'Legitimate grayscale UI does not need game colors');
 assert.throws(()=>pngEvidence(samplePng(2,1,x=>x?[255,255,255]:[0,0,0])),/Blank/);
 assert.throws(()=>pngEvidence(samplePng(16,16,()=>[255,255,255])),/Blank/);
 // Exact failed Edge backing geometry: 373920 pixels gray243 +240480 white255.
 assert.throws(()=>pngEvidence(samplePng(960,640,(x,y)=>x<760&&y<492?[243,243,243]:[255,255,255])),/Blank/);
 assert.throws(()=>pngEvidence(Buffer.from('not PNG')));
 const captureTimeout=Object.assign(Error('capture timeout'),{cdpTimeoutMethod:'Page.captureScreenshot'});let calls=[],probes=0;const record={};
 const health={live:true,width:960,height:640};const shot=await screenshotReadback(async(method,params)=>{calls.push(params);if(calls.length===1)throw captureTimeout;return {data:'real-result'};},async()=>{probes++;return health;},record);
 assert.equal(shot.data,'real-result');assert.equal(probes,2);assert.deepEqual(calls.map(p=>p.fromSurface),[true,true]);assert.deepEqual(calls[1].clip,{x:0,y:0,width:960,height:640,scale:1});assert.equal(record.mode,'surface-viewport');
 const other=Error('actual failure');await assert.rejects(screenshotReadback(async()=>{throw other;},async()=>health,{}),error=>error===other);
 let attempts=0;await assert.rejects(screenshotReadback(async()=>{attempts++;throw captureTimeout;},async()=>health,{}),error=>error===captureTimeout);assert.equal(attempts,2,'Exactly one bounded surface retry');
 let fallbackCalled=false;await assert.rejects(screenshotReadback(async()=>{if(fallbackCalled)assert.fail('must not retry after unhealthy probe');fallbackCalled=true;throw captureTimeout;},async()=>{if(fallbackCalled)throw other;return health;},{}),error=>error===captureTimeout&&error.stack.includes('Secondary capture health failure'));

 let retryCount=0;
 for(const message of ['Inspected target navigated or closed','Execution context was destroyed.','Cannot find context with specified id']){
  assert.equal(await reloadEntryRead(async()=>{throw Object.assign(Error(message),{cdpError:{code:-32000,message}});},()=>retryCount++),false);
 }
 assert.equal(retryCount,3);assert.equal(await reloadEntryRead(async()=>true),true);
 for(const error of [Error('CDP timeout'),Object.assign(Error('wrong code'),{cdpError:{code:-1,message:'Inspected target navigated or closed'}}),Object.assign(Error('other CDP error'),{cdpError:{code:-32000,message:'Permission denied'}})])await assert.rejects(reloadEntryRead(async()=>{throw error;}),actual=>actual===error);

 const primary=Error('original acceptance failure'),cleanup=Error('profile busy');
 assert.equal(failureAfterCleanup(primary,[cleanup]),primary,'Cleanup cannot mask acceptance failure');
 assert.ok(failureAfterCleanup(null,[cleanup]) instanceof AggregateError,'Cleanup-only failure must fail acceptance');
 assert.equal(failureAfterCleanup(null,[]),null);

 const {EventEmitter}=await import('node:events');
 const cleanupCase=async({code=255,exitAt=Infinity,exitWithTaskkill=false,stderr='',launchError=null,pid=18765}={})=>{
  const child={pid,exitCode:null,signalCode:null},commands=[];let waits=0;
  const work=stopBrowser(child,{readyState:WebSocket.OPEN,send:raw=>commands.push(JSON.parse(raw))},{platform:'win32',wait:async ms=>{assert.equal(ms,100);if(++waits===exitAt)child.exitCode=0;},spawnProcess:(command,args,options)=>{
   assert.equal(command,'taskkill');assert.deepEqual(args,['/PID','18765','/T','/F']);assert.deepEqual(options.stdio,['ignore','ignore','pipe']);
   const killer=new EventEmitter();killer.stderr=new EventEmitter();killer.kill=()=>assert.fail('Immediate synthetic taskkill must not time out');
   queueMicrotask(()=>{if(launchError)killer.emit('error',launchError);else{if(exitWithTaskkill)child.exitCode=0;for(const chunk of Array.isArray(stderr)?stderr:[stderr])if(chunk)killer.stderr.emit('data',chunk);killer.emit('close',code);}});return killer;
  }});
  return {work,child,commands,waits:()=>waits};
 };
 const raced=await cleanupCase({exitAt:31});await raced.work;assert.equal(raced.child.exitCode,0);assert.equal(raced.waits(),31);assert.deepEqual(raced.commands,[{id:2147483647,method:'Browser.close'}]);
 const concurrent=await cleanupCase({exitWithTaskkill:true});await concurrent.work;assert.equal(concurrent.child.exitCode,0);assert.equal(concurrent.waits(),30,'Already observed exit during taskkill needs no extra wait');
 for(const code of [0,255]){const alive=await cleanupCase({code});await assert.rejects(alive.work,code===0?/Owned browser did not exit/:/taskkill exited 255/);assert.equal(alive.waits(),60,'Cleanup remains bounded and never treats an unconfirmed exit as success');}
 for(const pid of [null,0,'18765']){const missing=await cleanupCase({pid});await assert.rejects(missing.work,/without a valid PID/);assert.equal(missing.waits(),30,'An unconfirmed child without an owned PID cannot pass cleanup or invoke taskkill');}
 const denied=await cleanupCase({stderr:'ERROR: Access is denied.',exitWithTaskkill:true});await assert.rejects(denied.work,/Access is denied/);
 const lateDenial=await cleanupCase({code:0,stderr:['x'.repeat(4096),'Access is ','denied.'],exitWithTaskkill:true});await assert.rejects(lateDenial.work,error=>/access denied/.test(error.message)&&error.message.length<4200,'Denial detection survives truncation and split chunks without unbounded diagnostics');
 const launchError=Object.assign(Error('spawn taskkill EACCES'),{code:'EACCES'}),unavailable=await cleanupCase({launchError});await assert.rejects(unavailable.work,error=>error===launchError);

 assert.equal(expectedReloadDialog('beforeunload',true),true);
 for(const [type,scope] of [['beforeunload',false],['confirm',true],['alert',true],['prompt',true]])assert.equal(expectedReloadDialog(type,scope),false);
 const old={key:'first',data:{action:'save',expectedRevision:3,raw:'exact'}},next={key:'next',data:{action:'save',expectedRevision:4,raw:'current'}};
 const grouped=verifyLostAckPosts([old,structuredClone(old),structuredClone(old),next,structuredClone(next)],old,4);assert.equal(grouped.replays,3);assert.equal(grouped.subsequentAttempts,2);
 assert.throws(()=>verifyLostAckPosts([old,{...old,data:{...old.data,raw:'changed'}},next],old,4));
 assert.throws(()=>verifyLostAckPosts([old,next,next],old,4));
 assert.throws(()=>verifyLostAckPosts([old,old,next,{...next,key:'third'}],old,4));
 assert.throws(()=>verifyLostAckPosts([old,old,{...next,data:{...next.data,expectedRevision:3}}],old,4));
 const f=fixtureService(),id=randomUUID(),cityId=randomUUID(),body={action:'create',cityId,raw:'{"version":23,"tick":1}',metadata:{name:'fixture',population:0,tick:1}};
 const first=await f.service.mutate(OWNER,id,body);assert.equal(first.revision,1);assert.deepEqual(await f.service.mutate(OWNER,id,body),first);
 await assert.rejects(f.service.mutate(OWNER,randomUUID(),body),e=>e.status===409);
 await f.service.archive(OWNER,{raw:body.raw,source:'primary'});await f.service.archive(OWNER,{raw:body.raw,source:'checkpoint'});
 assert.deepEqual((await f.service.readArchive(OWNER,hash(body.raw))).sources,['primary','checkpoint']);
 assert.equal(f.state.active.revision,1);
 // Deterministically deliver duplicate transport attempts to the same service
 // transaction, then a distinct fenced save. Duplicates must not recommit.
 const d=fixtureService(),did=randomUUID(),dCity=randomUUID(),dCreate={...body,cityId:dCity};await d.service.mutate(OWNER,randomUUID(),dCreate);
 const lost={key:did,data:{action:'save',cityId:dCity,expectedRevision:1,raw:'{\"version\":23,\"tick\":2}',metadata:{name:'fixture',population:0,tick:2}}};
 const nextSave={key:randomUUID(),data:{action:'save',cityId:dCity,expectedRevision:2,raw:'{\"version\":23,\"tick\":3}',metadata:{name:'fixture',population:0,tick:3}}};
 for(const post of [lost,structuredClone(lost),structuredClone(lost),nextSave])await d.service.mutate(OWNER,post.key,post.data);
 verifyLostAckPosts([lost,structuredClone(lost),structuredClone(lost),nextSave],lost,2);
 assert.equal(d.state.active.revision,3);assert.equal(d.state.requests.size,3,'create plus two save receipts despite duplicate deliveries');
 assert.equal(d.state.requests.get(did).response.revision,2);assert.equal(d.state.requests.get(nextSave.key).response.revision,3);
 const deleteId=randomUUID(),remove={action:'delete',cityId,expectedRevision:1};
 const tombstone=await f.service.mutate(OWNER,deleteId,remove);
 assert.deepEqual(tombstone,{owner:OWNER,cityId,revision:2,deleted:true,archiveHash:hash(body.raw)});
 assert.deepEqual(await f.service.read(OWNER),tombstone,'reload returns tombstone, not old city');
 assert.deepEqual(await f.service.mutate(OWNER,deleteId,remove),tombstone,'uncertain delete retry is idempotent');
 assert.equal(f.state.snapshots.length,0);assert.equal((await f.service.readArchive(OWNER,tombstone.archiveHash)).raw,body.raw);
 await assert.rejects(f.service.mutate(OWNER,id,body),e=>e.status===409,'old create receipt cannot resurrect deleted city');
 const newCityId=randomUUID(),market={version:10,rulesVersion:'chain-5',guestId:OWNER,cityId:newCityId,seq:'0',operations:[],escrow:[],receipts:{}};
 const fresh={action:'create',cityId:newCityId,expectedRevision:2,raw:JSON.stringify({version:23,tick:0,market}),metadata:{name:'fixture fresh',population:0,tick:0}};
 const created=await f.service.mutate(OWNER,randomUUID(),fresh);assert.equal(created.revision,3);assert.equal(created.owner,OWNER);assert.notEqual(created.cityId,cityId);
 await assert.rejects(f.service.mutate(OWNER,randomUUID(),{action:'save',cityId,expectedRevision:1,raw:body.raw,metadata:body.metadata}),e=>e.status===409);
 await assert.rejects(f.service.mutate(OWNER,deleteId,remove),e=>e.status===409,'old delete receipt cannot retire new city');
 assert.equal(f.state.active.cityId,newCityId);
 console.log('PASS fixture service self-test (not browser acceptance)');
}
async function run(){
 const dist=resolve('dist');await readFile(resolve(dist,'index.html'));const f=fixtureService();
 const server=createServer(async(req,res)=>{let audit;try{
  const path=new URL(req.url,'http://127.0.0.1').pathname;
  if(path.startsWith('/citymanager-api/')){
   if(!req.headers.cookie?.split('; ').includes(`cm_session=${COOKIE}`)){res.writeHead(401,{'Content-Type':'application/json'});res.end('{"error":"fixture-login-required"}');return;}
   if(req.method==='POST'&&req.headers['x-csrf-token']!==CSRF){res.writeHead(403);res.end('{"error":"csrf"}');return;}
   let data=null;if(req.method==='POST'){let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>12_000_000)throw Error('fixture-body-limit');}data=JSON.parse(raw);}
   const route=path.slice('/citymanager-api'.length);let result;
   if(route==='/v1/me')result={guest_id:OWNER};
   else if(route==='/v1/city-save'&&req.method==='POST'){
    if(f.traceSave){audit={index:f.posts.length,at:Date.now(),modeAtReceive:f.mode,action:data.action,expectedRevision:data.expectedRevision};f.postAudit.push(audit);res.once('finish',()=>{audit.finished=true;});res.once('close',()=>{audit.closed=true;});}
    f.posts.push({key:req.headers['idempotency-key'],data:structuredClone(data)});
    if(f.mode==='disconnect'){if(audit)audit.outcome='disconnect';req.socket.destroy();return;}
    if(f.mode==='conflict')throw Object.assign(Error('save-conflict'),{status:409});
    if(f.delay)await sleep(f.delay);
    result=await f.service.mutate(OWNER,req.headers['idempotency-key'],data);if(audit){audit.modeAtDecision=f.mode;audit.revision=result.revision;}if((f.mode==='drop-delete-ack'&&data.action==='delete')||(f.mode==='drop-save-ack'&&data.action==='save')){if(audit)audit.outcome='drop-ack';req.socket.destroy();return;}if(audit)audit.outcome='http-200';f.acknowledged++;
   }else if(route==='/v1/city-save'){if(f.mode==='load-error')throw Object.assign(Error('fixture-load-unavailable'),{status:503});result=await f.service.read(OWNER);}
   else if(route==='/v1/city-save/archives'){if(req.method==='POST'&&f.mode==='archive-error')throw Object.assign(Error('fixture-archive-unavailable'),{status:503});result=req.method==='POST'?await f.service.archive(OWNER,data):await f.service.listArchives(OWNER);}
   else if(route.startsWith('/v1/city-save/archives/'))result=await f.service.readArchive(OWNER,route.split('/').at(-1));
   else throw Object.assign(Error('fixture-route-not-found'),{status:404});
   res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(result));return;
  }
  const relative=decodeURIComponent(path.replace(/^\/CityManager\/?/,''));const file=resolve(dist,relative||'index.html');
  if(file!==dist&&!file.startsWith(dist+sep))throw Object.assign(Error('path'),{status:403});
  const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'};
  const bytes=await readFile(file);res.writeHead(200,{'Content-Type':mime[extname(file)]??'application/octet-stream','Cache-Control':'no-store'});res.end(bytes);
 }catch(e){if(audit){audit.outcome='error';audit.status=e.status??500;audit.error=String(e.message);}if(!res.headersSent)res.writeHead(e.status??500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));}});
 let child,ws,profile,acceptanceError;const pending=new Map();let id=0,expectReloadDialog=false,expectedConfirm=null,unexpectedDialog=null;
 try{
  await new Promise((ok,bad)=>{server.once('error',bad);server.listen(0,'127.0.0.1',ok);});
  const origin=`http://127.0.0.1:${server.address().port}`,url=origin+'/CityManager/'+(process.env.CITYMANAGER_TRAFFIC_CHECKS==='bumper-gap'?'?bus=1':'');
  profile=await mkdtemp(resolve(tmpdir(),'city-server-save-smoke-'));
  const browser=process.env.CITYMANAGER_BROWSER||(process.platform==='win32'?'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe':'google-chrome');
  const graphics=graphicsArgs();diagnostics.browserLaunch={platform:process.platform,graphicsArgs:graphics,backendSelection:process.platform==='win32'?'browser-default':'forced-swiftshader'};
  child=spawn(browser,['--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-background-timer-throttling',...graphics,'--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore'});
  let launchError;child.on('error',e=>{launchError=e;});let debugPort;
  for(let i=0;i<100&&!debugPort;i++){if(launchError)throw launchError;if(child.exitCode!==null)throw Error(`Browser exited ${child.exitCode}; no acceptance result`);try{debugPort=Number((await readFile(resolve(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);}catch{}await sleep(100);}
  assert.ok(debugPort,'Browser unavailable; acceptance NOT passed');
  const pages=await(await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();ws=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
  const observedSaveRequests=new Set();
  ws.onmessage=e=>{const m=JSON.parse(e.data);
   if(f.traceSave&&m.method==='Network.requestWillBeSent'&&m.params.request.method==='POST'&&m.params.request.url===origin+'/citymanager-api/v1/city-save'){
    observedSaveRequests.add(m.params.requestId);diagnostics.saveNetwork.push({event:'request',id:m.params.requestId,at:Date.now()});
   }else if(f.traceSave&&observedSaveRequests.has(m.params?.requestId)&&['Network.responseReceived','Network.loadingFinished','Network.loadingFailed'].includes(m.method)){
    diagnostics.saveNetwork.push({event:m.method,id:m.params.requestId,status:m.params.response?.status,error:m.params.errorText,canceled:m.params.canceled,at:Date.now()});
   }
   if(diagnostics.saveNetwork.length>100)diagnostics.saveNetwork.shift();
   if(m.method==='Runtime.exceptionThrown'||m.method==='Inspector.targetCrashed')diagnostics.runtimeErrors.push({method:m.method,details:m.params});
   if(m.method==='Page.javascriptDialogOpening'){
    const dialog={type:m.params.type,message:m.params.message,phase:diagnostics.phase,expected:expectedReloadDialog(m.params.type,expectReloadDialog)||(m.params.type==='confirm'&&expectedConfirm!==null&&m.params.message.includes('เก็บเมืองที่กำลังเล่นเป็นสำเนาบนเซิร์ฟเวอร์'))};diagnostics.dialogs.push(dialog);console.log('Browser dialog',JSON.stringify(dialog));
    if(dialog.expected){const accept=m.params.type==='confirm'?expectedConfirm:true;expectedConfirm=null;expectReloadDialog=false;void send('Page.handleJavaScriptDialog',{accept}).catch(error=>{unexpectedDialog=error;});}
    else {unexpectedDialog=Error(`Unexpected browser dialog: ${JSON.stringify(dialog)}`);for(const p of pending.values())p.reject(unexpectedDialog);pending.clear();}
   }
   if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p?.reject(Object.assign(Error(JSON.stringify(m.error)),{cdpError:m.error})):p?.resolve(m.result);}};
  await new Promise((ok,bad)=>{ws.onopen=ok;ws.onerror=bad;});
  const send=(method,params={})=>new Promise((resolve,reject)=>{
   const n=++id,started=performance.now(),phase=diagnostics.phase,expression=method==='Runtime.evaluate'?String(params.expression??'').slice(0,240):undefined;let finished=false;
   const record=status=>{if(finished)return;finished=true;rememberCdp(diagnostics.cdp,{id:n,method,phase,...(expression===undefined?{}:{expression}),status,durationMs:Math.round(performance.now()-started)});};
   const t=setTimeout(()=>{pending.delete(n);record('timeout');reject(Object.assign(Error(`CDP timeout: ${method}; phase=${phase}; expression=${expression??diagnostics.lastExpression}`),{cdpTimeoutMethod:method}));},30_000);
   pending.set(n,{resolve:v=>{clearTimeout(t);record('ok');resolve(v);},reject:e=>{clearTimeout(t);record('error');reject(e);}});ws.send(JSON.stringify({id:n,method,params}));
  });
  const evaluate=async expression=>{if(unexpectedDialog)throw unexpectedDialog;diagnostics.lastExpression=expression.slice(0,240);const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  const recordRenderer=async phase=>{
   const value=await evaluate("(()=>{const a=window.cityManager?.atmosphere();return {renderer:a?.renderer,quality:a?.quality,requestedQuality:a?.settings.quality,shadows:a?.shadows,postProcessing:a?.postProcessing,traffic:a?.settings.traffic,paused:window.cityManager?.parks().paused,width:innerWidth,height:innerHeight,visibility:document.visibilityState,contextLosses:window.__contextLosses}})()");
   const evidence={phase,...rendererMetadata(value)};diagnostics.renderers.push(evidence);if(diagnostics.renderers.length>16)diagnostics.renderers.shift();console.log('Renderer evidence',JSON.stringify(evidence));
  };
  const until=async(fn,label,ms=90_000)=>{diagnostics.phase=label;console.log('Acceptance phase:',label);const start=Date.now();while(Date.now()-start<ms){if(await fn())return;await sleep(100);}throw Error(`Timeout: ${label}`);};
  await send('Runtime.enable');await send('Page.enable');await send('Network.enable');await send('Inspector.enable');diagnostics.browserVersion=await send('Browser.getVersion');
  await send('Network.setCookie',{name:'cm_session',value:COOKIE,url:origin,httpOnly:true,sameSite:'Strict'});await send('Network.setCookie',{name:'cm_csrf',value:CSRF,url:origin,sameSite:'Strict'});
  if(process.env.CITYMANAGER_TRAFFIC_CHECKS==='bumper-gap'){const {trafficGapBootstrap}=await import('./traffic-gap-browser-checks.mjs');await send('Page.addScriptToEvaluateOnNewDocument',{source:trafficGapBootstrap()});}
  const serverSeed=await readFile(new URL('./fixtures/save-smoke/bus-optional-day60.json',import.meta.url),'utf8');
  const seed=JSON.stringify({obsoleteBrowserOnly:true,tick:99999});
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{if(location.origin!==${JSON.stringify(origin)})return;
   if(!localStorage.getItem('__fixture_seeded')){localStorage.setItem('citymanager.save.v7',${JSON.stringify(seed)});localStorage.setItem('citymanager.checkpoint.latest',${JSON.stringify(seed)});localStorage.setItem('__fixture_seeded','1');}
   window.__contextLosses=0;document.addEventListener('webglcontextlost',()=>window.__contextLosses++,true);
   window.__cityWrites=[];window.__quota=false;const city=/^citymanager\\.(save\\.|backup\\.|checkpoint\\.|resume-choice|market\\.)/;
   for(const method of ['setItem','removeItem','clear']){const original=Storage.prototype[method];Storage.prototype[method]=function(...args){if(method==='clear'||city.test(String(args[0])))window.__cityWrites.push(method+':'+args[0]);if(window.__quota&&method==='setItem')throw new DOMException('fixture quota','QuotaExceededError');return original.apply(this,args);};}
   const transaction=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(stores,mode,...rest){if(mode==='readwrite'&&/citymanager/.test(this.name))window.__cityWrites.push('IDB:'+this.name);return transaction.call(this,stores,mode,...rest);};
   const si=window.setInterval;window.setInterval=function(fn,ms,...args){return ms===60000?si.call(this,()=>{if(!window.__suspendAcceleratedAutosave)fn(...args);},1500):si.call(this,fn,ms,...args);};})();`});
  const click=selector=>{diagnostics.phase=`click ${selector}`;return evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);};
  const entryPredicate=()=>evaluate("!!document.querySelector('.guest-entry-card button:not(:disabled)')");
  const reloadEntryPredicate=()=>reloadEntryRead(entryPredicate,error=>{diagnostics.navigationRetries.push({phase:diagnostics.phase,...error});console.log('Post-reload entry context retry',JSON.stringify(error));});
  const enter=async({afterReload=false}={})=>{await until(afterReload?reloadEntryPredicate:entryPredicate,'existing login entry');await click('.guest-entry-card button');await until(()=>evaluate('!!window.cityManager&&window.cityManager.visuals().ready'),'confirmed server city');await recordRenderer(afterReload?'reloaded server city':'initial server city');};
  const clean=async()=>assert.deepEqual(await evaluate('window.__cityWrites'),[],'browser city writes prohibited');
  const failed=()=>evaluate("!!document.querySelector('#save-failure-banner:not([hidden])')");
  const settled=(label='acknowledged save UI')=>until(async()=>{
   const ui=await evaluate("({text:document.querySelector('#autosave-status')?.textContent,failureVisible:!!document.querySelector('#save-failure-banner:not([hidden])')})");
   diagnostics.saveUi={...ui,acknowledged:f.acknowledged,revision:f.state.active?.revision??null};
   return acknowledgedSaveUi(ui.text,ui.failureVisible);
  },label);
  const capture=async (name,{requireReady=true}={})=>{
   assert.match(name,/^[a-z0-9_-]+$/i);const record={name,phase:diagnostics.phase,started:new Date().toISOString(),status:'pending'};diagnostics.captures.push(record);console.log('Capture start',name,'surface');let png;
   const probe=async()=>{assert.deepEqual(diagnostics.runtimeErrors,[],'No uncaught browser error or renderer crash');const health=await evaluate("({ready:window.cityManager?.visuals().ready,contextLosses:window.__contextLosses,visibility:document.visibilityState,width:innerWidth,height:innerHeight})");if(requireReady)assert.equal(health.ready,true);assert.equal(health.contextLosses,0,'WebGL context must remain live');return health;};
   try{const shot=await screenshotReadback(send,probe,record);png=Buffer.from(shot.data,'base64');Object.assign(record,pngEvidence(png));await writeFile(resolve(output,`${name}.png`),png);record.status='saved';return {png,width:record.width,height:record.height};}
   catch(error){record.status='failed';record.error=String(error);if(png){try{await writeFile(resolve(output,`${name}-rejected.png`),png);record.rejectedEvidence=`${name}-rejected.png`;}catch(preserveError){record.preserveError=String(preserveError);}}throw error;}
   finally{record.finished=new Date().toISOString();console.log('Capture result',JSON.stringify(record));}
  };
  f.mode='load-error';await send('Page.navigate',{url});
  if(process.env.CITYMANAGER_PR182_CHECKS==='1'){for(const [name,width,height,mobile] of [['desktop',1280,800,false],['mobile',390,844,true]]){await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile});await until(()=>evaluate("!!document.querySelector('.guest-entry-card button:not(:disabled)')"),'visible entry '+name);await capture('pr182-entry-'+name,{requireReady:false});}await send('Emulation.clearDeviceMetricsOverride');}
  await until(()=>evaluate("!!document.querySelector('.guest-entry-card button:not(:disabled)')"),'entry before unavailable load');await click('.guest-entry-card button');
  await until(()=>evaluate("document.querySelector('.guest-entry-card [role=status]')?.textContent.includes('fixture-load-unavailable')"),'load failure stays gated');
  assert.equal(await evaluate('!!window.cityManager'),false,'no offline city entry after server load failure');assert.equal(f.state.active,null);await clean();
  const acknowledged=await f.service.mutate(OWNER,randomUUID(),{action:'create',cityId:randomUUID(),raw:serverSeed,metadata:{name:'acknowledged fixture',population:0,tick:JSON.parse(serverSeed).tick}});
  assert.equal(acknowledged.raw,serverSeed);f.mode='ok';await enter();
  if(process.env.CITYMANAGER_LAND_CHECKS==='1'){
   const {deserializeParkSession}=await import('../src/park-runtime.ts');
   const source=deserializeParkSession(serverSeed).city, expanded=JSON.parse(await evaluate('window.cityManager.sessionSnapshot()'));
   assert.equal(f.state.active.raw,serverSeed,'loading migration does not write original bytes');
   assert.deepEqual(expanded.cells.slice(0,576),source.cells);assert.deepEqual(expanded.resources.fertility.slice(0,576),source.resources.fertility);
   for(const key of ['seed','rng','tick','nextId','buildings','households','firms','accounts','ledger','goods','goodsLedger','cropLedger','market'])assert.deepEqual(expanded[key],source[key],`preserve ${key}`);
  }
  assert.equal(f.state.active.metadata.tick,JSON.parse(serverSeed).tick);assert.equal(f.state.archives.size,0,'obsolete browser copies are neither imported nor archived');assert.equal(await evaluate("localStorage.getItem('citymanager.save.v7')"),seed);await clean();
  assert.equal(await evaluate("!!document.querySelector('#save:not(:disabled)')"),true,'real Save control available after authenticated entry');
  if(process.env.CITYMANAGER_PR182_CHECKS==='1'){const {pr182VisualChecks}=await import('./pr182-visual-checks.mjs');await pr182VisualChecks({send,evaluate,capture});await clean();}
  if(process.env.CITYMANAGER_PR182_CHECKS==='1'){
   // Instantiate the advanced owner panel: its former dynamically-created Blob
   // download included a city checkpoint. Verification remains read-only.
   const wasPaused=await evaluate('window.cityManager.parks().paused');if(!wasPaused)await click('#pause');
   await click('#toggle-game-menu');const wasAdvanced=await evaluate("document.querySelector('#toggle-advanced').getAttribute('aria-pressed')==='true'");if(!wasAdvanced)await click('#toggle-advanced');
   await click('#toggle-inspector');await evaluate("document.querySelector('#owner-decisions').open=true");
   assert.equal(await evaluate("!!document.querySelector('#owner-export')"),false,'no owner checkpoint export control');
   assert.equal(await evaluate("!!document.querySelector('#owner-verify:not(:disabled)')"),true,'read-only verification retained');
   const snapshot=await evaluate('window.cityManager.sessionSnapshot()');
   await evaluate(`window.__downloadAttempts=0;window.__originalCreateObjectURL=URL.createObjectURL;URL.createObjectURL=function(...a){window.__downloadAttempts++;return window.__originalCreateObjectURL.apply(this,a)};window.__downloadListener=e=>{if(e.target.closest('a[download]'))window.__downloadAttempts++};document.addEventListener('click',window.__downloadListener,true)`);
   await click('#owner-verify');await until(()=>evaluate("!document.querySelector('#owner-verify').disabled"),'owner replay verification finishes');
   assert.equal(await evaluate("document.querySelector('#owner-decisions').dataset.lastStatus"),'verified','read-only replay still verifies');assert.equal(await evaluate('window.__downloadAttempts'),0,'read-only replay action cannot create a download');assert.equal(await evaluate('window.cityManager.sessionSnapshot()'),snapshot,'replay verification does not mutate city');
   await evaluate(`URL.createObjectURL=window.__originalCreateObjectURL;document.removeEventListener('click',window.__downloadListener,true)`);await click('#close-inspector');if(!wasAdvanced){await click('#toggle-game-menu');await click('#toggle-advanced');await click('#close-inspector');}if(!wasPaused)await click('#pause');await clean();
  }
  if(process.env.CITYMANAGER_TOOLBAR_CHECKS==='classic'){
   diagnostics.phase='classic toolbar interactions';toolbarEvidence={status:'running',checks:[]};
   const {toolbarChecks}=await import('./visual-final-toolbar.mjs');
   toolbarEvidence=await toolbarChecks({send,evaluate,capture});await clean();
   console.log('PASS classic toolbar actual DOM checks',JSON.stringify(toolbarEvidence));
  }
  // No success before the server transaction acknowledgement.
  // Paused startup need not autosave: establish a real acknowledged manual save first.
  const initialAck=f.acknowledged;await click('#save');await until(async()=>f.acknowledged>initialAck,'initial manual ACK');await settled();assert.equal(JSON.parse(f.state.active.raw).version,26,'actual built game saves expanded checkpointed server city');assert.equal(JSON.parse(f.state.active.raw).mapBaseVersion,25);assert.equal(JSON.parse(f.state.active.raw).commercialBaseVersion,24);assert.equal(JSON.parse(f.state.active.raw).rulesVersion,'chain-21');await clean();await capture('server-save-acknowledged');
  if(process.env.CITYMANAGER_TRAFFIC_CHECKS==='bumper-gap'){
   diagnostics.phase='actual bumper-gap traffic UI';trafficGapEvidence={status:'running'};
   const {trafficGapBrowserChecks}=await import('./traffic-gap-browser-checks.mjs');
   trafficGapEvidence=await trafficGapBrowserChecks({send,evaluate,capture,phase:label=>{diagnostics.phase=`traffic: ${label}`;console.log('Traffic acceptance phase:',label);},
    loadFixture:async raw=>{const before=f.state.active;const result=await f.service.mutate(OWNER,randomUUID(),{action:'save',cityId:before.cityId,expectedRevision:before.revision,raw,metadata:{name:'synthetic traffic fixture',population:0,tick:JSON.parse(raw).tick}});assert.equal(result.raw,raw,'Only the isolated mock service installs the validated synthetic fixture');},
    acknowledge:async()=>{const revision=f.state.active.revision;await click('#save');await until(async()=>f.state.active.revision>revision,'traffic durable server ACK');await settled();await clean();return JSON.parse(f.state.active.raw);},
    reload:async()=>{diagnostics.phase='explicit traffic reload';expectReloadDialog=true;await send('Page.reload',{ignoreCache:true});await enter({afterReload:true});expectReloadDialog=false;await clean();}});
   console.log('PASS actual bumper-gap traffic, fault fallback and server reload',JSON.stringify(trafficGapEvidence));
  }
  if(process.env.CITYMANAGER_RAIL_CHECKS==='activation'){
   diagnostics.phase='actual rail UI';railEvidence={status:'running'};
   const {railBrowserChecks}=await import('./rail-browser-checks.mjs');
   railEvidence=await railBrowserChecks({send,evaluate,capture,
    acknowledge:async()=>{const revision=f.state.active.revision;await click('#save');await until(async()=>f.state.active.revision>revision,'rail durable server ACK');await settled();await clean();return JSON.parse(f.state.active.raw);},
    reload:async()=>{diagnostics.phase='explicit rail reload';expectReloadDialog=true;await send('Page.reload',{ignoreCache:true});await enter({afterReload:true});expectReloadDialog=false;await clean();}});
   console.log('PASS actual rail placement, movement and server reload',JSON.stringify(railEvidence));
  }
  f.delay=1000;const before=f.acknowledged,postsBefore=f.posts.length;await click('#save');await until(async()=>f.posts.length>postsBefore,'manual request');assert.equal(f.acknowledged,before);assert.match(await evaluate("document.querySelector('#autosave-status').textContent"),/กำลังบันทึก/);await until(async()=>f.acknowledged>before,'manual ACK');await settled();f.delay=0;await clean();
  await evaluate('window.__quota=true');let rev=f.state.active.revision;await click('#save');await until(async()=>f.state.active.revision>rev,'quota independent server commit');await settled();await clean();
  rev=f.state.active.revision;const autosaveTick=f.state.active.metadata.tick,autosavePosts=f.posts.length;
  await click('[data-speed="1"]');if(await evaluate('window.cityManager.parks().paused'))await click('#pause');
  await until(async()=>f.state.active.revision>rev&&f.state.active.metadata.tick>autosaveTick,'normal-speed autosave durable commit');
  assert.ok(f.posts.slice(autosavePosts).some(p=>p.data?.action==='save'&&JSON.parse(p.data.raw).tick>autosaveTick),'Automatic POST contains actual progressed runtime, not a manual save');
  diagnostics.autosave={beforeRevision:rev,beforeTick:autosaveTick,acknowledgedRevision:f.state.active.revision,acknowledgedTick:f.state.active.metadata.tick};
  diagnostics.phase='pause after durable autosave';if(!await evaluate('window.cityManager.parks().paused'))await click('#pause');
  assert.equal(await evaluate('window.cityManager.parks().paused'),true);await settled('durable autosave UI after pause');await clean();
  rev=f.state.active.revision;await click('#save');await until(async()=>f.state.active.revision>rev,'save before reload');await settled();const saved=JSON.parse(f.state.active.raw);await clean();
  // A real beforeunload guard may protect changes after the ACK. Explicit reload is the tested user choice.
  diagnostics.phase='explicit reload after acknowledged save';expectReloadDialog=true;await send('Page.reload',{ignoreCache:true});await enter({afterReload:true});expectReloadDialog=false;const loaded=JSON.parse(await evaluate('window.cityManager.sessionSnapshot()'));assert.equal(loaded.tick,saved.tick);assert.deepEqual(loaded.accounts,saved.accounts);assert.deepEqual(loaded.bus,saved.bus);await clean();
  // The separate autosave test above already passed. Prevent only its artificially
  // accelerated fixture timer from racing the controlled fault/retry matrix.
  await send('Page.addScriptToEvaluateOnNewDocument',{source:'window.__suspendAcceleratedAutosave=true'});await evaluate('window.__suspendAcceleratedAutosave=true');const drainRevision=f.state.active.revision;await click('#save');await until(async()=>f.state.active.revision>drainRevision,'post-reload manual ACK before fault matrix');await settled();
  await until(async()=>{const n=f.posts.length;await sleep(500);return f.posts.length===n;},'drain accelerated autosave requests',10000);
  // Actual visible banner control retries the exact uncertain command on both sizes.
  await evaluate(`(${installSaveClickTrace.toString()})()`);f.traceSave=true;f.postAudit=[];
  const pressRetry=async mobile=>{// A viewport change (e.g. clearing the mobile override) reflows the banner over several frames;
   // measure only once the button's box is the same across consecutive frames, and count clicks that reach it.
   await evaluate(`new Promise(done=>{const e=document.querySelector('#save-failure-retry');if(!window.__retryClickCounter){window.__retryClicks=0;document.addEventListener('click',ev=>{if(ev.target instanceof Element&&ev.target.closest('#save-failure-retry'))window.__retryClicks++;},true);window.__retryClickCounter=true;}let last='',same=0,frames=0;const step=()=>{const r=e.getBoundingClientRect(),key=[innerWidth,innerHeight,r.left,r.top,r.width,r.height].map(v=>Math.round(v)).join(',');same=key===last?same+1:0;last=key;if(same>=3||++frames>120)done(true);else requestAnimationFrame(step);};requestAnimationFrame(step);})`);
   const clicksBefore=await evaluate('window.__retryClicks');
   const box=await evaluate(`(()=>{const e=document.querySelector('#save-failure-retry'),r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;return {x,y,width:r.width,height:r.height,hit:e.contains(document.elementFromPoint(x,y))};})()`);assert.ok(box.hit&&box.width>0&&box.height>0,'retry must be visible and hit-testable');if(mobile){assert.ok(box.width>=44&&box.height>=44,'touch retry target at least 44px');await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x,y:box.y}]});await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}else{await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:box.x,y:box.y});const afterMove=await evaluate(`(()=>{const e=document.querySelector('#save-failure-retry'),r=e.getBoundingClientRect(),t=document.elementFromPoint(${box.x},${box.y});return {x:r.x,y:r.y,width:r.width,height:r.height,hit:e.contains(t),targetId:t?.id??'',targetTag:t?.tagName??''};})()`);diagnostics.retryMouse={before:box,afterMove};await send('Input.dispatchMouseEvent',{type:'mousePressed',x:box.x,y:box.y,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:box.x,y:box.y,button:'left',clickCount:1});}await until(async()=>(await evaluate('window.__retryClicks'))>clicksBefore,'retry click reached the banner button',5000);};
  assert.equal(await evaluate(`!!document.querySelector('#save-failure-export,#export,#import,[download],input[type=file]')`),false,'no browser city export or import controls');
  for(const [name,width,height,mobile] of [['desktop',1280,800,false],['mobile',390,844,true]]){
   await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile});await send('Emulation.setTouchEmulationEnabled',{enabled:mobile});
   await recordRenderer('retry viewport '+name);
   f.mode='disconnect';const start=f.posts.length;await click('#save');await until(failed,'truthful network failure '+name);assert.match(await evaluate("document.querySelector('#save-failure-banner').textContent"),/ไม่มีสำเนาในเบราว์เซอร์/);await clean();
   if(process.env.CITYMANAGER_PR182_CHECKS==='1')await capture('pr182-banner-'+name);
   const pendingCommand=f.posts[start];f.mode='ok';rev=f.state.active.revision;await pressRetry(mobile);await until(async()=>{diagnostics.retryBanner={name,initialRevision:rev,headRevision:f.state.active.revision,fixtureAudit:structuredClone(f.postAudit),clicks:await evaluate('window.__saveClickTrace')};return f.state.active.revision>rev;},'banner retry acknowledgement '+name);await settled();assert.deepEqual(f.posts[start+1],pendingCommand,'exact uncertain command retry');await clean();
  }
  await send('Emulation.setTouchEmulationEnabled',{enabled:false});await send('Emulation.clearDeviceMetricsOverride');
  await recordRenderer('restored desktop viewport');
  // Commit succeeded but its ACK was lost. The banner must replay the original
  // key/body before trackedSave writes the current state as a new revision.
  // Explicitly excluded from this release's acceptance by the owner; keep it
  // opt-in for a later investigation rather than claiming it passed.
  if(runLostAckNextSave(process.env)){
  await evaluate('window.__saveClickTrace=[]');f.postAudit=[];
  const lostHead=f.state.active,lostRequests=f.state.requests.size,lostStart=f.posts.length;f.mode='drop-save-ack';await click('#save');await until(failed,'committed save with lost ACK');
  assert.equal(f.state.active.revision,lostHead.revision+1);assert.equal(f.state.requests.size,lostRequests+1);const lostCommand=f.posts[lostStart];
  const lostAckSnapshot=async()=>{const posts=f.posts.slice(lostStart);diagnostics.lostAck={initialRevision:lostHead.revision,headRevision:f.state.active.revision,initialReceiptCount:lostRequests,receiptCount:f.state.requests.size,posts:posts.map(({key,data})=>({sameOriginalKey:key===lostCommand.key,action:data.action,expectedRevision:data.expectedRevision,rawHash:typeof data.raw==='string'?hash(data.raw):null})),fixtureAudit:structuredClone(f.postAudit),network:structuredClone(diagnostics.saveNetwork),ui:await evaluate(`({bannerVisible:!!document.querySelector('#save-failure-banner:not([hidden])'),banner:document.querySelector('#save-failure-banner')?.textContent,badge:document.querySelector('#autosave-status')?.textContent,saveDisabled:document.querySelector('#save')?.disabled,clicks:window.__saveClickTrace})`)};return posts;};
  f.mode='ok';await pressRetry(false);await until(async()=>{const posts=await lostAckSnapshot(),next=posts.find(p=>p.key!==lostCommand.key);return !!next&&f.state.requests.has(next.key);},'lost ACK retry and subsequent current-state receipt');await settled();
  const observed=await lostAckSnapshot();
  const grouped=verifyLostAckPosts(observed,lostCommand,lostHead.revision+1);assert.equal(f.state.requests.size,lostRequests+2,'retry creates no duplicate receipt');
  assert.equal(f.state.requests.get(lostCommand.key)?.response.revision,lostHead.revision+1,'one original receipt records its single commit');
  assert.equal(f.state.requests.get(grouped.next.key)?.response.revision,lostHead.revision+2,'one subsequent receipt records its single commit');console.log('Lost ACK native retry',JSON.stringify({retryMouse:diagnostics.retryMouse,clicks:diagnostics.lostAck?.ui?.clicks}));await clean();
  }else{diagnostics.lostAck={status:'not-run',reason:'owner-excluded from release acceptance'};console.log('NOT RUN: lost ACK retry and subsequent current-state receipt (owner excluded)');}
  f.traceSave=false;
  // Management is an explicit two-step lifecycle; Cancel has no mutation.
  diagnostics.phase='management cancel';const beforeCancel=f.state.active,cancelPosts=f.posts.length;
  await click('#new-city');await until(()=>evaluate("!!document.querySelector('#save-management-dialog[open]')"),'management dialog');await click('#save-management-cancel');
  assert.equal(await evaluate("!!document.querySelector('#save-management-dialog')"),false);assert.equal(f.posts.length,cancelPosts);assert.deepEqual(f.state.active,beforeCancel);await clean();
  // A definite financial 409 must retain its reason and must not invite another destructive retry.
  diagnostics.phase='known financial deletion refusal';f.setResetAllowed(false);const refusedHead=f.state.active,refusedStart=f.posts.length;
  await click('#new-city');await click('#save-management-delete');
  await until(()=>evaluate("document.querySelector('#save-management-dialog [role=status]')?.textContent.includes('รายการตลาดหรือเงิน/สินค้าค้างยืนยัน')"),'original financial rejection reason');
  assert.equal(await evaluate("document.querySelector('#save-management-delete').disabled"),true);assert.equal(await evaluate("document.querySelector('#save-management-cancel').disabled"),false);
  assert.equal(f.posts.length,refusedStart+1);await click('#save-management-delete');await sleep(150);assert.equal(f.posts.length,refusedStart+1,'known rejection sends no repeated delete');assert.deepEqual(f.state.active,refusedHead);
  await capture('server-save-delete-refused');await click('#save-management-cancel');assert.equal(await evaluate("!!document.querySelector('#save-management-dialog')"),false);assert.deepEqual(f.state.active,refusedHead);await clean();
  f.setResetAllowed(true);diagnostics.phase='explicit reload after cancelled rejected delete';expectReloadDialog=true;await send('Page.reload',{ignoreCache:true});await enter({afterReload:true});expectReloadDialog=false;assert.deepEqual(f.state.active,refusedHead);await clean();
  // Simulate a committed delete with lost response. No create control until exact ACK retry.
  await click('#new-city');f.mode='drop-delete-ack';const deletePost=f.posts.length;await click('#save-management-delete');
  await until(()=>evaluate("document.querySelector('#save-management-dialog [role=status]')?.textContent.includes('ยังไม่สำเร็จ')"),'uncertain delete visible');
  assert.equal(f.state.active.deleted,true);assert.equal(await evaluate("!!document.querySelector('#save-management-create')"),false);
  assert.equal(await evaluate("document.querySelector('#save-management-cancel').disabled"),true);await clean();
  const deleteCommand=f.posts[deletePost],deletedId=f.state.active.cityId,deletedRevision=f.state.active.revision;
  f.mode='ok';await click('#save-management-delete');await until(()=>evaluate("!!document.querySelector('#save-management-create:not(:disabled)')"),'verified delete acknowledgement');
  assert.deepEqual(f.posts[deletePost+1],deleteCommand,'same delete key and body on uncertain retry');
  assert.equal(f.state.active.revision,deletedRevision);assert.ok(f.state.archives.has(f.state.active.archiveHash));
  await click('#save-management-create');await until(()=>evaluate("!document.querySelector('#save-management-dialog')"),'fresh server city acknowledgement');
  const fresh=f.state.active;assert.equal(fresh.owner,OWNER);assert.notEqual(fresh.cityId,deletedId);assert.equal(fresh.revision,deletedRevision+1);
  const journal=JSON.parse(fresh.raw).market;assert.equal(journal.guestId,OWNER);assert.equal(journal.cityId,fresh.cityId);assert.equal(journal.seq,'0');assert.deepEqual(journal.operations,[]);assert.deepEqual(journal.escrow,[]);assert.deepEqual(journal.receipts,{});await clean();await capture('server-save-management-fresh');
  await assert.rejects(f.service.mutate(OWNER,randomUUID(),{action:'delete',cityId:deletedId,expectedRevision:beforeCancel.revision}),e=>e.status===409);assert.equal(f.state.active.cityId,fresh.cityId,'stale delete cannot replace fresh city');
  // Another device deletes the synthetic city. Reload must honor the tombstone,
  // not reactivate the untouched obsolete browser-only copy.
  const remoteDeleted=await f.service.mutate(OWNER,randomUUID(),{action:'delete',cityId:fresh.cityId,expectedRevision:fresh.revision});
  diagnostics.phase='reload deleted marker';expectReloadDialog=true;await send('Page.reload',{ignoreCache:true});
  await until(reloadEntryPredicate,'tombstone entry');await click('.guest-entry-card button');
  await until(()=>evaluate("document.querySelector('.guest-entry-card button')?.textContent==='เริ่มเมืองใหม่'&&!document.querySelector('.guest-entry-card button').disabled"),'explicit fresh choice after tombstone');expectReloadDialog=false;
  assert.equal(await evaluate('!!window.cityManager'),false);assert.deepEqual(f.state.active,remoteDeleted);assert.equal(await evaluate("localStorage.getItem('citymanager.save.v7')"),seed);await clean();
  await click('.guest-entry-card button');await until(()=>evaluate('!!window.cityManager&&window.cityManager.visuals().ready'),'fresh entry after tombstone');
  assert.equal(f.state.active.owner,OWNER);assert.notEqual(f.state.active.cityId,fresh.cityId);assert.equal(f.state.active.metadata.tick,0);await clean();
  // Another device advances the head; conflict retry must explicitly preserve local raw first.
  if(!await evaluate('window.cityManager.parks().paused'))await click('#pause');
  assert.equal(await evaluate('window.cityManager.parks().paused'),true,'freeze runtime before byte-for-byte conflict test');
  const beforeRemote=f.state.active;const remoteRaw=beforeRemote.raw+' ';const remote=await f.service.mutate(OWNER,randomUUID(),{action:'save',cityId:beforeRemote.cityId,expectedRevision:beforeRemote.revision,raw:remoteRaw,metadata:beforeRemote.metadata});
  const conflictStart=f.posts.length;await click('#save');await until(failed,'conflict failure');assert.deepEqual(f.state.active,remote);const localRaw=f.posts[conflictStart].data.raw;await clean();await capture('server-save-conflict');
  const archiveCount=f.state.archives.size;expectedConfirm=false;await pressRetry(false);await until(async()=>expectedConfirm===null,'conflict cancel confirmation');await sleep(250);assert.deepEqual(f.state.active,remote);assert.equal(f.state.archives.size,archiveCount,'cancel archives nothing');assert.equal(f.posts.length,conflictStart+1,'cancel does not retry or overwrite');
  f.mode='archive-error';expectedConfirm=true;await pressRetry(false);await until(async()=>expectedConfirm===null,'archive failure confirmation');await until(()=>evaluate("document.querySelector('#status')?.textContent.includes('fixture-archive-unavailable')"),'archive failure surfaced');assert.deepEqual(f.state.active,remote);assert.equal(f.state.archives.size,archiveCount,'failed archive preserves both states');assert.equal(f.posts.length,conflictStart+1,'archive failure cannot overwrite');
  f.mode='ok';expectedConfirm=true;await pressRetry(false);await until(async()=>expectedConfirm===null,'successful recovery confirmation');await until(()=>evaluate("document.querySelector('#status')?.textContent.includes('เก็บสำเนางานที่ขัดแย้งแล้ว')"),'confirmed conflict recovery');assert.deepEqual(f.state.active,remote,'recovery never overwrites remote head');assert.equal(f.state.archives.get(hash(localRaw))?.raw,localRaw,'exact conflicted bytes archived');assert.ok(f.state.archives.get(hash(localRaw))?.sources.includes('conflict-session'));await clean();
  assert.equal(await evaluate("!!document.querySelector('.market-launch')"),false,'trading stays disabled');
  if(process.env.CITYMANAGER_LAND_CHECKS==='1'){
   const {landExpansionChecks}=await import('./land-expansion-browser-checks.mjs');
   landEvidence=await landExpansionChecks({send,evaluate,capture,until,
    acknowledge:async()=>{const revision=f.state.active.revision;await click('#save');await until(async()=>f.state.active.revision>revision,'land server ACK');await settled();return JSON.parse(f.state.active.raw);},
    reload:async()=>{expectReloadDialog=true;await send('Page.reload',{ignoreCache:true});await enter({afterReload:true});expectReloadDialog=false;}});
   await clean();
  }
  assert.deepEqual(diagnostics.runtimeErrors,[],'No uncaught browser exception or renderer crash');
  console.log('PASS built server-save browser acceptance: load failure+retry/server-ACK-only entry/v24 checkpoint/manual ACK/autosave/reload/quota/network retry/management cancel-delete-fresh/tombstone reload/conflict/no browser city writes');
 }catch(error){acceptanceError=error;diagnostics.acceptanceError=String(error?.stack??error);}
 finally{
  diagnostics.server={acknowledged:f.acknowledged,posts:f.posts.length,revision:f.state.active?.revision??null,mode:f.mode};
  const cleanupErrors=[];const cleanup=async action=>{try{await action();}catch(error){cleanupErrors.push(error);}};
  for(const p of pending.values())p.reject(Error('smoke cleanup'));pending.clear();
  await cleanup(()=>stopBrowser(child,ws));
  await cleanup(()=>ws?.close());
  await cleanup(async()=>{if(server.listening){server.closeAllConnections();await new Promise((ok,bad)=>server.close(error=>error?bad(error):ok()));}});
  await cleanup(async()=>{if(profile)await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200});});
  diagnostics.cleanupErrors=cleanupErrors.map(error=>String(error?.stack??error));
  acceptanceError=failureAfterCleanup(acceptanceError,cleanupErrors);
 }
 if(acceptanceError)throw acceptanceError;
}
const selfTestOnly=process.argv.includes('--self-test'),started=new Date().toISOString();
const output=resolve('.test-output/server-save-smoke');await mkdir(output,{recursive:true});
try {
 if(selfTestOnly)await selfTest();else await run();
 await writeFile(resolve(output,'result.json'),JSON.stringify({started,finished:new Date().toISOString(),mode:selfTestOnly?'fixture-self-test':'built-browser-acceptance',status:'passed',browserAcceptance:selfTestOnly?'not-run':runLostAckNextSave(process.env)?'passed':'passed-with-exclusion',toolbarEvidence,railEvidence,trafficGapEvidence,landEvidence,diagnostics},null,2));
} catch(error) {
 await writeFile(resolve(output,'result.json'),JSON.stringify({started,finished:new Date().toISOString(),mode:selfTestOnly?'fixture-self-test':'built-browser-acceptance',status:'failed',browserAcceptance:selfTestOnly?'not-run':'not-passed',toolbarEvidence,railEvidence,trafficGapEvidence,landEvidence,diagnostics,error:String(error?.stack??error)},null,2));
 // Emit only bounded synthetic request and click metadata so CI logs can
 // distinguish a missed click from a failed ACK when artifacts are unavailable.
 if(diagnostics.lostAck?.posts){const {initialRevision,headRevision,initialReceiptCount,receiptCount,posts,fixtureAudit,network,ui}=diagnostics.lostAck;console.error('Lost ACK diagnostic',JSON.stringify({initialRevision,headRevision,initialReceiptCount,receiptCount,posts:posts.map(({sameOriginalKey,action,expectedRevision})=>({sameOriginalKey,action,expectedRevision})),fixtureAudit,network,retryMouse:diagnostics.retryMouse,ui:{bannerVisible:ui?.bannerVisible,saveDisabled:ui?.saveDisabled,clicks:ui?.clicks}}));}
 else if(diagnostics.retryBanner)console.error('Banner retry diagnostic',JSON.stringify({retryMouse:diagnostics.retryMouse,...diagnostics.retryBanner}));
 throw error;
}
