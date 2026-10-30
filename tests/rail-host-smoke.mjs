// Synthetic application-host QA in its own Edge profile. No player profile or backend.
import {spawn} from 'node:child_process';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {createCity,buildRoad,step} from '../src/sim.ts';
import {createParkRuntime,advanceParkRuntime,serializeParkSession} from '../src/park-runtime.ts';
import {RailNetworkRuntime} from '../src/rail/network-runtime.ts';
import {marketJournalForTest} from '../src/market-client.ts';
import {SAVE_KEY} from '../src/save-storage.ts';
import {reachTouch} from './touch-reach.mjs';

const url=process.env.RAIL_HOST_URL||'http://127.0.0.1:4183/CityManager/';
const origin=new URL(url).origin,output=resolve('.test-output/rail-host'),port=9393;
assert.equal(new URL(url).hostname,'127.0.0.1','Host QA must remain local');
await mkdir(output,{recursive:true});
const policy={seats:8,queueCapacity:12,boardingPerMinute:4,alightingPerMinute:4,minimumDwellMinutes:2,minimumDepartureIntervalMinutes:4,maxBatches:128};
const journal=marketJournalForTest(null);journal.guestId='00000000-0000-4000-8000-000000000003';
function fixture(moving){
  const city=createCity(61025,{starter:false}),runtime=createParkRuntime(city);city.market=structuredClone(journal);
  buildRoad(city,288,264);buildRoad(city,264,281);const rail=RailNetworkRuntime.create(city,'synthetic-host-city',0);runtime.rail=rail;
  rail.addStation('a',245);rail.addStation('b',255);for(let from=245;from<255;from++)rail.editTrack(from,from+1,false,2);rail.configureService(policy);
  if(moving){rail.acceptPreparedDemand({id:'trip:1',from:291,to:305,offeredPersons:32,roadAdmittedPersons:0,leases:[]},{id:'batch:1',requestId:'trip:1',leaseId:'lease:1',from:291,to:305,fromStation:'a',toStation:'b',persons:32,readyAtMinute:0,egressMinutes:5});advanceParkRuntime(city,runtime,7,()=>step(city));}
  return serializeParkSession(city,runtime);
}
const fixtures={moving:fixture(true),empty:fixture(false)};
const profile=await mkdtemp(resolve(output,'edge-'));
let occupied=false;try{occupied=(await fetch(`http://127.0.0.1:${port}/json/version`,{signal:AbortSignal.timeout(500)})).ok;}catch{}
assert.equal(occupied,false,'Rail host QA port must be free');
const child=spawn(process.env.CITYMANAGER_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',[
  '--headless=new','--no-first-run','--no-default-browser-check','--disable-extensions','--disable-background-networking','--disable-component-update',
  '--use-angle=swiftshader','--enable-unsafe-swiftshader',`--remote-debugging-port=${port}`,'--remote-debugging-address=127.0.0.1',`--user-data-dir=${profile}`,'about:blank'
],{windowsHide:true,stdio:'ignore'});
let ws,seq=0;const pending=new Map(),errors=[],checks=[];
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function send(method,params={}){const id=++seq;const promise=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('CDP timeout '+method)),30000);pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});});ws.send(JSON.stringify({id,method,params}));return promise;}
async function evaluate(expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
async function until(expression,timeout=60000){const start=Date.now();while(Date.now()-start<timeout){if(await evaluate(expression))return;await sleep(100);}throw Error('Timed out '+expression);}
async function tap(x,y){await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await sleep(40);}
async function button(selector){
  if(await reachTouch(evaluate,button,selector))return;
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest',inline:'nearest'})`);await sleep(30);
  const p=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,width:r.width,height:r.height,disabled:e.disabled}})()`);
  assert.notEqual(p.disabled,true,selector+' enabled');assert.ok(p.width&&p.height,selector+' visible');
  assert.equal(await evaluate(`!!document.elementFromPoint(${p.x},${p.y})?.closest(${JSON.stringify(selector)})`),true,selector+' hit target');await tap(p.x,p.y);
}
async function enter(){await until('!!document.querySelector(".guest-entry-card")||!!window.cityManager');if(await evaluate('!!document.querySelector(".guest-entry-card")'))await button('.guest-entry-card button:nth-of-type(2)');await until('!!window.cityManager?.rail&&window.cityManager.visuals().ready');}
async function navigate(name,kind){await send('Page.navigate',{url:`${url}?railQaCase=${encodeURIComponent(name)}&railQaFixture=${kind}`});await enter();assert.equal(await evaluate('window.cityManager.parks().paused'),true);}
const diag=()=>evaluate('window.cityManager.rail()');const snapshot=()=>evaluate('window.cityManager.rail().snapshot');
async function manage(){if(!await evaluate('document.querySelector("#rail-management").open')){await button('#rail-tool');await button('[data-rail-action="manage"]');}}
async function closePanel(){if(await evaluate('document.querySelector("#rail-management").open'))await button('#rail-management .rail-management-heading button');}
async function tool(name){await closePanel();await button('#rail-tool');await button(`[data-rail-action="${name}"]`);}
async function cell(index){const p=await evaluate(`window.cityManager.cellScreen(${index})`);assert.equal(await evaluate(`document.elementFromPoint(${p.x},${p.y})?.id`),'city-canvas',`cell ${index} visible`);await tap(p.x,p.y);}
async function shot(name){const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(resolve(output,name+'.png'),Buffer.from(r.data,'base64'));}
async function reloadExact(expected){const boot=await evaluate('window.__railHostBoot');await send('Page.reload');await until(`window.__railHostBoot!==${JSON.stringify(boot)}`);await enter();assert.equal(await evaluate('window.cityManager.sessionSnapshot()'),expected,'Reload restores the exact atomic city/rail session');}
try{
  let tabs;for(let n=0;n<100;n++){try{tabs=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();break;}catch{await sleep(100);}}
  assert.ok(tabs?.length);ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  ws.onmessage=event=>{const m=JSON.parse(event.data);if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')errors.push(m.params.args);};
  await send('Runtime.enable');await send('Page.enable');const browser=await send('Browser.getVersion');
  // This context is a newly-created synthetic profile. Seeding never runs in a user's profile.
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`window.__railHostBoot=crypto.randomUUID();if(location.origin===${JSON.stringify(origin)}){const q=new URLSearchParams(location.search),name=q.get('railQaCase'),kind=q.get('railQaFixture');if(name&&sessionStorage.getItem('rail-host-case')!==name){localStorage.clear();localStorage.setItem(${JSON.stringify(SAVE_KEY)},(${JSON.stringify(fixtures)})[kind]);sessionStorage.setItem('rail-host-case',name);}}`});
  for(const [name,width,height] of [['portrait',390,844],['landscape',844,390]]){
    await send('Emulation.setDeviceMetricsOverride',{width,height,screenWidth:width,screenHeight:height,deviceScaleFactor:1,mobile:true});await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:2});
    await navigate(name+'-moving','moving');assert.equal(await evaluate('window.cityManager.sessionSnapshot()'),fixtures.moving);assert.equal(await evaluate(`localStorage.getItem(${JSON.stringify(SAVE_KEY)})`),fixtures.moving,'Startup leaves original save bytes intact');
    let state=await snapshot();assert.equal((await diag()).trains,1);assert.ok(state.service.snapshot.train.destination);assert.ok(state.service.snapshot.batches[0].onboard>0);assert.ok(state.service.snapshot.batches[0].waiting>0);await shot(name+'-map');
    await manage();assert.equal(await evaluate('document.querySelector("[data-rail-metric=onboard]").textContent'),String(state.service.snapshot.batches[0].onboard));
    await button('[data-rail-station="b"]');assert.equal((await snapshot()).service.snapshot.openStations.b,false);await button('[data-rail-station="b"]');assert.equal((await snapshot()).service.snapshot.openStations.b,true);
    await button('#rail-service-toggle');assert.equal((await snapshot()).service.snapshot.enabled,false);await button('#rail-service-toggle');assert.equal((await snapshot()).service.snapshot.enabled,true);await shot(name+'-panel');
    const bounds=await evaluate('(()=>{const e=document.querySelector("#rail-management"),r=e.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight,overflow:e.scrollWidth>e.clientWidth}})()');assert.ok(bounds.left>=0&&bounds.right<=bounds.width&&bounds.top>=0&&bounds.bottom<=bounds.height);assert.equal(bounds.overflow,false);
    await tool('remove-track');const movingGraph=(await snapshot()).graph;await cell(250);await cell(251);assert.equal((await diag()).pending,true);assert.deepEqual((await snapshot()).graph,movingGraph,'Map compatibility click cannot confirm');
    await evaluate('document.querySelector("#rail-confirm-accept").click()');assert.equal((await diag()).pending,true,'Click without a fresh press is ignored');
    await button('#rail-confirm-cancel');assert.deepEqual((await snapshot()).graph,movingGraph);
    await cell(250);await cell(251);await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape'});assert.equal((await diag()).pending,false);assert.deepEqual((await snapshot()).graph,movingGraph);
    await cell(250);await cell(251);await send('Emulation.setDeviceMetricsOverride',{width:width-1,height,screenWidth:width-1,screenHeight:height,deviceScaleFactor:1,mobile:true});await until('!window.cityManager.rail().pending');await send('Emulation.setDeviceMetricsOverride',{width,height,screenWidth:width,screenHeight:height,deviceScaleFactor:1,mobile:true});await sleep(100);assert.deepEqual((await snapshot()).graph,movingGraph);
    await cell(250);await cell(251);await button('#rail-confirm-accept');assert.deepEqual((await snapshot()).graph,movingGraph,'Occupied rail edit is rejected');assert.match(await evaluate('document.querySelector("#status").textContent'),/ยังถอดรางไม่ได้/);
    // First endpoint followed by pan/cancel must not leave a latent second-endpoint command.
    await cell(250);const p=await evaluate('window.cityManager.cellScreen(249)');
    await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:p.x,y:p.y,id:3}]});await send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:p.x+40,y:p.y+15,id:3}]});await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});assert.equal((await diag()).pending,false);assert.equal((await diag()).start,null);
    await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:p.x,y:p.y,id:4}]});await send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});assert.equal((await diag()).pending,false);assert.deepEqual((await snapshot()).graph,movingGraph);
    await button('#cancel-tool');for(let n=0;n<3;n++){await manage();await closePanel();}assert.equal((await diag()).mode,'select');
    const saved=await evaluate('window.cityManager.sessionSnapshot()');await button('#toggle-game-menu');await button('#save');await until(`localStorage.getItem(${JSON.stringify(SAVE_KEY)})===${JSON.stringify(saved)}`);await button('#close-inspector');await reloadExact(saved);
    assert.equal(await evaluate('JSON.parse(window.cityManager.sessionSnapshot()).market.guestId'),journal.guestId,'Guest identity survives save/reload');checks.push(`${name}: real retained queues/train, station closure/service pause, occupied edit refusal, fresh confirm/cancel, pan/touchcancel, repeated panel, exact save/reload and Guest identity`);
    await navigate(name+'-empty','empty');await tool('remove-track');const emptyGraph=(await snapshot()).graph;await cell(250);await cell(251);await button('#rail-confirm-cancel');assert.deepEqual((await snapshot()).graph,emptyGraph);
    await cell(250);await cell(251);await button('#rail-confirm-accept');assert.equal((await snapshot()).graph.links.length,emptyGraph.links.length-2,'Confirmed idle track removal');
    await manage();await button('#rail-remove-line');await button('#rail-confirm-accept');assert.equal((await snapshot()).service,null);assert.equal((await diag()).trains,0,'No ghost train after removing idle line');
    await manage();await button('[data-rail-station="a"]');await button('#rail-confirm-accept');assert.equal((await snapshot()).stations.length,1);
    await tool('station');await cell(245);await button('#rail-confirm-cancel');assert.equal((await snapshot()).stations.length,1);await cell(245);await button('#rail-confirm-accept');assert.equal((await snapshot()).stations.length,2);assert.equal((await snapshot()).service,null);
    await button('#cancel-tool');const planned=await evaluate('window.cityManager.sessionSnapshot()');await button('#toggle-game-menu');await button('#save');await until(`localStorage.getItem(${JSON.stringify(SAVE_KEY)})===${JSON.stringify(planned)}`);await button('#close-inspector');await reloadExact(planned);assert.equal((await diag()).trains,0);
    checks.push(`${name}: idle track removal, line/station removal, explicit planning confirmation/cancel, no ghost train, planned state saved atomically`);
  }
  assert.deepEqual(errors,[]);await writeFile(resolve(output,'report.json'),JSON.stringify({browser:browser.product,url,checks,errors,device:'Edge native emulated touch and software WebGL; not Android/FPS evidence',profile:'Isolated synthetic fixture; offline entry; no market backend'},null,2));console.log(JSON.stringify({checks,errors},null,2));
}catch(error){await shot('failure').catch(()=>{});await writeFile(resolve(output,'failure.json'),JSON.stringify({error:String(error),errors,checks,page:await evaluate('({text:document.body.innerText.slice(-5000),rail:window.cityManager?.rail?.()})').catch(()=>null)},null,2));throw error;}
finally{ws?.close();child.kill();}
