// Household/housing acceptance on worker schema v6. Root runs suites sequentially.
// The browser receives only strict-valid public-simulation fixtures via real Load.
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { firmWage, createCity, step, serialize, deserialize, bulldoze, summary, housingCapacity, homeOccupancy, firmWorkerCount, householdWorkerCount, employmentForHousehold, employmentForFirm, WAGES, MONTH } from '../src/sim.ts';
import { reachTouch } from './touch-reach.mjs';

const url = process.env.CITYMANAGER_URL || 'http://127.0.0.1:4173/CityManager/';
const output = resolve('.test-output'), shots = resolve(process.env.CITYMANAGER_SCREENSHOT_DIR || 'docs/population-preview');
const blocked = process.env.CITYMANAGER_BLOCK_MODELS === '1';
const checks = [], errors = [], expectedErrors = [], screenshots = [], layouts = [];
const legacyRaw = await readFile(new URL('./fixtures/legacy-v1-day65.json', import.meta.url), 'utf8'), legacy = JSON.parse(legacyRaw);
const householdV2Raw = await readFile(new URL('./fixtures/legacy-v2-day180.json', import.meta.url), 'utf8');
const workerV3Raw = await readFile(new URL('./fixtures/legacy-v3-day180.json', import.meta.url), 'utf8');
const hash = raw => createHash('sha256').update(raw).digest('hex');
assert.equal(hash(legacyRaw), '4e358e66acdfb55dcfd434aaf67be51ccea99c69fc5a2b9b44343035c16166d0');
assert.equal(hash(householdV2Raw), '0c33c983c1e71063496f4a95b935c22647b972c0084d2ce98449b7e7b8c13475');
assert.equal(hash(workerV3Raw), '59518ff5b7d2a7c7de52ef8cb8362ed387f91df67ffc09934c93e97f3a556693');
const householdV2Migrated = deserialize(householdV2Raw);
const workerV3Migrated = deserialize(workerV3Raw);
const migrated = deserialize(legacyRaw), migratedRaw = serialize(migrated);
for (const key of ['accounts', 'ledger', 'goodsLedger', 'goods']) assert.deepEqual(migrated[key], legacy[key], `Migration preserves ${key}`);
for (const key of ['seed', 'rng', 'tick', 'nextId']) assert.equal(migrated[key], legacy[key], `Migration preserves ${key}`);
for (const old of legacy.firms) { const firm = migrated.firms.find(f => f.id === old.id); assert.equal(firm.inventory, old.inventory); assert.deepEqual(firm.workDays, old.workDays); }
assert.deepEqual(deserialize(migratedRaw), migrated);

// Natural deterministic fixture: no fabricated people, wallets, stock or money.
const natural = createCity(61025), milestones = []; let vacantDay, upgradeDay;
for (let n = 0; n < 180; n++) {
  const previous = JSON.parse(serialize(natural)); step(natural); deserialize(serialize(natural));
  const newHomes = natural.buildings.filter(b => b.zone === 'R' && !previous.buildings.some(old => old.id === b.id));
  for (const home of newHomes) {
    assert.equal(home.age, 0); assert.deepEqual(homeOccupancy(natural, home.id), { households: 0, persons: 0 });
    if (!vacantDay) vacantDay = serialize(natural);
  }
  const arrival = natural.ledger.slice(previous.ledger.length).filter(e => e.reason === 'New household arrival savings');
  assert.ok(arrival.length <= 1, 'At most one new household per day');
  for (const entry of arrival) {
    assert.equal(entry.from, 'outside'); assert.equal(entry.amount, 150000);
    const h = natural.households.find(h => h.wallet === entry.to); assert.ok(h);
    assert.ok(previous.buildings.some(b => b.id === h.home && b.zone === 'R'), 'Arrival cannot occupy a home created this tick');
    assert.equal(natural.ledger.filter(e => e.reason === entry.reason && e.to === h.wallet).length, 1);
  }
  const upgraded = natural.buildings.filter(b => b.zone === 'R' && previous.buildings.some(old => old.id === b.id && old.level < b.level));
  if (!upgradeDay && upgraded.length && !arrival.length) {
    assert.deepEqual(natural.households.map(h => [h.id, h.home, h.members, h.workforce, h.dependents]), previous.households.map(h => [h.id, h.home, h.members, h.workforce, h.dependents]), 'Capacity upgrade alone creates no people');
    upgradeDay = serialize(natural);
  }
  if ([30, 65, 120, 180].includes(natural.tick)) milestones.push({ tick: natural.tick, hash: hash(serialize(natural)), ...summary(natural) });
}
assert.ok(vacantDay && upgradeDay, 'Natural replay includes vacant construction and a capacity-only upgrade');
// Preserve the published housing regression independently of new farm/market
// startup timings. Migration adds no input stock or new people/buildings.
const fixture = deserialize(workerV3Raw);
const family = fixture.households.find(h => h.profile === 'family' && h.workforce === 2), factory = fixture.firms.find(f => f.zone === 'I'), shop = fixture.firms.find(f => f.zone === 'C');
assert.ok(family && factory && shop); assert.equal(fixture.tick % MONTH, 0);
assert.ok(fixture.firms.every(f => Object.keys(f.workDays).length === 0), 'Split-employer scenario begins after real monthly settlement');
// Core-owner-approved bounded allocation scenario. Remove the family's prior
// assignment and shop assignments, then assign one actual worker to each firm.
// No economic history, people or wallet balance is edited.
const financialBeforeSplit = JSON.stringify([fixture.accounts, fixture.ledger, fixture.goodsLedger, fixture.goods, fixture.firms.map(f => [f.inventory, f.workDays])]);
fixture.employment = fixture.employment.filter(e => e.householdId !== family.id && e.firmId !== shop.id);
// This is a scoped GUI allocation fixture, not proof of the automatic matcher.
// The dedicated worker suite exercises matching through an actual daily tick.
const productionSkill = family.workerSkills.manufacturing > 0 ? 'manufacturing' : 'general';
const retailSkill = family.workerSkills.retail > 0 ? 'retail' : 'general';
fixture.employment.push({ householdId: family.id, firmId: factory.id, occupation: 'manufacturing', rank: 'entry', skill: productionSkill, workers: 1 }, { householdId: family.id, firmId: shop.id, occupation: 'retail', rank: 'entry', skill: retailSkill, workers: 1 });
assert.equal(JSON.stringify([fixture.accounts, fixture.ledger, fixture.goodsLedger, fixture.goods, fixture.firms.map(f => [f.inventory, f.workDays])]), financialBeforeSplit);
deserialize(serialize(fixture));
const fixtureRaw = serialize(fixture), sharedHome = fixture.buildings.find(b => b.zone === 'R' && homeOccupancy(fixture, b.id).households > 1);
assert.ok(sharedHome, 'Natural fixture contains a shared home');
const keys = ['citymanager.save.v7', 'citymanager.save.v6', 'citymanager.save.v5', 'citymanager.save.v4', 'citymanager.save.v3', 'citymanager.save.v2', 'citymanager.save.v1', 'citymanager.backup.latest', ...[1, 2, 3, 4, 5, 6].flatMap(version => [`citymanager.backup.v${version}`, ...Array.from({ length: 7 }, (_, i) => `citymanager.backup.v${version}.${i + 1}`)])];
await mkdir(output, { recursive: true }); await mkdir(shots, { recursive: true });
let occupied = false; try { occupied = (await fetch('http://127.0.0.1:9349/json/version', { signal: AbortSignal.timeout(500) })).ok; } catch {}
assert.equal(occupied, false, 'Run browser suites sequentially; CDP 9349 is occupied');
const child = spawn(process.env.CITYMANAGER_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-component-update', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=9349', `--user-data-dir=${resolve(output, 'edge-profile')}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
let ws, sequence = 0; const pending = new Map();
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function send(method, params = {}) {
  const id = ++sequence;
  const result = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout: ${method}`)); }, 30000);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
  });
  ws.send(JSON.stringify({ id, method, params })); return result;
}
async function evaluate(expression) { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; }
async function until(expression) { const start = Date.now(); while (Date.now() - start < 15000) { if (await evaluate(expression)) return; await sleep(60); } throw Error(`Timed out: ${expression}`); }
const paints = () => evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
const state = () => evaluate('(()=>{const c=JSON.parse(window.cityManager.snapshot());if(c.version===11||c.version===12||c.version===13||c.version===14){c.version=9;c.rulesVersion="chain-4"}return c})()');
const route = () => evaluate('({page:document.querySelector("#inspector").dataset.page,open:document.querySelector("#inspector").dataset.open,scope:document.querySelector("#entity-content").dataset.scope,id:document.querySelector("#entity-content").dataset.entityId})');
async function click(x, y) { for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: 1 }); }
async function button(selector) { if (await reachTouch(evaluate, button, selector)) return;
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest',inline:'nearest'})`); await paints();
  const p = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect(),k=Math.min(1,screen.width/innerWidth);return{x:r.x+r.width/2,y:r.y+r.height/2,width:r.width,height:r.height,physicalWidth:r.width*k,physicalHeight:r.height*k,touch:navigator.maxTouchPoints>0,disabled:e.disabled}})()`);
  assert.ok(p.width && p.height && !p.disabled, `Visible enabled ${selector}`);
  if (p.touch) assert.ok(p.physicalWidth >= 43.5 && p.physicalHeight >= 43.5, `44px physical touch target ${selector}: ${JSON.stringify(p)}`);
  assert.equal(await evaluate(`!!document.elementFromPoint(${p.x},${p.y})?.closest(${JSON.stringify(selector)})`), true, `Actually hit ${selector}: ${JSON.stringify(p)}`);
  await click(p.x, p.y);
}
async function close() { if ((await route()).open === 'true') await button('#close-inspector'); await paints(); }
async function page(name) { if ((await route()).open !== 'true' || (await route()).page !== name) { await close(); await button(name === 'city' ? '#toggle-inspector' : name === 'help' ? '#toggle-help' : '#toggle-game-menu'); } await until(`document.querySelector('#inspector').dataset.page===${JSON.stringify(name)}&&document.querySelector('#inspector').dataset.open==='true'`); }
async function key(value) { for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: value, code: value, windowsVirtualKeyCode: value === 'Escape' ? 27 : undefined }); }
async function load(raw) { await page('game'); await evaluate(`localStorage.setItem('citymanager.save.v7',${JSON.stringify(raw)})`); await button('#load'); assert.deepEqual(await state(), deserialize(raw)); await close(); }
async function place(building) { await close(); await button('[data-tool="select"]'); await paints(); const p = await evaluate(`window.cityManager.cellScreen(${building.cell})`); assert.equal(await evaluate(`document.elementFromPoint(${p.x},${p.y})?.id`), 'city-canvas', `Actual canvas cell ${building.cell}`); await click(p.x, p.y); await until(`document.querySelector('#entity-content').dataset.scope==='place'&&document.querySelector('#entity-content').dataset.entityId==='${building.id}'`); }
async function metrics(expected, root = '#entity-content') { const actual = await evaluate(`Object.fromEntries([...document.querySelectorAll(${JSON.stringify(root + ' [data-context-metric]')})].map(e=>[e.dataset.contextMetric,e.dataset.value]))`); for (const [key, value] of Object.entries(expected)) assert.equal(actual[key], String(value), `Exact ${root} metric ${key}`); }
async function household(h, source, city = fixture) {
  await place(source); await button(`#entity-content [data-household-id="${h.id}"]`); await until(`document.querySelector('#entity-content').dataset.scope==='household'&&document.querySelector('#entity-content').dataset.entityId==='${h.id}'`);
  const rows = employmentForHousehold(city, h.id), employed = householdWorkerCount(city, h.id);
  await metrics({ cash: city.accounts[h.wallet], members: h.members, workforce: h.workforce, dependents: h.dependents, employed, unemployed: h.workforce - employed, employers: new Set(rows.map(e => e.firmId)).size, home: h.home === null ? 'null' : h.home, needs: h.needs, 'last-purchase': h.lastPurchaseTick });
  assert.deepEqual(await evaluate('[...document.querySelectorAll("#entity-content .cx-employment-row")].map(e=>({householdId:Number(e.dataset.householdId),firmId:Number(e.dataset.firmId),workers:Number(e.dataset.workers),occupation:e.dataset.occupation,rank:e.dataset.rank,skill:e.dataset.skill}))'), rows);
  assert.deepEqual(await evaluate('[...document.querySelectorAll("#entity-content .cx-skill-row")].map(e=>({skill:e.dataset.skill,total:Number(e.dataset.total),employed:Number(e.dataset.employed),unemployed:Number(e.dataset.unemployed)}))'), ['general', 'manufacturing', 'retail'].map(skill => { const employed = rows.filter(a => a.skill === skill).reduce((n, a) => n + a.workers, 0); return { skill, total: h.workerSkills[skill], employed, unemployed: h.workerSkills[skill] - employed }; }));
  assert.equal(await evaluate('!!document.querySelector("#entity-content .cx-legacy-assumption")'), h.origin === 'legacy-v1');
}
async function home(city, b) {
  await place(b); const used = homeOccupancy(city, b.id), cap = housingCapacity(b);
  await metrics({ households: used.households, persons: used.persons, 'vacant-households': cap.households - used.households, 'vacant-persons': cap.persons - used.persons, level: b.level, age: b.age });
  assert.deepEqual(await evaluate('[...document.querySelectorAll("#entity-content [data-household-id]")].map(e=>Number(e.dataset.householdId))'), city.households.filter(h => h.home === b.id).map(h => h.id));
  for (const [metric, value] of [['households', cap.households], ['persons', cap.persons]]) assert.equal(await evaluate(`Number(document.querySelector('#entity-content [data-context-metric="${metric}"]').dataset.capacity)`), value);
}
async function cityMetrics(city) {
  await page('city'); const s = summary(city), housed = city.households.filter(h => h.home !== null), persons = housed.reduce((n, h) => n + h.members, 0);
  await metrics({ population: s.population, households: s.households, workforce: s.workforce, dependents: s.dependents, employed: s.employed, unemployed: s.unemployed, homeless: s.homeless, 'homeless-persons': s.population - persons, 'home-slots': s.homeSlots, 'person-capacity': s.personCapacity, 'occupied-home-slots': housed.length, 'occupied-persons': persons, 'housing-vacancy': s.homeSlots - housed.length, 'person-vacancy': s.personCapacity - persons, treasury: city.accounts.treasury }, '#city-overview');
}
async function storage() { return evaluate(`Object.fromEntries(${JSON.stringify(keys)}.map(key=>[key,localStorage.getItem(key)]))`); }
async function screenshot(name) { await paints(); const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); await writeFile(resolve(shots, name), Buffer.from(r.data, 'base64')); screenshots.push(name); }
async function viewport(metric) { await close(); await send('Emulation.setDeviceMetricsOverride', { ...metric, deviceScaleFactor: metric.deviceScaleFactor ?? 1 }); await send('Emulation.setTouchEmulationEnabled', { enabled: metric.mobile, maxTouchPoints: 2 }); await until(`innerWidth===${metric.width}&&screen.width===${metric.screenWidth}&&document.querySelector('#city-canvas').clientWidth===${metric.width}`); await paints(); }
async function layout() {
  const m = await evaluate(`(()=>{const p=document.querySelector('#inspector'),r=p.getBoundingClientRect(),b=document.querySelector('#inspector-body'),k=Math.min(1,screen.width/innerWidth);return{width:innerWidth,height:innerHeight,screenWidth:screen.width,left:r.left,right:r.right,top:r.top,bottom:r.bottom,bodyWidth:b.clientWidth,bodyScroll:b.scrollWidth,buttons:['#submenu-back','#close-inspector'].map(s=>{const e=document.querySelector(s),r=e.getBoundingClientRect();return{selector:s,w:r.width*k,h:r.height*k,hit:!!document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest(s)}})}})()`);
  assert.ok(m.left >= 0 && m.right <= m.width + 1 && m.top >= 0 && m.bottom <= m.height + 1, JSON.stringify(m)); assert.ok(m.bodyScroll <= m.bodyWidth + 1); assert.ok(m.buttons.every(b => b.w >= 43.5 && b.h >= 43.5 && b.hit), JSON.stringify(m)); layouts.push(m);
}

try {
  let tabs; for (let n = 0; n < 100; n++) { try { tabs = await (await fetch('http://127.0.0.1:9349/json/list')).json(); break; } catch { await sleep(100); } }
  assert.ok(tabs?.some(t => t.type === 'page')); ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl); await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  ws.onmessage = event => {
    const m = JSON.parse(event.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(Error(JSON.stringify(m.error))) : p.resolve(m.result); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') { const a = m.params.args, expected = blocked && a.length === 2 && /^Failed to load resource \[\/CityManager\/assets\/kenney-city\/models\/([a-z]+(?:-[a-z]+)?)\.glb-container\]: Network error$/.test(a[0]?.value) && a[1]?.value === 'Network error'; (expected ? expectedErrors : errors).push(a); }
    if (m.method === 'Fetch.requestPaused') void send('Fetch.failRequest', { requestId: m.params.requestId, errorReason: 'Failed' });
  };
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, screenWidth: 1440, screenHeight: 1000, deviceScaleFactor: 1, mobile: false });
  if (blocked) await send('Fetch.enable', { patterns: [{ urlPattern: '*kenney-city/models/*.glb', requestStage: 'Request' }] });
  await send('Page.navigate', { url: url + '?starter=1' }); await until('!!window.cityManager'); await until('window.cityManager.visuals().ready');
  if (await evaluate('document.querySelector("#pause").getAttribute("aria-pressed")!=="true"')) await button('#pause');

  // Only test-owned keys in this isolated QA profile are reset. Loading is never
  // allowed to write a migration, advance the clock or duplicate arrival savings.
  const sentinel = serialize(createCity(91));
  await evaluate(`for(const key of ${JSON.stringify(keys)})localStorage.removeItem(key);localStorage.setItem('citymanager.save.v1',${JSON.stringify(legacyRaw)});localStorage.setItem('citymanager.save.v2',${JSON.stringify(householdV2Raw)});localStorage.setItem('citymanager.save.v3',${JSON.stringify(workerV3Raw)});localStorage.setItem('citymanager.save.v7',${JSON.stringify(sentinel)})`);
  await page('game'); const beforeImport = await storage(); await button('#load-legacy'); assert.deepEqual(await state(), migrated); assert.deepEqual(await storage(), beforeImport);
  await button('#load-legacy'); await button('#load-legacy'); assert.deepEqual(await state(), migrated); assert.deepEqual(await storage(), beforeImport);
  checks.push('Explicit strict v1 import is idempotent: exact frozen money/goods/claims/tick/RNG; loading never writes or repeats grants');

  // A failed backup must abort BEFORE replacing a different valid v6 save.
  await evaluate('window.__populationStorageSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.startsWith("citymanager.backup.v1"))throw new DOMException("Acceptance backup quota", "QuotaExceededError");return window.__populationStorageSet.call(this,k,v)}');
  try { await button('#save'); assert.deepEqual(await storage(), beforeImport); assert.deepEqual(await state(), migrated); assert.equal(await evaluate('document.querySelector("#inspector-status").textContent.includes("Saved day")'), false); }
  finally { await evaluate('Storage.prototype.setItem=window.__populationStorageSet;delete window.__populationStorageSet'); }
  await button('#save'); const backed = await storage(); assert.equal(backed['citymanager.save.v1'], legacyRaw); assert.equal(backed['citymanager.backup.v1'], legacyRaw); assert.equal(backed['citymanager.save.v7'], migratedRaw);
  assert.equal(Object.entries(backed).filter(([key, raw]) => key.startsWith('citymanager.backup.v1') && raw !== null).length, 1);
  await button('#save'); assert.deepEqual(await storage(), backed); checks.push('Actual Save backs original v1 bytes immutably before v6; backup quota preserves old primary and repeated Save creates no duplicate backups');

  await evaluate('localStorage.setItem("citymanager.save.v7","{broken")'); const corrupt = await storage(); await button('#load'); assert.deepEqual(await state(), migrated); assert.deepEqual(await storage(), corrupt);
  await button('#load-backup'); assert.deepEqual(await state(), migrated); assert.deepEqual(await storage(), corrupt); await button('#save'); assert.deepEqual(await storage(), backed);
  await load(fixtureRaw); await page('game'); await evaluate(`localStorage.setItem('citymanager.save.v7',${JSON.stringify(sentinel)})`); const beforeQuota = await storage(), stateBeforeQuota = await state();
  await evaluate('window.__populationStorageSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==="citymanager.save.v7")throw new DOMException("Acceptance primary quota", "QuotaExceededError");return window.__populationStorageSet.call(this,k,v)}');
  try { await button('#save'); assert.deepEqual(await storage(), beforeQuota); assert.deepEqual(await state(), stateBeforeQuota); assert.equal(await evaluate('document.querySelector("#inspector-status").textContent.includes("Saved day")'), false); }
  finally { await evaluate('Storage.prototype.setItem=window.__populationStorageSet;delete window.__populationStorageSet'); }
  checks.push('Corrupt preferred v6 rejects without fallback or mutation; explicit backup recovers; primary quota preserves all current and stored state');

  const vacant = deserialize(vacantDay), vacantHome = vacant.buildings.find(b => b.zone === 'R' && b.age === 0);
  await load(vacantDay); await home(vacant, vacantHome); await metrics({ households: 0, persons: 0 }); await screenshot('vacant-new-home.png');
  const upgraded = deserialize(upgradeDay); await load(upgradeDay); await cityMetrics(upgraded);
  checks.push('Validated natural daily replay: new homes begin vacant, arrivals occur on later days at most once/day, each family funded once, capacity upgrades create no people');

  await load(fixtureRaw); await home(fixture, sharedHome); await screenshot('shared-home.png');
  await household(family, fixture.buildings.find(b => b.id === family.home)); assert.equal(await evaluate('document.querySelectorAll("#entity-content .cx-employment-row").length'), 2); await screenshot('family-split-employers.png');
  await button('#submenu-back'); assert.equal((await route()).id, String(family.home));
  await household(family, fixture.buildings.find(b => b.id === family.home)); await key('Escape'); assert.equal((await route()).id, String(family.home));
  checks.push('Actual shared-home capacities and family composition distinguish members, workforce, dependents and two canonical employers; Back/Escape return to source home');

  for (const firm of [factory, shop]) {
    const b = fixture.buildings.find(b => b.id === firm.building), allocations = employmentForFirm(fixture, firm.id), ids = [...new Set(allocations.map(e => e.householdId))], reserve = Object.values(firm.workDays).reduce((n, days) => n + days * firmWage(firm) / MONTH, 0);
    await place(b); await metrics({ workers: firmWorkerCount(fixture, firm.id), 'household-count': ids.length, cash: fixture.accounts[firm.wallet], reserved: reserve, stock: firm.inventory });
    assert.deepEqual(await evaluate('[...document.querySelectorAll("#entity-content [data-household-id]")].map(e=>({id:Number(e.dataset.householdId),workers:Number(e.dataset.assignedWorkers)}))'), ids.map(id => ({ id, workers: allocations.filter(e => e.householdId === id).reduce((n, e) => n + e.workers, 0) })));
    await button(`#entity-content [data-household-id="${family.id}"]`); await until(`document.querySelector('#entity-content').dataset.entityId==='${family.id}'&&document.querySelector('#entity-content').dataset.scope==='household'`); await button('#submenu-back'); assert.equal((await route()).id, String(b.id));
  }
  await cityMetrics(fixture); assert.ok(summary(fixture).population > summary(fixture).households); assert.equal(summary(fixture).population, summary(fixture).workforce + summary(fixture).dependents);
  checks.push('Firm rows count actual assigned workers once per household; city totals derive persons, households, workers, vacancies and homelessness from canonical entities');

  const expectedDemolished = deserialize(fixtureRaw), displaced = expectedDemolished.households.filter(h => h.home === sharedHome.id).map(h => ({ ...h })), claimsBefore = expectedDemolished.firms.map(f => ({ id: f.id, workDays: { ...f.workDays } }));
  assert.equal(bulldoze(expectedDemolished, sharedHome.cell).ok, true);
  await place(sharedHome); await button('[data-tool="bulldoze"]'); await close(); await paints(); const point = await evaluate(`window.cityManager.cellScreen(${sharedHome.cell})`); assert.equal(await evaluate(`document.elementFromPoint(${point.x},${point.y})?.id`), 'city-canvas'); await click(point.x, point.y);
  assert.deepEqual(await state(), expectedDemolished); assert.equal(expectedDemolished.accounts.treasury, fixture.accounts.treasury - 2000);
  for (const old of displaced) { const h = expectedDemolished.households.find(h => h.id === old.id); assert.deepEqual(h, { ...old, home: null }); assert.equal(expectedDemolished.accounts[h.wallet], fixture.accounts[h.wallet]); assert.equal(householdWorkerCount(expectedDemolished, h.id), 0); }
  assert.deepEqual(expectedDemolished.firms.map(f => ({ id: f.id, workDays: f.workDays })), claimsBefore); assert.equal(expectedDemolished.migration.arrivals, fixture.migration.arrivals);
  await cityMetrics(expectedDemolished); await screenshot('displaced-households.png'); checks.push('Real demolition displaces every occupant, preserves identities/members/wallets/claims, clears affected jobs and charges only recorded demolition cost');

  const expectedRehoused = deserialize(serialize(expectedDemolished)); step(expectedRehoused); deserialize(serialize(expectedRehoused));
  await close(); await button('[data-speed="1"]'); await button('#pause'); await until(`JSON.parse(window.cityManager.snapshot()).tick>=${expectedRehoused.tick}`); await button('#pause'); assert.deepEqual(await state(), expectedRehoused);
  for (const old of displaced) { const h = expectedRehoused.households.find(h => h.id === old.id); assert.notEqual(h.home, null); assert.equal(h.members, old.members); assert.equal(h.wallet, old.wallet); assert.equal(expectedRehoused.ledger.filter(e => e.to === h.wallet && e.reason === 'New household arrival savings').length, 1); }
  assert.equal(expectedRehoused.migration.arrivals, fixture.migration.arrivals); await cityMetrics(expectedRehoused);
  await page('game'); await button('#save'); const savedV3 = await evaluate('localStorage.getItem("citymanager.save.v7")'); assert.equal(savedV3, serialize(expectedRehoused)); await button('#load'); assert.deepEqual(await state(), expectedRehoused); assert.equal(await evaluate('localStorage.getItem("citymanager.save.v1")'), legacyRaw); assert.equal(await evaluate('localStorage.getItem("citymanager.backup.v1")'), legacyRaw); assert.equal(await evaluate('localStorage.getItem("citymanager.save.v2")'), householdV2Raw);
  checks.push('One real daily tick matches deterministic replay: existing displaced families rehouse before new arrivals without repeat grants; exact v6 Save/Load retains original v1 and backup');

  await load(fixtureRaw);
  for (const metric of [{ width: 360, height: 740, screenWidth: 360, screenHeight: 780, mobile: true }, { width: 844, height: 390, screenWidth: 844, screenHeight: 390, mobile: true }, { width: 980, height: 2120, screenWidth: 390, screenHeight: 844, mobile: true }]) {
    await viewport(metric); await home(fixture, sharedHome); await layout(); await household(family, fixture.buildings.find(b => b.id === family.home)); await layout(); if (metric.width === 360) await screenshot('phone-family.png'); await cityMetrics(fixture); await layout(); await page('game'); await layout();
    for (const id of ['save', 'load', 'load-v3', 'load-v2', 'load-legacy', 'load-backup', 'new-city']) {
      await button(`#${id}`);
      if (id === 'new-city') { await key('Escape'); assert.deepEqual(await state(), fixture); continue; }
      if (id === 'load-v3') { assert.deepEqual(await state(), workerV3Migrated); assert.equal(await evaluate('localStorage.getItem("citymanager.save.v3")'), workerV3Raw); await load(fixtureRaw); await page('game'); }
      else if (id === 'load-v2') { assert.deepEqual(await state(), householdV2Migrated); assert.equal(await evaluate('localStorage.getItem("citymanager.save.v2")'), householdV2Raw); await load(fixtureRaw); await page('game'); }
      else if (id === 'load-legacy' || id === 'load-backup') { assert.deepEqual(await state(), migrated); await load(fixtureRaw); await page('game'); }
      else assert.deepEqual(await state(), fixture);
    }
    await key('Escape'); assert.notEqual((await route()).open, 'true');
  }
  // Restore the intended v4 test city after recovery-button layout exercises.
  await load(fixtureRaw); assert.deepEqual(await state(), fixture); assert.deepEqual(errors, []);
  const visuals = await evaluate('window.cityManager.visuals()'); if (blocked) { assert.equal(expectedErrors.length, 41); assert.equal(visuals.failed.length, 41); } else { assert.equal(visuals.loaded.length, 41); assert.equal(visuals.failed.length, 0); }
  checks.push('360 phone, landscape and 980-layout/screen390 keep new contexts and recovery controls contained with real 44px Back/close; no unexpected runtime errors');
  const version = await send('Browser.getVersion'), report = { date: new Date().toISOString(), url, browser: version.product, checks, errors, expectedModelErrors: expectedErrors.length, fixture: { seed: fixture.seed, tick: fixture.tick, hash: hash(fixtureRaw), legacySha256: hash(legacyRaw), naturalHash: hash(serialize(natural)), employmentScenario: 'Two real family workers split across existing I/C firms; no accounts/journals/people edited' }, milestones, layouts, screenshots, note: 'Installed headless Edge; touch/viewport and physical-screen ratio emulated. No real-phone QA or performance claim.' };
  await writeFile(resolve(output, 'population-report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} catch (error) { if (ws?.readyState === 1) try { await screenshot('population-failure.png'); console.error('Route:', await route()); } catch {} console.error('Unexpected browser errors:', errors); throw error; }
finally { if (ws?.readyState === 1) { try { await send('Browser.close'); } catch {} ws.close(); } child.kill(); }
