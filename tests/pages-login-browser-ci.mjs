// Isolated, synthetic browser proof. No live service or player account is contacted.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp, mkdir, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const html=await readFile(new URL('../patches/pages-login-thai/login.html',import.meta.url));
const calls=[]; let releaseConfirm;
const server=createServer(async(req,res)=>{
  const path=new URL(req.url,'http://127.0.0.1').pathname;
  if(path==='/login'){res.writeHead(200,{'content-type':'text/html; charset=utf-8','set-cookie':'cm_csrf=synthetic; SameSite=Strict'});return res.end(html)}
  if(path==='/favicon.ico'){res.writeHead(204);return res.end()}
  if(!path.startsWith('/citymanager-api/v1/')){res.writeHead(404);return res.end()}
  let raw='';for await(const part of req)raw+=part;calls.push({path,method:req.method,body:raw?JSON.parse(raw):null,csrf:req.headers['x-csrf-token']});
  const send=body=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(body))};
  if(path.endsWith('/me'))return send({guest_id:'11111111-1111-4111-8111-111111111111'});
  if(path.endsWith('/recovery-prepare'))return send({request_id:JSON.parse(raw).request_id,recovery_code:'SYNTHETIC-RECOVERY-CODE'});
  if(path.endsWith('/recovery-confirm'))return await new Promise(resolve=>{releaseConfirm=()=>{send({state:'confirmed'});resolve()}});
  if(path.endsWith('/auth/guest')||path.endsWith('/pages/recover'))return send({guest_id:'11111111-1111-4111-8111-111111111111'});
  if(path.endsWith('/pages/authorize'))return send({code:'SYNTHETIC-AUTH-CODE'});
  res.writeHead(404,{'content-type':'application/json'});res.end('{}');
});
await new Promise((resolve,reject)=>server.listen(0,'127.0.0.1',resolve).on('error',reject));
const port=server.address().port, profile=await mkdtemp(join(tmpdir(),'cm-thai-browser-'));
const binary=process.env.CHROME_BIN||'/usr/bin/google-chrome';
const chrome=spawn(binary,['--headless=new','--no-sandbox','--disable-gpu','--disable-background-networking','--no-first-run',`--user-data-dir=${profile}`,'--remote-debugging-port=0','about:blank'],{stdio:['ignore','ignore','pipe']});
let debug='';const wsUrl=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Chromium did not expose CDP')),15000);chrome.on('error',reject);chrome.on('exit',code=>reject(Error(`Chromium exited ${code}: ${debug}`)));chrome.stderr.on('data',chunk=>{debug+=chunk;const m=debug.match(/DevTools listening on (ws:\/\/\S+)/);if(m){clearTimeout(timer);resolve(m[1])}})});
const endpoint=new URL(wsUrl),version=`http://${endpoint.host}`;
const pages=await (await fetch(`${version}/json/list`)).json();const page=pages.find(x=>x.type==='page');assert.ok(page?.webSocketDebuggerUrl);
const ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject});
let seq=0;const pending=new Map(), blocked=[];
const allowedPaths=new Set(['/login','/favicon.ico','/citymanager-api/v1/me','/citymanager-api/v1/auth/guest','/citymanager-api/v1/pages/recover','/citymanager-api/v1/pages/recovery-prepare','/citymanager-api/v1/pages/recovery-confirm','/citymanager-api/v1/pages/authorize']);
ws.onmessage=e=>{const v=JSON.parse(e.data);if(v.id&&pending.has(v.id)){const {resolve,reject}=pending.get(v.id);pending.delete(v.id);v.error?reject(Error(v.error.message)):resolve(v.result)}else if(v.method==='Fetch.requestPaused'){
 const u=new URL(v.params.request.url);const allow=u.origin===`http://127.0.0.1:${port}`&&allowedPaths.has(u.pathname);if(!allow)blocked.push(u.origin+u.pathname);
 void send(allow?'Fetch.continueRequest':'Fetch.failRequest',allow?{requestId:v.params.requestId}:{requestId:v.params.requestId,errorReason:'BlockedByClient'}).catch(e=>blocked.push(String(e)));
}};
const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))});
const evalJS=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value};
const waitFor=async(expression,label)=>{for(let i=0;i<100;i++){if(await evalJS(expression))return;await new Promise(r=>setTimeout(r,50))}throw Error(`Timed out waiting for ${label}`)};
const out=process.env.CM_SCREENSHOT_DIR||'.test-output/thai-auth';
try{
 await send('Page.enable');await send('Runtime.enable');await send('Network.enable');
 await send('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 await send('Page.addScriptToEvaluateOnNewDocument',{source:'window.__allowCreate=false; window.confirm=()=>window.__allowCreate;'});
 await send('Page.navigate',{url:`http://127.0.0.1:${port}/login?challenge=${'c'.repeat(43)}&state=${'s'.repeat(43)}`});
 await waitFor("document.getElementById('identity')?.textContent.includes('11111111')",'synthetic Guest identity');
 assert.equal(await evalJS('document.documentElement.lang'),'th');
 assert.equal(await evalJS('document.documentElement.scrollWidth <= innerWidth'),true,'mobile horizontal overflow');
 assert.match(await evalJS("document.getElementById('existing-title').textContent"),/มีบัญชีอยู่แล้ว/);
 assert.match(await evalJS("document.getElementById('new-title').textContent"),/เพิ่งเริ่มเล่น/);
 await mkdir(out,{recursive:true});
 const shot=async name=>{const {data}=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(join(out,name),Buffer.from(data,'base64'))};
 await shot('01-mobile-initial.png');
 await evalJS("document.getElementById('use').click()");await waitFor("document.getElementById('message').textContent.includes('คำขอเข้าใช้งานไม่ถูกต้อง')",'invalid login without opener');
 await evalJS("document.querySelectorAll('details')[0].open=true;document.getElementById('recovery').value='SYNTHETIC-OLD-CODE';document.getElementById('recover').click()");await waitFor("document.getElementById('message').textContent.includes('กู้บัญชี Guest แล้ว')",'synthetic recovery');
 assert.equal(calls.find(c=>c.path.endsWith('/pages/recover')).body.recovery_code,'SYNTHETIC-OLD-CODE');
 await evalJS("document.getElementById('new').click()");assert.equal(calls.filter(c=>c.path.endsWith('/auth/guest')).length,0,'cancel must not create Guest');
 await evalJS("window.__allowCreate=true; document.getElementById('new').click()");await waitFor("document.getElementById('message').textContent.includes('สร้างบัญชี Guest ใหม่แล้ว')",'synthetic creation');
 assert.equal(calls.filter(c=>c.path.endsWith('/auth/guest')).length,1);assert.equal(calls.find(c=>c.path.endsWith('/auth/guest')).csrf,'synthetic');
 await evalJS("document.querySelectorAll('details')[1].open=true; document.getElementById('code').click()");await waitFor("document.getElementById('secret').textContent==='SYNTHETIC-RECOVERY-CODE'",'synthetic recovery code');
 await evalJS("document.querySelectorAll('details')[1].scrollIntoView({block:'start'})");await shot('02-mobile-recovery.png');
 await evalJS("document.getElementById('confirm-code').click(); document.getElementById('confirm-code').click()");await waitFor("document.getElementById('confirm-code').disabled",'confirmation lock');
 for(let i=0;i<100&&!releaseConfirm;i++)await new Promise(r=>setTimeout(r,50));assert.ok(releaseConfirm,'confirmation reached the synthetic server');assert.equal(calls.filter(c=>c.path.endsWith('/recovery-confirm')).length,1,'double click suppressed');releaseConfirm();
 await waitFor("document.getElementById('message').textContent.includes('ยืนยันรหัสกู้คืนแล้ว')",'synthetic confirmation');
 assert.equal(await evalJS("document.getElementById('secret').textContent"),'');
 const confirm=calls.find(c=>c.path.endsWith('/recovery-confirm'));assert.equal(confirm.body.recovery_code,'SYNTHETIC-RECOVERY-CODE');assert.equal(confirm.csrf,'synthetic');
 // The fake opener receives the message in memory; no real game or origin is contacted.
 await evalJS("window.opener={postMessage:(...args)=>window.__authPost=args};document.getElementById('use').click()");
 await waitFor("Boolean(window.__authPost)",'synthetic authorization');
 const authorization=calls.find(c=>c.path.endsWith('/pages/authorize'));assert.deepEqual(authorization.body,{challenge:'c'.repeat(43)});assert.equal(authorization.csrf,'synthetic');
 assert.equal(await evalJS("window.__authPost[1]"),'https://nustanakritwithai.github.io');
 assert.deepEqual(blocked,[],'no external or unexpected requests');
 console.log('PASS: synthetic mobile Thai page, Guest distinction, cancellation/create, recovery and double-click');
}finally{ws.close();chrome.kill('SIGTERM');await new Promise(resolve=>server.close(resolve));await rm(profile,{recursive:true,force:true});}
