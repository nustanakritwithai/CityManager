// Sound acceptance in installed headless Edge: no audio before a gesture, effects decode after the first
// tap, map commands and city events play their cues, mute persists, and the settings live in the
// atmosphere menu. Headless output is silent; the engine's diagnostics report what it played.
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { createCity, step, serialize, SIZE } from '../src/sim.ts';
import { reachTouch } from './touch-reach.mjs';

const url = process.env.CITYMANAGER_URL || 'http://127.0.0.1:4173/CityManager/';
const output = resolve('.test-output'), port = 9351;
const checks = [], errors = [];
await mkdir(output, { recursive: true });
let occupied = false; try { occupied = (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(500) })).ok; } catch {}
assert.equal(occupied, false, `Audio suite must run alone; CDP${port} is occupied`);
const child = spawn(process.env.CITYMANAGER_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-component-update', '--autoplay-policy=user-gesture-required', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`, `--user-data-dir=${resolve(output, 'audio-profile')}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
let ws, sequence = 0; const pending = new Map(), sleep = ms => new Promise(r => setTimeout(r, ms));
async function send(method, params = {}) { const id = ++sequence; const promise = new Promise((resolve, reject) => { const timer = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout ${method}`)); }, 30000); pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } }); }); ws.send(JSON.stringify({ id, method, params })); return promise; }
async function evaluate(expression) { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; }
async function until(expression, timeout = 20000) { const start = Date.now(); while (Date.now() - start < timeout) { if (await evaluate(expression)) return; await sleep(100); } throw Error(`Timed out ${expression}`); }
async function click(x, y) { for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: 1 }); }
async function key(value) { for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: value, code: `Key${value.toUpperCase()}`, text: type === 'keyDown' ? value : undefined }); }
async function press(selector) { if (await reachTouch(evaluate, press, selector)) return; const p = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`); await sleep(50); await click(p.x, p.y); await sleep(50); }
const audio = () => evaluate('window.cityManager.audio()');
const played = async () => (await audio()).played.map(p => p.name);
const open = async () => { await send('Page.navigate', { url: url + '?starter=1' }); await until('!!window.cityManager && window.cityManager.visuals().ready', 60000); };

try {
  let tabs; for (let n = 0; n < 100; n++) { try { tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); break; } catch { await sleep(100); } }
  ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl); await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  ws.onmessage = event => { const m = JSON.parse(event.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(Error(JSON.stringify(m.error))) : p.resolve(m.result); } if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text); if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.value ?? a.description).join(' ')); };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await open(); await evaluate('localStorage.removeItem("citymanager.audio.v1")'); await open();

  let state = await audio();
  assert.equal(state.unlocked, false); assert.equal(state.state, 'locked'); assert.equal(state.effects, 0);
  assert.equal(state.settings.muted, false, 'Sound is on by default'); assert.ok(state.settings.master <= .6, 'at a low level');
  checks.push('Nothing is created or decoded before the first gesture; sound defaults on at a low level');

  await press('[data-tool="R"]');
  await until('window.cityManager.audio().unlocked && window.cityManager.audio().effects === 20');
  state = await audio(); assert.equal(state.state, 'running'); assert.ok((await played()).includes('ui-select'));
  checks.push('Native group/tool taps unlock the audio graph, decode all 20 effects and play the tool sound');

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
  await press('[data-tool="select"]'); await press('#toggle-game-menu'); await until('document.querySelector("#inspector").dataset.page==="game"');
  await evaluate(`localStorage.setItem('citymanager.save.v7',${JSON.stringify(serialize(fixture))})`); await press('#load'); await press('#close-inspector');
  await press('[data-speed="10"]'); await press('#pause');
  await until('JSON.parse(window.cityManager.snapshot()).tick >= 61', 60000); await press('#pause');
  const heard = await played();
  assert.ok(heard.includes('ev-month'), 'Month end plays the coin sound: ' + heard.join(','));
  checks.push('Running time plays city cues (month end) through the limiter');

  await key('u'); state = await audio(); assert.equal(state.settings.muted, true);
  await open(); state = await audio(); assert.equal(state.settings.muted, true, 'Mute survives a reload');
  await key('u'); state = await audio(); assert.equal(state.settings.muted, false);
  checks.push('U toggles mute and the choice is remembered');

  await press('#atmosphere-toggle'); await until('!document.querySelector("#atmosphere-menu").hidden');
  const panel = await evaluate('(()=>{const s=document.querySelector(".audio-settings");return{sliders:s.querySelectorAll("input[type=range]").length,mute:!!s.querySelector("#audio-mute"),next:!!s.querySelector("#audio-next"),track:s.querySelector(".audio-track").textContent,credit:s.querySelector(".atmosphere-note").textContent}})()');
  assert.equal(panel.sliders, 5); assert.ok(panel.mute && panel.next); assert.match(panel.track, /^เพลง: /); assert.match(panel.credit, /CC0/);
  const before = (await audio()).track; await press('#audio-next'); assert.notEqual((await audio()).track, before, 'Next track changes the track');
  await evaluate('(()=>{const r=document.querySelector(".audio-settings input[data-audio=music]");r.value="0";r.dispatchEvent(new Event("input"))})()');
  assert.equal((await audio()).settings.music, 0); assert.equal((await audio()).musicPlaying, false, 'Music stops at zero volume');
  checks.push('The atmosphere menu holds mute, five volumes, the track with credits and next track; music stops at zero');

  assert.deepEqual(errors, [], 'No runtime or console errors');
  const report = { date: new Date().toISOString(), url, checks, audio: await audio() };
  await writeFile(resolve(output, 'audio-report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ checks }, null, 2));
} catch (error) { console.error('Browser errors:', errors); throw error; }
finally { if (ws?.readyState === 1) { try { await send('Browser.close'); } catch {} ws.close(); } child.kill(); }
