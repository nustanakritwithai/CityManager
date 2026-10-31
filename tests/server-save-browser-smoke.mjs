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
import { createServerCityService, hash } from '../server/city-saves/service.mjs';
const toolbarEvidence={status:'not-run',reason:'Unchanged toolbar matrix remains in visual PR167 coverage; this runner checks server-save UI only.'};
const diagnostics={phase:'initialization',lastExpression:null,dialogs:[],navigationRetries:[],server:null};
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
    result=await f.service.mutate(OWNER,req.headers['idempotency-key'],data);if(f.mode==='drop-delete-ack'&&data.action==='delete'){req.socket.destroy();return;}f.acknowledged++;
   }else if(route==='/v1/city-save'){if(f.mode==='load-error')throw Object.assign(Error('fixture-load-unavailable'),{status:503});result=await f.service.read(OWNER);}
   else if(route==='/v1/city-save/archives')result=req.method==='POST'?await f.service.archive(OWNER,data):await f.service.listArchives(OWNER);
   else if(route.startsWith('/v1/city-save/archives/'))result=await f.service.readArchive(OWNER,route.split('/').at(-1));
   else throw Object.assign(Error('fixture-route-not-found'),{status:404});
   res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(result));return;
  }
  const relative=decodeURIComponent(path.replace(/^\/CityManager\/?/,''));const file=resolve(dist,relative||'index.html');
  if(file!==dist&&!file.startsWith(dist+sep))throw Object.assign(Error('path'),{status:403});
  const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'};
  const bytes=await readFile(file);res.writeHead(200,{'Content-Type':mime[extname(file)]??'application/octet-stream','Cache-Control':'no-store'});res.end(bytes);
 }catch(e){if(!res.headersSent)res.writeHead(e.status??500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));}});
 let child,ws,profile,acceptanceError;const pending=new Map();let id=0,expectReloadDialog=false,unexpectedDialog=null;
 try{
  await new Promise((ok,bad)=>{server.once('error',bad);server.listen(0,'127.0.0.1',ok);});
  const origin=`http://127.0.0.1:${server.address().port}`,url=origin+'/CityManager/';
  profile=await mkdtemp(resolve(tmpdir(),'city-server-save-smoke-'));
  const browser=process.env.CITYMANAGER_BROWSER||(process.platform==='win32'?'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe':'google-chrome');
  child=spawn(browser,['--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-background-timer-throttling','--use-angle=swiftshader','--enable-unsafe-swiftshader','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore'});
  let launchError;child.on('error',e=>{launchError=e;});let debugPort;
  for(let i=0;i<100&&!debugPort;i++){if(launchError)throw launchError;if(child.exitCode!==null)throw Error(`Browser exited ${child.exitCode}; no acceptance result`);try{debugPort=Number((await readFile(resolve(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);}catch{}await sleep(100);}
  assert.ok(debugPort,'Browser unavailable; acceptance NOT passed');
  const pages=await(await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();ws=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
  ws.onmessage=e=>{const m=JSON.parse(e.data);
   if(m.method==='Page.javascriptDialogOpening'){
    const dialog={type:m.params.type,message:m.params.message,phase:diagnostics.phase,expected:expectedReloadDialog(m.params.type,expectReloadDialog)};diagnostics.dialogs.push(dialog);console.log('Browser dialog',JSON.stringify(dialog));
    if(dialog.expected){expectReloadDialog=false;void send('Page.handleJavaScriptDialog',{accept:true}).catch(error=>{unexpectedDialog=error;});}
    else {unexpectedDialog=Error(`Unexpected browser dialog: ${JSON.stringify(dialog)}`);for(const p of pending.values())p.reject(unexpectedDialog);pending.clear();}
   }
   if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p?.reject(Object.assign(Error(JSON.stringify(m.error)),{cdpError:m.error})):p?.resolve(m.result);}};
  await new Promise((ok,bad)=>{ws.onopen=ok;ws.onerror=bad;});
  const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id,t=setTimeout(()=>{pending.delete(n);reject(Error(`CDP timeout: ${method}; phase=${diagnostics.phase}; expression=${diagnostics.lastExpression}`));},30_000);pending.set(n,{resolve:v=>{clearTimeout(t);resolve(v);},reject:e=>{clearTimeout(t);reject(e);}});ws.send(JSON.stringify({id:n,method,params}));});
  const evaluate=async expression=>{if(unexpectedDialog)throw unexpectedDialog;diagnostics.lastExpression=expression.slice(0,240);const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  const until=async(fn,label,ms=90_000)=>{diagnostics.phase=label;console.log('Acceptance phase:',label);const start=Date.now();while(Date.now()-start<ms){if(await fn())return;await sleep(100);}throw Error(`Timeout: ${label}`);};
  await send('Runtime.enable');await send('Page.enable');await send('Network.enable');
  await send('Network.setCookie',{name:'cm_session',value:COOKIE,url:origin,httpOnly:true,sameSite:'Strict'});await send('Network.setCookie',{name:'cm_csrf',value:CSRF,url:origin,sameSite:'Strict'});
  const seed=await readFile(new URL('./fixtures/save-smoke/bus-optional-day60.json',import.meta.url),'utf8');
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{if(location.origin!==${JSON.stringify(origin)})return;
   if(!localStorage.getItem('__fixture_seeded')){localStorage.setItem('citymanager.save.v7',${JSON.stringify(seed)});localStorage.setItem('citymanager.checkpoint.latest',${JSON.stringify(seed)});localStorage.setItem('__fixture_seeded','1');}
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
  const settled=()=>until(()=>evaluate("document.querySelector('#autosave-status')?.textContent.startsWith('บันทึกบนเซิร์ฟเวอร์แล้ว')&&!document.querySelector('#save-failure-banner:not([hidden])')"),'acknowledged save UI');
  f.mode='load-error';await send('Page.navigate',{url});
  await until(()=>evaluate("!!document.querySelector('.guest-entry-card button:not(:disabled)')"),'entry before unavailable load');await click('.guest-entry-card button');
  await until(()=>evaluate("document.querySelector('.guest-entry-card [role=status]')?.textContent.includes('fixture-load-unavailable')"),'load failure stays gated');
  assert.equal(await evaluate('!!window.cityManager'),false,'no offline city entry after server load failure');assert.equal(f.state.active,null);await clean();f.mode='ok';await enter();
  assert.equal(f.state.active.metadata.tick,JSON.parse(seed).tick);assert.equal(f.state.archives.size,1);assert.equal([...f.state.archives.values()][0].sources.length,2);await clean();
  const capture=async name=>{assert.match(name,/^[a-z0-9_-]+$/i);const shot=await send('Page.captureScreenshot',{format:'png'});await writeFile(resolve(output,`${name}.png`),Buffer.from(shot.data,'base64'));};
  assert.equal(await evaluate("!!document.querySelector('#save:not(:disabled)')"),true,'real Save control available after authenticated entry');
  // No success before the server transaction acknowledgement.
  // Paused startup need not autosave: establish a real acknowledged manual save first.
  const initialAck=f.acknowledged;await click('#save');await until(async()=>f.acknowledged>initialAck,'initial manual ACK');await settled();await clean();await capture('server-save-acknowledged');
  f.delay=1000;const before=f.acknowledged,postsBefore=f.posts.length;await click('#save');await until(async()=>f.posts.length>postsBefore,'manual request');assert.equal(f.acknowledged,before);assert.match(await evaluate("document.querySelector('#autosave-status').textContent"),/กำลังบันทึก/);await until(async()=>f.acknowledged>before,'manual ACK');await settled();f.delay=0;await clean();
  await evaluate('window.__quota=true');let rev=f.state.active.revision;await click('#save');await until(async()=>f.state.active.revision>rev,'quota independent server commit');await settled();await clean();
  rev=f.state.active.revision;await click('[data-speed="10"]');if(await evaluate('window.cityManager.parks().paused'))await click('#pause');await until(async()=>f.state.active.revision>rev,'autosave commit');await settled();if(!await evaluate('window.cityManager.parks().paused'))await click('#pause');
  rev=f.state.active.revision;await click('#save');await until(async()=>f.state.active.revision>rev,'save before reload');await settled();const saved=JSON.parse(f.state.active.raw);await clean();
  // A real beforeunload guard may protect changes after the ACK. Explicit reload is the tested user choice.
  diagnostics.phase='explicit reload after acknowledged save';expectReloadDialog=true;await send('Page.reload',{ignoreCache:true});await enter({afterReload:true});expectReloadDialog=false;const loaded=JSON.parse(await evaluate('window.cityManager.sessionSnapshot()'));assert.equal(loaded.tick,saved.tick);assert.deepEqual(loaded.accounts,saved.accounts);assert.deepEqual(loaded.bus,saved.bus);await clean();
  // Failed network request stays pending in memory, never local fallback. Retry same key/body.
  f.mode='disconnect';const start=f.posts.length;await click('#save');await until(failed,'truthful network failure');assert.match(await evaluate("document.querySelector('#save-failure-banner').textContent"),/ไม่มีสำเนาในเบราว์เซอร์/);await clean();
  const pendingCommand=f.posts[start];f.mode='ok';rev=f.state.active.revision;await click('#save');await until(async()=>f.state.active.revision>rev,'retry acknowledgement');await settled();assert.deepEqual(f.posts[start+1],pendingCommand);
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
  // not reactivate the untouched legacy browser migration input.
  const remoteDeleted=await f.service.mutate(OWNER,randomUUID(),{action:'delete',cityId:fresh.cityId,expectedRevision:fresh.revision});
  diagnostics.phase='reload deleted marker';expectReloadDialog=true;await send('Page.reload',{ignoreCache:true});
  await until(reloadEntryPredicate,'tombstone entry');await click('.guest-entry-card button');
  await until(()=>evaluate("document.querySelector('.guest-entry-card button')?.textContent==='เริ่มเมืองใหม่'&&!document.querySelector('.guest-entry-card button').disabled"),'explicit fresh choice after tombstone');expectReloadDialog=false;
  assert.equal(await evaluate('!!window.cityManager'),false);assert.deepEqual(f.state.active,remoteDeleted);assert.equal(await evaluate("localStorage.getItem('citymanager.save.v7')"),seed);await clean();
  await click('.guest-entry-card button');await until(()=>evaluate('!!window.cityManager&&window.cityManager.visuals().ready'),'fresh entry after tombstone');
  assert.equal(f.state.active.owner,OWNER);assert.notEqual(f.state.active.cityId,fresh.cityId);assert.equal(f.state.active.metadata.tick,0);await clean();
  // A 409 never overwrites another revision and no automatic retry silently wins.
  f.mode='conflict';rev=f.state.active.revision;await click('#save');await until(failed,'conflict failure');assert.equal(f.state.active.revision,rev);await clean();await capture('server-save-conflict');
  assert.equal(await evaluate("!!document.querySelector('.market-launch')"),false,'trading stays disabled');
  console.log('PASS built server-save browser acceptance: load failure+retry/migration/manual ACK/autosave/reload/quota/network retry/management cancel-delete-fresh/tombstone reload/conflict/no browser city writes');
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
 await writeFile(resolve(output,'result.json'),JSON.stringify({started,finished:new Date().toISOString(),mode:selfTestOnly?'fixture-self-test':'built-browser-acceptance',status:'passed',browserAcceptance:selfTestOnly?'not-run':'passed',toolbarEvidence,diagnostics},null,2));
} catch(error) {
 await writeFile(resolve(output,'result.json'),JSON.stringify({started,finished:new Date().toISOString(),mode:selfTestOnly?'fixture-self-test':'built-browser-acceptance',status:'failed',browserAcceptance:selfTestOnly?'not-run':'not-passed',toolbarEvidence,diagnostics,error:String(error?.stack??error)},null,2));
 throw error;
}
