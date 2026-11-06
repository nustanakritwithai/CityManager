// Full-app, native-input plant upgrade acceptance. Synthetic loopback saves only.
// Run after npm run build: node --experimental-strip-types tests/plant-upgrade-smoke.mjs
// --preflight validates synthetic economic fixtures without claiming browser QA.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { inflateSync, deflateSync } from 'node:zlib';
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
// Four complete native upgrade flows, save/reload and eight blocked-plant checks.
// Hosted software rendering measured ~192s for one flow, including ~68s in PNG
// capture. Budget the whole scope; individual CDP/predicate limits stay 30s.
const suiteTimeoutMs = 20 * 60_000;
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
  console.log('Plant acceptance phase:', phase);
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
  for (const touch of [false, true]) {
    const rect = { x: 100, y: 200, width: 160, height: 44 }, events = [];
    for (let i = 0; i < 3; i++) {
      for (const type of touch ? ['touchstart', 'touchend'] : ['pointerdown', 'pointerup']) events.push({ type, onUpgrade: true, trusted: true, timestamp: events.length, disabled: i > 0, buttonRect: rect });
      if (!i) events.push({ type: 'click', onUpgrade: true, trusted: true, timestamp: events.length, disabled: false, buttonRect: rect, afterHandler: { disabled: true } });
    }
    const evidence = { events, beforeRect: rect, afterRect: rect, point: { x: 180, y: 222 }, timestampSpanMs: 6 };
    assertRapidBurst(evidence, touch);
    const enabledAfterClick = structuredClone(evidence); enabledAfterClick.events[3].disabled = false;
    assert.throws(() => assertRapidBurst(enabledAfterClick, touch), /Every native event handled after activation/, 'An enabled post-activation repeat must fail');
    const notDisabled = structuredClone(evidence); notDisabled.events.find(event => event.type === 'click').afterHandler.disabled = false;
    assert.throws(() => assertRapidBurst(notDisabled, touch), /immediately disables/, 'The production handler must demonstrably enter cooldown');
    assert.throws(() => assertRapidBurst({ ...evidence, events: [...events, { ...events[2] }] }, touch), /Only the first native activation/, 'A second native activation is never accepted');
    if (touch) {
      const delayedClick = { ...evidence, events: [...events.filter(event => event.type !== 'click').map(event => ({ ...event, disabled: false })), events[2]] };
      assertRapidBurst(delayedClick, true); // Three touch pairs precede their first compatibility click.
      assert.throws(() => assertRapidBurst({ ...delayedClick, events: [...delayedClick.events, events[2]] }, true), /Only the first native activation/);
    }
    assert.throws(() => assertRapidBurst({ ...evidence, afterRect: { ...rect, y: rect.y + 23 } }, touch), /keeps the upgrade button in place/, 'The observed water-row regression must fail');
    assert.throws(() => assertRapidBurst({ ...evidence, events: events.slice(0, 3) }, touch), /Three actual native presses/, 'A single activation cannot substitute for three native presses');
    const missed = structuredClone(evidence); missed.events[3].onUpgrade = false; missed.events[3].target = { id: 'plant-upgrade-reserve' };
    assert.throws(() => assertRapidBurst(missed, touch), /Three actual native presses/, 'All-target evidence retains and rejects a missed press');
  }
  const keys = repeatKeyCommands();
  assert.equal(keys.length, 8);
  assert.deepEqual(keys.map(([, params]) => [params.key, params.type, params.autoRepeat]), [['Enter', 'keyDown', true], ['Enter', 'keyDown', true], ['Enter', 'keyDown', true], ['Enter', 'keyUp', false], [' ', 'keyDown', true], [' ', 'keyDown', true], [' ', 'keyDown', true], [' ', 'keyUp', false]]);
  for (const [, params] of keys) {
    assert.equal(params.nativeVirtualKeyCode, params.windowsVirtualKeyCode);
    if (params.type === 'keyDown') {
      assert.equal(params.text, params.key === 'Enter' ? '\r' : ' ');
      assert.equal(params.unmodifiedText, params.text);
    } else assert.ok(!Object.hasOwn(params, 'text') && !Object.hasOwn(params, 'unmodifiedText'), 'Key release emits no character');
  }
  const beforeKey = { focused: true, disabled: false, visible: true };
  const repeatEvents = keys.map(([, params]) => ({ type: params.type === 'keyDown' ? 'keydown' : 'keyup', key: params.key, repeat: params.autoRepeat, trusted: true, defaultPrevented: params.type === 'keyDown', onUpgrade: true }));
  assertKeyboardTrace({ before: beforeKey, events: repeatEvents });
  assert.throws(() => assertKeyboardTrace({ before: beforeKey, events: repeatEvents.map(event => ({ ...event, defaultPrevented: false })) }), /Every held Enter\/Space/, 'Unprevented repeats are not accepted merely because the city happens to stay unchanged');
  for (const key of ['Enter', ' ']) {
    const events = [
      { type: 'keydown', key, repeat: false, trusted: true, defaultPrevented: false, onUpgrade: true },
      { type: 'keypress', key, repeat: false, trusted: true, defaultPrevented: false, onUpgrade: true },
      { type: 'click', trusted: true, detail: 0, onUpgrade: true },
      { type: 'keyup', key, trusted: true, onUpgrade: false },
    ];
    assertKeyboardTrace({ before: beforeKey, events }, key);
    assert.throws(() => assertKeyboardTrace({ before: beforeKey, events: events.filter(event => event.type !== 'click') }, key), /exactly one upgrade activation/, 'ACKed native keys without a default click must fail');
    assert.throws(() => assertKeyboardTrace({ before: { ...beforeKey, focused: false }, events }, key), /starts on the upgrade button/);
    assert.throws(() => assertKeyboardTrace({ before: beforeKey, events: events.map(event => ({ ...event, trusted: false })) }, key), /Only trusted/);
  }
  const observedKeys = [], keyAcks = [];
  const keysDone = queueNativeBurst(keys, (method, params) => { observedKeys.push([method, params]); return new Promise(resolve => keyAcks.push(resolve)); });
  assert.deepEqual(observedKeys, keys); for (const ack of keyAcks) ack(); await keysDone;
 const samplePng=(width,height,pixel)=>{const chunk=(type,data)=>{const out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);out.write(type,4);data.copy(out,8);return out;};const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=2;const raw=Buffer.alloc((width*3+1)*height);for(let y=0;y<height;y++)for(let x=0;x<width;x++)raw.set(pixel(x,y),y*(width*3+1)+1+x*3);return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);};
 const grayscale=pngEvidence(samplePng(16,16,x=>[x*17,x*17,x*17]));assert.equal(grayscale.nonblank,true);assert.equal(grayscale.quantizedColors,16,'Legitimate grayscale UI does not need game colors');
 assert.throws(()=>pngEvidence(samplePng(2,1,x=>x?[255,255,255]:[0,0,0])),/Blank/);
 assert.throws(()=>pngEvidence(samplePng(16,16,()=>[255,255,255])),/Blank/);
 // Exact failed Edge backing geometry: 373920 pixels gray243 +240480 white255.
 assert.throws(()=>pngEvidence(samplePng(960,640,(x,y)=>x<760&&y<492?[243,243,243]:[255,255,255])),/Blank/);
 assert.throws(()=>pngEvidence(Buffer.from('not PNG')));
 const captureTimeout=Object.assign(Error('capture timeout'),{cdpTimeoutMethod:'Page.captureScreenshot'});let calls=[],probes=0;const captureRecord={};
 const health={ready:true,contextLosses:0,width:960,height:640};const shot=await screenshotReadback(async(method,params)=>{calls.push(params);if(calls.length===1)throw captureTimeout;return {data:'real-result'};},async()=>{probes++;return health;},captureRecord);
 assert.equal(shot.data,'real-result');assert.equal(probes,2);assert.deepEqual(calls.map(p=>p.fromSurface),[true,true]);assert.deepEqual(calls[1].clip,{x:0,y:0,width:960,height:640,scale:1});assert.equal(captureRecord.mode,'surface-viewport');
 const other=Error('actual failure');await assert.rejects(screenshotReadback(async()=>{throw other;},async()=>health,{}),error=>error===other);
 let attempts=0;await assert.rejects(screenshotReadback(async()=>{attempts++;throw captureTimeout;},async()=>health,{}),error=>error===captureTimeout);assert.equal(attempts,2,'Exactly one bounded surface retry');
 let fallbackCalled=false;await assert.rejects(screenshotReadback(async()=>{if(fallbackCalled)assert.fail('must not retry after unhealthy probe');fallbackCalled=true;throw captureTimeout;},async()=>{if(fallbackCalled)throw other;return health;},{}),error=>error===captureTimeout&&error.stack.includes('Secondary capture health failure'));

  let successfulAttempts = 0; const successRecord = {};
  assert.equal((await screenshotReadback(async () => { successfulAttempts++; return { data: 'first-result' }; }, async () => health, successRecord)).data, 'first-result');
  assert.equal(successfulAttempts, 1); assert.equal(successRecord.mode, 'surface');
  assert.equal(calls[0].clip, undefined); assert.equal(calls[0].optimizeForSpeed, true); assert.equal(calls[1].optimizeForSpeed, true);
  assert.deepEqual(calls.map(params => params.captureBeyondViewport), [false, false], 'Neither readback may expand or crop beyond the live viewport');
  let unhealthyDispatches = 0;
  for (const bad of [{ ...health, ready: false }, { ...health, contextLosses: 1 }, { ...health, width: 0 }, { ...health, height: 1.5 }, { ...health, width: 16000001 }]) {
    await assert.rejects(screenshotReadback(async () => { unhealthyDispatches++; }, async () => bad, {}));
  }
  assert.equal(unhealthyDispatches, 0, 'Unhealthy primary probes cannot reach readback');
  let changedHealthAttempts = 0;
  await assert.rejects(screenshotReadback(async () => { changedHealthAttempts++; throw captureTimeout; }, async () => changedHealthAttempts ? { ...health, contextLosses: 1 } : health, {}), error => error === captureTimeout);
  assert.equal(changedHealthAttempts, 1, 'A context lost after timeout blocks the retry');

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
function assertStableRect(before, after, message) {
  for (const edge of ['x', 'y', 'width', 'height']) assert.ok(Number.isFinite(after?.[edge]) && Math.abs(after[edge] - before[edge]) <= 1, `${message}: ${edge}; ${JSON.stringify({ before, after })}`);
}
function assertRapidBurst(evidence, touch) {
  const { events, beforeRect, afterRect, point: p } = evidence;
  const pressType = touch ? 'touchstart' : 'pointerdown', releaseType = touch ? 'touchend' : 'pointerup';
  const native = events.filter(event => event.type === pressType || event.type === releaseType);
  const presses = native.filter(event => event.type === pressType && event.onUpgrade), releases = native.filter(event => event.type === releaseType && event.onUpgrade);
  // Observe every destination, including misses. Do not move the input to a
  // specially chosen overlap: the original visible button center must remain safe.
  assertStableRect(beforeRect, afterRect, 'L1→L2 keeps the upgrade button in place');
  for (const event of native) {
    assertStableRect(beforeRect, event.buttonRect, 'Upgrade button stays in place throughout the native burst');
    assert.ok(p.x >= event.buttonRect.x && p.x < event.buttonRect.x + event.buttonRect.width && p.y >= event.buttonRect.y && p.y < event.buttonRect.y + event.buttonRect.height, 'The original button center remains a hit target');
  }
  assert.equal(presses.length, 3, 'Three actual native presses reach the upgrade control');
  assert.equal(releases.length, 3, 'Three actual native releases reach the upgrade control');
  assert.ok(native.every(event => event.trusted && Number.isFinite(event.timestamp)), 'Browser records trusted native input timestamps');
  assert.ok(evidence.timestampSpanMs >= 0 && evidence.timestampSpanMs < 600, `Browser timestamps prove a rapid native burst: ${JSON.stringify(evidence)}`);
  assert.equal(presses[0].disabled, false, 'The initial native press can upgrade');
  const clicks = events.filter(event => event.onUpgrade && event.type === 'click');
  assert.equal(clicks.length, 1, 'Only the first native activation reaches the upgrade handler');
  assert.equal(clicks[0].trusted, true, 'The activation is a trusted browser compatibility click');
  assert.equal(clicks[0].afterHandler?.disabled, true, 'The real upgrade handler immediately disables its control');
  // Touch compatibility clicks can follow the entire native tap cluster. Their
  // timestamp refers to an earlier touchend, so use observed handler sequence.
  const afterActivation = events.slice(events.indexOf(clicks[0]) + 1).filter(event => event.type === pressType || event.type === releaseType);
  if (!touch) assert.equal(afterActivation.filter(event => event.type === pressType).length, 2, 'Desktop repeats exercise the live post-activation cooldown');
  assert.ok(afterActivation.every(event => event.disabled), 'Every native event handled after activation reaches a disabled control');
}
async function rapidUpgradeBurst(p, name) {
  stage(`${name}: rapid native upgrade burst`);
  await evaluate(`(()=>{
    const events=[], clicks=new Map(), types=['pointerdown','pointerup','touchstart','touchend','click'];
    const rect=()=>{const r=document.querySelector('#upgrade-plant').getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}};
    const beforeRect=rect();
    const record=event=>{
      const button=document.querySelector('#upgrade-plant'), target=event.target;
      const contact=event.changedTouches?.[0]??event;
      const entry={type:event.type,trusted:event.isTrusted,pointerType:event.pointerType??null,timestamp:event.timeStamp,handledAt:performance.now(),onUpgrade:!!target?.closest?.('#upgrade-plant'),target:{tag:target?.tagName,id:target?.id??null},x:contact.clientX,y:contact.clientY,buttonRect:rect(),disabled:button.disabled,detail:event.detail};
      events.push(entry);if(event.type==='click')clicks.set(event,entry);
    };
    const afterClick=event=>{const entry=clicks.get(event);if(entry?.onUpgrade)entry.afterHandler={disabled:document.querySelector('#upgrade-plant').disabled,handledAt:performance.now(),buttonRect:rect()}};
    for(const type of types)document.addEventListener(type,record,true);
    document.addEventListener('click',afterClick);
    window.__plantBurstTrace={events,beforeRect,rect,stop(){for(const type of types)document.removeEventListener(type,record,true);document.removeEventListener('click',afterClick)}};
  })()`);
  await queueNativeBurst(nativeBurstCommands(p.x, p.y, touchInput));
  await paints();
  const trace = await evaluate(`(()=>{const trace=window.__plantBurstTrace;trace.stop();delete window.__plantBurstTrace;return{events:trace.events,beforeRect:trace.beforeRect,afterRect:trace.rect()}})()`);
  const pressType = touchInput ? 'touchstart' : 'pointerdown', releaseType = touchInput ? 'touchend' : 'pointerup';
  const native = trace.events.filter(event => event.type === pressType || event.type === releaseType);
  const evidence = { name, input: touchInput ? 'touch' : 'mouse', point: { x: p.x, y: p.y }, timestampSpanMs: native.at(-1)?.timestamp - native[0]?.timestamp, handlerSpanMs: native.at(-1)?.handledAt - native[0]?.handledAt, ...trace };
  const activationIndex = trace.events.findIndex(event => event.type === 'click' && event.onUpgrade);
  evidence.pressesAfterActivation = activationIndex < 0 ? 0 : trace.events.slice(activationIndex + 1).filter(event => event.type === pressType && event.onUpgrade).length;
  evidence.repeatCoverage = touchInput && !evidence.pressesAfterActivation ? 'pre-activation native tap cluster' : `post-activation native ${touchInput ? 'tap' : 'click'} repeats`;
  bursts.push(evidence);
  assertRapidBurst(evidence, touchInput);
  return evidence;
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
async function cell(index, information = true) {
  await close(); await button('[data-tool="select"]');
  const p = await evaluate(`(async()=>{await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));const p=window.cityManager.cellScreen(${index});return{...p,hit:document.elementFromPoint(p.x,p.y)?.id}})()`);
  assert.equal(p.hit, 'city-canvas', `Canvas parcel ${index} is reachable`);
  await click(p.x, p.y);
  await until('document.querySelector("#inspector").dataset.open==="true" || !document.querySelector("#selection-actions").hidden');
  if (information && await evaluate('!document.querySelector("#selection-actions").hidden')) await button('#selection-actions button:nth-of-type(2)');
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
function keyCommand(key, { type = 'keyDown', autoRepeat = false } = {}) {
  const virtual = key === ' ' ? 32 : key === 'Enter' ? 13 : 27;
  const text = key === 'Enter' ? '\r' : key === ' ' ? ' ' : undefined;
  // CDP keyDown needs character text to perform native default activation,
  // not merely emit a keydown listener event. Never put text on keyUp.
  return ['Input.dispatchKeyEvent', { type, key, code: key === ' ' ? 'Space' : key, windowsVirtualKeyCode: virtual, nativeVirtualKeyCode: virtual, autoRepeat, ...(type === 'keyDown' && text !== undefined ? { text, unmodifiedText: text } : {}) }];
}
function pressKeyCommands(value) { return [keyCommand(value), keyCommand(value, { type: 'keyUp' })]; }
function repeatKeyCommands() { return ['Enter', ' '].flatMap(value => [...Array.from({ length: 3 }, () => keyCommand(value, { autoRepeat: true })), keyCommand(value, { type: 'keyUp' })]); }
async function pressKey(value) { await queueNativeBurst(pressKeyCommands(value)); }
function assertKeyboardTrace(trace, activateKey) {
  assert.equal(trace.before.focused, true, 'Native keyboard input starts on the upgrade button');
  assert.equal(trace.before.disabled, false, 'Keyboard test exercises an enabled upgrade');
  assert.equal(trace.before.visible, true, 'Keyboard target is visible');
  const downs = trace.events.filter(event => event.type === 'keydown'), ups = trace.events.filter(event => event.type === 'keyup');
  const clicks = trace.events.filter(event => event.type === 'click' && event.onUpgrade);
  assert.ok(trace.events.every(event => event.trusted), 'Only trusted browser key/default-click events are observed');
  if (activateKey !== undefined) {
    assert.deepEqual(downs.map(event => [event.key, event.repeat, event.onUpgrade, event.defaultPrevented]), [[activateKey, false, true, false]], 'A fresh native key-down reaches the focused button without cancellation');
    // Activating the button disables it and may blur focus before keyUp.
    assert.deepEqual(ups.map(event => event.key), [activateKey]);
    assert.equal(clicks.length, 1, 'Deliberate native keyboard input produces exactly one upgrade activation');
    assert.equal(clicks[0].detail, 0, 'Activation is the browser keyboard default, not a pointer click');
  } else {
    assert.deepEqual(downs.map(event => event.key), ['Enter', 'Enter', 'Enter', ' ', ' ', ' ']);
    assert.deepEqual(ups.map(event => event.key), ['Enter', ' ']);
    assert.ok(downs.every(event => event.onUpgrade && event.repeat && event.defaultPrevented), 'Every held Enter/Space key-down reaches the button and is prevented');
    assert.equal(clicks.length, 0, 'Prevented repeats produce no upgrade activation');
  }
}
async function keyboardInput(name, activateKey) {
  const before = await evaluate(`(()=>{
    const button=document.querySelector('#upgrade-plant');button.focus();
    const r=button.getBoundingClientRect(),before={focused:document.activeElement===button,disabled:button.disabled,visible:!!(r.width&&r.height)};
    const events=[],types=['keydown','keypress','keyup','click'];
    const record=event=>{
      const entry={type:event.type,key:event.key??null,repeat:event.repeat??false,trusted:event.isTrusted,defaultPrevented:event.defaultPrevented,detail:event.detail??null,onUpgrade:!!event.target?.closest?.('#upgrade-plant'),target:{tag:event.target?.tagName,id:event.target?.id??null},activeId:document.activeElement?.id??null,timestamp:event.timeStamp};
      events.push({entry,event});
    };
    for(const type of types)document.addEventListener(type,record,true);
    window.__plantKeyboardTrace={events,stop(){for(const type of types)document.removeEventListener(type,record,true)}};return before;
  })()`);
  const trace = { name, mode: activateKey === undefined ? 'held-repeats' : 'deliberate-activation', key: activateKey ?? null, before, events: [] };
  keyboardTraces.push(trace);
  assert.equal(before.focused, true, 'Focus setup reaches the native upgrade button');
  assert.equal(before.disabled, false, 'Native keyboard test starts with an enabled upgrade');
  await queueNativeBurst(activateKey === undefined ? repeatKeyCommands() : pressKeyCommands(activateKey));
  trace.events = await evaluate(`(()=>{const trace=window.__plantKeyboardTrace;trace.stop();delete window.__plantKeyboardTrace;return trace.events.map(({entry,event})=>({...entry,defaultPrevented:event.defaultPrevented}))})()`);
  assertKeyboardTrace(trace, activateKey);
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
async function quickSelectionFlow(metric) {
  stage(`${metric.name}: contextual selection`);
  const expected = await load(initial), plant = expected.plants[0];
  await cell(plant.cell, false);
  assert.equal(await evaluate('document.querySelector("#inspector").dataset.open'), 'false');
  assert.deepEqual(await state(), expected, 'Selection itself never charges');
  const target = await point('#selection-upgrade');
  const size = await evaluate('(()=>{const r=document.querySelector("#selection-upgrade").getBoundingClientRect();return {width:r.width,height:r.height}})()');
  assert.ok(size.width >= 44 && size.height >= 44);
  await screenshot(`${metric.name}-contextual-upgrade`);
  const before = expected.accounts.treasury;
  await queueNativeBurst(nativeBurstCommands(target.x, target.y, touchInput), send);
  assert.ok(upgradePlant(expected, plant.id, 1).ok);
  await assertUpgrade(expected, plant, 1, before);
  await until('!document.querySelector("#selection-upgrade").disabled');
  await button('#selection-actions button:nth-of-type(2)');
  await until('document.querySelector("#inspector").dataset.open==="true"');
  assert.deepEqual(await state(), expected, 'Information preserves state');
  await close(); await cell(plant.cell, false); await button('#selection-upgrade');
  assert.ok(upgradePlant(expected, plant.id, 2).ok);
  await until('document.querySelector("#selection-upgrade").disabled');
  assert.deepEqual(await state(), expected);
  await button('#selection-actions button:nth-of-type(3)');
  await until('document.querySelector("#selection-actions").hidden');
  await pressKey('Enter'); assert.deepEqual(await state(), expected);
  checks.push(`${metric.name}: native selection, 44px target, one-payment burst, info route, maximum and dismiss`);
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
    const burst = await rapidUpgradeBurst(p, `${metric.name}-${kind}`);
    assert.equal(upgradePlant(expected, plant.id, 1).ok, true);
    await assertUpgrade(expected, plant, 1, treasury);
    await until('!document.querySelector("#upgrade-plant").disabled');
    await quote(expected, plant); await layout(`${metric.name}-${kind}-L2`);
    stage(`${metric.name}-${kind}: held-key repeat guard`);
    // A held key remains a repeat even after the click cooldown expires. The
    // focus setup changes no game state; actual CDP key input tests the guard.
    await keyboardInput(`${metric.name}-${kind}-held-repeats`);
    assert.deepEqual(await state(), expected, 'Held-key repeats do not buy level 3');
    await screenshot(`${metric.name}-${kind}-level-2`);
    stage(`${metric.name}-${kind}: actionable close and selection guards`);
    // Exercise dismissal while L3 is still affordable and actionable, not just
    // at the maximum where a stale control would already be harmless.
    await close(); assert.equal(await evaluate('document.querySelector("#plant-actions").hidden'), true);
    await pressKey('Enter'); assert.deepEqual(await state(), expected);
    const empty = expected.cells.findIndex((parcel, index) => !parcel.road && !parcel.zone && parcel.building === null && !plantAt(expected, index) && access(expected, index));
    await cell(empty); assert.equal(await evaluate('document.querySelector("#plant-actions").hidden'), true);
    await pressKey('Enter'); assert.deepEqual(await state(), expected);
    await selectPlant(plant); assert.equal((await quote(expected, plant)).disabled, false);
    assert.equal(await evaluate('document.querySelector("#plant-feedback").textContent'), '', 'Selection change clears stale feedback');
    const secondTreasury = expected.accounts.treasury;
    stage(`${metric.name}-${kind}: deliberate level 3 upgrade`);
    if (kind === 'water') await keyboardInput(`${metric.name}-water-level-3`, metric.mobile ? ' ' : 'Enter');
    else await button('#upgrade-plant');
    assert.equal(upgradePlant(expected, plant.id, 2).ok, true);
    await assertUpgrade(expected, plant, 2, secondTreasury);
    assert.equal((await quote(expected, plant)).disabled, true, 'Maximum level disables upgrade');
    await screenshot(`${metric.name}-${kind}-level-3`);
    stage(`${metric.name}-${kind}: maximum-level and stale selection guards`);
    const max = await point('#upgrade-plant'); await click(max.x, max.y); await pressKey('Enter');
    assert.deepEqual(await state(), expected, 'Disabled maximum level refuses input');
    // Closing and changing selection must not leave an actionable stale plant.
    await close(); assert.equal(await evaluate('document.querySelector("#plant-actions").hidden'), true);
    await pressKey('Enter'); assert.deepEqual(await state(), expected);
    await cell(empty); assert.equal(await evaluate('document.querySelector("#plant-actions").hidden'), true);
    assert.deepEqual(await state(), expected);
    checks.push(`${metric.name} ${kind}: L1 quote, native ${metric.mobile ? 'touch' : 'mouse'} L2, ${burst.repeatCoverage}, held-key prevention, deliberate L3, exact payment/capacity, max/close/selection guards`);
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
      const p = await point('#upgrade-plant'); await click(p.x, p.y); await pressKey('Enter');
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
  const timeout = Error(`Plant browser acceptance timed out after ${suiteTimeoutMs}ms; phase=${diagnostics.phase}`);
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
    await quickSelectionFlow(metric);
    if (!process.argv.includes("--quick-selection")) await upgradeFlow(metric);
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
