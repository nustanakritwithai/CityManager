// Local-only screenshots and geometry checks; disposable profile and synthetic cities.
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { createCity, step, serialize, buildPark, buildCampus, buildPlant } from '../src/sim.ts';
import { population2000Fixture } from './population-capacity-fixture.ts';
import { reachTouch } from './touch-reach.mjs';

const stage = process.env.VISUAL_STAGE || 'candidate';
assert.match(stage, /^[a-z-]+$/);
const output = resolve('.test-output/visual-polish', stage), port = 9394;
const url = process.env.CITYMANAGER_URL || 'http://127.0.0.1:4173/CityManager/';
assert.equal(new URL(url).hostname, '127.0.0.1');
await mkdir(output, { recursive: true });
const normal = createCity(61025, { starter: true });
for (let i = 0; i < 65; i++) step(normal);
// Use real placement commands for the visual sample's municipal buildings.
for (const kind of ['park', 'school', 'university', 'power', 'water']) {
  for (let cell = 0; cell < normal.cells.length; cell++) {
    const result = kind === 'park' ? buildPark(normal, cell) : ['school', 'university'].includes(kind) ? buildCampus(normal, cell, kind) : buildPlant(normal, cell, kind);
    if (result.ok) break;
  }
}
const fixtures = { empty: createCity(61025, { starter: false }), normal, dense: population2000Fixture() };
const profile = await mkdtemp(resolve(output, 'profile-'));
let occupied = false;
try { occupied = (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(500) })).ok; } catch {}
assert.equal(occupied, false);
const child = spawn(process.env.CITYMANAGER_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', [
  ...(process.env.CITYMANAGER_SOFTWARE_WEBGL === '1' ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : []),
  '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-component-update',
  '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank',
], { windowsHide: true, stdio: 'ignore' });
let ws, sequence = 0;
const pending = new Map(), errors = [], external = [], captures = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const watchdog = setTimeout(() => { child.kill(); process.exit(1); }, 480000);
async function send(method, params = {}) {
  const id = ++sequence;
  const promise = new Promise((yes, no) => { const timer = setTimeout(() => { pending.delete(id); no(Error(`CDP timeout: ${method} ${String(params.expression ?? '').slice(0,160)}`)); }, 90000); pending.set(id, { yes: r => { clearTimeout(timer); yes(r); }, no: e => { clearTimeout(timer); no(e); } }); });
  ws.send(JSON.stringify({ id, method, params })); return promise;
}
async function evaluate(expression) { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; }
async function until(expression, timeout = 60000) { const start = Date.now(); while (Date.now() - start < timeout) { if (await evaluate(expression)) return; await sleep(100); } throw Error(`Timeout: ${expression}`); }
const paints = () => evaluate('document.fonts.ready.then(()=>true)');
async function click(x, y) { for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }); await paints(); }
async function button(selector) {
  if (await reachTouch(evaluate, button, selector)) return;
  const p = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height}})()`);
  assert.ok(p.w && p.h, selector); await click(p.x, p.y);
}
async function close() { if (await evaluate('document.querySelector("#inspector").dataset.open==="true"')) await button('#close-inspector'); }
async function load(city) {
  await close(); await button('#toggle-game-menu');
  await evaluate(`localStorage.setItem('citymanager.save.v7',${JSON.stringify(serialize(city))})`);
  await button('#load'); await close(); await paints();
}
async function capture(name) {
  await paints();
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(resolve(output, `${name}.png`), Buffer.from(r.data, 'base64'));
  const info = await evaluate(`(()=>{const visible=e=>e.getClientRects().length>0;const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height}};return{width:innerWidth,height:innerHeight,quality:document.documentElement.dataset.visualQuality,atmosphere:window.cityManager.atmosphere(),visuals:window.cityManager.visuals(),buttons:[...document.querySelectorAll('.tool-buttons button,.tool-submenu:not([hidden]) button')].filter(visible).map(e=>({id:e.id,tool:e.dataset.tool,text:e.textContent,...rect(e)})),overflow:document.documentElement.scrollWidth>innerWidth}})()`);
  assert.equal(info.overflow, false, name);
  for (const b of info.buttons) assert.ok(b.w >= 43.5 && b.h >= 43.5, `${name} target ${b.id || b.tool}`);
  captures.push({ name, ...info });
  console.log(`Captured ${name}`);
}
try {
  let page;
  for (let i = 0; i < 100; i++) { try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); if (page) break; } catch {} await sleep(100); }
  assert.ok(page); ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  console.log('Disposable Edge connected');
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.no(Error(JSON.stringify(m.error))) : p.yes(m.result); } if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails); if (m.method === 'Fetch.requestPaused') { const local = new URL(m.params.request.url).origin === new URL(url).origin; if (!local) external.push(m.params.request.url); void send(local ? 'Fetch.continueRequest' : 'Fetch.failRequest', local ? { requestId: m.params.requestId } : { requestId: m.params.requestId, errorReason: 'BlockedByClient' }); } };
  await send('Runtime.enable'); await send('Page.enable'); await send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
  await send('Emulation.setDeviceMetricsOverride', { width:390, height:844, screenWidth:390, screenHeight:844, deviceScaleFactor:1, mobile:true });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `if(location.origin===${JSON.stringify(new URL(url).origin)}){localStorage.setItem('citymanager.visual.v1',JSON.stringify({timeMode:'noon',quality:'low',rain:false,seasons:false,traffic:true,mapInfo:true}));}` });
  await send('Page.navigate', { url });
  await until('!!window.cityManager || !!document.querySelector(".guest-entry-card")');
  if (await evaluate('!!document.querySelector(".guest-entry-card")')) await button('.guest-entry-card button:nth-of-type(2)');
  await until('!!window.cityManager && window.cityManager.visuals().ready');
  if (await evaluate('document.querySelector(".guide-skip")?.getClientRects().length>0')) await button('.guide-skip');
  if (await evaluate('document.querySelector("#pause").getAttribute("aria-pressed")!=="true"')) await button('#pause');
  console.log('Game ready and paused');
  const browser = await send('Browser.getVersion');
  for (const [layout, width, height, mobile] of [['portrait',390,844,true],['landscape',844,390,true],['desktop',1280,800,false]].filter(([layout]) => !process.env.VISUAL_LAYOUT || process.env.VISUAL_LAYOUT === layout)) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, screenWidth: width, screenHeight: height, deviceScaleFactor: 1, mobile });
    await send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: 2 });
    await paints();
    for (const [name, city] of Object.entries(fixtures)) {
      await load(city); const before = await evaluate('window.cityManager.snapshot()');
      await capture(`${layout}-${name}`);
      assert.equal(await evaluate('window.cityManager.snapshot()'), before, 'Visual observation is read-only');
      if (name === 'normal') {
        for (const group of ['construction', 'services']) { await button(`#${group}-tool`); await capture(`${layout}-${group}`); await button(`#${group}-tool`); }
        if (stage !== 'baseline') {
          for (const tool of ['school', 'university']) {
            await button(`[data-tool="${tool}"]`);
            const glyph = await evaluate(`(()=>{const a=document.querySelector('#services-tool .tool-icon'),b=document.querySelector('[data-tool="${tool}"] .tool-icon');return{svg:!!a.querySelector('svg'),same:a.innerHTML===b.innerHTML,anchor:getComputedStyle(a).color,option:getComputedStyle(b).color}})()`);
            assert.equal(glyph.svg,true,'Education has a vector icon'); assert.equal(glyph.same,true,'Selected dock icon matches the menu'); assert.equal(glyph.anchor,glyph.option,'Selected dock colour matches the menu');
            await capture(`${layout}-${tool}-active`);
          }
          await button('[data-tool="select"]');
          await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
          await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
        }
        const p = await evaluate(`(()=>{const c=JSON.parse(window.cityManager.snapshot());for(const b of c.buildings){const p=window.cityManager.cellScreen(b.cell);if(p.x>50&&p.x<innerWidth-50&&p.y>100&&p.y<innerHeight-140&&document.elementFromPoint(p.x,p.y)?.id==='city-canvas')return p;}return null})()`);
        if (p) { await click(p.x,p.y); await capture(`${layout}-selected`); await close(); }
        assert.equal(await evaluate('window.cityManager.snapshot()'), before, 'Menus and selection do not mutate city');
      }
    }
  }
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  const report = { stage, source: execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(), browser, fixtureHashes:Object.fromEntries(Object.entries(fixtures).map(([n,c])=>[n,createHash('sha256').update(serialize(c)).digest('hex')])), captures, errors, external, note:'Installed Edge, emulated viewport/touch; not physical Android or a device FPS measurement.' };
  await writeFile(resolve(output,`${process.env.VISUAL_LAYOUT || 'all'}-report.json`), JSON.stringify(report,null,2));
  console.log(JSON.stringify({ stage, screenshots: captures.map(c=>c.name), errors, external }));
} catch (error) { if (ws?.readyState === 1) { try { await capture('failure'); } catch {} } throw error; }
finally { clearTimeout(watchdog); if (ws?.readyState === 1) { try { await send('Browser.close'); } catch {} ws.close(); } child.kill(); }
