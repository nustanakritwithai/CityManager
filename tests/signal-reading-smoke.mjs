// Public-client UX exercised with intercepted mock reports only; never contact the provider.
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import assert from 'node:assert/strict';
import { createCity, step, serialize } from '../src/sim.ts';
import { SAVE_KEY } from '../src/save-storage.ts';
import { buildLocalSignalReport, captureCitySignals } from '../src/signal-data.ts';
import { reachTouch } from './touch-reach.mjs';

const root = process.cwd(), output = resolve(root, '.test-output');
const profile = resolve(output, 'edge-signal-reading');
assert(profile.startsWith(output + sep));
const shots = resolve(root, process.env.CITYMANAGER_SIGNAL_READING_SCREENSHOT_DIR || process.env.CITYMANAGER_SIGNAL_READING_OUTPUT_DIR || '.test-output/signal-reading');
assert(shots.startsWith(output + sep), 'Reading screenshots and QA must stay under this task .test-output');
const url = process.env.CITYMANAGER_SIGNAL_READING_URL || 'http://127.0.0.1:4187/CityManager/';
assert.equal(new URL(url).hostname, '127.0.0.1', 'Test only this task\'s loopback preview');
const debugPort = 9359;
const candidateCommit = process.env.CITYMANAGER_SIGNALS_COMMIT || execFileSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
assert.match(candidateCommit, /^[a-f0-9]{40}$/);
await mkdir(output, { recursive: true });
let occupied = false;
try { occupied = (await fetch(`http://127.0.0.1:${debugPort}/json/version`, { signal: AbortSignal.timeout(500) })).ok; } catch {}
assert.equal(occupied, false, 'Never attach to a browser owned by another test');
const browser = process.env.CITYMANAGER_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const child = spawn(browser, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-component-update', '--disable-gpu-shader-disk-cache', '--disk-cache-size=1048576', '--media-cache-size=1048576', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, '--window-size=1440,1000', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
const errors = [], checks = [], apiRequests = [], held = [], captures = [], interceptionErrors = [];
let providerAttempts = 0, preflights = 0, behavior = 'delay';
let ws, sequence = 0; const pending = new Map();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function send(method, params = {}) {
  const id = ++sequence;
  const promise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout ${method}`)); }, 30000);
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
  for (let i = 0; i < 160; i++) { if (await evaluate(expression)) return; await sleep(80); }
  throw Error(`Condition timeout ${expression}`);
}
async function untilRequests(count) {
  for (let i = 0; i < 100 && apiRequests.length < count; i++) await sleep(40);
  assert.equal(apiRequests.length, count, 'Exactly one mock request per explicit action');
}
const paints = () => evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
const state = () => evaluate('(()=>{const c=JSON.parse(window.cityManager.snapshot());if(c.version!==19||c.rulesVersion!=="chain-14")throw new Error("Unexpected current save envelope");c.version=9;c.rulesVersion="chain-4";return c})()');
const count = selector => evaluate(`document.querySelectorAll(${JSON.stringify(selector)}).length`);
const visible = selector => evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});return !!e&&!e.hidden&&e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0})()`);
async function button(selector) {
  if (await reachTouch(evaluate, button, selector)) return;
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest',inline:'nearest'})`);
  await paints();
  const point = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height,disabled:e.disabled}})()`);
  assert(point.w > 0 && point.h > 0 && !point.disabled, `Visible active control ${selector}`);
  assert.equal(await evaluate(`!!document.elementFromPoint(${point.x},${point.y})?.closest(${JSON.stringify(selector)})`), true, `Hit control ${selector}`);
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: point.x, y: point.y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: 1 });
  await paints();
}
async function shot(name, selector) {
  if (selector) await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'start'})`);
  else await evaluate('document.querySelector("#inspector-body").scrollTop=0');
  await paints();
  const data = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  captures.push({ name, bytes: Buffer.from(data.data, 'base64') });
}
const responseHeaders = [
  { name: 'Content-Type', value: 'application/json' },
  { name: 'Access-Control-Allow-Origin', value: '*' },
  { name: 'Access-Control-Allow-Methods', value: 'POST, OPTIONS' },
  { name: 'Access-Control-Allow-Headers', value: 'Content-Type' },
];
async function readingFonts(name) {
  await evaluate('document.querySelector("#inspector-body").scrollTop=0'); await paints();
  const result = await evaluate(`(()=>{
    const host=document.querySelector('#signal-content'),body=document.querySelector('#inspector-body'),r=body.getBoundingClientRect(),sticky=document.querySelector('.signal-controls').getBoundingClientRect();
    const readerUnit=parseFloat(getComputedStyle(host).getPropertyValue('--reader-unit'))||1;
    const measure=e=>{const fontSize=parseFloat(getComputedStyle(e).fontSize);return{fontSize,normalized:fontSize/readerUnit,text:e.textContent.trim()}};
    const titles=[...host.querySelectorAll('.signal-observation-title')].map(measure);
    const plainBodies=[...host.querySelectorAll('.signal-observation-detail>p')].filter(e=>!e.closest('.signal-technical')&&!e.matches('.signal-note,.signal-evidence')).map(measure);
    const usefulRows=[...host.querySelectorAll('#signal-summary .signal-summary-link')].map(e=>{const b=e.getBoundingClientRect();return{text:e.textContent.trim(),top:b.top,bottom:b.bottom,full:b.width>0&&b.height>0&&b.top>=Math.max(r.top,sticky.bottom,0)-1&&b.bottom<=Math.min(r.bottom,innerHeight)+1&&b.left>=Math.max(r.left,0)-1&&b.right<=Math.min(r.right,innerWidth)+1}});
    const globalSummarySpanRules=[];for(const sheet of document.styleSheets){try{for(const rule of sheet.cssRules){if(rule.selectorText==='summary span')globalSummarySpanRules.push(rule.cssText)}}catch{}}
    return{name:${JSON.stringify(name)},width:innerWidth,height:innerHeight,screenWidth:screen.width,readerUnit,titles,plainBodies,visibleUsefulRows:usefulRows.filter(row=>row.full&&row.text).length,usefulRows,globalSummarySpanRules};
  })()`);
  assert(result.titles.length >= 3 && result.plainBodies.length >= 3, 'Representative collapsed titles and expanded bodies exist');
  for (const row of [...result.titles, ...result.plainBodies]) {
    assert(row.fontSize >= 13.99, `${name}: text at least14 CSS pixels: ${JSON.stringify(row)}`);
    assert(row.normalized >= 13.99, `${name}: text at least14 reader units: ${JSON.stringify(row)}`);
  }
  const sizes = [...result.titles, ...result.plainBodies].map(row => row.normalized);
  result.bodyTitleRatio = Math.max(...sizes) / Math.min(...sizes);
  assert(result.bodyTitleRatio <= 1.2, `${name}: collapsed and expanded copy have consistent readable sizing`);
  assert(result.visibleUsefulRows >= 3, `${name}: at least three useful summary rows visible without scrolling`);
  return result;
}
async function fulfill(item, mode = 'ai') {
  const report = buildLocalSignalReport(item.input); report.mode = 'ai';
  if (mode === 'invalid') report.report.summarySignalIds = ['signal.invented'];
  await send('Fetch.fulfillRequest', {
    requestId: item.requestId, responseCode: mode === 'failure' ? 503 : 200, responseHeaders,
    body: Buffer.from(JSON.stringify(mode === 'failure' ? { error: 'mock_unavailable' } : report)).toString('base64'),
  });
}
async function intercept(params) {
  if (/opentyphoon/i.test(params.request.url)) {
    providerAttempts++; await send('Fetch.failRequest', { requestId: params.requestId, errorReason: 'BlockedByClient' }); return;
  }
  assert.equal(new URL(params.request.url).pathname, '/api/city-advisor/report');
  if (params.request.method === 'OPTIONS') {
    preflights++;
    await send('Fetch.fulfillRequest', { requestId: params.requestId, responseCode: 204, responseHeaders }); return;
  }
  assert.equal(params.request.method, 'POST');
  assert(!Object.keys(params.request.headers).some(name => /^(authorization|cookie)$/i.test(name)), 'Public game sends no login credentials');
  const input = JSON.parse(params.request.postData);
  assert(!JSON.stringify(input).includes('TYPHOON_API_KEY'));
  const item = { requestId: params.requestId, input };
  apiRequests.push({ tick: input.snapshot.tick, priorTick: input.snapshot.prior?.tick ?? null, metrics: input.snapshot.metrics.length, behavior });
  if (behavior === 'delay') held.push(item);
  else await fulfill(item, behavior);
}
async function releaseCancelled() {
  for (const item of held.splice(0)) {
    try { await fulfill(item); }
    catch (error) { assert.match(String(error), /Invalid InterceptionId|Invalid parameters|No resource|not found|Invalid Fetch request|Invalid requestId/i, 'Only cancelled interception may reject late response'); }
  }
  await paints();
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
    if (message.method === 'Fetch.requestPaused') void intercept(message.params).catch(error => interceptionErrors.push(String(error)));
  };
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  await send('Fetch.enable', { patterns: [{ urlPattern: '*://*/api/city-advisor/report*' }, { urlPattern: '*opentyphoon*' }] });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: url + '?advanced=1&starter=1' }); await until('!!window.cityManager && window.cityManager.visuals().ready'); // experimental features are off by default
  if (await evaluate('document.querySelector("#pause").getAttribute("aria-pressed")==="false"')) await button('#pause');
  const fixture = createCity(61025); for (let day = 0; day < 65; day++) step(fixture);
  await button('#toggle-game-menu');
  await evaluate(`localStorage.removeItem(${JSON.stringify(SAVE_KEY)});localStorage.setItem(${JSON.stringify(SAVE_KEY)},${JSON.stringify(serialize(fixture))})`);
  await button('#load'); await button('#close-inspector');
  const before = await state(); assert.deepEqual(before, fixture);

  await openSignals(); await untilRequests(1);
  assert.equal(await evaluate('document.querySelector("#signal-mode").dataset.mode'), 'pending');
  assert.equal(await count('[data-signal-metric]'), 9, 'Immediate deterministic metrics remain readable during loading');
  assert.equal(await visible('#signal-summary'), true);
  assert.equal(await visible('#signal-cancel'), true);
  assert.equal(await evaluate('document.querySelector("#signal-refresh").disabled'), true);
  assert.deepEqual(await state(), before, 'Opening a pending report does not mutate the simulation');
  await button('#signal-cancel');
  assert.notEqual(await evaluate('document.querySelector("#signal-mode").dataset.mode'), 'pending');
  assert.match(await evaluate('document.querySelector("#signal-request-feedback").textContent'), /ยกเลิก|หยุดรอ/);
  await releaseCancelled();
  assert.notEqual(await evaluate('document.querySelector("#signal-mode").dataset.mode'), 'ai', 'Late cancelled reply cannot overwrite local report');
  assert.deepEqual(await state(), before);
  checks.push('Loading preserves nine local metrics, visible cancellation and immutable simulation; late cancelled response is ignored');

  behavior = 'failure'; await button('#signal-refresh'); await untilRequests(2);
  await until('document.querySelector("#signal-mode").dataset.mode==="fallback"');
  assert.equal(await visible('#signal-retry'), true);
  const failedCapture = apiRequests.at(-1).tick;
  const failedBody = await evaluate('[...document.querySelectorAll("#signal-summary .signal-summary-link")].map(e=>({id:e.dataset.signalRef,text:e.textContent}))');
  await button('[data-speed="10"]'); await button('#pause');
  await until(`JSON.parse(window.cityManager.snapshot()).tick>${failedCapture + 2}`); await button('#pause');
  const advanced = await state(); assert(advanced.tick > failedCapture);
  assert.equal(apiRequests.length, 2, 'City ticks never make automatic report requests');
  assert.equal(await evaluate('document.querySelector("#signal-content").dataset.stale'), 'true');
  assert.equal(await evaluate('Number(document.querySelector("#signal-content").dataset.snapshotTick)'), failedCapture);
  behavior = 'ai'; await button('#signal-retry'); await untilRequests(3);
  await until('document.querySelector("#signal-mode").dataset.mode==="ai"');
  assert.equal(apiRequests.at(-1).tick, failedCapture, 'Retry uses the captured snapshot, not the advanced city');
  assert.equal(apiRequests.at(-1).priorTick, null);
  assert.deepEqual(await evaluate('[...document.querySelectorAll("#signal-summary .signal-summary-link")].map(e=>({id:e.dataset.signalRef,text:e.textContent}))'), failedBody, 'Grounded deterministic summary survives transport recovery');
  assert.equal(await evaluate('document.querySelector("#signal-content").dataset.stale'), 'true');
  assert.deepEqual(await state(), advanced);
  checks.push('Failure retains local report; manual retry reuses the same capture after the city advances, with an explicit stale marker and no automatic tick calls');

  await button('#signal-refresh'); await untilRequests(4);
  await until('document.querySelector("#signal-mode").dataset.mode==="ai"');
  assert.deepEqual(apiRequests.at(-1), { tick: advanced.tick, priorTick: failedCapture, metrics: 9, behavior: 'ai' });
  assert.equal(await count('[data-signal-id^="trend."]'), 9);
  const comparison = await evaluate('Object.fromEntries([...document.querySelectorAll("[data-comparison-metric]")].map(e=>[e.dataset.comparisonMetric,{current:Number(e.dataset.current),prior:e.dataset.prior===""?null:Number(e.dataset.prior),delta:e.dataset.delta===""?null:Number(e.dataset.delta)}]))');
  const currentReport = buildLocalSignalReport({ schemaVersion: 1, locale: 'th', snapshot: {
    tick: advanced.tick, window: { startTick: failedCapture, endTick: advanced.tick },
    metrics: captureCitySignals(advanced).metrics,
    prior: { tick: fixture.tick, metrics: captureCitySignals(fixture).metrics },
  } });
  for (const metric of currentReport.data.metrics) {
    const prior = currentReport.data.priorMetrics.find(item => item.id === metric.id).value;
    assert.deepEqual(comparison[metric.id], { current: metric.value, prior, delta: metric.value - prior });
  }
  const comparisonText = await evaluate('document.querySelector("#signal-comparison").textContent');
  assert(comparisonText.includes(String(failedCapture)) && comparisonText.includes(String(advanced.tick)), 'Explicit start and end captures are visible');
  assert.match(comparisonText, /ยอด|วัน/);
  assert.equal(await evaluate('document.querySelector("#signal-content").dataset.stale'), 'false');
  await shot('desktop-summary.png');
  await button('[data-signal-id="trend.treasury"]>summary');
  const detail = await evaluate('document.querySelector(\'[data-signal-id="trend.treasury"]\').textContent');
  assert.match(detail, /treasury/); assert.match(detail, /฿/);
  assert(detail.includes(String(failedCapture)) && detail.includes(String(advanced.tick)));
  assert.equal(await evaluate('document.querySelector(\'[data-signal-id="trend.treasury"] .signal-technical\').open'), false, 'Technical references begin collapsed');
  assert(!await evaluate('document.querySelector(\'[data-signal-id="trend.treasury"] .signal-observation-detail>p\').textContent.includes("treasury")'), 'Plain Thai explanation keeps technical metric IDs in disclosure');
  assert.equal(await count('[data-missing-id^="missing.prior."]'), 0);
  assert.equal(await count('[data-missing-id^="missing.current."]'), 3, 'Unsupported values remain missing, not fabricated zeroes');
  assert.deepEqual(await state(), advanced);
  checks.push('Only two actually captured endpoints create nine comparisons and exact deltas/windows; Thai drill-down includes metric/signal references, units and numbers, with missing values explicit');

  await send('Emulation.setDeviceMetricsOverride', { width: 360, height: 780, screenWidth: 360, screenHeight: 780, deviceScaleFactor: 3, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 }); await paints();
  behavior = 'delay'; await button('#signal-refresh'); await untilRequests(5);
  assert.equal(await visible('#signal-cancel'), true);
  const mobile = await evaluate('(()=>{const p=document.querySelector("#inspector").getBoundingClientRect(),b=document.querySelector("#inspector-body");return{left:p.left,right:p.right,top:p.top,bottom:p.bottom,height:p.height,scrollWidth:b.scrollWidth,clientWidth:b.clientWidth,controls:["#signal-refresh","#signal-cancel"].map(s=>{const r=document.querySelector(s).getBoundingClientRect();return{selector:s,width:r.width,height:r.height}})}})()');
  assert(mobile.left >= 0 && mobile.right <= 361 && mobile.top >= 0 && mobile.bottom <= 781, 'S22 viewport contains drawer');
  assert(mobile.height >= 780 * .9 && mobile.scrollWidth <= mobile.clientWidth + 1, 'No horizontal overflow');
  assert(mobile.controls.every(control => control.width >= 44 && control.height >= 44), '44 CSS-pixel touch controls');
  await shot('s22-loading.png'); await button('#signal-cancel'); await releaseCancelled();
  behavior = 'invalid'; await button('#signal-refresh'); await untilRequests(6);
  await until('document.querySelector("#signal-mode").dataset.mode==="fallback"');
  assert.equal(await visible('#signal-retry'), true);
  assert(!await evaluate('document.querySelector("#signal-content").textContent.includes("signal.invented")'));
  const retryControl = await evaluate('(()=>{const r=document.querySelector("#signal-retry").getBoundingClientRect();return{width:r.width,height:r.height}})()');
  assert(retryControl.width >= 44 && retryControl.height >= 44);
  await shot('s22-fallback.png');
  behavior = 'ai'; await button('#signal-retry'); await untilRequests(7);
  await until('document.querySelector("#signal-mode").dataset.mode==="ai"');
  await button('#signal-comparison>summary');
  await shot('s22-comparison.png', '#signal-comparison');
  await button('[data-signal-id="threshold.net-flow-negative"]>summary');
  const flow = await evaluate('document.querySelector(\'[data-signal-id="threshold.net-flow-negative"]\').textContent');
  assert.match(flow, /incomePerTick/); assert.match(flow, /expensesPerTick/); assert.match(flow, /฿/);
  assert.equal(await evaluate('document.querySelector(\'[data-signal-id="threshold.net-flow-negative"] .signal-technical\').open'), false);
  assert(!await evaluate('/incomePerTick|expensesPerTick/.test(document.querySelector(\'[data-signal-id="threshold.net-flow-negative"] .signal-observation-detail>p\').textContent)'));
  await shot('s22-drilldown.png', '[data-signal-id="threshold.net-flow-negative"]');
  await button('[data-signal-id="threshold.net-flow-negative"] .signal-technical>summary');
  assert.equal(await evaluate('document.querySelector(\'[data-signal-id="threshold.net-flow-negative"] .signal-technical\').open'), true, 'Numbers and references remain available on demand');
  assert.deepEqual(await state(), advanced);
  checks.push('Galaxy S22 360×780 emulation: loading/cancel/fallback/retry controls are at least 44 CSS pixels; summaries, comparisons and numerical drill-down have no horizontal overflow or invented references');

  behavior = 'delay'; await button('#signal-refresh'); await untilRequests(8);
  await button('#close-inspector'); await releaseCancelled();
  assert.equal(await evaluate('document.querySelector("#inspector").dataset.open'), 'false');
  assert.notEqual(await evaluate('document.querySelector("#signal-mode").dataset.mode'), 'pending');
  await button('#toggle-game-menu'); await button('#load'); await button('#close-inspector');
  behavior = 'ai'; await openSignals(); await untilRequests(9);
  await until('document.querySelector("#signal-mode").dataset.mode==="ai"');
  assert.equal(apiRequests.at(-1).priorTick, null, 'Loading a city clears ephemeral comparison history');
  assert((await count('[data-missing-id^="missing.prior."]')) > 0);
  assert.equal(await count('[data-signal-id^="trend."]'), 0);
  assert.deepEqual(await state(), fixture);
  const fonts = [await readingFonts('s22-standard')];
  await send('Emulation.setDeviceMetricsOverride', { width: 980, height: 2120, screenWidth: 360, screenHeight: 780, deviceScaleFactor: 3, mobile: true });
  await until('innerWidth===980&&innerHeight===2120'); await paints();
  fonts.push(await readingFonts('s22-wide-layout'));
  assert(fonts[1].readerUnit > 2, 'Desktop website layout on a narrow physical screen scales reading unit');
  await shot('s22-wide-summary.png');
  assert.equal(apiRequests.length, 9, 'Viewport and reading changes never trigger API calls');
  assert.equal(providerAttempts, 0, 'No direct provider attempt from client');
  assert.equal(interceptionErrors.length, 0, `Interception errors: ${JSON.stringify(interceptionErrors)}`);
  assert.equal(errors.length, 0, `Browser errors: ${JSON.stringify(errors)}`);
  checks.push('Closing cancels pending work; city load resets comparison history; all nine explicit report requests intercepted, no provider call or simulation mutation');
  checks.push('S22 standard and 980px desktop-layout on screen360 have at least14 normalized font units for collapsed/expanded signal text, size ratio at most1.2 and three useful summary rows visible; technical references default collapsed');

  await mkdir(shots, { recursive: true });
  for (const capture of captures) await writeFile(resolve(shots, capture.name), capture.bytes);
  await writeFile(resolve(shots, 'qa.json'), JSON.stringify({ candidateCommit, testedAt: new Date().toISOString(), url, browser: 'installed Microsoft Edge headless', checks, mobile, fonts, mockedReportRequests: apiRequests, mockedPreflights: preflights, realApiRequests: 0, directProviderAttempts: providerAttempts, browserErrors: errors.length, screenshots: captures.map(item => item.name), deviceNote: 'Galaxy S22 CSS viewport/touch emulation, not a physical handset test.' }, null, 2) + '\n');
  console.log(JSON.stringify({ passed: checks.length, mockedReports: apiRequests.length, realApiRequests: 0, errors: errors.length, screenshots: captures.map(item => item.name) }));
} finally {
  if (ws?.readyState === WebSocket.OPEN) { try { await send('Browser.close'); } catch {} ws.close(); }
  child.kill();
  await Promise.race([new Promise(resolve => child.once('exit', resolve)), sleep(2000)]);
  // Preserve this task's bounded profile; no unrelated/shared files are cleaned.
}
