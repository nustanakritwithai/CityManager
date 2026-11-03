// Bounded UI checks in an ALREADY isolated browser, supplied explicitly by the caller.
// No browser/profile discovery, server accounts, external API calls or market trades.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { createCity, buildCampus, campusSiteReason, step, adoptSavedEducation, deserialize, serialize, isRetail, isMarket } from '../src/sim.ts';
import { createCity as createCityV4, step as stepV4, serialize as serializeV4 } from '../src/legacy-v4.ts';
import { createParkRuntime, serializeParkSession } from '../src/park-runtime.ts';
import {reachTrafficControl,trafficHttpHandler,installTrafficNetworkFence} from './traffic-server-entry-fixture.mjs';
import {createFeedbackServerFixture} from './player-feedback-server-fixture.mjs';
import { verifyReadingPanels } from './player-feedback-reading.mjs';

const debugPort = Number(process.env.CITYMANAGER_DEBUG_PORT);
const runtimeOnly = process.env.CITYMANAGER_UX_RUNTIME_ONLY === '1';
const workTouchOnly = process.env.CITYMANAGER_UX_WORK_TOUCH_ONLY === '1';
if (!debugPort) throw Error('Set CITYMANAGER_DEBUG_PORT to your isolated test browser.');
const root = resolve('dist'), output = resolve(process.env.CITYMANAGER_SCREENSHOT_DIR || '.test-output/player-feedback'),origin='http://127.0.0.1:4176';
await mkdir(output, { recursive: true });
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.glb': 'model/gltf-binary', '.png': 'image/png', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.ogg': 'audio/ogg' };
const fixtureServer=createFeedbackServerFixture(origin+'/CityManager/'),httpErrors=[],deliveries=[];
const handler=trafficHttpHandler({origin,upstream:origin+'/CityManager/',fixture:fixtureServer,errors:httpErrors,deliveries,forward:async target=>{
  try {
    const path = decodeURIComponent(target.pathname).replace(/^\/CityManager\/?/, '');
    const file = resolve(root, path || 'index.html');
    if (file !== root && !file.startsWith(root + sep)) return new Response(null,{status:403});
    const bytes = await readFile(file);return new Response(bytes,{status:200,headers:{'Content-Type':mime[extname(file)]||'application/octet-stream'}});
  } catch { return new Response(null,{status:404}); }
}});
const server=createServer((req,res)=>void handler(req,res));
await new Promise(r => server.listen(4176, '127.0.0.1', r));
const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
const target = targets.find(item => item.type === 'page' && /CityManager/.test(item.url))
  ?? targets.find(item => item.type === 'page' && item.url === 'about:blank');
assert.ok(target, 'explicitly isolated CityManager or blank test target');
const ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let sequence = 0, stage = 'connect', mobile = true, warningMenuLayout, landscapeLayout,networkProbe=null,faultContext=null; const pending = new Map(), errors = [], externalRequests=[], checks = [], landscapeLayouts = [], readingLayouts = [];
function send(method, params = {}) {
  return new Promise((resolve, reject) => { const id = ++sequence; const timer = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout: ${method}`)); }, 15000); pending.set(id, { resolve: r => { clearTimeout(timer); resolve(r); }, reject: e => { clearTimeout(timer); reject(e); } }); ws.send(JSON.stringify({ id, method, params })); });
}
ws.onmessage = event => { const m = JSON.parse(event.data); if (m.id) { const p = pending.get(m.id); pending.delete(m.id); if (p) m.error ? p.reject(Object.assign(Error(JSON.stringify(m.error)),{cdpError:m.error})) : p.resolve(m.result); } else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails);else if(m.method==='Page.javascriptDialogOpening')void fixtureServer.core.dialog(m.params,send).catch(e=>errors.push(String(e)));else if(m.method==='Network.requestWillBeSent'){const u=m.params.request.url;if(networkProbe?.active&&u===networkProbe.url)networkProbe.requestId=m.params.requestId;else if(/^https?:/.test(u)&&new URL(u).origin!==origin)externalRequests.push(u);}else if(m.method==='Network.loadingFailed'&&m.params.requestId===networkProbe?.requestId)networkProbe.failed=m.params; };
const evaluate = async expression => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(expression, timeout = 15000) { const start = Date.now(); while (Date.now() - start < timeout) { if (await evaluate(expression)) return; await sleep(100); } throw Error(`Timed out: ${expression}`); }
async function tap(x, y) { await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
async function button(selector) {
  if (await reachTrafficControl(evaluate, button, selector)) return;
  stage = `Activate ${selector}`; console.log(stage);
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'})`);
  await sleep(100);
  const p = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'nearest',inline:'nearest'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height,hit:e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}})()`);
  assert.ok(p.w && p.h && p.hit, `${selector} is visible and reachable`);
  if (['#upgrade-campus', '#toggle-campus', '#panel-pause', '#save-failure-retry'].includes(selector)) assert.ok(p.w >= 44 && p.h >= 44, `${selector} has a 44px touch target`);
  // Keep the clock check independent of touch-emulation acknowledgements;
  // its visibility and mobile hit target are still checked above.
  if (!mobile || selector === '#panel-pause') {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  } else await tap(p.x, p.y);
}
async function cell(index) {
  stage = `Select parcel cell ${index}`;
  const p = await evaluate(`cityManager.cellScreen(${index})`);
  assert.equal(await evaluate(`document.elementFromPoint(${p.x},${p.y})?.id`), 'city-canvas', 'campus is reachable on the map');
  if (mobile) await tap(p.x, p.y);
  else for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x:p.x, y:p.y, button:'left', clickCount:1 });
}
async function shot(name) { stage = `Screenshot ${name}`; const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 75, captureBeyondViewport: false }); await writeFile(resolve(output, name + '.jpg'), Buffer.from(r.data, 'base64')); console.log(stage); }
async function game() { if (await evaluate("document.querySelector('#inspector').dataset.open==='true'")) await button('#close-inspector'); await button('#toggle-game-menu'); }
async function retrySave() {
  if(faultContext){
    fixtureServer.setFault(false);await button('#save-failure-retry');
    const start=Date.now();while(Date.now()-start<30000&&fixtureServer.active.revision<faultContext.before.revision+2)await sleep(80);
    assert.ok(fixtureServer.active.revision>=faultContext.before.revision+2,'Retry receives an ACK for the refused intent and a distinct current-state ACK');
    await until("document.querySelector('#save-failure-banner').hidden");fixtureServer.assertRetry(faultContext.index,faultContext.before);faultContext=null;
  }else{
    await game();const revision=fixtureServer.active.revision;await button('#save');const start=Date.now();while(Date.now()-start<30000&&fixtureServer.active.revision<=revision)await sleep(80);
    assert.ok(fixtureServer.active.revision>revision,'Native Save receives a server ACK');await until("document.querySelector('#save-failure-banner').hidden");
  }
  await fixtureServer.core.assertNoCityWrites(evaluate);
}
// Fail only the isolated server service; the real UI and client transport run.
async function failServerWrites(){assert.equal(faultContext,null);await fixtureServer.core.settle();faultContext={before:fixtureServer.active,index:fixtureServer.attempts.length};fixtureServer.setFault(true);}
async function restoreServerWrites(){fixtureServer.setFault(false);}


const city = createCity(3, { starter: true });
const schoolCell = city.cells.findIndex((_, i) => campusSiteReason(city, i, 'school') === null); assert.ok(buildCampus(city, schoolCell, 'school').ok);
const universityCell = city.cells.findIndex((_, i) => campusSiteReason(city, i, 'university') === null); assert.ok(buildCampus(city, universityCell, 'university').ok);
for (let i = 0; i < 12; i++) step(city);
const fixture = serializeParkSession(city, createParkRuntime(city));
// Start from the published-save replay used by building-cards-smoke. The current
// UI displays commercial levels 1–3 as markets, so make the replay's retailer a
// level-4 shop for this isolated visual fixture and verify it survives loading.
const prior = createCityV4(61025); for (let day = 0; day < 29; day++) stepV4(prior);
const cardCity = deserialize(serializeV4(prior)); adoptSavedEducation(cardCity);
const retailBuilding = cardCity.buildings.find(b => cardCity.firms.some(f => f.building === b.id && isRetail(f)));
assert.ok(retailBuilding, 'Replay contains a retailer for the shop visual fixture');
retailBuilding.level = 4;
assert.equal(deserialize(serialize(cardCity)).buildings.find(b => b.id === retailBuilding.id)?.level, 4, 'Shop fixture survives validated save round trip');
const cardCases = ['house','shop','market','factory','farm'].map(kind => {
  const b = cardCity.buildings.find(b => kind === 'house' ? b.zone === 'R' : cardCity.firms.some(f => f.building === b.id && (kind === 'shop' ? isRetail(f) : kind === 'market' ? isMarket(f) : f.zone === (kind === 'farm' ? 'F' : 'I'))));
  assert.ok(b, 'Real day29 replay contains ' + kind); return { kind, cell:b.cell };
});
const family = cardCity.households[0], familyHome = cardCity.buildings.find(b=>b.id===family.home);
assert.ok(familyHome, 'Replay household has a real home');
cardCases.push({ kind:'household', cell:familyHome.cell, householdId:family.id });
await writeFile(resolve(output, 'synthetic-fixture.json'), fixture);
let injected;
try {
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  await fixtureServer.core.install(send);
  await installTrafficNetworkFence({send,evaluate,protocol:await(await fetch(`http://127.0.0.1:${debugPort}/json/protocol`)).json(),origin,observeProbe:url=>(networkProbe={url})});
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  injected = await send('Page.addScriptToEvaluateOnNewDocument', { source: `if(location.origin===${JSON.stringify(origin)}){localStorage.setItem('citymanager.guide.v1','skipped');window.__uxIntervals=[];const nativeInterval=window.setInterval;window.setInterval=function(fn,ms,...args){if(ms===60000)window.__uxIntervals.push(fn);return nativeInterval(fn,ms,...args)};const transaction=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(stores,mode,...rest){if(mode==='readwrite'&&/citymanager/.test(this.name))window.__panelCityWrites.push('IDB:'+this.name);return transaction.call(this,stores,mode,...rest)};}` });
  await fixtureServer.core.seed(fixture);fixtureServer.core.allowNavigation();await send('Page.navigate', { url: origin+'/CityManager/' });
  await fixtureServer.core.enter({send,evaluate,button,until,timeout:30000});
  assert.deepEqual(await evaluate('({width:innerWidth,height:innerHeight})'), { width: 390, height: 844 });
  if (!runtimeOnly) {
  await shot('08-campuses-after');
  await cell(universityCell);
  await until("document.querySelector('#selection-title').textContent.includes('มหาวิทยาลัย')");
  assert.match(await evaluate("document.querySelector('#upgrade-campus').textContent"), /2,500/);
  await button('#upgrade-campus');
  await until("document.querySelector('#campus-feedback').textContent.includes('วุฒิขั้นสูง')");
  assert.equal(await evaluate("document.querySelector('#campus-feedback').dataset.ok"), 'false');
  await button('#upgrade-campus');
  assert.equal(await evaluate('JSON.parse(cityManager.snapshot()).education.campuses[1].level'), 1);
  await shot('09-inline-refusal-after'); checks.push('university selection, priced upgrade and repeated visible refusal');
  } else await game();
  await button('#panel-pause');
  const tick = await evaluate('JSON.parse(cityManager.snapshot()).tick');
  await until(`JSON.parse(cityManager.snapshot()).tick>${tick}`);
  await button('#panel-pause');
  assert.equal(await evaluate('cityManager.parks().paused'), true);
  assert.match(await evaluate("document.querySelector('#panel-time-state').textContent"), /หยุดเวลาอยู่.*1×/);
  await shot('10-panel-time-after'); checks.push('panel pause and play advance then stop the existing city clock');
  if (!runtimeOnly) {
  await button('#close-inspector'); await cell(schoolCell);
  await until("document.querySelector('#selection-title').textContent.includes('โรงเรียน')");
  const schoolText = await evaluate("document.querySelector('#education-details').innerText");
  assert.match(schoolText, /เรียนแล้ว \d+\/60 วัน/); assert.match(schoolText, /ค่าบำรุง.*50/); assert.match(schoolText, /ค่าจ้างสะสม/);
  await shot('11-education-cost-progress-after');
  const campusActionTick = await evaluate('JSON.parse(cityManager.snapshot()).tick');
  await button('#toggle-campus');
  assert.match(await evaluate("document.querySelector('#campus-feedback').innerText"), /พักบริการ/);
  assert.equal(await evaluate("document.querySelector('#toggle-campus').textContent"), 'เปิดบริการ');
  await button('#toggle-campus');
  assert.match(await evaluate("document.querySelector('#campus-feedback').innerText"), /เปิดบริการ/);
  const cash = await evaluate('JSON.parse(cityManager.snapshot()).accounts.treasury');
  await button('#upgrade-campus');
  assert.equal(await evaluate('JSON.parse(cityManager.snapshot()).accounts.treasury'), cash - 150000);
  assert.equal(await evaluate("document.querySelector('#upgrade-campus').disabled"), true);
  assert.match(await evaluate("document.querySelector('#campus-feedback').innerText"), /ระดับ 2/);
  assert.match(await evaluate("document.querySelector('#education-details').innerText"), /ความจุสูงสุดระดับนี้: 16/);
  assert.equal(await evaluate('JSON.parse(cityManager.snapshot()).tick'), campusActionTick, 'campus feedback and capacity refresh within the same paused day');
  checks.push('school costs and actual cohort progress, toggle feedback, single-charge upgrade');
  }
  await game();const initialRevision=fixtureServer.active.revision;await button('#save');
  {const start=Date.now();while(Date.now()-start<30000&&fixtureServer.active.revision<=initialRevision)await sleep(80);assert.ok(fixtureServer.active.revision>initialRevision,'Manual Save receives an authoritative server ACK');}
  await until("document.querySelector('#autosave-status')?.textContent.startsWith('บันทึกบนเซิร์ฟเวอร์')&&!document.querySelector('#save-failure-banner:not([hidden])')");
  await failServerWrites();
  await button('#save');
  await until("!document.querySelector('#save-failure-banner').hidden");
  assert.match(await evaluate("document.querySelector('#save-failure-banner').textContent"),/ไม่มีสำเนาในเบราว์เซอร์/,'Warning explains the authoritative server-only boundary');
  assert.deepEqual(fixtureServer.active,faultContext.before,'Failed server save preserves the acknowledged head');await fixtureServer.core.assertNoCityWrites(evaluate);
  await shot('12-manual-save-failure-after');
  await button('#close-inspector'); await button('#hud-more');
  // Bounded layout-only diagnostic: measure the previous fixed-menu offset,
  // then immediately remove it. Never hide the warning or bypass a UI action.
  warningMenuLayout = await evaluate(`(()=>{
    const measure=()=>{const e=document.querySelector('#toggle-game-menu'),r=e.getBoundingClientRect(),b=document.querySelector('#save-failure-banner').getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return{menu:{top:r.top,bottom:r.bottom},banner:{top:b.top,bottom:b.bottom},reachable:e.contains(hit),hit:hit?.id||hit?.tagName}};
    const probe=document.createElement('style');probe.textContent='html[data-touch-ui=true]:has(#save-failure-banner:not([hidden])){--row-top:max(calc(6 * var(--row-u)),env(safe-area-inset-top));}html[data-touch-ui=true]:has(#save-failure-banner:not([hidden])) :is(.top-hud,.time-hud){margin-top:var(--save-warning-height,0px);}';
    let previous;document.head.append(probe);try{previous=measure()}finally{probe.remove()}
    return{previousOffset:previous,currentOffset:measure()};
  })()`);
  console.log('Warning menu layout:', JSON.stringify(warningMenuLayout));
  assert.equal(await evaluate("(()=>{const e=document.querySelector('#toggle-game-menu'),r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})()"), true, 'persistent warning leaves the fixed mobile game menu reachable');
  await shot('12a-save-warning-menu-after');
  await button('#toggle-game-menu');
  await until("document.querySelector('#inspector').dataset.page==='game'&&document.querySelector('#inspector').dataset.open==='true'");
  await button('#close-inspector'); await button('[data-tool=road]');
  assert.equal(await evaluate("document.querySelector('#save-failure-banner').hidden"), false);
  await button('#cancel-tool'); await cell(schoolCell);
  assert.equal(await evaluate("document.querySelector('#save-failure-banner').hidden"), false);
  await shot('13-save-warning-across-panels');
  assert.equal(await evaluate("!!document.querySelector('#save-failure-export,[download],input[type=file]')"),false,'Server-only save failure does not offer local city export');
  await restoreServerWrites();
  await retrySave();
  checks.push('manual server failure preserves acknowledged head, persists across tools/panels and exact retry clears warning without browser city writes');
  // Advance actual game state so the periodic autosave has a changed revision to save.
  await button('#panel-pause'); const before = await evaluate('JSON.parse(cityManager.snapshot()).tick'); await until(`JSON.parse(cityManager.snapshot()).tick>${before}`); await button('#panel-pause');
  await failServerWrites();const activeBeforeFailure=fixtureServer.active;
  await evaluate('window.__uxIntervals.forEach(fn=>fn())');
  await until("!document.querySelector('#save-failure-banner').hidden");
  assert.ok(fixtureServer.attempts.slice(faultContext.index).some(p=>p.status===503),'Periodic autosave reaches the failing real server transport');
  assert.deepEqual(fixtureServer.active,activeBeforeFailure,'Failed autosave preserves the authoritative head');await fixtureServer.core.assertNoCityWrites(evaluate);
  await shot('14-autosave-failure-after');
  await restoreServerWrites();await evaluate('window.__uxIntervals.forEach(fn=>fn())');
  // Unlike explicit Retry, a paused automatic retry verifies the exact replayed
  // head with a fresh GET rather than uploading the same session a second time.
  await until("document.querySelector('#save-failure-banner').hidden",30000);await fixtureServer.core.settle();
  fixtureServer.assertVerifiedRetry(faultContext.index,faultContext.before,await evaluate('cityManager.sessionSnapshot()'));faultContext=null;await fixtureServer.core.assertNoCityWrites(evaluate);checks.push('periodic autosave failure, exact server-acknowledged retry and fresh read verification without a duplicate write');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setTouchEmulationEnabled', { enabled: false });
  mobile = false;
  assert.deepEqual(await evaluate('({width:innerWidth,height:innerHeight})'), { width:1280, height:900 });
  await button('#close-inspector'); await cell(schoolCell);
  await until("document.querySelector('#selection-title').textContent.includes('โรงเรียน')");
  await evaluate("document.querySelector('#education-details').scrollIntoView({block:'start'})");
  await shot('15-desktop-campus-after');
  await game();
  await failServerWrites();
  await button('#save'); await until("!document.querySelector('#save-failure-banner').hidden");
  await button('#close-inspector'); await cell(schoolCell);
  assert.equal(await evaluate("document.querySelector('#inspector').getBoundingClientRect().bottom<=document.querySelector('.tool-dock').getBoundingClientRect().top"), true, 'desktop warning preserves space between the inspector and build tools');
  await button('#toggle-campus'); await button('#toggle-campus');
  await evaluate("document.querySelector('#education-details').scrollIntoView({block:'start'})");
  assert.equal(await evaluate("(()=>{const p=document.querySelector('#panel-pause').getBoundingClientRect(),b=document.querySelector('#save-failure-banner').getBoundingClientRect();return b.top>=0&&b.right<=innerWidth&&b.bottom<=p.top&&!!document.elementFromPoint(p.x+p.width/2,p.y+p.height/2)?.closest('#panel-pause')})()"), true, 'desktop warning leaves the panel clock reachable');
  await shot('16-desktop-save-warning-after');
  await restoreServerWrites();
  await retrySave();
  checks.push('desktop campus details and active persistent save warning at 1280x900, reachable panel clock, successful retry');
  await send('Emulation.setDeviceMetricsOverride', { width:844, height:390, screenWidth:844, screenHeight:390, deviceScaleFactor:1, mobile:true });
  await send('Emulation.setTouchEmulationEnabled', { enabled:true, maxTouchPoints:1 });
  mobile = true;
  stage = 'Load the real six-card replay for landscape';
  if(!await evaluate('window.cityManager.parks().paused'))await button('#panel-pause');
  await fixtureServer.core.leave({send,evaluate,until});
  const cardRaw=serializeParkSession(cardCity,createParkRuntime(cardCity));await fixtureServer.core.seed(cardRaw);fixtureServer.core.allowNavigation();await send('Page.navigate',{url:origin+'/CityManager/'});
  await fixtureServer.core.enter({send,evaluate,button,until,timeout:30000});await until('JSON.parse(cityManager.snapshot()).tick===29');
  const cardSnapshot = await evaluate('cityManager.snapshot()');
  assert.equal(fixtureServer.active.raw,cardRaw,'Server fixture loads the exact acknowledged card city');await fixtureServer.core.assertNoCityWrites(evaluate);
  assert.equal(await evaluate('cityManager.snapshot()'),cardSnapshot,'Confirmed server entry preserves exactly the chosen city');
  // Reproduce the touch whose compatibility click previously selected a factory
  // recipe. Follow it with a real new tap and a real keyboard activation.
  stage='Verify canvas touch, next tap and keyboard';
  await send('Emulation.setDeviceMetricsOverride',{width:360,height:740,screenWidth:360,screenHeight:780,deviceScaleFactor:1,mobile:true});
  await until('innerWidth===360&&innerHeight===740');
  const factoryEntry=cardCases.find(entry=>entry.kind==='factory');assert.ok(factoryEntry);
  if(await evaluate("document.querySelector('#inspector').dataset.open==='true'"))await button('#close-inspector');
  const openFactory=async()=>{await cell(factoryEntry.cell);await until("document.querySelector('#entity-content').dataset.cardKind==='factory'");await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');assert.equal(await evaluate('cityManager.snapshot()'),cardSnapshot,'Canvas touch does not activate a newly opened factory control');};
  await openFactory();await button('#close-inspector');await until("document.querySelector('#inspector').dataset.open!=='true'");
  assert.equal(await evaluate('cityManager.snapshot()'),cardSnapshot,'The next deliberate touch remains functional');
  await openFactory();await evaluate("window.__keyboardTrace=[];for(const type of ['keydown','keyup','click'])document.addEventListener(type,e=>window.__keyboardTrace.push({type,key:e.key??'',target:e.target?.id??'',trusted:e.isTrusted,defaultPrevented:e.defaultPrevented}),true);document.querySelector('#close-inspector').focus()");
  assert.equal(await evaluate('document.activeElement?.id'),'close-inspector','Keyboard focus is on the native close button');
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',unmodifiedText:'\r',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13});
  try{await until("document.querySelector('#inspector').dataset.open!=='true'");}catch(error){console.error('Keyboard activation diagnostic',JSON.stringify(await evaluate('({active:document.activeElement?.id,events:window.__keyboardTrace})')));throw error;}
  assert.equal(await evaluate('cityManager.snapshot()'),cardSnapshot,'Keyboard activation remains functional');
  checks.push('canvas touch does not activate a new factory control; following touch and keyboard activation work');
  if (workTouchOnly) {
    await shot('work-touch-keyboard');
    await verifyReadingPanels({ send, evaluate, button, cell, game, until, shot, sleep, cardCases, layouts:readingLayouts, failServerWrites, restoreServerWrites, retrySave, factoryOnly:true });
    checks.push('factory reading: all four actual values on 360 and 390 phone viewports with and without save warning, DOM/visual order and scrolling');
  }
  if (!workTouchOnly) {
  await send('Emulation.setDeviceMetricsOverride',{width:844,height:390,screenWidth:844,screenHeight:390,deviceScaleFactor:1,mobile:true});
  await until('innerWidth===844&&innerHeight===390');
  const matrixFailures = [];
  for (const warning of [false,true]) {
    if (warning) {
      await game();
      await failServerWrites();
      await button('#save'); await until("!document.querySelector('#save-failure-banner').hidden");
    }
    for (const [index, entry] of cardCases.entries()) {
      const label = entry.kind + (warning ? '-warning' : '-clear');
      try {
        if (await evaluate("document.querySelector('#inspector').dataset.open==='true'")) await button('#close-inspector');
        await cell(entry.cell);
        if (entry.householdId) await button(`#entity-content [data-household-id="${entry.householdId}"]`);
        await until(`document.querySelector('#entity-content').dataset.cardKind===${JSON.stringify(entry.kind)}`);
        await evaluate("document.querySelector('#inspector-body').scrollTop=0;new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
        stage = 'Measure landscape ' + label;
        landscapeLayout = await evaluate(`(()=>{const panel=document.querySelector('#inspector').getBoundingClientRect(),body=document.querySelector('#inspector-body').getBoundingClientRect(),header=document.querySelector('#inspector .inspector-heading').getBoundingClientRect(),visible=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&r.bottom>body.top&&r.top<body.bottom&&getComputedStyle(e).visibility!=='hidden'},full=e=>{const r=e.getBoundingClientRect();return visible(e)&&r.top>=body.top&&r.bottom<=body.bottom&&r.left>=body.left&&r.right<=body.right};const metrics=[...document.querySelectorAll('.bc-kpis [data-context-metric],.bc-kpis [data-card-metric]')];return{viewport:[innerWidth,innerHeight],panelTop:panel.top,headerHeight:header.height,bodyHeight:body.height,heroVisible:full(document.querySelector('#entity-content .bc-hero')),visibleKeyMetrics:metrics.filter(visible).length,fullyVisibleKeyMetrics:metrics.filter(full).length,fullyVisibleKeyValues:metrics.flatMap(e=>[...e.querySelectorAll('dd')]).filter(full).length,horizontalOverflow:document.querySelector('#inspector-body').scrollWidth>document.querySelector('#inspector-body').clientWidth+1,warningVisible:!document.querySelector('#save-failure-banner').hidden,controls:['#submenu-back','#panel-pause','#close-inspector',...(${warning}?['#save-failure-retry']:[])].map(s=>{const e=document.querySelector(s),r=e.getBoundingClientRect();return{selector:s,width:r.width,height:r.height,hit:e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}})}})()`);
        Object.assign(landscapeLayout,{kind:entry.kind,warning});
        landscapeLayouts.push(landscapeLayout);
        await shot((17+index+(warning?cardCases.length:0))+'-landscape-'+label);
        assert.deepEqual(landscapeLayout.viewport,[844,390]);
        assert.equal(landscapeLayout.warningVisible,warning,'Actual warning state');
        assert.ok(landscapeLayout.heroVisible && landscapeLayout.visibleKeyMetrics>=2,'Identity and at least two real metrics: '+label);
        assert.ok(landscapeLayout.fullyVisibleKeyMetrics>=2 && landscapeLayout.fullyVisibleKeyValues>=2,'At least two complete labelled metric tiles and values: '+label);
        assert.equal(landscapeLayout.horizontalOverflow,false,'No horizontal overflow: '+label);
        assert.ok(landscapeLayout.controls.every(c=>c.width>=44&&c.height>=44&&c.hit),'44px reachable Back/clock/close/Retry: '+label);
        if (entry.kind==='factory' || entry.kind==='farm') {
          const selector = entry.kind==='factory' ? '[data-recipe][aria-pressed="true"]' : '[data-crop][aria-pressed="true"]';
          await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',behavior:'instant'})`);
          await sleep(100);
          landscapeLayout.detailControl = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();return{width:r.width,height:r.height,hit:e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}})()`);
          assert.ok(landscapeLayout.detailControl.width>=44&&landscapeLayout.detailControl.height>=44&&landscapeLayout.detailControl.hit,'Recipe/crop control remains reachable below the metrics: '+label);
        }
        assert.equal(await evaluate('cityManager.snapshot()'),cardSnapshot,'Card inspection preserves actual city data');
      } catch (error) {
        matrixFailures.push({kind:entry.kind,warning,error:String(error)});
        if (!landscapeLayouts.some(r=>r.kind===entry.kind&&r.warning===warning)) landscapeLayouts.push({kind:entry.kind,warning,error:String(error)});
      }
    }
  }
  assert.deepEqual(matrixFailures,[],'Complete landscape card matrix: '+JSON.stringify(landscapeLayouts));
  await button('#panel-pause'); assert.equal(await evaluate('cityManager.parks().paused'),false);
  await button('#panel-pause'); assert.equal(await evaluate('cityManager.parks().paused'),true);
  assert.equal(await evaluate("document.querySelector('#save-failure-banner').hidden"),false);
  await restoreServerWrites();
  await retrySave();
  checks.push('all six cards at landscape 844x390, warning on/off: complete identity and at least two complete labelled numeric metrics, unchanged city data, no horizontal overflow, 44px reachable controls and real save retry');
  await verifyReadingPanels({ send, evaluate, button, cell, game, until, shot, sleep, cardCases, layouts:readingLayouts, failServerWrites, restoreServerWrites, retrySave });
  checks.push('seven tall reading panels across phone, short, landscape and wide-request viewports, warning on/off: >=90% panel height, contained scroll content, inline persistent warning, physical 44px controls, full primary values at normal reading heights, unchanged city data');
  } else { checks.push('Other cards and reading matrices excluded from this focused touch and factory check'); }
  await fixtureServer.core.assertNoCityWrites(evaluate);assert.deepEqual(httpErrors,[]);assert.deepEqual(externalRequests,[]);assert.equal(errors.length, 0, JSON.stringify(errors));
  await writeFile(resolve(output, 'results.json'), JSON.stringify({ passed: true, commit:process.env.CITYMANAGER_UX_COMMIT, runtimeOnly, workTouchOnly, mobile: [390,844], desktop: [1280,900], schoolCell, universityCell, warningMenuLayout, landscapeLayout, landscapeLayouts, readingLayouts, checks, errors }, null, 2));
  console.log(JSON.stringify({ passed: true, checks, output }));
} catch (error) {
  const failedStage = stage;
  await shot(mobile ? 'failure-mobile' : 'failure-desktop').catch(() => {});
  await writeFile(resolve(output, 'results.json'), JSON.stringify({ passed:false, commit:process.env.CITYMANAGER_UX_COMMIT, runtimeOnly, stage:failedStage, error:String(error), warningMenuLayout, landscapeLayout, landscapeLayouts, readingLayouts, checks, errors }, null, 2));
  throw error;
} finally {
  if (injected) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: injected.identifier }).catch(() => {});
  fixtureServer.setFault(false);
  ws.close(); server.close();
}
