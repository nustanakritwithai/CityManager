// Small dependency-free CDP smoke test against the installed Microsoft Edge.
// Runs real browser/WebGL; emulated mobile metrics do not establish device QA.
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { access, createCity, step, buildPark, bulldoze, GATEWAY, deserialize, serialize, firmWorkerCount } from '../src/sim.ts';
import { PARK, PARK_STAFF } from '../src/parks.ts';
import { createParkRuntime, advanceParkRuntime, serializeParkSession } from '../src/park-runtime.ts';
import { reachTouch } from './touch-reach.mjs';
import { assertAdoptedCity, assertOriginalSave } from './education-adoption.mjs';

const legacyRaw = await readFile(new URL('./fixtures/legacy-v1-day65.json', import.meta.url), 'utf8'), legacy = JSON.parse(legacyRaw);
assert.equal(createHash('sha256').update(legacyRaw).digest('hex'), '4e358e66acdfb55dcfd434aaf67be51ccea99c69fc5a2b9b44343035c16166d0');
const fixture = deserialize(legacyRaw), fixtureJson = serialize(fixture);
assert.equal(fixture.version, 9);
for (const key of ['accounts', 'ledger', 'goodsLedger', 'goods']) assert.deepEqual(fixture[key], legacy[key]);
for (const key of ['seed', 'rng', 'tick', 'nextId']) assert.equal(fixture[key], legacy[key]);

/** Capture every intentionally intercepted request and settle the CDP response.
 * Rejections remain test failures; teardown cancellation is recorded separately. */
function createInterceptionTracker(dispatch, isClosing = () => false) {
  const records = [];
  return {
    handle(params) {
      const record = { requestId: params.requestId, url: params.request?.url ?? null, startedAt: Date.now(), status: 'pending' };
      records.push(record);
      let result; try { result = Promise.resolve(dispatch('Fetch.failRequest', { requestId: params.requestId, errorReason: 'Failed' })); }
      catch (error) { result = Promise.reject(error); }
      record.promise = result.then(() => { record.status = 'acknowledged'; record.finishedAt = Date.now(); }, error => {
        record.status = isClosing() ? 'cancelled-during-cleanup' : 'failed'; record.finishedAt = Date.now(); record.error = String(error);
        if (!isClosing()) console.error('Model interception CDP failure:', JSON.stringify({requestId:record.requestId,url:record.url,error:record.error}));
      });
    },
    async settle() {
      let count = 0; while (count < records.length) { const batch = records.slice(count); count += batch.length; await Promise.all(batch.map(r => r.promise)); }
      const failures = records.filter(r => r.status !== 'acknowledged');
      if (failures.length) throw Error(`Model interception did not complete: ${JSON.stringify(failures.map(({promise,...r}) => r))}`);
    },
    snapshot() { return records.map(({promise,...record}) => ({...record})); },
  };
}
// Deterministic protocol bookkeeping probe. It does not start Edge or change storage.
if (process.argv.includes('--intercept-preflight')) {
  const good = createInterceptionTracker(async () => ({})); good.handle({requestId:'ok',request:{url:'http://127.0.0.1/model.glb'}}); await good.settle();
  assert.equal(good.snapshot()[0].status,'acknowledged');
  const bad = createInterceptionTracker(async () => { throw Error('injected CDP failure'); }); bad.handle({requestId:'bad',request:{url:'http://127.0.0.1/bad.glb'}});
  await assert.rejects(() => bad.settle(),/injected CDP failure/); assert.equal(bad.snapshot()[0].status,'failed');
  let closing = false, rejectPending;
  const held = createInterceptionTracker(() => new Promise((_, reject) => { rejectPending = reject; }), () => closing);
  held.handle({requestId:'held',request:{url:'http://127.0.0.1/held.glb'}}); assert.equal(held.snapshot()[0].status,'pending');
  closing = true; rejectPending(Error('injected cleanup cancellation'));
  await assert.rejects(() => held.settle(),/cancelled-during-cleanup/); assert.equal(held.snapshot()[0].status,'cancelled-during-cleanup');
  console.log('Interception success/failure/pending-cleanup bookkeeping preflight passed'); process.exit(0);
}

const root = process.cwd(), output = resolve(root, '.test-output');
const screenshots = resolve(root, process.env.CITYMANAGER_SCREENSHOT_DIR || 'docs/screenshots');
const targetUrl = process.env.CITYMANAGER_URL || 'http://127.0.0.1:4173/CityManager/';
await mkdir(output, { recursive: true }); await mkdir(screenshots, { recursive: true });
const debugPort = Number(process.env.CITYMANAGER_DEBUG_PORT || 9349);
const edge = process.env.CITYMANAGER_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const softwareFlags = process.env.CITYMANAGER_SOFTWARE_WEBGL === '1' ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [];
// A fresh disposable profile isolates normal/fallback runs from prior autosaves.
const profile = await mkdtemp(resolve(output, `edge-profile-${debugPort}-`));
const child = spawn(edge, ['--headless=new', ...softwareFlags, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-component-update', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, '--window-size=1440,1000', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
let ws, sequence = 0, closing = false; const pending = new Map(); const errors = []; const expectedAssetErrors = []; const checks = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function send(method, params = {}) {
  const id = ++sequence;
  const result = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method} ${String(params.expression ?? '').slice(0, 160)}`)); }, 60000);
    const finish = fn => value => { clearTimeout(timer); pending.delete(id); fn(value); };
    pending.set(id, { method, startedAt: Date.now(), resolve: finish(resolve), reject: finish(reject) });
    try { ws.send(JSON.stringify({ id, method, params })); } catch (error) { pending.get(id)?.reject(error); }
  });
  return result;
}
const interceptions = createInterceptionTracker(send, () => closing);
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
}
async function until(expression, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (await evaluate(expression)) return; await sleep(100); }
  throw new Error(`Condition timed out: ${expression}`);
}
const state = async () => await evaluate('(()=>{const c=JSON.parse(window.cityManager.snapshot());if(!((c.version===19&&c.rulesVersion==="chain-14")||(c.version===22&&c.rulesVersion==="chain-17")))throw new Error("Unexpected current save envelope");c.version=9;c.rulesVersion="chain-4";return c})()');
const text = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).textContent`);
const paused = () => evaluate('document.querySelector("#pause").getAttribute("aria-pressed")==="true"');
async function game() {
  if (await evaluate('document.querySelector("#inspector").dataset.open!=="true"||document.querySelector("#inspector").dataset.page!=="game"')) { await closeInspector(); await button('#toggle-game-menu'); }
  await until('document.querySelector("#inspector").dataset.page==="game"&&document.querySelector("#inspector").dataset.open==="true"');
}
async function closeInspector() {
  if (await evaluate('document.querySelector("#inspector").dataset.open==="true"')) await button('#close-inspector');
  await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
}
async function clickAt(x, y) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}
async function button(selector) {
  if (await reachTouch(evaluate, button, selector)) return;
  const p = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'nearest',inline:'nearest'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await clickAt(p.x, p.y);
}
const cellPoint = index => evaluate(`window.cityManager.cellScreen(${index})`);
async function cell(index) { const p = await cellPoint(index); await clickAt(p.x, p.y); }
async function key(key, code = key) {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: key === 'Escape' ? 27 : key === ' ' ? 32 : undefined });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: key === 'Escape' ? 27 : key === ' ' ? 32 : undefined });
}
async function screenshot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(resolve(screenshots, name), Buffer.from(r.data, 'base64'));
}
try {
  let targets;
  for (let i = 0; i < 100; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json(); break; } catch { await sleep(100); }
  }
  assert.ok(targets?.length, 'Installed Edge started');
  ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) { const p = pending.get(message.id); pending.delete(message.id); message.error ? p.reject(new Error(JSON.stringify(message.error))) : p.resolve(message.result); }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      const args = message.params.args;
      const deliberatelyBlocked = process.env.CITYMANAGER_BLOCK_MODELS === '1' && args.length === 2 &&
        /^Failed to load resource \[\/CityManager\/assets\/kenney-city\/models\/([a-z]+(?:-[a-z]+)?)\.glb-container\]: Network error$/.test(args[0]?.value) && args[1]?.value === 'Network error';
      (deliberatelyBlocked ? expectedAssetErrors : errors).push(args);
    }
    if (message.method === 'Fetch.requestPaused') interceptions.handle(message.params);
  };
  await send('Runtime.enable'); await send('Page.enable');
  if (process.env.CITYMANAGER_BLOCK_MODELS === '1') await send('Fetch.enable', { patterns: [{ urlPattern: '*kenney-city/models/*.glb', requestStage: 'Request' }] });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: targetUrl + '?starter=1' });
  console.log('Edge navigated; awaiting game startup');
  await until('!!window.cityManager');
  console.log('Game started; awaiting admitted models');
  await until('window.cityManager.visuals().ready');
  if (process.env.CITYMANAGER_BLOCK_MODELS === '1') await interceptions.settle();
  const visualStatus = await evaluate('window.cityManager.visuals()');
  if (process.env.CITYMANAGER_BLOCK_MODELS === '1') assert.equal(visualStatus.failed.length, 41);
  else assert.equal(visualStatus.loaded.length, 41);
  assert.equal(await evaluate('window.cityManager.engine'), 'PlayCanvas 2.23.3');
  await button('#pause'); assert.equal(await paused(), true);
  checks.push('Real Edge WebGL2 startup and pause');
  console.log('Edge WebGL startup, models and pause passed');
  const groundState = await evaluate('window.cityManager.ground()');
  assert.equal(groundState.buildGrid, false, 'Observation starts without the construction grid');
  assert.equal(groundState.textureSize, 512); assert.equal(groundState.textureCount, 3);
  const beforeGridTools = await state();
  for (const tool of ['road', 'R', 'C', 'I', 'F', 'park', 'bulldoze', 'select']) {
    await button(`[data-tool="${tool}"]`);
    assert.equal((await evaluate('window.cityManager.ground()')).buildGrid, tool !== 'select', `Grid follows ${tool} mode`);
  }
  assert.deepEqual(await state(), beforeGridTools, 'Ground and grid modes never mutate the city');
  checks.push('Original bounded ground textures and construction-only grid do not mutate simulation');
  // Preserve a deterministic, paused baseline through the public Save control.
  await game(); await button('#save'); const saved = await state();
  assert.match(await text('#status'), /Saved day/);
  await button('#new-city'); await button('dialog button:first-of-type');
  await button('#new-city'); await key('Escape');
  assert.equal(await evaluate('!!document.querySelector("dialog[open]")'), false);
  assert.deepEqual(await state(), saved); checks.push('Game-menu new-city cancel and Escape keep state'); await closeInspector();
  await button('[data-speed="3"]');
  assert.equal(await evaluate(`document.querySelector('[data-speed="3"]').getAttribute('aria-pressed')`), 'true');
  await button('[data-speed="1"]');
  await button('[data-tool="road"]'); await cell(12 * 24 + 11); await button('#cancel-tool');
  assert.match(await text('#status'), /start cancelled/i);
  await button('#cancel-tool'); assert.equal(await evaluate('document.querySelector("[data-tool=select]").getAttribute("aria-pressed")'), 'true');
  assert.deepEqual(await state(), saved); checks.push('Two-stage road cancel has no simulation mutation');
  // Existing road twice: no charge; tool repeated use stays active.
  await button('[data-tool="road"]'); await cell(12 * 24 + 3); await cell(12 * 24 + 5);
  assert.match(await text('#status'), /มีถนนอยู่แล้ว ไม่เสียเงิน/); assert.equal((await state()).accounts.treasury, saved.accounts.treasury);
  await cell(12 * 24 + 3); await cell(12 * 24 + 5); assert.equal((await state()).accounts.treasury, saved.accounts.treasury);
  checks.push('Repeated road use does not duplicate cost');
  // The visual preview opens on the starter district. Back out for construction
  // on the far side, as a player would, and keep the inspector off the gesture.
  if (await evaluate('document.querySelector("#inspector").dataset.open==="true"')) await button('#close-inspector');
  await button('[data-camera="zoom-out"]'); await button('[data-camera="zoom-out"]');
  await cell(12 * 24 + 11); const beforeEscapeDrag = await state();
  if (await evaluate('document.querySelector("#inspector").dataset.open==="true"')) await button('#close-inspector');
  const escA = await cellPoint(16 * 24 + 12), escB = await cellPoint(16 * 24 + 15);
  for (const p of [escA, escB]) assert.equal(await evaluate(`document.elementFromPoint(${p.x},${p.y})?.id`), 'city-canvas', 'Road gesture endpoints are visible on the canvas');
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: escA.x, y: escA.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: escB.x, y: escB.y, button: 'left', buttons: 1 });
  await key('Escape');
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: escB.x, y: escB.y, button: 'left', clickCount: 1 });
  assert.deepEqual(await state(), beforeEscapeDrag); checks.push('Escape during anchored road drag prevents construction on release');
  // Drag an isolated road away from HUD overlays, then zone next to it.
  const a = await cellPoint(16 * 24 + 12), b = await cellPoint(16 * 24 + 15);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: a.x, y: a.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: b.x, y: b.y, button: 'left', buttons: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.x, y: b.y, button: 'left', clickCount: 1 });
  assert.equal((await state()).cells[16 * 24 + 14].road, true);
  await button('[data-tool="R"]'); await cell(15 * 24 + 14);
  await button('[data-tool="C"]'); await cell(15 * 24 + 13);
  await button('[data-tool="I"]'); await cell(15 * 24 + 12);
  assert.equal((await state()).cells[15 * 24 + 13].zone, 'C');
  assert.equal((await state()).cells[15 * 24 + 12].zone, 'I');
  await button('[data-tool="bulldoze"]'); await cell(15 * 24 + 12); await cell(15 * 24 + 12);
  assert.equal((await state()).cells[15 * 24 + 12].zone, null);
  checks.push('R/C/I zoning and repeat-safe bulldoze');
  await button('[data-tool="select"]'); await cell(15 * 24 + 14);
  assert.match(await text('#explanation'), /ยังไม่มีถนนข้างแปลงที่เชื่อมถึงประตูภายนอก/);
  await screenshot('desktop-disconnected.png'); checks.push('Drag road, zoning, picking and disconnected explanation');
  await game(); await button('#load'); assert.deepEqual(await state(), saved); assert.equal(await paused(), true); await closeInspector();
  checks.push('Save/load round trip restores exact paused simulation');
  const parkCell = 16 * 24 + 12, beforePark = await state();
  assert.equal(access(beforePark, parkCell), false, 'test garden is isolated from roads');
  await button('[data-tool="park"]'); await cell(parkCell);
  const withPark = await state();
  assert.equal(withPark.parks.length, beforePark.parks.length + 1);
  assert.deepEqual(withPark.cells, beforePark.cells, 'no neighbouring or zoned cells are changed');
  assert.equal(withPark.accounts.treasury, beforePark.accounts.treasury - PARK.cost);
  await cell(parkCell); assert.deepEqual(await state(), withPark, 'duplicate click cannot charge again');
  await button('[data-tool="select"]'); await cell(parkCell);
  assert.match(await text('#selection-title'), /สวนสาธารณะ/);
  assert.match(await text('#place-tags'), /ไม่ต้องติดถนน/);
  assert.doesNotMatch(await text('#explanation'), /ต้องเชื่อมถนน|เครือข่ายไม่พอ|ยังไม่มีโซน/);
  await screenshot('desktop-park.png');
  await game(); await button('#save'); await closeInspector();
  await button('[data-tool="bulldoze"]'); await cell(parkCell);
  const removedPark = await state(); assert.equal(removedPark.parks.length, beforePark.parks.length);
  assert.equal(removedPark.accounts.treasury, withPark.accounts.treasury - 2000);
  await cell(parkCell); assert.deepEqual((await state()).accounts, removedPark.accounts);
  await game(); await button('#load'); assert.deepEqual(await state(), withPark);
  await closeInspector(); await button('[data-tool="select"]');
  checks.push('Off-road one-cell park: real UI construction, duplicate click, detail, save, demolition and load');
  const staffFixture = createCity(61025);
  for (let day = 0; day < 45; day++) step(staffFixture);
  for (let i = 0; i < staffFixture.cells.length; i++) if (staffFixture.cells[i].road && i !== GATEWAY) bulldoze(staffFixture, i);
  buildPark(staffFixture, parkCell);
  await game(); await evaluate('localStorage.setItem("citymanager.save.v7",' + JSON.stringify(serialize(staffFixture)) + ')'); await button('#load'); await closeInspector();
  await button('[data-speed="10"]'); await button('#pause');
  await until('JSON.parse(window.cityManager.snapshot()).tick>=46'); await button('#pause');
  const staffed = await state(), staffedPark = staffed.parks[0];
  assert.equal(staffedPark.staffing.allocations.reduce((n, a) => n + a.workers, 0), 1);
  assert.equal(staffed.employment.length, 0);
  await button('[data-tool="select"]'); await cell(parkCell);
  assert.match(await text('#place-metrics'), /เจ้าหน้าที่สวน/);
  assert.match(await text('#place-metrics'), /1 \/ 1 คน/);
  assert.match(await text('#place-metrics'), /420/);
  assert.match(await text('#place-metrics'), /100%/);
  await screenshot('desktop-park-workforce.png');
  const staffOwed = Object.values(staffedPark.staffing.workDays).reduce((n, d) => n + d * PARK_STAFF.dailyWage, 0);
  await game(); await button('#save'); await closeInspector();
  await button('[data-tool="bulldoze"]'); await cell(parkCell);
  const staffRemoved = await state(); assert.equal(staffRemoved.parks.length, 0);
  assert.equal(staffRemoved.ledger.filter(e => e.reason === 'Monthly park wages #' + staffedPark.id).reduce((n, e) => n + e.amount, 0), staffOwed);
  await game(); await button('#load'); assert.deepEqual(await state(), staffed); await closeInspector();
  checks.push('Real park staffing after a browser day without roads: staffing/capacity/wage UI, earned payroll on removal and exact save/load');

  // A valid real economy supplies the people and paid municipal allocation. Only
  // the saved minute is staged; browser controls drive all subsequent activity.
  const activityCity = deserialize(serialize(staffFixture)); step(activityCity);
  const activityRuntime = createParkRuntime(activityCity);
  for (let minute = 0; minute < 1200; minute++) {
    advanceParkRuntime(activityCity, activityRuntime, 1, () => step(activityCity));
    if (activityRuntime.activity.visitors.some(v => v.phase === 'sit' || v.phase === 'meet') && Object.keys(activityRuntime.recreation.citizens).length) break;
  }
  assert.ok(activityRuntime.activity.visitors.length > 0 && Object.keys(activityRuntime.recreation.citizens).length > 0);
  const activitySave = serializeParkSession(activityCity, activityRuntime);
  await game(); await evaluate(`localStorage.setItem('citymanager.save.v7',${JSON.stringify(activitySave)})`); await button('#load');
  assert.equal(await evaluate('window.cityManager.sessionSnapshot()'), activitySave);
  await closeInspector(); await button('#toggle-inspector');
  await button('#park-recreation > button');
  assert.equal(await evaluate('window.cityManager.parks().speed'), 1 / 1440);
  const realPeople = await evaluate('window.cityManager.parks()');
  assert.ok(realPeople.renderedVisitors > 0);
  assert.equal(new Set(realPeople.citizenIds).size, realPeople.renderedVisitors);
  assert.ok(realPeople.citizenIds.every(id => activityRuntime.activity.visitors.some(v => v.citizenId === id)));
  const frozenSession = await evaluate('window.cityManager.sessionSnapshot()'); await sleep(400);
  assert.equal(await evaluate('window.cityManager.sessionSnapshot()'), frozenSession);
  await button('#park-recreation-data summary');
  await closeInspector(); await button('#pause');
  await until(`window.cityManager.parks().minute > ${activityRuntime.activity.minute}`, 8000); await button('#pause');
  assert.equal((await state()).tick, activityCity.tick);
  await button('#toggle-inspector');
  assert.equal(await evaluate('document.querySelector("#park-recreation-data details").open'), true);
  await screenshot('desktop-park-recreation.png');
  await game(); await button('#save'); const sessionSaved = await evaluate('window.cityManager.sessionSnapshot()');
  await closeInspector(); await button('#pause');
  await sleep(1200); await button('#pause'); await game(); await button('#load');
  assert.equal(await evaluate('window.cityManager.sessionSnapshot()'), sessionSaved);
  const corruptSession = JSON.parse(sessionSaved); corruptSession.parkRuntime.recreation.minute++;
  await evaluate(`localStorage.setItem('citymanager.save.v7',${JSON.stringify(JSON.stringify(corruptSession))})`);
  await button('#load'); assert.equal(await evaluate('window.cityManager.sessionSnapshot()'), sessionSaved);
  assert.match(await text('#inspector-status'), /โหลดไม่สำเร็จ.*sidecar clock mismatch/);
  await evaluate(`localStorage.setItem('citymanager.save.v7',${JSON.stringify(sessionSaved)})`); await closeInspector();
  checks.push('Real citizen identities, staffed visit benefit, citizen-speed pause, persistent provenance table, atomic fractional save/load, corrupt-sidecar rejection');

  await button('[data-camera="reset"]');
  await game(); await evaluate(`localStorage.setItem('citymanager.save.v7',${JSON.stringify(fixtureJson)})`); await button('#load'); assertAdoptedCity(await state(), fixture, 'Loaded legacy city'); await assertOriginalSave(evaluate, fixtureJson); await closeInspector();
  await button('[data-speed="10"]'); await button('#pause');
  await until('JSON.parse(window.cityManager.snapshot()).tick>=90', 15000);
  await button('#pause'); const grown = await state();
  assert.ok(grown.buildings.length > 0); assert.ok(grown.ledger.some(e => e.tick > 65 && e.reason.includes('purchase'))); assert.ok(grown.ledger.some(e => e.tick > 65 && e.reason === 'Monthly wages'));
  await game(); await evaluate(`localStorage.setItem('citymanager.save.v7',${JSON.stringify(fixtureJson)})`); await button('#load'); assertAdoptedCity(await state(), fixture, 'Restored legacy city'); await assertOriginalSave(evaluate, fixtureJson); await closeInspector();
  if (process.env.CITYMANAGER_BLOCK_MODELS !== '1') assert.equal((await evaluate('window.cityManager.visuals()')).failed.length, 0, 'Models instantiate successfully after growth');
  await screenshot('desktop-city.png'); checks.push('10x real purchases and monthly wages after frozen legacy migration; identical paused financial/spatial fixture restored for GUI checks');
  if (process.env.CITYMANAGER_VISUAL_PREVIEW === '1') {
    if (await evaluate('document.querySelector("#inspector").dataset.open==="true"')) await button('#close-inspector'); await button('[data-camera="zoom-in"]'); await button('[data-camera="zoom-in"]');
    await screenshot('desktop-closeup.png'); await button('[data-camera="reset"]');
    const beforePlacement = await state();
    await button('[data-tool="road"]'); await cell(12 * 24 + 11);
    const hoverPoint = await cellPoint(12 * 24 + 14);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hoverPoint.x, y: hoverPoint.y });
    assert.equal((await evaluate('window.cityManager.ground()')).buildGrid, true);
    await screenshot('desktop-build-grid.png'); await key('Escape'); await key('Escape');
    assert.equal((await evaluate('window.cityManager.ground()')).buildGrid, false);
    assert.deepEqual(await state(), beforePlacement, 'Grid preview and cancel never build a road');
  }
  // Camera controls must move the projection, then return to the reset state.
  const cameraBefore = await cellPoint(12 * 24 + 6);
  await button('[data-camera="rotate-left"]'); await button('[data-camera="zoom-in"]');
  // Desktop keeps pan arrows behind the move toggle; they must still move the camera when shown.
  if (await evaluate('getComputedStyle(document.querySelector(\'[data-camera="left"]\')).display==="none"')) await button('#toggle-camera-pan');
  await button('[data-camera="left"]');
  assert.notDeepEqual(await cellPoint(12 * 24 + 6), cameraBefore); await button('[data-camera="reset"]');
  checks.push('Pan/rotate/zoom/reset controls');
  // Summary Space is handled natively and must not resume the simulation.
  await button('#toggle-help');
  const guideWasOpen = await evaluate('document.querySelector("#guide").open');
  await evaluate('document.querySelector("#guide summary").focus()');
  assert.equal(await evaluate('document.activeElement===document.querySelector("#guide summary")'), true, 'Help summary actually receives keyboard focus');
  await key(' ', 'Space'); assert.equal(await paused(), true);
  assert.notEqual(await evaluate('document.querySelector("#guide").open'), guideWasOpen, 'Space expands/collapses the focused help');
  checks.push('Summary Space expands help without toggling simulation');
  // Emulated mobile/DPR2 viewport: layout, touch targets and multi-touch cancel.
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
  if (await evaluate('document.querySelector("#inspector").dataset.open==="true"')) await button('#close-inspector');
  await until('document.querySelector("#city-canvas").clientWidth===390');
  await button('#toggle-camera');
  await button('[data-camera="reset"]');
  await button('#toggle-camera');
  const gateway = await cellPoint(12 * 24);
  assert.ok(gateway.x > 0 && gateway.x < 390 && gateway.y > 0 && gateway.y < 844);
  assert.equal(await evaluate(`document.elementFromPoint(${gateway.x},${gateway.y}).id`), 'city-canvas', 'Mobile gateway is visible and unobstructed');
  const small = await evaluate('({width:innerWidth,scroll:document.documentElement.scrollWidth,bad:[...document.querySelectorAll("button")].filter(e=>{const r=e.getBoundingClientRect();return r.width&&r.height&&(r.width<44||r.height<44)}).map(e=>e.id||e.dataset.tool)})');
  assert.equal(small.width, 390); assert.ok(small.scroll <= 390); assert.deepEqual(small.bad, []);
  await button('[data-tool="road"]'); const beforeTouch = await state();
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 230, y: 450, id: 1 }, { x: 280, y: 450, id: 2 }] });
  await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 210, y: 460, id: 1 }, { x: 310, y: 460, id: 2 }] });
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert.deepEqual(await state(), beforeTouch);
  await button('#toggle-camera'); await button('[data-camera="reset"]'); await button('#toggle-camera');
  await button('[data-tool="select"]');
  const beforeMobileSelection = await state();
  const homeBuilding = beforeMobileSelection.buildings.find(b => b.zone === 'R');
  const household = beforeMobileSelection.households.find(h => h.home === homeBuilding.id);
  const homePoint = await cellPoint(homeBuilding.cell);
  assert.equal(await evaluate(`document.elementFromPoint(${homePoint.x},${homePoint.y})?.id`), 'city-canvas', 'Town remains visible above mobile controls');
  assert.equal(await evaluate('!!document.querySelector("[data-tool=pan]")'), false, 'No pan/inspect mode switch');
  // Emulated touch events in a mobile viewport, followed by a fresh tap.
  const beforeDragPoint = await cellPoint(homeBuilding.cell);
  const start = { x: beforeDragPoint.x - 35, y: beforeDragPoint.y };
  assert.equal(await evaluate(`document.elementFromPoint(${start.x},${start.y})?.id`), 'city-canvas');
  await send('Input.dispatchTouchEvent', {type:'touchStart', touchPoints:[{...start,id:1}]});
  await send('Input.dispatchTouchEvent', {type:'touchMove', touchPoints:[{...beforeDragPoint,id:1}]});
  await send('Input.dispatchTouchEvent', {type:'touchEnd', touchPoints:[]});
  assert.notDeepEqual(await cellPoint(homeBuilding.cell), beforeDragPoint, 'Drag moves the camera');
  assert.notEqual(await evaluate('document.querySelector("#inspector").dataset.open'), 'true', 'Drag never opens details');
  assert.deepEqual(await state(), beforeMobileSelection, 'Drag does not mutate the city');
  await button('#toggle-camera'); await button('[data-camera="reset"]'); await button('#toggle-camera');
  const tap = await cellPoint(homeBuilding.cell);
  await send('Input.dispatchTouchEvent', {type:'touchStart', touchPoints:[{...tap,id:1}]});
  await send('Input.dispatchTouchEvent', {type:'touchEnd', touchPoints:[]});
  await until('document.querySelector("#inspector").dataset.open==="true"');
  checks.push('Mobile touch drag pans without inspecting; a fresh tap opens building details');
  assert.ok((await text('#selection-title')).replaceAll(' ', '').includes(`${homeBuilding.cell % 24 + 1},${Math.floor(homeBuilding.cell / 24) + 1}`));
  assert.match(await text('#explanation'), /ระยะจากประตูเมืองผ่านถนน \d+ ช่อง รวมทางเข้าแปลง \(ไม่ใช่เวลาเดินทาง\)/, 'Connected building shows actual gateway road distance');
  assert.deepEqual(await evaluate('[...document.querySelectorAll("#entity-content [data-household-id]")].map(e=>Number(e.dataset.householdId))'), beforeMobileSelection.households.filter(h=>h.home===homeBuilding.id).map(h=>h.id), 'House lists only its actual households');
  await button('[data-household-id="' + household.id + '"]');
  assert.equal(await evaluate('Number(document.querySelector("[data-context-metric=cash]").dataset.value)'), beforeMobileSelection.accounts[household.wallet], 'Household info binds its exact wallet');
  await button('#submenu-back');
  const inspectorLayout = await evaluate(`(()=>{const p=document.querySelector('#inspector'),r=p.getBoundingClientRect(),c=document.querySelector('#close-inspector').getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,height:r.height,closeHit:!!document.elementFromPoint(c.x+c.width/2,c.y+c.height/2)?.closest('#close-inspector'),z:Number(getComputedStyle(p).zIndex),watermarkZ:Number(getComputedStyle(document.querySelector('.map-caption')).zIndex)}})()`);
  assert.ok(inspectorLayout.left >= 0 && inspectorLayout.right <= 390 && inspectorLayout.top >= 0 && inspectorLayout.bottom <= 844);
  assert.equal(inspectorLayout.closeHit, true, 'Context panel close is unobstructed');
  assert.ok(inspectorLayout.z > inspectorLayout.watermarkZ, 'Map watermark stays behind the context panel');
  await until('[...document.querySelectorAll("img[src*=kenney-ui]")].every(i=>i.complete)');
  const guiImages = await evaluate('[...document.querySelectorAll("img[src*=kenney-ui]")].map(i=>({src:i.getAttribute("src"),width:i.naturalWidth}))');
  assert.ok(guiImages.length > 0, 'Licensed GUI artwork is used');
  assert.ok(guiImages.every(i => i.width > 0), 'GUI images load from the Pages base path');
  await screenshot('mobile-inspector.png');
  await closeInspector();
  assert.equal(await evaluate(`document.elementFromPoint(${homePoint.x},${homePoint.y})?.id`), 'city-canvas', 'Selected home is accessible again after closing the tall panel');
  await button('#toggle-inspector');
  await button('details.ledger-details:has(#ledger) > summary');
  await until('document.querySelector("#inspector").dataset.submenu==="money-section"');
  assert.ok(await evaluate('document.querySelectorAll("#ledger .sm-flow-card").length>0'));
  const scrollPoint = await evaluate('(()=>{const r=document.querySelector("#inspector-body").getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()');
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: scrollPoint.x, y: scrollPoint.y, deltaX: 0, deltaY: 300 });
  await until('(()=>{const r=document.querySelector("#inspector-body").getBoundingClientRect();return[...document.querySelectorAll("#ledger .sm-flow-card")].filter(e=>{const b=e.getBoundingClientRect();return b.top<r.bottom&&b.bottom>r.top}).length>=2})()');
  await screenshot('mobile-ledger.png');
  const scroll = await evaluate('({x:document.querySelector("#inspector-body").scrollWidth,width:document.querySelector("#inspector-body").clientWidth})');
  assert.ok(scroll.x <= scroll.width, 'Inspector content does not overflow horizontally');
  await game(); await button('#save');
  const savedMessage = await text('#inspector-status'); assert.match(savedMessage, /Saved day/);
  assert.equal(await evaluate('document.querySelector("#inspector-status").getBoundingClientRect().height>0'), true, 'Save feedback remains visible while the toolbar is hidden');
  await evaluate('window.__restoreStorage=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw new DOMException("Acceptance quota failure", "QuotaExceededError")}');
  try {
    await game(); await button('#save');
    assert.notEqual(await text('#inspector-status'), savedMessage, 'Storage rejection reports a different visible result');
    assert.match(await text('#inspector-status'), /บันทึกไม่ได้/);
    assert.equal(await text('#inspector-status'), await text('#status'));
  } finally { await evaluate('Storage.prototype.setItem=window.__restoreStorage;delete window.__restoreStorage'); }
  await game(); await button('#load');
  assert.equal(await text('#inspector-status'), await text('#status'));
  assert.deepEqual(await state(), beforeMobileSelection, 'Explicit Game-menu save/load preserves the exact city');
  checks.push('Mobile Game menu exposes save success, quota rejection and load feedback without a persistent entity footer');
  if (await evaluate('document.querySelector("#inspector").dataset.open==="true"')) await button('#close-inspector');
  const firm = beforeMobileSelection.firms[0];
  const firmBuilding = beforeMobileSelection.buildings.find(b => b.id === firm.building);
  await cell(firmBuilding.cell);
  assert.equal(await evaluate('document.querySelector("#inspector-body").scrollTop'), 0, 'Selecting another place starts its card at the top');
  for (const [key, value] of [['cash', beforeMobileSelection.accounts[firm.wallet]], ['workers', firmWorkerCount(beforeMobileSelection, firm.id)], ['stock', firm.inventory], ['profit', firm.lastMonthProfit]]) {
    assert.equal(await evaluate(`Number(document.querySelector('[data-context-metric="${key}"]').dataset.value)`), value, `${key} shows actual firm state`);
  }
  const reserve = Object.values(firm.workDays).reduce((n, days) => n + days * (firm.zone === 'I' ? 60000 : 42000) / 30, 0);
  assert.equal(await evaluate('Number(document.querySelector("[data-context-metric=reserved]").dataset.value)'), reserve);
  await screenshot('mobile-firm.png');
  assert.deepEqual(await state(), beforeMobileSelection, 'Information selection, ledgers and scrolling never change the city');
  checks.push('Thai home/firm cards show actual values, licensed GUI images, scrollable ledger, accessible close and watermark layering');
  if (await evaluate('document.querySelector("#inspector").dataset.open==="true"')) await button('#close-inspector');
  assert.equal((await evaluate('window.cityManager.ground()')).buildGrid, false);
  await screenshot('mobile-city.png'); checks.push('390x844 DPR2 layout, unobstructed gateway, >=44px buttons and pinch without construction (emulated)');
  const mobileParkBefore = await state();
  await button('[data-tool="park"]');
  assert.equal(await evaluate('document.querySelector("[data-tool=park]").getAttribute("aria-pressed")'), 'true');
  assert.deepEqual(await state(), mobileParkBefore, 'mobile tool selection does not charge');
  const mobileParkPoint = await evaluate(`(()=>{const c=JSON.parse(window.cityManager.snapshot());for(let i=0;i<c.cells.length;i++){const t=c.cells[i];if(t.road||t.zone||t.building!==null||c.plants.some(p=>p.cell===i)||c.parks.some(p=>p.cell===i))continue;const p=window.cityManager.cellScreen(i);if(p.y>100&&p.y<innerHeight-250&&p.x>30&&p.x<innerWidth-30&&document.elementFromPoint(p.x,p.y)?.id==='city-canvas')return {cell:i,...p}}return null})()`);
  assert.ok(mobileParkPoint, 'an empty one-cell garden site is reachable on mobile');
  await clickAt(mobileParkPoint.x, mobileParkPoint.y);
  assert.equal((await state()).parks.length, mobileParkBefore.parks.length + 1);
  await button('[data-tool="select"]'); await cell(mobileParkPoint.cell);
  assert.match(await text('#selection-title'), /สวนสาธารณะ/);
  assert.match(await text('#place-metrics'), /1 ช่อง/);
  await screenshot('mobile-park.png');
  checks.push('Mobile 390px park tool and one-cell placement/detail are reachable');
  await game(); await evaluate(`localStorage.setItem('citymanager.save.v7',${JSON.stringify(sessionSaved)})`); await button('#load');
  assert.equal(await evaluate('window.cityManager.sessionSnapshot()'), sessionSaved);
  await closeInspector(); await button('#toggle-inspector');
  if (!await evaluate('document.querySelector("#park-recreation-data details").open')) await button('#park-recreation-data summary');
  assert.ok(await evaluate('document.querySelector("#park-recreation-data table").getBoundingClientRect().width > 0'));
  assert.ok(await evaluate('document.querySelector("#inspector-body").scrollWidth <= document.querySelector("#inspector-body").clientWidth'));
  assert.ok((await evaluate('window.cityManager.parks()')).renderedVisitors > 0);
  await screenshot('mobile-park-recreation.png');
  checks.push('390px mobile real citizens, atomic reload and bounded horizontally scrolling recreation table');
  if (process.env.CITYMANAGER_BLOCK_MODELS === '1') { await interceptions.settle(); await send('Fetch.disable'); await interceptions.settle(); }
  assert.deepEqual(errors, [], 'No browser runtime/console errors');
  if (process.env.CITYMANAGER_BLOCK_MODELS === '1') assert.equal(expectedAssetErrors.length, 41, 'Only the 41 deliberately blocked model requests failed');
  const version = await send('Browser.getVersion');
  const report = { date: new Date().toISOString(), url: targetUrl, browser: version.product, engine: 'PlayCanvas 2.23.3', visuals: visualStatus, ground: groundState, checks, errors, expectedAssetErrors, interceptions: interceptions.snapshot(), screenshots: ['desktop-disconnected.png', 'desktop-city.png', 'desktop-park.png', 'mobile-park.png', ...(process.env.CITYMANAGER_VISUAL_PREVIEW === '1' ? ['desktop-closeup.png', 'desktop-build-grid.png'] : []), 'mobile-inspector.png', 'mobile-ledger.png', 'mobile-firm.png', 'mobile-city.png'], note: 'Headless installed Edge. Mobile metrics/touch are emulated, not real-device QA.' };
  await writeFile(resolve(output, 'browser-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  // Do not let a screenshot, protocol hang or cleanup hide the actual failure.
  console.error('Primary browser acceptance failure:', error instanceof Error ? error.stack : String(error));
  console.error('Intercepted model requests at failure:', JSON.stringify(interceptions.snapshot()));
  console.error('Pending CDP commands at failure:', JSON.stringify([...pending.values()].map(({method,startedAt}) => ({method,elapsedMs:Date.now()-startedAt}))));
  if (ws?.readyState === 1) {
    // Best-effort visual context has its own bound; the regular 60 s CDP command
    // timeout remains unchanged, and unresolved work is cancelled in finally.
    const capture = (async () => { try { await screenshot('smoke-failure.png'); console.error(await evaluate('({status:document.querySelector("#status")?.textContent,body:document.body.innerText.slice(0,1600)})')); } catch (diagnosticError) { console.error('Failure diagnostic capture:',String(diagnosticError)); } })();
    let timer; const result = await Promise.race([capture.then(() => 'done'), new Promise(resolve => { timer = setTimeout(() => resolve('timeout'),2000); })]); clearTimeout(timer);
    if (result === 'timeout') console.error('Failure diagnostic capture exceeded 2 s; retaining primary error');
  }
  console.error('Browser errors:', errors);
  throw error;
} finally {
  closing = true;
  if (ws?.readyState === 1) {
    let timer; try { await Promise.race([send('Browser.close').catch(error => console.error('Browser cleanup:',String(error))), new Promise(resolve => { timer = setTimeout(resolve,2000); })]); } catch {} finally { clearTimeout(timer); }
    try { ws.close(); } catch {}
  }
  // Clear protocol timers and settle any explicitly handled in-flight promises;
  // a cleanup-time rejection can no longer replace an earlier primary failure.
  for (const item of [...pending.values()]) item.reject(Error('CDP cleanup cancelled pending command'));
  try { child.kill(); } catch {}
}
