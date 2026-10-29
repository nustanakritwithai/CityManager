// Local-only Edge acceptance for genuine progression and populated park saves.
// CI runs this sequentially against its existing Vite preview and disposable profile.
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { createCity, step, serialize, isRetail, firmCapacity, housingCapacity, farmCrop } from '../src/sim.ts';
import { farmStockCapacity } from '../src/agriculture.ts';
import { factoryCropCapacity } from '../src/factory-levels.ts';
import { retailCapacity } from '../src/retail-capacity.ts';
import { deserializeParkSession, serializeParkSession } from '../src/park-runtime.ts';
import { SAVE_KEY, FARM_LEVEL_BACKUP_KEY } from '../src/save-storage.ts';
import { keepSupplied } from './plants.ts';
import { reachTouch } from './touch-reach.mjs';

const output = resolve('.test-output/building-progression'), debugPort = 9364;
const url = process.env.CITYMANAGER_URL || 'http://127.0.0.1:4173/CityManager/';
const allowed = new URL(url); assert.equal(allowed.hostname, '127.0.0.1');
const originalPark = await readFile(new URL('./fixtures/retail-v18-park-session.json', import.meta.url), 'utf8');
const old = JSON.parse(originalPark), imported = deserializeParkSession(originalPark);
assert.equal(old.version, 18); assert.equal(old.rulesVersion, 'chain-13');
assert.equal(old.parkRuntime.activity.visitors.length, 6); assert.equal(Object.keys(old.parkRuntime.recreation.citizens).length, 6);
const migratedPark = serializeParkSession(imported.city, imported.runtime);
const snapshots = new Map(), city = createCity(61025);
for (let day = 1; day <= 180; day++) {
  if (day === 120 || day === 180) {
    const before = structuredClone(city), after = structuredClone(city); step(after);
    snapshots.set(day, { before, after });
  }
  step(city); keepSupplied(city);
}
const findUpgrade = (day, zone, predicate = () => true) => {
  const { before, after } = snapshots.get(day);
  const building = after.buildings.find(b => b.zone === zone && predicate(after.firms.find(f => f.building === b.id)) && b.level > (before.buildings.find(p => p.id === b.id)?.level ?? Infinity));
  assert.ok(building, `Natural ${zone} upgrade on day ${day}`);
  return { previous: before.buildings.find(b => b.id === building.id), building, firm: after.firms.find(f => f.building === building.id) };
};
const home = findUpgrade(120, 'R'), factory = findUpgrade(120, 'I'), farm = findUpgrade(120, 'F'), shop = findUpgrade(180, 'C', f => f && isRetail(f));
assert.deepEqual([home.previous.level,home.building.level,factory.previous.level,factory.building.level,farm.previous.level,farm.building.level,shop.previous.level,shop.building.level], [3,4,3,4,3,4,4,5]);
assert.deepEqual(housingCapacity(home.building), { households: 5, persons: 20 });
assert.equal(firmCapacity(factory.building), 7); assert.equal(factoryCropCapacity(factory.building.level), 28);
assert.equal(firmCapacity(farm.building), 4); assert.equal(farmStockCapacity(farm.building.level), 120);
assert.equal(firmCapacity(shop.building), 4); assert.equal(retailCapacity(shop.building.level).stock, 48);
for (const item of [home, factory, farm, shop]) {
  assert.equal(item.building.id, item.previous.id); assert.equal(item.building.cell, item.previous.cell);
  const { before, after } = snapshots.get(item === shop ? 180 : 120);
  const source = item === home ? 'outside' : item.firm.wallet, reason = item === home ? 'Outside residential height investment' : 'Profitable firm height investment';
  assert.ok(after.ledger.slice(before.ledger.length).some(e => e.from === source && e.to === 'construction' && e.amount === 20_000 && e.reason === reason), `Paid upgrade ${item.building.id}`);
  if (item.firm) {
    const previousFirm = before.firms.find(f => f.id === item.firm.id);
    assert.equal(previousFirm.building, item.firm.building); assert.equal(previousFirm.wallet, item.firm.wallet);
    if (item.firm.zone === 'F') assert.equal(farmCrop(before, previousFirm), farmCrop(after, item.firm));
    if (item.firm.zone === 'I') assert.equal(previousFirm.recipe, item.firm.recipe);
  }
}
function assertRealFlows(observed, day) {
  assert.ok(observed.cropLedger.some(e => e.tick === day && e.kind === 'harvest' && e.workers > 0), 'A real paid farm worker harvested');
  assert.ok(observed.cropLedger.some(e => e.tick === day && e.kind === 'process' && e.workers > 0), 'A real paid factory worker processed crops');
  const sales = observed.goodsLedger.filter(e => e.tick === day && e.reason === 'Household final consumption');
  assert.ok(sales.length, 'Real shop sales occurred');
  for (const sale of sales) assert.ok(observed.ledger.some(e => e.tick === day && e.from === sale.to && e.to === sale.from && e.amount === sale.quantity * 800 && e.reason === `Household #${sale.to.slice(10)} purchase`), 'Each shop sale has its actual household payment');
}
for (const [day, snapshot] of snapshots) assertRealFlows(snapshot.after, day);
if (process.argv.includes('--preflight')) {
  console.log(JSON.stringify({ ticks: [...snapshots.keys()], upgrades: [home, factory, farm, shop].map(item => ({ id: item.building.id, zone: item.building.zone, from: item.previous.level, to: item.building.level })) }));
  process.exit(0);
}

await mkdir(output, { recursive: true });
let occupied = false; try { occupied = (await fetch(`http://127.0.0.1:${debugPort}/json/version`, { signal: AbortSignal.timeout(500) })).ok; } catch {}
assert.equal(occupied, false, 'Building progression browser port is already in use');
const child = spawn(process.env.CITYMANAGER_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', [
  '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-component-update',
  '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${resolve(output, 'profile')}`, 'about:blank',
], { windowsHide: true, stdio: 'ignore' });
let ws, seq = 0; const pending = new Map(), errors = [], external = [], checks = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const watchdog = setTimeout(() => { console.error('Building progression browser acceptance timed out'); child.kill(); process.exit(1); }, 180_000);
async function send(method, params = {}) {
  const id = ++seq, result = new Promise((yes, no) => { const timer = setTimeout(() => { pending.delete(id); no(Error(`CDP timeout: ${method}`)); }, 30_000); pending.set(id, { yes: v => { clearTimeout(timer); yes(v); }, no: e => { clearTimeout(timer); no(e); } }); });
  ws.send(JSON.stringify({ id, method, params })); return result;
}
async function evaluate(expression) { const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw Error(result.exceptionDetails.text); return result.result.value; }
async function until(expression, timeout = 30_000) { const start = Date.now(); while (Date.now() - start < timeout) { if (await evaluate(expression)) return; await sleep(75); } throw Error(`Timed out: ${expression.slice(0, 120)}`); }
const paints = () => evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
const state = () => evaluate('(()=>{const c=JSON.parse(window.cityManager.snapshot());if(c.version!==19||c.rulesVersion!=="chain-14")throw new Error("Unexpected current save envelope");c.version=9;c.rulesVersion="chain-4";return c})()');
async function click(x,y) { for (const type of ['mouseMoved','mousePressed','mouseReleased']) await send('Input.dispatchMouseEvent',{type,x,y,button:type==='mouseMoved'?'none':'left',clickCount:1}); }
async function button(selector) {
  if (await reachTouch(evaluate, button, selector)) return;
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest',inline:'nearest'})`); await paints();
  const p = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height,disabled:e.disabled}})()`);
  assert.ok(p.w && p.h && !p.disabled, `Visible enabled ${selector}`);
  assert.equal(await evaluate(`!!document.elementFromPoint(${p.x},${p.y})?.closest(${JSON.stringify(selector)})`), true, `Actual hit ${selector}`); await click(p.x,p.y);
}
async function close() { if (await evaluate('document.querySelector("#inspector").dataset.open==="true"')) await button('#close-inspector'); await paints(); }
async function game() { await close(); await button('#toggle-game-menu'); await until('document.querySelector("#inspector").dataset.page==="game"'); }
async function screenshot(name) { const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false}); await writeFile(resolve(output,name),Buffer.from(r.data,'base64')); }
async function load(raw) { await game(); await evaluate(`localStorage.setItem(${JSON.stringify(SAVE_KEY)},${JSON.stringify(raw)})`); await button('#load'); }
async function inspect(building, kind) {
  await close(); await button('[data-tool="select"]'); await paints(); const point=await evaluate(`window.cityManager.cellScreen(${building.cell})`);
  assert.equal(await evaluate(`document.elementFromPoint(${point.x},${point.y})?.id`),'city-canvas'); await click(point.x,point.y);
  await until(`document.querySelector('#entity-content').dataset.entityId===${JSON.stringify(String(building.id))}`);
  assert.equal(await evaluate('document.querySelector("#entity-content").dataset.cardKind'),kind);
}
async function runBoundary(day,items) {
  const { before, after } = snapshots.get(day); await load(serialize(before)); assert.deepEqual(await state(),before); await close();
  await button('[data-speed="1"]');
  // Pause from the browser's next animation callback as soon as the real day is
  // reached, avoiding an unrelated second-day race on a loaded CI machine.
  await evaluate(`(()=>{const target=${day};const stop=()=>{if(JSON.parse(window.cityManager.snapshot()).tick>=target){const p=document.querySelector('#pause');if(p.getAttribute('aria-pressed')!=='true')p.click()}else requestAnimationFrame(stop)};requestAnimationFrame(stop)})()`);
  await button('#pause'); await until(`document.querySelector('#pause').getAttribute('aria-pressed')==='true' && JSON.parse(window.cityManager.snapshot()).tick>=${day}`);
  assert.deepEqual(await state(),after,`Browser day ${day} preserves the complete independently replayed city`);
  const observed = await state();
  assertRealFlows(observed, day);
  for (const item of items) { const b=after.buildings.find(x=>x.id===item.building.id); assert.equal(b.cell,item.previous.cell); assert.equal(b.level,item.building.level); }
  return after;
}

try {
  let targets; for (let i=0;i<100;i++) { try { targets=await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json(); break; } catch { await sleep(100); } }
  assert.ok(targets?.length, 'Installed Edge started');
  ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl); await new Promise((yes,no)=>{ws.onopen=yes;ws.onerror=no});
  ws.onmessage=event=>{const m=JSON.parse(event.data);if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.no(Error(JSON.stringify(m.error))):p.yes(m.result);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')errors.push(m.params.args.map(a=>a.value??a.description).join(' '));if(m.method==='Fetch.requestPaused'){const target=new URL(m.params.request.url), local=target.origin===allowed.origin;if(!local)external.push(target.origin);void send(local?'Fetch.continueRequest':'Fetch.failRequest',local?{requestId:m.params.requestId}:{requestId:m.params.requestId,errorReason:'BlockedByClient'});}};
  await send('Runtime.enable'); await send('Page.enable'); await send('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,screenWidth:1440,screenHeight:1000,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:url+'?starter=1'}); await until('!!window.cityManager && window.cityManager.visuals().ready',60_000);
  if (await evaluate('document.querySelector("#pause").getAttribute("aria-pressed")!=="true"')) await button('#pause');
  await load(originalPark);
  assert.equal(await evaluate('window.cityManager.sessionSnapshot()'),migratedPark,'Populated activity, recreation and entire migrated city match');
  assert.equal(await evaluate(`localStorage.getItem(${JSON.stringify(SAVE_KEY)})`),originalPark,'Load does not rewrite the original');
  await button('#save'); assert.equal(await evaluate(`localStorage.getItem(${JSON.stringify(FARM_LEVEL_BACKUP_KEY)})`),originalPark,'Original v18 bytes backed up');
  assert.equal(await evaluate(`localStorage.getItem(${JSON.stringify(SAVE_KEY)})`),migratedPark); await button('#load');
  assert.equal(await evaluate('window.cityManager.sessionSnapshot()'),migratedPark,'Entire populated session survives save and reload');
  checks.push('Genuine v18 park activity/recreation, city and exact backup survive desktop load/save/reload');
  await runBoundary(120,[home,factory,farm]);
  await inspect(farm.building,'farm'); assert.equal(await evaluate('document.querySelector("#entity-content [data-context-metric=crop-stock]").dataset.capacity'),'120'); assert.match(await evaluate('document.querySelector("#entity-content [data-building-progression]").textContent'), /ระดับ 4\/6[\s\S]*ระดับถัดไป 5/); await screenshot('desktop-farm.png');
  await inspect(factory.building,'factory'); assert.equal(await evaluate('document.querySelector("#entity-content [data-context-metric=crop-stock]").dataset.capacity'),'28'); assert.match(await evaluate('document.querySelector("#entity-content [data-building-progression]").textContent'), /ระดับ 4\/9[\s\S]*ระดับถัดไป 5/);
  await inspect(home.building,'house'); assert.equal(await evaluate('document.querySelector("#entity-content [data-context-metric=households]").dataset.capacity'),'5');
  assert.match(await evaluate('document.querySelector("#entity-content .bc-type-label").textContent'), /อพาร์ตเมนต์ ระดับ 1/);
  assert.equal(await evaluate('!!document.querySelector("#entity-content [data-building-progression]").closest("details")'), false, 'Housing progression is not hidden in collapsed details');
  await screenshot('desktop-apartment-details.png');
  checks.push('Natural day-120 home, factory and farm upgrades match replay, identity, paid costs and real capacity');
  await runBoundary(180,[shop]);
  // This genuine city reaches its fifth goal at day 180. Continue through the
  // real win dialog before using map tools, just as a player would.
  await until('!!document.querySelector("dialog.win-dialog[open] .win-continue")');
  await button('.win-continue'); await until('!document.querySelector("dialog.win-dialog[open]")');
  await inspect(shop.building,'shop'); assert.equal(await evaluate('document.querySelector("#entity-content [data-retail-growth]")?.dataset.retailGrowth'),String(shop.firm.id));
  assert.match(await evaluate('document.querySelector("#entity-content [data-retail-growth]").textContent'), /ค่าก่อสร้าง 200 เครดิต[\s\S]*สำรองเมือง/); await screenshot('desktop-shop.png'); checks.push('Natural day-180 shop upgrade matches replay, paid cost, identity and capacity');
  await close(); await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,screenWidth:390,screenHeight:844,deviceScaleFactor:1,mobile:true}); await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:2}); await until('innerWidth===390');
  await load(originalPark); assert.equal(await evaluate('window.cityManager.sessionSnapshot()'),migratedPark); await button('#save'); await button('#load');
  assert.equal(await evaluate('window.cityManager.sessionSnapshot()'),migratedPark,'Mobile full park session survives save and reload'); await screenshot('mobile-park-session.png');
  checks.push('390px mobile-emulated populated park session survives full save/reload');
  assert.deepEqual(errors,[],'No browser runtime or console errors'); assert.deepEqual(external,[],'No external browser requests');
  await writeFile(resolve(output,'report.json'),JSON.stringify({checks,errors,external,upgrades:[home,factory,farm,shop].map(x=>({id:x.building.id,zone:x.building.zone,level:x.building.level})),note:'Headless Edge; mobile viewport is emulated, not physical-device QA.'},null,2));
  console.log(JSON.stringify({checks,errors,external},null,2));
} catch (error) {
  if (ws?.readyState === 1) { try { await screenshot('failure.png'); } catch {} }
  console.error(JSON.stringify({ checks, errors, external, failure: String(error?.message ?? error) }));
  throw error;
} finally {
  clearTimeout(watchdog); if(ws?.readyState===1){try{await send('Browser.close');}catch{}ws.close();} child.kill();
}
