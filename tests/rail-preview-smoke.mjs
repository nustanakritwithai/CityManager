// Synthetic isolated Edge/WebGL preview. No player profile, backend or production save access.
import {spawn} from 'node:child_process';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const url=process.env.RAIL_PREVIEW_URL||'http://127.0.0.1:4182/CityManager/rail-preview.html';
const output=resolve('.test-output/rail-preview');await mkdir(output,{recursive:true});
const profile=await mkdtemp(resolve(output,'edge-')),port=9392;
let occupied=false;try{occupied=(await fetch(`http://127.0.0.1:${port}/json/version`,{signal:AbortSignal.timeout(500)})).ok;}catch{}
assert.equal(occupied,false,'Rail QA port must be free');
const child=spawn(process.env.CITYMANAGER_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',[
  '--headless=new','--no-first-run','--no-default-browser-check','--disable-extensions','--disable-background-networking','--disable-component-update',
  '--use-angle=swiftshader','--enable-unsafe-swiftshader',`--remote-debugging-port=${port}`,'--remote-debugging-address=127.0.0.1',`--user-data-dir=${profile}`,'about:blank'
],{windowsHide:true,stdio:'ignore'});
let ws,seq=0;const pending=new Map(),errors=[],checks=[];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function send(method,params={}){const id=++seq;const promise=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('CDP timeout '+method)),20000);pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject});});ws.send(JSON.stringify({id,method,params}));return promise;}
async function evaluate(expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
async function until(expression){const start=Date.now();while(Date.now()-start<20000){if(await evaluate(expression))return;await sleep(100);}throw Error('Timed out '+expression);}
async function tap(x,y){await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
async function button(selector){if(selector!=='#rail-panel details summary'&&await evaluate(`document.querySelector(${JSON.stringify(selector)})?.closest('details')?.open===false`))await button('#rail-panel details summary');await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest'})`);await sleep(25);const p=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,disabled:e.disabled}})()`);assert.notEqual(p.disabled,true,selector+' enabled');assert.equal(await evaluate(`!!document.elementFromPoint(${p.x},${p.y})?.closest(${JSON.stringify(selector)})`),true,selector+' hit target');await tap(p.x,p.y);await sleep(35);}
async function manage(){if(await evaluate('document.querySelector("#rail-panel").hidden')){await button('#transport-tool');await button('[data-rail-tool="manage"]');}}
const state=()=>evaluate('window.railPreview.snapshot()');const diag=()=>evaluate('window.railPreview.diagnostics()');
async function tool(mode){if(!await evaluate('document.querySelector("#rail-panel").hidden'))await button('#close-panel');await button('#transport-tool');await button(`[data-rail-tool="${mode}"]`);}
async function cell(n){const p=await evaluate(`window.railPreview.cellScreen(${n})`);assert.equal(await evaluate(`document.elementFromPoint(${p.x},${p.y})?.id`),'city-canvas');await tap(p.x,p.y);}
async function shot(name){const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(resolve(output,name+'.png'),Buffer.from(r.data,'base64'));}
async function reload(){await send('Page.navigate',{url});await until('!!window.railPreview');await sleep(150);}
try{
  let tabs;for(let n=0;n<100;n++){try{tabs=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();break;}catch{await sleep(100);}}
  assert.ok(tabs?.length);ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
  ws.onmessage=event=>{const m=JSON.parse(event.data);if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')errors.push(m.params.args);};
  await send('Runtime.enable');await send('Page.enable');
  const browser=await send('Browser.getVersion');
  for(const [name,width,height] of [['portrait',390,844],['landscape',844,390]]){
    await send('Emulation.setDeviceMetricsOverride',{width,height,screenWidth:width,screenHeight:height,deviceScaleFactor:1,mobile:true});await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:2});
    await reload();const initial=await state();assert.equal((await diag()).trains,1);assert.equal((await diag()).paused,true);
    await evaluate('localStorage.setItem("rail-qa-sentinel","synthetic-preserve-me")');const storage=await evaluate('JSON.stringify({...localStorage})');
    await shot(name+'-map');
    await manage();await button('#add-trip');await button('#step-ten');const moving=await state();const d=await diag();assert.ok(d.onboard>0&&d.waiting>0);assert.equal(d.conservationError,0);assert.equal(d.completed,0);
    await button('#capture');await button('#station-b');await button('#step-ten');await button('#step-ten');assert.equal((await diag()).completed,0);assert.ok((await diag()).onboard>0);
    await button('#station-b');await button('#step-ten');assert.ok((await diag()).completed>0);await button('#restore');assert.deepEqual(await state(),moving);
    await button('#add-inaccessible');assert.equal((await diag()).roadAssignable,10);assert.equal((await diag()).modalConservationError,0);
    await shot(name+'-queues');
    await tool('remove');await cell(250);await cell(251);const graph=await evaluate('window.railPreview.graph()');await button('#confirm');assert.deepEqual(await evaluate('window.railPreview.graph()'),graph);assert.match(await evaluate('document.querySelector("#feedback").textContent'),/occupied/);
    await manage();for(let i=0;i<40&&!(await diag()).completed;i++)await button('#step-ten');
    // A fresh fixture is the same deterministic preview, never a player-save reset.
    await reload();assert.deepEqual(await state(),initial);
    await tool('remove');const before=await evaluate('window.railPreview.graph()');await cell(250);await cell(251);await button('#cancel-confirm');assert.deepEqual(await evaluate('window.railPreview.graph()'),before);
    await cell(250);await cell(251);await button('#confirm');assert.equal((await diag()).connected,false);
    await manage();await button('#add-trip');assert.equal((await diag()).roadAssignable,24);assert.equal((await diag()).offered,0);
    await tool('repair');await cell(250);await cell(251);await button('#confirm');assert.equal((await diag()).connected,true);
    // A pan or cancelled touch in track mode must never create a confirmation or edit.
    const p=await evaluate('window.railPreview.cellScreen(249)');const g=await evaluate('window.railPreview.graph()');
    await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:p.x,y:p.y,id:3}]});await send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:p.x+40,y:p.y+15,id:3}]});await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    assert.equal((await diag()).pending,false);assert.deepEqual(await evaluate('window.railPreview.graph()'),g);
    await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:p.x,y:p.y,id:4}]});await send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});assert.equal((await diag()).pending,false);
    await button('#cancel-tool');for(let n=0;n<3;n++){await manage();await button('#close-panel');}assert.equal((await diag()).mode,'select');
    await manage();const bounds=await evaluate('(()=>{const e=document.querySelector("#rail-panel"),r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight,overflow:e.scrollWidth>e.clientWidth}})()');assert.ok(bounds.left>=0&&bounds.right<=bounds.width&&bounds.top>=0&&bounds.bottom<=bounds.height);assert.equal(bounds.overflow,false);
    assert.equal(await evaluate('JSON.stringify({...localStorage})'),storage);assert.equal((await diag()).conservationError,0);
    checks.push(`${name}: train/queues, close/reopen, atomic in-memory restore, inaccessible demand, occupied edit refusal, cancel/repair, native touch pan/cancel, repeated menus, layout, storage unchanged`);
  }
  assert.deepEqual(errors,[]);await writeFile(resolve(output,'report.json'),JSON.stringify({browser:browser.product,url,checks,errors,device:'Edge emulated touch; software WebGL; not Android or FPS evidence'},null,2));console.log(JSON.stringify({checks,errors},null,2));
}catch(error){await shot('failure').catch(()=>{});await writeFile(resolve(output,'failure.json'),JSON.stringify({error:String(error),errors,checks},null,2));throw error;}
finally{ws?.close();child.kill();}
