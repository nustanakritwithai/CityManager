// Local game UI acceptance. Every report request is mocked; no provider calls or secrets.
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { isMarket, isRetail, createCity, step, serialize, housingCapacity, bulldoze, summary, firmWorkerCount } from '../src/sim.ts';
import { createCity as createCityV4, step as stepV4, serialize as serializeV4 } from '../src/legacy-v4.ts';
import { deserialize } from '../src/sim.ts';
import { SAVE_KEY } from '../src/save-storage.ts';
import { buildLocalSignalReport } from '../src/signal-data.ts';
import { reachTouch } from './touch-reach.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const workspaceOutput = resolve(root, '.test-output');
const output = resolve(root, process.env.CITYMANAGER_QUESTIONS_OUTPUT_DIR || process.env.CITYMANAGER_QUESTIONS_SCREENSHOT_DIR || '.test-output/city-questions');
assert(output.startsWith(workspaceOutput + sep), 'Question evidence must stay under this task .test-output');
const profile = resolve(output, 'edge-questions');
assert(profile.startsWith(output + sep));
const candidateCommit = process.env.CITYMANAGER_SIGNALS_COMMIT;
assert.match(candidateCommit || '', /^[a-f0-9]{40}$/, 'Set CITYMANAGER_SIGNALS_COMMIT to the exact tested source head');
const url = process.env.CITYMANAGER_QUESTIONS_URL || process.env.CITYMANAGER_CITY_QUESTIONS_URL || 'http://127.0.0.1:4188/CityManager/';
assert.equal(new URL(url).hostname, '127.0.0.1', 'Use only this task loopback preview with intercepted report mocks');
const debugPort = 9360;
const browser = process.env.CITYMANAGER_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
await mkdir(output, { recursive: true });
let occupied = false;
try { occupied = (await fetch(`http://127.0.0.1:${debugPort}/json/version`, { signal: AbortSignal.timeout(500) })).ok; } catch {}
assert.equal(occupied, false, 'Question QA owns CDP9360; never reuse another browser');
const child = spawn(browser, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-component-update', '--disable-gpu-shader-disk-cache', '--disk-cache-size=1048576', '--media-cache-size=1048576', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, '--window-size=1440,1000', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
const errors = [], checks = [], screenshots = [], reportRequests = [], measures = [];
let directProviderAttempts = 0, ws, sequence = 0;
const pending = new Map();
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
  for (let i = 0; i < 200; i++) { if (await evaluate(expression)) return; await sleep(80); }
  throw Error(`Condition timeout ${expression}`);
}
const paints = () => evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
const state = () => evaluate('(()=>{const c=JSON.parse(window.cityManager.snapshot());if(c.version===11||c.version===12||c.version===13||c.version===14){c.version=9;c.rulesVersion="chain-4"}return c})()');
async function button(selector) {
  if (await reachTouch(evaluate, button, selector)) return;
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest',inline:'nearest'})`); await paints();
  const point = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height,disabled:e.disabled}})()`);
  assert(point.w > 0 && point.h > 0 && !point.disabled, `Visible active control ${selector}`);
  assert.equal(await evaluate(`!!document.elementFromPoint(${point.x},${point.y})?.closest(${JSON.stringify(selector)})`), true, `Hit control ${selector}`);
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: point.x, y: point.y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: 1 });
  await paints();
}
async function choose(selector, value) {
  await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}))})()`); await paints();
}
async function openSignals() {
  if (await evaluate('document.querySelector("#inspector").dataset.open==="true"')) await button('#close-inspector');
  await button('#toggle-inspector'); await button('#open-signals');
  await until('document.querySelector("#inspector").dataset.page==="signals"');
}
async function openQuestions() {
  if (!await evaluate('document.querySelector("#city-fact-questions").open')) await button('#city-fact-questions>summary');
  await until('!!document.querySelector("#city-question-intent")');
}
async function loadCity(city) {
  if (await evaluate('document.querySelector("#inspector").dataset.open==="true"')) await button('#close-inspector');
  await button('#toggle-game-menu');
  await evaluate(`localStorage.removeItem(${JSON.stringify(SAVE_KEY)});localStorage.setItem(${JSON.stringify(SAVE_KEY)},${JSON.stringify(serialize(city))})`);
  await button('#load'); await button('#close-inspector'); await openSignals(); await openQuestions();
  assert.deepEqual(await state(), city, 'Loading preserves exact current-schema fixture');
}
async function ask(intent, entityId) {
  await choose('#city-question-intent', intent);
  if (entityId !== undefined) await choose('#city-question-entity', String(entityId));
  const before = await state(), calls = reportRequests.length;
  await button('#city-question-ask');
  assert.deepEqual(await state(), before, `Question ${intent} is read-only`);
  assert.equal(reportRequests.length, calls, `Question ${intent} sends no additional data`);
  assert.equal(await evaluate('document.querySelector("#city-question-answer").dataset.status'), 'observed');
  assert.equal(await evaluate('Number(document.querySelector("#city-question-answer").dataset.snapshotTick)'), before.tick);
}
async function expectFact(id, value, unit) {
  const selector = `[data-fact-id="${id}"]`;
  const actual = await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)});return r?{value:r.querySelector('.city-question-fact-value').textContent,id:r.querySelector('code').textContent,source:r.querySelector('.city-question-evidence').textContent}:null})()`);
  assert(actual, `Expected fact ${id}`);
  const formatted = typeof value === 'number' ? value.toLocaleString('th-TH', { maximumFractionDigits: 2 }) : value;
  assert.equal(actual.value, `${formatted}${unit ? ` ${unit}` : ''}`); assert.equal(actual.id, id); assert(actual.source.includes('ที่มา:'));
}
async function screenshot(name) {
  await evaluate('document.querySelector("#city-fact-questions").scrollIntoView({block:"start"})'); await paints();
  const data = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(resolve(output, name), Buffer.from(data.data, 'base64')); screenshots.push(name);
}
async function measureViewport(item) {
  await send('Emulation.setDeviceMetricsOverride', { ...item, deviceScaleFactor: 1, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 }); await paints();
  const measurement = await evaluate(`(()=>{const p=document.querySelector('#inspector').getBoundingClientRect(),b=document.querySelector('#inspector-body'),k=Math.min(1,screen.width/innerWidth),host=document.querySelector('#city-fact-question-content'),unit=parseFloat(getComputedStyle(host).getPropertyValue('--reader-unit'))||1;return{width:innerWidth,height:innerHeight,screenWidth:screen.width,k,unit,left:p.left,right:p.right,top:p.top,bottom:p.bottom,scrollWidth:b.scrollWidth,clientWidth:b.clientWidth,type:[...host.querySelectorAll('.city-question-form label,.city-question-form select,.city-question-form button,.city-question-fact-label')].filter(e=>e.getClientRects().length).map(e=>({tag:e.tagName,font:parseFloat(getComputedStyle(e).fontSize),text:e.textContent.slice(0,32)})),targets:[...host.querySelectorAll('.city-question-form select,.city-question-form button')].filter(e=>e.getClientRects().length).map(e=>{const r=e.getBoundingClientRect();return{width:r.width*k,height:r.height*k}})}})()`);
  assert(measurement.left >= -.5 && measurement.right <= measurement.width + .5 && measurement.top >= -.5 && measurement.bottom <= measurement.height + .5, 'Question drawer contained');
  assert(measurement.scrollWidth <= measurement.clientWidth + 1, 'Question surface has no horizontal overflow');
  assert(measurement.type.length > 0 && measurement.type.every(row => row.font >= 14 * measurement.unit - .5), 'Essential question type is at least14 reader units');
  assert(measurement.type.every(row => row.font * measurement.k >= 13.5), 'Essential type retains physical readability in wide-request emulation');
  assert(measurement.targets.every(row => row.width >= 43.5 && row.height >= 43.5), 'Question controls retain44px physical targets');
  measures.push({ name: item.width === 980 ? 's22-wide-request' : 's22-normal', ...measurement });
}
async function intercept(params) {
  const request = params.request;
  if (/opentyphoon/i.test(request.url)) { directProviderAttempts++; await send('Fetch.failRequest', { requestId: params.requestId, errorReason: 'Aborted' }); return; }
  assert.equal(new URL(request.url).pathname, '/api/city-advisor/report');
  const headers = [{ name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Access-Control-Allow-Headers', value: 'Content-Type' }, { name: 'Access-Control-Allow-Methods', value: 'POST, OPTIONS' }, { name: 'Content-Type', value: 'application/json' }];
  if (request.method === 'OPTIONS') { await send('Fetch.fulfillRequest', { requestId: params.requestId, responseCode: 204, responseHeaders: headers }); return; }
  assert.equal(request.method, 'POST');
  const body = JSON.parse(request.postData), local = buildLocalSignalReport(body); local.mode = 'ai';
  reportRequests.push({ snapshotTick: body.snapshot.tick, metricIds: body.snapshot.metrics.map(metric => metric.id) });
  assert(!Object.keys(request.headers).some(name => /authorization|cookie/i.test(name)), 'No browser credentials');
  await send('Fetch.fulfillRequest', { requestId: params.requestId, responseCode: 200, responseHeaders: headers, body: Buffer.from(JSON.stringify(local)).toString('base64') });
}

try {
  let targets;
  for (let i = 0; i < 100; i++) { try { targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json(); break; } catch { await sleep(100); } }
  assert(targets?.some(target => target.type === 'page'), 'Installed Edge started');
  ws = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  ws.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) { const handler = pending.get(message.id); pending.delete(message.id); message.error ? handler.reject(Error(JSON.stringify(message.error))) : handler.resolve(message.result); }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push('console.error');
    if (message.method === 'Fetch.requestPaused') void intercept(message.params).catch(error => { errors.push(error.message); void send('Fetch.failRequest', { requestId: message.params.requestId, errorReason: 'Aborted' }).catch(() => {}); });
  };
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  await send('Fetch.enable', { patterns: [{ urlPattern: '*/api/city-advisor/report', requestStage: 'Request' }, { urlPattern: '*opentyphoon*', requestStage: 'Request' }] });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, screenWidth: 1440, screenHeight: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: url + '?advanced=1&starter=1' }); await until('!!window.cityManager && window.cityManager.visuals().ready'); // experimental features are off by default
  if (await evaluate('document.querySelector("#pause").getAttribute("aria-pressed")==="false"')) await button('#pause');
  const fresh = createCity(61025); await loadCity(fresh);
  assert.equal(await evaluate('document.querySelector("#city-question-answer").dataset.status'), 'empty', 'Question section waits for explicit action');
  await choose('#city-question-intent', 'house.detail');
  assert.equal(await evaluate('document.querySelector("#city-question-ask").disabled'), true, 'No invented house when empty');
  await button('[data-speed="10"]'); await button('#pause');
  await until('JSON.parse(window.cityManager.snapshot()).buildings.some(b=>b.zone==="R")'); await button('#pause');
  const grown = await state();
  await until('!document.querySelector("#city-question-ask").disabled');
  const home = grown.buildings.find(item => item.zone === 'R');
  assert(await evaluate(`Array.from(document.querySelector('#city-question-entity').options).some(o=>o.value===${JSON.stringify(String(home.id))})`), 'House option updates on ordinary growth without city reload');
  await ask('house.detail', home.id);
  await expectFact('house.id', home.id, 'รหัส'); await expectFact('house.capacity-people', housingCapacity(home).persons, 'คน');
  checks.push('Empty entity selector becomes usable when actual houses grow on the same city object; no phantom entity or mutation');

  // Preserve real legacy-retail and market fact coverage beside the merged C taxonomy.
  const priorMature = createCityV4(61025); for (let n = 0; n < 90; n++) stepV4(priorMature);
  const mature = deserialize(serializeV4(priorMature));
  assert(mature.households.length > 0 && mature.firms.length > 0, 'Current deterministic fixture has actual households and establishments');
  await loadCity(mature);
  assert.equal(await evaluate('document.querySelector("#city-question-answer").dataset.status'), 'empty', 'City replacement clears previous answer');
  const house = mature.buildings.find(item => item.zone === 'R'), firm = mature.firms[0];
  await ask('city.housing');
  await expectFact('city.housing.population', mature.households.reduce((n, item) => n + item.members, 0), 'คน');
  await expectFact('city.housing.households', mature.households.length, 'ครัวเรือน');
  await expectFact('city.housing.buildings', mature.buildings.filter(item => item.zone === 'R').length, 'อาคาร');
  await ask('city.workforce');
  const workforce = summary(mature).workforce, employed = summary(mature).employed;
  await expectFact('city.workforce.total', workforce, 'คน'); await expectFact('city.workforce.employed', employed, 'คน'); await expectFact('city.workforce.unemployed', workforce - employed, 'คน');
  for (const skill of ['general', 'manufacturing', 'retail']) await expectFact(`city.workforce.skill.${skill}`, mature.households.reduce((n, item) => n + item.workerSkills[skill], 0), 'คน');
  await expectFact('city.workforce.legacy-assumed', mature.households.filter(item => item.skillSource === 'legacy-assumed').reduce((n, item) => n + item.workforce, 0), 'คน');
  assert(await evaluate('!!document.querySelector("[data-missing-id=\\"missing.city.workforce.education\\"]")'), 'Missing education is explicit rather than inferred from worker pools');
  await ask('city.businesses'); await expectFact('city.businesses.total', mature.firms.length, 'แห่ง'); await expectFact('city.businesses.workers', employed, 'คน');
  for (const [zone, fact] of [['C', 'commercial'], ['I', 'industrial'], ['F', 'farms']]) await expectFact(`city.businesses.${fact}`, mature.firms.filter(item => item.zone === zone).length, 'แห่ง');
  await expectFact('city.businesses.raw-markets', mature.firms.filter(isMarket).length, 'แห่ง');
  await ask('house.detail', house.id); await expectFact('house.occupied-people', mature.households.filter(item => item.home === house.id).reduce((n, item) => n + item.members, 0), 'คน');
  assert(mature.firms.some(item => item.zone === 'F') && mature.firms.some(item => isMarket(item)), 'The actual fixture includes agricultural and owner-operated market facts');
  for (const business of mature.firms) {
    await ask('business.detail', business.id);
    await expectFact('business.building', business.building, 'รหัส');
    await expectFact('business.zone', { C: 'พาณิชย์ (C)', I: 'อุตสาหกรรม (I)', F: 'ฟาร์ม (F)' }[business.zone], '');
    await expectFact('business.workers', firmWorkerCount(mature, business.id), 'คน');
    await expectFact('business.inventory', business.inventory, 'หน่วยสินค้า');
    if (isRetail(business)) {
      // Finished-goods retailers never hold crops; their answer intentionally omits crop facts.
      assert.equal(business.cropInventory, 0); assert.equal(business.cropCost, 0);
      const selector = '[data-fact-id="business.crop-inventory"],[data-fact-id="business.crop-cost"]';
      assert.equal(await evaluate(`document.querySelectorAll(${JSON.stringify(selector)}).length`), 0, 'Retail answer has no irrelevant or leaked crop facts');
    } else {
      await expectFact('business.crop-inventory', business.cropInventory, 'ล็อตพืชผล');
      await expectFact('business.crop-cost', business.cropCost, 'สตางค์');
    }
    if (isMarket(business) && business.owner !== null) await expectFact('business.owner-workers', mature.ownerLabor.filter(item => item.firmId === business.id).reduce((n, item) => n + item.workers, 0), 'คน');
  }
  await ask('business.detail', firm.id);
  await button('[data-fact-id="business.id"] .city-question-evidence>summary');
  assert(await evaluate(`document.querySelector('[data-fact-id="business.id"]').textContent.includes(${JSON.stringify(`firm:${firm.id}`)})`));
  checks.push('All5 supported local queries display actual current numeric facts, distinct firm/building IDs and evidence; no extra report request');
  await screenshot('desktop-city-facts.png');

  await ask('house.detail', house.id);
  await button('#close-inspector'); await openSignals(); await openQuestions();
  assert.equal(await evaluate('document.querySelector("#city-question-answer").dataset.status'), 'observed', 'Navigation alone does not clear a same-city captured answer');
  await expectFact('house.id', house.id, 'รหัส');
  await button('#close-inspector'); await button('[data-tool="bulldoze"]'); await paints();
  const mapPoint = await evaluate(`window.cityManager.cellScreen(${house.cell})`);
  assert.equal(await evaluate(`document.elementFromPoint(${mapPoint.x},${mapPoint.y})?.id`), 'city-canvas', 'Native input genuinely hits the selected house parcel');
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: mapPoint.x, y: mapPoint.y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: 1 });
  await paints();
  const removed = await state(), expectedRemoved = structuredClone(mature);
  assert.equal(bulldoze(expectedRemoved, house.cell).ok, true);
  assert.deepEqual(removed, expectedRemoved, 'Only the actual native demolition changes the same city, without a reload or clock advance');
  assert.equal(removed.tick, mature.tick, 'Entity removal occurs in the same paused day');
  assert(!removed.buildings.some(item => item.id === house.id));
  await openSignals(); await openQuestions();
  assert.equal(await evaluate('document.querySelector("#city-question-answer").dataset.status'), 'empty', 'Removing selected entity clears its captured answer');
  assert.equal(await evaluate('document.querySelector("#city-question-answer").dataset.snapshotTick'), '', 'Removed entity leaves no old answer stamp');
  assert.notEqual(await evaluate('document.querySelector("#city-question-entity").value'), String(house.id), 'Selector no longer offers the removed selected entity');
  assert.equal(await evaluate('document.querySelectorAll("#city-question-answer [data-fact-id]").length'), 0, 'Old entity facts are removed from the DOM, including hidden disclosures');
  assert.deepEqual(await state(), removed, 'Opening questions after removal is read-only');
  checks.push('Same-day native demolition clears a captured house answer and removed ID without city replacement; ordinary navigation preserves it');
  await button('[data-tool="select"]'); await loadCity(mature); await ask('business.detail', firm.id);

  const oldTick = mature.tick; await button('#pause'); await until(`JSON.parse(window.cityManager.snapshot()).tick>${oldTick}`); await button('#pause');
  await until('document.querySelector("#city-fact-question-content").dataset.stale==="true"');
  assert.equal(await evaluate('Number(document.querySelector("#city-question-answer").dataset.snapshotTick)'), oldTick, 'Clock does not rewrite a captured answer');
  assert(await evaluate('document.querySelector("#city-question-stale").textContent.includes("กดอ่านข้อเท็จจริง")'));
  await ask('city.housing');
  assert.equal(await evaluate('document.querySelector("#city-fact-question-content").dataset.stale'), 'false');
  checks.push('Clock marks a captured fact answer stale and explicit read captures the new day without imagined history');

  const displaced = createCity(61025); for (let n = 0; n < 90; n++) step(displaced);
  const occupiedHome = displaced.buildings.find(item => item.zone === 'R' && displaced.households.some(household => household.home === item.id)); assert(occupiedHome);
  assert.equal(bulldoze(displaced, occupiedHome.cell).ok, true); assert(displaced.households.some(item => item.home === null));
  await loadCity(displaced); await ask('city.housing');
  const unhoused = displaced.households.filter(item => item.home === null);
  await expectFact('city.housing.unhoused-households', unhoused.length, 'ครัวเรือน'); await expectFact('city.housing.unhoused-people', unhoused.reduce((n, item) => n + item.members, 0), 'คน');
  await expectFact('city.housing.population', displaced.households.reduce((n, item) => n + item.members, 0), 'คน');
  checks.push('Actual demolition-displaced households remain in population and use explicit home=null counts; loading resets old answers');

  const immutable = await state();
  for (const viewport of [{ width: 360, height: 780, screenWidth: 360, screenHeight: 780 }, { width: 980, height: 2120, screenWidth: 390, screenHeight: 844 }]) {
    await measureViewport(viewport); await screenshot(viewport.width === 980 ? 's22-wide-city-facts.png' : 's22-city-facts.png');
    await button('[data-fact-id="city.housing.population"] .city-question-evidence>summary');
    await button('.city-question-scope>summary');
    assert.deepEqual(await state(), immutable, 'Mobile disclosures do not mutate city');
  }
  checks.push('S22 normal and wide-request emulation retain readable essential text,44px controls, no horizontal overflow and read-only disclosures');
  assert.equal(directProviderAttempts, 0, 'Browser never attempts direct provider access');
  assert.equal(errors.length, 0, JSON.stringify(errors));
  const result = { candidateCommit, testedAt: new Date().toISOString(), url, browser: 'installed Microsoft Edge headless', saveVersion: displaced.version, checks, reportRequests, realApiRequests: 0, directProviderAttempts, browserErrors: errors.length, measures, screenshots, note: 'Local preview; all existing report requests intercepted by mock. Mobile viewport/physical-screen ratio emulation, not physical Galaxy S22 testing. No merge or deployment.' };
  await writeFile(resolve(output, 'qa.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ passed: checks.length, realApiRequests: 0, browserErrors: errors.length, screenshots, output }));
} finally {
  if (ws?.readyState === WebSocket.OPEN) { try { await send('Browser.close'); } catch {} ws.close(); }
  child.kill(); await Promise.race([new Promise(resolve => child.once('exit', resolve)), sleep(2000)]);
  // Retain only this task's bounded profile/evidence; do not clean shared data.
}
