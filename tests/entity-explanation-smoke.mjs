// Selected-entity UX uses intercepted reports only. Never contact the provider.
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createCity, step, serialize, deserialize, bulldoze, contributeOwnerCapital } from '../src/sim.ts';
import { SAVE_KEY } from '../src/save-storage.ts';
import { captureEntityExplanation, buildLocalEntityExplanation } from '../src/entity-explanation-data.ts';
import { buildLocalSignalReport } from '../src/signal-data.ts';
import { reachTouch } from './touch-reach.mjs';

const repo = fileURLToPath(new URL('..', import.meta.url));
const output = resolve(process.env.CITYMANAGER_ENTITY_ARTIFACTS || resolve(process.cwd(), '.test-output/entity-explanation'));
const profile = resolve(output, 'edge-profile'); assert(profile.startsWith(output + sep));
const url = process.env.CITYMANAGER_ENTITY_URL || 'http://127.0.0.1:4189/CityManager/';
assert.equal(new URL(url).hostname, '127.0.0.1', 'Mock suite targets this task’s loopback preview only');
const candidateCommit = process.env.CITYMANAGER_ENTITY_COMMIT || execFileSync('git', ['-c', `safe.directory=${repo.replaceAll('\\', '/')}`, '-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
assert.match(candidateCommit, /^[a-f0-9]{40}$/);
const port = 9364, checks = [], errors = [], interceptionErrors = [], requests = [], cityRequests = [], held = [], screenshots = [], captures = [], layouts = [];
let behavior = 'ai', directProviderAttempts = 0, ws, sequence = 0, currentStage = 'setup', lastCommand = null;
const pending = new Map(), sleep = ms => new Promise(r => setTimeout(r, ms));
const safePrefix = expression => /localStorage\.setItem|localStorage\.removeItem/.test(String(expression))
  ? 'localStorage fixture setup (<payload omitted>)'
  : String(expression).replace(/\s+/g, ' ').slice(0, 180);
function stage(name) { currentStage = name; console.log(`[entity QA] ${name}`); }
await mkdir(output, { recursive: true });
let occupied = false; try { occupied = (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(500) })).ok; } catch {}
assert.equal(occupied, false, 'Never reuse another browser or test profile');
const browser = spawn(process.env.CITYMANAGER_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-component-update', '--disable-gpu-shader-disk-cache', '--disk-cache-size=1048576', '--media-cache-size=1048576', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--window-size=1440,1000', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
async function send(method, params = {}, timeoutMs = 30000) {
  const id = ++sequence;
  const metadata = { method, startedAt: new Date().toISOString(), ...(method === 'Runtime.evaluate' ? { expressionPrefix: safePrefix(params.expression) } : {}) };
  lastCommand = metadata;
  const promise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      const error = Error(`CDP timeout ${method}${metadata.expressionPrefix ? `: ${metadata.expressionPrefix}` : ''}`);
      error.cdp = metadata; reject(error);
    }, timeoutMs);
    pending.set(id, { metadata, resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
  });
  ws.send(JSON.stringify({ id, method, params })); return promise;
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function until(expression) {
  for (let n = 0; n < 4500; n++) { if (await evaluate(expression)) return; await sleep(80); }
  throw Error(`Condition timeout ${expression}`);
}
async function waitRequests(expected) {
  for (let n = 0; n < 150 && requests.length < expected; n++) await sleep(50);
  assert.equal(requests.length, expected, 'Exactly one entity request per explicit capture/retry');
}
const paints = () => evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
const state = () => evaluate('(()=>{const c=JSON.parse(window.cityManager.snapshot());if(c.version!==19||c.rulesVersion!=="chain-14")throw new Error("Unexpected current save envelope");c.version=9;c.rulesVersion="chain-4";return c})()');
const mode = () => evaluate('document.querySelector("#entity-explain-mode").dataset.mode');
async function click(x, y) { for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: 1 }); await paints(); }
async function reveal(selector) {
  for (let n = 0; n < 8; n++) {
    const target = await evaluate(`(()=>{let e=document.querySelector(${JSON.stringify(selector)}),closed=[];for(let p=e?.parentElement;p;p=p.parentElement)if(p instanceof HTMLDetailsElement&&!p.open)closed.push(p);const s=closed.at(-1)?.querySelector(':scope>summary');if(!s)return null;s.scrollIntoView({block:'nearest',inline:'nearest'});const r=s.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    if (!target) return;
    await paints(); await click(target.x, target.y);
  }
  throw Error(`Too many hidden disclosure ancestors: ${selector}`);
}
async function button(selector) {
  if (await reachTouch(evaluate, button, selector)) return;
  await reveal(selector); await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest',inline:'nearest'})`); await paints();
  const p = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height,disabled:e.disabled}})()`);
  assert(p.w > 0 && p.h > 0 && !p.disabled, `Visible enabled ${selector}`);
  assert(await evaluate(`!!document.elementFromPoint(${p.x},${p.y})?.closest(${JSON.stringify(selector)})`), `Actual hit ${selector}`);
  await click(p.x, p.y);
}
async function close() { if (await evaluate('document.querySelector("#inspector").dataset.open==="true"')) await button('#close-inspector'); }
async function load(city) {
  await close(); await button('#toggle-game-menu');
  await evaluate(`localStorage.setItem(${JSON.stringify(SAVE_KEY)},${JSON.stringify(serialize(city))})`); await button('#load'); await close();
  assert.deepEqual(await state(), city, 'Load uses exact current-schema synthetic fixture');
}
async function selectBuilding(building) {
  await close(); await button('[data-tool="select"]'); await paints();
  const p = await evaluate(`window.cityManager.cellScreen(${building.cell})`);
  assert.equal(await evaluate(`document.elementFromPoint(${p.x},${p.y})?.id`), 'city-canvas', 'Selected parcel is actually hittable');
  await click(p.x, p.y);
  await until(`document.querySelector('#entity-content').dataset.scope==='place'&&document.querySelector('#entity-content').dataset.entityId==='${building.id}'`);
  await until('!!document.querySelector("#entity-explain-capture")');
}
async function selectHousehold(city, household) {
  const home = city.buildings.find(b => b.id === household.home); assert(home);
  await selectBuilding(home); await button(`#entity-content [data-household-id="${household.id}"]`);
  await until(`document.querySelector('#entity-content').dataset.scope==='household'&&document.querySelector('#entity-content').dataset.entityId==='${household.id}'`);
  return { kind: 'household', householdId: household.id, sourceBuildingId: home.id, sourceCell: home.cell };
}
async function capture(expectedCity, selection, expectedBehavior = 'ai') {
  behavior = expectedBehavior; const expected = captureEntityExplanation(expectedCity, selection); assert(expected);
  const count = requests.length; await button('#entity-explain-capture'); await waitRequests(count + 1);
  assert.deepEqual(requests.at(-1).input.snapshot, expected, 'Only bounded current entity facts, identity and accounting period are sent');
  assert.deepEqual(await state(), expectedCity, 'Capturing/asking does not mutate city, RNG, money, inventory or journals');
  if (expectedBehavior === 'ai') await until('document.querySelector("#entity-explain-mode").dataset.mode==="ai"');
  if (expectedBehavior === 'failure' || expectedBehavior.startsWith('invalid')) await until('document.querySelector("#entity-explain-mode").dataset.mode==="fallback"');
  return expected;
}
async function assertEvidence(snapshot) {
  const actual = await evaluate(`(()=>{const host=document.querySelector('#entity-explanation-host');return{facts:[...host.querySelectorAll('[data-entity-fact-id]')].map(e=>({id:e.dataset.entityFactId,value:Number(e.dataset.value),unit:e.dataset.unit,period:e.dataset.period})),missing:[...host.querySelectorAll('[data-entity-missing-id]')].map(e=>e.dataset.entityMissingId),refs:[...host.querySelectorAll('[data-entity-fact-refs]')].flatMap(e=>e.dataset.entityFactRefs.split(' ').filter(Boolean)),stamp:document.querySelector('#entity-explain-stamp').textContent,hypotheses:document.querySelector('#entity-explain-hypotheses h4').textContent,checks:document.querySelector('#entity-explain-checks h4').textContent}})()`);
  assert.deepEqual(actual.facts, snapshot.facts, 'Displayed optional evidence retains exact observed values, units and accounting periods');
  assert.deepEqual(actual.missing, snapshot.missing.map(item => item.id), 'Missing evidence remains explicit, without replacing absent facts by zero');
  const known = new Set([...snapshot.facts, ...snapshot.missing].map(item => item.id));
  assert(actual.refs.every(id => known.has(id)), 'Every displayed explanation reference belongs to this exact snapshot');
  assert(actual.stamp.includes(`#${snapshot.entity.id}`) && actual.stamp.includes(String(snapshot.tick)));
  if (!snapshot.window.empty) assert(actual.stamp.includes(`${snapshot.window.fromTick}–${snapshot.window.toTick}`), 'Cash period endpoints are explicit');
  assert.match(actual.hypotheses, /ข้อสันนิษฐาน/); assert.match(actual.checks, /ตรวจ/);
}
const responseHeaders = [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Access-Control-Allow-Methods', value: 'POST, OPTIONS' }, { name: 'Access-Control-Allow-Headers', value: 'Content-Type' }];
async function fulfill(item, kind = item.behavior) {
  const result = structuredClone(buildLocalEntityExplanation(item.input.snapshot)); result.mode = 'ai';
  if (kind === 'invalid-reference') result.report.observationIds = ['evidence.invented'];
  if (kind === 'invalid-identity') result.snapshot.snapshotKey += ':forged';
  await send('Fetch.fulfillRequest', { requestId: item.requestId, responseCode: kind === 'failure' ? 503 : 200, responseHeaders, body: Buffer.from(JSON.stringify(kind === 'failure' ? { error: 'mock_unavailable' } : result)).toString('base64') });
}
async function intercept(params) {
  if (/opentyphoon|\/chat\/completions/i.test(params.request.url)) { directProviderAttempts++; await send('Fetch.failRequest', { requestId: params.requestId, errorReason: 'BlockedByClient' }); return; }
  assert.equal(new URL(params.request.url).pathname, '/api/city-advisor/report');
  if (params.request.method === 'OPTIONS') { await send('Fetch.fulfillRequest', { requestId: params.requestId, responseCode: 204, responseHeaders }); return; }
  assert.equal(params.request.method, 'POST');
  assert(!Object.keys(params.request.headers).some(key => /^(cookie|authorization)$/i.test(key)), 'Public report request carries no browser credentials');
  const input = JSON.parse(params.request.postData);
  assert(!JSON.stringify(input).includes('TYPHOON_API_KEY'));
  if (input.schemaVersion === 1) {
    const response = buildLocalSignalReport(input); response.mode = 'ai'; cityRequests.push(input.snapshot.tick);
    await send('Fetch.fulfillRequest', { requestId: params.requestId, responseCode: 200, responseHeaders, body: Buffer.from(JSON.stringify(response)).toString('base64') }); return;
  }
  assert.equal(input.schemaVersion, 2); assert.equal(input.operation, 'entity-explanation'); assert.equal(input.locale, 'th');
  assert.deepEqual(Object.keys(input).sort(), ['locale', 'operation', 'schemaVersion', 'snapshot']);
  for (const forbidden of ['accounts', 'ledger', 'goodsLedger', 'cropLedger', 'households', 'firms', 'cells', 'resources', 'rng', 'wallet']) assert(!Object.hasOwn(input.snapshot, forbidden), `No full-save field ${forbidden}`);
  const item = { requestId: params.requestId, input, behavior }; requests.push(item);
  if (behavior === 'delay') held.push(item); else await fulfill(item);
}
async function lateResponses() {
  for (const item of held.splice(0)) {
    try { await fulfill(item, 'ai'); } catch (error) { assert.match(String(error), /Invalid InterceptionId|Invalid parameters|No resource|not found|Invalid Fetch request|Invalid requestId/i); }
  }
  await paints();
}
async function shot(name, selector = '#entity-explanation-host') {
  await reveal(selector); await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'start'})`); await paints();
  const data = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  captures.push({ name, bytes: Buffer.from(data.data, 'base64') }); screenshots.push(name);
}
async function layout(viewport) {
  await send('Emulation.setDeviceMetricsOverride', { ...viewport, deviceScaleFactor: 1, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
  await until(`innerWidth===${viewport.width}&&screen.width===${viewport.screenWidth}`); await paints();
  await evaluate('document.querySelector("#entity-explanation-host").scrollIntoView({block:"start"})'); await paints();
  const measured = await evaluate(`(()=>{const host=document.querySelector('#entity-explanation-host'),panel=document.querySelector('#inspector').getBoundingClientRect(),body=document.querySelector('#inspector-body'),k=Math.min(1,screen.width/innerWidth);const text=[...host.querySelectorAll('h3,h4,.entity-explain-row,button,summary')].filter(e=>e.getClientRects().length&&!e.closest('details:not([open])>:not(summary)'));return{width:innerWidth,height:innerHeight,screenWidth:screen.width,left:panel.left,right:panel.right,top:panel.top,bottom:panel.bottom,scrollWidth:body.scrollWidth,clientWidth:body.clientWidth,font:text.map(e=>({font:parseFloat(getComputedStyle(e).fontSize),physical:parseFloat(getComputedStyle(e).fontSize)*k,text:e.textContent.slice(0,60)})),controls:['#entity-explain-capture','#entity-explain-retry'].map(s=>document.querySelector(s)).filter(e=>e&&!e.hidden).map(e=>{const r=e.getBoundingClientRect();return{w:r.width*k,h:r.height*k}})}})()`);
  assert(measured.left >= 0 && measured.right <= measured.width + 1 && measured.top >= 0 && measured.bottom <= measured.height + 1, 'Drawer stays within phone viewport');
  assert(measured.scrollWidth <= measured.clientWidth + 1, 'No horizontal explanation overflow');
  assert(measured.font.length > 3 && measured.font.every(row => row.physical >= 13.5), `Readable 14px essential explanation type: ${JSON.stringify(measured)}`);
  assert(measured.controls.length && measured.controls.every(control => control.w >= 43.5 && control.h >= 43.5), '44px physical touch controls'); layouts.push(measured);
}

try {
  stage('1 browser startup and fixture');
  let targets; for (let n = 0; n < 100; n++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); break; } catch { await sleep(100); } }
  assert(targets?.some(target => target.type === 'page'));
  ws = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  ws.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) { const p = pending.get(message.id); pending.delete(message.id); message.error ? p.reject(Error(JSON.stringify(message.error))) : p.resolve(message.result); }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push('console.error');
    if (message.method === 'Fetch.requestPaused') void intercept(message.params).catch(error => { interceptionErrors.push(String(error)); void send('Fetch.failRequest', { requestId: message.params.requestId, errorReason: 'Aborted' }).catch(() => {}); });
  };
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  await send('Fetch.enable', { patterns: [{ urlPattern: '*://*/api/city-advisor/report*' }, { urlPattern: '*opentyphoon*' }, { urlPattern: '*/chat/completions*' }] });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, screenWidth: 1440, screenHeight: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: url + '?advanced=1&starter=1' }); await until('!!window.cityManager&&window.cityManager.visuals().ready'); // experimental features are off by default
  if (await evaluate('document.querySelector("#pause").getAttribute("aria-pressed")==="false"')) await button('#pause');
  const fixture = createCity(61025); for (let n = 0; n < 29; n++) step(fixture);
  const factory = fixture.buildings.find(b => b.zone === 'I'), house = fixture.buildings.find(b => b.zone === 'R'); assert(factory && house);
  const owner = fixture.firms.find(f => f.owner), household = fixture.households.find(h => h.id === owner?.owner?.householdId) || fixture.households.find(h => h.home !== null); assert(household);
  const buildingSelection = { kind: 'building', buildingId: factory.id };
  stage('2 normal building and household');
  await load(fixture); await selectBuilding(factory);
  assert.equal(requests.length, 0, 'Selecting a building never calls the model');
  const first = await capture(fixture, buildingSelection);
  assert.equal(await evaluate('document.querySelector("#entity-explanation-host").dataset.snapshotKey'), first.snapshotKey);
  assert.equal(await evaluate('Number(document.querySelector("#entity-explanation-host").dataset.entityId)'), factory.id);
  assert.equal(await evaluate('Number(document.querySelector("#entity-explanation-host").dataset.snapshotTick)'), fixture.tick);
  const copy = await evaluate('document.querySelector("#entity-explain-content").textContent');
  assert.match(copy, /[\u0e00-\u0e7f]/); assert(!copy.includes('evidence.invented'));
  await assertEvidence(first);
  await shot('entity-desktop-building.png');
  const householdSelection = await selectHousehold(fixture, household);
  assert.equal(requests.length, 1, 'Switching to household is also manual only');
  const homeCapture = await capture(fixture, householdSelection); assert.equal(homeCapture.entity.id, household.id);
  await assertEvidence(homeCapture);
  assert.deepEqual(await state(), fixture);
  checks.push('Native building and household inspectors capture only actual bounded identity/facts/periods; Thai explanations are read-only and requests are manual');

  stage('3 invalid response and stale-clock retry');
  await selectBuilding(factory);
  const invalid = await capture(fixture, buildingSelection, 'invalid-reference');
  assert(await evaluate('!document.querySelector("#entity-explain-retry").hidden'));
  assert(!await evaluate('document.querySelector("#entity-explain-content").textContent.includes("evidence.invented")'));
  const oldRequests = requests.length; await button('#pause'); await until(`JSON.parse(window.cityManager.snapshot()).tick>${fixture.tick+1}`); await button('#pause');
  const advanced = await state(); assert.equal(requests.length, oldRequests, 'No entity requests on daily ticks');
  await until('document.querySelector("#entity-explanation-host").dataset.stale==="true"');
  behavior = 'ai'; await button('#entity-explain-retry'); await waitRequests(oldRequests + 1); await until('document.querySelector("#entity-explain-mode").dataset.mode==="ai"');
  assert.deepEqual(requests.at(-1).input.snapshot, invalid, 'Retry resends the captured snapshot, not newer city data');
  assert.equal(await evaluate('document.querySelector("#entity-explanation-host").dataset.stale'), 'true'); assert.deepEqual(await state(), advanced);
  const forgedIdentity = await capture(advanced, buildingSelection, 'invalid-identity');
  assert.equal(await mode(), 'fallback'); assert.deepEqual(await state(), advanced);
  checks.push('Unknown references and forged snapshot identities fall back; daily clock changes mark stale without calls, and manual retry keeps the exact prior snapshot');

  stage('4 cancellation and stale selection');
  const current = await capture(advanced, buildingSelection, 'delay'); assert.equal(await mode(), 'pending');
  await button('#entity-explain-cancel'); await lateResponses(); assert.notEqual(await mode(), 'ai'); assert.notEqual(await mode(), 'pending'); assert.deepEqual(await state(), advanced);
  behavior = 'ai'; const countBeforeRetry = requests.length; await button('#entity-explain-retry'); await waitRequests(countBeforeRetry + 1); await until('document.querySelector("#entity-explain-mode").dataset.mode==="ai"');
  assert.deepEqual(requests.at(-1).input.snapshot, current);
  await capture(advanced, buildingSelection, 'delay');
  const other = advanced.buildings.find(b => b.id !== factory.id && b.zone === 'R'); assert(other);
  await selectBuilding(other); await lateResponses();
  assert.notEqual(await mode(), 'pending'); assert.equal(await evaluate('document.querySelector("#entity-explanation-host").dataset.snapshotKey'), '', 'New selection clears prior capture');
  assert.deepEqual(await state(), advanced);
  checks.push('Cancel ignores late replies and permits explicit same-snapshot retry; changing entity cancels and clears the old identity instead of applying its response');

  stage('5 city replacement and deletion');
  await selectBuilding(factory); await capture(advanced, buildingSelection, 'delay');
  await load(fixture); await selectBuilding(factory); await lateResponses();
  assert.equal(await evaluate('document.querySelector("#entity-explanation-host").dataset.snapshotKey'), '', 'Loading another city object clears even matching entity IDs');
  assert.deepEqual(await state(), fixture);
  await capture(fixture, buildingSelection, 'delay'); await close(); await button('[data-tool="bulldoze"]');
  const p = await evaluate(`window.cityManager.cellScreen(${factory.cell})`); assert.equal(await evaluate(`document.elementFromPoint(${p.x},${p.y})?.id`), 'city-canvas'); await click(p.x, p.y);
  const demolished = await state(), expected = deserialize(serialize(fixture)); assert.equal(bulldoze(expected, factory.cell).ok, true); assert.deepEqual(demolished, expected);
  await lateResponses(); assert.equal(await evaluate('document.querySelector("#entity-explanation-host").dataset.snapshotKey'), '');
  checks.push('City replacement and deletion discard pending entity replies; only a deliberate native test demolition changes the fixture');

  stage('6 same-day changed evidence');
  await load(fixture);
  const market = fixture.firms.find(f => f.owner), marketBuilding = fixture.buildings.find(b => b.id === market?.building); assert(market && marketBuilding);
  await selectBuilding(marketBuilding); const marketSelection = { kind: 'building', buildingId: marketBuilding.id };
  const beforeContribution = await capture(fixture, marketSelection, 'delay');
  const contributed = deserialize(serialize(fixture)); assert.equal(contributeOwnerCapital(contributed, market.id, 10000).ok, true);
  await button(`[data-owner-action="contribute"][data-firm-id="${market.id}"]`); assert.deepEqual(await state(), contributed);
  await until('document.querySelector("#entity-explanation-host").dataset.stale==="true"'); await lateResponses();
  assert.equal(await evaluate('document.querySelector("#entity-explanation-host").dataset.snapshotKey'), beforeContribution.snapshotKey, 'Same-tick change never relabels a captured response as current');
  assert.equal(await evaluate('document.querySelector("#entity-explanation-host").dataset.stale'), 'true');
  await capture(contributed, marketSelection, 'failure'); await shot('entity-fallback.png');
  assert.deepEqual(await state(), contributed);
  checks.push('Same-tick owner-capital changes mark captured evidence stale; later response keeps its captured identity and network failure retains local facts');

  stage('7 insufficient evidence');
  let insufficient;
  const young = createCity(61025);
  for (let n = 0; n < 35 && !insufficient; n++) {
    for (const building of young.buildings) {
      const snapshot = captureEntityExplanation(young, { kind: 'building', buildingId: building.id });
      if (snapshot?.missing.length) { insufficient = { city: deserialize(serialize(young)), building: { ...building }, snapshot }; break; }
    }
    if (!insufficient) step(young);
  }
  assert(insufficient, 'Actual early-game entity provides missing evidence, rather than fabricated test values');
  await load(insufficient.city); await selectBuilding(insufficient.building); const missingCapture = await capture(insufficient.city, { kind: 'building', buildingId: insufficient.building.id });
  assert(missingCapture.missing.length > 0); assert.deepEqual(missingCapture, insufficient.snapshot);
  await assertEvidence(missingCapture);
  assert(await evaluate('document.querySelector("#entity-explain-content").textContent.includes("ข้อมูล")'));
  await shot('entity-insufficient-evidence.png'); assert.deepEqual(await state(), insufficient.city);
  checks.push('Real early-game missing evidence is preserved in the exact request and displayed honestly instead of transmitting a fabricated full save or zero-filled values');

  stage('8 mobile layouts and preserved signal/facts');
  await load(fixture); const selection = await selectHousehold(fixture, household); await capture(fixture, selection);
  for (const viewport of [{ width: 360, height: 780, screenWidth: 360, screenHeight: 780 }, { width: 980, height: 2120, screenWidth: 360, screenHeight: 780 }]) {
    await layout(viewport); await shot(viewport.width === 980 ? 'entity-s22-wide.png' : 'entity-s22.png'); assert.deepEqual(await state(), fixture);
  }
  await close(); await button('#toggle-inspector'); await button('#open-signals'); await until('document.querySelector("#signal-mode").dataset.mode==="ai"');
  assert.equal(await evaluate('document.querySelectorAll("[data-signal-metric]").length'), 9, 'Existing city report contract is unchanged');
  await button('#city-fact-questions>summary');
  const beforeQuestion = await state(), entityCalls = requests.length, reportCalls = cityRequests.length; await button('#city-question-ask');
  assert.equal(await evaluate('document.querySelector("#city-question-answer").dataset.status'), 'observed');
  assert.equal(requests.length, entityCalls); assert.equal(cityRequests.length, reportCalls); assert.deepEqual(await state(), beforeQuestion);
  assert.equal(directProviderAttempts, 0); assert.equal(interceptionErrors.length, 0, JSON.stringify(interceptionErrors)); assert.equal(errors.length, 0, JSON.stringify(errors));
  checks.push('S22 normal/wide type and touch controls remain readable; existing city signals and local fact questions retain their no-extra-data behavior');
  for (const capture of captures) await writeFile(resolve(output, capture.name), capture.bytes);
  const qa = { candidateCommit, testedAt: new Date().toISOString(), url, browser: 'installed Microsoft Edge headless', checks, layouts, entityRequests: requests.map(item => ({ kind: item.input.snapshot.entity.kind, id: item.input.snapshot.entity.id, tick: item.input.snapshot.tick, facts: item.input.snapshot.facts.length, missing: item.input.snapshot.missing.length, behavior: item.behavior })), cityReports: cityRequests.length, realApiRequests: 0, directProviderAttempts, browserErrors: errors.length, screenshots, note: 'Synthetic local game fixtures, all reports intercepted; S22 viewport/touch/screen-ratio emulation, not a physical handset test. Timeout behavior is covered by the transport unit tests.' };
  await writeFile(resolve(output, 'qa.json'), JSON.stringify(qa, null, 2) + '\n');
  console.log(JSON.stringify({ passed: checks.length, entityRequests: requests.length, realApiRequests: 0, browserErrors: errors.length, screenshots, output }));
} catch (error) {
  const diagnostic = {
    candidateCommit, failedAt: new Date().toISOString(), stage: currentStage,
    safeFailure: error.code || error.name || 'Error', message: safePrefix(String(error.message).split('\n')[0]),
    command: error.cdp || lastCommand,
    pendingCommands: [...pending.values()].slice(0, 12).map(item => item.metadata),
    entityRequestCount: requests.length, cityReportCount: cityRequests.length,
    realApiRequests: 0, directProviderAttempts, browserErrors: errors.slice(0, 8).map(safePrefix),
    interceptionErrors: interceptionErrors.slice(0, 8).map(safePrefix),
    screenshot: 'not attempted',
  };
  await writeFile(resolve(output, 'failure-diagnostic.json'), JSON.stringify(diagnostic, null, 2) + '\n');
  if (ws?.readyState === WebSocket.OPEN) {
    try {
      const image = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, 3000);
      await writeFile(resolve(output, 'failure.png'), Buffer.from(image.data, 'base64')); diagnostic.screenshot = 'failure.png';
    } catch (captureError) { diagnostic.screenshot = `unavailable: ${safePrefix(captureError.message)}`; }
  }
  await writeFile(resolve(output, 'failure-diagnostic.json'), JSON.stringify(diagnostic, null, 2) + '\n');
  console.error(JSON.stringify({ stage: currentStage, failure: diagnostic.message, command: diagnostic.command, entityRequests: requests.length, cityReports: cityRequests.length, screenshot: diagnostic.screenshot }));
  // Keep CLI output bounded too: assertion actual/expected may contain a whole synthetic save.
  const reported = new Error(`[${currentStage}] ${diagnostic.message}`);
  reported.code = error.code || 'ENTITY_BROWSER_QA_FAILED'; throw reported;
} finally {
  if (ws?.readyState === WebSocket.OPEN) { try { await send('Browser.close', {}, 3000); } catch {} ws.close(); }
  browser.kill(); await Promise.race([new Promise(resolve => browser.once('exit', resolve)), sleep(2000)]);
  // Retain this task’s bounded evidence/profile; never clean shared data.
}
