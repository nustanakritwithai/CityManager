import { browserSnapshotState } from './browser-snapshot.ts';
import { createPanelModelAudit } from './panel-model-audit.mjs';
import { panelProviderDenials, isPanelProviderRequest } from './panel-network-denies.mjs';
// Focused visual-card acceptance. Root runs installed Edge sequentially; no provider requests.
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { reachTouch } from './touch-reach.mjs';
import { startTrafficHttpFixture, installTrafficNetworkFence } from './traffic-server-entry-fixture.mjs';
import { isMarket, isRetail, serialize, deserialize, bulldoze, homeOccupancy, housingCapacity, householdWorkerCount, firmWorkerCount, firmCapacity, firmWage, MONTH, contributeOwnerCapital, withdrawOwnerProfit } from '../src/sim.ts';
import { buildingCardData } from '../src/building-card-data.ts';
import { createBuildingCardsFixture, assertCommercialCardTrades } from './building-cards-fixture.ts';

const upstream = process.env.CITYMANAGER_URL || 'http://127.0.0.1:4173/CityManager/';
const output = resolve('.test-output'), shots = resolve(process.env.CITYMANAGER_SCREENSHOT_DIR || '.test-output/cards-normal');
const blocked = process.env.CITYMANAGER_BLOCK_MODELS === '1';
const hash = value => createHash('sha256').update(value).digest('hex');
const { fixture, legacyInput, baseline, later, shopCity, shopBuilding } = createBuildingCardsFixture();
const kinds = ['house', 'shop', 'market', 'factory', 'farm'];
const places = Object.fromEntries(kinds.map(kind => [kind, fixture.buildings.find(b => kind === 'house' ? b.zone === 'R' : fixture.firms.some(f => f.building === b.id && (kind === 'market' ? isMarket(f) : kind === 'shop' ? isRetail(f) : f.zone === (kind === 'farm' ? 'F' : 'I'))))]));
assert.ok(Object.values(places).every(Boolean), 'Real day29 replay retains both historical commercial origins, houses, factories and farms');
// The historical retailer is still a market-tier building at days 29 and 59.
const replayKinds = { house: 'house', shop: 'market', market: 'market', factory: 'factory', farm: 'farm' };
for (const city of [fixture, later]) for (const [role, b] of Object.entries(places)) assert.equal(buildingCardData(city, b.id)?.kind, replayKinds[role]);
assert.equal(buildingCardData(shopCity, shopBuilding.id)?.kind, 'shop');
const marketFirm = fixture.firms.find(f => isMarket(f)), family = fixture.households.find(h => h.id === marketFirm.owner.householdId);
const sourceHome = fixture.buildings.find(b => b.id === family.home), otherHome = fixture.buildings.find(b => b.zone === 'R' && b.id !== sourceHome.id && fixture.households.some(h => h.home === b.id));
assert.ok(sourceHome && otherHome && family.members > 1);
const contributed = deserialize(baseline); assert.equal(contributeOwnerCapital(contributed, marketFirm.id, 10000).ok, true);
const withdrawn = deserialize(serialize(contributed)); assert.equal(withdrawOwnerProfit(withdrawn, marketFirm.id, 10000).ok, true);
const preview = { seed: 61025, tick: fixture.tick, hash: hash(baseline), laterTick: later.tick, laterHash: hash(serialize(later)), places: Object.fromEntries(Object.entries(places).map(([kind, b]) => [kind, { buildingId: b.id, cell: b.cell, cardKind: replayKinds[kind] }])), shop: { tick: shopCity.tick, hash: hash(serialize(shopCity)), buildingId: shopBuilding.id, cell: shopBuilding.cell, level: shopBuilding.level }, householdId: family.id, householdSourceBuildingId: sourceHome.id, cardKinds: [...kinds, 'household'] };
if (process.argv.includes('--preflight')) { console.log(JSON.stringify(preview, null, 2)); process.exit(0); }

const checks = [], errors = [], expectedErrors = [], screenshots = [], layouts = [], signatures = {}, providerRequests = [], externalRequests = [];
let networkProbe = null;
await mkdir(output, { recursive: true }); await mkdir(shots, { recursive: true });
let occupied = false; try { occupied = (await fetch('http://127.0.0.1:9349/json/version', { signal: AbortSignal.timeout(500) })).ok; } catch {}
assert.equal(occupied, false, 'Building-card suite must run sequentially; CDP9349 is occupied');
const httpFixture = await startTrafficHttpFixture(upstream), server = httpFixture.fixture, url = httpFixture.url;
// Each invocation owns its synthetic storage; never inherit another suite's unsaved recovery pair.
const profile = await mkdtemp(resolve(output, 'edge-building-cards-'));
const child = spawn(process.env.CITYMANAGER_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-component-update', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=9349', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
let ws, sequence = 0; const pending = new Map(), sleep = ms => new Promise(r => setTimeout(r, ms));
const modelAudit = createPanelModelAudit({blocked,expectedErrors,evaluate,sleep});
async function send(method, params = {}) { const id = ++sequence; const promise = new Promise((resolve, reject) => { const timer = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout ${method}`)); }, 30000); pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } }); }); ws.send(JSON.stringify({ id, method, params })); return promise; }
async function evaluate(expression) { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; }
async function until(expression) { const start = Date.now(); while (Date.now() - start < 15000) { if (await evaluate(expression)) return; await sleep(60); } throw Error(`Timed out ${expression}`); }
const paints = () => evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
const state = async () => browserSnapshotState(await evaluate('window.cityManager.snapshot()'));
const route = () => evaluate('({page:document.querySelector("#inspector").dataset.page,open:document.querySelector("#inspector").dataset.open,scope:document.querySelector("#entity-content").dataset.scope,id:document.querySelector("#entity-content").dataset.entityId,kind:document.querySelector("#entity-content").dataset.cardKind})');
async function click(x, y) { for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: 1 }); }
async function key(value) { for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: value, code: value, windowsVirtualKeyCode: value === 'Escape' ? 27 : undefined }); }
async function reveal(selector) {
  const target = `(()=>{let n=document.querySelector(${JSON.stringify(selector)}),closed=[];for(let p=n?.parentElement;p;p=p.parentElement)if(p instanceof HTMLDetailsElement&&!p.open)closed.push(p);return closed.at(-1)?.querySelector(':scope>summary')})()`;
  for (let n = 0; n < 8; n++) {
    if (!await evaluate(`!!${target}`)) return;
    await evaluate(`${target}?.scrollIntoView({block:'nearest',inline:'nearest'})`); await paints();
    const p = await evaluate(`(()=>{const e=${target},r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height}})()`);
    assert.ok(p.w && p.h); assert.equal(await evaluate(`(()=>{const e=${target};return e===document.elementFromPoint(${p.x},${p.y})?.closest('summary')})()`), true, 'Native disclosure hit');
    await click(p.x, p.y); await paints();
  }
  throw Error('Too many closed disclosure ancestors: ' + selector);
}
async function button(selector) {
  if (await reachTouch(evaluate, button, selector)) return;
  await reveal(selector); await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest',inline:'nearest'})`); await paints();
  const p = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect(),k=Math.min(1,screen.width/innerWidth);return{x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height,physicalWidth:r.width*k,physicalHeight:r.height*k,touch:navigator.maxTouchPoints>0,disabled:e.disabled}})()`);
  assert.ok(p.w && p.h && !p.disabled, `Visible enabled ${selector}`);
  if (p.touch) assert.ok(p.physicalWidth >= 43.5 && p.physicalHeight >= 43.5, `44px ${selector}: ${JSON.stringify(p)}`);
  assert.equal(await evaluate(`!!document.elementFromPoint(${p.x},${p.y})?.closest(${JSON.stringify(selector)})`), true, `Actual hit ${selector}`); await click(p.x, p.y);
}
async function close() { if ((await route()).open === 'true') await button('#close-inspector'); await paints(); }
async function load(city, raw = serialize(city)) {
  await server.leave({ send, evaluate, until });
  const ack = await server.seed(raw); assert.equal(ack.raw, raw); assert.equal(ack.revision, 1);
  const before = modelAudit.begin(); await send('Page.navigate', { url: url + '?starter=1' }); await server.enter({ evaluate, button }); await modelAudit.verify(before);
  assert.deepEqual(await state(), city, 'Authenticated entry preserves the complete validated city');
  server.assertDurable(raw, ack.revision); await server.assertNoCityWrites(evaluate); await close();
}
async function cell(index, expect = true) { await close(); await button('[data-tool="select"]'); await paints(); const p = await evaluate(`window.cityManager.cellScreen(${index})`); assert.equal(await evaluate(`document.elementFromPoint(${p.x},${p.y})?.id`), 'city-canvas'); await click(p.x, p.y); if (expect) await until('document.querySelector("#inspector").dataset.open==="true"'); await paints(); }
async function place(city, b) { await cell(b.cell); await until(`document.querySelector('#entity-content').dataset.scope==='place'&&document.querySelector('#entity-content').dataset.entityId==='${b.id}'`); }
async function household(city, h, source = city.buildings.find(b => b.id === h.home)) { await place(city, source); await button(`#entity-content [data-household-id="${h.id}"]`); await until(`document.querySelector('#entity-content').dataset.scope==='household'&&document.querySelector('#entity-content').dataset.entityId==='${h.id}'`); }
async function metrics(expected) { const actual = await evaluate('Object.fromEntries([...document.querySelectorAll("#entity-content [data-context-metric]")].map(e=>[e.dataset.contextMetric,e.dataset.value]))'); for (const [key, value] of Object.entries(expected)) assert.equal(actual[key], String(value), `Exact contextual metric ${key}`); }
function boundary(city, wallets) { const scope = new Set(wallets), fromTick = Math.max(0, city.tick - 29); let inflow = 0, outflow = 0; for (const e of city.ledger) if (e.tick >= fromTick && e.tick <= city.tick) { if (scope.has(e.to) && !scope.has(e.from)) inflow += e.amount; if (scope.has(e.from) && !scope.has(e.to)) outflow += e.amount; } return { fromTick, toTick: city.tick, inflow, outflow, net: inflow - outflow }; }
async function card(city, kind, target) {
  const beforeRaw = await evaluate('window.cityManager.snapshot()');
  await paints();
  const current = await route(); assert.equal(current.kind, kind); assert.equal(current.id, String(target.id));
  const dom = await evaluate(`(()=>{const h=document.querySelector('#entity-content'),stats=root=>Object.fromEntries([...root.querySelectorAll('[data-card-metric]')].map(e=>[e.dataset.cardMetric,{value:e.dataset.value,status:e.dataset.status}]));return{heroes:h.querySelectorAll('.bc-hero').length,icons:h.querySelectorAll('.bc-type-icon').length,label:h.querySelector('.bc-type-label')?.textContent.trim(),period:[...h.querySelectorAll('.bc-period')].map(e=>({fromTick:e.dataset.fromTick,toTick:e.dataset.toTick,inclusive:e.dataset.inclusive})),sections:[...h.querySelectorAll('.bc-section[data-card-section]')].map(e=>e.dataset.cardSection),stats:stats(h),trades:[...h.querySelectorAll('[data-card-section="trade"]')].map(e=>({commodity:e.dataset.commodity,stats:stats(e),keys:[...e.querySelectorAll('[data-card-metric]')].map(n=>n.dataset.cardMetric)})),contextKeys:[...h.querySelectorAll('[data-context-metric]')].map(e=>e.dataset.contextMetric)}})()`);
  assert.equal(dom.heroes, 1); assert.equal(dom.icons, 1); assert.ok(dom.label); assert.equal(dom.period.length, 1); assert.equal(new Set(dom.contextKeys).size, dom.contextKeys.length, 'Retained semantic metrics must appear exactly once');
  const required = { house: ['occupancy', 'residents'], household: ['members', 'finance', 'employment', 'skills'], shop: ['stock', 'trade', 'finance'], market: ['stock', 'trade', 'finance'], factory: ['production', 'employment', 'finance'], farm: ['plot', 'harvest', 'stock'] }[kind];
  for (const section of required) assert.ok(dom.sections.includes(section), `${kind} semantic section ${section}`); signatures[kind] = dom.sections.join('|');
  let wallets;
  if (kind === 'house') {
    const residents = city.households.filter(h => h.home === target.id), used = homeOccupancy(city, target.id), cap = housingCapacity(target);
    wallets = residents.map(h => h.wallet); await metrics({ households: used.households, persons: used.persons, 'vacant-households': cap.households - used.households, 'vacant-persons': cap.persons - used.persons });
    assert.deepEqual(await evaluate('[...document.querySelectorAll("#entity-content [data-household-id]")].filter(e=>e.tagName==="BUTTON").map(e=>Number(e.dataset.householdId))'), residents.map(h => h.id));
  } else if (kind === 'household') {
    wallets = [target.wallet]; await metrics({ cash: city.accounts[target.wallet], members: target.members, workforce: target.workforce, dependents: target.dependents, employed: householdWorkerCount(city, target.id), unemployed: target.workforce - householdWorkerCount(city, target.id) });
    assert.equal(await evaluate('document.querySelector("#entity-content").dataset.wallet'), target.wallet);
  } else {
    const f = city.firms.find(f => f.building === target.id), reserved = Object.values(f.workDays).reduce((sum, days) => sum + days * firmWage(f) / MONTH, 0); wallets = [f.wallet];
    await metrics({ cash: city.accounts[f.wallet], reserved, spendable: city.accounts[f.wallet] - reserved, stock: f.inventory, workers: firmWorkerCount(city, f.id), profit: f.lastMonthProfit });
    assert.equal(await evaluate('document.querySelector("#entity-content").dataset.wallet'), f.wallet);
    assert.equal(await evaluate('Number(document.querySelector("#entity-content [data-context-metric=workers]").dataset.capacity)'), firmCapacity(target));
    await metrics({ 'crop-stock': f.cropInventory, 'crop-cost': f.cropCost });
    if (f.zone === 'F') await metrics({ 'yield-per-worker': 24, 'harvest-today': city.cropLedger.filter(e => e.tick === city.tick && e.kind === 'harvest' && e.to === f.wallet).reduce((n, e) => n + e.quantity, 0) });
    if (f.zone === 'I') await metrics({ 'recipe-input': 2, 'recipe-output': 8 });
    if (f.owner) { assert.ok(dom.sections.includes('owner'), 'Owner-operated firm retains its owner section'); await metrics({ 'owner-household': f.owner.householdId, 'owner-capital-contributed': f.owner.capitalContributed, 'owner-withdrawn': f.owner.withdrawn, 'owner-tax': f.owner.taxPaid }); }
    if (f.zone === 'C') assertCommercialCardTrades(city, f.wallet, kind, dom.trades);
    if (f.zone === 'I') assert.equal(dom.stats['goods-produced-today']?.value, String(city.goodsLedger.filter(e => e.tick === city.tick && e.from === 'production' && e.to === f.wallet).reduce((n, e) => n + e.quantity, 0)), 'Factory actual daily output, not recipe capacity');
    const scopeLeaks = await evaluate(`(()=>{const w=${JSON.stringify(f.wallet)};return [...document.querySelectorAll('#entity-content .cx-flow-card[data-kind],#entity-content .cx-crop-card[data-kind]')].filter(e=>e.dataset.from!==w&&e.dataset.to!==w).map(e=>e.dataset)})()`); assert.deepEqual(scopeLeaks, [], 'Firm activity contains only its actual wallet counterparties');
  }
  const expected = boundary(city, wallets); assert.deepEqual(dom.period[0], { fromTick: String(expected.fromTick), toTick: String(expected.toTick), inclusive: 'true' });
  if (kind === 'house') {
    assert.ok(!dom.sections.includes('finance'), 'A house card describes occupancy; household finances have their own contextual view');
    for (const key of ['inflow', 'outflow', 'net']) assert.equal(dom.stats[`cash-${key}`], undefined, 'No household wallet total is presented as house value');
  } else for (const key of ['inflow', 'outflow', 'net']) assert.equal(dom.stats[`cash-${key}`]?.value, String(expected[key]), `${kind} actual period cash-${key}`);
  assert.deepEqual(await state(), city, 'Read-only card selection leaves exact simulation and journals untouched');
  assert.equal(await evaluate('window.cityManager.snapshot()'), beforeRaw, 'Card selection preserves exact snapshot bytes');
}
async function screenshot(name) { await evaluate('document.querySelector("#inspector-body").scrollTop=0'); await paints(); const capture = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); await writeFile(resolve(shots, name), Buffer.from(capture.data, 'base64')); screenshots.push(name); }
async function viewport(metric) { await close(); await send('Emulation.setDeviceMetricsOverride', { ...metric, deviceScaleFactor: 1 }); await send('Emulation.setTouchEmulationEnabled', { enabled: metric.mobile, maxTouchPoints: 2 }); await until(`innerWidth===${metric.width}&&screen.width===${metric.screenWidth}&&document.querySelector('#city-canvas').clientWidth===${metric.width}`); await paints(); }
async function layout(kind) {
  await evaluate('document.querySelector("#inspector-body").scrollTop=0'); await paints();
  const measured = await evaluate(`(()=>{const panel=document.querySelector('#inspector'),r=panel.getBoundingClientRect(),body=document.querySelector('#inspector-body'),v=body.getBoundingClientRect(),ratio=Math.min(1,screen.width/innerWidth),visible=e=>{const q=e.getBoundingClientRect();return q.width>0&&q.height>0&&q.bottom>v.top&&q.top<v.bottom&&getComputedStyle(e).visibility!=='hidden'},fontNodes=[...panel.querySelectorAll('.bc-type-label,.bc-period,.bc-hero p,.bc-kpis dt,.bc-kpis dd,.bc-section h3,.bc-section p')].filter(e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden'),hero=panel.querySelector('.bc-hero'),kpis=[...panel.querySelectorAll('.bc-kpis [data-context-metric],.bc-kpis [data-card-metric]')].filter(visible);return{kind:${JSON.stringify(kind)},width:innerWidth,height:innerHeight,screenWidth:screen.width,left:r.left,right:r.right,top:r.top,bottom:r.bottom,scrollWidth:body.scrollWidth,clientWidth:body.clientWidth,minimumFont:Math.min(...fontNodes.map(e=>parseFloat(getComputedStyle(e).fontSize)*ratio)),visibleKeyMetrics:kpis.length,heroVisible:!!hero&&visible(hero),buttons:['#submenu-back','#close-inspector'].map(s=>{const e=document.querySelector(s),q=e.getBoundingClientRect();return{selector:s,w:q.width*ratio,h:q.height*ratio,hit:!!document.elementFromPoint(q.x+q.width/2,q.y+q.height/2)?.closest(s)}})}})()`);
  assert.ok(measured.left >= 0 && measured.right <= measured.width + 1 && measured.top >= 0 && measured.bottom <= measured.height + 1, JSON.stringify(measured));
  assert.ok(measured.scrollWidth <= measured.clientWidth + 1, 'No horizontal card overflow: ' + JSON.stringify(measured));
  assert.ok(measured.minimumFont >= 13.5, '14px normalized card typography: ' + JSON.stringify(measured));
  assert.ok(measured.heroVisible && measured.visibleKeyMetrics >= 2, 'Identity and at least two real key metrics fit first screen: ' + JSON.stringify(measured));
  assert.ok(measured.buttons.every(b => b.w >= 43.5 && b.h >= 43.5 && b.hit), '44px actual Back/close hits: ' + JSON.stringify(measured)); layouts.push(measured);
}
async function cameraBlocked(b) { const before = await evaluate(`window.cityManager.cellScreen(${b.cell})`), p = await evaluate('(()=>{const r=document.querySelector(".bc-hero").getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()'); await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: p.x, y: p.y, deltaX: 0, deltaY: -180 }); await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y, id: 0 }] }); await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p.x + 30, y: p.y + 30, id: 0 }] }); await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await paints(); assert.deepEqual(await evaluate(`window.cityManager.cellScreen(${b.cell})`), before, 'Card wheel/touch gestures cannot move the map camera'); }

try {
  let tabs; for (let n = 0; n < 100; n++) { try { tabs = await (await fetch('http://127.0.0.1:9349/json/list')).json(); break; } catch { await sleep(100); } }
  assert.ok(tabs?.some(t => t.type === 'page')); ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl); await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  ws.onmessage = event => { const m = JSON.parse(event.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(Error(JSON.stringify(m.error))) : p.resolve(m.result); } if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails); if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') { const a = m.params.args, expected = blocked && a.length === 2 && /^Failed to load resource \[\/CityManager\/assets\/kenney-city\/models\/([a-z]+(?:-[a-z]+)?)\.glb-container\]: Network error$/.test(a[0]?.value) && a[1]?.value === 'Network error'; (expected ? expectedErrors : errors).push(a); } if (m.method === 'Page.javascriptDialogOpening') void server.dialog(m.params, send).catch(error => errors.push(error.message)); if (m.method === 'Network.requestWillBeSent') { const u=m.params.request.url; if(networkProbe?.active && u===networkProbe.url) networkProbe.requestId=m.params.requestId; else { if (isPanelProviderRequest(u)) providerRequests.push(u); if (/^https?:/.test(u) && new URL(u).origin!==new URL(url).origin) externalRequests.push(u); } } if (m.method === 'Network.loadingFailed' && m.params.requestId===networkProbe?.requestId) networkProbe.failed=m.params; };
  await send('Runtime.enable'); await send('Page.enable'); await server.install(send); await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, screenWidth: 1440, screenHeight: 1000, deviceScaleFactor: 1, mobile: false });
  await installTrafficNetworkFence({send,evaluate,protocol:await(await fetch('http://127.0.0.1:9349/json/protocol')).json(),origin:new URL(url).origin,blockedModels:blocked,additionalBlocked:panelProviderDenials(new URL(url).origin),observeProbe:probe=>(networkProbe={url:probe})});
  await load(fixture, legacyInput);

  for (const [role, b] of Object.entries(places)) { await place(fixture, b); await card(fixture, replayKinds[role], b); await screenshot(`cards-${role === 'shop' ? 'legacy-retailer-market' : role}.png`); }
  await load(shopCity); await place(shopCity, shopBuilding); await card(shopCity, 'shop', shopBuilding); await screenshot('cards-shop.png');
  assert.equal(new Set(Object.values(signatures)).size, 5, 'Five building types have distinct content section layouts');
  checks.push('Genuine day29 legacy replay retains both commercial origins as market-tier cards; paid day90 growth adds the level4 shop. All five building cards retain distinct layouts, exact identities/stocks/cash/workforce and both independently reconciled commercial commodity sections');
  await load(fixture);

  await household(fixture, family, sourceHome); await card(fixture, 'household', family); await screenshot('cards-household.png');
  await button('#submenu-back'); assert.equal((await route()).id, String(sourceHome.id)); await card(fixture, 'house', sourceHome);
  await household(fixture, family, places.market); await card(fixture, 'household', family); await key('Escape'); assert.equal((await route()).id, String(places.market.id)); await card(fixture, 'market', places.market);
  checks.push('Household card keeps its shared family identity and real members/skills; native Back returns to the source house and Esc returns to the source business without another family leaking into its data');

  await load(later); for (const kind of ['shop', 'market', 'factory', 'farm']) { const b = later.buildings.find(b => b.id === places[kind].id); await place(later, b); await card(later, replayKinds[kind], b); }
  const factoryFirm = later.firms.find(f => f.building === places.factory.id);
  const factoryBefore = { crops: structuredClone(factoryFirm.crops), products: structuredClone(factoryFirm.products) };
  const requestedRecipe = ['rice-mill', 'cannery', 'sugar-mill'].find(value => value !== factoryFirm.recipe);
  await place(later, later.buildings.find(b => b.id === places.factory.id));
  await button(`#entity-content [data-factory-recipe-picker] button[data-recipe="${requestedRecipe}"]`);
  await until(`document.querySelector('#entity-content [data-recipe="${requestedRecipe}"]').getAttribute('aria-pressed')==='true'`);
  const selectedFactory = (await state()).firms.find(f => f.id === factoryFirm.id);
  assert.equal(selectedFactory.recipe, requestedRecipe);
  assert.deepEqual(selectedFactory.crops, factoryBefore.crops); assert.deepEqual(selectedFactory.products, factoryBefore.products);
  await button('#entity-content [data-factory-recipe-picker] button[data-recipe="auto"]');
  await until(`document.querySelector('#entity-content [data-recipe="auto"]').getAttribute('aria-pressed')==='true'`);
  assert.equal((await state()).firms.find(f => f.id === factoryFirm.id).recipeMode, 'auto');
  await load(later); await place(later, later.buildings.find(b => b.id === places.farm.id));
  const farmFirm = later.firms.find(f => f.building === places.farm.id);
  const oldStock = structuredClone(farmFirm.crops);
  await button('#entity-content [data-farm-crop-picker] button[data-crop="vegetables"]');
  await until(`document.querySelector('#entity-content [data-crop="vegetables"]').getAttribute('aria-pressed')==='true'`);
  const chosen = await state(), chosenFarm = chosen.firms.find(f => f.id === farmFirm.id);
  assert.equal(chosenFarm.cropChoices.at(-1).crop, 'vegetables');
  assert.deepEqual(chosenFarm.crops, oldStock, 'Changing crop leaves existing inventory intact');
  assert.equal(chosenFarm.cropMode, 'manual');
  await button('#entity-content [data-farm-crop-picker] button[data-crop="auto"]');
  await until(`document.querySelector('#entity-content [data-crop="auto"]').getAttribute('aria-pressed')==='true'`);
  assert.equal((await state()).firms.find(f => f.id === farmFirm.id).cropMode, 'auto');
  assert.deepEqual(deserialize(serialize(chosen)), chosen, 'Farm choice survives save/load validation');
  checks.push('Farm crop selection changes future production and preserves existing stock');
  await load(later);
  await household(later, later.households.find(h => h.id === family.id)); await card(later, 'household', later.households.find(h => h.id === family.id));
  checks.push('Inclusive trailing30-day cash cards independently reconcile real wallet-boundary inflows/outflows/net at days29 and59, explicitly label their periods and leave simulation/RNG/journals unchanged');

  await load(fixture); await place(fixture, sourceHome); await card(fixture, 'house', sourceHome); await place(fixture, otherHome); await card(fixture, 'house', otherHome);
  const demolished = deserialize(baseline); assert.equal(bulldoze(demolished, sourceHome.cell).ok, true);
  await place(fixture, sourceHome); await button('[data-tool="bulldoze"]'); await paints(); const p = await evaluate(`window.cityManager.cellScreen(${sourceHome.cell})`); assert.equal(await evaluate(`document.elementFromPoint(${p.x},${p.y})?.id`), 'city-canvas'); await click(p.x, p.y); assert.deepEqual(await state(), demolished);
  await cell(sourceHome.cell); assert.equal(await evaluate('document.querySelectorAll("#entity-content .bc-hero").length'), 0); assert.ok(!(await route()).kind, 'Removed entity card kind is cleared');
  await place(demolished, otherHome); await card(demolished, 'house', otherHome);
  checks.push('Switching houseA/houseB isolates actual residents; native demolition exactly matches simulation and clears the removed card before another place is selected');

  await load(fixture); await place(fixture, places.market); await button(`[data-owner-action="contribute"][data-firm-id="${marketFirm.id}"]`); assert.deepEqual(await state(), contributed); await card(contributed, 'market', contributed.buildings.find(b => b.id === places.market.id));
  await button(`[data-owner-action="withdraw"][data-firm-id="${marketFirm.id}"]`); assert.deepEqual(await state(), withdrawn); await card(withdrawn, 'market', withdrawn.buildings.find(b => b.id === places.market.id));
  assert.equal(withdrawn.firms.find(f => f.id === marketFirm.id).monthlyRevenue, marketFirm.monthlyRevenue); assert.equal(withdrawn.firms.find(f => f.id === marketFirm.id).monthlyExpense, marketFirm.monthlyExpense);
  checks.push('Preserved native owner contribution/profit-draw callbacks transfer exact100-credit amounts and update cards without treating capital or distributions as operating income/expense');

  await load(fixture);
  for (const metric of [{ width: 360, height: 780, screenWidth: 360, screenHeight: 780, mobile: true }, { width: 844, height: 390, screenWidth: 844, screenHeight: 390, mobile: true }, { width: 980, height: 1960, screenWidth: 390, screenHeight: 780, mobile: true }]) {
    await viewport(metric);
    for (const [role, b] of Object.entries(places)) { await place(fixture, b); await card(fixture, replayKinds[role], b); await layout(replayKinds[role]); if (metric.width === 360 && role === 'market') await screenshot('cards-phone-market.png'); }
    await household(fixture, family); await card(fixture, 'household', family); await layout('household'); if (metric.width === 360) await screenshot('cards-phone-household.png');
    await button('#submenu-back'); assert.equal((await route()).id, String(sourceHome.id)); await place(fixture, places.market); await cameraBlocked(places.market); await key('Escape'); assert.notEqual((await route()).open, 'true'); await place(fixture, sourceHome); await button('#close-inspector'); assert.notEqual((await route()).open, 'true'); assert.deepEqual(await state(), fixture);
    await load(shopCity); await place(shopCity, shopBuilding); await card(shopCity, 'shop', shopBuilding); await layout('shop'); if (metric.width === 360) await screenshot('cards-phone-shop.png');
    await load(fixture);
  }
  checks.push('All six cards pass360×780 portrait,844×390 landscape and980-layout/screen390 with normalized14px content, actual44px Back/close hits, at least two meaningful first-screen metrics, no overflow and no camera input under cards');

  await server.assertNoCityWrites(evaluate);
  assert.deepEqual(providerRequests, [], 'Card QA never attempts advisor/provider requests'); assert.deepEqual(externalRequests, []); assert.deepEqual(httpFixture.errors, []); assert.deepEqual(errors, []);
  modelAudit.assertComplete(); const visuals = await evaluate('window.cityManager.visuals()'); if (blocked) { assert.equal(visuals.failed.length, 41); } else { assert.equal(visuals.loaded.length, 41); assert.equal(visuals.failed.length, 0); }
  checks.push('All model loads pass normally or exactly 41 intentional failures per entry use procedural fallback; no unexpected runtime/console errors or advisor/provider requests occur');
  const version = await send('Browser.getVersion'), report = { date: new Date().toISOString(), url, browser: version.product, checks, errors, expectedModelErrors: expectedErrors.length, providerRequests, fixture: preview, signatures, layouts, screenshots, note: 'Installed headless Edge; physical-screen ratio and touch are emulated, not real Galaxy S22 QA. No simulation implementation, API configuration or provider requests.' };
  await writeFile(resolve(output, 'building-cards-report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} catch (error) { if (ws?.readyState === 1) try { await screenshot('cards-failure.png'); console.error('Route:', await route()); } catch {} console.error('Unexpected browser errors:', errors); throw error; }
finally { if (ws?.readyState === 1) { try { await send('Browser.close'); } catch {} ws.close(); } child.kill(); await httpFixture.close(); }
