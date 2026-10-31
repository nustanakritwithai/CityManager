// Focused, local-only renderer evidence. No city simulation, saves, traffic or economy.
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { toolbarChecks } from './visual-final-toolbar.mjs';
const output = resolve('.test-output/visual-final'), port = 9378;
const url = process.env.CITYMANAGER_APARTMENT_URL || 'http://127.0.0.1:4173/CityManager/tests/apartment-preview.html';
const allowed = new URL(url); assert.equal(allowed.hostname, '127.0.0.1');
const production = new URL(process.env.CITYMANAGER_PRODUCTION_URL || 'http://127.0.0.1:4174/CityManager/');
assert.equal(production.hostname, '127.0.0.1');
const allowedOrigins = new Set([allowed.origin, production.origin]);
await mkdir(output, { recursive: true });
let occupied = false; try { occupied = (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(500) })).ok; } catch {}
assert.equal(occupied, false, 'Apartment/toolbar review debug port already in use');
const child = spawn(process.env.CITYMANAGER_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', [
  '--headless=new','--no-first-run','--no-default-browser-check','--disable-extensions','--disable-background-networking','--disable-component-update',
  '--remote-debugging-address=127.0.0.1',`--remote-debugging-port=${port}`,`--user-data-dir=${resolve(output,'profile')}`,'about:blank',
], { windowsHide: true, stdio: 'ignore' });
let ws, sequence = 0; const pending = new Map(), errors = [], external = [], captures = [];
child.on('error', error => errors.push(error.message));
const sleep = ms => new Promise(r => setTimeout(r,ms));
const watchdog = setTimeout(() => { child.kill(); console.error('Apartment/toolbar-only review timed out'); process.exit(1); },120_000);
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
  await send('Page.navigate',{url}); await until('!!window.apartmentReview?.ready',30_000);
  const results=[];
  for(const [name,night,occupied,disconnected] of [['day-occupied',false,true,false],['night-occupied',true,true,false],['night-empty',true,false,false],['night-disconnected',true,true,true]]) {
    await evaluate(`window.apartmentReview.show(${night},${occupied},${disconnected})`);
    const rows=await evaluate('window.apartmentReview.inspect()');assert.equal(rows.length,9);
    for(const row of rows){
      assert.ok(row.width>0&&row.width<2&&row.depth>0&&row.depth<2&&row.height>0&&row.height<10,`R${row.level} bounded`);
      assert.equal(row.luxury,row.level>=7);
      if(row.level>=4&&row.level<=6){
        assert.equal(row.floors,row.level-1);assert.equal(row.tanks,row.level===6?2:1);assert.equal(row.awning,true);
        assert.ok(row.windows.length>0);assert.equal(row.courtLights.length,row.level===6?1:0);
        assert.ok(row.courtLights.every(v=>(night&&occupied&&!disconnected)?v>0:v===0),'Courtyard light follows occupancy, connection and night');
        if(!night||!occupied||disconnected)assert.ok(row.windows.every(v=>v===0),'Apartment windows remain dark outside occupied connected night');
        else assert.ok(row.windows.every(v=>v>0),'Occupied apartments use warm night windows');
      }
    }
    assert.ok(rows[2].height<rows[3].height,'Houses remain below first apartment');
    for(let i=4;i<9;i++)assert.ok(rows[i].height>rows[i-1].height,'Upper residential tiers preserve height progression');
    results.push({name,rows});await capture(`apartments-${name}`);
  }
  for(const night of [false,true]) {
    await evaluate(`window.apartmentReview.showControls(${night})`);
    const controls=await evaluate('window.apartmentReview.inspectControls()');assert.equal(controls.length,3);
    for(const row of controls){assert.equal(row.apartments,false);assert.equal(row.pool,false);assert.equal(row.luxury,row.level>=4);assert.equal(row.beacon,row.level>=4);}
    results.push({commercialControls:controls,night});await capture(`commercial-controls-${night?'night':'day'}`);
  }
  // Verify the actual production artifact also boots; no city scenarios, saves or menu suites.
  await send('Page.navigate',{url:production.href});
  await until('!!window.cityManager?.visuals().ready',30_000);
  const productionAssets = await evaluate('window.cityManager.visuals()');
  assert.deepEqual(productionAssets.failed, [], 'Shipped production model assets load');
  await capture('production-artifact-boot');
  const toolbar=await toolbarChecks({send,evaluate,capture});
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  await writeFile(resolve(output,'report.json'),JSON.stringify({passed:true,results,toolbar,productionAssets,captures,errors,external},null,2));
  console.log(`Apartment/toolbar-only browser checks passed; ${captures.length} actual WebGL screenshots.`);
} finally { clearTimeout(watchdog);ws?.close();child.kill(); }
