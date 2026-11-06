// Full-app, native-input plant upgrade acceptance. Synthetic loopback saves only.
// Run after npm run build: node --experimental-strip-types tests/plant-upgrade-smoke.mjs
// --preflight validates synthetic economic fixtures without claiming browser QA.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { access, buildPlant, bulldoze, createCity, deserialize, plantAt, plantUpgradeStatus, serialize, upgradePlant, utilities } from '../src/sim.ts';
import { PLANT_LEVELS, plantLevel, plantUpgradeReason } from '../src/utilities.ts';
import { roadNeighborsFor } from '../src/road-topology.ts';
import { browserSnapshotState } from './browser-snapshot.ts';
import { startPersistenceFixture } from './persistence-server-fixture.mjs';
import { installTrafficNetworkFence, reachTrafficControl } from './traffic-server-entry-fixture.mjs';
import { loadPanelCity, panelEntryCity, saveAndReloadPanel } from './panel-ui-server.mjs';
import { isPanelProviderRequest, panelProviderDenials } from './panel-network-denies.mjs';

const output = resolve(process.env.CITYMANAGER_SCREENSHOT_DIR || '.test-output/plant-upgrades');
const appPort = 4397, debugPort = 9497, upstream = `http://127.0.0.1:${appPort}/CityManager/`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const checks = [], screenshots = [], layouts = [], bursts = [], errors = [], externalRequests = [], providerRequests = [], interceptionErrors = [];
const processLogs = { app: '', browser: '' };
const startedAt = Date.now(), diagnostics = { phase: 'setup', stages: [], cdp: [], renderers: [] };
let ws, sequence = 0, networkProbe, fixture, browser, app, touchInput = false;
let primaryFailure;
const pending = new Map();
function boundedPush(list, value, limit = 80) { list.push(value); if (list.length > limit) list.splice(0, list.length - limit); }
function stage(phase) {
  diagnostics.phase = phase; boundedPush(diagnostics.stages, { phase, elapsedMs: Date.now() - startedAt });
  console.log('Plant acceptance phase:', phase);
}
function resultReport(status, error) {
  return { status, date: new Date().toISOString(), elapsedMs: Date.now() - startedAt, ...(error ? { error: String(error.stack ?? error) } : {}), checks, screenshots, layouts, bursts, errors, interceptionErrors, externalRequests, providerRequests, processLogs, diagnostics, pendingCommands: [...pending.values()].map(item => ({ ...item.metadata, pendingMs: Date.now() - item.metadata.queuedAt })) };
}
function writeFailure(error, write = writeFileSync) {
  // Emergency watchdog output must be durable BEFORE process.exit, which skips
  // async catch/finally handlers. Also preserve an earlier assertion failure.
  write(resolve(output, 'report.json'), JSON.stringify(resultReport('failed', error), null, 2));
  write(resolve(output, 'processes.log'), JSON.stringify(processLogs, null, 2));
}

function fixtureCity() {
  const city = createCity(61025);
  for (const kind of ['power', 'water']) {
    const cell = city.cells.findIndex((parcel, index) => !parcel.road && !parcel.zone && parcel.building === null && !plantAt(city, index) && access(city, index));
    assert.equal(buildPlant(city, cell, kind).ok, true);
  }
  assert.deepEqual(deserialize(serialize(city)), city);
  return city;
}
const initial = fixtureCity();
const disconnected = structuredClone(initial);
for (const plant of disconnected.plants) for (const cell of roadNeighborsFor(disconnected, plant.cell)) {
  if (disconnected.cells[cell].road) assert.equal(bulldoze(disconnected, cell).ok, true);
}
const poor = structuredClone(initial), withdrawal = poor.accounts.treasury - 179_999;
poor.accounts.treasury -= withdrawal; poor.accounts.outside += withdrawal;
poor.ledger.push({ tick: poor.tick, from: 'treasury', to: 'outside', amount: withdrawal, reason: 'Synthetic fixture cash constraint' });
for (const city of [disconnected, poor]) assert.deepEqual(deserialize(serialize(city)), city);
if (process.argv.includes('--preflight')) {
  const city = panelEntryCity(serialize(initial)), before = city.accounts.treasury;
  for (const plant of city.plants) for (const level of [1, 2]) assert.equal(upgradePlant(city, plant.id, level).ok, true);
  assert.equal(city.accounts.treasury, before - 1_440_000);
  assert.deepEqual(deserialize(serialize(city)), city);
  for (const plant of disconnected.plants) assert.equal(plantUpgradeStatus(disconnected, plant.id).online, false);
  for (const plant of poor.plants) assert.ok(plantUpgradeStatus(poor, plant.id).reasons.length);
  for (const touch of [false, true]) {
    const single = nativeClickCommands(100, 200, touch, 1);
    assert.deepEqual(single.map(([, params]) => params.type), touch ? ['touchStart', 'touchEnd'] : ['mouseMoved', 'mousePressed', 'mouseReleased'], 'Ordinary native clicks retain their complete event sequence');
    if (!touch) assert.ok(single.every(([, params]) => params.x === 100 && params.y === 200 && params.clickCount === 1));
    const commands = nativeBurstCommands(100, 200, touch), observed = [], acknowledgements = [];
    const completed = queueNativeBurst(commands, (method, params) => {
      observed.push([method, params]);
      return new Promise(resolve => acknowledgements.push(resolve));
    });
    assert.deepEqual(observed, commands, 'Every native command is queued before any acknowledgement');
    assert.deepEqual(commands.map(([, params]) => params.type), touch ? ['touchStart', 'touchEnd', 'touchStart', 'touchEnd', 'touchStart', 'touchEnd'] : ['mouseMoved', 'mousePressed', 'mouseReleased', 'mousePressed', 'mouseReleased', 'mousePressed', 'mouseReleased']);
    assert.ok(commands.every(([, params]) => !Object.hasOwn(params, 'timestamp')), 'Browser supplies genuine input timestamps');
    for (const acknowledge of acknowledgements) acknowledge();
    await completed;
  }
  const log = []; for (let i = 0; i < 100; i++) boundedPush(log, { id: i });
  assert.equal(log.length, 80); assert.equal(log[0].id, 20);
  pending.set(-1, { metadata: { id: -1, method: 'Runtime.evaluate', phase: 'setup', queuedAt: Date.now() - 10 } });
  const emergency = new Map(); writeFailure(Error('synthetic watchdog'), (path, value) => emergency.set(path, value));
  pending.delete(-1);
  const failure = JSON.parse(emergency.get(resolve(output, 'report.json')));
  assert.equal(failure.status, 'failed'); assert.match(failure.error, /synthetic watchdog/);
  assert.equal(failure.diagnostics.phase, 'setup'); assert.equal(failure.pendingCommands[0].method, 'Runtime.evaluate');
  assert.ok(failure.pendingCommands[0].pendingMs >= 10, 'A nonresponsive browser needs no response for durable timeout evidence');
  assert.deepEqual(JSON.parse(emergency.get(resolve(output, 'processes.log'))), processLogs);
  console.log(JSON.stringify({ status: 'fixture-and-native-queue-preflight-passed', browser: 'not-run', plants: city.plants.map(plant => ({ kind: plant.kind, level: plantLevel(plant), cell: plant.cell })), treasuryAfterUpgrades: city.accounts.treasury }));
  process.exit(0);
}

async function send(method, params = {}) {
  const id = ++sequence, started = performance.now();
  const metadata = { id, method, phase: diagnostics.phase, queuedAt: Date.now(), ...(method === 'Runtime.evaluate' ? { expression: String(params.expression ?? '').slice(0, 200) } : {}), ...(params.type ? { inputType: params.type } : {}) };
  const response = new Promise((yes, no) => {
    let finished = false;
    const record = status => { if (finished) return; finished = true; boundedPush(diagnostics.cdp, { ...metadata, status, durationMs: Math.round(performance.now() - started) }); };
    const timer = setTimeout(() => { pending.delete(id); record('timeout'); no(Error(`CDP timeout: ${method}; phase=${metadata.phase}; expression=${metadata.expression ?? ''}`)); }, 30_000);
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
async function rapidUpgradeBurst(p, name) {
  stage(`${name}: rapid native upgrade burst`);
  await evaluate(`(()=>{
    const events=[], types=['pointerdown','pointerup','touchstart','touchend','click'];
    const record=event=>{
      const button=event.target?.closest?.('#upgrade-plant'); if(!button)return;
      events.push({type:event.type,trusted:event.isTrusted,pointerType:event.pointerType??null,timestamp:event.timeStamp,handledAt:performance.now(),disabled:button.disabled,detail:event.detail});
    };
    for(const type of types)document.addEventListener(type,record,true);
    window.__plantBurstTrace={events,stop(){for(const type of types)document.removeEventListener(type,record,true)}};
  })()`);
  await queueNativeBurst(nativeBurstCommands(p.x, p.y, touchInput));
  await paints();
  const events = await evaluate(`(()=>{const trace=window.__plantBurstTrace;trace.stop();delete window.__plantBurstTrace;return trace.events})()`);
  const pressType = touchInput ? 'touchstart' : 'pointerdown', releaseType = touchInput ? 'touchend' : 'pointerup';
  const presses = events.filter(event => event.type === pressType), releases = events.filter(event => event.type === releaseType);
  const native = events.filter(event => event.type === pressType || event.type === releaseType);
  const timestampSpanMs = native.at(-1)?.timestamp - native[0]?.timestamp;
  const evidence = { name, input: touchInput ? 'touch' : 'mouse', timestampSpanMs, handlerSpanMs: native.at(-1)?.handledAt - native[0]?.handledAt, events };
  bursts.push(evidence);
  assert.equal(presses.length, 3, 'Three actual native presses reach the upgrade control');
  assert.equal(releases.length, 3, 'Three actual native releases reach the upgrade control');
  assert.ok(native.every(event => event.trusted && Number.isFinite(event.timestamp)), 'Browser records trusted native input timestamps');
  assert.ok(timestampSpanMs >= 0 && timestampSpanMs < 600, `Browser timestamps prove a rapid native burst: ${JSON.stringify(evidence)}`);
  assert.equal(presses[0].disabled, false, 'The initial native press can upgrade');
  assert.ok(presses.slice(1).every(event => event.disabled), 'Repeated native presses arrive while the upgrade control is disabled');
  assert.equal(events.filter(event => event.type === 'click' && event.trusted).length, 1, 'Only the first native activation reaches the upgrade handler');
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
  await close(); await button('[data-tool="select"]'); await paints();
  const p = await evaluate(`window.cityManager.cellScreen(${index})`);
  assert.equal(await evaluate(`document.elementFromPoint(${p.x},${p.y})?.id`), 'city-canvas', `Canvas parcel ${index} is reachable`);
  await click(p.x, p.y);
  await until('document.querySelector("#inspector").dataset.open==="true"');
  await paints();
}
async function selectPlant(plant) {
  await cell(plant.cell);
  await until('!document.querySelector("#plant-actions").hidden');
  const expected = plant.kind === 'power' ? 'โรงไฟฟ้า' : 'โรงสูบน้ำ';
  assert.match(await evaluate('document.querySelector("#plant-actions h3").textContent'), new RegExp(expected));
}
async function screenshot(name) {
  stage(`capture ${name}`);
  const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const path = resolve(output, `${name}.png`); await writeFile(path, Buffer.from(result.data, 'base64')); screenshots.push(path);
}
async function load(city) {
  const raw = serialize(city);
  await loadPanelCity(fixture.fixture, raw, { send, evaluate, button, until, url: fixture.url + '?starter=1' });
  const renderer = await evaluate('(()=>{const a=window.cityManager.atmosphere();return{renderer:a.renderer,quality:a.quality,requestedQuality:a.settings.quality,shadows:a.shadows,postProcessing:a.postProcessing,width:innerWidth,height:innerHeight}})()');
  boundedPush(diagnostics.renderers, renderer, 16);
  await close(); return panelEntryCity(raw);
}
async function key(key, { type = 'keyDown', autoRepeat = false } = {}) {
  await send('Input.dispatchKeyEvent', { type, key, code: key === ' ' ? 'Space' : key, windowsVirtualKeyCode: key === ' ' ? 32 : key === 'Enter' ? 13 : 27, autoRepeat });
}
async function quote(city, plant) {
  const data = plantUpgradeStatus(city, plant.id), dom = await evaluate(`(()=>{const h=document.querySelector('#plant-actions'),b=document.querySelector('#upgrade-plant');return{title:h.querySelector('h3').textContent,quote:document.querySelector('#plant-upgrade-quote').textContent,reserve:document.querySelector('#plant-upgrade-reserve').textContent,button:b.textContent,disabled:b.disabled,reason:b.title}})()`);
  assert.match(dom.title, new RegExp(`ระดับ ${data.level}/3`));
  const money = amount => `฿${(amount / 100).toLocaleString('th-TH')}`;
  assert.ok(dom.quote.includes(String(data.current.capacity)) && dom.quote.includes(money(data.current.upkeep)));
  assert.ok(dom.reserve.includes(money(data.available)));
  if (data.next) {
    assert.ok(dom.quote.includes(`${data.current.capacity} → ${data.next.capacity}`));
    assert.ok(dom.quote.includes(`${money(data.current.upkeep)} → ${money(data.next.upkeep)}`));
    assert.ok(dom.button.includes(money(data.next.upgradeCost)));
    assert.ok(dom.button.includes(`ระดับ ${data.nextLevel}`));
  }
  assert.equal(dom.reason, data.reasons.join(' · '));
  return dom;
}
async function layout(name) {
  const value = await evaluate(`(()=>{const b=document.querySelector('#upgrade-plant'),h=document.querySelector('#plant-actions'),r=b.getBoundingClientRect();return{viewport:innerWidth,bodyWidth:document.documentElement.scrollWidth,buttonWidth:r.width,buttonHeight:r.height,hostWidth:h.clientWidth,hostScroll:h.scrollWidth,touch:navigator.maxTouchPoints>0}})()`);
  assert.ok(value.bodyWidth <= value.viewport + 1, `No document overflow: ${name}`);
  assert.ok(value.hostScroll <= value.hostWidth + 1, `No plant panel overflow: ${name}`);
  if (value.touch) assert.ok(value.buttonWidth >= 44 && value.buttonHeight >= 44, `44px phone upgrade target: ${JSON.stringify(value)}`);
  layouts.push({ name, ...value });
}
async function assertUpgrade(expected, plant, previous, beforeTreasury) {
  const current = await state(), actualPlant = current.plants.find(p => p.id === plant.id);
  assert.deepEqual(current, expected, 'Native upgrade matches entire independently replayed economic city');
  assert.equal(plantLevel(actualPlant), previous + 1);
  assert.equal(current.accounts.treasury, beforeTreasury - PLANT_LEVELS[plant.kind][previous].upgradeCost, 'Exactly one payment');
  assert.equal(utilities(current).plants[plant.kind], PLANT_LEVELS[plant.kind][previous].capacity, 'Real utility supply changes');
  assert.equal(current.ledger.filter(event => event.reason === plantUpgradeReason(plant.kind, plant.id, previous + 1)).length, 1, 'One upgrade receipt');
  assert.equal(actualPlant.cell, plant.cell, 'No extra parcel');
  assert.equal(current.plants.length, 2, 'No duplicate plant');
}
async function upgradeFlow(metric) {
  stage(`${metric.name}: load plant fixture`);
  let expected = await load(initial);
  for (const kind of ['power', 'water']) {
    stage(`${metric.name}-${kind}: select level 1 and inspect quote`);
    const plant = expected.plants.find(p => p.kind === kind);
    await selectPlant(plant); await quote(expected, plant); await layout(`${metric.name}-${kind}-L1`);
    await point('#upgrade-plant'); await screenshot(`${metric.name}-${kind}-level-1`);
    const p = await point('#upgrade-plant'), treasury = expected.accounts.treasury;
    await rapidUpgradeBurst(p, `${metric.name}-${kind}`);
    assert.equal(upgradePlant(expected, plant.id, 1).ok, true);
    await assertUpgrade(expected, plant, 1, treasury);
    await until('!document.querySelector("#upgrade-plant").disabled');
    await quote(expected, plant); await layout(`${metric.name}-${kind}-L2`);
    stage(`${metric.name}-${kind}: held-key repeat guard`);
    // A held key remains a repeat even after the click cooldown expires. The
    // focus setup changes no game state; actual CDP key input tests the guard.
    await evaluate('document.querySelector("#upgrade-plant").focus()');
    for (const value of ['Enter', ' ']) {
      for (let i = 0; i < 3; i++) await key(value, { autoRepeat: true });
      await key(value, { type: 'keyUp' });
    }
    assert.deepEqual(await state(), expected, 'Held-key repeats do not buy level 3');
    await screenshot(`${metric.name}-${kind}-level-2`);
    stage(`${metric.name}-${kind}: actionable close and selection guards`);
    // Exercise dismissal while L3 is still affordable and actionable, not just
    // at the maximum where a stale control would already be harmless.
    await close(); assert.equal(await evaluate('document.querySelector("#plant-actions").hidden'), true);
    await key('Enter'); await key('Enter', { type: 'keyUp' }); assert.deepEqual(await state(), expected);
    const empty = expected.cells.findIndex((parcel, index) => !parcel.road && !parcel.zone && parcel.building === null && !plantAt(expected, index) && access(expected, index));
    await cell(empty); assert.equal(await evaluate('document.querySelector("#plant-actions").hidden'), true);
    await key('Enter'); await key('Enter', { type: 'keyUp' }); assert.deepEqual(await state(), expected);
    await selectPlant(plant); assert.equal((await quote(expected, plant)).disabled, false);
    assert.equal(await evaluate('document.querySelector("#plant-feedback").textContent'), '', 'Selection change clears stale feedback');
    const secondTreasury = expected.accounts.treasury;
    stage(`${metric.name}-${kind}: deliberate level 3 upgrade`);
    if (kind === 'water') { await evaluate('document.querySelector("#upgrade-plant").focus()'); await key('Enter'); await key('Enter', { type: 'keyUp' }); }
    else await button('#upgrade-plant');
    assert.equal(upgradePlant(expected, plant.id, 2).ok, true);
    await assertUpgrade(expected, plant, 2, secondTreasury);
    assert.equal((await quote(expected, plant)).disabled, true, 'Maximum level disables upgrade');
    await screenshot(`${metric.name}-${kind}-level-3`);
    stage(`${metric.name}-${kind}: maximum-level and stale selection guards`);
    const max = await point('#upgrade-plant'); await click(max.x, max.y); await key('Enter'); await key('Enter', { type: 'keyUp' });
    assert.deepEqual(await state(), expected, 'Disabled maximum level refuses input');
    // Closing and changing selection must not leave an actionable stale plant.
    await close(); assert.equal(await evaluate('document.querySelector("#plant-actions").hidden'), true);
    await key('Enter'); await key('Enter', { type: 'keyUp' }); assert.deepEqual(await state(), expected);
    await cell(empty); assert.equal(await evaluate('document.querySelector("#plant-actions").hidden'), true);
    assert.deepEqual(await state(), expected);
    checks.push(`${metric.name} ${kind}: L1 quote, native ${metric.mobile ? 'touch' : 'mouse'} L2, repeat-${metric.mobile ? 'tap' : 'click'}/key protection, deliberate L3, exact payment/capacity, max/close/selection guards`);
  }
  stage(`${metric.name}: native Save and reload`);
  await close(); await button('#toggle-game-menu');
  await saveAndReloadPanel(fixture.fixture, expected, { send, evaluate, button, until });
  for (const plant of expected.plants) { await selectPlant(plant); assert.equal((await quote(expected, plant)).disabled, true); }
  checks.push(`${metric.name}: both L3 plants survive native Save and full reload with exact server ACK and complete city equality`);
  for (const [name, source] of [['disconnected', disconnected], ['insufficient-cash', poor]]) {
    stage(`${metric.name}: ${name} fixture`);
    expected = await load(source);
    for (const plant of expected.plants) {
      await selectPlant(plant); const dom = await quote(expected, plant);
      assert.equal(dom.disabled, true, name); assert.ok(dom.reason);
      const p = await point('#upgrade-plant'); await click(p.x, p.y); await key('Enter'); await key('Enter', { type: 'keyUp' });
      assert.deepEqual(await state(), expected, `${name} cannot spend or upgrade`);
      await layout(`${metric.name}-${plant.kind}-${name}`);
      if (plant.kind === 'power') await screenshot(`${metric.name}-${name}`);
    }
    checks.push(`${metric.name}: ${name} disables both plant upgrades without mutation`);
  }
}
await mkdir(output, { recursive: true });
for (const port of [appPort, debugPort]) {
  let occupied = false; try { occupied = (await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(500) })).status > 0; } catch {}
  assert.equal(occupied, false, `Dedicated QA port ${port} is occupied`);
}
const watchdog = setTimeout(() => {
  const timeout = Error(`Plant browser acceptance timed out after 360000ms; phase=${diagnostics.phase}`);
  diagnostics.watchdog = { elapsedMs: Date.now() - startedAt, phase: diagnostics.phase };
  try { writeFailure(primaryFailure ?? timeout); } catch (error) { console.error('Could not preserve watchdog evidence:', error); }
  console.error(timeout.message); browser?.kill(); app?.kill(); process.exit(1);
}, 360_000);
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
  await installTrafficNetworkFence({ send, evaluate, protocol: await (await fetch(`http://127.0.0.1:${debugPort}/json/protocol`)).json(), origin, additionalBlocked: panelProviderDenials(origin), observeProbe: url => (networkProbe = { url, active: false, requestId: null, failed: null }) });
  await fixture.fixture.install(send);
  for (const metric of [{ name: 'desktop', width: 1440, height: 1000, mobile: false }, { name: 'phone', width: 390, height: 844, mobile: true }]) {
    await send('Emulation.setDeviceMetricsOverride', { width: metric.width, height: metric.height, screenWidth: metric.width, screenHeight: metric.height, deviceScaleFactor: 1, mobile: metric.mobile });
    await send('Emulation.setTouchEmulationEnabled', { enabled: metric.mobile, maxTouchPoints: 2 });
    touchInput = metric.mobile;
    await upgradeFlow(metric);
    console.log(`${metric.name} plant acceptance passed`);
  }
  await fixture.fixture.assertNoCityWrites(evaluate);
  assert.deepEqual(errors, []); assert.deepEqual(interceptionErrors, []); assert.deepEqual(fixture.errors, []);
  assert.deepEqual(externalRequests, []); assert.deepEqual(providerRequests, []);
  const report = { ...resultReport('passed'), browser: (await send('Browser.getVersion')).product, note: 'Real full-app native CDP mouse, touchStart/touchEnd, and keyboard input with synthetic server service. Phone metrics/touch are emulated, not physical-device QA.' };
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} catch (error) {
  primaryFailure = error; writeFailure(error);
  if (ws?.readyState === 1) { try { await screenshot('failure'); console.error('DOM:', await evaluate('document.querySelector("#plant-actions")?.outerHTML')); } catch {} }
  writeFailure(error);
  console.error('Browser errors:', errors); throw error;
} finally {
  clearTimeout(watchdog);
  if (ws?.readyState === 1) { try { await send('Browser.close'); } catch {} ws.close(); }
  browser?.kill(); app?.kill(); if (fixture) await fixture.close();
  await writeFile(resolve(output, 'processes.log'), JSON.stringify(processLogs, null, 2));
}
