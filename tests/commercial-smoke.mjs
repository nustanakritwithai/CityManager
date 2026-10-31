// Focused, local-only renderer evidence. No city simulation, saves, traffic or economy.
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import {inflateSync} from 'node:zlib';
const output = resolve('.test-output/commercial'), port = 9378;
const url = process.env.CITYMANAGER_COMMERCIAL_URL || 'http://127.0.0.1:4173/CityManager/tests/commercial-preview.html';
const allowed = new URL(url); assert.equal(allowed.hostname, '127.0.0.1');
const allowedOrigins = new Set([allowed.origin]);
await mkdir(output, { recursive: true });
let occupied = false; try { occupied = (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(500) })).ok; } catch {}
assert.equal(occupied, false, 'Commercial review debug port already in use');
const child = spawn(process.env.CITYMANAGER_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', [
  '--headless=new','--no-first-run','--no-default-browser-check','--disable-extensions','--disable-background-networking','--disable-component-update',
  '--remote-debugging-address=127.0.0.1',`--remote-debugging-port=${port}`,`--user-data-dir=${resolve(output,'profile')}`,'about:blank',
], { windowsHide: true, stdio: 'ignore' });
let ws, sequence = 0; const pending = new Map(), errors = [], external = [], captures = [];
child.on('error', error => errors.push(error.message));
const sleep = ms => new Promise(r => setTimeout(r,ms));
const watchdog = setTimeout(() => { child.kill(); console.error('Commercial-only review timed out'); process.exit(1); },90_000);
function send(method, params = {}) {
  const id = ++sequence; const result = new Promise((yes,no) => {
    const timer = setTimeout(() => { pending.delete(id); no(Error(`CDP timeout: ${method}`)); },15_000);
    pending.set(id,{ yes: value => { clearTimeout(timer); yes(value); }, no: error => { clearTimeout(timer); no(error); } });
  }); ws.send(JSON.stringify({ id,method,params })); return result;
}
async function evaluate(expression) { const r = await send('Runtime.evaluate',{ expression, returnByValue:true, awaitPromise:true }); if(r.exceptionDetails) throw Error(r.exceptionDetails.text); return r.result.value; }
async function until(expression, timeout=20_000) { const start=Date.now(); while(Date.now()-start<timeout) { if(await evaluate(expression)) return; await sleep(30); } throw Error(`Timed out: ${expression}`); }
function pngEvidence(png){
 assert.ok(png.length>24&&png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'Actual PNG evidence required');
 const width=png.readUInt32BE(16),height=png.readUInt32BE(20),channels=png[25]===2?3:png[25]===6?4:0;
 assert.ok(width>0&&height>0&&width*height<=16_000_000&&png[24]===8&&channels&&png[28]===0,'Supported bounded RGB/RGBA PNG required');
 const chunks=[];for(let i=8;i+12<=png.length;){const n=png.readUInt32BE(i);assert.ok(i+12+n<=png.length);if(png.toString('ascii',i+4,i+8)==='IDAT')chunks.push(png.subarray(i+8,i+8+n));i+=n+12;}
 const stride=width*channels,raw=inflateSync(Buffer.concat(chunks),{maxOutputLength:(stride+1)*height});assert.equal(raw.length,(stride+1)*height);
 let previous=Buffer.alloc(stride),first,nonblank=false;const sceneColors=new Set();
 for(let y=0;y<height;y++){
  const filter=raw[y*(stride+1)],row=Buffer.from(raw.subarray(y*(stride+1)+1,(y+1)*(stride+1)));assert.ok(filter<=4);
  for(let x=0;x<stride;x++){const a=x>=channels?row[x-channels]:0,b=previous[x],c=x>=channels?previous[x-channels]:0,p=a+b-c;const predictor=filter===0?0:filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):Math.abs(p-a)<=Math.abs(p-b)&&Math.abs(p-a)<=Math.abs(p-c)?a:Math.abs(p-b)<=Math.abs(p-c)?b:c;row[x]=(row[x]+predictor)&255;}
  for(let x=0;x<stride;x+=channels){const rgb=row.subarray(x,x+3);if(y>140&&x/channels>40&&x/channels<width-40)sceneColors.add(`${rgb[0]>>4},${rgb[1]>>4},${rgb[2]>>4}`);if(!first)first=Buffer.from(rgb);else if(!rgb.equals(first))nonblank=true;}previous=row;
 }
 assert.ok(nonblank,'Uniform blank screenshot is not visual proof');assert.ok(sceneColors.size>16,'Rendered scene below header must contain varied pixel colors');return {width,height,nonblank,sceneColors:sceneColors.size};
}

async function capture(name) { await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))'); const health=await evaluate('window.commercialReview.health()');assert.equal(health.contextLost,false);assert.ok(health.width>0&&health.height>0);const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});const png=Buffer.from(r.data,'base64'),pixels=pngEvidence(png);await writeFile(resolve(output,`${name}.png`),png);captures.push({name,health,...pixels}); }
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
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await send('Page.navigate',{url}); await until('!!window.commercialReview?.ready',30_000);
  const results=[];
  let original;
  for(const [name,night,occupied,powered,disconnected,tag] of [
    ['day',false,true,true,false,'market'],['night',true,true,true,false,'market'],
    ['night-retail-tag',true,true,true,false,'retail'],['empty-night',true,false,true,false,'retail'],
    ['unpowered-night',true,true,false,false,'retail'],['disconnected-night',true,true,true,true,'retail'],
    ['reconnected-night',true,true,true,false,'market']
  ]) {
    await evaluate(`window.commercialReview.show(${night},${occupied},${powered},${disconnected},${JSON.stringify(tag)})`);
    await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    const rows=await evaluate('window.commercialReview.inspect()');assert.equal(rows.length,9);
    for(const row of rows){
      assert.equal(row.tier,row.level<=3?'market':row.level<=6?'building':'mall');
      assert.equal(row.name,`Commercial ${row.tier}`);assert.ok(row.parts.length>=10&&row.parts.length<=32);
      assert.ok(row.width>0&&row.width<=1.71&&row.depth>0&&row.depth<=1.71&&row.height>0&&row.height<6,'Actual meshes stay within parcel');
      assert.equal(row.connected,!disconnected);assert.equal(row.powered,powered&&!disconnected);
      assert.ok(row.windows.length>0,'Every tier has a production light surface');
      if(night&&occupied&&powered&&!disconnected)assert.ok(row.windows.some(n=>n>0),'Occupied powered commercial lights on');
      else assert.ok(row.windows.every(n=>n===0),'Empty, unpowered, disconnected or daylight lights off');
    }
    if(name==='night')original=rows;
    if(name==='night-retail-tag'||name==='reconnected-night')assert.deepEqual(rows,original,'Historical commodity tag never changes actual meshes or lights; reconnect restores them');
    const controls=await evaluate('window.commercialReview.inspectControls()');assert.deepEqual(controls.map(c=>c.zone),['R','I','F']);
    for(const control of controls){assert.equal(control.commercial,false);assert.ok(control.renders>0,'Non-C geometry still present');}
    assert.deepEqual((await evaluate('window.commercialReview.diagnostics()')).commercialTiers,{market:3,building:3,mall:3});
    results.push({name,rows,controls});await capture(name);
  }
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  await writeFile(resolve(output,'report.json'),JSON.stringify({passed:true,scope:'Actual CityView.render on synthetic visual-only parcels; not economic progression or save acceptance',results,captures,errors,external},null,2));
  console.log(`Commercial-only browser checks passed; ${captures.length} actual WebGL screenshots.`);
} catch(error){await writeFile(resolve(output,'failure.json'),JSON.stringify({error:String(error),captures,errors,external},null,2));throw error;} finally { clearTimeout(watchdog);ws?.close();child.kill(); }
