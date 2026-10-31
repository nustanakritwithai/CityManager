// Focused, local-only renderer evidence. No city simulation, saves, traffic or economy.
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const output = resolve('.test-output/vehicle'), port = 9377;
const url = process.env.CITYMANAGER_VEHICLE_URL || 'http://127.0.0.1:4173/CityManager/tests/vehicle-preview.html';
const allowed = new URL(url); assert.equal(allowed.hostname, '127.0.0.1');
const production = new URL(process.env.CITYMANAGER_PRODUCTION_URL || 'http://127.0.0.1:4174/CityManager/');
assert.equal(production.hostname, '127.0.0.1');
const allowedOrigins = new Set([allowed.origin, production.origin]);
await mkdir(output, { recursive: true });
let occupied = false; try { occupied = (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(500) })).ok; } catch {}
assert.equal(occupied, false, 'Vehicle review debug port already in use');
const child = spawn(process.env.CITYMANAGER_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', [
  '--headless=new','--no-first-run','--no-default-browser-check','--disable-extensions','--disable-background-networking','--disable-component-update',
  '--remote-debugging-address=127.0.0.1',`--remote-debugging-port=${port}`,`--user-data-dir=${resolve(output,'profile')}`,'about:blank',
], { windowsHide: true, stdio: 'ignore' });
let ws, sequence = 0; const pending = new Map(), errors = [], external = [], captures = [];
child.on('error', error => errors.push(error.message));
const sleep = ms => new Promise(r => setTimeout(r,ms));
const watchdog = setTimeout(() => { child.kill(); console.error('Vehicle-only review timed out'); process.exit(1); },90_000);
function send(method, params = {}) {
  const id = ++sequence; const result = new Promise((yes,no) => {
    const timer = setTimeout(() => { pending.delete(id); no(Error(`CDP timeout: ${method}`)); },15_000);
    pending.set(id,{ yes: value => { clearTimeout(timer); yes(value); }, no: error => { clearTimeout(timer); no(error); } });
  }); ws.send(JSON.stringify({ id,method,params })); return result;
}
async function evaluate(expression) { const r = await send('Runtime.evaluate',{ expression, returnByValue:true, awaitPromise:true }); if(r.exceptionDetails) throw Error(r.exceptionDetails.text); return r.result.value; }
async function until(expression, timeout=20_000) { const start=Date.now(); while(Date.now()-start<timeout) { if(await evaluate(expression)) return; await sleep(30); } throw Error(`Timed out: ${expression}`); }
async function capture(name) { await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))'); const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false}); await writeFile(resolve(output,`${name}.png`),Buffer.from(r.data,'base64')); captures.push(name); }
try {
  let pages; for(let n=0;n<100;n++) { try { pages=await(await fetch(`http://127.0.0.1:${port}/json`)).json(); break; } catch { await sleep(100); } }
  assert.ok(pages?.length, `Browser unavailable: ${errors.join('; ')}`);
  ws=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl); await new Promise((yes,no)=>{ws.onopen=yes;ws.onerror=no;});
  ws.onmessage=event=>{const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);if(!p)return;pending.delete(m.id);m.error?p.no(Error(JSON.stringify(m.error))):p.yes(m.result);}
    if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);
    if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')errors.push(m.params.args.map(a=>a.value??a.description).join(' '));
    if(m.method==='Fetch.requestPaused'){const target=new URL(m.params.request.url),local=allowedOrigins.has(target.origin);if(!local)external.push(target.origin);void send(local?'Fetch.continueRequest':'Fetch.failRequest',local?{requestId:m.params.requestId}:{requestId:m.params.requestId,errorReason:'BlockedByClient'});}};
  await send('Runtime.enable');await send('Page.enable');await send('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url}); await until('!!window.vehicleReview?.ready',30_000);
  const results=[];
  for(const [night,rear] of [[false,false],[true,false],[true,true]]) {
    await evaluate(`window.vehicleReview.show(${night},${rear})`);
    const row=await evaluate('window.vehicleReview.inspect()');
    assert.equal(row.realLights,0,'Vehicles use emissive geometry, not per-car real lights');
    assert.deepEqual(row.kindMapping,['sedan','suv']);
    assert.equal(row.truckDraws,2);
    assert.equal(row.fleet.trianglesPerCar,56);assert.equal(row.taxi.trianglesPerCar,68);
    assert.ok(row.lamps.length>0);
    assert.ok(row.lamps.every(n=>night?n>0:n===0),'Vehicle lamps follow actual scene day/night');
    results.push({night,rear,...row});await capture(rear?'vehicles-night-rear':night?'vehicles-night':'vehicles-day');
  }
  const lifecycle=await evaluate('window.vehicleReview.lifecycle()');
  assert.ok(Number.isFinite(lifecycle.before.frameDrawCalls)&&lifecycle.before.frameDrawCalls>0,'Real WebGL frame draw count recorded');
  assert.equal(lifecycle.repeatedFrameDrawCalls,lifecycle.before.frameDrawCalls,'Repeated workload does not add GPU draw calls');
  assert.equal(lifecycle.comparison.baseline.samples,20);assert.equal(lifecycle.comparison.candidate.samples,20);
  assert.equal(lifecycle.comparison.candidate.drawCalls-lifecycle.comparison.baseline.drawCalls,7,'Actual GPU draw increase matches fixed6→13 fleet budget');
  assert.equal(lifecycle.disabledDraws,0);assert.equal(lifecycle.emptyDraws,0);
  assert.equal(lifecycle.buffersReused,true,'Repeated pose upload reuses every buffer');
  assert.equal(lifecycle.capacityStable,true,'Equal and smaller workloads never allocate');
  assert.equal(lifecycle.rebuilt,true,'Cleared actors can be recreated with live shared meshes');
  assert.equal(lifecycle.disposed,true,'Renderer teardown removes owned roots and buffers');
  assert.equal(lifecycle.cacheAfterClear.actorMeshReferences,0);
  assert.equal(lifecycle.cacheAfterClear.meshes,2);assert.equal(lifecycle.cacheAfterRebuild.meshes,2);
  assert.equal(lifecycle.cacheBeforeAppDestroy.actorMeshReferences,0);
  assert.deepEqual(lifecycle.cacheAfterAppDestroy,{meshes:0,materials:0,actorMeshReferences:0});
  assert.ok(lifecycle.maxVehicleDraws<=17,'Vehicle draw budget remains fixed and independent of population');
  assert.ok(lifecycle.maxBufferCount<=15,'Instance buffers remain bounded');
  results.push({lifecycle});
  // Verify the actual production artifact also boots; no city scenarios, saves or menu suites.
  await send('Page.navigate',{url:production.href});
  await until('!!window.cityManager?.visuals().ready',30_000);
  const productionAssets = await evaluate('window.cityManager.visuals()');
  assert.deepEqual(productionAssets.failed, [], 'Shipped production model assets load');
  await capture('production-artifact-boot');
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  await writeFile(resolve(output,'report.json'),JSON.stringify({passed:true,results,productionAssets,captures,errors,external},null,2));
  console.log(`Vehicle-only browser checks passed; ${captures.length} actual WebGL screenshots.`);
} finally { clearTimeout(watchdog);ws?.close();child.kill(); }
