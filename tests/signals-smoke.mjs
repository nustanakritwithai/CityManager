// Installed Edge, isolated loopback port/profile; no provider or authentication calls.
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import assert from 'node:assert/strict';
import { createCity, step, serialize } from '../src/sim.ts';

const root = process.cwd(), output = resolve(root, '.test-output');
const profile = resolve(output, 'edge-signals');
assert(profile.startsWith(output + sep));
const shots = resolve(root, 'docs/signal-preview');
const url = process.env.CITYMANAGER_SIGNALS_URL || 'http://127.0.0.1:4187/CityManager/';
const debugPort = 9357;
await mkdir(output, { recursive: true }); await mkdir(shots, { recursive: true });
let occupied = false;
try { occupied = (await fetch(`http://127.0.0.1:${debugPort}/json/version`, { signal: AbortSignal.timeout(500) })).ok; } catch {}
assert.equal(occupied, false, 'Signal suite uses its own CDP port; never reuse another browser');
const browser = process.env.CITYMANAGER_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const child = spawn(browser, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-component-update', '--disable-gpu-shader-disk-cache', '--disk-cache-size=1048576', '--media-cache-size=1048576', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, '--window-size=1440,1000', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
const errors = [], checks = [], apiRequests = [], screenshots = [];
let ws, sequence = 0; const pending = new Map();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function send(method, params = {}) {
  const id = ++sequence;
  const promise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout ${method}`)); }, 15000);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
  });
  ws.send(JSON.stringify({ id, method, params })); return promise;
}
async function evaluate(expression) {
  const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (response.exceptionDetails) throw Error(JSON.stringify(response.exceptionDetails));
  return response.result.value;
}
async function until(expression) {
  for (let i = 0; i < 150; i++) { if (await evaluate(expression)) return; await sleep(80); }
  throw Error(`Condition timeout ${expression}`);
}
const paints = () => evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
const state = () => evaluate('JSON.parse(window.cityManager.snapshot())');
async function button(selector) {
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest',inline:'nearest'})`);
  await paints();
  const point = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height,disabled:e.disabled}})()`);
  assert(point.w > 0 && point.h > 0 && !point.disabled, `Visible active control ${selector}`);
  assert.equal(await evaluate(`!!document.elementFromPoint(${point.x},${point.y})?.closest(${JSON.stringify(selector)})`), true, `Hit control ${selector}`);
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: point.x, y: point.y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: 1 });
  await paints();
}
async function shot(name) {
  await evaluate('document.querySelector("#inspector-body").scrollTop=0'); await paints();
  const data = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(resolve(shots, name), Buffer.from(data.data, 'base64')); screenshots.push(name);
}
async function openSignals() {
  await button('#toggle-inspector'); await button('#open-signals');
  await until('document.querySelector("#inspector").dataset.page==="signals"');
}

try {
  let targets;
  for (let i = 0; i < 100; i++) { try { targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json(); break; } catch { await sleep(100); } }
  assert(targets?.some(t => t.type === 'page'), 'Installed Edge started');
  ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  ws.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) { const handler = pending.get(message.id); pending.delete(message.id); message.error ? handler.reject(Error(JSON.stringify(message.error))) : handler.resolve(message.result); }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push('console.error');
    if (message.method === 'Network.requestWillBeSent' && /\/api\/city-advisor\/report|opentyphoon/i.test(message.params.request.url)) apiRequests.push(message.params.request.url);
  };
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url }); await until('!!window.cityManager && window.cityManager.visuals().ready');
  assert.equal(await evaluate('document.querySelector("#signal-entry").hidden'), true, 'Pilot hidden without feature flag');
  checks.push('Default feature gate hides panel and creates no report request');

  await send('Page.navigate', { url: `${url}?signals=1` }); await until('!!window.cityManager && window.cityManager.visuals().ready');
  if (await evaluate('document.querySelector("#pause").getAttribute("aria-pressed")==="false"')) await button('#pause');
  const fixture = createCity(61025); for (let n = 0; n < 65; n++) step(fixture);
  await button('#toggle-game-menu');
  await evaluate(`localStorage.setItem('citymanager.save.v1',${JSON.stringify(serialize(fixture))})`); await button('#load'); await button('#close-inspector');
  const before = await state(); assert.deepEqual(before, fixture);
  await openSignals();
  assert.equal(await evaluate('document.querySelector("#signal-mode").dataset.mode'), 'offline');
  assert.equal(await evaluate('document.querySelector("#signal-content").dataset.snapshotTick'), '65');
  const metrics = await evaluate('Object.fromEntries([...document.querySelectorAll("[data-signal-metric]")].map(e=>[e.dataset.signalMetric,Number(e.dataset.value)]))');
  assert.deepEqual(metrics, {
    households: fixture.households.length, businesses: fixture.firms.length, treasury: fixture.accounts.treasury / 100,
    incomePerTick: fixture.ledger.filter(e => e.tick === fixture.tick && e.to === 'treasury').reduce((n,e) => n+e.amount,0)/100,
    expensesPerTick: fixture.ledger.filter(e => e.tick === fixture.tick && e.from === 'treasury').reduce((n,e) => n+e.amount,0)/100,
  });
  assert.equal(await evaluate('document.querySelectorAll("[data-signal-metric=population]").length'), 0);
  assert((await evaluate('document.querySelectorAll("[data-missing-id^=\"missing.prior.\"]").length')) > 0);
  assert.deepEqual(await state(), before, 'Opening report is read-only');
  await button('#signal-refresh'); assert.deepEqual(await state(), before, 'Manual capture is read-only');
  await shot('desktop-signals.png');
  checks.push('Actual aggregate values, credit units, unsupported population and missing first history match simulation without mutation');

  await button('#close-inspector'); await button('[data-speed="10"]'); await button('#pause');
  await until('JSON.parse(window.cityManager.snapshot()).tick>=68'); await button('#pause');
  const advanced = await state(); await openSignals();
  assert.equal(await evaluate('document.querySelectorAll("[data-signal-id^=\"trend.\"]").length'), 5);
  assert.deepEqual(await state(), advanced, 'Comparative report is read-only');
  await button('#close-inspector'); await button('#pause');
  await until(`JSON.parse(window.cityManager.snapshot()).tick>${advanced.tick}`); await button('#pause');
  await button('#toggle-inspector'); await button('#open-signals');
  // Opening explicitly captures. Let the city advance with the reading surface open.
  const captured = await evaluate('Number(document.querySelector("#signal-content").dataset.snapshotTick)');
  await button('#pause'); await until(`JSON.parse(window.cityManager.snapshot()).tick>${captured}`); await button('#pause');
  assert.equal(await evaluate('document.querySelector("#signal-content").dataset.stale'), 'true');
  assert.equal(await evaluate('Number(document.querySelector("#signal-content").dataset.snapshotTick)'), captured);
  checks.push('Distinct captures create exact trend windows and live clock marks captured report stale');

  await send('Emulation.setDeviceMetricsOverride', { width: 360, height: 740, screenWidth: 360, screenHeight: 780, deviceScaleFactor: 1, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 }); await paints();
  await button('#signal-refresh');
  const mobile = await evaluate('(()=>{const p=document.querySelector("#inspector").getBoundingClientRect(),b=document.querySelector("#inspector-body"),r=document.querySelector("#signal-refresh").getBoundingClientRect();return{left:p.left,right:p.right,top:p.top,bottom:p.bottom,height:p.height,scrollWidth:b.scrollWidth,clientWidth:b.clientWidth,refreshWidth:r.width,refreshHeight:r.height}})()');
  assert(mobile.left >= 0 && mobile.right <= 361 && mobile.top >= 0 && mobile.bottom <= 741, 'Mobile panel contained');
  assert(mobile.height >= 740 * .9 && mobile.scrollWidth <= mobile.clientWidth + 1, 'Tall mobile reading surface has no horizontal overflow');
  assert(mobile.refreshWidth >= 44 && mobile.refreshHeight >= 44, '44px refresh control');
  await shot('mobile-signals.png');
  const immutable = await state();
  await button('.signal-missing>summary'); await button('.signal-provenance>summary');
  assert.deepEqual(await state(), immutable, 'Disclosures are read-only');
  await button('#submenu-back'); assert.equal(await evaluate('document.querySelector("#inspector").dataset.page'), 'city');
  await button('#close-inspector');
  assert.equal(await evaluate('document.querySelector("#inspector").dataset.open'), 'false');
  checks.push('360x740 mobile drawer, disclosures, Back and close preserve playfield and state');

  await button('#toggle-game-menu'); await button('#load'); await button('#close-inspector'); await openSignals();
  assert((await evaluate('document.querySelectorAll("[data-missing-id^=\"missing.prior.\"]").length')) > 0, 'Load clears capture history');
  assert.equal(apiRequests.length, 0, 'No API/provider request while connection is disabled');
  assert.equal(errors.length, 0, `Browser errors: ${JSON.stringify(errors)}`);
  checks.push('Load resets history; zero browser errors and zero API/provider requests');
  await writeFile(resolve(shots, 'qa.json'), JSON.stringify({ sourceBaseCommit: '504f16a30199cd6fd47be0d98e1b20d26aed2c0e', candidateCommit: execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(), testedAt: new Date().toISOString(), url, browser: 'installed Microsoft Edge headless', checks, mobile, apiRequests: 0, browserErrors: 0, screenshots, deviceNote: 'Mobile viewport emulation; not a physical handset test.' }, null, 2)+'\n');
  console.log(JSON.stringify({ passed: checks.length, apiRequests: apiRequests.length, errors: errors.length, screenshots }));
} finally {
  if (ws?.readyState === WebSocket.OPEN) { try { await send('Browser.close'); } catch {} ws.close(); }
  child.kill();
  await Promise.race([new Promise(resolve => child.once('exit',resolve)), sleep(2000)]);
  // Retain this task's bounded profile; latest task direction forbids more deletion.
}
