// Contextual-inspector acceptance using installed Edge, real input and valid saves.
// Run sequentially with other browser scripts: this test owns CDP port 9349.
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { createCity, serialize, deserialize, summary, MONTH, WAGES, firmWorkerCount, householdWorkerCount, employmentForHousehold, employmentForFirm, housingCapacity, homeOccupancy } from '../src/sim.ts';

const url = process.env.CITYMANAGER_URL || 'http://127.0.0.1:4173/CityManager/';
const output = resolve('.test-output'), shots = resolve(process.env.CITYMANAGER_SCREENSHOT_DIR || 'docs/context-preview');
const blocked = process.env.CITYMANAGER_BLOCK_MODELS === '1';
const checks = [], screenshots = [], errors = [], expectedErrors = [], layouts = [];
const legacyRaw = await readFile(new URL('./fixtures/legacy-v1-day65.json', import.meta.url), 'utf8'), legacy = JSON.parse(legacyRaw);
const legacySha256 = createHash('sha256').update(legacyRaw).digest('hex');
assert.equal(legacySha256, '4e358e66acdfb55dcfd434aaf67be51ccea99c69fc5a2b9b44343035c16166d0');
const fixture = deserialize(legacyRaw); assert.equal(fixture.version, 2);
for (const key of ['accounts', 'ledger', 'goodsLedger', 'goods']) assert.deepEqual(fixture[key], legacy[key], `Migration preserves ${key}`);
for (const key of ['seed', 'rng', 'tick', 'nextId']) assert.equal(fixture[key], legacy[key], `Migration preserves ${key}`);
for (const old of legacy.firms) { const firm = fixture.firms.find(f => f.id === old.id); assert.equal(firm.inventory, old.inventory); assert.deepEqual(firm.workDays, old.workDays); }
const fixtureJson = serialize(fixture), emptyJson = serialize(createCity(91));
assert.deepEqual(deserialize(fixtureJson), fixture);
const homes = fixture.buildings.filter(b => b.zone === 'R').slice(0, 2), firms = fixture.firms.slice(0, 2);
assert.equal(homes.length, 2, 'Fixture has two actual homes'); assert.equal(firms.length, 2, 'Fixture has two actual firms');
const homeHousehold = fixture.households.find(h => h.home === homes[0].id);
assert.ok(homeHousehold, 'Home A has an actual household');
await mkdir(output, { recursive: true }); await mkdir(shots, { recursive: true });
let occupied = false;
try { occupied = (await fetch('http://127.0.0.1:9349/json/version', { signal: AbortSignal.timeout(500) })).ok; } catch {}
assert.equal(occupied, false, 'CDP port 9349 must be free; do not attach to another active QA session');
const child = spawn(process.env.CITYMANAGER_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-component-update', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=9349', `--user-data-dir=${resolve(output, 'edge-profile')}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
let ws, nextId = 0; const pending = new Map();
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function send(method, params = {}) {
  const id = ++nextId;
  const promise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout: ${method}`)); }, 30000);
    pending.set(id, { resolve: result => { clearTimeout(timer); resolve(result); }, reject: error => { clearTimeout(timer); reject(error); } });
  });
  ws.send(JSON.stringify({ id, method, params })); return promise;
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails)); return result.result.value;
}
async function until(expression, timeout = 15000) {
  const start = Date.now(); while (Date.now() - start < timeout) { if (await evaluate(expression)) return; await sleep(80); }
  throw Error(`Timed out: ${expression}`);
}
const state = () => evaluate('JSON.parse(window.cityManager.snapshot())');
const route = () => evaluate('({page:document.querySelector("#inspector").dataset.page,open:document.querySelector("#inspector").dataset.open,submenu:document.querySelector("#inspector").dataset.submenu,scope:document.querySelector("#entity-content").dataset.scope,id:document.querySelector("#entity-content").dataset.entityId})');
async function click(x, y) { for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: 1 }); }
async function button(selector) {
  const point = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing control: '+${JSON.stringify(selector)});e.scrollIntoView({block:'nearest',inline:'nearest'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height,disabled:e.disabled}})()`);
  assert.ok(point.w > 0 && point.h > 0 && !point.disabled, `Visible enabled control: ${selector}`);
  assert.equal(await evaluate(`!!document.elementFromPoint(${point.x},${point.y})?.closest(${JSON.stringify(selector)})`), true, `Control is actually hit: ${selector}`);
  await click(point.x, point.y);
}
async function key(value) {
  const virtual = { Escape: 27, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 }[value];
  for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: value, code: value, windowsVirtualKeyCode: virtual });
}
async function screenshot(name, resetScroll = true) { if(resetScroll) await evaluate('document.querySelector("#inspector-body").scrollTop=0'); await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))'); const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); await writeFile(resolve(shots, name), Buffer.from(result.data, 'base64')); screenshots.push(name); }
async function visible(selector) { return evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});return!!e&&e.getClientRects().length>0&&getComputedStyle(e).visibility!=='hidden'})()`); }
async function closePanel() { if ((await route()).open === 'true') await button('#close-inspector'); }
async function openPage(page) {
  const current = await route(); if (current.open !== 'true' || current.page !== page) { await closePanel(); await button(page === 'city' ? '#toggle-inspector' : page === 'help' ? '#toggle-help' : '#toggle-game-menu'); }
  await until(`document.querySelector('#inspector').dataset.page===${JSON.stringify(page)}&&document.querySelector('#inspector').dataset.open==='true'`);
}
async function load(json) {
  await openPage('game');
  if ((await route()).submenu) await button('#submenu-back');
  await evaluate(`localStorage.setItem('citymanager.save.v2',${JSON.stringify(json)})`); await button('#load');
  const expected = JSON.parse(json); await until(`JSON.parse(window.cityManager.snapshot()).tick===${expected.tick}`); assert.deepEqual(await state(), expected);
  assert.equal(await evaluate('document.querySelector("#pause").getAttribute("aria-pressed")'), 'true');
}
async function cell(index, close = true) {
  if (close) await closePanel();
  // Camera controls request an on-demand PlayCanvas frame. Read the ground
  // projection after that frame, rather than racing cached camera matrices.
  await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  const point = await evaluate(`window.cityManager.cellScreen(${index})`);
  assert.equal(await evaluate(`document.elementFromPoint(${point.x},${point.y})?.id`), 'city-canvas', `Map cell ${index} is genuinely hit`); await click(point.x, point.y);
}
async function place(building, close = true) {
  await cell(building.cell, close);
  try { await until(`document.querySelector('#inspector').dataset.page==='entity'&&document.querySelector('#entity-content').dataset.scope==='place'&&document.querySelector('#entity-content').dataset.entityId==='${building.id}'`); }
  catch(error){throw Error(`Expected building ${building.id} at cell ${building.cell}; actual ${JSON.stringify(await evaluate('({cell:document.querySelector("#entity-content").dataset.cell,id:document.querySelector("#entity-content").dataset.entityId,title:document.querySelector("#selection-title").textContent,width:innerWidth,height:innerHeight})'))}; ${error.message}`);}
  assert.equal(await visible('#city-content'), false); assert.equal(await visible('#help-content'), false);
  assert.equal(await evaluate('document.querySelector("#entity-content #ledger")===null&&document.querySelector("#entity-content #accounts")===null'), true);
}
async function metrics(root, expected) {
  const actual = await evaluate(`Object.fromEntries([...document.querySelectorAll(${JSON.stringify(root + ' [data-context-metric]')})].map(e=>[e.dataset.contextMetric,e.dataset.value]))`);
  for (const [key, value] of Object.entries(expected)) assert.equal(actual[key], String(value), `${root} metric ${key}`);
}
function expectedRows(kind, wallet) {
  const journal = kind === 'money' ? fixture.ledger : fixture.goodsLedger;
  return journal.map((entry, index) => ({ ...entry, index })).reverse().filter(entry => !wallet || entry.from === wallet || entry.to === wallet).map(entry => ({ kind, index: entry.index, tick: entry.tick, from: entry.from, to: entry.to, value: kind === 'money' ? entry.amount : entry.quantity, reason: entry.reason }));
}
async function rows(selector) { return evaluate(`[...document.querySelectorAll(${JSON.stringify(selector)})].map(e=>({kind:e.dataset.kind,index:Number(e.dataset.index),tick:Number(e.dataset.tick),from:e.dataset.from,to:e.dataset.to,value:Number(e.dataset.value),reason:e.dataset.reason}))`); }
async function ownFlows(wallet) {
  for (const kind of ['money', 'goods']) {
    const selector = `#entity-content .cx-activity[data-wallet="${wallet}"][data-kind="${kind}"]`, expected = expectedRows(kind, wallet);
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(selector)})?.dataset.scope`), 'wallet');
    const count = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector + ' .cx-count[data-total]')});return{shown:Number(e.dataset.shown),total:Number(e.dataset.total)}})()`);
    assert.equal(count.total, expected.length); assert.deepEqual(await rows(`${selector} .cx-flow-card`), expected.slice(0, count.shown));
    if (expected.length > 8) { await button(`${selector} [data-context-flow-action="toggle"]`); assert.deepEqual(await rows(`${selector} .cx-flow-card`), expected); await button(`${selector} [data-context-flow-action="toggle"]`); }
  }
}
async function household(household, source) {
  await button(`#entity-content [data-household-id="${household.id}"]`);
  await until(`document.querySelector('#entity-content').dataset.scope==='household'&&document.querySelector('#entity-content').dataset.entityId==='${household.id}'`);
  const allocations = employmentForHousehold(fixture, household.id), employed = householdWorkerCount(fixture, household.id);
  await metrics('#entity-content', { cash: fixture.accounts[household.wallet], home: household.home === null ? 'null' : household.home, members: household.members, workforce: household.workforce, dependents: household.dependents, employed, unemployed: household.workforce - employed, employers: new Set(allocations.map(a => a.firmId)).size, needs: household.needs, 'last-purchase': household.lastPurchaseTick });
  assert.deepEqual(await evaluate('[...document.querySelectorAll("#entity-content .cx-employment-row")].map(e=>({householdId:Number(e.dataset.householdId),firmId:Number(e.dataset.firmId),workers:Number(e.dataset.workers),occupation:e.dataset.occupation,rank:e.dataset.rank}))'), allocations);
  assert.equal(await visible('#entity-content .cx-legacy-assumption'), household.origin === 'legacy-v1');
  assert.equal(await evaluate('document.querySelector("#entity-content").dataset.wallet'), household.wallet); await ownFlows(household.wallet);
  await button('#submenu-back'); await until(`document.querySelector('#entity-content').dataset.scope==='place'&&document.querySelector('#entity-content').dataset.entityId==='${source.id}'`);
}
async function firm(firm, close = true) {
  const building = fixture.buildings.find(b => b.id === firm.building); await place(building, close);
  const reserved = Object.values(firm.workDays).reduce((sum, days) => sum + days * WAGES[firm.zone] / MONTH, 0);
  const allocations = employmentForFirm(fixture, firm.id), householdIds = [...new Set(allocations.map(a => a.householdId))];
  await metrics('#entity-content', { cash: fixture.accounts[firm.wallet], reserved, spendable: Math.max(0, fixture.accounts[firm.wallet] - reserved), stock: firm.inventory, workers: firmWorkerCount(fixture, firm.id), 'household-count': householdIds.length, profit: firm.lastMonthProfit });
  const employees = await evaluate('[...document.querySelectorAll("#entity-content [data-household-id]")].map(e=>Number(e.dataset.householdId))'); assert.deepEqual(employees, householdIds); await ownFlows(firm.wallet); return building;
}
async function submenu(selector, page) { await openPage(page); if ((await route()).submenu) await button('#submenu-back'); await button(`${selector}>summary`); await until(`document.querySelector('#inspector').dataset.submenu===${JSON.stringify(selector.slice(1))}`); }
async function assertLayout() {
  const measured = await evaluate(`(()=>{const p=document.querySelector('#inspector'),r=p.getBoundingClientRect(),b=document.querySelector('#inspector-body'),ratio=Math.min(1,screen.width/innerWidth),fonts=[...p.querySelectorAll('.cx-metric dd,.sm-content p')].filter(e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden').map(e=>parseFloat(getComputedStyle(e).fontSize)*ratio);return{width:innerWidth,height:innerHeight,screenWidth:screen.width,touch:matchMedia('(any-pointer:coarse)').matches,maxTouch:navigator.maxTouchPoints,left:r.left,right:r.right,top:r.top,bottom:r.bottom,scrollWidth:b.scrollWidth,clientWidth:b.clientWidth,bodyFont:fonts.length?Math.min(...fonts):null,buttons:['#close-inspector','#submenu-back'].map(s=>{const e=document.querySelector(s),q=e.getBoundingClientRect();return{selector:s,w:q.width*ratio,h:q.height*ratio,hit:!!document.elementFromPoint(q.x+q.width/2,q.y+q.height/2)?.closest(s)}})}})()`);
  assert.ok(measured.left >= 0 && measured.right <= measured.width + 1 && measured.top >= 0 && measured.bottom <= measured.height + 1, JSON.stringify(measured)); assert.ok(measured.scrollWidth <= measured.clientWidth + 1, 'No horizontal inspector overflow'); assert.ok(measured.bodyFont === null || measured.bodyFont >= 13.5, 'Readable content type at the emulated physical-screen ratio: '+JSON.stringify(measured)); assert.ok(measured.buttons.every(b => b.w >= 43.5 && b.h >= 43.5 && b.hit), 'Back and close remain visible 44px physical controls'); layouts.push(measured);
}
async function viewport(metric) {
  await closePanel(); await send('Emulation.setDeviceMetricsOverride', { ...metric, deviceScaleFactor: metric.deviceScaleFactor ?? 1 }); await send('Emulation.setTouchEmulationEnabled', { enabled: metric.mobile, maxTouchPoints: 2 }); await until(`innerWidth===${metric.width}&&document.querySelector('#city-canvas').clientWidth===${metric.width}`);
  if(metric.width>700&&metric.screenWidth<700){
    await until('document.documentElement.dataset.touchUi==="true"');
    const small=await evaluate(`(()=>{const ratio=screen.width/innerWidth;return [...document.querySelectorAll('.time-hud button,.page-buttons button,.camera-hud button,.tool-dock button')].filter(e=>{const r=e.getBoundingClientRect();return r.width&&r.height&&r.right>0&&r.left<innerWidth&&r.bottom>0&&r.top<innerHeight&&(r.width*ratio<43.5||r.height*ratio<43.5)}).map(e=>({id:e.id,tool:e.dataset.tool,width:e.getBoundingClientRect().width*ratio,height:e.getBoundingClientRect().height*ratio}))})()`);
    assert.deepEqual(small,[],'Wide-phone time, camera, page and construction controls retain 44px physical touch targets');
  }
}

try {
  let targets; for (let n = 0; n < 100; n++) { try { targets = await (await fetch('http://127.0.0.1:9349/json/list')).json(); break; } catch { await sleep(100); } }
  assert.ok(targets?.some(t => t.type === 'page'), 'Installed Edge started'); ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl); await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  ws.onmessage = event => {
    const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { const item = pending.get(message.id); pending.delete(message.id); message.error ? item.reject(Error(JSON.stringify(message.error))) : item.resolve(message.result); }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') { const args = message.params.args, expected = blocked && args.length === 2 && /^Failed to load resource \[\/CityManager\/assets\/kenney-city\/models\/(house-[ab]|shop-[ab]|factory-[ab]|tree|streetlight)\.glb-container\]: Network error$/.test(args[0]?.value) && args[1]?.value === 'Network error'; (expected ? expectedErrors : errors).push(args); }
    if (message.method === 'Fetch.requestPaused') void send('Fetch.failRequest', { requestId: message.params.requestId, errorReason: 'Failed' });
  };
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, screenWidth: 1440, screenHeight: 1000, deviceScaleFactor: 1, mobile: false });
  if (blocked) await send('Fetch.enable', { patterns: [{ urlPattern: '*kenney-city/models/*.glb', requestStage: 'Request' }] });
  await send('Page.navigate', { url }); await until('!!window.cityManager'); await until('window.cityManager.visuals().ready');
  if (await evaluate('document.querySelector("#pause").getAttribute("aria-pressed")!=="true"')) await button('#pause');
  await load(fixtureJson); await screenshot('desktop-overview.png'); checks.push('Valid 65-day save loaded through explicit Game page and real Load control');

  // Keep the native press active across real 10x simulation refreshes. A programmatic
  // click or a re-queried mouseup target would miss the replaced-button regression.
  for (const inputKind of ['mouse', 'mouse', 'touch']) {
    if (inputKind === 'touch') await viewport({ width: 390, height: 844, screenWidth: 390, screenHeight: 844, mobile: true, deviceScaleFactor: 2 });
    await closePanel(); await button('[data-speed="10"]'); await button('#pause'); await place(homes[0]);
    assert.equal(await evaluate('document.querySelector("#pause").getAttribute("aria-pressed")'), 'false');
    const selector = `#entity-content [data-household-id="${homeHousehold.id}"]`;
    const point = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    assert.equal(await evaluate(`!!document.elementFromPoint(${point.x},${point.y})?.closest(${JSON.stringify(selector)})`), true, 'Held household link is actually hit');
    await evaluate(`(()=>{const selector=${JSON.stringify(selector)};window.__contextHeldDown=e=>{const node=e.target.closest(selector);if(!e.isTrusted||!node)return;window.__contextHeld={node,id:node.dataset.householdId,source:node.dataset.sourceBuildingId,pointerType:e.pointerType,tick:JSON.parse(window.cityManager.snapshot()).tick}};window.__contextHeldClick=e=>{const p=window.__contextHeld,node=e.target.closest('[data-household-id]');if(!e.isTrusted||!p||!node)return;p.click={sameNode:node===p.node,connected:p.node.isConnected,id:node.dataset.householdId,source:node.dataset.sourceBuildingId}};document.addEventListener('pointerdown',window.__contextHeldDown,true);document.addEventListener('click',window.__contextHeldClick,true)})()`);
    if (inputKind === 'touch') await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: point.x, y: point.y, id: 1 }] });
    else {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    }
    const down = await evaluate('(()=>{const p=window.__contextHeld;return p&&{id:p.id,source:p.source,pointerType:p.pointerType,tick:p.tick}})()');
    assert.ok(down, 'Actual trusted household pointerdown was observed'); assert.equal(down.id, String(homeHousehold.id)); assert.equal(down.source, String(homes[0].id)); assert.equal(down.pointerType, inputKind);
    await sleep(200);
    const held = await evaluate(`(()=>{const p=window.__contextHeld;return{connected:p.node.isConnected,sameNode:document.querySelector(${JSON.stringify(selector)})===p.node,tick:JSON.parse(window.cityManager.snapshot()).tick}})()`);
    assert.ok(held.connected && held.sameNode, `${inputKind} holds the same actual household DOM node: ${JSON.stringify({ down, held })}`); assert.ok(held.tick > down.tick, 'A real simulation refresh occurred during the 200ms hold');
    if (inputKind === 'touch') await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    else await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    await until(`document.querySelector('#entity-content').dataset.scope==='household'&&document.querySelector('#entity-content').dataset.entityId==='${homeHousehold.id}'`);
    const activation = await evaluate('window.__contextHeld.click'); assert.deepEqual(activation, { sameNode: true, connected: true, id: String(homeHousehold.id), source: String(homes[0].id) }, `${inputKind} native compatibility click activates the original held household node: ${JSON.stringify({ down, held, activation })}`);
    await evaluate('document.removeEventListener("pointerdown",window.__contextHeldDown,true);document.removeEventListener("click",window.__contextHeldClick,true);delete window.__contextHeld;delete window.__contextHeldDown;delete window.__contextHeldClick');
    await button('#submenu-back'); await until(`document.querySelector('#entity-content').dataset.scope==='place'&&document.querySelector('#entity-content').dataset.entityId==='${homes[0].id}'`); await closePanel();
    await button('#pause'); assert.equal(await evaluate('document.querySelector("#pause").getAttribute("aria-pressed")'), 'true');
    await load(fixtureJson); await closePanel(); await button('[data-speed="1"]');
  }
  await viewport({ width: 1440, height: 1000, screenWidth: 1440, screenHeight: 1000, mobile: false });
  checks.push('Two mouse and one trusted touch 200ms household-link holds preserve the same DOM through native activation during live 10x refreshes; Back returns to source home and frozen fixture is restored');

  for (const home of homes) {
    await place(home); const occupied = homeOccupancy(fixture, home.id), capacity = housingCapacity(home);
    await metrics('#entity-content', { level: home.level, age: home.age, households: occupied.households, persons: occupied.persons, 'vacant-households': capacity.households - occupied.households, 'vacant-persons': capacity.persons - occupied.persons });
    assert.deepEqual(await evaluate('[...document.querySelectorAll("#entity-content [data-household-id]")].map(e=>Number(e.dataset.householdId))'), fixture.households.filter(h => h.home === home.id).map(h => h.id));
    assert.equal(await evaluate('Number(document.querySelector("#entity-content [data-context-metric=households]").dataset.capacity)'), capacity.households);
    assert.equal(await evaluate('Number(document.querySelector("#entity-content [data-context-metric=persons]").dataset.capacity)'), capacity.persons);
  }
  await place(homes[0]); await place(homes[1], false); checks.push('House A/B isolate actual occupants; another map selection replaces the open entity scope');
  await place(homes[0]); await household(homeHousehold, homes[0]); await button(`#entity-content [data-household-id="${homeHousehold.id}"]`); await key('Escape'); await until(`document.querySelector('#entity-content').dataset.scope==='place'&&document.querySelector('#entity-content').dataset.entityId==='${homes[0].id}'`); await button(`#entity-content [data-household-id="${homeHousehold.id}"]`); await place(homes[1], false); await button('#submenu-back'); assert.notEqual((await route()).open, 'true'); checks.push('Household cash/job/home/needs and every scoped journal row match state; Back/Escape return to source home and map selection clears household scope');
  for (const company of firms) { const building = await firm(company), allocation = employmentForFirm(fixture, company.id)[0]; if (allocation) await household(fixture.households.find(h => h.id === allocation.householdId), building); }
  checks.push('Firm A/B cash, payroll reserve, stock, workers, profit and scoped money/goods are exact; employee Back returns to source firm');

  await openPage('city'); const fromTick = Math.max(0, fixture.tick - MONTH + 1), period = e => e.tick >= fromTick && e.tick <= fixture.tick;
  const income = fixture.ledger.filter(e => period(e) && e.to === 'treasury').reduce((n, e) => n + e.amount, 0), expense = fixture.ledger.filter(e => period(e) && e.from === 'treasury').reduce((n, e) => n + e.amount, 0);
  const goods = reason => fixture.goodsLedger.filter(e => period(e) && e.reason === reason).reduce((n, e) => n + e.quantity, 0);
  const totals = summary(fixture), occupiedHomes = fixture.households.filter(h => h.home !== null);
  await metrics('#city-overview', { treasury: fixture.accounts.treasury, population: totals.population, households: totals.households, workforce: totals.workforce, dependents: totals.dependents, employed: totals.employed, unemployed: totals.unemployed, homeless: totals.homeless, 'homeless-persons': fixture.households.filter(h => h.home === null).reduce((n, h) => n + h.members, 0), 'home-slots': totals.homeSlots, 'person-capacity': totals.personCapacity, 'occupied-home-slots': occupiedHomes.length, 'occupied-persons': occupiedHomes.reduce((n, h) => n + h.members, 0), 'housing-vacancy': totals.homeSlots - occupiedHomes.length, 'person-vacancy': totals.personCapacity - occupiedHomes.reduce((n, h) => n + h.members, 0), jobs: totals.jobs, firms: fixture.firms.length, inventory: fixture.firms.reduce((n, f) => n + f.inventory, 0), income, expense, net: income - expense, produced: goods('Daily worker production'), imported: goods('Imported shop stock'), consumed: goods('Household final consumption'), exported: goods('Exported goods') });
  assert.deepEqual(await evaluate('({from:Number(document.querySelector("#city-overview").dataset.fromTick),to:Number(document.querySelector("#city-overview").dataset.toTick)})'), { from: fromTick, to: fixture.tick });
  for (const [kind, section, root, count] of [['money', '#money-section', '#ledger', 12], ['goods', '#goods-section', '#goods-ledger', 10]]) { await submenu(section, 'city'); assert.deepEqual(await rows(`${root} .sm-flow-card`), expectedRows(kind).slice(0, count)); await button('#submenu-back'); assert.equal((await route()).page, 'city'); assert.equal((await route()).open, 'true'); }
  await submenu('#accounts-section', 'city'); const wallets = await evaluate('Object.fromEntries([...document.querySelectorAll("#accounts .sm-wallet-card")].map(e=>[e.dataset.id,Number(e.dataset.balance)]))'); assert.deepEqual(wallets, fixture.accounts); await button('#submenu-back'); checks.push('Only city dashboard exposes exact whole-city journals/wallets and current stocks versus inclusive 30-day flows');
  await openPage('help'); assert.equal(await visible('#help-content'), true); assert.equal(await visible('#city-content'), false); assert.equal(await visible('#entity-content'), false); await submenu('#guide', 'help'); await button('#submenu-back'); assert.equal((await route()).page, 'help'); await key('Escape'); assert.notEqual((await route()).open, 'true'); checks.push('Help is separate; submenu Back returns to help and Escape then closes the panel');

  await place(homes[0]); const projection = await evaluate(`window.cityManager.cellScreen(${homes[0].cell})`); assert.equal(await evaluate('[...document.querySelectorAll("[data-camera]")].every(e=>e.disabled)'), true);
  for (const value of ['ArrowLeft', 'q', 'e']) await key(value);
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: projection.x, y: projection.y, deltaX: 0, deltaY: -180 }); assert.deepEqual(await evaluate(`window.cityManager.cellScreen(${homes[0].cell})`), projection); await closePanel(); await key('ArrowRight'); await until(`JSON.stringify(window.cityManager.cellScreen(${homes[0].cell}))!==${JSON.stringify(JSON.stringify(projection))}`); assert.notDeepEqual(await evaluate(`window.cityManager.cellScreen(${homes[0].cell})`), projection); await button('[data-camera="reset"]'); assert.deepEqual(await state(), fixture); checks.push('Open inspector disables camera buttons and ignores wheel/arrows/q/e; closing restores camera input without model changes');

  await place(homes[0]); await button('[data-tool="bulldoze"]'); await cell(homes[0].cell, false); const demolished = await state(); assert.equal(demolished.buildings.some(b => b.id === homes[0].id), false); assert.notEqual((await route()).id, String(homes[0].id)); assert.deepEqual(deserialize(JSON.stringify(demolished)), demolished);
  await openPage('game'); await button('#save'); assert.deepEqual(JSON.parse(await evaluate('localStorage.getItem("citymanager.save.v2")')), demolished); await load(fixtureJson); await button('[data-tool="select"]'); await place(homes[0]); await load(emptyJson); assert.notEqual((await route()).page, 'entity'); assert.equal(await evaluate('!!document.querySelector("#entity-content").dataset.entityId'), false); await load(fixtureJson); checks.push('Real demolition clears stale entity route; Game-menu Save is exact and loading a different valid city clears old scope');

  await viewport({ width: 390, height: 844, screenWidth: 390, screenHeight: 844, mobile: true, deviceScaleFactor: 2 });
  await place(homes[0]); await assertLayout(); await screenshot('phone-house.png'); await evaluate('document.querySelector("#entity-content .cx-household-list").scrollIntoView({block:"start"})'); await screenshot('phone-house-members.png',false); await button(`#entity-content [data-household-id="${homeHousehold.id}"]`); await assertLayout(); await screenshot('phone-household.png');
  await firm(firms[0]); await assertLayout(); await screenshot('phone-firm.png'); await evaluate('document.querySelector("#entity-content [data-context-metric=stock]").scrollIntoView({block:"start"})'); await screenshot('phone-firm-stock.png',false); await openPage('city'); await assertLayout(); await screenshot('phone-city.png'); await evaluate('document.querySelector("#city-overview .cx-period-banner").scrollIntoView({block:"start"})'); await screenshot('phone-city-flows.png',false); await submenu('#guide', 'help'); await assertLayout(); await screenshot('phone-help.png');
  for (const metric of [{ width: 360, height: 800, screenWidth: 360, screenHeight: 800, mobile: true }, { width: 980, height: 2120, screenWidth: 390, screenHeight: 844, mobile: true }, { width: 844, height: 390, screenWidth: 844, screenHeight: 390, mobile: true }]) { await viewport(metric); await firm(firms[1]); await assertLayout(); await screenshot(`context-${metric.width}.png`); if(metric.width===980){await openPage('city');await assertLayout();await screenshot('phone-wide-city.png');} }
  await viewport({ width: 1440, height: 1000, screenWidth: 1440, screenHeight: 1000, mobile: false }); await firm(firms[0]); await assertLayout(); await screenshot('desktop-firm.png'); await openPage('city');await assertLayout();assert.deepEqual(await state(), fixture); checks.push('390/360 phone, 844 landscape, 980 layout on screen390 and desktop retain contained readable contexts and hit-tested Back/close');
  assert.deepEqual(errors, []); const visuals = await evaluate('window.cityManager.visuals()'); if (blocked) { assert.equal(expectedErrors.length, 8); assert.equal(visuals.loaded.length, 0); } else assert.equal(visuals.loaded.length, 8);
  checks.push(blocked ? 'Fallback rendering has exactly eight expected model failures and no unexpected errors' : 'All eight admitted visual models load with no runtime/console errors');
  const version = await send('Browser.getVersion'), report = { date: new Date().toISOString(), url, browser: version.product, checks, errors, expectedModelErrors: expectedErrors.length, layouts, screenshots, fixture: { seed: fixture.seed, tick: fixture.tick, households: fixture.households.length, firms: fixture.firms.length }, note: 'Installed headless Edge. Viewport, physical-screen ratio and touch are emulated; no real-device or real phone browser-mode claim.' };
  await writeFile(resolve(output, 'context-report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} catch (error) { if (ws?.readyState === 1) try { await screenshot('context-failure.png'); console.error(await route()); } catch {} console.error('Unexpected browser errors:', errors); throw error; }
finally { if (ws?.readyState === 1) { try { await send('Browser.close'); } catch {} ws.close(); } child.kill(); }
