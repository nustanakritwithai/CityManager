// Full-app, native-input plant upgrade acceptance. Synthetic loopback saves only.
// Run after npm run build: node --experimental-strip-types tests/demolition-refund-smoke.mjs
// --preflight validates synthetic economic fixtures without claiming browser QA.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { inflateSync, deflateSync } from 'node:zlib';
import { access, buildPlant, bulldoze, demolitionQuote, createCity, deserialize, plantAt, plantUpgradeStatus, serialize, upgradePlant, utilities } from '../src/sim.ts';
import { PLANT_LEVELS, plantLevel, plantUpgradeReason } from '../src/utilities.ts';
import { roadNeighborsFor } from '../src/road-topology.ts';
import { browserSnapshotState } from './browser-snapshot.ts';
import { startPersistenceFixture } from './persistence-server-fixture.mjs';
import { installTrafficNetworkFence, reachTrafficControl } from './traffic-server-entry-fixture.mjs';
import { loadPanelCity, panelEntryCity, saveAndReloadPanel } from './panel-ui-server.mjs';
import { isPanelProviderRequest, panelProviderDenials } from './panel-network-denies.mjs';

const output = resolve(process.env.CITYMANAGER_SCREENSHOT_DIR || '.test-output/demolition-refunds');
const appPort = 4398, debugPort = 9498, upstream = `http://127.0.0.1:${appPort}/CityManager/`;
// Two bounded native demolition flows with server save/reload and screenshots.
const suiteTimeoutMs = 10 * 60_000;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const checks = [], screenshots = [], layouts = [], bursts = [], keyboardTraces = [], errors = [], externalRequests = [], providerRequests = [], interceptionErrors = [];
const processLogs = { app: '', browser: '' };
const startedAt = Date.now(), diagnostics = { phase: 'setup', stages: [], cdp: [], renderers: [], captures: [] };
let ws, sequence = 0, networkProbe, fixture, browser, app, touchInput = false;
let primaryFailure;
const pending = new Map();
function boundedPush(list, value, limit = 80) { list.push(value); if (list.length > limit) list.splice(0, list.length - limit); }
function stage(phase) {
  diagnostics.phase = phase; boundedPush(diagnostics.stages, { phase, elapsedMs: Date.now() - startedAt });
  console.log('Demolition acceptance phase:', phase);
}
function resultReport(status, error) {
  return { status, date: new Date().toISOString(), suiteTimeoutMs, elapsedMs: Date.now() - startedAt, ...(error ? { error: String(error.stack ?? error) } : {}), checks, screenshots, layouts, bursts, keyboardTraces, errors, interceptionErrors, externalRequests, providerRequests, processLogs, diagnostics, pendingCommands: [...pending.values()].map(item => ({ ...item.metadata, pendingMs: Date.now() - item.metadata.queuedAt })) };
}
function writeFailure(error, write = writeFileSync) {
  // Emergency watchdog output must be durable BEFORE process.exit, which skips
  // async catch/finally handlers. Also preserve an earlier assertion failure.
  write(resolve(output, 'report.json'), JSON.stringify(resultReport('failed', error), null, 2));
  write(resolve(output, 'processes.log'), JSON.stringify(processLogs, null, 2));
}

function fixtureCity() {
  const city = createCity(61025), before = city.accounts.treasury;
  const cell = city.cells.findIndex((parcel, index) => !parcel.road && !parcel.zone && parcel.building === null && !plantAt(city, index) && access(city, index));
  assert.equal(buildPlant(city, cell, 'water').ok, true);
  const plant = plantAt(city, cell);
  assert.equal(upgradePlant(city, plant.id, 1).ok, true);
  const paid = before - city.accounts.treasury;
  assert.ok(paid > 0);
  assert.equal(demolitionQuote(city, cell).paid, paid);
  assert.equal(demolitionQuote(city, cell).refund, Math.floor(paid * 0.8));
  return { city, cell, paid };
}
const initial = fixtureCity();
if (process.argv.includes('--preflight')) {
  const city = panelEntryCity(serialize(initial.city)), before = city.accounts.treasury;
  assert.equal(bulldoze(city, initial.cell).ok, true);
  assert.equal(city.accounts.treasury - before, Math.floor(initial.paid * 0.8));
  const once = structuredClone(city); bulldoze(city, initial.cell);
  assert.deepEqual({ ...city, lastEvent: once.lastEvent }, once);
  assert.deepEqual(deserialize(serialize(city)), city);
  console.log('Demolition fixture preflight passed; browser not run'); process.exit(0);
}
async function send(method, params = {}) {
  const id = ++sequence, started = performance.now();
  const metadata = { id, method, phase: diagnostics.phase, queuedAt: Date.now(), ...(method === 'Runtime.evaluate' ? { expression: String(params.expression ?? '').slice(0, 200) } : {}), ...(params.type ? { inputType: params.type } : {}) };
  const response = new Promise((yes, no) => {
    let finished = false;
    const record = status => { if (finished) return; finished = true; boundedPush(diagnostics.cdp, { ...metadata, status, durationMs: Math.round(performance.now() - started) }); };
    const timer = setTimeout(() => { pending.delete(id); record('timeout'); no(Object.assign(Error(`CDP timeout: ${method}; phase=${metadata.phase}; expression=${metadata.expression ?? ''}`), { cdpTimeoutMethod: method })); }, 30_000);
    pending.set(id, { metadata, yes: value => { clearTimeout(timer); record('ok'); yes(value); }, no: error => { clearTimeout(timer); record('error'); no(error); } });
  });
  ws.send(JSON.stringify({ id, method, params }));
  return response;
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function until(expression, timeout = 30_000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (await evaluate(expression)) return; await sleep(60); }
  throw Error(`Timed out: ${expression}`);
}
const paints = () => evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
const state = async () => browserSnapshotState(await evaluate('window.cityManager.snapshot()'));
async function click(x, y, clickCount = 1) {
  await queueNativeBurst(nativeClickCommands(x, y, touchInput, clickCount));
}
function nativeClickCommands(x, y, touch, clickCount = 1) {
  if (touch) return [
    ['Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1, radiusX: 1, radiusY: 1, force: 1 }] }],
    ['Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }],
  ];
  return ['mouseMoved', 'mousePressed', 'mouseReleased'].map(type => ['Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount }]);
}
function nativeBurstCommands(x, y, touch) {
  if (touch) return [1, 2, 3].flatMap(() => [
    ['Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1, radiusX: 1, radiusY: 1, force: 1 }] }],
    ['Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }],
  ]);
  return [
    ['Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' }],
    ...[1, 1, 2].flatMap(clickCount => ['mousePressed', 'mouseReleased'].map(type => ['Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount }])),
  ];
}
function queueNativeBurst(commands, dispatch = send) {
  // send() writes synchronously before returning its response promise. Queue
  // the entire native burst before awaiting any browser acknowledgement.
  return Promise.all(commands.map(([method, params]) => dispatch(method, params)));
}
async function point(selector, allowHidden = false) {
  // Keep the same scroll, two painted frames, geometry and native hit test in
  // one browser task rather than four slow host/browser round trips.
  const p = await evaluate(`(async()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing native target');if(!e.getBoundingClientRect().width||!e.getBoundingClientRect().height)return null;e.scrollIntoView({block:'nearest',inline:'nearest'});await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return{x,y,width:r.width,height:r.height,disabled:e.disabled,hit:!!document.elementFromPoint(x,y)?.closest(${JSON.stringify(selector)})}})()`);
  if (allowHidden && !p) return null;
  assert.ok(p, `Visible ${selector}`);
  assert.ok(p.width && p.height, `Visible ${selector}`);
  assert.equal(p.hit, true, `Native hit target ${selector}`);
  return p;
}
async function button(selector) {
  // These controls need discovery only when hidden (e.g. the phone HUD menu).
  // Already visible buttons retain every geometry/disabled/hit assertion.
  let p = await point(selector, true);
  if (!p) { if (await reachTrafficControl(evaluate, button, selector)) return; p = await point(selector); }
  assert.equal(p.disabled, false, `Enabled ${selector}`);
  await click(p.x, p.y);
}
async function close() {
  if (await evaluate('document.querySelector("#inspector")?.dataset.open==="true"')) await button('#close-inspector');
  await paints();
}
async function cell(index) {
  await close(); await button('[data-tool="select"]');
  const p = await evaluate(`(async()=>{await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));const p=window.cityManager.cellScreen(${index});return{...p,hit:document.elementFromPoint(p.x,p.y)?.id}})()`);
  assert.equal(p.hit, 'city-canvas', `Canvas parcel ${index} is reachable`);
  await click(p.x, p.y);
  await until('document.querySelector("#inspector").dataset.open==="true" || !document.querySelector("#selection-actions").hidden');
  if (await evaluate('!document.querySelector("#selection-actions").hidden')) await button('#selection-actions button:nth-of-type(2)');
  await until('document.querySelector("#inspector").dataset.open==="true"');
  await paints();
}
async function selectPlant(plant) {
  await cell(plant.cell);
  await until('!document.querySelector("#plant-actions").hidden');
  const expected = plant.kind === 'power' ? 'โรงไฟฟ้า' : 'โรงสูบน้ำ';
  assert.match(await evaluate('document.querySelector("#plant-actions h3").textContent'), new RegExp(expected));
}
// Same bounded PNG readback validation as the server-save browser acceptance.
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
function assertCaptureHealth(health) {
  assert.equal(health.ready, true, 'Ready app required for screenshot evidence');
  assert.equal(health.contextLosses, 0, 'WebGL context must remain live');
  assert.ok(Number.isSafeInteger(health.width) && health.width > 0 && Number.isSafeInteger(health.height) && health.height > 0 && health.width * health.height <= 16_000_000, 'Bounded live viewport required for surface capture');
}
async function screenshotReadback(dispatch, probe, record) {
  record.mode = 'surface'; record.health = await probe(); assertCaptureHealth(record.health);
  const options = { format: 'png', fromSurface: true, captureBeyondViewport: false, optimizeForSpeed: true };
  try { return await dispatch('Page.captureScreenshot', options); }
  catch (error) {
    record.primaryError = String(error);
    // A tagged surface timeout permits one alternate readback, never a new
    // game action or an unbounded retry. View readback can return blank backing.
    if (error?.cdpTimeoutMethod !== 'Page.captureScreenshot') throw error;
    let health;
    try { health = await probe(); record.healthAfterTimeout = health; assertCaptureHealth(health); }
    catch (probeError) {
      record.healthProbeError = String(probeError);
      if (error instanceof Error) error.stack += '\nSecondary capture health failure: ' + String(probeError?.stack ?? probeError);
      throw error;
    }
    record.mode = 'surface-viewport';
    return await dispatch('Page.captureScreenshot', { ...options, clip: { x: 0, y: 0, width: health.width, height: health.height, scale: 1 } });
  }
}
async function screenshot(name) {
  stage(`capture ${name}`);
  const record = { name, status: 'pending', startedAt: Date.now() }; boundedPush(diagnostics.captures, record, 32);
  let png;
  const probe = async () => {
    assert.deepEqual(errors, [], 'No browser errors before surface readback');
    return evaluate('({ready:window.cityManager?.visuals().ready,contextLosses:window.__plantContextLosses,width:innerWidth,height:innerHeight,visibility:document.visibilityState})');
  };
  try {
    const result = await screenshotReadback(send, probe, record); png = Buffer.from(result.data, 'base64');
    Object.assign(record, pngEvidence(png));
    const health = record.healthAfterTimeout ?? record.health;
    assert.deepEqual([record.width, record.height], [health.width, health.height], 'Screenshot contains the entire live viewport at device scale1');
    const path = resolve(output, `${name}.png`); await writeFile(path, png); screenshots.push(path); record.status = 'saved';
  } catch (error) {
    record.status = 'failed'; record.error = String(error);
    if (png) {
      try { const path = resolve(output, `${name}-rejected.png`); await writeFile(path, png); record.rejectedEvidence = path; }
      catch (preserveError) { record.preserveError = String(preserveError); }
    }
    throw error;
  } finally { record.finishedAt = Date.now(); }
}
async function load(city) {
  const raw = serialize(city);
  await loadPanelCity(fixture.fixture, raw, { send, evaluate, button, until, url: fixture.url + '?starter=1' });
  const renderer = await evaluate('(()=>{const a=window.cityManager.atmosphere();return{renderer:a.renderer,quality:a.quality,requestedQuality:a.settings.quality,shadows:a.shadows,postProcessing:a.postProcessing,width:innerWidth,height:innerHeight}})()');
  boundedPush(diagnostics.renderers, renderer, 16);
  await close(); return panelEntryCity(raw);
}
async function demolitionFlow(metric) {
  stage(`${metric.name}: load upgraded municipal water plant`);
  const expected = await load(initial.city), before = expected.accounts.treasury;
  const quote = demolitionQuote(expected, initial.cell);
  assert.equal(quote.paid, initial.paid);
  assert.equal(quote.refund, Math.floor(initial.paid * 0.8));
  assert.equal(quote.fee, 0);
  await cell(initial.cell);
  const money = amount => `฿${(amount / 100).toLocaleString('th-TH')}`;
  const inspector = await evaluate('document.querySelector("#inspector").innerText');
  assert.ok(inspector.includes('เงินคืนเมื่อรื้อ'), 'Inspector explains demolition refund');
  assert.ok(inspector.includes(money(quote.refund)), 'Inspector shows exact 80% refund');
  assert.ok(inspector.includes(money(initial.paid)), 'Inspector shows actual municipal investment');
  const layout = await evaluate('({viewport:innerWidth,bodyWidth:document.documentElement.scrollWidth})');
  assert.ok(layout.bodyWidth <= layout.viewport + 1, 'No horizontal overflow');
  layouts.push({name:metric.name,...layout});
  await screenshot(`${metric.name}-refund-quote`);
  await close();
  await button('[data-tool="select"]');
  await button('[data-tool="bulldoze"]');
  const point = await evaluate(`(()=>{const p=window.cityManager.cellScreen(${initial.cell});return{...p,hit:document.elementFromPoint(p.x,p.y)?.id}})()`);
  assert.equal(point.hit, 'city-canvas', 'Demolition target is visible and unobstructed');
  await evaluate(`(()=>{window.__demolitionClicks=[];document.querySelector('#city-canvas').addEventListener('click',e=>window.__demolitionClicks.push({trusted:e.isTrusted,x:e.clientX,y:e.clientY}))})()`);
  await click(point.x, point.y); await paints();
  assert.equal(bulldoze(expected, initial.cell).ok, true);
  assert.deepEqual(await state(), expected, 'Native demolition matches full economic state');
  assert.equal(expected.accounts.treasury - before, Math.floor(initial.paid * 0.8), 'Build + upgrade investment refunded exactly once');
  assert.equal(plantAt(await state(), initial.cell), undefined);
  // Repeat real native activation on the now-empty original parcel.
  await click(point.x, point.y); await paints();
  const refunded = expected.accounts.treasury; bulldoze(expected, initial.cell);
  assert.equal(expected.accounts.treasury, refunded);
  assert.deepEqual(await state(), expected, 'Repeated demolition changes only status, never pays again');
  const clicks = await evaluate('window.__demolitionClicks');
  assert.equal(clicks.length, 2); assert.ok(clicks.every(e=>e.trusted), 'Both demolition attempts use trusted browser clicks');
  bursts.push({name:metric.name,input:metric.mobile?'touch':'mouse',clicks});
  await screenshot(`${metric.name}-after-demolition`);
  await button('#toggle-game-menu');
  await saveAndReloadPanel(fixture.fixture, expected, { send, evaluate, button, until });
  checks.push(`${metric.name}: exact inspector quote, native demolition, build+upgrade refund ${quote.refund}, repeated-click protection, full-city equality and server save/reload persistence`);
}
await mkdir(output, { recursive: true });
for (const port of [appPort, debugPort]) {
  let occupied = false; try { occupied = (await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(500) })).status > 0; } catch {}
  assert.equal(occupied, false, `Dedicated QA port ${port} is occupied`);
}
const watchdog = setTimeout(() => {
  const timeout = Error(`Demolition browser acceptance timed out after ${suiteTimeoutMs}ms; phase=${diagnostics.phase}`);
  diagnostics.watchdog = { elapsedMs: Date.now() - startedAt, phase: diagnostics.phase };
  try { writeFailure(primaryFailure ?? timeout); } catch (error) { console.error('Could not preserve watchdog evidence:', error); }
  console.error(timeout.message); browser?.kill(); app?.kill(); process.exit(1);
}, suiteTimeoutMs);
function logProcess(child, label) {
  const record = chunk => { processLogs[label] = (processLogs[label] + chunk.toString()).slice(-16_000); };
  child.stdout?.on('data', record); child.stderr?.on('data', record);
  child.on('error', error => record(String(error)));
  return child;
}
try {
  stage('launch built app and browser');
  app = logProcess(spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(appPort), '--strictPort'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }), 'app');
  let ready = false; for (let i = 0; i < 100; i++) { try { ready = (await fetch(upstream)).ok; } catch {} if (ready) break; await sleep(100); }
  assert.equal(ready, true, 'Built app preview starts: ' + processLogs.app);
  fixture = await startPersistenceFixture(upstream);
  const origin = new URL(fixture.url).origin, profile = await mkdtemp(resolve(output, 'browser-'));
  const executable = process.env.CITYMANAGER_BROWSER || (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : '/usr/bin/chromium');
  browser = logProcess(spawn(executable, ['--headless=new', ...(process.platform === 'linux' ? ['--no-sandbox'] : []), '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-component-update', '--enable-unsafe-swiftshader', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }), 'browser');
  let targets; for (let i = 0; i < 100; i++) { try { targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json(); if (targets.length) break; } catch {} await sleep(100); }
  assert.ok(targets?.length, 'Installed browser starts: ' + processLogs.browser);
  ws = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  ws.onmessage = event => {
    const message = JSON.parse(event.data), p = pending.get(message.id);
    if (p) { pending.delete(message.id); message.error ? p.no(Error(JSON.stringify(message.error))) : p.yes(message.result); }
    if (message.method === 'Page.javascriptDialogOpening') void fixture.fixture.dialog(message.params, send).catch(error => interceptionErrors.push(String(error)));
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(message.params.args.map(value => value.value ?? value.description).join(' '));
    if (message.method === 'Network.loadingFailed' && message.params.requestId === networkProbe?.requestId) networkProbe.failed = message.params;
    if (message.method === 'Network.requestWillBeSent') {
      const target = message.params.request.url;
      if (networkProbe?.active && target === networkProbe.url) networkProbe.requestId = message.params.requestId;
      else { if (isPanelProviderRequest(target)) providerRequests.push(target); if (/^https?:/.test(target) && new URL(target).origin !== origin) externalRequests.push(target); }
    }
  };
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__plantContextLosses=0;document.addEventListener("webglcontextlost",()=>window.__plantContextLosses++,true)' });
  await installTrafficNetworkFence({ send, evaluate, protocol: await (await fetch(`http://127.0.0.1:${debugPort}/json/protocol`)).json(), origin, additionalBlocked: panelProviderDenials(origin), observeProbe: url => (networkProbe = { url, active: false, requestId: null, failed: null }) });
  await fixture.fixture.install(send);
  for (const metric of [{ name: 'desktop', width: 1440, height: 1000, mobile: false }, { name: 'phone', width: 390, height: 844, mobile: true }]) {
    await send('Emulation.setDeviceMetricsOverride', { width: metric.width, height: metric.height, screenWidth: metric.width, screenHeight: metric.height, deviceScaleFactor: 1, mobile: metric.mobile });
    await send('Emulation.setTouchEmulationEnabled', { enabled: metric.mobile, maxTouchPoints: 2 });
    touchInput = metric.mobile;
    await demolitionFlow(metric);
    console.log(`${metric.name} demolition acceptance passed`);
  }
  await fixture.fixture.assertNoCityWrites(evaluate);
  assert.deepEqual(errors, []); assert.deepEqual(interceptionErrors, []); assert.deepEqual(fixture.errors, []);
  assert.deepEqual(externalRequests, []); assert.deepEqual(providerRequests, []);
  const report = { ...resultReport('passed'), browser: (await send('Browser.getVersion')).product, note: 'Real full-app native CDP mouse, touchStart/touchEnd, and keyboard input with synthetic server service. Phone metrics/touch are emulated, not physical-device QA.' };
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} catch (error) {
  primaryFailure = error; writeFailure(error);
  if (ws?.readyState === 1) { try { await screenshot('failure'); console.error('DOM:', await evaluate('document.querySelector("#inspector")?.outerHTML')); } catch {} }
  writeFailure(error);
  console.error('Browser errors:', errors); throw error;
} finally {
  clearTimeout(watchdog);
  if (ws?.readyState === 1) { try { await send('Browser.close'); } catch {} ws.close(); }
  browser?.kill(); app?.kill(); if (fixture) await fixture.close();
  await writeFile(resolve(output, 'processes.log'), JSON.stringify(processLogs, null, 2));
}
