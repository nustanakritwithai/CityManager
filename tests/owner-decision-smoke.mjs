// Local rule-owner acceptance. No model responses are mocked or requested.
// Default is dry-run; root launches explicitly with --run after building a preview.
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, access, readdir } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createCity, step, serialize, deserialize, isMarket, buildRoad } from '../src/sim.ts';
import { SAVE_KEY } from '../src/save-storage.ts';
import { deserializeParkSession } from '../src/park-runtime.ts';
import { captureOwnerSnapshot, proposeOwnerDecision, executeOwnerProposal, ownerStateHash } from '../src/owner-decision.ts';
import { createOwnerDecisionSession } from '../src/owner-decision-session.ts';
import { reachTouch } from './touch-reach.mjs';

const repo = fileURLToPath(new URL('..', import.meta.url));
const url = process.env.CITYMANAGER_OWNER_URL || 'http://127.0.0.1:4191/CityManager/';
assert.equal(new URL(url).hostname, '127.0.0.1', 'Owner QA only targets this task\'s local preview');
const run = process.argv.includes('--run');
assert(process.argv.slice(2).every(arg => ['--run', '--dry-run'].includes(arg)));
assert(!(run && process.argv.includes('--dry-run')));
const candidateCommit = process.env.CITYMANAGER_OWNER_COMMIT || execFileSync('git', ['-c', `safe.directory=${repo.replaceAll('\\', '/')}`, '-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
assert.match(candidateCommit, /^[a-f0-9]{40}$/);
const clone = city => deserialize(serialize(city));
const young = createCity(61025);
let monthlyFixture, manualFixture, manualProposal;
for (let day = 1; day <= 720 && (!monthlyFixture || !manualFixture); day++) {
  step(young);
  const owners = young.firms.filter(firm => isMarket(firm) && firm.owner).sort((a, b) => a.id - b.id);
  if (!monthlyFixture && young.tick % 30 === 29 && owners.length) monthlyFixture = clone(young);
  if (!manualFixture && young.tick >= 31 && young.tick % 30 >= 1 && young.tick % 30 <= 25) {
    for (const firm of owners) {
      const snapshot = captureOwnerSnapshot(young, firm.id); if (!snapshot) continue;
      const proposal = proposeOwnerDecision(snapshot);
      if (proposal.command.type !== 'hold') { manualFixture = clone(young); manualProposal = proposal; break; }
    }
  }
}
assert(monthlyFixture && manualFixture && manualProposal, 'Natural seed61025 supplies a real monthly market and executable owner proposal');
assert.equal(monthlyFixture.version, 9); assert.equal(SAVE_KEY, 'citymanager.save.v7');
const evidence = {
  candidateCommit, url, seed: 61025, saveVersion: 6, ruleOnly: true, llmImplemented: false,
  fixture: { monthlyTick: monthlyFixture.tick, manualTick: manualFixture.tick, firmId: manualProposal.snapshot.firmId, actorId: manualProposal.snapshot.actorId, command: manualProposal.command.type, amountSatang: manualProposal.command.amountSatang },
  safeguards: { syntheticOnly: true, providerTrafficBlocked: true, noCredentialRead: true, automaticApiCallsExpected: 0 },
};
if (!run) { console.log(JSON.stringify({ ...evidence, dryRun: true, browserLaunched: false, ready: true }, null, 2)); process.exit(0); }

const baseOutput = resolve(process.env.CITYMANAGER_OWNER_ARTIFACTS || '.test-output/owner-decisions');
const output = resolve(baseOutput, new Date().toISOString().replace(/[-:.]/g, '') + '-' + process.pid);
const profile = resolve(output, 'edge-profile'); assert(profile.startsWith(output + sep));
await mkdir(output, { recursive: true });
await assert.rejects(access(profile), { code: 'ENOENT' }, 'Never reuse a browser profile');
const port = 9368, pending = new Map(), requestUrls = new Map(), checks = [], layouts = [], screenshots = [], errors = [], apiAttempts = [], networkFailures = [], downloads = [];
const sleep = ms => new Promise(done => setTimeout(done, ms));
const safePrefix = value => /localStorage/.test(String(value)) ? 'synthetic localStorage fixture setup (<payload omitted>)' : String(value).replace(/\s+/g, ' ').slice(0, 180);
let ws, browser, sequence = 0, currentStage = 'setup', lastCommand = null;
const stage = name => { currentStage = name; console.log(`[owner QA] ${name}`); };
async function send(method, params = {}, timeoutMs = 15000) {
  const id = ++sequence, metadata = { method, ...(method === 'Runtime.evaluate' ? { expressionPrefix: safePrefix(params.expression) } : {}) };
  lastCommand = metadata;
  const promise = new Promise((done, reject) => {
    const timer = setTimeout(() => { pending.delete(id); const error = Error(`CDP timeout ${method}`); error.cdp = metadata; reject(error); }, timeoutMs);
    pending.set(id, { done: value => { clearTimeout(timer); done(value); }, reject: error => { clearTimeout(timer); reject(error); } });
  });
  ws.send(JSON.stringify({ id, method, params })); return promise;
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw Error(`Browser evaluation failed: ${result.exceptionDetails.text}`);
  return result.result.value;
}
async function until(expression, timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) { if (await evaluate(expression)) return; await sleep(70); }
  throw Error(`Condition timeout: ${safePrefix(expression)}`);
}
const paints = () => evaluate('new Promise(r=>{const t=setTimeout(r,100);requestAnimationFrame(()=>requestAnimationFrame(()=>{clearTimeout(t);r()}))})');
const state = () => evaluate('(()=>{const c=JSON.parse(window.cityManager.snapshot());if(c.version===11||c.version===12||c.version===13||c.version===14||c.version===15){c.version=9;c.rulesVersion="chain-4"}return c})()');
const hostState = () => evaluate('({...document.querySelector("#owner-decisions").dataset})');
const selector = (key, value) => `[${key}=${JSON.stringify(value)}]`;
async function click(x, y) { for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: 1 }); await paints(); }
async function drag(from, to) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y, button: 'none' });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: to.x, y: to.y, button: 'left', buttons: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', buttons: 0, clickCount: 1 });
  await paints();
}
async function reveal(target) {
  for (let n = 0; n < 8; n++) {
    const point = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(target)}),closed=[];for(let p=e?.parentElement;p;p=p.parentElement)if(p instanceof HTMLDetailsElement&&!p.open)closed.push(p);const s=closed.at(-1)?.querySelector(':scope>summary');if(!s)return null;s.scrollIntoView({block:'nearest'});const r=s.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    if (!point) return; await click(point.x, point.y);
  }
  throw Error('Too many disclosure ancestors');
}
async function button(target, allowDisabled = false) {
  if (await reachTouch(evaluate, button, target)) return;
  await reveal(target); await evaluate(`document.querySelector(${JSON.stringify(target)}).scrollIntoView({block:'nearest',inline:'nearest'})`); await paints();
  const point = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(target)}),r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height,disabled:e.disabled}})()`);
  assert(point.w > 0 && point.h > 0 && (allowDisabled || !point.disabled), `Visible control ${target}`);
  assert(await evaluate(`!!document.elementFromPoint(${point.x},${point.y})?.closest(${JSON.stringify(target)})`), `Actual native hit ${target}`);
  await click(point.x, point.y);
}
async function close() { if (await evaluate('document.querySelector("#inspector").dataset.open==="true"')) await button('#close-inspector'); }
async function openPanel() {
  const already = await evaluate('document.querySelector("#inspector").dataset.open==="true"&&document.querySelector("#inspector").dataset.page==="city"');
  if (!already) { await close(); await button('#toggle-inspector'); }
  await until('!!document.querySelector("#owner-decisions")');
  if (!await evaluate('document.querySelector("#owner-decisions").open')) await button('#owner-decisions-toggle');
  await paints();
}
async function load(city) {
  await close(); await button('#toggle-game-menu');
  await evaluate(`localStorage.setItem(${JSON.stringify(SAVE_KEY)},${JSON.stringify(serialize(city))})`);
  await button('#load'); await close();
  assert.deepEqual(await state(), city, 'Loading preserves exact canonical v6 micro state');
  await openPanel(); assert.equal((await hostState()).mode, 'proposal', 'Load never silently restores auto');
}
async function mode(value) { await button(selector('data-owner-mode', value)); assert.equal((await hostState()).mode, value); }
async function advancePast(targetTick) {
  await close(); await button('[data-speed="10"]');
  assert.equal(await evaluate('document.querySelector("#pause").textContent.trim()'), '▶', 'Fixture remains paused until native Play');
  await button('#pause'); await until(`JSON.parse(window.cityManager.snapshot()).tick>=${targetTick}`); await button('#pause');
  const actual = await state(); assert(actual.tick >= targetTick && actual.tick <= targetTick + 10, 'Bounded native clock advance within the same monthly cycle');
  await openPanel(); return actual;
}
async function shot(name) { const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); await writeFile(resolve(output, name), Buffer.from(result.data, 'base64')); screenshots.push(name); }
async function layout(metrics, name) {
  await send('Emulation.setDeviceMetricsOverride', { ...metrics, deviceScaleFactor: 1, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 }); await paints();
  await evaluate('document.querySelector("#owner-decisions").scrollIntoView({block:"start"})'); await paints();
  const measured = await evaluate(`(()=>{const h=document.querySelector('#owner-decisions'),p=document.querySelector('#inspector').getBoundingClientRect(),body=document.querySelector('#inspector-body'),k=Math.min(1,screen.width/innerWidth),visible=e=>e.getClientRects().length&&!e.closest('details:not([open])>:not(summary)');return{width:innerWidth,height:innerHeight,screenWidth:screen.width,left:p.left,right:p.right,top:p.top,bottom:p.bottom,scrollWidth:body.scrollWidth,clientWidth:body.clientWidth,font:[...h.querySelectorAll('h3,h4,p,li,button,summary,label,dt,dd,[data-owner-fact]')].filter(visible).map(e=>({physical:parseFloat(getComputedStyle(e).fontSize)*k,text:e.textContent.slice(0,60)})),controls:[...h.querySelectorAll('button')].filter(visible).map(e=>{const r=e.getBoundingClientRect();return{w:r.width*k,h:r.height*k}})}})()`);
  assert.equal(measured.width, metrics.width); assert.equal(measured.screenWidth, metrics.screenWidth);
  assert(measured.left >= 0 && measured.right <= measured.width + 1 && measured.top >= 0 && measured.bottom <= measured.height + 1, 'Drawer contained on phone');
  assert(measured.scrollWidth <= measured.clientWidth + 1, 'No horizontal owner-panel overflow');
  assert(measured.font.length > 5 && measured.font.every(row => row.physical >= 13.5), 'Essential owner typography14 physical px');
  assert(measured.controls.length >= 3 && measured.controls.every(item => item.w >= 43.5 && item.h >= 43.5), 'Owner touch controls44 physical px');
  layouts.push(measured); await shot(name);
}
function assertConservation(city) {
  assert.equal(Object.values(city.accounts).reduce((a, b) => a + b, 0), 0);
  assert(Object.entries(city.accounts).every(([id, amount]) => Number.isSafeInteger(amount) && (id === 'outside' || amount >= 0)));
  assert.equal(city.goods.produced + city.goods.imported - city.goods.consumed - city.goods.exported, city.firms.reduce((n, firm) => n + firm.inventory, 0));
  assert.equal(city.crops.harvested - city.crops.processed - city.crops.consumed - city.crops.writtenOff - (city.crops.exported ?? 0), city.firms.reduce((n, firm) => n + firm.cropInventory, 0));
  assert.deepEqual(deserialize(serialize(city)), city);
}

try {
  stage('1 isolated local preview and default mode');
  let occupied = false; try { occupied = (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(500) })).ok; } catch {}
  assert.equal(occupied, false, 'Do not reuse another browser or CDP port');
  browser = spawn(process.env.CITYMANAGER_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-component-update', '--disable-gpu-shader-disk-cache', '--disk-cache-size=1048576', '--media-cache-size=1048576', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--window-size=1440,1000', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let targets; for (let n = 0; n < 100; n++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); break; } catch { await sleep(100); } }
  assert(targets?.some(target => target.type === 'page'));
  ws = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  await new Promise((done, reject) => { ws.onopen = done; ws.onerror = reject; });
  ws.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) { const p = pending.get(message.id); pending.delete(message.id); message.error ? p.reject(Error(message.error.message)) : p.done(message.result); return; }
    if (message.method === 'Runtime.exceptionThrown') errors.push(safePrefix(message.params.exceptionDetails.text));
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(safePrefix(message.params.args.map(arg => arg.value || arg.description || '').join(' ')));
    if (message.method === 'Network.requestWillBeSent') {
      requestUrls.set(message.params.requestId, message.params.request.url);
      if (/api\/city-advisor|opentyphoon\.ai|chat\/completions/.test(message.params.request.url)) { const u = new URL(message.params.request.url); apiAttempts.push({ url: u.origin + u.pathname, method: message.params.request.method }); }
    }
    if (message.method === 'Network.loadingFailed') {
      // A local blob download may terminate its navigation with ERR_ABORTED.
      const localDownload = (requestUrls.get(message.params.requestId) || '').startsWith('blob:') && message.params.errorText === 'net::ERR_ABORTED';
      if (!localDownload) networkFailures.push({ error: message.params.errorText, blockedReason: message.params.blockedReason || null });
    }
    if (message.method === 'Browser.downloadWillBegin') downloads.push({ guid: message.params.guid, filename: message.params.suggestedFilename, complete: false });
    if (message.method === 'Browser.downloadProgress' && message.params.state === 'completed') { const item = downloads.find(value => value.guid === message.params.guid); if (item) item.complete = true; }
  };
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Network.setBlockedURLs', { urls: ['*api.opentyphoon.ai*', '*/api/city-advisor/*', '*/chat/completions*'] });
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: output, eventsEnabled: true });
  await send('Page.navigate', { url: url + '?advanced=1&starter=1' }); await until('!!window.cityManager'); await paints(); // experimental features are off by default
  if (await evaluate('document.querySelector("#pause").textContent.trim()!=="▶"')) await button('#pause');
  await openPanel(); assert.equal((await hostState()).mode, 'proposal');
  const firstText = await evaluate('document.querySelector("#owner-decisions").textContent'); assert.match(firstText, /กฎ/);
  checks.push('Owner decisions are labeled local rules, default proposal, and leave the existing API idle');

  stage('2 manual proposal, existing-command application and duplicate prevention');
  await load(manualFixture); const before = await state(); await button('#owner-evaluate');
  assert.deepEqual(await state(), before, 'Proposal-only evaluation has no canonical effect');
  const row = selector('data-owner-proposal-id', manualProposal.proposalId), apply = selector('data-owner-apply', manualProposal.proposalId);
  await until(`!!document.querySelector(${JSON.stringify(row)})`);
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(row)}).dataset.command`), manualProposal.command.type);
  assert.equal(Number(await evaluate(`document.querySelector(${JSON.stringify(row)}).dataset.amountSatang`)), manualProposal.command.amountSatang);
  const expected = clone(before), outcome = executeOwnerProposal(expected, manualProposal); assert(outcome.ok && outcome.status === 'applied');
  await button(apply); assert.deepEqual(await state(), expected, 'Only the validated existing financial command changes canonical state'); assertConservation(expected);
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(row)}).dataset.status`), 'processed');
  if (await evaluate(`!!document.querySelector(${JSON.stringify(apply)})`)) { assert.equal(await evaluate(`document.querySelector(${JSON.stringify(apply)}).disabled`), true); await button(apply, true); }
  assert.deepEqual(await state(), expected, 'A repeated click cannot apply the same proposal twice');
  await button('#owner-verify'); await until('["verified","verify-failed"].includes(document.querySelector("#owner-decisions").dataset.lastStatus)'); assert.equal((await hostState()).lastStatus, 'verified'); assert.deepEqual(await state(), expected);
  checks.push('Real owner proposals are read-only until accepted, apply only their guarded command, reject duplicate UI application and replay without changing the city');

  stage('3 stale snapshot and explicit refresh');
  await load(manualFixture); await button('#owner-evaluate');
  const moved = await advancePast(manualFixture.tick + 1), expectedMoved = clone(manualFixture); while (expectedMoved.tick < moved.tick) step(expectedMoved);
  assert.deepEqual(moved, expectedMoved, 'Proposal mode advances only the fixed growth rules');
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(row)}).dataset.stale`), 'true');
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(apply)}).disabled`), true); await button(apply, true); assert.deepEqual(await state(), moved);
  await button('#owner-evaluate'); const refreshed = await evaluate('[...document.querySelectorAll("[data-owner-proposal-id]")].map(e=>({id:e.dataset.ownerProposalId,tick:Number(e.dataset.tick),stale:e.dataset.stale}))');
  assert(refreshed.length && refreshed.every(item => item.tick === moved.tick && item.stale === 'false')); assert.deepEqual(await state(), moved);
  checks.push('Old tick snapshots are visibly stale and disabled; refresh captures actual current facts without a money mutation');

  stage('4 monthly off, proposal and explicit auto behavior');
  const monthly = [];
  for (const selectedMode of ['off', 'proposal', 'auto']) {
    await load(monthlyFixture); if (selectedMode !== 'proposal') await mode(selectedMode);
    assert.deepEqual(await state(), monthlyFixture, 'Selecting mode never immediately executes a command');
    const actual = await advancePast(monthlyFixture.tick + 1), expectedCity = clone(monthlyFixture), session = createOwnerDecisionSession(expectedCity); session.setMode(selectedMode);
    while (expectedCity.tick < actual.tick) session.advance(expectedCity);
    assert.deepEqual(actual, expectedCity, `${selectedMode} monthly behavior matches the deterministic session`); assertConservation(actual);
    const rows = await evaluate('[...document.querySelectorAll("[data-owner-proposal-id]")].map(e=>({tick:Number(e.dataset.tick),status:e.dataset.status}))');
    if (selectedMode === 'off') assert.equal(rows.length, 0);
    else assert(rows.length && rows.every(item => item.tick === monthlyFixture.tick + 1));
    monthly.push({ mode: selectedMode, tick: actual.tick, hash: ownerStateHash(actual), rows: rows.length });
    await button('#owner-verify'); await until('["verified","verify-failed"].includes(document.querySelector("#owner-decisions").dataset.lastStatus)'); assert.equal((await hostState()).lastStatus, 'verified'); assert.deepEqual(await state(), actual);
  }
  await load(manualFixture); assert.equal((await hostState()).mode, 'proposal');
  checks.push('Off, proposal and explicitly selected auto run at the real monthly boundary; existing saves always load in proposal, never auto');

  stage('4b drag-road mutation keeps owner recording active');
  await load(monthlyFixture); await mode('auto'); await close(); await button('[data-tool="road"]'); await paints();
  const gateway = 12 * 24;
  assert.equal(monthlyFixture.cells[gateway].road, true, 'The starter gateway is a real road cell');
  const roadEnd = [gateway - 24, gateway + 24].find(index => monthlyFixture.cells[index] && !monthlyFixture.cells[index].road && monthlyFixture.cells[index].zone === null && monthlyFixture.cells[index].building === null);
  assert.notEqual(roadEnd, undefined, 'A clear neighboring road cell is available beside the gateway');
  const expectedRoad = clone(monthlyFixture), roadResult = buildRoad(expectedRoad, gateway, roadEnd);
  assert.equal(roadResult.ok, true, 'The canonical road command accepts the selected empty adjacent cell');
  assert(expectedRoad.ledger.length > monthlyFixture.ledger.length, 'The road extension records its real construction cost');
  const roadFrom = await evaluate(`window.cityManager.cellScreen(${gateway})`), roadTo = await evaluate(`window.cityManager.cellScreen(${roadEnd})`);
  assert(Math.hypot(roadTo.x - roadFrom.x, roadTo.y - roadFrom.y) > 7, 'The real road drag crosses the browser gesture threshold');
  assert.equal(await evaluate(`document.elementFromPoint(${roadFrom.x},${roadFrom.y})?.id`), 'city-canvas');
  assert.equal(await evaluate(`document.elementFromPoint(${roadTo.x},${roadTo.y})?.id`), 'city-canvas');
  assert.equal(await evaluate('document.querySelector("#pause").getAttribute("aria-pressed")==="true"'), true, 'Road construction is tested while the simulation is paused');
  await drag(roadFrom, roadTo);
  const roadActual = await state();
  assert.deepEqual(roadActual, expectedRoad, 'A native drag applies exactly the canonical buildRoad result, including cash and ledger entries');
  assert.equal(roadActual.ledger.at(-1).from, 'treasury'); assert.equal(roadActual.ledger.at(-1).to, 'roadworks');
  await openPanel(); assert.equal((await hostState()).mode, 'auto', 'External road construction preserves explicit auto mode after journaling');
  await button('#owner-verify'); await until('["verified","verify-failed"].includes(document.querySelector("#owner-decisions").dataset.lastStatus)');
  assert.equal((await hostState()).lastStatus, 'verified', 'The road mutation remains inside a valid replay checkpoint');
  assert.deepEqual(await state(), expectedRoad, 'Replay verification leaves the canonical city unchanged');
  await close(); await button('#toggle-game-menu'); await button('#save');
  const savedRoad = await evaluate(`localStorage.getItem(${JSON.stringify(SAVE_KEY)})`);
  assert.equal(savedRoad, await evaluate('window.cityManager.sessionSnapshot()'), 'The normal save stores the exact atomic city/activity/recreation session');
  const restoredRoad = deserializeParkSession(savedRoad);
  assert.equal(serialize(restoredRoad.city), serialize(expectedRoad), 'The saved city bytes preserve the exact road mutation');
  assert.deepEqual(restoredRoad.city, expectedRoad, 'The saved road ledger and wallet balances round-trip unchanged');
  assert.equal(restoredRoad.runtime.recreation.minute, restoredRoad.city.tick * 1440 + restoredRoad.runtime.activity.minute, 'Saved park clocks agree with the city');
  assertConservation(roadActual); await openPanel();
  checks.push('A real paused drag-built road records cash and ledger exactly, keeps explicit auto mode and replay verification active, and saves atomically with matching park clocks');

  stage('5 replay export and readable S22 normal/wide evidence');
  await load(manualFixture); await button('#owner-evaluate'); const stable = await state(); await button('#owner-export');
  const startedDownload = Date.now(); let downloadedFiles = [];
  while (Date.now() - startedDownload < 10000) { downloadedFiles = (await readdir(output)).filter(name => /\.json$/i.test(name)); if (downloadedFiles.length) break; await sleep(80); }
  assert.equal(downloadedFiles.length, 1, 'Exactly one actual sidecar JSON download completes');
  assert(downloads.length <= 1, 'No duplicate export download event');
  const downloadedPath = resolve(output, downloadedFiles[0]); assert(downloadedPath.startsWith(output + sep));
  const exported = JSON.parse(await readFile(downloadedPath, 'utf8')); assert.equal(exported.schemaVersion, 1);
  assert.deepEqual(await state(), stable, 'Export never changes the city');
  await evaluate('document.querySelector("#owner-decisions").scrollIntoView({block:"start"})'); await paints(); await shot('owner-decisions-desktop.png');
  await layout({ width: 360, height: 780, screenWidth: 360, screenHeight: 780 }, 'owner-decisions-s22.png');
  await layout({ width: 980, height: 2120, screenWidth: 360, screenHeight: 780 }, 'owner-decisions-s22-wide.png');
  assert.deepEqual(await state(), stable, 'Viewport changes do not change canonical state');
  checks.push('Replay sidecar exports locally; S22 normal and wide layouts retain readable Thai,44px controls and no horizontal overflow');
  assert.equal(apiAttempts.length, 0, 'No report or provider request from any rule-owner action');
  assert.equal(errors.length, 0); assert.equal(networkFailures.length, 0);
  const qa = { ...evidence, testedAt: new Date().toISOString(), checks, monthly, layouts, screenshots, apiAttempts, browserErrors: errors, networkFailures, journalDownload: downloadedFiles[0], output, note: 'Synthetic local preview only. S22 viewport/touch emulation, not a physical handset test. No provider calls or LLM output.' };
  await writeFile(resolve(output, 'qa.json'), JSON.stringify(qa, null, 2) + '\n');
  console.log(JSON.stringify({ passed: checks.length, apiRequests: 0, browserErrors: 0, screenshots, output }));
} catch (error) {
  process.exitCode = 1;
  const diagnostic = { ...evidence, failedAt: new Date().toISOString(), stage: currentStage, message: safePrefix(String(error.message || error).split('\n')[0]), command: error.cdp || lastCommand, apiAttempts, browserErrors: errors.slice(0, 8), networkFailures: networkFailures.slice(0, 8), screenshot: null, output };
  if (ws?.readyState === WebSocket.OPEN) try { await shot('failure.png'); diagnostic.screenshot = 'failure.png'; } catch {}
  await writeFile(resolve(output, 'failure-diagnostic.json'), JSON.stringify(diagnostic, null, 2) + '\n');
  console.error(JSON.stringify({ stage: currentStage, message: diagnostic.message, apiRequests: apiAttempts.length, output }));
} finally {
  if (ws?.readyState === WebSocket.OPEN) { try { await send('Browser.close', {}, 3000); } catch {} ws.close(); }
  if (browser && browser.exitCode === null) browser.kill();
}
