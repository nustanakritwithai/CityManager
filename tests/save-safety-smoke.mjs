import {decodeSaveCopy} from '../src/save-copy-codec.ts';
import {createServer} from 'node:http';import {marketJournalForTest,MARKET_SAVE_KEY} from '../src/market-client.ts';
import {spawn} from 'node:child_process';import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';import {resolve} from 'node:path';import assert from 'node:assert/strict';
import {createCity,step} from '../src/sim.ts';import {createParkRuntime,serializeParkSession} from '../src/park-runtime.ts';
import {reachTouch} from './touch-reach.mjs';
const output=resolve('.test-output/save-safety'),port=9381,url=process.env.CITYMANAGER_URL||'http://127.0.0.1:4191/CityManager/';await mkdir(output,{recursive:true});
const guestMode=process.env.SAVE_TEST_GUEST==='1';const journal=marketJournalForTest(null);journal.guestId='00000000-0000-4000-8000-000000000003';let guestCreates=0;const api=createServer((req,res)=>{res.setHeader('Access-Control-Allow-Origin','http://127.0.0.1:4191');res.setHeader('Access-Control-Allow-Credentials','true');res.setHeader('Content-Type','application/json');if(req.url==='/v1/me'){res.end(JSON.stringify({guest_id:journal.guestId,seq:'0'}));return;}if(req.url==='/v1/auth/guest')guestCreates++;res.statusCode=404;res.end('{}');});if(guestMode)await new Promise(r=>api.listen(4317,'127.0.0.1',r));
const city=createCity(3,{starter:true});if(guestMode)city.market=journal;for(let i=0;i<65;i++)step(city);const raw=serializeParkSession(city,createParkRuntime(city));
const profile=await mkdtemp(resolve(output,'profile-'));let occupied=false;try{occupied=(await fetch(`http://127.0.0.1:${port}/json/version`,{signal:AbortSignal.timeout(500)})).ok;}catch{}assert.equal(occupied,false);
const child=spawn(process.env.CITYMANAGER_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',['--headless=new','--no-first-run','--no-default-browser-check','--disable-extensions','--disable-background-networking',`--remote-debugging-port=${port}`,`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore',windowsHide:true});
let ws,id=0;const pending=new Map(),errors=[],checks=[];const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const cdpEvents=[];
async function send(method,params={}){const n=++id;const promise=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(`CDP timeout ${method}`)),30000);pending.set(n,{method,detail:String(params.expression??params.url??'').slice(0,160),at:Date.now(),resolve:r=>{clearTimeout(timer);resolve(r)},reject:e=>{clearTimeout(timer);reject(e)}})});ws.send(JSON.stringify({id:n,method,params}));return promise;}
async function evaluate(expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
// Page.reload/navigate return before the old document is torn down; an in-flight poll can then be
// rejected with CDP -32000 'Inspected target navigated or closed'. That is "not ready yet", never a pass.
async function until(expression,timeout=60000){const start=Date.now();while(Date.now()-start<timeout){let ok=false;try{ok=await evaluate(expression);}catch(error){if(!/Inspected target navigated or closed|Cannot find context with specified id|Execution context was destroyed/.test(String(error?.message)))throw error;}if(ok)return;await sleep(100);}throw Error(`Timeout ${expression}`);}
async function enter(){await until("!!document.querySelector('.guest-entry-card')||!!window.cityManager");if(await evaluate("!!document.querySelector('.guest-entry-card')")){await until("!document.querySelector('.guest-entry-card button').disabled");await button(guestMode?'.guest-entry-card button:first-of-type':'.guest-entry-card button:nth-of-type(2)');}}
async function reloadFresh(){const boot=await evaluate('window.__saveSafetyBoot');await send('Page.reload',{ignoreCache:true});await until(`window.__saveSafetyBoot!==${JSON.stringify(boot)}`);await enter();await until(`window.__saveSafetyBoot!==${JSON.stringify(boot)}&&!!window.cityManager&&window.cityManager.visuals().ready`);}
async function button(selector){if(await reachTouch(evaluate,button,selector))return;const p=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height}})()`);assert.ok(p.w&&p.h,selector);for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,x:p.x,y:p.y,button:'left',clickCount:1});}
try{
 let page;for(let i=0;i<100;i++){try{const tabs=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();page=tabs.find(t=>t.type==='page'&&t.url==='about:blank');if(page)break;}catch{}await sleep(100);}assert.ok(page);
 ws=new WebSocket(page.webSocketDebuggerUrl);ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p?.reject(Error(`${JSON.stringify(m.error)} during CDP ${p?.method} [${p?.detail}] sent ${p?Date.now()-p.at:'?'}ms ago; recent page events: ${JSON.stringify(cdpEvents.slice(-8))}`)):p?.resolve(m.result);}else if(/^Page\.(frameNavigated|frameStartedLoading|loadEventFired|frameRequestedNavigation|navigatedWithinDocument)$|^Inspector\.|^Target\./.test(m.method)){cdpEvents.push({t:Date.now(),method:m.method,url:m.params?.frame?.url??m.params?.url,reason:m.params?.reason});}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);};await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});await send('Runtime.enable');await send('Page.enable');
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,screenWidth:390,screenHeight:844,deviceScaleFactor:1,mobile:true});
 await send('Page.addScriptToEvaluateOnNewDocument',{source:`window.__saveSafetyBoot=crypto.randomUUID();if(location.origin==='http://127.0.0.1:4191'&&!sessionStorage.getItem('seeded-save-test')){localStorage.setItem('citymanager.save.v7',${JSON.stringify(raw)});${guestMode?`localStorage.setItem(${JSON.stringify(MARKET_SAVE_KEY)},${JSON.stringify(JSON.stringify(journal))});`:''}sessionStorage.setItem('seeded-save-test','1');}`});
 await send('Page.navigate',{url});await enter();await until('!!window.cityManager&&window.cityManager.visuals().ready');
 const resumed=await evaluate('window.cityManager.sessionSnapshot()');if(resumed!==raw){const a=JSON.parse(raw),b=JSON.parse(resumed);console.log('STARTUP_DIFF',JSON.stringify(Object.keys({...a,...b}).filter(k=>JSON.stringify(a[k])!==JSON.stringify(b[k])).map(k=>({key:k,expected:a[k],actual:b[k]}))));}
 assert.equal(resumed,raw,'Opening the game automatically restores the exact v22 city, not a fresh city');
 assert.equal(await evaluate('localStorage.getItem("citymanager.save.v7")'),raw,'Startup did not write the original');checks.push('Automatic v22 resume preserves complete snapshot and original bytes');
 await button('#toggle-game-menu');await button('#save');await until('localStorage.getItem("citymanager.checkpoint.latest")!==null');
 assert.match(await evaluate('document.querySelector("#save-recovery-info").textContent'),/สำเนาอัตโนมัติ: วันที่ 65 · v22 · อ่านได้/);
 assert.equal(decodeSaveCopy(await evaluate('localStorage.getItem("citymanager.backup.before-autosave")')),raw);assert.equal(await evaluate('localStorage.getItem("citymanager.save.v7")'),raw);
 const shot=await send('Page.captureScreenshot',{format:'png'});await writeFile(resolve(output,'saved-mobile.png'),Buffer.from(shot.data,'base64'));
 await button('#close-inspector');await button('[data-tool="R"]');
 const point=await evaluate(`(()=>{const c=JSON.parse(window.cityManager.snapshot());for(let i=0;i<c.cells.length;i++){const t=c.cells[i];if(t.road||t.building!==null||t.zone!==null||c.parks.some(p=>p.cell===i)||c.plants.some(p=>p.cell===i)||c.education?.campuses.some(p=>p.cell===i))continue;const p=window.cityManager.cellScreen(i);if(p.x>30&&p.x<innerWidth-30&&p.y>100&&p.y<innerHeight-130&&document.elementFromPoint(p.x,p.y)?.id==='city-canvas')return{...p,cell:i};}return null;})()`);assert.ok(point,'Visible empty map parcel');
 for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,x:point.x,y:point.y,button:'left',clickCount:1});
 await until(`JSON.parse(window.cityManager.snapshot()).cells[${point.cell}].zone==='R'`);
 const edited=await evaluate('window.cityManager.sessionSnapshot()');assert.notEqual(edited,raw);assert.equal(JSON.parse(edited).tick,65);
 // Native reload runs the page lifecycle handlers while the economy remains paused.
 const oldBoot=await evaluate('window.__saveSafetyBoot');await send('Page.reload');await until(`window.__saveSafetyBoot!==${JSON.stringify(oldBoot)}`);await enter();await until(`window.__saveSafetyBoot!==${JSON.stringify(oldBoot)}&&!!window.cityManager&&window.cityManager.visuals().ready`);assert.equal(await evaluate('window.cityManager.sessionSnapshot()'),edited,'Paused edit survives real reload/lifecycle save');checks.push('Paused map edit is saved on native reload and restored exactly');
 // Simulate another tab updating the origin after this tab loaded its expected revision.
 await evaluate(`localStorage.setItem('citymanager.save.v7',${JSON.stringify(raw)})`);await button('#toggle-game-menu');await button('#save');await until('document.body.textContent.includes("อีกแท็บ")');assert.equal(await evaluate('localStorage.getItem("citymanager.save.v7")'),raw);assert.equal(decodeSaveCopy(await evaluate('localStorage.getItem("citymanager.checkpoint.latest")')),edited);checks.push('Stale writer blocked; independent newest checkpoint retained');
 // Both snapshots are valid but differ: startup must protect them, then explicit recovery is read-only.
 await reloadFresh();await until('!!document.querySelector("#startup-recovery-chooser[open]")');
 await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape'});
 assert.equal(await evaluate('!!document.querySelector("#startup-recovery-chooser[open]")'),true,'Escape cannot expose fallback gameplay');
 await send('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space'});await send('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space'});
 assert.equal(await evaluate('!!document.querySelector("#startup-recovery-chooser[open]")'),true,'Space cannot play or silently choose a source');
 assert.equal(await evaluate('window.cityManager.parks().paused'),true);
 await until('!document.querySelector("#save-failure-banner").hidden');
 assert.match(await evaluate('document.querySelector("#save-failure-banner").textContent'),/เซฟหลักกับสำเนาอัตโนมัติไม่ตรงกัน/);
 assert.match(await evaluate('document.querySelector("#save-recovery-info").textContent'),/วันที่ 65/);
 assert.equal(await evaluate('localStorage.getItem("citymanager.save.v7")'),raw);
 assert.equal(decodeSaveCopy(await evaluate('localStorage.getItem("citymanager.checkpoint.latest")')),edited);
 await send('Page.captureScreenshot',{format:'png'}).then(r=>writeFile(resolve(output,guestMode?'guest-protected-startup.png':'protected-startup.png'),Buffer.from(r.data,'base64')));
 await evaluate("localStorage.setItem('citymanager.save.v7','{broken')");await evaluate("document.querySelector('#startup-recovery-details').open=true");await button('#startup-recover-current');
 await until('document.querySelector("#startup-recovery-status").textContent.includes("โหลดไม่สำเร็จ")');
 assert.equal(await evaluate('!!document.querySelector("#startup-recovery-chooser[open]")'),true);
 assert.equal(await evaluate('localStorage.getItem("citymanager.save.v7")'),'{broken');
 assert.equal(decodeSaveCopy(await evaluate('localStorage.getItem("citymanager.checkpoint.latest")')),edited);
 await evaluate(`localStorage.setItem('citymanager.save.v7',${JSON.stringify(raw)})`);
 await button('#startup-recover-checkpoint');await until('!document.querySelector("#startup-recovery-chooser")');await button('#toggle-game-menu');
 await until('document.querySelector("#save-failure-banner").hidden');
 assert.match(await evaluate('document.querySelector("#autosave-status").textContent'),/ยังไม่มีการบันทึกสำเร็จในรอบนี้/);
 assert.equal(await evaluate('window.cityManager.sessionSnapshot()'),edited);
 assert.equal(await evaluate('localStorage.getItem("citymanager.save.v7")'),raw);
 assert.equal(decodeSaveCopy(await evaluate('localStorage.getItem("citymanager.checkpoint.latest")')),edited);
 await send('Page.captureScreenshot',{format:'png'}).then(r=>writeFile(resolve(output,guestMode?'guest-recovered.png':'recovered.png'),Buffer.from(r.data,'base64')));
 await button('#save');await until('document.querySelector("#autosave-status").textContent.includes("บันทึกสำเร็จล่าสุด")');
 assert.equal(await evaluate('localStorage.getItem("citymanager.save.v7")'),edited);
 await reloadFresh();
 assert.equal(await evaluate('window.cityManager.sessionSnapshot()'),edited);
 assert.equal(await evaluate('document.querySelector("#save-failure-banner").hidden'),true);
 checks.push('Conflicting startup preserves both; explicit recovery clears warning without false Save; real Save and reload retain selected city');
 const formatted=JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(edited)).reverse()),null,2);
 await evaluate(`localStorage.setItem('citymanager.checkpoint.latest',${JSON.stringify(formatted)})`);await reloadFresh();
 assert.equal(await evaluate('!!document.querySelector("#startup-recovery-chooser")'),false);
 assert.equal(await evaluate('window.cityManager.sessionSnapshot()'),edited);
 assert.equal(await evaluate('localStorage.getItem("citymanager.save.v7")'),edited);
 assert.equal(await evaluate('localStorage.getItem("citymanager.checkpoint.latest")'),formatted);
 await button('#toggle-game-menu');await button('#save');
 const archived=await evaluate('Object.entries(localStorage).filter(([key])=>/^citymanager\\.backup\\.save-conflict\\.[0-9]+$/.test(key)).map(([,value])=>value)');
 assert.ok(archived.map(decodeSaveCopy).includes(formatted),'Formatting-only alternate original is archived before Save');
 checks.push('Formatting-only equivalent saves resume automatically without writes; next Save preserves alternate bytes');

 assert.equal(guestCreates,0,'Returning Guest must not create a replacement identity');if(guestMode){assert.equal(await evaluate('JSON.parse(window.cityManager.sessionSnapshot()).market.guestId'),journal.guestId);checks.push('Native Guest login and reload restore exact old city and ID using isolated mock API');}assert.deepEqual(errors,[]);await writeFile(resolve(output,guestMode?'guest-report.json':'report.json'),JSON.stringify({checks,sourceVersion:22,fixtureDay:65,viewport:'390x844',note:'Synthetic local-only browser profile; no player saves'},null,2));console.log(JSON.stringify({checks}));
}catch(error){try{await writeFile(resolve(output,'failure.json'),JSON.stringify({error:String(error),errors,page:await evaluate('({url:location.href,text:document.body.innerText.slice(-5000)})')},null,2));}catch{}throw error;}finally{ws?.close();child.kill();api.close();}
