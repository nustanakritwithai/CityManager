// Disposable local-only real-browser acceptance. No live saves, APIs or production services.
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { createCity, step, serialize, deserialize, buildCampus, toggleCampus, bulldoze, GATEWAY } from '../src/sim.ts';
import { buildingIssues } from '../src/building-issues.ts';
import { SAVE_KEY } from '../src/save-storage.ts';
import { reachTouch } from './touch-reach.mjs';

const city = createCity(61025); for (let day = 0; day < 90; day++) step(city);
let campusCell = -1;
for (let cell = 0; cell < city.cells.length; cell++) if (buildCampus(city, cell, 'school').ok) { campusCell = cell; break; }
assert.ok(campusCell >= 0); toggleCampus(city, city.education.campuses[0].id);
assert.ok(bulldoze(city, GATEWAY + 1).ok);
const raw = serialize(city); assert.deepEqual(deserialize(raw), city);
assert.ok(buildingIssues(city).some(issue => issue.remaining > 0));
if (process.argv.includes('--preflight')) { console.log(JSON.stringify({ campusCell, issues: buildingIssues(city).map(i => ({ cell: i.cell, kind: i.kind, remaining: i.remaining })) })); process.exit(0); }
const output = resolve('.test-output/building-issues'), port = 9369;
const url = process.env.CITYMANAGER_URL || 'http://127.0.0.1:4173/CityManager/';
const origin = new URL(url); assert.equal(origin.hostname, '127.0.0.1');
await mkdir(output, { recursive: true });
let occupied = false; try { occupied = (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(500) })).ok; } catch {}
assert.equal(occupied, false, 'Do not attach to another browser session');
const profile = await mkdtemp(resolve(output, 'profile-'));
const child = spawn(process.env.CITYMANAGER_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-component-update', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
let ws, seq = 0; const pending = new Map(), errors = [], external = [], checks = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const watchdog = setTimeout(() => { child.kill(); console.error('Building issue acceptance timed out'); process.exit(1); }, 180_000);
async function send(method, params = {}) { const id = ++seq; const result = new Promise((yes, no) => { const timer = setTimeout(() => { pending.delete(id); no(Error(`CDP timeout: ${method}`)); }, 30_000); pending.set(id, { yes: value => { clearTimeout(timer); yes(value); }, no: error => { clearTimeout(timer); no(error); } }); }); ws.send(JSON.stringify({ id, method, params })); return result; }
async function evaluate(expression) { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; }
async function until(expression) { const start = Date.now(); while (Date.now() - start < 45_000) { if (await evaluate(expression)) return; await sleep(80); } throw Error(`Timed out: ${expression}`); }
const paints = () => evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
async function click(x, y) { for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: 1 }); }
async function button(selector) { if (await reachTouch(evaluate, button, selector)) return; const p = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`); await click(p.x, p.y); }
async function close() { if (await evaluate('document.querySelector("#inspector").dataset.open==="true"')) await button('#close-inspector'); await paints(); }
async function screenshot(name) { const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); await writeFile(resolve(output, name), Buffer.from(r.data, 'base64')); }
async function marker() { await paints(); return evaluate(`(()=>{for(const e of document.querySelectorAll('.map-issue:not([hidden])')){const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;if(document.elementFromPoint(x,y)?.closest('.map-issue')===e)return{cell:Number(e.dataset.cell),kind:e.dataset.kind,x,y,w:r.width,h:r.height,label:e.getAttribute('aria-label'),remaining:Number(e.dataset.remaining)}}return null})()`); }
async function touch(p, drag = false) { await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y, id: 1 }] }); if (drag) await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p.x + 32, y: p.y + 10, id: 1 }] }); await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await paints(); }
try {
  let targets; for (let i = 0; i < 100; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); break; } catch { await sleep(100); } }
  assert.ok(targets?.length, 'Installed browser started'); ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl); await new Promise((yes, no) => { ws.onopen = yes; ws.onerror = no; });
  ws.onmessage = event => { const m = JSON.parse(event.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.no(Error(JSON.stringify(m.error))) : p.yes(m.result); } if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text); if (m.method === 'Fetch.requestPaused') { const local = new URL(m.params.request.url).origin === origin.origin; if (!local) external.push(m.params.request.url); void send(local ? 'Fetch.continueRequest' : 'Fetch.failRequest', local ? { requestId: m.params.requestId } : { requestId: m.params.requestId, errorReason: 'BlockedByClient' }); } };
  await send('Runtime.enable'); await send('Page.enable'); await send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url }); await until('!!window.cityManager');
  if (await evaluate('document.querySelector("#pause").getAttribute("aria-pressed")!=="true"')) await button('#pause');
  await button('#toggle-game-menu'); await evaluate(`localStorage.setItem(${JSON.stringify(SAVE_KEY)},${JSON.stringify(raw)})`); await button('#load'); await close();
  const before = await evaluate('window.cityManager.snapshot()'); assert.equal(before, raw);
  for (const mobile of [false, true]) {
    if (mobile) { await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }); await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 }); await paints(); }
    const p = await marker(); assert.ok(p, 'An unobstructed issue marker is visible'); assert.ok(p.w >= 44 && p.h >= 44 && p.label);
    if (mobile) {
      const first = { x: p.x, y: p.y, id: 1 }, second = { x: p.x + 3, y: p.y, id: 2 };
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [first] });
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [first, second] });
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [first] });
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await paints();
      assert.notEqual(await evaluate('document.querySelector("#inspector").dataset.open'), 'true', 'Two badge pointers never re-arm as a tap');
    }
    if (mobile) await touch(p, true); else { await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 }); await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x + 32, y: p.y + 10, button: 'left', buttons: 1 }); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x + 32, y: p.y + 10, button: 'left', clickCount: 1 }); }
    await paints(); assert.notEqual(await evaluate('document.querySelector("#inspector").dataset.open'), 'true', 'Drag is not a tap');
    const next = await marker(); assert.ok(next); if (mobile) await touch(next); else await click(next.x, next.y);
    await until(`document.querySelector('#building-issue-details').dataset.cell===${JSON.stringify(String(next.cell))} && document.querySelector('#inspector').dataset.open==='true'`);
    assert.equal(await evaluate('document.querySelector("#inspector").dataset.page'), 'entity');
    assert.equal(await evaluate('window.cityManager.snapshot()'), before, 'Tap and drag do not mutate city data or advance time');
    const expected = buildingIssues(city).find(i => i.cell === next.cell); assert.equal(await evaluate('document.querySelectorAll("#building-issue-details [data-issue]").length'), expected.details.length);
    await screenshot(mobile ? 'mobile-issue-details.png' : 'desktop-issue-details.png'); await close();
    // Build/road tools keep their own gestures: badges become pointer-transparent.
    await button('[data-tool="road"]'); assert.ok(await evaluate('[...document.querySelectorAll(".map-issue")].every(e=>getComputedStyle(e).pointerEvents==="none")')); await button('[data-tool="select"]'); await screenshot(mobile ? 'mobile-issue-map.png' : 'desktop-issue-map.png');
    checks.push(`${mobile ? '390px touch-emulated' : 'Desktop mouse'}: 44px accessible badge, drag vs tap, existing place route, exact reasons, read-only and road-tool pass-through`);
  }
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  await writeFile(resolve(output, 'report.json'), JSON.stringify({ checks, errors, external, note: 'Headless browser; touch and viewport emulated, no physical-device FPS claim.' }, null, 2)); console.log(JSON.stringify({ checks, errors, external }));
} catch (error) { if (ws?.readyState === 1) try { await screenshot('failure.png'); } catch {} throw error; }
finally { clearTimeout(watchdog); if (ws?.readyState === 1) { try { await send('Browser.close'); } catch {} ws.close(); } child.kill(); }
