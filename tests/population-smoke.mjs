import { panelProviderDenials, isPanelProviderRequest } from './panel-network-denies.mjs';
import { createPanelModelAudit } from './panel-model-audit.mjs';
import { browserSnapshotState } from './browser-snapshot.ts';
import { populationFixture, population2000Fixture } from './population-capacity-fixture.ts';
import { panelEntryCity, loadPanelCity, saveAndReloadPanel, assertPanelSaveChain } from './panel-ui-server.mjs';
import { startTrafficHttpFixture, reachTrafficControl, installTrafficNetworkFence } from './traffic-server-entry-fixture.mjs';
import { installPopulationSaveFault } from './population-server-fault.mjs';
// Household/housing acceptance using authenticated isolated server persistence.
// The browser receives only strict-valid synthetic fixtures; no local city copy is used.
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { adoptSavedEducation, firmWage, createCity, step, serialize, deserialize, bulldoze, summary, housingCapacity, homeOccupancy, firmWorkerCount, householdWorkerCount, employmentForHousehold, employmentForFirm, WAGES, MONTH } from '../src/sim.ts';

const upstream = process.env.CITYMANAGER_URL || 'http://127.0.0.1:4173/CityManager/';
const output = resolve('.test-output'), shots = resolve(process.env.CITYMANAGER_SCREENSHOT_DIR || 'docs/population-preview');
const blocked = process.env.CITYMANAGER_BLOCK_MODELS === '1';
const mobilityOnly = process.argv.includes('--housing-mobility');
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
adoptSavedEducation(householdV2Migrated); adoptSavedEducation(workerV3Migrated); adoptSavedEducation(migrated);

// Natural deterministic fixture: no fabricated people, wallets, stock or money.
const natural = createCity(61025), milestones = []; let vacantDay, upgradeDay;
for (let n = 0; n < 180; n++) {
  const previous = JSON.parse(serialize(natural)); step(natural); deserialize(serialize(natural));
  const newHomes = natural.buildings.filter(b => b.zone === 'R' && !previous.buildings.some(old => old.id === b.id));
  for (const home of newHomes) {
    assert.equal(home.age, 0); assert.deepEqual(homeOccupancy(natural, home.id), { households: 0, persons: 0 });
    if (!vacantDay) vacantDay = serialize(natural);
  }
  const arrival = natural.ledger.filter(e => e.tick === natural.tick && e.reason === 'New household arrival savings');
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
let fixture = deserialize(workerV3Raw);
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
adoptSavedEducation(fixture);
const fixtureRaw = serialize(fixture); fixture=panelEntryCity(fixtureRaw);
const sharedHome = fixture.buildings.find(b => b.zone === 'R' && homeOccupancy(fixture, b.id).households > 1);
assert.ok(sharedHome, 'Natural fixture contains a shared home');
// Isolated server fixture for the reported empty-new-homes case: preserve
// every existing family/account/job, concentrate addresses in one taller home.
const concentrated = panelEntryCity(fixtureRaw), moveHomes = concentrated.buildings.filter(b => b.zone === 'R').sort((a,b)=>a.cell-b.cell);
const oldTower = moveHomes[0]; oldTower.level = 9; oldTower.housingType = 'condo';
for (const resident of concentrated.households) resident.home = oldTower.id;
concentrated.tick = 181; const concentratedRaw = serialize(concentrated); deserialize(concentratedRaw);
const distributed = panelEntryCity(concentratedRaw); step(distributed); deserialize(serialize(distributed));
const oldResidents = concentrated.households.map(h=>[h.id,h.members,h.wallet]);
assert.ok(homeOccupancy(distributed,oldTower.id).households < concentrated.households.length);
assert.deepEqual(distributed.households.map(h=>[h.id,h.members,h.wallet]),oldResidents);

if(process.argv.includes('--preflight')){
 assert.deepEqual(browserSnapshotState(serialize(fixture)),fixture);
 for(const raw of [migratedRaw,serialize(householdV2Migrated),serialize(workerV3Migrated),vacantDay,upgradeDay])assert.deepEqual(browserSnapshotState(serialize(panelEntryCity(raw))),panelEntryCity(raw));
 console.log(JSON.stringify({legacyHashes:[hash(legacyRaw),hash(householdV2Raw),hash(workerV3Raw)],fixtureTick:fixture.tick,fixtureCells:fixture.cells.length,family:family.id,sharedHome:sharedHome.id,mobilityHouseholds:distributed.households.map(h=>[h.id,h.home]),milestones}));process.exit(0);
}
const httpFixture=await startTrafficHttpFixture(upstream),server=httpFixture.fixture,url=httpFixture.url,fault=installPopulationSaveFault(server);

await mkdir(output, { recursive: true }); await mkdir(shots, { recursive: true });
let occupied = false; try { occupied = (await fetch('http://127.0.0.1:9349/json/version', { signal: AbortSignal.timeout(500) })).ok; } catch {}
assert.equal(occupied, false, 'Run browser suites sequentially; CDP 9349 is occupied');
// Each invocation owns its synthetic storage; never inherit another suite's unsaved recovery pair.
const profile = await mkdtemp(resolve(output, 'edge-population-'));
const child = spawn(process.env.CITYMANAGER_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-component-update', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=9349', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
let ws, sequence = 0,networkProbe=null; const pending = new Map(),externalRequests=[],providerRequests=[];
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
const state = async () => browserSnapshotState(await evaluate('window.cityManager.snapshot()'));
const route = () => evaluate('({page:document.querySelector("#inspector").dataset.page,open:document.querySelector("#inspector").dataset.open,scope:document.querySelector("#entity-content").dataset.scope,id:document.querySelector("#entity-content").dataset.entityId})');
async function click(x, y) { for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: 1 }); }
async function button(selector) { if (await reachTrafficControl(evaluate, button, selector)) return;
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest',inline:'nearest'})`); await paints();
  const p = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect(),k=Math.min(1,screen.width/innerWidth);return{x:r.x+r.width/2,y:r.y+r.height/2,width:r.width,height:r.height,physicalWidth:r.width*k,physicalHeight:r.height*k,touch:navigator.maxTouchPoints>0,disabled:e.disabled}})()`);
  assert.ok(p.width && p.height && !p.disabled, `Visible enabled ${selector}`);
  if (p.touch) assert.ok(p.physicalWidth >= 43.5 && p.physicalHeight >= 43.5, `44px physical touch target ${selector}: ${JSON.stringify(p)}`);
  if(selector==='.guest-entry-card button'&&p.touch){const readable=await evaluate(`(()=>{const e=document.querySelector('.guest-entry-card p'),r=document.querySelector('.guest-entry-card').getBoundingClientRect(),k=Math.min(1,screen.width/innerWidth);return{font:parseFloat(getComputedStyle(e).fontSize)*k,left:r.left,right:r.right,width:innerWidth}})()`);assert.ok(readable.font>=13.5&&readable.left>=0&&readable.right<=readable.width+1,`Readable contained guest entry ${JSON.stringify(readable)}`);}

  assert.equal(await evaluate(`!!document.elementFromPoint(${p.x},${p.y})?.closest(${JSON.stringify(selector)})`), true, `Actually hit ${selector}: ${JSON.stringify(p)}`);
  await click(p.x, p.y);
}
async function close() { if ((await route()).open === 'true') await button('#close-inspector'); await paints(); }
async function page(name) { if ((await route()).open !== 'true' || (await route()).page !== name) { await close(); await button(name === 'city' ? '#toggle-inspector' : name === 'help' ? '#toggle-help' : '#toggle-game-menu'); } await until(`document.querySelector('#inspector').dataset.page===${JSON.stringify(name)}&&document.querySelector('#inspector').dataset.open==='true'`); }
async function key(value) { for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: value, code: value, windowsVirtualKeyCode: value === 'Escape' ? 27 : undefined }); }
const modelAudit=createPanelModelAudit({blocked,expectedErrors,evaluate,sleep});
async function load(raw) {
 const before=modelAudit.begin();
 await loadPanelCity(server,raw,{send,evaluate,button,until,url:url+'?starter=1'});
 await modelAudit.verify(before);
 assert.deepEqual(await state(),panelEntryCity(raw),'Authenticated server entry preserves the complete expanded city');
}
async function savePopulation(expected) {
 const before=modelAudit.begin();
 const result=await saveAndReloadPanel(server,expected,{send,evaluate,button,until});
 await modelAudit.verify(before);return result;
}

async function place(building) { await close(); await button('[data-tool="select"]'); await paints(); const p = await evaluate(`window.cityManager.cellScreen(${building.cell})`); assert.equal(await evaluate(`document.elementFromPoint(${p.x},${p.y})?.id`), 'city-canvas', `Actual canvas cell ${building.cell}`); await click(p.x, p.y); await until(`document.querySelector('#entity-content').dataset.scope==='place'&&document.querySelector('#entity-content').dataset.entityId==='${building.id}'`); }
async function metrics(expected, root = '#entity-content') { const actual = await evaluate(`Object.fromEntries([...document.querySelectorAll(${JSON.stringify(root + ' [data-context-metric]')})].map(e=>[e.dataset.contextMetric,e.dataset.value]))`); for (const [key, value] of Object.entries(expected)) assert.equal(actual[key], String(value), `Exact ${root} metric ${key}`); }
async function household(h, source, city = fixture) {
  await place(source); await button(`#entity-content [data-household-id="${h.id}"]`); await until(`document.querySelector('#entity-content').dataset.scope==='household'&&document.querySelector('#entity-content').dataset.entityId==='${h.id}'`);
  const rows = employmentForHousehold(city, h.id), employed = householdWorkerCount(city, h.id);
  await metrics({ cash: city.accounts[h.wallet], members: h.members, workforce: h.workforce, dependents: h.dependents, employed, unemployed: h.workforce - employed, employers: new Set(rows.map(e => e.firmId)).size, home: h.home === null ? 'null' : h.home, needs: h.needs, 'last-purchase': h.lastPurchaseTick });
  assert.deepEqual(await evaluate('[...document.querySelectorAll("#entity-content .cx-employment-row")].map(e=>({householdId:Number(e.dataset.householdId),firmId:Number(e.dataset.firmId),workers:Number(e.dataset.workers),occupation:e.dataset.occupation,rank:e.dataset.rank,skill:e.dataset.skill}))'), rows);
  assert.deepEqual(await evaluate('[...document.querySelectorAll("#entity-content .cx-skill-row")].map(e=>({skill:e.dataset.skill,total:Number(e.dataset.total),employed:Number(e.dataset.employed),unemployed:Number(e.dataset.unemployed)}))'), ['general', 'manufacturing', 'retail'].map(skill => { const employed = rows.filter(a => a.skill === skill).reduce((n, a) => n + a.workers, 0); return { skill, total: h.workerSkills[skill], employed, unemployed: h.workerSkills[skill] - employed }; }));
  assert.equal(await evaluate('!!document.querySelector("#entity-content .cx-legacy-assumption")'), h.origin === 'legacy-v1');
  const happiness = await evaluate(`(()=>{const host=document.querySelector('#entity-content'),section=host.querySelector('[data-card-section="happiness"]');return {exists:!!section,direct:section?.parentElement===host,inDetails:!!section?.closest('details'),text:section?.innerText??''};})()`);
  assert.equal(happiness.exists,true); assert.equal(happiness.direct,true); assert.equal(happiness.inDetails,false);
  assert.ok(happiness.text.includes('ความสุขในพื้นที่'));
  if (city.happiness) { const row = city.happiness.rows.find(r => r.householdId === h.id); assert.ok(happiness.text.includes(`${row.score} / 100`)); assert.ok(happiness.text.includes('เป้าหมายปัจจุบัน')); assert.ok(happiness.text.includes('สวนใกล้บ้าน:')); assert.ok(happiness.text.includes('โรงเรียนที่เปิดใกล้บ้าน:')); assert.ok(happiness.text.includes('ไม่ใช่ประวัติการเดินทางล้มเหลวจริง') && happiness.text.includes('ยังไม่หักรถโดยสารหรือรถไฟ') || happiness.text.includes('ยังไม่มีงานที่ได้รับมอบหมาย')); }
  else assert.ok(happiness.text.includes('ความสุขเริ่มคำนวณหลังผ่านหนึ่งวันจำลอง'));
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
    if(m.method==='Page.javascriptDialogOpening')void server.dialog(m.params,send).catch(error=>errors.push(String(error)));
    if(m.method==='Network.requestWillBeSent'){const u=m.params.request.url;if(networkProbe?.active&&u===networkProbe.url)networkProbe.requestId=m.params.requestId;else { if(isPanelProviderRequest(u))providerRequests.push(u); if(/^https?:/.test(u)&&new URL(u).origin!==new URL(url).origin)externalRequests.push(u); }}
    if(m.method==='Network.loadingFailed'&&m.params.requestId===networkProbe?.requestId)networkProbe.failed=m.params;
  };
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, screenWidth: 1440, screenHeight: 1000, deviceScaleFactor: 1, mobile: false });
  await server.install(send);
  await installTrafficNetworkFence({send,evaluate,protocol:await (await fetch('http://127.0.0.1:9349/json/protocol')).json(),origin:new URL(url).origin,blockedModels:blocked,additionalBlocked:[...panelProviderDenials(new URL(url).origin),new URL(url).origin+'/api/city-advisor/*',new URL(url).origin+'/*/api/city-advisor/*'],observeProbe:probe=>(networkProbe={url:probe})});
  if (!mobilityOnly) {
  // Repeated entry preserves the real legacy fixture, without a local city copy.
  await load(migratedRaw);assert.deepEqual(await state(),panelEntryCity(migratedRaw));
  await load(migratedRaw);assert.deepEqual(await state(),panelEntryCity(migratedRaw));
  checks.push('Repeated authenticated server entry preserves exact migrated v1 population, wallets, goods, claims, tick and RNG without duplicate grants');

  // A real service call fails before mutation, then the native retry uses the
  // same pending request and obtains exact ACKs before a verified reload.
  await page('game');const beforeFailure=server.active, stateBeforeFailure=await state(),cursor=server.writes.length;
  fault.arm();await button('#save');await until('!!document.querySelector("#save-failure-banner:not([hidden])")');
  assert.equal(fault.failures.length,1);assert.deepEqual(server.active,beforeFailure,'Failed service save leaves exact head and revision intact');
  assert.equal(server.writes.length,cursor);assert.deepEqual(await state(),stateBeforeFailure);await server.assertNoCityWrites(evaluate);
  const failed=fault.failures[0],pendingRaw=await evaluate('window.cityManager.sessionSnapshot()');
  assert.equal(failed.command.raw,pendingRaw);assert.equal(failed.command.expectedRevision,beforeFailure.revision);
  await button('#save-failure-retry');
  await until("document.querySelector('#autosave-status')?.textContent.startsWith('บันทึกบนเซิร์ฟเวอร์แล้ว')&&!document.querySelector('#save-failure-banner:not([hidden])')");
  await server.settle();
  assertPanelSaveChain(beforeFailure,server.active,server.writes.slice(cursor),pendingRaw,server.writes.slice(0,cursor));
  const retry=server.writes.slice(cursor).find(e=>e.requestKey===failed.key);assert.ok(retry,'Pending request was retried with its original idempotency key');
  assert.deepEqual(retry.command,failed.command);assert.equal(retry.status,200);assert.equal(retry.response.raw,failed.command.raw);
  await savePopulation(stateBeforeFailure);
  checks.push('Failed server save leaves head, revision and city unchanged; the exact pending request is retried and the acknowledged session survives reload');

  const vacant = panelEntryCity(vacantDay), vacantHome = vacant.buildings.find(b => b.zone === 'R' && b.age === 0);
  await load(vacantDay); await home(vacant, vacantHome); await metrics({ households: 0, persons: 0 }); await screenshot('vacant-new-home.png');
  const upgraded = panelEntryCity(upgradeDay); await load(upgradeDay); await cityMetrics(upgraded);
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

  const expectedDemolished = panelEntryCity(fixtureRaw), displaced = expectedDemolished.households.filter(h => h.home === sharedHome.id).map(h => ({ ...h })), claimsBefore = expectedDemolished.firms.map(f => ({ id: f.id, workDays: { ...f.workDays } }));
  assert.equal(bulldoze(expectedDemolished, sharedHome.cell).ok, true);
  await place(sharedHome); await button('[data-tool="bulldoze"]'); await close(); await paints(); const point = await evaluate(`window.cityManager.cellScreen(${sharedHome.cell})`); assert.equal(await evaluate(`document.elementFromPoint(${point.x},${point.y})?.id`), 'city-canvas'); await click(point.x, point.y);
  assert.deepEqual(await state(), expectedDemolished); assert.equal(expectedDemolished.accounts.treasury, fixture.accounts.treasury - 2000);
  for (const old of displaced) { const h = expectedDemolished.households.find(h => h.id === old.id); assert.deepEqual(h, { ...old, home: null }); assert.equal(expectedDemolished.accounts[h.wallet], fixture.accounts[h.wallet]); assert.equal(householdWorkerCount(expectedDemolished, h.id), 0); }
  assert.deepEqual(expectedDemolished.firms.map(f => ({ id: f.id, workDays: f.workDays })), claimsBefore); assert.equal(expectedDemolished.migration.arrivals, fixture.migration.arrivals);
  await cityMetrics(expectedDemolished); await screenshot('displaced-households.png'); checks.push('Real demolition displaces every occupant, preserves identities/members/wallets/claims, clears affected jobs and charges only recorded demolition cost');

  const expectedRehoused = deserialize(serialize(expectedDemolished)); step(expectedRehoused); deserialize(serialize(expectedRehoused));
  await close(); await button('[data-speed="1"]');
  // Pause at the boundary inside the browser; CDP + two paints can overshoot a day.
  await evaluate(`(()=>{const target=${expectedRehoused.tick};const stop=()=>{if(JSON.parse(window.cityManager.snapshot()).tick>=target){const p=document.querySelector('#pause');if(p.getAttribute('aria-pressed')!=='true')p.click()}else requestAnimationFrame(stop)};requestAnimationFrame(stop)})()`);
  await button('#pause'); await until(`JSON.parse(window.cityManager.snapshot()).tick>=${expectedRehoused.tick}&&document.querySelector('#pause').getAttribute('aria-pressed')==='true'`); assert.deepEqual(await state(), expectedRehoused);
  for (const old of displaced) { const h = expectedRehoused.households.find(h => h.id === old.id); assert.notEqual(h.home, null); assert.equal(h.members, old.members); assert.equal(h.wallet, old.wallet); assert.equal(expectedRehoused.ledger.filter(e => e.to === h.wallet && e.reason === 'New household arrival savings').length, 1); }
  assert.equal(expectedRehoused.migration.arrivals, fixture.migration.arrivals); await cityMetrics(expectedRehoused);
  await page('game'); await savePopulation(expectedRehoused); assert.deepEqual(await state(),expectedRehoused);
  checks.push('One real daily tick matches deterministic replay: existing displaced families rehouse before new arrivals without repeat grants; exact server Save/reload preserves the complete session');
  }

  await load(concentratedRaw);
  await household(concentrated.households[0], oldTower, concentrated); // Older saves have no history until the next day.
  await home(concentrated, oldTower); await screenshot('housing-before-move.png');
  await close(); await button('[data-speed="1"]');
  await evaluate(`(()=>{const target=${distributed.tick};const stop=()=>{if(JSON.parse(window.cityManager.snapshot()).tick>=target){const p=document.querySelector('#pause');if(p.getAttribute('aria-pressed')!=='true')p.click()}else requestAnimationFrame(stop)};requestAnimationFrame(stop)})()`);
  await button('#pause'); await until(`JSON.parse(window.cityManager.snapshot()).tick>=${distributed.tick}&&document.querySelector('#pause').getAttribute('aria-pressed')==='true'`);
  assert.deepEqual(await state(),distributed);
  const movedResidents = distributed.households.filter(h => h.home !== oldTower.id);
  assert.equal(movedResidents.length, 4, 'Exactly four existing families move in the weekly review');
  for(const destination of moveHomes.slice(1)) await home(distributed,distributed.buildings.find(b=>b.id===destination.id));
  for (const resident of movedResidents) await household(resident, distributed.buildings.find(b => b.id === resident.home), distributed);
  await screenshot('housing-after-move.png');
  await cityMetrics(distributed); await page('game'); await savePopulation(distributed); assert.deepEqual(await state(),distributed);
  checks.push('Weekly redistribution moves existing whole families from an earlier tower into empty homes during a real browser tick; identities, exact deterministic state and the server ACK/reload remain intact');

  if (!mobilityOnly) {
  await load(fixtureRaw);
  for (const metric of [{ width: 360, height: 740, screenWidth: 360, screenHeight: 780, mobile: true }, { width: 844, height: 390, screenWidth: 844, screenHeight: 390, mobile: true }, { width: 980, height: 2120, screenWidth: 390, screenHeight: 844, mobile: true }]) {
    await viewport(metric); await home(fixture, sharedHome); await layout(); await household(family, fixture.buildings.find(b => b.id === family.home)); await layout(); if (metric.width === 360) await screenshot('phone-family.png'); await cityMetrics(fixture); await layout(); await page('game'); await layout();
    for(const id of ['load','load-v3','load-v2','load-legacy','load-backup'])assert.equal(await evaluate(`document.querySelector('#${id}')===null`),true,`${id} local import control is absent`);
    await savePopulation(fixture);await page('game');
    const beforeCancel=server.active,writesBefore=server.writes.length;await button('#new-city');await button('#save-management-cancel');
    assert.deepEqual(await state(),fixture);assert.deepEqual(server.active,beforeCancel);assert.equal(server.writes.length,writesBefore);
    await button('#new-city');assert.equal(await evaluate('!!document.querySelector("#save-management-dialog[open]")'),true);await key('Escape');
    assert.equal(await evaluate('!!document.querySelector("#save-management-dialog[open]")'),false,'Escape dismisses the actual management dialog');
    assert.deepEqual(await state(),fixture);assert.deepEqual(server.active,beforeCancel);assert.equal(server.writes.length,writesBefore);
    for(const old of [migratedRaw,serialize(householdV2Migrated),serialize(workerV3Migrated)]){
      await load(old);assert.deepEqual(await state(),panelEntryCity(old));await load(fixtureRaw);await page('game');
    }
    await key('Escape'); assert.notEqual((await route()).open, 'true');
  }
  // Synthetic high-density fixture uses explicit accounts/contracts, not fabricated gameplay growth.
  const highSeed = populationFixture(334, true); step(highSeed); const highRaw=serialize(highSeed),high=panelEntryCity(highRaw);
  await viewport({width:390,height:844,screenWidth:390,screenHeight:844,mobile:true});
  await load(highRaw); await cityMetrics(high); await layout();
  await page('game'); await savePopulation(high);assert.deepEqual(await state(),high);
  await cityMetrics(high); await screenshot('phone-population-1000.png');
  assert.ok(summary(high).population>=1002); assert.ok(high.employment.length>256);
  checks.push('Synthetic 1000+ actual people and 256+ job allocations load, show exact city metrics and round-trip through real mobile server Save/reload; no natural-growth or FPS claim');

  const twoKSeed=population2000Fixture();step(twoKSeed);const twoKRaw=serialize(twoKSeed),twoK=panelEntryCity(twoKRaw);
  await load(twoKRaw);await cityMetrics(twoK);await layout();
  await page('game');await savePopulation(twoK);assert.deepEqual(await state(),twoK);await close();
  await button('[data-speed="1"]');
  // Observe actual frame intervals at 1x, then pause in-page before reading state.
  await evaluate(`(()=>{window.__populationFrames=null;const deltas=[];let previous=null;const sample=now=>{if(previous!==null)deltas.push(now-previous);previous=now;if(deltas.length===120){const p=document.querySelector('#pause');if(p.getAttribute('aria-pressed')!=='true')p.click();window.__populationFrames=deltas;}else requestAnimationFrame(sample)};requestAnimationFrame(sample)})()`);
  await button('#pause');await until('Array.isArray(window.__populationFrames)&&document.querySelector("#pause").getAttribute("aria-pressed")==="true"');
  const actual2000=await state(),replayed2000=deserialize(serialize(twoK));
  while(replayed2000.tick<actual2000.tick)step(replayed2000);
  assert.deepEqual(actual2000,replayed2000);assert.equal(summary(actual2000).population,2000);
  const frameTimes=await evaluate('window.__populationFrames'),frameSorted=[...frameTimes].sort((a,b)=>a-b);
  const traffic2000=await evaluate('window.cityManager.atmosphere()');assert.equal(traffic2000.settings.traffic,true);const allocation2000=await evaluate('window.cityManager.traffic()');if(!allocation2000)assert.ok(traffic2000.traffic.actors>0,'Current enabled traffic survives automatic quality selection');else{assert.equal(allocation2000.mode,'allocation-game');assert.equal(allocation2000.failure,null,'Allocation traffic has no failure under automatic quality selection');}
  checks.push('2000-person current traffic diagnostics: '+JSON.stringify({quality:traffic2000.quality,traffic:traffic2000.traffic})+'; population is not vehicle count');
  checks.push(`2000-person 1x mobile-emulated scene: ${frameTimes.length} frame intervals, median ${frameSorted[60].toFixed(1)}ms, P95 ${frameSorted[113].toFixed(1)}ms, max ${frameSorted.at(-1).toFixed(1)}ms. Headless CI only, not physical Android.`);
  await cityMetrics(actual2000);await layout();await screenshot('phone-population-2000.png');
  await page('game');await savePopulation(actual2000);assert.deepEqual(await state(),actual2000);
  if(allocation2000){await close();await button('#pause');await until('(window.cityManager.traffic()?.cars??0)>0');const moving2000=await evaluate('window.cityManager.traffic()');await button('#pause');assert.ok(moving2000.cars>0,'Current enabled traffic survives automatic quality selection');checks.push('2000-person allocation traffic under automatic quality: '+JSON.stringify({cars:moving2000.cars,moving:moving2000.moving,failure:moving2000.failure}));}
  checks.push('Exactly 2000 real people / 668 households retain complete simulation state, balanced accounts and session bytes through authenticated entry, running at1x, Save and reload; job shortages remain explicit');

  // Restore the intended split-worker city after server persistence and layout exercises.
  await load(fixtureRaw); assert.deepEqual(await state(), fixture);
  checks.push('360 phone, landscape and 980-layout/screen390 keep contexts and server-save controls contained with real 44px Back/close; no unexpected runtime errors');
  }
  assert.deepEqual(httpFixture.errors,[]);assert.deepEqual(externalRequests,[]);assert.deepEqual(providerRequests,[],'Population QA never attempts advisor/provider requests');await server.assertNoCityWrites(evaluate); assert.deepEqual(errors, []);
  modelAudit.assertComplete();const visuals = await evaluate('window.cityManager.visuals()'); if (blocked) { assert.equal(visuals.failed.length, 41); } else { assert.equal(visuals.loaded.length, 41); assert.equal(visuals.failed.length, 0); }
  const version = await send('Browser.getVersion'), report = { date: new Date().toISOString(), url, browser: version.product, mode: mobilityOnly ? 'housing-mobility-only' : 'full-population', checks, errors, expectedModelErrors: expectedErrors.length, mobility: { tick: distributed.tick, fixtureHash: hash(concentratedRaw), expectedHash: hash(serialize(distributed)), movedHouseholds: movedResidents.map(h => h.id), homes: distributed.households.map(h => [h.id, h.home]), verifiedServerReload: true }, fixture: { seed: fixture.seed, tick: fixture.tick, hash: hash(fixtureRaw), legacySha256: hash(legacyRaw), naturalHash: hash(serialize(natural)), employmentScenario: 'Two real family workers split across existing I/C firms; no accounts/journals/people edited' }, milestones, layouts, screenshots, note: 'Installed headless browser. Full-population mode also emulates touch/viewport and physical-screen ratio. No real-phone QA or performance claim.' };
  await writeFile(resolve(output, 'population-report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} catch (error) { if (ws?.readyState === 1) try { await screenshot('population-failure.png'); console.error('Route:', await route()); } catch {} console.error('Unexpected browser errors:', errors); throw error; }
finally { if (ws?.readyState === 1) { try { await send('Browser.close'); } catch {} ws.close(); } child.kill(); await httpFixture.close(); }
