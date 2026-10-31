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
import { toolbarChecks } from './visual-final-toolbar.mjs';
let toolbarEvidence=null;
const diagnostics={phase:'initialization',lastExpression:null,dialogs:[],server:null};
const OWNER='11111111-1111-4111-8111-111111111111', COOKIE='fixture-existing-owner', CSRF='fixture-csrf';
const expectedReloadDialog=(type,scope)=>scope===true&&type==='beforeunload';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function fixtureService(){
 let state={active:null,requests:new Map(),archives:new Map()},tail=Promise.resolve();
 const store={read:async()=>structuredClone(state.active),listArchives:async()=>[...state.archives.values()].map(({raw,...info})=>structuredClone(info)),readArchive:async(_,id)=>structuredClone(state.archives.get(id)??null),
  transaction:(_,work)=>{const job=tail.then(async()=>{const next=structuredClone(state);const result=await work({request:async id=>next.requests.get(id),requestCount:async()=>next.requests.size,current:async()=>next.active,bytes:async()=>0,publish:async v=>{next.active=structuredClone(v);},record:async(id,payloadHash,response)=>{next.requests.set(id,{payloadHash,response:structuredClone(response)});},hasArchive:async id=>next.archives.has(id),archive:async(id,raw,source)=>{const old=next.archives.get(id)??{hash:id,raw,sources:[]};if(!old.sources.includes(source))old.sources.push(source);next.archives.set(id,old);}});state=next;return result;});tail=job.catch(()=>{});return job;}};
 const service=createServerCityService(store);
 return {service,get state(){return structuredClone(state);},mode:'ok',delay:0,posts:[],acknowledged:0};
}
async function selfTest(){
 assert.equal(expectedReloadDialog('beforeunload',true),true);
 for(const [type,scope] of [['beforeunload',false],['confirm',true],['alert',true],['prompt',true]])assert.equal(expectedReloadDialog(type,scope),false);
 const f=fixtureService(),id=randomUUID(),cityId=randomUUID(),body={action:'create',cityId,raw:'{"version":23,"tick":1}',metadata:{name:'fixture',population:0,tick:1}};
 const first=await f.service.mutate(OWNER,id,body);assert.equal(first.revision,1);assert.deepEqual(await f.service.mutate(OWNER,id,body),first);
 await assert.rejects(f.service.mutate(OWNER,randomUUID(),body),e=>e.status===409);
 await f.service.archive(OWNER,{raw:body.raw,source:'primary'});await f.service.archive(OWNER,{raw:body.raw,source:'checkpoint'});
 assert.deepEqual((await f.service.readArchive(OWNER,hash(body.raw))).sources,['primary','checkpoint']);
 assert.equal(f.state.active.revision,1);console.log('PASS fixture service self-test (not browser acceptance)');
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
    result=await f.service.mutate(OWNER,req.headers['idempotency-key'],data);f.acknowledged++;
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
 let child,ws,profile;const pending=new Map();let id=0,expectReloadDialog=false,unexpectedDialog=null;
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
   if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p?.reject(Error(JSON.stringify(m.error))):p?.resolve(m.result);}};
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
  const enter=async()=>{await until(()=>evaluate("!!document.querySelector('.guest-entry-card button:not(:disabled)')"),'existing login entry');await click('.guest-entry-card button');await until(()=>evaluate('!!window.cityManager&&window.cityManager.visuals().ready'),'confirmed server city');};
  const clean=async()=>assert.deepEqual(await evaluate('window.__cityWrites'),[],'browser city writes prohibited');
  const failed=()=>evaluate("!!document.querySelector('#save-failure-banner:not([hidden])')");
  const settled=()=>until(()=>evaluate("document.querySelector('#autosave-status')?.textContent.startsWith('บันทึกบนเซิร์ฟเวอร์แล้ว')&&!document.querySelector('#save-failure-banner:not([hidden])')"),'acknowledged save UI');
  f.mode='load-error';await send('Page.navigate',{url});
  await until(()=>evaluate("!!document.querySelector('.guest-entry-card button:not(:disabled)')"),'entry before unavailable load');await click('.guest-entry-card button');
  await until(()=>evaluate("document.querySelector('.guest-entry-card [role=status]')?.textContent.includes('fixture-load-unavailable')"),'load failure stays gated');
  assert.equal(await evaluate('!!window.cityManager'),false,'no offline city entry after server load failure');assert.equal(f.state.active,null);await clean();f.mode='ok';await enter();
  assert.equal(f.state.active.metadata.tick,JSON.parse(seed).tick);assert.equal(f.state.archives.size,1);assert.equal([...f.state.archives.values()][0].sources.length,2);await clean();
  const capture=async name=>{assert.match(name,/^[a-z0-9_-]+$/i);const shot=await send('Page.captureScreenshot',{format:'png'});await writeFile(resolve(output,`${name}.png`),Buffer.from(shot.data,'base64'));};
  diagnostics.phase='actual toolbar interactions';toolbarEvidence=await toolbarChecks({send,evaluate,capture});await clean();console.log('PASS real-DOM toolbar checks',JSON.stringify(toolbarEvidence));
  // No success before the server transaction acknowledgement.
  // Paused startup need not autosave: establish a real acknowledged manual save first.
  const initialAck=f.acknowledged;await click('#save');await until(async()=>f.acknowledged>initialAck,'initial manual ACK');await settled();await clean();
  f.delay=1000;const before=f.acknowledged,postsBefore=f.posts.length;await click('#save');await until(async()=>f.posts.length>postsBefore,'manual request');assert.equal(f.acknowledged,before);assert.match(await evaluate("document.querySelector('#autosave-status').textContent"),/กำลังบันทึก/);await until(async()=>f.acknowledged>before,'manual ACK');await settled();f.delay=0;await clean();
  await evaluate('window.__quota=true');let rev=f.state.active.revision;await click('#save');await until(async()=>f.state.active.revision>rev,'quota independent server commit');await settled();await clean();
  rev=f.state.active.revision;await click('[data-speed="10"]');if(await evaluate('window.cityManager.parks().paused'))await click('#pause');await until(async()=>f.state.active.revision>rev,'autosave commit');await settled();if(!await evaluate('window.cityManager.parks().paused'))await click('#pause');
  rev=f.state.active.revision;await click('#save');await until(async()=>f.state.active.revision>rev,'save before reload');await settled();const saved=JSON.parse(f.state.active.raw);await clean();
  // A real beforeunload guard may protect changes after the ACK. Explicit reload is the tested user choice.
  diagnostics.phase='explicit reload after acknowledged save';expectReloadDialog=true;await send('Page.reload',{ignoreCache:true});await enter();expectReloadDialog=false;const loaded=JSON.parse(await evaluate('window.cityManager.sessionSnapshot()'));assert.equal(loaded.tick,saved.tick);assert.deepEqual(loaded.accounts,saved.accounts);assert.deepEqual(loaded.bus,saved.bus);await clean();
  // Failed network request stays pending in memory, never local fallback. Retry same key/body.
  f.mode='disconnect';const start=f.posts.length;await click('#save');await until(failed,'truthful network failure');assert.match(await evaluate("document.querySelector('#save-failure-banner').textContent"),/ไม่มีสำเนาในเบราว์เซอร์/);await clean();
  const pendingCommand=f.posts[start];f.mode='ok';rev=f.state.active.revision;await click('#save');await until(async()=>f.state.active.revision>rev,'retry acknowledgement');await settled();assert.deepEqual(f.posts[start+1],pendingCommand);
  // A 409 never overwrites another revision and no automatic retry silently wins.
  f.mode='conflict';rev=f.state.active.revision;await click('#save');await until(failed,'conflict failure');assert.equal(f.state.active.revision,rev);await clean();
  assert.equal(await evaluate("!!document.querySelector('.market-launch')"),false,'trading stays disabled');
  console.log('PASS built server-save browser acceptance: load failure+retry/migration/manual ACK/autosave/reload/quota/network retry/conflict/no browser city writes');
 }finally{diagnostics.server={acknowledged:f.acknowledged,posts:f.posts.length,revision:f.state.active?.revision??null,mode:f.mode};for(const p of pending.values())p.reject(Error('smoke cleanup'));ws?.close();if(child){child.kill();await sleep(200);}if(server.listening)await new Promise(r=>server.close(r));if(profile)await rm(profile,{recursive:true,force:true});}
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
