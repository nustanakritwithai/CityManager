// Real headless Edge/WebGL smoke for the isolated candidate; mobile is emulated.
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { createHash } from 'node:crypto';

const out = resolve('.test-output/park-activity');
await mkdir(out, { recursive: true });
const probe = createServer();
await new Promise(r => probe.listen(0, '127.0.0.1', r));
const port = probe.address().port;
await new Promise(r => probe.close(r));
const browser = spawn(process.env.CITYMANAGER_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-component-update', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`, `--user-data-dir=${resolve(out, `edge-profile-${process.pid}`)}`, '--window-size=1280,900', 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
let browserError = '';
browser.stderr.on('data', value => { browserError += value.toString(); });
let ws, sequence = 0;
const pending = new Map(), errors = [], checks = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
function send(method, params = {}) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout ${method}`)); }, 60000);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function until(expression) {
  for (let n = 0; n < 180; n++) { if (await evaluate(expression)) return; await sleep(250); }
  throw new Error(`Condition timeout ${expression}`);
}
async function button(id) {
  const p = await evaluate(`(()=>{const e=document.getElementById(${JSON.stringify(id)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...p, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...p, button: 'left', clickCount: 1 });
}
const diagnostics = () => evaluate('window.parkActivityCandidate.diagnostics()');
const snapshot = () => evaluate('window.parkActivityCandidate.snapshot()');
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function screenshot(name) {
  const image = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(resolve(out, name), Buffer.from(image.data, 'base64'));
}
try {
  let targets;
  for (let n = 0; n < 450; n++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); break; } catch { await sleep(100); } }
  assert.ok(targets?.length, `Edge available: ${browserError}`);
  ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = event => {
    const m = JSON.parse(event.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args);
  };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: process.env.CITYMANAGER_URL || 'http://127.0.0.1:4184/CityManager/park-activity-preview.html' });
  await until('!!window.parkActivityCandidate');
  console.log('Candidate booted in Edge WebGL');
  await evaluate('window.parkActivityCandidate.advance(0)');
  const initial = await diagnostics();
  assert.equal(initial.paused, true);
  assert.ok(initial.simulatedVisitors > 0, 'Real visitors reach candidate park');
  assert.equal(new Set(initial.citizenIds).size, initial.renderedVisitors);
  assert.ok(initial.citizenIds.every(id => initial.visitors.some(v => v.citizenId === id)));
  const beforePause = await snapshot();
  await sleep(500);
  assert.equal(digest(await snapshot()), digest(beforePause), 'Paused render has no activity or economic drift');
  checks.push('Real Edge WebGL startup, actual visitor identities, pause freeze');

  await button('save'); assert.match(await evaluate('document.getElementById("status").textContent'), /^Saved/); const saved = await snapshot();
  await evaluate('window.parkActivityCandidate.advance(7)');
  await button('load');
  assert.match(await evaluate('document.getElementById("status").textContent'), /^Loaded/);
  assert.equal(digest(await snapshot()), digest(saved), 'Save-load exact city + activity + clock remainder');
  checks.push('UI save/load restores exact city and activity snapshot');

  await button('evening');
  const evening = await snapshot();
  const run = await evaluate(`(()=>{const phases=new Set();let maximum=0,workViolations=0,identityViolations=0,captureMinute=0;for(let minute=1;minute<=310;minute++){window.parkActivityCandidate.advance(1);const d=window.parkActivityCandidate.diagnostics();for(const v of d.visitors){phases.add(v.phase);if(v.employed&&d.minute>=480&&d.minute<1020)workViolations++;}maximum=Math.max(maximum,d.activeReservations);if(d.renderedVisitors!==d.citizenIds.length)identityViolations++;if(!captureMinute&&d.visitors.some(v=>v.phase==='meet')&&d.visitors.some(v=>v.phase==='sit'))captureMinute=minute;}return{phases:[...phases],maximum,workViolations,identityViolations,captureMinute};})()`);
  const seen = new Set(run.phases);
  assert.ok(run.maximum <= 6); assert.equal(run.workViolations, 0); assert.equal(run.identityViolations, 0);
  assert.deepEqual(new Set(['travel', 'enter', 'stroll', 'wait', 'meet', 'sit', 'leave']), seen);
  const afterEvening = await snapshot();
  assert.equal(afterEvening.city, evening.city, 'An evening has no duplicate economic step, wages or workdays');
  checks.push('All seven actual activity phases, six-place occupancy, work exclusion, zero evening economy mutation');
  await button('evening'); await evaluate(`window.parkActivityCandidate.advance(${run.captureMinute || 50})`);
  await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  await screenshot('desktop-meeting.png');
  const beforeLOD = (await snapshot()).activity;
  await evaluate('window.parkActivityCandidate.setQuality("low")');
  assert.equal((await snapshot()).activity, beforeLOD);
  assert.ok((await diagnostics()).renderedVisitors <= 12);
  checks.push('Low detail cap changes rendering only');
  await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 1, mobile: true });
  await evaluate('window.scrollTo(0,0)');
  await sleep(300);
  assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true);
  await screenshot('mobile-emulated.png');
  checks.push('412×915 emulated mobile canvas, controls, and no horizontal overflow');
  assert.deepEqual(errors, []);
  const evidence = { passed: true, checks, phases: [...seen], initial, errors, environment: 'Headless Edge, real WebGL; desktop plus emulated mobile, not physical-device QA' };
  await writeFile(resolve(out, 'browser-evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ passed: true, checks, phases: [...seen], artifacts: out }, null, 2));
} catch (error) {
  let page = '';
  if (ws?.readyState === WebSocket.OPEN) {
    try { page = await evaluate('document.body.innerText'); await screenshot('failure.png'); } catch {}
  }
  console.error(JSON.stringify({ error: String(error).slice(0,1200), page, errors, browserError: browserError.slice(-2500) }, null, 2));
  throw error;
} finally { if (ws?.readyState === WebSocket.OPEN) { try { await send('Browser.close'); } catch {} } ws?.close(); browser.kill(); }
