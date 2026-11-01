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
let trafficGapEvidence={status:'not-run',reason:'Bumper-gap acceptance is opt-in for the exact traffic transition.'};
let railEvidence={status:'not-run',reason:'Rail UI acceptance is opt-in for the exact rail transition.'};
let toolbarEvidence={status:'not-run',reason:'Unchanged toolbar matrix remains in visual PR167 coverage; this runner checks server-save UI only.'};
const diagnostics={phase:'initialization',lastExpression:null,dialogs:[],navigationRetries:[],captures:[],runtimeErrors:[],server:null};
const OWNER='11111111-1111-4111-8111-111111111111', COOKIE='fixture-existing-owner', CSRF='fixture-csrf';
const expectedReloadDialog=(type,scope)=>scope===true&&type==='beforeunload';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
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
async function stopBrowser(child,ws){
 if(!child)return;
 const alive=()=>child.exitCode===null&&child.signalCode===null;
 // Ask the owned browser to shut down its children before removing its profile.
 try{if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify({id:2147483647,method:'Browser.close'}));}catch{/* The bounded owned-process fallback below still runs. */}
 for(let i=0;i<30&&alive();i++)await sleep(100);
 if(alive()&&child.pid){
  if(process.platform==='win32'){
   // Never target image names or unrelated browser processes.
   await new Promise((ok,bad)=>{const killer=spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore'});const timer=setTimeout(()=>{killer.kill();bad(Error('Owned browser tree termination timed out'));},5000);killer.once('error',e=>{clearTimeout(timer);bad(e);});killer.once('close',code=>{clearTimeout(timer);code===0||!alive()?ok():bad(Error(`Owned browser taskkill exited ${code}`));});});
  }else child.kill('SIGTERM');
  for(let i=0;i<30&&alive();i++)await sleep(100);
  if(alive())throw Error('Owned browser did not exit');
 }
}

function fixtureService(){
 let resetAllowed=true;
 let state={active:null,fence:0,snapshots:[],requests:new Map(),archives:new Map()},tail=Promise.resolve();
 const store={read:async()=>structuredClone(state.active),listArchives:async()=>[...state.archives.values()].map(({raw,...info})=>structuredClone(info)),readArchive:async(_,id)=>structuredClone(state.archives.get(id)??null),
  transaction:(_,work)=>{const job=tail.then(async()=>{const next=structuredClone(state);const result=await work({request:async id=>next.requests.get(id),requestCount:async()=>next.requests.size,current:async()=>next.active,deletionFence:async()=>next.fence,wasRetired:async cityId=>[...next.requests.values()].some(r=>r.response.deleted&&r.response.cityId===cityId),resetAllowed:async()=>resetAllowed,bytes:async()=>0,publish:async v=>{next.active=structuredClone(v);next.snapshots.push(structuredClone(v));next.snapshots=next.snapshots.slice(-2);},retire:async marker=>{for(const copy of next.snapshots){const archived=next.archives.get(copy.rawHash)??{hash:copy.rawHash,raw:copy.raw,sources:[]};assert.equal(archived.raw,copy.raw);const source=`deleted:${copy.cityId}:${marker.revision}:snapshot:${copy.revision}`;if(!archived.sources.includes(source))archived.sources.push(source);next.archives.set(copy.rawHash,archived);}next.snapshots=[];next.active=structuredClone(marker);next.fence=marker.revision;},record:async(id,payloadHash,response)=>{const {raw,...receipt}=response;next.requests.set(id,{payloadHash,response:structuredClone(receipt)});},hasArchive:async id=>next.archives.has(id),archive:async(id,raw,source)=>{const old=next.archives.get(id)??{hash:id,raw,sources:[]};if(!old.sources.includes(source))old.sources.push(source);next.archives.set(id,old);}});state=next;return result;});tail=job.catch(()=>{});return job;}};
 const service=createServerCityService(store);
 return {service,setResetAllowed(value){resetAllowed=value;},get state(){return structuredClone(state);},mode:'ok',delay:0,posts:[],acknowledged:0};
}
async function selfTest(){
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

 assert.equal(expectedReloadDialog('beforeunload',true),true);
 for(const [type,scope] of [['beforeunload',false],['confirm',true],['alert',true],['prompt',true]])assert.equal(expectedReloadDialog(type,scope),false);
 const f=fixtureService(),id=randomUUID(),cityId=randomUUID(),body={action:'create',cityId,raw:'{"version":23,"tick":1}',metadata:{name:'fixture',population:0,tick:1}};
 const first=await f.service.mutate(OWNER,id,body);assert.equal(first.revision,1);assert.deepEqual(await f.service.mutate(OWNER,id,body),first);
 await assert.rejects(f.service.mutate(OWNER,randomUUID(),body),e=>e.status===409);
 await f.service.archive(OWNER,{raw:body.raw,source:'primary'});await f.service.archive(OWNER,{raw:body.raw,source:'checkpoint'});
 assert.deepEqual((await f.service.readArchive(OWNER,hash(body.raw))).sources,['primary','checkpoint']);
 assert.equal(f.state.active.revision,1);
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
 const server=createServer(async(req,res)=>{try{
  const path=new URL(req.url,'http://127.0.0.1').pathname;
  if(path.startsWith('/citymanager-api/')){
   if(!req.headers.cookie?.split('; ').includes(`cm_session=${COOKIE}`)){res.writeHead(401,{'Content-Type':'application/json'});res.end('{"error":"fixture-login-required"}');return;}
   if(req.method==='POST'&&req.headers['x-csrf-token']!==CSRF){res.writeHead(403);res.end('{"error":"csrf"}');return;}
   let data=null;if(req.method==='POST'){let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>12_000_000)throw Error('fixture-body-limit');}data=JSON.parse(raw);}
   const route=path.slice('/citymanager-api'.length);let result;
   if(route==='/v1/me')result={guest_id:OWNER};
   else if(route==='/v1/city-save'&&req.method==='POST'){
    f.posts.push({key:req.headers['idempotency-key'],data:structuredClone(data)});
    if(f.mode==='disconnect'){req.socket.destroy();return;}
    if(f.mode==='conflict')throw Object.assign(Error('save-conflict'),{status:409});
    if(f.delay)await sleep(f.delay);
    result=await f.service.mutate(OWNER,req.headers['idempotency-key'],data);if((f.mode==='drop-delete-ack'&&data.action==='delete')||(f.mode==='drop-save-ack'&&data.action==='save')){req.socket.destroy();return;}f.acknowledged++;
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
 }catch(e){if(!res.headersSent)res.writeHead(e.status??500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));}});
 let child,ws,profile,acceptanceError;const pending=new Map();let id=0,expectReloadDialog=false,expectedConfirm=null,unexpectedDialog=null;
 try{
  await new Promise((ok,bad)=>{server.once('error',bad);server.listen(0,'127.0.0.1',ok);});
  const origin=`http://127.0.0.1:${server.address().port}`,url=origin+'/CityManager/'+(process.env.CITYMANAGER_TRAFFIC_CHECKS==='bumper-gap'?'?bus=1':'');
  profile=await mkdtemp(resolve(tmpdir(),'city-server-save-smoke-'));
  const browser=process.env.CITYMANAGER_BROWSER||(process.platform==='win32'?'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe':'google-chrome');
  child=spawn(browser,['--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-background-timer-throttling','--use-angle=swiftshader','--enable-unsafe-swiftshader','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore'});
  let launchError;child.on('error',e=>{launchError=e;});let debugPort;
  for(let i=0;i<100&&!debugPort;i++){if(launchError)throw launchError;if(child.exitCode!==null)throw Error(`Browser exited ${child.exitCode}; no acceptance result`);try{debugPort=Number((await readFile(resolve(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);}catch{}await sleep(100);}
  assert.ok(debugPort,'Browser unavailable; acceptance NOT passed');
  const pages=await(await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();ws=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
  ws.onmessage=e=>{const m=JSON.parse(e.data);
   if(m.method==='Runtime.exceptionThrown'||m.method==='Inspector.targetCrashed')diagnostics.runtimeErrors.push({method:m.method,details:m.params});
   if(m.method==='Page.javascriptDialogOpening'){
    const dialog={type:m.params.type,message:m.params.message,phase:diagnostics.phase,expected:expectedReloadDialog(m.params.type,expectReloadDialog)||(m.params.type==='confirm'&&expectedConfirm!==null&&m.params.message.includes('เก็บเมืองที่กำลังเล่นเป็นสำเนาบนเซิร์ฟเวอร์'))};diagnostics.dialogs.push(dialog);console.log('Browser dialog',JSON.stringify(dialog));
    if(dialog.expected){const accept=m.params.type==='confirm'?expectedConfirm:true;expectedConfirm=null;expectReloadDialog=false;void send('Page.handleJavaScriptDialog',{accept}).catch(error=>{unexpectedDialog=error;});}
    else {unexpectedDialog=Error(`Unexpected browser dialog: ${JSON.stringify(dialog)}`);for(const p of pending.values())p.reject(unexpectedDialog);pending.clear();}
   }
   if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p?.reject(Object.assign(Error(JSON.stringify(m.error)),{cdpError:m.error})):p?.resolve(m.result);}};
  await new Promise((ok,bad)=>{ws.onopen=ok;ws.onerror=bad;});
  const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id,t=setTimeout(()=>{pending.delete(n);reject(Object.assign(Error(`CDP timeout: ${method}; phase=${diagnostics.phase}; expression=${diagnostics.lastExpression}`),{cdpTimeoutMethod:method}));},30_000);pending.set(n,{resolve:v=>{clearTimeout(t);resolve(v);},reject:e=>{clearTimeout(t);reject(e);}});ws.send(JSON.stringify({id:n,method,params}));});
  const evaluate=async expression=>{if(unexpectedDialog)throw unexpectedDialog;diagnostics.lastExpression=expression.slice(0,240);const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
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
   const si=window.setInterval;window.setInterval=function(fn,ms,...args){return si.call(this,fn,ms===60000?1500:ms,...args);};})();`});
  const click=selector=>{diagnostics.phase=`click ${selector}`;return evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);};
  const entryPredicate=()=>evaluate("!!document.querySelector('.guest-entry-card button:not(:disabled)')");
  const reloadEntryPredicate=()=>reloadEntryRead(entryPredicate,error=>{diagnostics.navigationRetries.push({phase:diagnostics.phase,...error});console.log('Post-reload entry context retry',JSON.stringify(error));});
  const enter=async({afterReload=false}={})=>{await until(afterReload?reloadEntryPredicate:entryPredicate,'existing login entry');await click('.guest-entry-card button');await until(()=>evaluate('!!window.cityManager&&window.cityManager.visuals().ready'),'confirmed server city');};
  const clean=async()=>assert.deepEqual(await evaluate('window.__cityWrites'),[],'browser city writes prohibited');
  const failed=()=>evaluate("!!document.querySelector('#save-failure-banner:not([hidden])')");
  const settled=(label='acknowledged save UI')=>until(()=>evaluate("document.querySelector('#autosave-status')?.textContent.startsWith('บันทึกบนเซิร์ฟเวอร์แล้ว')&&!document.querySelector('#save-failure-banner:not([hidden])')"),label);
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
  const initialAck=f.acknowledged;await click('#save');await until(async()=>f.acknowledged>initialAck,'initial manual ACK');await settled();assert.equal(JSON.parse(f.state.active.raw).version,25,'actual built game saves commercial checkpointed server city');assert.equal(JSON.parse(f.state.active.raw).commercialBaseVersion,24);assert.equal(JSON.parse(f.state.active.raw).rulesVersion,'chain-20');await clean();await capture('server-save-acknowledged');
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
  // Actual visible banner control retries the exact uncertain command on both sizes.
  const pressRetry=async mobile=>{const box=await evaluate(`(()=>{const e=document.querySelector('#save-failure-retry'),r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;return {x,y,width:r.width,height:r.height,hit:e.contains(document.elementFromPoint(x,y))};})()`);assert.ok(box.hit&&box.width>0&&box.height>0,'retry must be visible and hit-testable');if(mobile){assert.ok(box.width>=44&&box.height>=44,'touch retry target at least 44px');await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x,y:box.y}]});await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}else{await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:box.x,y:box.y});await send('Input.dispatchMouseEvent',{type:'mousePressed',x:box.x,y:box.y,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:box.x,y:box.y,button:'left',clickCount:1});}};
  assert.equal(await evaluate(`!!document.querySelector('#save-failure-export,#export,#import,[download],input[type=file]')`),false,'no browser city export or import controls');
  for(const [name,width,height,mobile] of [['desktop',1280,800,false],['mobile',390,844,true]]){
   await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile});await send('Emulation.setTouchEmulationEnabled',{enabled:mobile});
   f.mode='disconnect';const start=f.posts.length;await click('#save');await until(failed,'truthful network failure '+name);assert.match(await evaluate("document.querySelector('#save-failure-banner').textContent"),/ไม่มีสำเนาในเบราว์เซอร์/);await clean();
   if(process.env.CITYMANAGER_PR182_CHECKS==='1')await capture('pr182-banner-'+name);
   const pendingCommand=f.posts[start];f.mode='ok';rev=f.state.active.revision;await pressRetry(mobile);await until(async()=>f.state.active.revision>rev,'banner retry acknowledgement '+name);await settled();assert.deepEqual(f.posts[start+1],pendingCommand,'exact uncertain command retry');await clean();
  }
  await send('Emulation.setTouchEmulationEnabled',{enabled:false});await send('Emulation.clearDeviceMetricsOverride');
  // Commit succeeded but its ACK was lost. The banner must replay the original
  // key/body before trackedSave writes the current state as a new revision.
  const lostHead=f.state.active,lostRequests=f.state.requests.size,lostStart=f.posts.length;f.mode='drop-save-ack';await click('#save');await until(failed,'committed save with lost ACK');
  assert.equal(f.state.active.revision,lostHead.revision+1);assert.equal(f.state.requests.size,lostRequests+1);const lostCommand=f.posts[lostStart];
  f.mode='ok';await pressRetry(false);await until(async()=>f.state.active.revision===lostHead.revision+2,'lost ACK retry and subsequent current-state save');await settled();
  assert.deepEqual(f.posts[lostStart+1],lostCommand,'lost ACK retry preserves exact idempotency key and payload');assert.notEqual(f.posts[lostStart+2].key,lostCommand.key);assert.equal(f.posts[lostStart+2].data.expectedRevision,lostHead.revision+1);assert.equal(f.state.requests.size,lostRequests+2,'retry creates no duplicate receipt');await clean();
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
 await writeFile(resolve(output,'result.json'),JSON.stringify({started,finished:new Date().toISOString(),mode:selfTestOnly?'fixture-self-test':'built-browser-acceptance',status:'passed',browserAcceptance:selfTestOnly?'not-run':'passed',toolbarEvidence,railEvidence,trafficGapEvidence,diagnostics},null,2));
} catch(error) {
 await writeFile(resolve(output,'result.json'),JSON.stringify({started,finished:new Date().toISOString(),mode:selfTestOnly?'fixture-self-test':'built-browser-acceptance',status:'failed',browserAcceptance:selfTestOnly?'not-run':'not-passed',toolbarEvidence,railEvidence,trafficGapEvidence,diagnostics,error:String(error?.stack??error)},null,2));
 throw error;
}
