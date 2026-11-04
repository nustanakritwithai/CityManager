import { browserSnapshotState } from './browser-snapshot.ts';
import { cityGoals } from '../src/city-goals.ts';
import { expandedGoalCity } from './main-goals-fixture.ts';
// Local-only Edge acceptance for genuine progression and populated park saves.
// CI runs this sequentially against its existing Vite preview and disposable profile.
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { adoptSavedEducation, createCity, step, serialize, deserialize, access, isRetail, firmCapacity, housingCapacity, farmCrop, homeOccupancy, HOUSING_OCCUPANCY_GATE_LEVEL } from '../src/sim.ts';
import { farmStockCapacity } from '../src/agriculture.ts';
import { factoryCropCapacity } from '../src/factory-levels.ts';
import { retailCapacity } from '../src/retail-capacity.ts';
import { deserializeParkSession, serializeParkSession, expandValidatedParkSession } from '../src/park-runtime.ts';
import { startPersistenceFixture } from './persistence-server-fixture.mjs';
import { reachTrafficControl, installTrafficNetworkFence } from './traffic-server-entry-fixture.mjs';
import { panelProviderDenials, isPanelProviderRequest } from './panel-network-denies.mjs';
import { keepSupplied } from './plants.ts';
import { EDUCATION_SUSTAIN_DAYS } from '../src/education.ts';

const output = resolve('.test-output/building-progression'), debugPort = 9364;
const upstreamUrl = process.env.CITYMANAGER_URL || 'http://127.0.0.1:4173/CityManager/';
assert.equal(new URL(upstreamUrl).hostname, '127.0.0.1');
const originalPark = await readFile(new URL('./fixtures/retail-v18-park-session.json', import.meta.url), 'utf8');
const old = JSON.parse(originalPark), imported = expandValidatedParkSession(deserializeParkSession(originalPark));
assert.equal(old.version, 18); assert.equal(old.rulesVersion, 'chain-13');
assert.equal(old.parkRuntime.activity.visitors.length, 6); assert.equal(Object.keys(old.parkRuntime.recreation.citizens).length, 6);
adoptSavedEducation(imported.city);
const migratedPark = serializeParkSession(imported.city, imported.runtime);
/** Satisfies the education upgrade gate without adding campuses, wages, or utility. */
function keepEducationGatesOpen(city) {
  const education = city.education;
  education.schoolReadyDays = Math.max(education.schoolReadyDays, EDUCATION_SUSTAIN_DAYS);
  education.universityReadyDays = Math.max(education.universityReadyDays, EDUCATION_SUSTAIN_DAYS);
  for (const household of city.households) {
    let person = education.people.find(item => item.householdId === household.id);
    if (!person) {
      person = { householdId: household.id, basic: 0, higher: 0, school: 0, university: 0, teacher: 0, professor: 0, campusId: null, progress: 0 };
      education.people.push(person);
    }
    if (person.school + person.university + person.teacher + person.professor > 0) continue;
    person.basic = Math.max(person.basic, household.workforce);
    person.higher = Math.max(person.higher, household.workforce);
  }
  education.residentBasic = education.people.reduce((sum, person) => sum + person.basic, 0);
  education.residentHigher = education.people.reduce((sum, person) => sum + person.higher, 0);
  for (const building of city.buildings) {
    const row = education.sustain.find(item => item.buildingId === building.id);
    if (row) row.days = Math.max(row.days, EDUCATION_SUSTAIN_DAYS);
    else education.sustain.push({ buildingId: building.id, days: EDUCATION_SUSTAIN_DAYS });
  }
}
const snapshots = new Map(), city = expandValidatedParkSession(deserializeParkSession(serialize(createCity(61025)))).city;
for (let day = 1; day <= 180; day++) {
  // Education is on for every city. Hold only its credential counters so day 120
  // still measures the real full-house and paid upgrade.
  keepEducationGatesOpen(city);
  if (day === 120 || day === 150) {
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
const home = findUpgrade(120, 'R'), factory = findUpgrade(120, 'I'), farm = findUpgrade(120, 'F'), shop = findUpgrade(150, 'C', f => f && isRetail(f));
assert.deepEqual([home.previous.level,home.building.level,factory.previous.level,factory.building.level,farm.previous.level,farm.building.level,shop.previous.level,shop.building.level], [3,4,3,4,3,4,4,5]);
assert.deepEqual(housingCapacity(home.building), { households: 5, persons: 20 });
// Occupancy gate: from level 3 a house only rises after every household slot is taken.
assert.equal(HOUSING_OCCUPANCY_GATE_LEVEL, 3);
{ const { before } = snapshots.get(120); assert.ok(home.previous.level >= HOUSING_OCCUPANCY_GATE_LEVEL);
  assert.equal(homeOccupancy(before, home.previous.id).households, housingCapacity(home.previous).households, 'House 3->4 upgrade needs full household occupancy first'); }
assert.equal(firmCapacity(factory.building), 7); assert.equal(factoryCropCapacity(factory.building.level), 28);
assert.equal(firmCapacity(farm.building), 4); assert.equal(farmStockCapacity(farm.building.level), 120);
assert.equal(firmCapacity(shop.building), 4); assert.equal(retailCapacity(shop.building.level).stock, 48);
for (const item of [home, factory, farm, shop]) {
  assert.equal(item.building.id, item.previous.id); assert.equal(item.building.cell, item.previous.cell);
  const { before, after } = snapshots.get(item === shop ? 150 : 120);
  const source = item === home ? 'outside' : item.firm.wallet, reason = item === home ? 'Outside residential height investment' : 'Profitable firm height investment';
  assert.ok(after.ledger.filter(e => e.tick === after.tick).some(e => e.from === source && e.to === 'construction' && e.amount === 20_000 && e.reason === reason), `Paid upgrade ${item.building.id}`);
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
// Validate synthetic comparison saves before launching any browser. Place an occupied
// home at a vacant, road-accessible parcel if the natural city lacks a tower variant.
const towerVariant = cell => (((Math.imul(cell >>> 0, 1103515245) + 12345) >>> 16) & 0x7fff) % 3;
const visualBase = structuredClone(snapshots.get(120).before);
const visualHomes = visualBase.buildings.filter(b => b.zone === 'R' && homeOccupancy(visualBase,b.id).households > 0);
const visualTargets = [];
for (const variant of [0,1,2]) {
  let residence = visualHomes.find(b => towerVariant(b.cell) === variant && !visualTargets.includes(b));
  if (!residence) {
    residence = visualHomes.find(b => !visualTargets.includes(b) && visualHomes.some(other => other !== b && towerVariant(other.cell) === towerVariant(b.cell)));
    assert.ok(residence, 'Synthetic fixture has a spare occupied home');
    const candidates = visualBase.cells.map((cell,index)=>({cell,index})).filter(({cell,index}) => !cell.road && cell.building === null && (cell.zone === 'R' || cell.zone === null) && ![...visualBase.plants, ...visualBase.parks, ...(visualBase.education?.campuses ?? [])].some(item => item.cell === index) && towerVariant(index) === variant && access(visualBase,index));
    candidates.sort((a,b)=>Math.abs(a.index-residence.cell)-Math.abs(b.index-residence.cell));
    assert.ok(candidates.length, 'Synthetic variant has a vacant residential parcel');
    visualBase.cells[residence.cell].building = null; residence.cell = candidates[0].index;
    visualBase.cells[residence.cell].building = residence.id; visualBase.cells[residence.cell].zone = 'R';
  }
  visualTargets.push(residence);
}
const residentialVisualFixtures = new Map([3,4,6,7,9].map(level => {
  const visualCity = structuredClone(visualBase);
  for (const target of visualTargets) {
    const residence = visualCity.buildings.find(b => b.id === target.id);
    residence.level = level; residence.housingType = level >= 7 ? 'condo' : level >= 4 ? 'apartment' : 'cottage';
    assert.ok(homeOccupancy(visualCity,residence.id).households > 0);
  }
  const raw = serialize(visualCity); assert.equal(serialize(deserialize(raw)),raw); return [level,raw];
}));
const emptyTowerCity = deserialize(residentialVisualFixtures.get(9));
for (const household of emptyTowerCity.households) if (household.home === visualTargets[0].id) household.home = visualTargets[1].id;
assert.equal(homeOccupancy(emptyTowerCity,visualTargets[0].id).households,0);
const emptyTowerRaw = serialize(emptyTowerCity); assert.equal(serialize(deserialize(emptyTowerRaw)),emptyTowerRaw);
residentialVisualFixtures.set('9-unoccupied-a',emptyTowerRaw);
// Independent real revised-goal victory: the player-equivalent utility policy is
// applied only between days. The last transition is the actual game step.
const victoryCity=expandValidatedParkSession(deserializeParkSession(serialize(expandedGoalCity(61025,'branches')))).city;
let victoryBefore,victoryAfter;
for(let n=0;n<900;n++){
 const previous=deserialize(serialize(victoryCity));step(victoryCity);
 if(!cityGoals(previous).won&&cityGoals(victoryCity).won){victoryBefore=previous;victoryAfter=deserialize(serialize(victoryCity));break;}
 keepSupplied(victoryCity);
}
assert.ok(victoryBefore&&victoryAfter,'Real revised-goal city reaches victory within 900 days');
assert.equal(victoryBefore.goalRulesVersion,2);assert.equal(cityGoals(victoryBefore).won,false);assert.equal(cityGoals(victoryAfter).won,true);
const victoryRaw=serialize(victoryBefore);
if (process.argv.includes('--preflight')) {
  console.log(JSON.stringify({ visualHomes: visualTargets.map(b => ({ cell: b.cell, variant: towerVariant(b.cell), occupied: homeOccupancy(visualBase,b.id).households })), ticks: [...snapshots.keys()], upgrades: [home, factory, farm, shop].map(item => ({ id: item.building.id, zone: item.building.zone, from: item.previous.level, to: item.building.level })) }));
  process.exit(0);
}

await mkdir(output, { recursive: true });
const server=await startPersistenceFixture(upstreamUrl),url=server.url,allowed=new URL(url),storage=server.fixture;
const interceptionErrors=[];let networkProbe;const observeProbe=url=>(networkProbe={url,active:false,requestId:null,failed:null});
let occupied = false; try { occupied = (await fetch(`http://127.0.0.1:${debugPort}/json/version`, { signal: AbortSignal.timeout(500) })).ok; } catch {}
assert.equal(occupied, false, 'Building progression browser port is already in use');
const child = spawn(process.env.CITYMANAGER_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', [
  '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-component-update',
  '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${resolve(output, 'profile')}`, 'about:blank',
], { windowsHide: true, stdio: 'ignore' });
let ws, seq = 0; const pending = new Map(), errors = [], external = [], providerRequests = [], checks = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const watchdog = setTimeout(() => { console.error('Building progression browser acceptance timed out'); child.kill(); process.exit(1); }, 180_000);
async function send(method, params = {}) {
  const id = ++seq, result = new Promise((yes, no) => { const timer = setTimeout(() => { pending.delete(id); no(Error(`CDP timeout: ${method}`)); }, 30_000); pending.set(id, { yes: v => { clearTimeout(timer); yes(v); }, no: e => { clearTimeout(timer); no(e); } }); });
  ws.send(JSON.stringify({ id, method, params })); return result;
}
async function evaluate(expression) { const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw Error(result.exceptionDetails.text); return result.result.value; }
async function until(expression, timeout = 30_000) { const start = Date.now(); while (Date.now() - start < timeout) { if (await evaluate(expression)) return; await sleep(75); } throw Error(`Timed out: ${expression.slice(0, 120)}`); }
const paints = () => evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
const state = async () => browserSnapshotState(await evaluate('window.cityManager.snapshot()'));
async function click(x,y) { for (const type of ['mouseMoved','mousePressed','mouseReleased']) await send('Input.dispatchMouseEvent',{type,x,y,button:type==='mouseMoved'?'none':'left',clickCount:1}); }
async function button(selector) {
  if (await reachTrafficControl(evaluate, button, selector)) return;
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest',inline:'nearest'})`); await paints();
  const p = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height,disabled:e.disabled}})()`);
  assert.ok(p.w && p.h && !p.disabled, `Visible enabled ${selector}`);
  assert.equal(await evaluate(`!!document.elementFromPoint(${p.x},${p.y})?.closest(${JSON.stringify(selector)})`), true, `Actual hit ${selector}`); await click(p.x,p.y);
}
async function close() { if (await evaluate('document.querySelector("#inspector").dataset.open==="true"')) await button('#close-inspector'); await paints(); }
async function game() { await close(); await button('#toggle-game-menu'); await until('document.querySelector("#inspector").dataset.page==="game"'); }
async function screenshot(name) { const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false}); await writeFile(resolve(output,name),Buffer.from(r.data,'base64')); }
async function load(raw) {
 await storage.leave({send,evaluate,until});const ack=await storage.seed(raw);
 storage.allowNavigation();await send('Page.navigate',{url});await storage.enter({evaluate,button});
 assert.equal(ack.raw,raw);assert.equal(ack.revision,1);await storage.assertNoCityWrites(evaluate);
}
async function saveAndReload({failOnce=false}={}){
 const before=storage.active,raw=await evaluate('window.cityManager.sessionSnapshot()'),writeStart=storage.writes.length;
 if(failOnce){
  server.setSaveFailure(true);await button('#save');await until("!!document.querySelector('#save-failure-banner:not([hidden])')");
  assert.ok(server.rejected.length);assert.deepEqual(storage.active,before);assert.match(await evaluate("document.querySelector('#save-failure-banner').textContent"),/ไม่มีสำเนาในเบราว์เซอร์/);await storage.assertNoCityWrites(evaluate);
  server.setSaveFailure(false);await button('#save-failure-retry');
 }else await button('#save');
 const start=Date.now();while(storage.active.revision===before.revision&&Date.now()-start<30000)await sleep(75);
 await until("document.querySelector('#autosave-status')?.textContent.startsWith('บันทึกบนเซิร์ฟเวอร์แล้ว')");
 const ack=storage.active,events=storage.writes.slice(writeStart);assert.equal(ack.revision,before.revision+(failOnce?2:1));assert.equal(ack.raw,raw);assert.equal(events.length,failOnce?2:1);
 if(failOnce){const failed=server.rejected.at(-1);assert.equal(events[0].requestKey,failed.requestKey);assert.deepEqual(events[0].command,failed.command);assert.notEqual(events[1].requestKey,events[0].requestKey);}
 for(const [i,event] of events.entries()){assert.equal(event.status,200);assert.equal(event.command.expectedRevision,before.revision+i);assert.equal(event.command.raw,raw);assert.equal(event.response.raw,raw);assert.equal(event.response.revision,before.revision+i+1);}
 storage.allowNavigation(raw);await send('Page.reload',{ignoreCache:true});await storage.enter({evaluate,button});
 assert.equal(await evaluate('window.cityManager.sessionSnapshot()'),raw);await storage.assertNoCityWrites(evaluate);
}
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
  ws.onmessage=event=>{const m=JSON.parse(event.data);if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.no(Error(JSON.stringify(m.error))):p.yes(m.result);}if(m.method==='Page.javascriptDialogOpening')void storage.dialog(m.params,send).catch(e=>interceptionErrors.push(String(e)));if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')errors.push(m.params.args.map(a=>a.value??a.description).join(' '));if(m.method==='Network.loadingFailed'&&m.params.requestId===networkProbe?.requestId)networkProbe.failed=m.params;if(m.method==='Network.requestWillBeSent'){const u=m.params.request.url;if(networkProbe?.active&&u===networkProbe.url)networkProbe.requestId=m.params.requestId;else{if(isPanelProviderRequest(u))providerRequests.push(u);if(/^https?:/.test(u)&&new URL(u).origin!==allowed.origin)external.push(u);}}};
  await send('Runtime.enable');await send('Page.enable');await send('Network.enable');await installTrafficNetworkFence({send,evaluate,protocol:await(await fetch(`http://127.0.0.1:${debugPort}/json/protocol`)).json(),origin:allowed.origin,additionalBlocked:panelProviderDenials(allowed.origin),observeProbe});await storage.install(send);
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,screenWidth:1440,screenHeight:1000,deviceScaleFactor:1,mobile:false});
  await load(originalPark);
  assert.equal(await evaluate('window.cityManager.sessionSnapshot()'),migratedPark,'Populated activity, recreation and entire migrated city match');
  assert.equal(storage.active.raw,originalPark,'Load does not rewrite the acknowledged genuine v18 bytes');
  await game();await saveAndReload({failOnce:true});
  assert.equal(await evaluate('window.cityManager.sessionSnapshot()'),migratedPark,'Entire populated session survives acknowledged save and reload');
  checks.push('Genuine v18 park activity/recreation and city migrate without rewriting the service head; failed save preserves it, and retry ACK and reload preserve the full session');
  await runBoundary(120,[home,factory,farm]);
  await inspect(farm.building,'farm'); assert.equal(await evaluate('document.querySelector("#entity-content [data-context-metric=crop-stock]").dataset.capacity'),'120'); assert.match(await evaluate('document.querySelector("#entity-content [data-building-progression]").textContent'), /ระดับ 4\/6[\s\S]*ระดับถัดไป 5/); await screenshot('desktop-farm.png');
  await inspect(factory.building,'factory'); assert.equal(await evaluate('document.querySelector("#entity-content [data-context-metric=crop-stock]").dataset.capacity'),'28'); assert.match(await evaluate('document.querySelector("#entity-content [data-building-progression]").textContent'), /ระดับ 4\/9[\s\S]*ระดับถัดไป 5/);
  await inspect(home.building,'house'); assert.equal(await evaluate('document.querySelector("#entity-content [data-context-metric=households]").dataset.capacity'),'5');
  assert.match(await evaluate('document.querySelector("#entity-content .bc-type-label").textContent'), /อพาร์ตเมนต์ ระดับ 1/);
  assert.equal(await evaluate('!!document.querySelector("#entity-content [data-building-progression]").closest("details")'), false, 'Housing progression is not hidden in collapsed details');
  await screenshot('desktop-apartment-details.png');
  checks.push('Natural day-120 home, factory and farm upgrades match replay, identity, paid costs and real capacity');
  await runBoundary(150,[shop]);
  assert.equal(cityGoals(snapshots.get(150).after).won,false,'Expanded-map fixture has not reached the win dialog at this boundary');
  assert.equal(await evaluate('!!document.querySelector("dialog.win-dialog[open]")'),false);
  await inspect(shop.building,'shop'); assert.equal(await evaluate('document.querySelector("#entity-content [data-commercial-growth]")?.dataset.commercialGrowth'),String(shop.firm.id));
  assert.match(await evaluate('document.querySelector("#entity-content [data-commercial-growth]").textContent'), /ค่าก่อสร้าง 200 เครดิต[\s\S]*สำรองเมือง/); await screenshot('desktop-shop.png'); checks.push('Natural day-150 shop upgrade matches replay, paid cost, identity and capacity');
  // Separate natural revised-goal win retains the actual Continue interaction.
  await load(victoryRaw);assert.deepEqual(await state(),victoryBefore);await close();
  await button('[data-speed="1"]');await button('#pause');
  await until('!!document.querySelector("dialog.win-dialog[open] .win-continue")');
  assert.deepEqual(await state(),victoryAfter,'The actual winning step matches independently simulated state');
  await button('.win-continue');await until('!document.querySelector("dialog.win-dialog[open]")');
  checks.push('A real revised-goal winning step opens the victory dialog and native Continue returns to play');
  // Synthetic renderer-only level comparison, separate from the genuine progression assertions above.
  // No ticks or purchases are inferred from these deliberately edited snapshots.
  for (const [level, raw] of residentialVisualFixtures) {
    await load(raw); await close();
    assert.equal(await evaluate('window.cityManager.snapshot()'), raw, 'Visual fixture stays paused and unchanged');
    for (const target of visualTargets) assert.ok(await evaluate(`(()=>{const p=window.cityManager.cellScreen(${target.cell});return p.x>0&&p.y>0&&p.x<innerWidth&&p.y<innerHeight})()`), 'Variant parcel is visible in the capture viewport');
    assert.ok(await evaluate("['tower-a','tower-b','tower-c'].every(name=>window.cityManager.visuals().loaded.includes(name))"), 'All tower assets loaded');
    for (const mode of ['noon', 'night']) {
      await evaluate(`(()=>{const input=document.querySelector('input[name="atmosphere-time"][value="${mode}"]');input.checked=true;input.dispatchEvent(new Event('change',{bubbles:true}))})()`);
      await until(mode === 'night' ? 'window.cityManager.atmosphere().night > .9' : 'window.cityManager.atmosphere().night < .01');
      await paints(); await paints();
      assert.equal(await evaluate('window.cityManager.atmosphere().settings.timeMode'), mode);
      await screenshot(`desktop-residential-level-${level}-${mode}.png`);
    }
    assert.equal(await evaluate('window.cityManager.snapshot()'), raw, 'Day/night rendering must not mutate save state');
  }
  checks.push('Synthetic R3/R4/R6/R7/R9 day/night captures with all three tower assets loaded and exact city state preserved');
  await close(); await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,screenWidth:390,screenHeight:844,deviceScaleFactor:1,mobile:true}); await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:2}); await until('innerWidth===390');
  await load(residentialVisualFixtures.get(9)); await close();
  for (const mode of ['noon', 'night']) {
    await evaluate(`(()=>{const input=document.querySelector('input[name="atmosphere-time"][value="${mode}"]');input.checked=true;input.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    await until(mode === 'night' ? 'window.cityManager.atmosphere().night > .9' : 'window.cityManager.atmosphere().night < .01');
    await paints(); await paints(); await screenshot(`mobile-residential-level-9-${mode}.png`);
  }
  await load(originalPark); assert.equal(await evaluate('window.cityManager.sessionSnapshot()'),migratedPark); await game();await saveAndReload();
  assert.equal(await evaluate('window.cityManager.sessionSnapshot()'),migratedPark,'Mobile full park session survives save and reload'); await screenshot('mobile-park-session.png');
  checks.push('390px mobile-emulated populated park session survives full save/reload');
  assert.deepEqual(errors,[],'No browser runtime or console errors'); assert.deepEqual(external,[],'No external browser requests');assert.deepEqual(providerRequests,[],'No advisor/provider requests');assert.deepEqual(interceptionErrors,[]);assert.deepEqual(server.errors,[]);await storage.assertNoCityWrites(evaluate);
  await writeFile(resolve(output,'report.json'),JSON.stringify({checks,errors,external,upgrades:[home,factory,farm,shop].map(x=>({id:x.building.id,zone:x.building.zone,level:x.building.level})),note:'Headless Edge; mobile viewport is emulated, not physical-device QA.'},null,2));
  console.log(JSON.stringify({checks,errors,external},null,2));
} catch (error) {
  if (ws?.readyState === 1) { try { await screenshot('failure.png'); } catch {} }
  console.error(JSON.stringify({ checks, errors, external, failure: String(error?.message ?? error) }));
  throw error;
} finally {
  clearTimeout(watchdog); if(ws?.readyState===1){try{await send('Browser.close');}catch{}ws.close();} child.kill();await server.close();
}
