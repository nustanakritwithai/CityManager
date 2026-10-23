// Small dependency-free CDP smoke test against the installed Microsoft Edge.
// Runs real browser/WebGL; emulated mobile metrics do not establish device QA.
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = process.cwd(), output = resolve(root, '.test-output');
const screenshots = resolve(root, process.env.CITYMANAGER_SCREENSHOT_DIR || 'docs/screenshots');
const targetUrl = process.env.CITYMANAGER_URL || 'http://127.0.0.1:4173/CityManager/';
await mkdir(output, { recursive: true }); await mkdir(screenshots, { recursive: true });
const edge = process.env.CITYMANAGER_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const child = spawn(edge, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-component-update', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=9349', `--user-data-dir=${resolve(output, 'edge-profile')}`, '--window-size=1440,1000', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
let ws, sequence = 0; const pending = new Map(); const errors = []; const expectedAssetErrors = []; const checks = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function send(method, params = {}) {
  const id = ++sequence;
  const result = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 30000);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject });
  });
  ws.send(JSON.stringify({ id, method, params })); return result;
}
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
const state = async () => JSON.parse(await evaluate('window.cityManager.snapshot()'));
const text = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).textContent`);
const paused = () => evaluate('document.querySelector("#pause").getAttribute("aria-pressed")==="true"');
async function clickAt(x, y) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}
async function button(selector) {
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
    try { targets = await (await fetch('http://127.0.0.1:9349/json/list')).json(); break; } catch { await sleep(100); }
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
        /^Failed to load resource \[\/CityManager\/assets\/kenney-city\/models\/(house-[ab]|shop-[ab]|factory-[ab]|tree|streetlight)\.glb-container\]: Network error$/.test(args[0]?.value) && args[1]?.value === 'Network error';
      (deliberatelyBlocked ? expectedAssetErrors : errors).push(args);
    }
    if (message.method === 'Fetch.requestPaused') void send('Fetch.failRequest', { requestId: message.params.requestId, errorReason: 'Failed' });
  };
  await send('Runtime.enable'); await send('Page.enable');
  if (process.env.CITYMANAGER_BLOCK_MODELS === '1') await send('Fetch.enable', { patterns: [{ urlPattern: '*kenney-city/models/*.glb', requestStage: 'Request' }] });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: targetUrl });
  await until('!!window.cityManager');
  await until('window.cityManager.visuals().ready');
  const visualStatus = await evaluate('window.cityManager.visuals()');
  if (process.env.CITYMANAGER_BLOCK_MODELS === '1') assert.equal(visualStatus.failed.length, 8);
  else assert.equal(visualStatus.loaded.length, 8);
  assert.equal(await evaluate('window.cityManager.engine'), 'PlayCanvas 2.23.3');
  await button('#pause'); assert.equal(await paused(), true);
  checks.push('Real Edge WebGL2 startup and pause');
  // Preserve a deterministic, paused baseline through the public Save control.
  await button('#save'); const saved = await state();
  assert.match(await text('#status'), /Saved day/);
  await button('#new-city'); await button('dialog button:first-of-type');
  await button('#new-city'); await key('Escape');
  assert.equal(await evaluate('!!document.querySelector("dialog[open]")'), false);
  assert.deepEqual(await state(), saved); checks.push('New-city cancel and Escape keep state');
  await button('[data-speed="3"]');
  assert.equal(await evaluate(`document.querySelector('[data-speed="3"]').getAttribute('aria-pressed')`), 'true');
  await button('[data-speed="1"]');
  await button('[data-tool="road"]'); await cell(12 * 24 + 11); await button('#cancel-tool');
  assert.match(await text('#status'), /start cancelled/i);
  await button('#cancel-tool'); assert.equal(await evaluate('document.querySelector("[data-tool=select]").getAttribute("aria-pressed")'), 'true');
  assert.deepEqual(await state(), saved); checks.push('Two-stage road cancel has no simulation mutation');
  // Existing road twice: no charge; tool repeated use stays active.
  await button('[data-tool="road"]'); await cell(12 * 24 + 3); await cell(12 * 24 + 5);
  assert.match(await text('#status'), /already exists/); assert.equal((await state()).accounts.treasury, saved.accounts.treasury);
  await cell(12 * 24 + 3); await cell(12 * 24 + 5); assert.equal((await state()).accounts.treasury, saved.accounts.treasury);
  checks.push('Repeated road use does not duplicate cost');
  // The visual preview opens on the starter district. Back out for construction
  // on the far side, as a player would, and keep the inspector off the gesture.
  await button('#close-inspector');
  await button('[data-camera="zoom-out"]'); await button('[data-camera="zoom-out"]');
  await cell(12 * 24 + 11); const beforeEscapeDrag = await state();
  await button('#close-inspector');
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
  assert.match(await text('#explanation'), /No connected road frontage/);
  await screenshot('desktop-disconnected.png'); checks.push('Drag road, zoning, picking and disconnected explanation');
  await button('#load'); assert.deepEqual(await state(), saved); assert.equal(await paused(), true);
  checks.push('Save/load round trip restores exact paused simulation');
  await button('[data-camera="reset"]');
  await button('[data-speed="10"]'); await button('#pause');
  await until('JSON.parse(window.cityManager.snapshot()).tick>=65', 15000);
  await button('#pause'); const grown = await state();
  assert.ok(grown.buildings.length > 0); assert.ok(grown.ledger.some(e => e.reason.includes('purchase'))); assert.ok(grown.ledger.some(e => e.reason === 'Monthly wages'));
  if (process.env.CITYMANAGER_BLOCK_MODELS !== '1') assert.equal((await evaluate('window.cityManager.visuals()')).failed.length, 0, 'Models instantiate successfully after growth');
  await screenshot('desktop-city.png'); checks.push('10x growth, actual household purchases and monthly wages');
  if (process.env.CITYMANAGER_VISUAL_PREVIEW === '1') {
    await button('#close-inspector'); await button('[data-camera="zoom-in"]'); await button('[data-camera="zoom-in"]');
    await screenshot('desktop-closeup.png'); await button('[data-camera="reset"]');
  }
  // Camera controls must move the projection, then return to the reset state.
  const cameraBefore = await cellPoint(12 * 24 + 6);
  await button('[data-camera="rotate-left"]'); await button('[data-camera="zoom-in"]'); await button('[data-camera="left"]');
  assert.notDeepEqual(await cellPoint(12 * 24 + 6), cameraBefore); await button('[data-camera="reset"]');
  checks.push('Pan/rotate/zoom/reset controls');
  // Summary Space is handled natively and must not resume the simulation.
  await evaluate('document.querySelector("#guide summary").focus()');
  await key(' ', 'Space'); assert.equal(await paused(), true); checks.push('Summary Space does not toggle simulation');
  // Emulated mobile/DPR2 viewport: layout, touch targets and multi-touch cancel.
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
  await button('#close-inspector');
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
  await screenshot('mobile-city.png'); checks.push('390x844 DPR2 layout, unobstructed gateway, >=44px buttons and pinch without construction (emulated)');
  assert.deepEqual(errors, [], 'No browser runtime/console errors');
  if (process.env.CITYMANAGER_BLOCK_MODELS === '1') assert.equal(expectedAssetErrors.length, 8, 'Only the eight deliberately blocked model requests failed');
  const version = await send('Browser.getVersion');
  const report = { date: new Date().toISOString(), url: targetUrl, browser: version.product, engine: 'PlayCanvas 2.23.3', visuals: visualStatus, checks, errors, expectedAssetErrors, screenshots: ['desktop-disconnected.png', 'desktop-city.png', ...(process.env.CITYMANAGER_VISUAL_PREVIEW === '1' ? ['desktop-closeup.png'] : []), 'mobile-city.png'], note: 'Headless installed Edge. Mobile metrics/touch are emulated, not real-device QA.' };
  await writeFile(resolve(output, 'browser-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  if (ws?.readyState === 1) {
    try { await screenshot('smoke-failure.png'); console.error(await evaluate('({status:document.querySelector("#status")?.textContent,body:document.body.innerText.slice(0,1600)})')); } catch {}
  }
  console.error('Browser errors:', errors);
  throw error;
} finally {
  if (ws?.readyState === 1) { try { await send('Browser.close'); } catch {} ws.close(); }
  child.kill();
}
