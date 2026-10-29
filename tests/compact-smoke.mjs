import { assertSavedCity } from './park-session-assertions.mjs';
// Measured compact/tall GUI acceptance. Root runs this sequentially on CDP 9349.
// Baseline mode captures deployed d40; candidate mode reads that frozen JSON only.
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import assert from 'node:assert/strict';
import { deserialize, serialize, firmWorkerCount, householdWorkerCount, homeOccupancy, housingCapacity, firmWage, MONTH } from '../src/sim.ts';
import { reachTouch } from './touch-reach.mjs';

const mode = process.env.CITYMANAGER_COMPACT_MODE || 'candidate';
const referenceCommit = 'd40cd6982ce644ed1e555565d48cf2c1efbdc047';
const url = process.env.CITYMANAGER_URL || (mode === 'baseline' ? 'https://nustanakritwithai.github.io/CityManager/' : 'http://127.0.0.1:4173/CityManager/');
const baselinePath = resolve(process.env.CITYMANAGER_COMPACT_BASELINE || 'docs/compact-preview/baseline.json');
const shots = resolve(process.env.CITYMANAGER_SCREENSHOT_DIR || `docs/compact-preview/${mode}`), output = resolve('.test-output');
const blocked = process.env.CITYMANAGER_BLOCK_MODELS === '1';
const legacyRaw = await readFile(new URL('./fixtures/legacy-v1-day65.json', import.meta.url), 'utf8'), legacy = JSON.parse(legacyRaw);
const hash = text => createHash('sha256').update(text).digest('hex');
assert.equal(hash(legacyRaw), '4e358e66acdfb55dcfd434aaf67be51ccea99c69fc5a2b9b44343035c16166d0');
const migrated = deserialize(legacyRaw); assert.equal(migrated.version, 9);
for (const key of ['accounts', 'ledger', 'goodsLedger', 'goods']) assert.deepEqual(migrated[key], legacy[key], `Migration preserves ${key}`);
for (const key of ['seed', 'rng', 'tick', 'nextId']) assert.equal(migrated[key], legacy[key], `Migration preserves ${key}`);
for (const old of legacy.firms) { const firm = migrated.firms.find(f => f.id === old.id); assert.equal(firm.inventory, old.inventory); assert.deepEqual(firm.workDays, old.workDays); }
const city = mode === 'baseline' ? legacy : migrated, fixture = mode === 'baseline' ? legacyRaw : serialize(city);
const home = city.buildings.find(b => b.zone === 'R'), company = city.firms.find(f => mode === 'baseline' ? f.employees.length > 1 : firmWorkerCount(city, f.id) > 1) || city.firms[0];
const firmBuilding = city.buildings.find(b => b.id === company.building), resident = city.households.find(h => h.home === home.id);
const checks = [], errors = [], expectedErrors = [], screenshots = [], measures = [], liveInputs = [];
await mkdir(shots, { recursive: true }); await mkdir(output, { recursive: true });
let occupied = false; try { occupied = (await fetch('http://127.0.0.1:9349/json/version', { signal: AbortSignal.timeout(500) })).ok; } catch {}
assert.equal(occupied, false, 'Run browser suites sequentially; CDP 9349 is occupied');
const child = spawn(process.env.CITYMANAGER_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-component-update', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=9349', `--user-data-dir=${resolve(output, 'edge-profile')}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
let ws, id = 0; const pending = new Map(); const sleep = ms => new Promise(r => setTimeout(r, ms));
async function send(method, params = {}) { const key = ++id; const p = new Promise((resolve, reject) => { const timer = setTimeout(() => { pending.delete(key); reject(Error(`CDP timeout ${method}`)); }, 30000); pending.set(key, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } }); }); ws.send(JSON.stringify({ id: key, method, params })); return p; }
async function evaluate(expression) { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; }
async function until(expression) { const start = Date.now(); while (Date.now() - start < 15000) { if (await evaluate(expression)) return; await sleep(80); } throw Error(`Timed out ${expression}`); }
const paints = () => evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
const state = () => mode === 'baseline' ? evaluate('JSON.parse(window.cityManager.snapshot())') : evaluate('(()=>{const c=JSON.parse(window.cityManager.snapshot());if(c.version!==19||c.rulesVersion!=="chain-14")throw new Error("Unexpected current save envelope");c.version=9;c.rulesVersion="chain-4";return c})()');
async function click(x, y) { for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: 1 }); }
async function button(selector) { if (await reachTouch(evaluate, button, selector)) return; await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest',inline:'nearest'})`); await paints(); const r = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height,disabled:e.disabled}})()`); assert.ok(r.w && r.h && !r.disabled, selector); assert.equal(await evaluate(`!!document.elementFromPoint(${r.x},${r.y})?.closest(${JSON.stringify(selector)})`), true, `Actually hit ${selector}`); await click(r.x, r.y); }
async function key(value) { for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: value, code: value, windowsVirtualKeyCode: value === 'Escape' ? 27 : undefined }); }
const route = () => evaluate('({page:document.querySelector("#inspector").dataset.page,open:document.querySelector("#inspector").dataset.open,submenu:document.querySelector("#inspector").dataset.submenu})');
async function close() { if ((await route()).open === 'true') await button('#close-inspector'); }
async function page(name) { if ((await route()).open !== 'true' || (await route()).page !== name) { await close(); await button(name === 'city' ? '#toggle-inspector' : name === 'help' ? '#toggle-help' : '#toggle-game-menu'); } await until(`document.querySelector('#inspector').dataset.page===${JSON.stringify(name)}`); }
async function loadFixture() { await page(mode === 'baseline' ? 'city' : 'game'); if ((await route()).submenu) await button('#submenu-back'); await evaluate(`localStorage.setItem(${JSON.stringify(mode === 'baseline' ? 'citymanager.save.v1' : 'citymanager.save.v7')},${JSON.stringify(fixture)})`); await button('#load'); assert.deepEqual(await state(), city); await close(); }
async function place(building) { await close(); await paints(); const p = await evaluate(`window.cityManager.cellScreen(${building.cell})`); assert.equal(await evaluate(`document.elementFromPoint(${p.x},${p.y})?.id`), 'city-canvas'); await click(p.x, p.y); await until(`document.querySelector('#entity-content').dataset.entityId==='${building.id}'`); }
async function viewport(metric) { const { name, ...dimensions } = metric; await close(); await send('Emulation.setDeviceMetricsOverride', { ...dimensions, deviceScaleFactor: 1, mobile: true }); await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 }); await until(`innerWidth===${metric.width}&&innerHeight===${metric.height}&&document.querySelector('#city-canvas').clientWidth===${metric.width}`); await paints(); }
async function shot(name) { await evaluate('document.querySelector("#inspector-body").scrollTop=0'); await paints(); const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); await writeFile(resolve(shots, name), Buffer.from(r.data, 'base64')); screenshots.push(name); }
async function measure(name) {
  await evaluate('document.querySelector("#inspector-body").scrollTop=0'); await paints();
  const result = await evaluate(`(()=>{const panel=document.querySelector('#inspector'),body=document.querySelector('#inspector-body'),p=panel.getBoundingClientRect(),b=body.getBoundingClientRect(),ratio=Math.min(1,screen.width/innerWidth),clip={top:Math.max(0,b.top),bottom:Math.min(innerHeight,b.bottom),left:Math.max(0,b.left),right:Math.min(innerWidth,b.right)},cardKind=document.querySelector('#entity-content').dataset.cardKind??null;const coverage=selector=>{const rows=[...document.querySelectorAll(selector)].map(e=>{const r=e.getBoundingClientRect(),height=Math.max(0,Math.min(r.bottom,clip.bottom)-Math.max(r.top,clip.top)),width=Math.max(0,Math.min(r.right,clip.right)-Math.max(r.left,clip.left));return{index:e.dataset.index??e.dataset.contextMetric??e.dataset.cardMetric??e.dataset.householdId,height:r.height,visible:height>0&&width>0,full:r.height>0&&r.width>0&&height>=r.height-1&&width>=r.width-1,visibleHeight:height}});return{total:rows.length,visible:rows.filter(r=>r.visible).length,full:rows.filter(r=>r.full).length,rows}};const primary={factory:['crop-stock','recipe-input','recipe-output','stock'],house:['households','persons','vacant-households','vacant-persons'],household:['members','workforce','dependents','employed','unemployed'],shop:['stock'],market:['crop-stock','crop-cost','realised-profit','workers','cash'],farm:['fertility','harvest-today']}[cardKind]??[],primarySelector=primary.map(key=>'#entity-content .bc-kpis [data-context-metric="'+key+'"]').join(',');return{name:${JSON.stringify(name)},cardKind,primaryKeyMetrics:primarySelector?coverage(primarySelector):null,width:innerWidth,height:innerHeight,screenWidth:screen.width,screenHeight:screen.height,ratio,panel:{top:p.top,bottom:p.bottom,left:p.left,right:p.right,height:p.height},body:{top:b.top,bottom:b.bottom,height:b.height,scrollHeight:body.scrollHeight,clientWidth:body.clientWidth,scrollWidth:body.scrollWidth},ledger:coverage('#ledger .sm-flow-card'),kpi:coverage('#entity-content [data-context-metric]'),requiredFirmKpi:coverage('#entity-content [data-context-metric=cash],#entity-content [data-context-metric=reserved],#entity-content [data-context-metric=spendable],#entity-content [data-context-metric=stock],#entity-content [data-context-metric=workers],#entity-content [data-context-metric=household-count],#entity-content [data-context-metric=profit]'),households:coverage('#entity-content .cx-household-link'),controls:['#close-inspector','#submenu-back'].map(s=>{const e=document.querySelector(s),r=e.getBoundingClientRect();return{selector:s,width:r.width*ratio,height:r.height*ratio,hit:!!document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest(s)}})}})()`);
  measures.push(result); return result;
}
async function ledger() { await page('city'); if ((await route()).submenu) await button('#submenu-back'); await button('#money-section>summary'); await until('document.querySelector("#inspector").dataset.submenu==="money-section"'); }
async function primaryCapture() {
  await viewport({ width: 360, height: 740, screenWidth: 360, screenHeight: 780 });
  await ledger(); await measure('s22-ledger'); await shot('s22-ledger.png');
  await place(firmBuilding); await measure('s22-firm'); await shot('s22-firm.png');
  await place(home); await measure('s22-house'); await shot('s22-house.png');
  await button(`#entity-content [data-household-id="${resident.id}"]`); await until('document.querySelector("#entity-content").dataset.scope==="household"'); await measure('s22-household'); await shot('s22-household.png'); await close();
}
async function publicProvenance() {
  const response = await fetch(url); assert.equal(response.status, 200); const html = await response.text();
  const paths = [...html.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css))["']/g)].map(m => new URL(m[1], url).href), assets = [];
  assert.ok(paths.length >= 2, 'Baseline HTML identifies built JS/CSS');
  for (const assetUrl of paths) { const r = await fetch(assetUrl); assert.equal(r.status, 200); const bytes = Buffer.from(await r.arrayBuffer()); assets.push({ url: assetUrl, bytes: bytes.length, sha256: hash(bytes) }); }
  return { requestedSourceCommit: referenceCommit, deploymentRun: '40073201082', url, fetchedAt: new Date().toISOString(), htmlSha256: hash(html), assets, note: 'Actual public bytes captured. Root must match these hashes to the d40 deployment artifact before admitting this baseline.' };
}
function assertTall(m, name) {
  assert.ok(m.panel.left >= 0 && m.panel.right <= m.width + 1 && m.panel.top >= 0 && m.panel.bottom <= m.height + 1, `Viewport-contained ${name}`);
  assert.ok(m.panel.height >= m.height * .9, `Tall reading surface >=90% viewport: ${name} ${JSON.stringify(m.panel)}`);
  assert.ok(m.body.scrollWidth <= m.body.clientWidth + 1 && m.body.height > 0, `Contained scroll body ${name}`);
  assert.ok(m.controls.every(c => c.width >= 43.5 && c.height >= 43.5 && c.hit), `Sticky 44px Back/close ${name}`); return m;
}
async function tall(name) { return assertTall(await measure(name), name); }
async function mapRestored() {
  await close(); await paints(); const p = await evaluate(`window.cityManager.cellScreen(${home.cell})`);
  assert.equal(await evaluate(`document.elementFromPoint(${p.x},${p.y})?.id`), 'city-canvas', 'Map returns after closing the tall reading panel');
}
async function disclosure(scope, cardSelector, detailSelector, name) {
  const original = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(cardSelector)}),r=e.getBoundingClientRect();return{...e.dataset,tag:e.tagName,open:e.open,height:r.height}})()`);
  assert.equal(original.tag, 'DETAILS', 'Compact event is a native disclosure'); assert.equal(original.open, false);
  const expected = (original.kind === 'money' ? city.ledger : city.goodsLedger)[Number(original.index)]; assert.ok(expected);
  assert.deepEqual({ tick: Number(original.tick), from: original.from, to: original.to, value: Number(original.value), reason: original.reason }, { tick: expected.tick, from: expected.from, to: expected.to, value: original.kind === 'money' ? expected.amount : expected.quantity, reason: expected.reason });
  const summary = `${cardSelector}>summary`, size = await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(summary)}).getBoundingClientRect(),k=Math.min(1,screen.width/innerWidth);return{w:r.width*k,h:r.height*k}})()`); assert.ok(size.w >= 43.5 && size.h >= 43.5, 'Compact row keeps a 44px hit area');
  await button(summary); await until(`document.querySelector(${JSON.stringify(cardSelector)}).open===true`);
  const detail = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(cardSelector)}),d=e.querySelector(${JSON.stringify(detailSelector)});return{...e.dataset,height:e.getBoundingClientRect().height,visible:!!d&&d.getClientRects().length>0,text:d?.textContent}})()`);
  assert.ok(detail.height > original.height && detail.visible, 'Tap reveals full event details');
  for (const actual of [expected.from, expected.to, expected.reason, String(expected.tick)]) assert.ok(detail.text.includes(actual), `Expanded ${scope} retains ${actual}`);
  await tall(`${name}-expanded`); await shot(`${name}-expanded.png`); await button(summary); await until(`document.querySelector(${JSON.stringify(cardSelector)}).open===false`);
  assert.deepEqual(await state(), city, 'Event expansion is presentation only');
}
async function liveRow() {
  for (const input of ['mouse', 'touch']) {
    await mapRestored(); await button('[data-speed="10"]'); await button('#pause'); await ledger();
    await button('[data-kind="money"][data-journal-action="all"]'); await evaluate('document.querySelector("#inspector-body").scrollTop=0'); await paints();
    // Coordinates are only a prepared aim. The trusted native event records the
    // actual row that was pressed after any intervening live-list refresh.
    const prepared = await evaluate(`(()=>{
      const data=e=>e?{kind:e.dataset.kind,index:Number(e.dataset.index),tick:Number(e.dataset.tick),from:e.dataset.from,to:e.dataset.to,value:Number(e.dataset.value),reason:e.dataset.reason}:null;
      const probe={data};window.__compactHeldInput=probe;
      document.addEventListener('pointerdown',event=>{const summary=event.target.closest?.('#ledger .sm-flow-card>summary');if(!summary)return;const card=summary.closest('.sm-flow-card'),city=JSON.parse(window.cityManager.snapshot());Object.assign(probe,{card,summary,down:{data:data(card),tick:city.tick,entry:city.ledger[Number(card.dataset.index)],trusted:event.isTrusted,pointerType:event.pointerType}});},{capture:true,once:true});
      document.addEventListener('pointerup',event=>{const summary=event.target.closest?.('#ledger .sm-flow-card>summary');probe.release={data:data(summary?.closest('.sm-flow-card')),sameSummary:summary===probe.summary,trusted:event.isTrusted,pointerType:event.pointerType};},{capture:true,once:true});
      document.addEventListener('click',event=>{const summary=event.target.closest?.('#ledger .sm-flow-card>summary');probe.click={data:data(summary?.closest('.sm-flow-card')),sameSummary:summary===probe.summary,trusted:event.isTrusted};},{capture:true,once:true});
      const card=document.querySelector('#ledger .sm-flow-card'),summary=card.querySelector('summary'),r=summary.getBoundingClientRect();return{data:data(card),x:r.x+r.width/2,y:r.y+r.height/2};
    })()`);
    if (input === 'touch') await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: prepared.x, y: prepared.y, id: 1 }] });
    else await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: prepared.x, y: prepared.y, button: 'left', clickCount: 1 });
    const down = await evaluate('window.__compactHeldInput.down');
    console.log('Actual ledger pointerdown:', JSON.stringify({ input, prepared, down }));
    assert.ok(down?.trusted && down.pointerType === input, `Actual trusted ${input} pointerdown hit a ledger row`);
    assert.deepEqual(down.data, { kind: 'money', index: down.data.index, tick: down.entry.tick, from: down.entry.from, to: down.entry.to, value: down.entry.amount, reason: down.entry.reason }, 'Actual pressed identity matches the live journal');
    await sleep(200);
    const held = await evaluate(`(()=>{const p=window.__compactHeldInput;return{tick:JSON.parse(window.cityManager.snapshot()).tick,cardConnected:p.card.isConnected,summaryConnected:p.summary.isConnected,sameCard:document.querySelector('#ledger .sm-flow-card[data-index="'+p.down.data.index+'"]')===p.card,data:p.data(p.card)}})()`);
    console.log('Held ledger identity:', JSON.stringify({ input, down: down.data, held }));
    assert.ok(held.tick > down.tick, 'A real 10x tick occurred while the pointer was held'); assert.ok(held.cardConnected && held.summaryConnected && held.sameCard, 'The actual pressed DOM nodes survive the entire hold'); assert.deepEqual(held.data, down.data);
    if (input === 'touch') await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    else await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: prepared.x, y: prepared.y, button: 'left', clickCount: 1 });
    const release = await evaluate('({release:window.__compactHeldInput.release,click:window.__compactHeldInput.click})');
    const diagnostic = { input, prepared, down, held, ...release }; liveInputs.push(diagnostic); console.log('Live row input diagnostics:', JSON.stringify(diagnostic));
    assert.ok(release.release?.trusted && release.release.sameSummary, 'Pointer release hits the original pressed summary'); assert.deepEqual(release.release.data, down.data);
    await until(`document.querySelector('#ledger .sm-flow-card[data-index="${down.data.index}"]')?.open===true`);
    const clicked = await evaluate('window.__compactHeldInput.click'); assert.ok(clicked?.trusted && clicked.sameSummary, 'The original summary receives the trusted native activation'); assert.deepEqual(clicked.data, down.data);
    const releaseTick = (await state()).tick; await until(`JSON.parse(window.cityManager.snapshot()).tick>${releaseTick}`);
    const after = await evaluate(`(()=>{const p=window.__compactHeldInput,e=document.querySelector('#ledger .sm-flow-card[data-index="'+p.down.data.index+'"]');return{open:e?.open,data:p.data(e),text:e?.querySelector('.sm-flow-details')?.textContent}})()`);
    assert.equal(after.open, true, 'The actual activated identity remains expanded after a further refresh'); assert.deepEqual(after.data, down.data); for (const fact of [down.data.from, down.data.to, down.data.reason]) assert.ok(after.text.includes(fact));
    await evaluate('delete window.__compactHeldInput'); await close(); await button('#pause'); await loadFixture(); await button('[data-speed="1"]');
  }
}
function householdMetrics(h) {
  const jobs = [...city.employment.filter(e => e.householdId === h.id), ...city.ownerLabor.filter(e => e.householdId === h.id)], employed = householdWorkerCount(city, h.id);
  return { cash: city.accounts[h.wallet], members: h.members, workforce: h.workforce, dependents: h.dependents, employed, unemployed: h.workforce - employed, employers: new Set(jobs.map(e => e.firmId)).size, home: h.home === null ? 'null' : h.home, needs: h.needs, 'last-purchase': h.lastPurchaseTick };
}
async function preservedMetrics(expected, identity) {
  const summary = '#entity-content .bc-secondary>summary';
  assert.equal(await evaluate('document.querySelector("#entity-content .bc-secondary").open'), false, 'Secondary accounting starts progressively disclosed');
  await evaluate(`document.querySelector(${JSON.stringify(summary)}).scrollIntoView({block:'nearest',inline:'nearest'})`); await paints();
  const size = await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(summary)}).getBoundingClientRect(),k=Math.min(1,screen.width/innerWidth);return{w:r.width*k,h:r.height*k}})()`); assert.ok(size.w >= 43.5 && size.h >= 43.5, 'Secondary summary is a genuine44px physical hit target');
  await button(summary); await until('document.querySelector("#entity-content .bc-secondary").open===true');
  const actual = await evaluate('(()=>{const h=document.querySelector("#entity-content");return{id:h.dataset.entityId,metrics:[...h.querySelectorAll("[data-context-metric]")].map(e=>({key:e.dataset.contextMetric,value:e.dataset.value,rendered:e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0}))}})()');
  assert.equal(actual.id, String(identity));
  for (const [key, value] of Object.entries(expected)) { const rows = actual.metrics.filter(row => row.key === key); assert.equal(rows.length, 1, `Preserved metric ${key} appears exactly once`); assert.equal(rows[0].value, String(value), `Preserved metric ${key} matches actual city state`); assert.equal(rows[0].rendered, true, `Preserved metric ${key} is available after native disclosure`); }
  await button(summary); await until('document.querySelector("#entity-content .bc-secondary").open===false'); assert.deepEqual(await state(), city, 'Progressive metric disclosure never changes city/accounting state');
}
async function linkedHouseholds(source, expected) {
  const rows = await evaluate('[...document.querySelectorAll("#entity-content button[data-household-id]")].map(e=>({id:Number(e.dataset.householdId),source:Number(e.dataset.sourceBuildingId),cell:Number(e.dataset.sourceCell),workers:e.dataset.assignedWorkers===undefined?null:Number(e.dataset.assignedWorkers)}))');
  assert.deepEqual(rows, expected.map(row => ({ ...row, source: source.id, cell: source.cell })), 'Actual resident/employer rows remain scoped with conserved worker counts');
  if (rows.length) {
    const selector = `#entity-content button[data-household-id="${rows[0].id}"]`; await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest',inline:'nearest'})`); await paints();
    const size = await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(),k=Math.min(1,screen.width/innerWidth);return{w:r.width*k,h:r.height*k}})()`); assert.ok(size.w >= 43.5 && size.h >= 43.5, 'Reachable household row retains44px hit area');
    await button(selector); await until(`document.querySelector('#entity-content').dataset.scope==='household'&&document.querySelector('#entity-content').dataset.entityId==='${rows[0].id}'`);
    await preservedMetrics(householdMetrics(city.households.find(h => h.id === rows[0].id)), rows[0].id);
    await button('#submenu-back'); await until(`document.querySelector('#entity-content').dataset.scope==='place'&&document.querySelector('#entity-content').dataset.entityId==='${source.id}'`);
  }
}
async function candidateAssertions() {
  const baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
  assert.equal(baseline.schema, 1); assert.equal(baseline.mode, 'baseline'); assert.equal(baseline.fixture.sha256, hash(legacyRaw), 'Historical density baseline uses the frozen v1 bytes, never the migrated v6 hash');
  assert.equal(baseline.provenance.requestedSourceCommit, referenceCommit); assert.equal(baseline.provenance.admittedAgainst?.commit, referenceCommit, 'Frozen public baseline must have artifact admission');
  assert.ok(baseline.provenance.assets.length >= 2 && /^[a-f0-9]{64}$/.test(baseline.provenance.htmlSha256));
  const metric = name => measures.find(m => m.name === name), before = name => baseline.measures.find(m => m.name === name);
  for (const name of ['s22-ledger', 's22-firm', 's22-house', 's22-household']) assertTall(metric(name), name);
  assert.ok(metric('s22-ledger').ledger.full > before('s22-ledger').ledger.full, 'More full ledger events fit than the measured released baseline');
  const firmKind = { I: 'factory', C: 'shop', F: 'farm' }[company.zone];
  for (const [name, kind] of [['s22-firm', firmKind], ['s22-house', 'house'], ['s22-household', 'household']]) { const current = metric(name); assert.equal(current.cardKind, kind); assert.ok(current.primaryKeyMetrics?.total >= 1); assert.equal(current.primaryKeyMetrics.full, current.primaryKeyMetrics.total, 'Meaningful type-specific key metrics fit initially: ' + name); }
  assert.ok(metric('s22-house').households.full >= 1, 'An actual resident row is initially visible with house occupancy');
  await place(firmBuilding);
  const reserved = Object.values(company.workDays).reduce((sum, days) => sum + days * firmWage(company) / MONTH, 0), companyJobs = [...city.employment.filter(e => e.firmId === company.id), ...city.ownerLabor.filter(e => e.firmId === company.id)], employerRows = new Map();
  for (const job of companyJobs) employerRows.set(job.householdId, (employerRows.get(job.householdId) ?? 0) + job.workers);
  await preservedMetrics({ cash: city.accounts[company.wallet], reserved, spendable: city.accounts[company.wallet] - reserved, stock: company.inventory, workers: firmWorkerCount(city, company.id), 'household-count': employerRows.size, profit: company.lastMonthProfit }, firmBuilding.id);
  await linkedHouseholds(firmBuilding, [...employerRows].map(([id, workers]) => ({ id, workers })));
  await place(home); const used = homeOccupancy(city, home.id), capacity = housingCapacity(home);
  await preservedMetrics({ households: used.households, persons: used.persons, 'vacant-households': capacity.households - used.households, 'vacant-persons': capacity.persons - used.persons, level: home.level, age: home.age }, home.id);
  await linkedHouseholds(home, city.households.filter(h => h.home === home.id).map(h => ({ id: h.id, workers: null })));
  checks.push('Frozen artifact-admitted d40 baseline and v1 bytes remain intact with increased global ledger rows; approved type-specific first screens replace generic all-KPI density while native44px secondary disclosures preserve exact original7 firm/6 house/10 household values once and actual resident/employer navigation');
  await page('city'); await tall('s22-city'); await page('help'); await tall('s22-help');
  await ledger(); await tall('s22-ledger-controls'); await disclosure('global money', '#ledger .sm-flow-card', '.sm-flow-details', 'global-row');
  await place(firmBuilding); await tall('s22-firm-controls'); await disclosure('firm money', '#entity-content .cx-activity[data-kind="money"] .cx-flow-card', '.cx-flow-details', 'firm-row');
  await button('#entity-content .cx-facts>summary'); assert.equal(await evaluate('document.querySelector("#entity-content .cx-facts").open'), true); assert.ok(await evaluate('document.querySelector("#entity-content .cx-facts").textContent.length>60')); await button('#entity-content .cx-facts>summary');
  checks.push('Compact native event and meaning disclosures reveal the exact accounts, tick, amount and reason with 44px targets');
  await liveRow(); assert.deepEqual(await state(), city); checks.push('Actual trusted mouse and touch ledger presses survive 200ms live refreshes with the same DOM, exact journal identity and preserved native expansion');
  await page('game');
  for (const id of ['save', 'load', 'new-city', 'inspector-status']) assert.equal(await evaluate(`!!document.querySelector('#${id}')?.closest('#game-content')`), true, `${id} belongs only to explicit Game page`);
  await tall('s22-game'); await button('#save'); await assertSavedCity(evaluate, fixture); await shot('game-menu.png');
  await button('#new-city'); assert.equal(await evaluate('!!document.querySelector("dialog[open]")'), true); await button('dialog button:first-of-type'); assert.deepEqual(await state(), city);
  await key('Escape'); assert.notEqual((await route()).open, 'true'); await mapRestored(); checks.push('Game menu owns persistence/status; actual Save, confirmation Cancel and Back/Escape preserve state and restore the map');
  for (const item of [
    { name: 'browser-height', width: 360, height: 600, screenWidth: 360, screenHeight: 780 },
    { name: 'keyboard-height', width: 360, height: 420, screenWidth: 360, screenHeight: 780 },
    { name: 'landscape', width: 844, height: 390, screenWidth: 844, screenHeight: 390 },
    { name: 'wide-request', width: 980, height: 2120, screenWidth: 390, screenHeight: 844 }
  ]) {
    await viewport(item); await ledger(); await tall(item.name); await shot(`${item.name}.png`); await mapRestored();
    await place(firmBuilding); await tall(`${item.name}-firm`); await place(home); await tall(`${item.name}-house`);
    await button(`#entity-content [data-household-id="${resident.id}"]`); await until('document.querySelector("#entity-content").dataset.scope==="household"'); await tall(`${item.name}-household`);
    await page('city'); await tall(`${item.name}-city`); await page('help'); await tall(`${item.name}-help`);
    await page('game'); await tall(`${item.name}-game`);
    if (item.width === 980) {
      await button('#new-city'); const dialog = await evaluate('(()=>{const d=document.querySelector("dialog[open]"),r=d.getBoundingClientRect(),k=Math.min(1,screen.width/innerWidth);return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight,buttons:[...d.querySelectorAll("button")].map(e=>{const b=e.getBoundingClientRect();return{w:b.width*k,h:b.height*k,font:parseFloat(getComputedStyle(e).fontSize)*k,hit:!!document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)?.closest("dialog button")}})}})()');
      assert.ok(dialog.left >= 0 && dialog.right <= dialog.width && dialog.top >= 0 && dialog.bottom <= dialog.height); assert.ok(dialog.buttons.every(b => b.w >= 43.5 && b.h >= 43.5 && b.font >= 13.5 && b.hit), 'Wide-request New/Cancel retain 44px physical targets and readable type'); await button('dialog button:first-of-type'); assert.deepEqual(await state(), city);
    }
    await mapRestored();
  }
  assert.equal(await evaluate('(()=>{const s=document.querySelector("meta[name=viewport]").content.toLowerCase();return s.includes("user-scalable=no")||s.includes("maximum-scale")})()'), false);
  assert.deepEqual(await state(), city); assert.deepEqual(errors, []); if (blocked) assert.equal(expectedErrors.length, 41); else assert.equal((await evaluate('window.cityManager.visuals()')).loaded.length, 41);
  checks.push('S22-like 360, reduced browser/keyboard heights, landscape and 980-layout/screen390 keep tall content, sticky controls, zoom availability and restored map');
  const version = await send('Browser.getVersion'), report = { schema: 1, mode, date: new Date().toISOString(), url, browser: version.product, baseline: { path: baselinePath, sourceCommit: referenceCommit, fixtureSha256: baseline.fixture.sha256, htmlSha256: baseline.provenance.htmlSha256 }, fixture: { seed: city.seed, tick: city.tick, sha256: hash(fixture) }, checks, errors, expectedModelErrors: expectedErrors.length, measures, liveInputs, screenshots, note: 'Viewport, browser/keyboard-height and physical-screen ratio are emulated. No user-photo dimensions or real-device/browser-mode claims.' };
  await writeFile(resolve(output, 'compact-report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
}
try {
  let tabs; for (let n = 0; n < 100; n++) { try { tabs = await (await fetch('http://127.0.0.1:9349/json/list')).json(); break; } catch { await sleep(100); } }
  assert.ok(tabs?.length); ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl); await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  ws.onmessage = event => { const m = JSON.parse(event.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(Error(JSON.stringify(m.error))) : p.resolve(m.result); } if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails); if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') { const a = m.params.args, expected = blocked && a.length === 2 && /^Failed to load resource \[\/CityManager\/assets\/kenney-city\/models\/([a-z]+(?:-[a-z]+)?)\.glb-container\]: Network error$/.test(a[0]?.value) && a[1]?.value === 'Network error'; (expected ? expectedErrors : errors).push(a); } if (m.method === 'Fetch.requestPaused') void send('Fetch.failRequest', { requestId: m.params.requestId, errorReason: 'Failed' }); };
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true }); await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, screenWidth: 1440, screenHeight: 1000, deviceScaleFactor: 1, mobile: false });
  if (blocked) await send('Fetch.enable', { patterns: [{ urlPattern: '*kenney-city/models/*.glb', requestStage: 'Request' }] });
  await send('Page.navigate', { url: url + '?starter=1' }); await until('!!window.cityManager'); await until('window.cityManager.visuals().ready'); if (await evaluate('document.querySelector("#pause").getAttribute("aria-pressed")!=="true"')) await button('#pause');
  await loadFixture(); await primaryCapture(); assert.deepEqual(await state(), city); assert.deepEqual(errors, []);
  const version = await send('Browser.getVersion');
  if (mode === 'baseline') {
    assert.equal(blocked, false, 'Capture the admitted normal-model baseline');
    const provenance = await publicProvenance(), result = { schema: 1, mode, date: new Date().toISOString(), browser: version.product, fixture: { seed: city.seed, tick: city.tick, sha256: hash(fixture), households: city.households.length, firms: city.firms.length }, provenance, measures, screenshots, errors, note: '360x740 logical viewport and screen360x780 are explicit S22-like assumptions, not dimensions inferred from the user JPEGs or real-device QA.' };
    await mkdir(dirname(baselinePath), { recursive: true }); await writeFile(baselinePath, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
  } else { await candidateAssertions(); }
} catch (error) { if (ws?.readyState === 1) try { await shot('compact-failure.png'); console.error(await route()); } catch {} console.error('Unexpected browser errors', errors); throw error; }
finally { if (ws?.readyState === 1) { try { await send('Browser.close'); } catch {} ws.close(); } child.kill(); }
