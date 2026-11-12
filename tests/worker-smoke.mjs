import { panelProviderDenials, isPanelProviderRequest } from './panel-network-denies.mjs';
import { browserSnapshotState } from './browser-snapshot.ts';
// Real browser acceptance for worker-count/skill hiring. Root runs CDP sequentially.
// Fixtures are frozen old saves or replayed public simulation states, never forged jobs.
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { adoptSavedEducation, expandValidatedCity, firmCapacity, createCity, step, serialize, deserialize, bulldoze, employmentForHousehold, employmentForFirm, householdWorkerCount, firmWorkerCount, WAGES, MONTH } from '../src/sim.ts';
import { deserializeParkSession } from '../src/park-runtime.ts';
import { reachTrafficControl, trafficHttpHandler, installTrafficNetworkFence, assertNavigationSaveChain } from './traffic-server-entry-fixture.mjs';
import { createPanelModelAudit } from './panel-model-audit.mjs';
import { createFeedbackServerFixture } from './player-feedback-server-fixture.mjs';

const upstream = process.env.CITYMANAGER_URL || 'http://127.0.0.1:4173/CityManager/';
const output = resolve('.test-output'), shots = resolve(process.env.CITYMANAGER_SCREENSHOT_DIR || 'docs/worker-preview');
const blocked = process.env.CITYMANAGER_BLOCK_MODELS === '1', skills = ['general', 'manufacturing', 'retail'];
const hash = raw => createHash('sha256').update(raw).digest('hex');
const oldRaw = await readFile(new URL('./fixtures/legacy-v2-day65.json', import.meta.url), 'utf8'), old = JSON.parse(oldRaw);
const v1Raw = await readFile(new URL('./fixtures/legacy-v1-day65.json', import.meta.url), 'utf8');
assert.equal(hash(v1Raw), '4e358e66acdfb55dcfd434aaf67be51ccea99c69fc5a2b9b44343035c16166d0');
const oldV1 = JSON.parse(v1Raw), importedV1 = deserialize(v1Raw);
for (const key of ['accounts', 'ledger', 'goodsLedger', 'goods', 'seed', 'rng', 'tick', 'nextId']) assert.deepEqual(importedV1[key], oldV1[key]);
for (const person of oldV1.households) { const mapped = importedV1.households.find(h => h.id === person.id); assert(mapped); for (const key of ['home', 'wallet', 'lastPurchaseTick', 'needs']) assert.deepEqual(mapped[key], person[key]); assert.equal(mapped.members, 1); assert.equal(mapped.skillSource, 'legacy-assumed'); }
for (const firm of oldV1.firms) assert.deepEqual(importedV1.firms.find(f => f.id === firm.id).workDays, firm.workDays);
adoptSavedEducation(importedV1); const migratedV1 = expandValidatedCity(importedV1);
assert.equal(hash(oldRaw), '7062ffb3c6628b1a62ae7d9c548e497ab87e70d3b57bb715d34e0a9194eba3a5');
let imported = deserialize(oldRaw);
assert.equal(imported.version, 9); assert.equal(imported.rulesVersion, 'chain-4');
for (const key of ['accounts', 'ledger', 'goodsLedger', 'goods', 'seed', 'rng', 'tick', 'nextId', 'migration']) assert.deepEqual(imported[key], old[key], `Strict v2 import preserves ${key}`);
assert.deepEqual(imported.employment, old.employment.map(e => ({ ...e, skill: 'general' })));
for (const h of imported.households) { assert.deepEqual(h.workerSkills, { general: h.workforce, manufacturing: 0, retail: 0 }); assert.equal(h.skillSource, 'legacy-assumed'); }
for (const f of old.firms) assert.deepEqual(imported.firms.find(value => value.id === f.id).workDays, f.workDays);
assert.ok(old.firms.some(f => Object.keys(f.workDays).length), 'Frozen v2 fixture contains actually earned, unsettled wage claims');
const importedMoney = structuredClone(imported.accounts), importedPeople = structuredClone(imported.households), importedGoods = structuredClone(imported.goods);
adoptSavedEducation(imported); imported = expandValidatedCity(imported);

// Preserve #9's genuine funded-vacancy regression through a strict v3 migration.
// New F/T startup timings do not replace this published worker scenario. The
// migrated factory has no crop input and correctly stops new physical production.
const beforeV3Raw = await readFile(new URL('./fixtures/legacy-v3-day96.json', import.meta.url), 'utf8');
const afterV3Raw = await readFile(new URL('./fixtures/legacy-v3-day97.json', import.meta.url), 'utf8');
const payrollV3Raw = await readFile(new URL('./fixtures/legacy-v3-day119.json', import.meta.url), 'utf8');
assert.equal(hash(beforeV3Raw), 'd3df2066643b63e0e2839215922c373c302f84907c55fd2890b56fb467652fdb');
assert.equal(hash(afterV3Raw), '16b5b547aaf12732cb179b3634946e6fd9c8a973aba7ce948b623e8490579327');
assert.equal(hash(payrollV3Raw), '2f63fa3d0863568907009ae405b770fd3fc7a79bcd9306d4aced72391aed2727');
let before = deserialize(beforeV3Raw); const familyId = 4;
adoptSavedEducation(before); before = expandValidatedCity(before);
const after = deserialize(serialize(before));
step(after); deserialize(serialize(after));
assert.deepEqual(after.employment, JSON.parse(afterV3Raw).employment, 'The actual eligible-worker distribution remains identical to published #9');
assert.equal(after.goods.produced, before.goods.produced, 'Migrated zero-crop industry creates no new input-free finished goods');
const family = after.households.find(h => h.id === familyId), priorFamily = before.households.find(h => h.id === familyId);
assert.equal(after.tick, before.tick + 1); assert.equal(family.members, 3); assert.equal(family.workforce, 2); assert.equal(family.dependents, 1);
for (const key of ['id', 'home', 'wallet', 'members', 'workforce', 'dependents', 'workerSkills']) assert.deepEqual(family[key], priorFamily[key]);
const jobs = employmentForHousehold(after, familyId); assert.equal(jobs.reduce((n, e) => n + e.workers, 0), 2);
assert.equal(new Set(jobs.map(e => e.firmId)).size, 2); assert.equal(new Set(jobs.map(e => e.occupation)).size, 2);
const shop = after.firms.find(f => jobs.some(e => e.firmId === f.id) && f.zone === 'C'); assert.ok(shop);
const oldShop = before.firms.find(f => f.id === shop.id), oldShopBuilding = before.buildings.find(b => b.id === shop.building);
assert.ok(oldShop && firmCapacity(oldShopBuilding) > firmWorkerCount(before, shop.id), 'A genuine unoccupied shop position exists before matching');
assert.ok(before.accounts[shop.wallet] - Object.values(oldShop.workDays).reduce((n, days) => n + days * WAGES.C / MONTH, 0) >= WAGES.C / MONTH, 'The vacant role can reserve its next daily wage');

const dismissed = deserialize(serialize(after)); assert.equal(bulldoze(dismissed, after.buildings.find(b => b.id === shop.building).cell).ok, true);
assert.equal(householdWorkerCount(dismissed, familyId), 1); assert.deepEqual(dismissed.households.find(h => h.id === familyId), family);
assert.ok(dismissed.ledger.slice(after.ledger.length).some(e => e.from === shop.wallet && e.to === family.wallet && e.reason === 'Monthly wages'), 'Dismissal pays the actually earned shop claim');
let payrollBefore = deserialize(payrollV3Raw);
adoptSavedEducation(payrollBefore); payrollBefore = expandValidatedCity(payrollBefore);
const payrollAfter = deserialize(serialize(payrollBefore)); step(payrollAfter); deserialize(serialize(payrollAfter));
const wageEntries = payrollAfter.ledger.slice(payrollBefore.ledger.length).filter(e => e.to === family.wallet && e.reason === 'Monthly wages');
assert.ok(new Set(wageEntries.map(e => e.from)).size >= 2, 'Both real firms pay into the same household wallet at month end');
const fixture = { seed: before.seed, beforeTick: before.tick, afterTick: after.tick, householdId: familyId, beforeHash: hash(serialize(before)), afterHash: hash(serialize(after)), legacyV2Hash: hash(oldRaw), legacyV3Hash: hash(beforeV3Raw), employmentScenario: 'Frozen genuine #9 day96 strictly migrated, then one real agriculture tick: funded vacancy spreads two workers without forced eviction or free crop input' };
if (process.argv.includes('--preflight')) { console.log(JSON.stringify({ fixture, payrollTick: payrollAfter.tick, wageCounterparties: wageEntries.map(e => e.from) }, null, 2)); process.exit(0); }

const checks = [], errors = [], expectedErrors = [], screenshots = [], layouts = [];
let networkProbe = null; const externalRequests = [], providerRequests = [];
await mkdir(output, { recursive: true }); await mkdir(shots, { recursive: true });
let occupied = false; try { occupied = (await fetch('http://127.0.0.1:9349/json/version', { signal: AbortSignal.timeout(500) })).ok; } catch {}
assert.equal(occupied, false, 'Worker browser suite must run sequentially; CDP9349 is occupied');
// Each invocation owns its synthetic storage; never inherit another suite's unsaved recovery pair.
const profile = await mkdtemp(resolve(output, 'edge-worker-'));
const httpErrors = [], deliveries = []; let handler;
const proxy = createServer((req, res) => void handler(req, res));
await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${proxy.address().port}`;
const url = origin + new URL(upstream).pathname, server = createFeedbackServerFixture(url), core = server.core;
handler = trafficHttpHandler({ origin, upstream, fixture: server, errors: httpErrors, deliveries });
const child = spawn(process.env.CITYMANAGER_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-component-update', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=9349', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
let ws, sequence = 0; const pending = new Map(), sleep = ms => new Promise(r => setTimeout(r, ms));
async function send(method, params = {}) { const id = ++sequence; const promise = new Promise((resolve, reject) => { const timer = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout ${method}`)); }, 30000); pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } }); }); ws.send(JSON.stringify({ id, method, params })); return promise; }
async function evaluate(expression) { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; }
async function until(expression) { const start = Date.now(); while (Date.now() - start < 15000) { if (await evaluate(expression)) return; await sleep(60); } throw Error(`Timed out ${expression}`); }
const paints = () => evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
const state = async () => browserSnapshotState(await evaluate('window.cityManager.snapshot()'));
const route = () => evaluate('({page:document.querySelector("#inspector").dataset.page,open:document.querySelector("#inspector").dataset.open,scope:document.querySelector("#entity-content").dataset.scope,id:document.querySelector("#entity-content").dataset.entityId})');
async function click(x, y) { for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: 1 }); }
async function button(selector) { if (await reachTrafficControl(evaluate, button, selector)) return; await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest',inline:'nearest'})`); await paints(); const p = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect(),k=Math.min(1,screen.width/innerWidth);return{x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height,physicalWidth:r.width*k,physicalHeight:r.height*k,touch:navigator.maxTouchPoints>0,disabled:e.disabled}})()`); assert.ok(p.w && p.h && !p.disabled, `Visible enabled ${selector}`); if (p.touch) assert.ok(p.physicalWidth >= 43.5 && p.physicalHeight >= 43.5, `44px ${selector}: ${JSON.stringify(p)}`); assert.equal(await evaluate(`!!document.elementFromPoint(${p.x},${p.y})?.closest(${JSON.stringify(selector)})`), true, `Actual hit ${selector}`); await click(p.x, p.y); }
async function close() { if ((await route()).open === 'true') await button('#close-inspector'); await paints(); }
async function page(name) { if ((await route()).open !== 'true' || (await route()).page !== name) { await close(); await button(name === 'city' ? '#toggle-inspector' : '#toggle-game-menu'); } await until(`document.querySelector('#inspector').dataset.page===${JSON.stringify(name)}&&document.querySelector('#inspector').dataset.open==='true'`); }
async function key(value) { for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: value, code: value, windowsVirtualKeyCode: value === 'Escape' ? 27 : undefined }); }
const modelAudit = createPanelModelAudit({ blocked, expectedErrors, evaluate, sleep });
async function enter(modelBefore) {
  await core.enter({ send, evaluate, button, timeout: 60000 });
  await modelAudit.verify(modelBefore);
}
async function loadRaw(raw, expected) {
  await core.leave({ send, evaluate, until });
  const ack = await core.seed(raw); assert.equal(ack.raw, raw); assert.equal(ack.revision, 1);
  const modelBefore = modelAudit.begin();
  core.allowNavigation(); await send('Page.navigate', { url: url + '?starter=1' });
  await enter(modelBefore);
  assert.deepEqual(await state(), expected, 'Loaded validated session retains the expected migrated city');
  assert.equal(server.active.raw, raw, 'Entry leaves original server bytes unchanged');
  await core.assertNoCityWrites(evaluate); return ack;
}
async function load(city) { return loadRaw(serialize(city), city); }
async function saveCity(expected) {
  await page('game'); await core.settle();
  const previous = server.active, revision = previous.revision, cursor = core.writes.length, raw = await evaluate('window.cityManager.sessionSnapshot()');
  await button('#save'); const untilMs = Date.now() + 30000;
  while ((server.active.revision <= revision || server.active.raw !== raw) && Date.now() < untilMs) await sleep(80);
  assert.ok(server.active.revision > revision); assert.equal(server.active.raw, raw, 'Native Save ACKs exact session bytes');
  await until("document.querySelector('#autosave-status')?.textContent.startsWith('บันทึกบนเซิร์ฟเวอร์แล้ว')&&!document.querySelector('#save-failure-banner:not([hidden])')");
  assert.deepEqual(deserializeParkSession(raw).city, expected); await core.settle();
  const chain = assertNavigationSaveChain({ ...previous, raw }, server.active, core.writes.slice(cursor), core.writes.slice(0, cursor));
  assert.ok(chain.lifecycleSaves > 0, 'Native Save has an observed, contiguous POST/ACK chain');
  await core.assertNoCityWrites(evaluate); return server.active;
}
async function reloadCity(expected, saved) {
  const modelBefore = modelAudit.begin();
  core.allowNavigation(); await send('Page.reload', { ignoreCache: true }); await enter(modelBefore);
  assert.equal(server.active.raw, saved.raw); assert.equal(server.active.cityId, saved.cityId);
  assert.equal(core.navigationEvidence.at(-1).beforeRevision, saved.revision, 'Reload uses the same acknowledged city and verifies its lifecycle ACK chain');
  assert.deepEqual(await state(), expected); await core.assertNoCityWrites(evaluate);
}
async function oneTick(city) {
  await close(); await button('[data-speed="1"]');
  assert.equal(await evaluate(`document.querySelector('#pause').getAttribute('aria-pressed')`), 'true', 'Start boundary paused');
  // Stop on the page, not after a CDP round trip and two additional paints.
  // The complete independently replayed city must still match at the exact tick.
  await evaluate(`(()=>{const target=${city.tick};const stop=()=>{if(JSON.parse(window.cityManager.snapshot()).tick>=target){const p=document.querySelector('#pause');if(p.getAttribute('aria-pressed')!=='true')p.click()}else requestAnimationFrame(stop)};requestAnimationFrame(stop)})()`);
  await button('#pause');
  await until(`document.querySelector('#pause').getAttribute('aria-pressed')==='true' && JSON.parse(window.cityManager.snapshot()).tick>=${city.tick}`);
  assert.deepEqual(await state(), city);
}
async function place(city, id) { await close(); await button('[data-tool="select"]'); await paints(); const b = city.buildings.find(b => b.id === id), p = await evaluate(`window.cityManager.cellScreen(${b.cell})`); assert.equal(await evaluate(`document.elementFromPoint(${p.x},${p.y})?.id`), 'city-canvas'); await click(p.x, p.y); await until(`document.querySelector('#entity-content').dataset.scope==='place'&&document.querySelector('#entity-content').dataset.entityId==='${id}'`); }
async function metrics(expected) { const actual = await evaluate('Object.fromEntries([...document.querySelectorAll("#entity-content [data-context-metric]")].map(e=>[e.dataset.contextMetric,e.dataset.value]))'); for (const [key, value] of Object.entries(expected)) assert.equal(actual[key], String(value), `Exact metric ${key}`); }
async function household(city, id) { const h = city.households.find(h => h.id === id); await place(city, h.home); await button(`#entity-content [data-household-id="${id}"]`); await until(`document.querySelector('#entity-content').dataset.scope==='household'&&document.querySelector('#entity-content').dataset.entityId==='${id}'`); const rows = employmentForHousehold(city, id), employed = householdWorkerCount(city, id); await metrics({ cash: city.accounts[h.wallet], members: h.members, workforce: h.workforce, dependents: h.dependents, employed, unemployed: h.workforce - employed, employers: new Set(rows.map(e => e.firmId)).size }); assert.deepEqual(await evaluate('[...document.querySelectorAll("#entity-content .cx-employment-row")].map(e=>({householdId:Number(e.dataset.householdId),firmId:Number(e.dataset.firmId),occupation:e.dataset.occupation,rank:e.dataset.rank,skill:e.dataset.skill,workers:Number(e.dataset.workers)}))'), rows); assert.deepEqual(await evaluate('[...document.querySelectorAll("#entity-content .cx-skill-row")].map(e=>({skill:e.dataset.skill,total:Number(e.dataset.total),employed:Number(e.dataset.employed),unemployed:Number(e.dataset.unemployed)}))'), skills.map(skill => { const employed = rows.filter(e => e.skill === skill).reduce((n, e) => n + e.workers, 0); return { skill, total: h.workerSkills[skill], employed, unemployed: h.workerSkills[skill] - employed }; })); }
async function screenshot(name) { await evaluate('document.querySelector("#inspector-body").scrollTop=0'); await paints(); const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); await writeFile(resolve(shots, name), Buffer.from(r.data, 'base64')); screenshots.push(name); }
async function viewport(metric) { await close(); await send('Emulation.setDeviceMetricsOverride', { ...metric, deviceScaleFactor: 1 }); await send('Emulation.setTouchEmulationEnabled', { enabled: metric.mobile, maxTouchPoints: 2 }); await until(`innerWidth===${metric.width}&&screen.width===${metric.screenWidth}&&document.querySelector('#city-canvas').clientWidth===${metric.width}`); await paints(); }
async function layout() { const m = await evaluate(`(()=>{const p=document.querySelector('#inspector'),r=p.getBoundingClientRect(),b=document.querySelector('#inspector-body'),k=Math.min(1,screen.width/innerWidth);return{width:innerWidth,height:innerHeight,screenWidth:screen.width,left:r.left,right:r.right,top:r.top,bottom:r.bottom,bodyWidth:b.clientWidth,bodyScroll:b.scrollWidth,buttons:['#submenu-back','#close-inspector'].map(s=>{const e=document.querySelector(s),r=e.getBoundingClientRect();return{selector:s,w:r.width*k,h:r.height*k,hit:!!document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest(s)}})}})()`); assert.ok(m.left >= 0 && m.right <= m.width + 1 && m.top >= 0 && m.bottom <= m.height + 1, JSON.stringify(m)); assert.ok(m.bodyScroll <= m.bodyWidth + 1); assert.ok(m.buttons.every(b => b.w >= 43.5 && b.h >= 43.5 && b.hit), JSON.stringify(m)); layouts.push(m); }

try {
  let tabs; for (let n = 0; n < 100; n++) { try { tabs = await (await fetch('http://127.0.0.1:9349/json/list')).json(); break; } catch { await sleep(100); } }
  assert.ok(tabs?.some(t => t.type === 'page')); ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl); await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  ws.onmessage = event => { const m = JSON.parse(event.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(Error(JSON.stringify(m.error))) : p.resolve(m.result); } if (m.method === 'Page.javascriptDialogOpening') void core.dialog(m.params, send).catch(error => errors.push(String(error))); if (m.method === 'Network.requestWillBeSent') { const requested = m.params.request.url; if (networkProbe?.active && requested === networkProbe.url) networkProbe.requestId = m.params.requestId; else { if (isPanelProviderRequest(requested)) providerRequests.push(requested); if (/^https?:/.test(requested) && new URL(requested).origin !== origin) externalRequests.push(new URL(requested).origin + new URL(requested).pathname); } } if (m.method === 'Network.loadingFailed' && m.params.requestId === networkProbe?.requestId) networkProbe.failed = m.params; if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails); if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') { const a = m.params.args, expected = blocked && a.length === 2 && /^Failed to load resource \[\/CityManager\/assets\/kenney-city\/models\/([a-z]+(?:-[a-z]+)?)\.glb-container\]: Network error$/.test(a[0]?.value) && a[1]?.value === 'Network error'; (expected ? expectedErrors : errors).push(a); } };
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable'); await core.install(send); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, screenWidth: 1440, screenHeight: 1000, deviceScaleFactor: 1, mobile: false });
  await installTrafficNetworkFence({ send, evaluate, protocol: await (await fetch('http://127.0.0.1:9349/json/protocol')).json(), origin, blockedModels: blocked, additionalBlocked: [...panelProviderDenials(origin), origin + '/api/city-advisor/*', origin + '/*/api/city-advisor/*'], observeProbe: probe => (networkProbe = { url: probe }) });
  const v1MigratedRaw = serialize(migratedV1);
  await loadRaw(v1MigratedRaw, migratedV1); assert.equal(server.active.raw, v1MigratedRaw);
  await loadRaw(oldRaw, imported);
  const originalAck = server.active;
  await household(imported, imported.households[0].id);
  assert.equal(await evaluate('document.querySelector("#entity-content [data-skill-source]")?.dataset.skillSource'), 'legacy-assumed');
  assert.equal(server.active.raw, oldRaw); assert.equal(server.active.revision, originalAck.revision);
  checks.push('Strictly migrated frozen v1 and raw frozen v2 enter through real server ACK, preserves money/goods/claims/jobs and labels inferred skills; original server bytes stay unchanged');

  await page('game'); await core.settle(); const failedHead = server.active, faultIndex = server.attempts.length;
  server.setFault(true); await button('#save');
  await until("!document.querySelector('#save-failure-banner').hidden");
  assert.deepEqual(server.active, failedHead, 'Refused save leaves acknowledged head unchanged');
  assert.deepEqual(await state(), imported); await core.assertNoCityWrites(evaluate);
  server.setFault(false); await button('#save-failure-retry');
  const retryDeadline = Date.now() + 30000;
  while (server.active.revision < failedHead.revision + 2 && Date.now() < retryDeadline) await sleep(80);
  await until("document.querySelector('#save-failure-banner').hidden"); server.assertRetry(faultIndex, failedHead);
  const savedRaw = server.active.raw, savedCity = deserializeParkSession(savedRaw).city;
  assert.deepEqual(savedCity.accounts, importedMoney); assert.deepEqual(savedCity.households, importedPeople); assert.deepEqual(savedCity.goods, importedGoods);
  const saved = server.active; await reloadCity(imported, saved);
  checks.push('Server save failure preserves the exact acknowledged head; retry reuses intent and ACKs current state, then real reload restores all records');

  await load(before); await oneTick(after); assert.deepEqual(await state(), after); await household(after, familyId); await screenshot('worker-household.png');
  checks.push('One actual daily tick equals unedited deterministic replay: a funded retail vacancy takes only the general worker while manufacturing worker and dependent remain correctly counted in the same family');

  for (const job of jobs) {
    const f = after.firms.find(f => f.id === job.firmId), rows = employmentForFirm(after, f.id), ids = [...new Set(rows.map(e => e.householdId))]; await place(after, f.building);
    await metrics({ workers: firmWorkerCount(after, f.id), 'household-count': ids.length });
    assert.deepEqual(await evaluate('[...document.querySelectorAll("#entity-content [data-household-id]")].map(e=>({id:Number(e.dataset.householdId),workers:Number(e.dataset.assignedWorkers),roles:[...e.querySelectorAll(".cx-assigned-role")].map(r=>({skill:r.dataset.skill,occupation:r.dataset.occupation,workers:Number(r.dataset.workers)}))}))'), ids.map(id => ({ id, workers: rows.filter(e => e.householdId === id).reduce((n, e) => n + e.workers, 0), roles: rows.filter(e => e.householdId === id).map(e => ({ skill: e.skill, occupation: e.occupation, workers: e.workers })) })));
    await button(`#entity-content [data-household-id="${familyId}"]`); await until(`document.querySelector('#entity-content').dataset.scope==='household'&&document.querySelector('#entity-content').dataset.entityId==='${familyId}'`); await button('#submenu-back'); assert.equal((await route()).id, String(f.building));
    if (f.zone === 'C') await screenshot('worker-firm.png');
  }
  checks.push('Each firm shows its own assigned worker counts and actual role/skill subsets, never the entire family; household links and Back retain source-firm scope');

  await close(); await button('[data-tool="bulldoze"]'); await paints(); const point = await evaluate(`window.cityManager.cellScreen(${after.buildings.find(b => b.id === shop.building).cell})`); assert.equal(await evaluate(`document.elementFromPoint(${point.x},${point.y})?.id`), 'city-canvas'); await click(point.x, point.y); assert.deepEqual(await state(), dismissed); await household(dismissed, familyId); await metrics({ employed: 1, unemployed: 1, dependents: 1 }); await screenshot('worker-dismissal.png');
  checks.push('Real employer demolition dismisses only its assigned worker, retains family membership/capability/home and other job, and pays earned wages into the shared household account without forfeiture');

  await load(payrollBefore); await oneTick(payrollAfter); await household(payrollAfter, familyId); await metrics({ cash: payrollAfter.accounts[family.wallet] }); await screenshot('worker-payroll.png'); assert.deepEqual((await state()).ledger.slice(payrollBefore.ledger.length).filter(e => e.to === family.wallet && e.reason === 'Monthly wages'), wageEntries);
  checks.push('A real monthly settlement matches the full replay: multiple employers debit their actual wallets and pay exact wages into one shared household wallet, retaining tax/rent and journal reconciliation');

  await load(after);
  for (const metric of [{ width: 360, height: 740, screenWidth: 360, screenHeight: 780, mobile: true }, { width: 844, height: 390, screenWidth: 844, screenHeight: 390, mobile: true }, { width: 980, height: 2120, screenWidth: 390, screenHeight: 844, mobile: true }]) {
    await viewport(metric); await household(after, familyId); await layout(); if (metric.width === 360) await screenshot('worker-phone.png');
    const b = after.buildings.find(b => b.id === family.home), camera = await evaluate(`window.cityManager.cellScreen(${b.cell})`); await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: camera.x, y: camera.y, deltaX: 0, deltaY: -180 }); assert.deepEqual(await evaluate(`window.cityManager.cellScreen(${b.cell})`), camera);
    await key('Escape'); assert.equal((await route()).scope, 'place'); assert.equal((await route()).id, String(family.home)); await key('Escape'); assert.notEqual((await route()).open, 'true');
    await page('game'); await layout(); const saved = await saveCity(after); await reloadCity(after, saved); await close();
  }
  await core.assertNoCityWrites(evaluate); assert.deepEqual(httpErrors, []); assert.deepEqual(externalRequests, []); assert.deepEqual(providerRequests, [], 'No provider endpoint attempts');
  assert.deepEqual(errors, []); modelAudit.assertComplete();
  checks.push('360 phone, landscape and 980-layout/screen390 keep exact capability rows and 44px navigation contained; open-panel camera isolation, Back/Escape, server ACK and reload roundtrip pass without unexpected errors');
  const version = await send('Browser.getVersion'), report = { date: new Date().toISOString(), url, browser: version.product, checks, errors, expectedModelErrors: expectedErrors.length, fixture, payrollTick: payrollAfter.tick, wageEntries, layouts, screenshots, note: 'Installed headless Edge with viewport/touch emulation; no physical-phone or individual-person simulation claim.' };
  await writeFile(resolve(output, 'worker-report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} catch (error) { server.setFault(false); if (ws?.readyState === 1) try { await screenshot('worker-failure.png'); console.error('Route:', await route()); console.error('Startup recovery:', await evaluate('({open:!!document.querySelector("#startup-recovery-chooser[open]"),message:document.querySelector("#startup-recovery-status")?.textContent??null})')); } catch {} console.error('Unexpected browser errors:', errors); throw error; }
finally { if (ws?.readyState === 1) { try { await send('Browser.close'); } catch {} ws.close(); } child.kill(); proxy.closeAllConnections(); await new Promise(resolve => proxy.close(resolve)); }
