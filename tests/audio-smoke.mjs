// Sound acceptance in installed headless Edge: no audio before a gesture, effects decode after the first
// tap, map commands and city events play their cues, mute lasts for the visit, and settings live in the
// atmosphere menu. Headless output is silent; the engine's diagnostics report what it played.
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { createCity, step, serialize, SIZE } from '../src/sim.ts';
import { startTrafficHttpFixture, reachTrafficControl, loadedTrafficSession, installTrafficNetworkFence } from './traffic-server-entry-fixture.mjs';
import { panelProviderDenials, isPanelProviderRequest } from './panel-network-denies.mjs';
import { guideSpeechProbeScript, checkGuideSpeechUI } from './guide-speech-browser-fixture.mjs';
import { audioProbeScript } from './audio-browser-fixture.mjs';

const upstream = process.env.CITYMANAGER_URL || 'http://127.0.0.1:4173/CityManager/';
const output = resolve('.test-output'), port = 9351;
const checks = [], errors = [], externalRequests = [], providerRequests = [];
let networkProbe = null;
let requireFirstGestureProof = false;
await mkdir(output, { recursive: true });
let occupied = false; try { occupied = (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(500) })).ok; } catch {}
assert.equal(occupied, false, `Audio suite must run alone; CDP${port} is occupied`);
const transport = await startTrafficHttpFixture(upstream);
const { url, fixture: server } = transport;
const child = spawn(process.env.CITYMANAGER_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-component-update', '--autoplay-policy=user-gesture-required', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`, `--user-data-dir=${resolve(output, 'audio-profile')}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
let ws, sequence = 0; const pending = new Map(), sleep = ms => new Promise(r => setTimeout(r, ms));
async function send(method, params = {}) { const id = ++sequence; const promise = new Promise((resolve, reject) => { const timer = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout ${method}`)); }, 30000); pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } }); }); ws.send(JSON.stringify({ id, method, params })); return promise; }
async function evaluate(expression) { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; }
async function until(expression, timeout = 20000) { const start = Date.now(); while (Date.now() - start < timeout) { if (await evaluate(expression)) return; await sleep(100); } throw Error(`Timed out ${expression}`); }
async function click(x, y) { for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: 1 }); }
async function key(value) { for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: value, code: `Key${value.toUpperCase()}`, text: type === 'keyDown' ? value : undefined }); }
async function press(selector) {
  if (selector === '.guest-entry-card button' && requireFirstGestureProof) {
    assert.deepEqual(await evaluate('window.__audioProbe'), { contexts: 0, plays: 0, preferenceWrites: 0 }, 'Before the first guest gesture no audio context or media playback exists');
    requireFirstGestureProof = false;
  }
  if (await reachTrafficControl(evaluate, press, selector)) return; const p = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`); await sleep(50); await click(p.x, p.y); await sleep(50); }
const audio = () => evaluate('window.cityManager.audio()');
const played = async () => (await audio()).played.map(p => p.name);
const enter = async () => server.enter({ send, evaluate, button: press, timeout: 60000 });
const open = async () => { server.allowNavigation(); await send('Page.reload', { ignoreCache: true }); await enter(); };
async function saveCity() {
  await press('#toggle-game-menu'); await until("!!document.querySelector('#save:not(:disabled)')");
  const oldRevision = server.active.revision, expected = await evaluate('window.cityManager.sessionSnapshot()');
  await press('#save');
  const deadline = Date.now() + 30000; while ((server.active.revision <= oldRevision || server.active.raw !== expected) && Date.now() < deadline) await sleep(80);
  assert.ok(server.active.revision > oldRevision); assert.equal(server.active.raw, expected, 'Native Save ACKs the exact paused session');
  await until("document.querySelector('#autosave-status')?.textContent.startsWith('บันทึกบนเซิร์ฟเวอร์แล้ว')&&!document.querySelector('#save-failure-banner:not([hidden])')");
  await server.settle(); await press('#close-inspector'); return server.active;
}

try {
  let tabs; for (let n = 0; n < 100; n++) { try { tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); break; } catch { await sleep(100); } }
  ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl); await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  ws.onmessage = event => { const m = JSON.parse(event.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(Error(JSON.stringify(m.error))) : p.resolve(m.result); } if (m.method === 'Page.javascriptDialogOpening') void server.dialog(m.params, send).catch(error => errors.push(String(error))); if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text); if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.value ?? a.description).join(' ')); if (m.method === 'Network.loadingFailed' && m.params.requestId === networkProbe?.requestId) networkProbe.failed = m.params; if (m.method === 'Network.requestWillBeSent') { const requested = m.params.request.url; if (networkProbe?.active && requested === networkProbe.url) networkProbe.requestId = m.params.requestId; else { if (isPanelProviderRequest(requested)) providerRequests.push(requested); if (/^https?:/.test(requested) && new URL(requested).origin !== new URL(url).origin) externalRequests.push(new URL(requested).origin + new URL(requested).pathname); } } };
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  await server.install(send);
  const origin = new URL(url).origin;
  await installTrafficNetworkFence({ send, evaluate, protocol: await (await fetch(`http://127.0.0.1:${port}/json/protocol`)).json(), origin, additionalBlocked: [...panelProviderDenials(origin), origin + '/api/city-advisor/*', origin + '/*/api/city-advisor/*'], observeProbe: probe => (networkProbe = { url: probe }) });
  // Instrument construction/playback only; retain the real browser audio implementation.
  await send('Page.addScriptToEvaluateOnNewDocument', { source: audioProbeScript });
  // Mock only native speech output: verify controls, no remote voice use, and city immutability.
  await send('Page.addScriptToEvaluateOnNewDocument', { source: guideSpeechProbeScript });
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  const initial = createCity(61025, { starter: true });
  const firstAck = await server.seed(serialize(initial));
  server.allowNavigation(); await send('Page.navigate', { url: url + '?starter=1' });
  await until("!!document.querySelector('.guest-entry-card button:not(:disabled)')", 60000);
  assert.deepEqual(await evaluate('window.__audioProbe'), { contexts: 0, plays: 0, preferenceWrites: 0 }, 'No sound is created before any gesture');
  const originalPreference = await evaluate('localStorage.getItem("citymanager.audio.v1")');
  requireFirstGestureProof = true; await enter();
  await until('window.cityManager.audio().unlocked && window.cityManager.audio().effects === 20', 60000);
  let state = await audio();
  assert.equal((await evaluate('window.__audioProbe.contexts')), 1, 'The actual guest gesture creates the first audio context');
  assert.equal(state.unlocked, true); assert.equal(state.state, 'running');
  assert.equal(state.settings.muted, false, 'Sound is on by default'); assert.ok(state.settings.master <= .6, 'at a low level');
  assert.equal(server.active.raw, firstAck.raw, 'Guest entry retains exact server ACK');
  checks.push('Before guest gesture there is no context or media playback; guest gesture unlocks and decodes the real audio graph with sound on at a low level');

  await press('[data-tool="R"]');
  state = await audio(); assert.ok((await played()).includes('ui-select'));
  checks.push('Native group/tool taps play the tool sound after guest entry');

  // Zone a parcel beside the starter road, then try a road over open water of rules (a refusal).
  const city = JSON.parse(await evaluate('window.cityManager.snapshot()'));
  const parcel = city.cells.findIndex((c, i) => !c.road && c.zone === null && c.building === null && [i - 1, i + 1, i - SIZE, i + SIZE].some(j => city.cells[j]?.road));
  const p = await evaluate(`window.cityManager.cellScreen(${parcel})`); await click(p.x, p.y); await sleep(300);
  assert.ok((await played()).includes('ui-place'), 'Zoning plays its sound');
  await press('[data-tool="select"]'); await press('[data-tool="bulldoze"]'); const gate = await evaluate(`window.cityManager.cellScreen(${city.cells.findIndex((c, i) => c.road && i % SIZE === 0)})`); await click(gate.x, gate.y); await sleep(300);
  assert.ok((await played()).includes('ui-error'), 'A refused command plays the soft refusal');
  checks.push('Map commands play their action sound, a refusal plays the error sound');

  // Load a city a day before its first month end, run, and hear the month and the build cues.
  const fixture = createCity(61025); for (let d = 0; d < 58; d++) step(fixture);
  await saveCity();
  await server.leave({ send, evaluate, until });
  const fixtureAck = await server.seed(serialize(fixture));
  server.allowNavigation(); await send('Page.navigate', { url: url + '?starter=1' }); await enter();
  assert.equal(server.active.raw, fixtureAck.raw, 'Month fixture is the exact server ACK');
  assert.equal(await evaluate('window.cityManager.snapshot()'), serialize(loadedTrafficSession(fixtureAck.raw).city), 'Month fixture loads the validated migrated city');
  await press('[data-speed="10"]'); await press('#pause');
  await until('JSON.parse(window.cityManager.snapshot()).tick >= 61', 60000); await press('#pause');
  const heard = await played();
  assert.ok(heard.includes('ev-month'), 'Month end plays the coin sound: ' + heard.join(','));
  checks.push('Running time plays city cues (month end) through the limiter');

  const saved = await saveCity();
  await key('u'); state = await audio(); assert.equal(state.settings.muted, true);
  await key('u'); state = await audio(); assert.equal(state.settings.muted, false);
  await key('u'); state = await audio(); assert.equal(state.settings.muted, true);
  assert.equal(await evaluate('window.__audioProbe.preferenceWrites'), 0, 'Audio choices never write browser preference storage');
  assert.equal(await evaluate('localStorage.getItem("citymanager.audio.v1")'), originalPreference);
  await open(); assert.equal(server.active.raw, saved.raw); assert.ok(server.active.revision >= saved.revision);
  assert.equal(await evaluate('window.cityManager.snapshot()'), serialize(loadedTrafficSession(saved.raw).city), 'Reload restores the exact acknowledged city');
  state = await audio(); assert.equal(state.settings.muted, false, 'New visit restores default sound setting');
  assert.equal(await evaluate('window.__audioProbe.preferenceWrites'), 0);
  assert.equal(await evaluate('localStorage.getItem("citymanager.audio.v1")'), originalPreference);
  checks.push('U toggles mute during this visit without browser preference writes; a new visit restores the default');

  await press('#atmosphere-toggle'); await until('!document.querySelector("#atmosphere-menu").hidden');
  const panel = await evaluate('(()=>{const s=document.querySelector(".audio-settings");return{sliders:s.querySelectorAll("input[type=range]").length,mute:!!s.querySelector("#audio-mute"),next:!!s.querySelector("#audio-next"),track:s.querySelector(".audio-track").textContent,credit:s.querySelector(".atmosphere-note").textContent}})()');
  assert.equal(panel.sliders, 5); assert.ok(panel.mute && panel.next); assert.match(panel.track, /^เพลง: /); assert.match(panel.credit, /CC0/);
  const before = (await audio()).track; await press('#audio-next'); assert.notEqual((await audio()).track, before, 'Next track changes the track');
  await evaluate('(()=>{const r=document.querySelector(".audio-settings input[data-audio=music]");r.value="0";r.dispatchEvent(new Event("input"))})()');
  assert.equal((await audio()).settings.music, 0); assert.equal((await audio()).musicPlaying, false, 'Music stops at zero volume');
  checks.push('The atmosphere menu holds mute, five volumes, the track with credits and next track; music stops at zero');

  await checkGuideSpeechUI({ evaluate, press, until, key, send });
  checks.push('Voice advice controls pass desktop/mobile-emulated open, explicit listen, replace, stop, mute, dismiss/reopen and remote-voice fallback with mocked local speech; city snapshot unchanged');
  await server.assertNoCityWrites(evaluate);
  assert.deepEqual(transport.errors, [], 'No loopback server errors');
  assert.deepEqual(externalRequests, [], 'No external browser requests');
  assert.deepEqual(providerRequests, [], 'No provider requests');
  assert.deepEqual(errors, [], 'No runtime or console errors');
  const report = { date: new Date().toISOString(), url, checks, audio: await audio() };
  await writeFile(resolve(output, 'audio-report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ checks }, null, 2));
} catch (error) { console.error('Browser errors:', errors); throw error; }
finally { if (ws?.readyState === 1) { try { await send('Browser.close'); } catch {} ws.close(); } child.kill(); await transport.close(); }
