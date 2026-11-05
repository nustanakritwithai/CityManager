// Disposable loopback browser acceptance. No real player saves or market requests.
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { createCity, buildRoad, buildParallelRoad, editRoadJunction, serialize, deserialize, GATEWAY, SIZE } from '../src/sim.ts';
import { roadDriveAllowed, roadLinked } from '../src/road-topology.ts';
import { deserializeParkSession, expandValidatedParkSession } from '../src/park-runtime.ts';
import { startPersistenceFixture } from './persistence-server-fixture.mjs';
import { reachTrafficControl, installTrafficNetworkFence } from './traffic-server-entry-fixture.mjs';
import { panelProviderDenials, isPanelProviderRequest } from './panel-network-denies.mjs';
import { checkSelectMenu } from './select-menu-browser.mjs';
import { checkGroupedToolMenus } from './grouped-tool-menu-browser.mjs';
const output=resolve('.test-output/roads'), debugPort=9366;
const upstreamUrl=process.env.CITYMANAGER_URL||'http://127.0.0.1:4173/CityManager/';
assert.equal(new URL(upstreamUrl).hostname,'127.0.0.1');
const cell=(x,y)=>y*SIZE+x;
const initial=createCity(61025,{starter:false});buildRoad(initial,GATEWAY,cell(10,12));
const original=serialize(initial),expected=expandValidatedParkSession(deserializeParkSession(original)).city;
buildParallelRoad(expected,cell(5,12),cell(10,12),true);
buildParallelRoad(expected,cell(10,13),cell(5,13),true);
buildParallelRoad(expected,cell(5,12),cell(5,13));
buildParallelRoad(expected,cell(10,12),cell(10,13));
assert.equal(roadLinked(expected,cell(7,12),cell(7,13)),false);
assert.ok(roadDriveAllowed(expected,cell(6,12),cell(7,12)));
assert.equal(roadDriveAllowed(expected,cell(7,12),cell(6,12)),false);
if(process.argv.includes('--preflight')){assert.equal(serialize(deserialize(serialize(expected))),serialize(expected));console.log('road topology preflight passed');process.exit(0);}
await mkdir(output, { recursive: true });
const server=await startPersistenceFixture(upstreamUrl),url=server.url,allowed=new URL(url),storage=server.fixture;
const interceptionErrors=[];let networkProbe;const observeProbe=url=>(networkProbe={url,active:false,requestId:null,failed:null});
let occupied = false; try { occupied = (await fetch(`http://127.0.0.1:${debugPort}/json/version`, { signal: AbortSignal.timeout(500) })).ok; } catch {}
assert.equal(occupied, false, 'Road topology browser port is already in use');
const child = spawn(process.env.CITYMANAGER_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', [
  '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-component-update',
  '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${resolve(output, 'profile')}`, 'about:blank',
], { windowsHide: true, stdio: 'ignore' });
let ws, seq = 0; const pending = new Map(), errors = [], external = [], providerRequests = [], checks = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
let stage = 'road topology';
const watchdog = setTimeout(() => {
  console.error(`Road browser acceptance timed out in ${stage} after 150 seconds`);
  child.kill();
  process.exit(1);
}, 150_000);
// Each complete suite has its own deadline. Individual CDP calls still have 30 seconds.
function startNextSuite(name) {
  console.log(`Passed ${stage}. Starting ${name}.`);
  stage = name;
  watchdog.refresh();
}
async function send(method, params = {}) {
  const id = ++seq, result = new Promise((yes, no) => { const timer = setTimeout(() => { pending.delete(id); no(Error(`CDP timeout: ${method}`)); }, 30_000); pending.set(id, { yes: v => { clearTimeout(timer); yes(v); }, no: e => { clearTimeout(timer); no(e); } }); });
  ws.send(JSON.stringify({ id, method, params })); return result;
}
async function evaluate(expression) { const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw Error(result.exceptionDetails.text); return result.result.value; }
async function until(expression, timeout = 30_000) { const start = Date.now(); while (Date.now() - start < timeout) { if (await evaluate(expression)) return; await sleep(75); } throw Error(`Timed out: ${expression.slice(0, 120)}`); }
const paints = () => evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
let touchMode=false;
async function click(x,y) { if(touchMode){await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});return;} for (const type of ['mouseMoved','mousePressed','mouseReleased']) await send('Input.dispatchMouseEvent',{type,x,y,button:type==='mouseMoved'?'none':'left',clickCount:1}); }
async function button(selector) {
  if (await reachTrafficControl(evaluate, button, selector)) return;
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest',inline:'nearest'})`); await paints();
  const p = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height,disabled:e.disabled}})()`);
  assert.ok(p.w && p.h && !p.disabled, `Visible enabled ${selector}`);
  assert.equal(await evaluate(`!!document.elementFromPoint(${p.x},${p.y})?.closest(${JSON.stringify(selector)})`), true, `Actual hit ${selector}`); await click(p.x,p.y);
}
async function close() { if (await evaluate('document.querySelector("#inspector").dataset.open==="true"')) await button('#close-inspector'); await paints(); }
async function game() { await close(); await button('#toggle-game-menu'); await until('document.querySelector("#inspector").dataset.page==="game"'); }
async function screenshot(name) { const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false}); await writeFile(resolve(output,name),Buffer.from(r.data,'base64')); }
async function load(raw) {
 await storage.leave({send,evaluate,until}); const ack=await storage.seed(raw);
 storage.allowNavigation(); await send('Page.navigate',{url}); await storage.enter({evaluate,button});
 assert.equal(ack.raw,raw);assert.equal(ack.revision,1);await storage.assertNoCityWrites(evaluate);
}
async function waitHead(revision){const start=Date.now();while(Date.now()-start<30000){if(storage.active.revision>revision)return;await sleep(75);}throw Error('Server save ACK timeout');}
async function saveAndReload(){
 const before=storage.active,raw=await evaluate('window.cityManager.sessionSnapshot()');await button('#save');await waitHead(before.revision);
 await until("document.querySelector('#autosave-status')?.textContent.startsWith('บันทึกบนเซิร์ฟเวอร์แล้ว')");
 const ack=storage.active;assert.equal(ack.revision,before.revision+1);assert.equal(ack.raw,raw);
 const event=storage.writes.at(-1);assert.equal(event.status,200);assert.equal(event.command.expectedRevision,before.revision);assert.equal(event.command.raw,raw);assert.equal(event.response.raw,raw);assert.equal(event.response.revision,ack.revision);
 storage.allowNavigation(raw);await send('Page.reload',{ignoreCache:true});await storage.enter({evaluate,button});
 assert.equal(await evaluate('window.cityManager.sessionSnapshot()'),raw);await storage.assertNoCityWrites(evaluate);return ack;
}
async function failedSaveThenRetry(){
 const before=storage.active,raw=await evaluate('window.cityManager.sessionSnapshot()'),writeStart=storage.writes.length;server.setSaveFailure(true);await button('#save');
 await until("!!document.querySelector('#save-failure-banner:not([hidden])')");assert.ok(server.rejected.length);assert.deepEqual(storage.active,before);
 assert.match(await evaluate("document.querySelector('#save-failure-banner').textContent"),/ไม่มีสำเนาในเบราว์เซอร์/);await storage.assertNoCityWrites(evaluate);
 server.setSaveFailure(false);await button('#save-failure-retry');await waitHead(before.revision);
 await until("document.querySelector('#autosave-status')?.textContent.startsWith('บันทึกบนเซิร์ฟเวอร์แล้ว')");
 const ack=storage.active,events=storage.writes.slice(writeStart),failed=server.rejected.at(-1);assert.equal(ack.revision,before.revision+2);assert.equal(ack.raw,raw);assert.equal(events.length,2);
 assert.equal(events[0].requestKey,failed.requestKey);assert.deepEqual(events[0].command,failed.command);assert.notEqual(events[1].requestKey,events[0].requestKey);
 for(const [i,event] of events.entries()){assert.equal(event.status,200);assert.equal(event.command.expectedRevision,before.revision+i);assert.equal(event.command.raw,raw);assert.equal(event.response.raw,raw);assert.equal(event.response.revision,before.revision+i+1);}
 storage.allowNavigation(raw);await send('Page.reload',{ignoreCache:true});await storage.enter({evaluate,button});
 assert.equal(await evaluate('window.cityManager.sessionSnapshot()'),raw);await storage.assertNoCityWrites(evaluate);
}

async function selectRoad(mode) { await button('[data-tool="road"]');await until('!document.querySelector("#road-submenu").hidden');
 const layout=await evaluate('(()=>{const a=document.querySelector("[data-tool=road]").getBoundingClientRect(),m=document.querySelector("#road-submenu").getBoundingClientRect();return {a:{x:a.x,y:a.y,w:a.width,h:a.height},m:{x:m.x,y:m.y,b:m.bottom},buttons:[...document.querySelectorAll("#road-submenu button")].map(b=>{const r=b.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})}})()');
 assert.ok(layout.m.b<=layout.a.y&&layout.m.y>=0,'Submenu above unchanged road button and on screen');
 assert.equal(layout.buttons.length,3,'Only normal, one-way and disconnect tools remain');
 const masks=await evaluate('[...document.querySelectorAll("#road-submenu .road-asset-icon")].map(e=>({mask:getComputedStyle(e).maskImage,w:e.getBoundingClientRect().width,h:e.getBoundingClientRect().height}))');
 assert.equal(masks.length,3);for(const [i,name]of ['road','arrows-up','unlink'].entries()){assert.ok(masks[i].mask.endsWith(`/assets/tabler-roads/${name}.svg")`));assert.ok(masks[i].w>=20&&masks[i].h>=20,JSON.stringify(masks[i]));}

 for(const b of layout.buttons){assert.ok(Math.abs(b.x-layout.a.x)<1);assert.ok(Math.abs(b.w-layout.a.w)<1&&Math.abs(b.h-layout.a.h)<1,'Same size as original road button');}
 await button(`[data-road-mode="${mode}"]`);assert.equal(await evaluate('document.querySelector("#road-submenu").hidden'),true);
}
async function tapCell(i){await paints();const p=await evaluate(`window.cityManager.cellScreen(${i})`);assert.equal(await evaluate(`document.elementFromPoint(${p.x},${p.y})?.id`),'city-canvas');await click(p.x,p.y);}
try {
 let targets;for(let i=0;i<100;i++){try{targets=await(await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();break;}catch{await sleep(100);}}
 assert.ok(targets?.length);ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise((yes,no)=>{ws.onopen=yes;ws.onerror=no});
 ws.onmessage=event=>{const m=JSON.parse(event.data);if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.no(Error(JSON.stringify(m.error))):p.yes(m.result);}if(m.method==='Page.javascriptDialogOpening')void storage.dialog(m.params,send).catch(e=>interceptionErrors.push(String(e)));if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')errors.push(m.params.args.map(a=>a.value??a.description).join(' '));if(m.method==='Network.loadingFailed'&&m.params.requestId===networkProbe?.requestId)networkProbe.failed=m.params;if(m.method==='Network.requestWillBeSent'){const u=m.params.request.url;if(networkProbe?.active&&u===networkProbe.url)networkProbe.requestId=m.params.requestId;else{if(isPanelProviderRequest(u))providerRequests.push(u);if(/^https?:/.test(u)&&new URL(u).origin!==allowed.origin)external.push(u);}}};
 await send('Runtime.enable');await send('Page.enable');await send('Network.enable');await installTrafficNetworkFence({send,evaluate,protocol:await(await fetch(`http://127.0.0.1:${debugPort}/json/protocol`)).json(),origin:allowed.origin,additionalBlocked:panelProviderDenials(allowed.origin),observeProbe});await storage.install(send);
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,screenWidth:1440,screenHeight:1000,deviceScaleFactor:1,mobile:false});
 await load(original);await close();
 // Clicking the main road tool alone defaults to parallel-safe two-way placement.
 await button('[data-tool="road"]');await tapCell(cell(5,13));await tapCell(cell(10,13));
 const defaultExpected=expandValidatedParkSession(deserializeParkSession(original)).city;buildParallelRoad(defaultExpected,cell(5,13),cell(10,13));
 assert.equal(await evaluate('window.cityManager.snapshot()'),serialize(defaultExpected));
 checks.push('Main road tool defaults to parallel-safe placement without choosing a submenu mode');
 await load(original);await close();
 await selectRoad('oneway');await tapCell(cell(5,12));await tapCell(cell(10,12));
 await selectRoad('oneway');await tapCell(cell(10,13));await tapCell(cell(5,13));
 await selectRoad('normal');await tapCell(cell(5,12));await tapCell(cell(5,13));
 await selectRoad('normal');await tapCell(cell(10,12));await tapCell(cell(10,13));
 assert.deepEqual(deserialize(await evaluate('window.cityManager.snapshot()')),expected,'Real controls produce exact intended topology and accounting');
 await screenshot('desktop-parallel-oneway.png');await button('[data-tool="select"]');await screenshot('desktop-road-arrows.png');
 await game();await saveAndReload();assert.deepEqual(deserialize(await evaluate('window.cityManager.snapshot()')),expected);
 checks.push('Desktop real one-way and parallel junction controls survive exact server ACK and reload with road topology and accounting');
 await close();await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,screenWidth:390,screenHeight:844,deviceScaleFactor:1,mobile:true});await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:2});await until('innerWidth===390');touchMode=true;
 await button('[data-tool="road"]');await until('!document.querySelector("#road-submenu").hidden');await screenshot('mobile-road-submenu.png');
 await button('[data-road-mode="split"]');await tapCell(cell(5,12));await tapCell(cell(5,13));editRoadJunction(expected,cell(5,12),cell(5,13),false);
 assert.deepEqual(deserialize(await evaluate('window.cityManager.snapshot()')),expected,'Mobile junction edit retains all other links');
 await game();await failedSaveThenRetry();assert.deepEqual(deserialize(await evaluate('window.cityManager.snapshot()')),expected);await close();
 checks.push('Failed save leaves the prior server head untouched; retry ACK and reload retain mobile junction edit');
 await selectRoad('normal');await screenshot('mobile-parallel-tool.png');
 checks.push('390px menu stacks above original button with same dimensions; chosen junction can be separated');
 startNextSuite('select menu');
 const selectorReport = await checkSelectMenu({ evaluate, button, click, send, screenshot, load, close, paints, fixture: original, cell: cell(5,12), setTouch: value => { touchMode = value; } });
 checks.push(...selectorReport.checks); await writeFile(resolve(output,'select-menu-report.json'), JSON.stringify(selectorReport,null,2));
 startNextSuite('grouped tool menus');
 const groupedReport = await checkGroupedToolMenus({ evaluate, button, click, send, screenshot, load, close, paints, setTouch: value => { touchMode = value; } });
 checks.push(...groupedReport.checks); await writeFile(resolve(output,'grouped-tool-menu-report.json'), JSON.stringify(groupedReport,null,2));
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(providerRequests,[],'No advisor/provider requests');assert.deepEqual(interceptionErrors,[]);assert.deepEqual(server.errors,[]);await storage.assertNoCityWrites(evaluate);console.log(JSON.stringify({checks,errors,external}));
} catch(error){if(ws?.readyState===1){try{await screenshot('failure.png');}catch{}}console.error(JSON.stringify({checks,errors,external,error:String(error)}));throw error;}
finally{clearTimeout(watchdog);if(ws?.readyState===1){try{await send('Browser.close');}catch{}ws.close();}child.kill();await server.close();}
