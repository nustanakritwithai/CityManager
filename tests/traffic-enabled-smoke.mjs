// Real enabled-runtime acceptance. Disposable browser profile; no production saves/providers.
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { createCity as legacyCity, step as legacyStep, serialize as legacySerialize } from '../src/legacy-v4.ts';
import { deserialize, serialize, adoptSavedEducation, step } from '../src/sim.ts';
import { createParkRuntime, serializeParkSession } from '../src/park-runtime.ts';
import { trafficPlan } from '../src/traffic-plan.ts';
import { FADE_SECONDS } from '../src/traffic/fleet.ts';
import { reachTouch } from './touch-reach.mjs';

// A real replayed, strictly migrated city with earned employment/deliveries, not fabricated traffic.
const legacy = legacyCity(61025); for (let d = 0; d < 29; d++) legacyStep(legacy);
const fixture = deserialize(legacySerialize(legacy)); adoptSavedEducation(fixture); step(fixture);
let plan = trafficPlan(fixture);
for (let d = 0; d < 60 && !(plan.cars.length && plan.trucks.length && plan.smoke.length); d++) { step(fixture); plan = trafficPlan(fixture); }
assert.ok(plan.cars.length && plan.trucks.length && plan.smoke.length, 'Nonempty cars, trucks and factory smoke fixture');
const raw = serializeParkSession(fixture, createParkRuntime(fixture)), cityRaw = serialize(fixture);
const expected = deserialize(cityRaw); for (let d = 0; d < 3; d++) step(expected);
const fixtureEvidence = { day: fixture.tick, cars: plan.cars.length, trucks: plan.trucks.length, smoke: plan.smoke.length, expectedDay: expected.tick };
if (process.argv.includes('--preflight')) { console.log(JSON.stringify(fixtureEvidence)); process.exit(0); }

const blocked = process.env.CITYMANAGER_BLOCK_MODELS === '1', software = process.env.CITYMANAGER_SOFTWARE_WEBGL === '1';
const url = process.env.CITYMANAGER_URL || 'http://127.0.0.1:4195/CityManager/', origin = new URL(url).origin;
assert.equal(new URL(url).hostname, '127.0.0.1', 'Only a disposable loopback game may be tested');
const output = resolve('.test-output/traffic-enabled', blocked ? 'fallback' : 'normal'), port = 9366;
await mkdir(output, { recursive: true }); const profile = await mkdtemp(resolve(output, 'profile-'));
let occupied = false; try { occupied = (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(500) })).ok; } catch {}
assert.equal(occupied, false, 'Run browser suite sequentially; dedicated CDP port is occupied');
const args = ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-component-update', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`];
if (software) args.push('--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader');
const child = spawn(process.env.CITYMANAGER_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', [...args, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
let ws, sequence = 0, initScript, seedGeneration = 0, touchMode = false, launchError;
const pending = new Map(), errors = [], expectedErrors = [], externalRequests = [], checks = [], screenshots = [];
child.on('error', error => { launchError = error; });
const watchdog = setTimeout(() => { console.error('Traffic acceptance exceeded its bounded browser run'); child.kill(); process.exit(1); }, 240_000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function send(method, params = {}) { const id = ++sequence; const result = new Promise((resolve, reject) => { const timer = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout ${method}`)); }, 30000); pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } }); }); ws.send(JSON.stringify({ id, method, params })); return result; }
async function evaluate(expression) { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; }
async function until(expression, timeout = 60000) { const start = Date.now(); while (Date.now() - start < timeout) { if (await evaluate(expression)) return; await sleep(60); } throw Error(`Timeout ${expression}`); }
const diagnostic = () => evaluate('({fleet:window.cityManager.traffic(),decorative:window.cityManager.atmosphere().traffic,paused:window.cityManager.parks().paused})');
async function screenshot(name) { const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); await writeFile(resolve(output, name), Buffer.from(r.data, 'base64')); screenshots.push(name); }
const paints = () => evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
async function click(x, y) {
  if (touchMode) { await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); return; }
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: 1 });
}
async function button(selector) {
  if (await reachTouch(evaluate, button, selector)) return;
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest',inline:'nearest'})`); await paints();
  const p = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height,disabled:e.disabled}})()`);
  assert.ok(p.w && p.h && !p.disabled, `Visible enabled ${selector}`);
  assert.equal(await evaluate(`!!document.elementFromPoint(${p.x},${p.y})?.closest(${JSON.stringify(selector)})`), true, `Actual user hit ${selector}`);
  await click(p.x, p.y);
}
const pauseButton = () => button('#pause');
async function viewport(mobile) {
  touchMode = mobile;
  await send('Emulation.setDeviceMetricsOverride', { width: mobile ? 390 : 1440, height: mobile ? 844 : 1000, screenWidth: mobile ? 390 : 1440, screenHeight: mobile ? 844 : 1000, deviceScaleFactor: 1, mobile });
  await send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: 2 });
  await until(`innerWidth===${mobile ? 390 : 1440}`); await paints();
}

async function navigate(query = '') {
  const oldBoot = await evaluate('window.__trafficBoot ?? null');
  if (initScript) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: initScript });
  // Reseed this disposable profile only. Retain the actual traffic preference across navigations.
  const seedToken = `traffic-case-${++seedGeneration}`;
  const source = `window.__trafficBoot=crypto.randomUUID();if(location.origin===${JSON.stringify(origin)}){if(sessionStorage.getItem('traffic-test-seed')!==${JSON.stringify(seedToken)}){sessionStorage.setItem('traffic-test-seed',${JSON.stringify(seedToken)});const pref=localStorage.getItem('citymanager.traffic');localStorage.clear();if(pref!==null)localStorage.setItem('citymanager.traffic',pref);localStorage.setItem('citymanager.save.v7',${JSON.stringify(raw)});localStorage.setItem('citymanager.visual.v1',JSON.stringify({timeMode:'noon',quality:'low',rain:false,seasons:false,traffic:true,mapInfo:false}));}window.__trafficWrites=[];for(const method of ['setItem','removeItem']){const old=Storage.prototype[method];Storage.prototype[method]=function(key,...args){if(this===localStorage)window.__trafficWrites.push({method,key});return old.call(this,key,...args)}}}`;
  initScript = (await send('Page.addScriptToEvaluateOnNewDocument', { source })).identifier;
  await send('Page.navigate', { url: url + query });
  await until(`window.__trafficBoot!==${JSON.stringify(oldBoot)}&&!!window.cityManager&&window.cityManager.visuals().ready`);
  assert.equal(await evaluate('window.cityManager.parks().paused'), true);
  assert.equal(await evaluate('window.cityManager.snapshot()'), cityRaw, 'Startup restores the same city');
  assert.equal(await evaluate("localStorage.getItem('citymanager.save.v7')"), raw, 'Startup preserves original save bytes');
  assert.deepEqual(await evaluate("window.__trafficWrites.filter(x=>/^citymanager\.(save|backup|checkpoint|market)/.test(x.key))"), [], 'No startup save/backup/market writes');
  const assets = await evaluate('window.cityManager.visuals()');
  assert.equal(assets.failed.length, blocked ? 41 : 0); if (!blocked) assert.equal(assets.loaded.length, 41);
  return diagnostic();
}
async function runThreeDays(query) {
  await navigate(query);
  await evaluate(`window.__trafficSawCar=false;window.__trafficMaxVehicles=0;(()=>{const watch=()=>{const k=window.cityManager.traffic();if(k){window.__trafficSawCar ||= k.cars>0;window.__trafficMaxVehicles=Math.max(window.__trafficMaxVehicles,k.totals.vehicles)}if(JSON.parse(window.cityManager.snapshot()).tick>=${expected.tick}){if(!window.cityManager.parks().paused)document.querySelector('#pause').click()}else requestAnimationFrame(watch)};requestAnimationFrame(watch)})()`);
  await pauseButton();
  await until(`window.cityManager.parks().paused&&JSON.parse(window.cityManager.snapshot()).tick>=${expected.tick}`);
  const actual = await evaluate('window.cityManager.snapshot()'); assert.equal(actual, serialize(expected), 'Three real days equal deterministic economy replay');
  if (query === '?traffic=1') { assert.equal(await evaluate('window.__trafficSawCar'), true); assert.ok(await evaluate('window.__trafficMaxVehicles') > 0); const d = await diagnostic(); assert.ok(d.fleet.totals.periods >= 48); }
  return actual;
}

try {
  let page; for (let i = 0; i < 100; i++) { try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(p => p.type === 'page' && p.url === 'about:blank'); if (page) break; } catch {} await sleep(100); }
  if (launchError) throw launchError;
  assert.ok(page, 'Installed browser started'); ws = new WebSocket(page.webSocketDebuggerUrl);
  ws.onmessage = event => { const m = JSON.parse(event.data); if (m.id) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p?.reject(Error(JSON.stringify(m.error))) : p?.resolve(m.result); }
    else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails);
    else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') { const a = m.params.args; const expected = blocked && a.length === 2 && /^Failed to load resource \[\/CityManager\/assets\/kenney-city\/models\/([a-z]+(?:-[a-z]+)?)\.glb-container\]: Network error$/.test(a[0]?.value) && a[1]?.value === 'Network error'; (expected ? expectedErrors : errors).push(a); }
    else if (m.method === 'Fetch.requestPaused') {
      const request = m.params.request.url, local = !/^https?:/.test(request) || new URL(request).origin === origin;
      const model = /\/assets\/kenney-city\/models\/[^/]+\.glb(?:\?|$)/.test(request);
      if (!local) externalRequests.push(request);
      void send(!local || blocked && model ? 'Fetch.failRequest' : 'Fetch.continueRequest', !local || blocked && model ? { requestId: m.params.requestId, errorReason: 'Failed' } : { requestId: m.params.requestId }).catch(error => errors.push(String(error)));
    }
    else if (m.method === 'Network.requestWillBeSent') { const u = m.params.request.url; if (/^https?:/.test(u) && new URL(u).origin !== origin) externalRequests.push(u); }
  };
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await viewport(false);
  await send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
  let d = await navigate(); assert.equal(d.fleet, null); assert.ok(d.decorative.actors > plan.trucks.length); assert.ok(d.decorative.trucks && d.decorative.plumes);
  assert.equal(await evaluate("localStorage.getItem('citymanager.traffic')"), null); checks.push('Fresh no-query profile is off; decorative vehicles/trucks/smoke remain');
  d = await navigate('?traffic=1'); assert.ok(d.fleet); assert.equal(d.fleet.capacity, 0); assert.equal(d.decorative.actors, plan.trucks.length); assert.equal(d.decorative.cars, 0); assert.ok(d.decorative.trucks && d.decorative.plumes);
  assert.equal(await evaluate("localStorage.getItem('citymanager.traffic')"), '1');
  // Require a currently nonempty fleet throughout its configured fade-in, not an expired first-car timer.
  await evaluate(`window.__trafficObserved=false;(()=>{let visibleSince=null;const watch=()=>{const f=window.cityManager.traffic(),visible=f.cars>0&&f.drawBatches>0&&f.totals.vehicles>0;if(visible)visibleSince??=performance.now();else visibleSince=null;if(visible&&performance.now()-visibleSince>=${FADE_SECONDS * 1000}){window.__trafficObserved=true;document.querySelector('#pause').click()}else requestAnimationFrame(watch)};requestAnimationFrame(watch)})()`);
  await pauseButton(); await until('window.__trafficObserved&&window.cityManager.parks().paused');
  d = await diagnostic(); assert.ok(d.fleet.cars > 0 && d.fleet.drawBatches > 0 && d.fleet.totals.vehicles > 0); assert.equal(d.decorative.cars, 0); assert.ok(d.decorative.trucks > 0 && d.decorative.plumes > 0);
  await screenshot('enabled-fleet-and-factory.png'); const pausedCity = await evaluate('window.cityManager.snapshot()'); await sleep(350); assert.deepEqual(await diagnostic(), d); assert.equal(await evaluate('window.cityManager.snapshot()'), pausedCity);
  checks.push('Real ?traffic=1 fleet draws alongside trucks/smoke without duplicate decorative cars; pause freezes city and fleet');
  assert.ok((await navigate()).fleet, 'No query retains saved opt-in');
  assert.equal((await navigate('?traffic=0')).fleet, null); assert.equal(await evaluate("localStorage.getItem('citymanager.traffic')"), null);
  d = await navigate(); assert.equal(d.fleet, null); assert.ok(d.decorative.actors > plan.trucks.length);
  d = await navigate('?traffic=1'); assert.equal(d.fleet.capacity, 0); assert.equal(d.fleet.simulated, 0); assert.equal(d.decorative.actors, plan.trucks.length);
  checks.push('Preference survives no-query; ?traffic=0 clears it/restores old cars; re-enable reload starts an empty fresh fleet renderer');
  assert.equal(await runThreeDays('?traffic=1'), await runThreeDays('?traffic=0'));
  checks.push('Enabled and disabled actual three-day browser simulation equal deterministic city/economy/save replay with nonzero modeled and visible vehicles');
  assert.deepEqual(errors, []); assert.deepEqual(externalRequests, []); if (blocked) assert.ok(expectedErrors.length >= 41);
  const report = { fixture: fixtureEvidence, browser: await send('Browser.getVersion'), blockedModels: blocked, softwareWebGL: software, checks, errors, expectedModelErrors: expectedErrors.length, externalRequests, screenshots, note: 'Installed Edge, desktop viewport; not physical Android, FPS certification, or live-site acceptance.' };
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} catch (error) { try { await screenshot('failure.png'); await writeFile(resolve(output, 'failure.json'), JSON.stringify({ error: String(error), errors, externalRequests, state: await diagnostic(), page: await evaluate('({url:location.href,text:document.body.innerText.slice(-3000)})') }, null, 2)); } catch {} throw error; }
finally { clearTimeout(watchdog); if (ws?.readyState === 1) { try { await send('Browser.close'); } catch {} ws.close(); } child.kill(); }
