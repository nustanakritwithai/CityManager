// Focused, local-only renderer evidence. No city simulation, saves, traffic or economy.
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const output = resolve('.test-output/farm'), port = 9376;
const url = process.env.CITYMANAGER_FARM_URL || 'http://127.0.0.1:4173/CityManager/tests/farm-preview.html';
const allowed = new URL(url); assert.equal(allowed.hostname, '127.0.0.1');
const production = new URL(process.env.CITYMANAGER_PRODUCTION_URL || 'http://127.0.0.1:4174/CityManager/');
assert.equal(production.hostname, '127.0.0.1');
const allowedOrigins = new Set([allowed.origin, production.origin]);
await mkdir(output, { recursive: true });
let occupied = false; try { occupied = (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(500) })).ok; } catch {}
assert.equal(occupied, false, 'Farm review debug port already in use');
const child = spawn(process.env.CITYMANAGER_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', [
  '--headless=new','--no-sandbox','--disable-dev-shm-usage','--no-first-run','--no-default-browser-check','--disable-extensions','--disable-background-networking','--disable-component-update',
  '--remote-debugging-address=127.0.0.1',`--remote-debugging-port=${port}`,`--user-data-dir=${resolve(output,'profile')}`,'about:blank',
], { windowsHide: true, stdio: 'ignore' });
let ws, sequence = 0; const pending = new Map(), errors = [], external = [], captures = [];
child.on('error', error => errors.push(error.message));
const sleep = ms => new Promise(r => setTimeout(r,ms));
const watchdog = setTimeout(() => { child.kill(); console.error('Farm-only review timed out'); process.exit(1); },90_000);
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
  await send('Page.navigate',{url}); await until('!!window.farmReview?.ready',30_000);
  const results=[];
  for(const crop of ['rice','vegetables','sugarcane']) for(const night of [false,true]) {
    await evaluate(`window.farmReview.show('${crop}',${night})`);
    const rows=await evaluate('window.farmReview.inspect()');assert.equal(rows.length,6);
    for(const row of rows){
      assert.ok(row.width<=1.681&&row.depth<=1.681,'Original farm footprint preserved');
      assert.equal(row.glass.length,row.level===6?2:row.level===5?1:0);
      assert.ok(row.glass.every(g=>g.opacity>0&&g.opacity<.3&&!g.depthWrite),'Transparent non-depth-writing greenhouse');
      assert.ok(row.rows.length>=3&&row.rows.every(r=>r.name.endsWith(crop)),'Selected crop rows visible');
      assert.ok(row.lights.every(i=>night?i>0:i===0),'Grow/yard lights follow actual atmosphere');
    }
    results.push({crop,night,rows});await capture(`${crop}-${night?'night':'day'}`);
  }
  for(const disconnected of [false,true]){
    await evaluate(`window.farmReview.show('rice',true,${disconnected},${disconnected})`);
    assert.ok((await evaluate('window.farmReview.inspect()')).every(r=>r.lights.every(i=>i===0)),'Inactive and disconnected farms stay dark');
    await capture(disconnected?'disconnected':'inactive');
  }
  await send('Page.navigate',{url:production.href});
  await until('!!window.cityManager?.visuals().ready',30_000);
  const productionAssets=await evaluate('window.cityManager.visuals()');
  assert.deepEqual(productionAssets.failed,[],'Production assets load');
  await capture('production-artifact-boot');
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  await writeFile(resolve(output,'report.json'),JSON.stringify({passed:true,results,productionAssets,captures,errors,external},null,2));
  console.log(`Farm-only browser checks passed; ${captures.length} actual WebGL screenshots.`);
} finally { clearTimeout(watchdog);ws?.close();child.kill(); }
