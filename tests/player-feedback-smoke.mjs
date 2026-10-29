// Bounded UI checks in an ALREADY isolated browser, supplied explicitly by the caller.
// No browser/profile discovery, server accounts, external API calls or market trades.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { createCity, buildCampus, campusSiteReason, step } from '../src/sim.ts';
import { createParkRuntime, serializeParkSession } from '../src/park-runtime.ts';
import { reachTouch } from './touch-reach.mjs';

const debugPort = Number(process.env.CITYMANAGER_DEBUG_PORT);
const runtimeOnly = process.env.CITYMANAGER_UX_RUNTIME_ONLY === '1';
if (!debugPort) throw Error('Set CITYMANAGER_DEBUG_PORT to your isolated test browser.');
const root = resolve('dist'), output = resolve(process.env.CITYMANAGER_SCREENSHOT_DIR || '.test-output/player-feedback');
await mkdir(output, { recursive: true });
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.glb': 'model/gltf-binary', '.png': 'image/png', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.ogg': 'audio/ogg' };
const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/CityManager\/?/, '');
    const file = resolve(root, path || 'index.html');
    if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
    const bytes = await readFile(file); res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' }); res.end(bytes);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(4176, '127.0.0.1', r));
const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
const target = targets.find(item => item.type === 'page' && /CityManager/.test(item.url))
  ?? targets.find(item => item.type === 'page' && item.url === 'about:blank');
assert.ok(target, 'explicitly isolated CityManager or blank test target');
const ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let sequence = 0, stage = 'connect', mobile = true, warningMenuLayout; const pending = new Map(), errors = [], checks = [];
function send(method, params = {}) {
  return new Promise((resolve, reject) => { const id = ++sequence; const timer = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout: ${method}`)); }, 15000); pending.set(id, { resolve: r => { clearTimeout(timer); resolve(r); }, reject: e => { clearTimeout(timer); reject(e); } }); ws.send(JSON.stringify({ id, method, params })); });
}
ws.onmessage = event => { const m = JSON.parse(event.data); if (m.id) { const p = pending.get(m.id); pending.delete(m.id); if (p) m.error ? p.reject(m.error) : p.resolve(m.result); } else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails); };
const evaluate = async expression => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(expression, timeout = 15000) { const start = Date.now(); while (Date.now() - start < timeout) { if (await evaluate(expression)) return; await sleep(100); } throw Error(`Timed out: ${expression}`); }
async function tap(x, y) { await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
async function button(selector) {
  if (await reachTouch(evaluate, button, selector)) return;
  stage = `Activate ${selector}`; console.log(stage);
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'})`);
  await sleep(100);
  const p = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'nearest',inline:'nearest'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height,hit:e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}})()`);
  assert.ok(p.w && p.h && p.hit, `${selector} is visible and reachable`);
  if (['#upgrade-campus', '#toggle-campus', '#panel-pause', '#save-failure-export'].includes(selector)) assert.ok(p.w >= 44 && p.h >= 44, `${selector} has a 44px touch target`);
  // Keep the clock check independent of touch-emulation acknowledgements;
  // its visibility and mobile hit target are still checked above.
  if (!mobile || selector === '#panel-pause') {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  } else await tap(p.x, p.y);
}
async function cell(index) {
  stage = `Select campus cell ${index}`;
  const p = await evaluate(`cityManager.cellScreen(${index})`);
  assert.equal(await evaluate(`document.elementFromPoint(${p.x},${p.y})?.id`), 'city-canvas', 'campus is reachable on the map');
  if (mobile) await tap(p.x, p.y);
  else for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x:p.x, y:p.y, button:'left', clickCount:1 });
}
async function shot(name) { stage = `Screenshot ${name}`; const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 75, captureBeyondViewport: false }); await writeFile(resolve(output, name + '.jpg'), Buffer.from(r.data, 'base64')); console.log(stage); }
async function game() { if (await evaluate("document.querySelector('#inspector').dataset.open==='true'")) await button('#close-inspector'); await button('#toggle-game-menu'); }
const city = createCity(3, { starter: true });
const schoolCell = city.cells.findIndex((_, i) => campusSiteReason(city, i, 'school') === null); assert.ok(buildCampus(city, schoolCell, 'school').ok);
const universityCell = city.cells.findIndex((_, i) => campusSiteReason(city, i, 'university') === null); assert.ok(buildCampus(city, universityCell, 'university').ok);
for (let i = 0; i < 12; i++) step(city);
const fixture = serializeParkSession(city, createParkRuntime(city));
await writeFile(resolve(output, 'synthetic-fixture.json'), fixture);
let injected;
try {
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  await send('Network.setBlockedURLs', { urls: ['*citymanager-api*', '*citymanager.157-85-96-139.sslip.io*', '*157.85.96.139:5444*'] });
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  injected = await send('Page.addScriptToEvaluateOnNewDocument', { source: `if(location.origin==='http://127.0.0.1:4176'){localStorage.clear();localStorage.setItem('citymanager.save.v7',${JSON.stringify(fixture)});localStorage.setItem('citymanager.guide.v1','skipped');window.__uxWrite=Storage.prototype.setItem;window.__uxDownloads=0;window.__uxIntervals=[];const nativeInterval=window.setInterval;window.setInterval=function(fn,ms,...args){if(ms===60000)window.__uxIntervals.push(fn);return nativeInterval(fn,ms,...args)};}` });
  await send('Page.navigate', { url: 'http://127.0.0.1:4176/CityManager/' });
  await until('!!window.cityManager && cityManager.visuals().ready', 30000);
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
  await game(); await button('#save');
  await until("document.querySelector('#autosave-status').textContent.includes('บันทึกสำเร็จล่าสุด')");
  await evaluate("window.__uxSaved=localStorage.getItem('citymanager.save.v7');Storage.prototype.setItem=function(k,v){if(k.startsWith('citymanager.'))throw new DOMException('Synthetic quota','QuotaExceededError');return window.__uxWrite.call(this,k,v)}");
  await button('#save');
  await until("!document.querySelector('#save-failure-banner').hidden");
  assert.equal(await evaluate("localStorage.getItem('citymanager.save.v7')===window.__uxSaved"), true);
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
  await evaluate("window.__uxAnchorClick=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download.startsWith('citymanager-day-'))window.__uxDownloads++;else window.__uxAnchorClick.call(this)}");
  await button('#save-failure-export'); assert.equal(await evaluate('window.__uxDownloads'), 1);
  assert.equal(await evaluate("document.querySelector('#save-failure-banner').hidden"), false, 'requesting export is not a successful local save');
  await evaluate('Storage.prototype.setItem=window.__uxWrite;HTMLAnchorElement.prototype.click=window.__uxAnchorClick');
  await game(); await button('#save');
  await until("document.querySelector('#save-failure-banner').hidden");
  checks.push('manual quota failure preserves save, persists across tools/panels, export uses existing path, successful retry clears warning');
  // Advance actual game state so the periodic autosave has a changed revision to save.
  await button('#panel-pause'); const before = await evaluate('JSON.parse(cityManager.snapshot()).tick'); await until(`JSON.parse(cityManager.snapshot()).tick>${before}`); await button('#panel-pause');
  await evaluate("Storage.prototype.setItem=function(k,v){if(k.startsWith('citymanager.'))throw new DOMException('Synthetic auto quota','QuotaExceededError');return window.__uxWrite.call(this,k,v)};window.__uxIntervals.forEach(fn=>fn())");
  await until("!document.querySelector('#save-failure-banner').hidden");
  await shot('14-autosave-failure-after');
  await evaluate('Storage.prototype.setItem=window.__uxWrite;window.__uxIntervals.forEach(fn=>fn())');
  await until("document.querySelector('#save-failure-banner').hidden"); checks.push('periodic autosave failure and real successful retry');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setTouchEmulationEnabled', { enabled: false });
  mobile = false;
  assert.deepEqual(await evaluate('({width:innerWidth,height:innerHeight})'), { width:1280, height:900 });
  await button('#close-inspector'); await cell(schoolCell);
  await until("document.querySelector('#selection-title').textContent.includes('โรงเรียน')");
  await evaluate("document.querySelector('#education-details').scrollIntoView({block:'start'})");
  await shot('15-desktop-campus-after');
  await game();
  await evaluate("Storage.prototype.setItem=function(k,v){if(k.startsWith('citymanager.'))throw new DOMException('Synthetic desktop quota','QuotaExceededError');return window.__uxWrite.call(this,k,v)}");
  await button('#save'); await until("!document.querySelector('#save-failure-banner').hidden");
  await button('#close-inspector'); await cell(schoolCell);
  await evaluate("document.querySelector('#education-details').scrollIntoView({block:'start'})");
  assert.equal(await evaluate("(()=>{const p=document.querySelector('#panel-pause').getBoundingClientRect(),b=document.querySelector('#save-failure-banner').getBoundingClientRect();return b.top>=0&&b.right<=innerWidth&&b.bottom<=p.top&&!!document.elementFromPoint(p.x+p.width/2,p.y+p.height/2)?.closest('#panel-pause')})()"), true, 'desktop warning leaves the panel clock reachable');
  await shot('16-desktop-save-warning-after');
  await evaluate('Storage.prototype.setItem=window.__uxWrite');
  await game(); await button('#save'); await until("document.querySelector('#save-failure-banner').hidden");
  checks.push('desktop campus details and active persistent save warning at 1280x900, reachable panel clock, successful retry');
  assert.equal(errors.length, 0, JSON.stringify(errors));
  await writeFile(resolve(output, 'results.json'), JSON.stringify({ passed: true, commit:process.env.CITYMANAGER_UX_COMMIT, runtimeOnly, mobile: [390,844], desktop: [1280,900], schoolCell, universityCell, warningMenuLayout, checks, errors }, null, 2));
  console.log(JSON.stringify({ passed: true, checks, output }));
} catch (error) {
  const failedStage = stage;
  await shot(mobile ? 'failure-mobile' : 'failure-desktop').catch(() => {});
  await writeFile(resolve(output, 'results.json'), JSON.stringify({ passed:false, commit:process.env.CITYMANAGER_UX_COMMIT, runtimeOnly, stage:failedStage, error:String(error), warningMenuLayout, checks, errors }, null, 2));
  throw error;
} finally {
  if (injected) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: injected.identifier }).catch(() => {});
  await evaluate('if(window.__uxWrite)Storage.prototype.setItem=window.__uxWrite').catch(() => {});
  ws.close(); server.close();
}
