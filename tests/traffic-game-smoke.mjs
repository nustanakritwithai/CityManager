// Default-on allocation-game acceptance against the built app in a disposable
// loopback Edge profile. No live accounts, production storage or provider calls.
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {createCity as legacyCity,step as legacyStep,serialize as legacySerialize} from '../src/legacy-v4.ts';
import {createCity,buildRoad,buildParallelRoad,deserialize,serialize,adoptSavedEducation,step,GATEWAY,SIZE} from '../src/sim.ts';
import {createParkRuntime,serializeParkSession,deserializeParkSession} from '../src/park-runtime.ts';
import {trafficPlan} from '../src/traffic-plan.ts';
import {populationFixture} from './population-capacity-fixture.ts';
import {TrafficGame,captureTrafficGameSample} from '../src/traffic/game.ts';
import {reachTouch} from './touch-reach.mjs';
const cell=(x,y)=>y*SIZE+x;
// Strictly imported real simulation with actual earned freight/factory effects.
const old=legacyCity(61025);for(let d=0;d<29;d++)legacyStep(old);
const economyCity=deserialize(legacySerialize(old));adoptSavedEducation(economyCity);step(economyCity);
let plan=trafficPlan(economyCity);for(let d=0;d<60&&!(plan.trucks.length&&plan.smoke.length);d++){step(economyCity);plan=trafficPlan(economyCity);}
assert.ok(plan.trucks.length&&plan.smoke.length,'fixture must contain genuine delivery trucks and factory smoke');
const economyRaw=serializeParkSession(economyCity,createParkRuntime(economyCity)),economyCityRaw=serialize(economyCity),expectedEconomy=deserialize(economyCityRaw);
for(let i=0;i<3;i++)step(expectedEconomy);
// Validated synthetic density fixture, NOT a claim of natural growth or mobile FPS.
const dense=populationFixture(334,true);step(dense);const denseRaw=serializeParkSession(dense,createParkRuntime(dense));
assert.deepEqual(deserializeParkSession(denseRaw).city,dense);
// Road control fixture built through actual economic commands, not a fake City.
const road=createCity(61025,{starter:false});assert.equal(buildRoad(road,GATEWAY,cell(10,12)).ok,true);
const roadRaw=serializeParkSession(road,createParkRuntime(road));
const roadExpected=deserialize(serialize(road));assert.equal(buildParallelRoad(roadExpected,cell(5,13),cell(10,13)).ok,true);
// Validated synthetic city: concentrated housing feeds a shared road
// bottleneck. A player-built connected bypass improves game throughput.
const bypassSeed=populationFixture(32,true),homes=bypassSeed.buildings.filter(b=>b.zone==='R'),firms=bypassSeed.buildings.filter(b=>b.zone!=='R');
bypassSeed.cells.forEach(c=>{c.road=false;c.zone=null;c.building=null;});
for(const i of [272,273,274,275,...Array.from({length:10},(_,i)=>288+i)])bypassSeed.cells[i].road=true;
for(const [i,b] of homes.entries()){b.cell=[271,248][i];bypassSeed.cells[b.cell]={road:false,zone:b.zone,building:b.id};}
for(const [i,b] of firms.entries()){b.cell=[251,276,400,401,402,403,404][i];bypassSeed.cells[b.cell]={road:false,zone:b.zone,building:b.id};}
const bypassCity=deserialize(serialize(bypassSeed)),bypassRaw=serializeParkSession(bypassCity,createParkRuntime(bypassCity)),bypassExpected=deserialize(serialize(bypassCity));
for(const [a,b] of [[296,320],[320,323],[323,275]])assert.equal(buildParallelRoad(bypassExpected,a,b).ok,true);
assert.deepEqual(deserialize(serialize(bypassExpected)),bypassExpected);
const pureGame=(c,n)=>{const game=new TrafficGame(captureTrafficGameSample(c));for(let i=0;i<n;i++)game.step();return game.frame;};
const baselineTen=pureGame(bypassCity,10),bypassTen=pureGame(bypassExpected,10);assert.ok(bypassTen.completed>baselineTen.completed,'Validated player-built bypass must improve the independent game');
if(process.argv.includes('--preflight')){console.log(JSON.stringify({fixture:{day:economyCity.tick,trucks:plan.trucks.length,smoke:plan.smoke.length},dense:{population:dense.households.reduce((n,h)=>n+h.members,0),buildings:dense.buildings.length,roads:dense.cells.filter(c=>c.road).length},roadBytes:roadRaw.length,expectedRoads:roadExpected.cells.filter(c=>c.road).length,bypass:{before:baselineTen.completed,after:bypassTen.completed}}));process.exit(0);}
const blocked=process.env.CITYMANAGER_BLOCK_MODELS==='1',software=process.env.CITYMANAGER_SOFTWARE_WEBGL==='1',expectDefault=process.env.TRAFFIC_GAME_EXPECT_DEFAULT==='1';
const url=process.env.CITYMANAGER_URL||'http://127.0.0.1:4195/CityManager/',origin=new URL(url).origin;assert.equal(new URL(url).hostname,'127.0.0.1');
const output=resolve('.test-output/traffic-game',blocked?'fallback':'normal'),port=9366;await mkdir(output,{recursive:true});const profile=await mkdtemp(resolve(output,'profile-'));
let occupied=false;try{occupied=(await fetch(`http://127.0.0.1:${port}/json/version`,{signal:AbortSignal.timeout(500)})).ok;}catch{}assert.equal(occupied,false,'Dedicated CDP port already in use');
const args=['--headless=new','--no-first-run','--no-default-browser-check','--disable-extensions','--disable-background-networking','--disable-component-update','--remote-debugging-address=127.0.0.1',`--remote-debugging-port=${port}`,`--user-data-dir=${profile}`];
if(software)args.push('--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader');
const child=spawn(process.env.CITYMANAGER_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',[...args,'about:blank'],{windowsHide:true,stdio:'ignore'});
let ws,sequence=0,initScript,seedGeneration=0,touchMode=false,launchError;const pending=new Map(),errors=[],expectedErrors=[],externalRequests=[],checks=[],screenshots=[];let frameIntervals=null;
child.on('error',error=>{launchError=error;});const watchdog=setTimeout(()=>{console.error('Allocation game acceptance exceeded bounded run');child.kill();process.exit(1);},240_000);const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function send(method,params={}){const id=++sequence,result=new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error(`CDP timeout ${method}`));},30000);pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});});ws.send(JSON.stringify({id,method,params}));return result;}
async function evaluate(expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
async function until(expression,timeout=60000){const start=Date.now();while(Date.now()-start<timeout){if(await evaluate(expression))return;await sleep(60);}throw Error(`Timeout ${expression}`);}
const paints=()=>evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
const diag=()=>evaluate('({traffic:window.cityManager.traffic(),decorative:window.cityManager.atmosphere().traffic,paused:window.cityManager.parks().paused})');
async function screenshot(name){const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(resolve(output,name),Buffer.from(r.data,'base64'));screenshots.push(name);}
async function click(x,y){if(touchMode){await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});return;}for(const type of ['mouseMoved','mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,x,y,button:type==='mouseMoved'?'none':'left',clickCount:1});}
async function button(selector){if(await reachTouch(evaluate,button,selector))return;await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest',inline:'nearest'})`);await paints();const p=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height,disabled:e.disabled}})()`);assert.ok(p.w&&p.h&&!p.disabled,`Visible enabled ${selector}`);assert.equal(await evaluate(`!!document.elementFromPoint(${p.x},${p.y})?.closest(${JSON.stringify(selector)})`),true,`Actual hit ${selector}`);await click(p.x,p.y);}
async function viewport(mobile){touchMode=mobile;await send('Emulation.setDeviceMetricsOverride',{width:mobile?390:1440,height:mobile?844:1000,screenWidth:mobile?390:1440,screenHeight:mobile?844:1000,deviceScaleFactor:1,mobile});await send('Emulation.setTouchEmulationEnabled',{enabled:mobile,maxTouchPoints:2});await until(`innerWidth===${mobile?390:1440}`);await paints();}
async function navigate(raw,query=''){
 const oldBoot=await evaluate('window.__trafficGameBoot ?? null');if(initScript)await send('Page.removeScriptToEvaluateOnNewDocument',{identifier:initScript});const token=`game-case-${++seedGeneration}`;
 const source=`window.__trafficGameBoot=crypto.randomUUID();if(location.origin===${JSON.stringify(origin)}){if(sessionStorage.getItem('traffic-game-seed')!==${JSON.stringify(token)}){sessionStorage.setItem('traffic-game-seed',${JSON.stringify(token)});const pref=localStorage.getItem('citymanager.traffic');localStorage.clear();if(pref!==null)localStorage.setItem('citymanager.traffic',pref);localStorage.setItem('citymanager.save.v7',${JSON.stringify(raw)});localStorage.setItem('citymanager.visual.v1',JSON.stringify({timeMode:'noon',quality:'low',rain:false,seasons:false,traffic:true,mapInfo:false}));}window.__trafficWrites=[];for(const method of ['setItem','removeItem']){const old=Storage.prototype[method];Storage.prototype[method]=function(key,...args){if(this===localStorage)window.__trafficWrites.push({method,key});return old.call(this,key,...args)}}}`;
 initScript=(await send('Page.addScriptToEvaluateOnNewDocument',{source})).identifier;await send('Page.navigate',{url:url+query});await until(`window.__trafficGameBoot!==${JSON.stringify(oldBoot)}&&!!window.cityManager&&window.cityManager.visuals().ready`);
 assert.equal(await evaluate('window.cityManager.parks().paused'),true);assert.equal(await evaluate("localStorage.getItem('citymanager.save.v7')"),raw,'Startup retains exact original bytes');
 assert.deepEqual(await evaluate("window.__trafficWrites.filter(x=>/^citymanager\\.(save|backup|checkpoint|market)/.test(x.key))"),[],'Startup performs no save writes');
 const assets=await evaluate('window.cityManager.visuals()');assert.equal(assets.failed.length,blocked?41:0);return diag();
}
async function tapCell(i){await paints();const p=await evaluate(`window.cityManager.cellScreen(${i})`);assert.equal(await evaluate(`document.elementFromPoint(${p.x},${p.y})?.id`),'city-canvas');await click(p.x,p.y);}
async function closeInspector(){if(await evaluate('document.querySelector("#inspector").dataset.open==="true"'))await button('#close-inspector');}
async function gameMenu(){await closeInspector();await button('#toggle-game-menu');await until('document.querySelector("#inspector").dataset.page==="game"');}
async function waitModel(){await until("window.cityManager.traffic()?.mode==='allocation-game' && window.cityManager.traffic()?.worker?.applied>0 && !window.cityManager.traffic()?.failure");}
async function waitPausedModel(){await until("window.cityManager.parks().paused && window.cityManager.traffic()?.paused && !window.cityManager.traffic()?.worker?.inflight && !window.cityManager.traffic()?.worker?.pending");}
async function gameTenSteps(){
 await button('#toggle-inspector');await until('document.querySelector("#inspector").dataset.page==="city"');await button('#park-recreation button[data-speed]');await closeInspector();
 await evaluate(`window.__trafficTen=false;(()=>{const watch=()=>{const t=window.cityManager.traffic();if(t&&t.step>=10){if(!window.cityManager.parks().paused)document.querySelector('#pause').click();window.__trafficTen=true;}else requestAnimationFrame(watch)};requestAnimationFrame(watch)})()`);
 await button('#pause');await until('window.__trafficTen&&window.cityManager.parks().paused',35000);await waitPausedModel();const t=(await diag()).traffic;assert.equal(t.step,10,'exactly ten real-time game steps');return t;
}
async function runThreeDays(query){
 await navigate(economyRaw,query);const start=JSON.parse(economyCityRaw).tick;
 await evaluate(`window.__trafficGameStop=false;(()=>{const watch=()=>{if(JSON.parse(window.cityManager.snapshot()).tick>=${start+3}){if(!window.cityManager.parks().paused)document.querySelector('#pause').click();window.__trafficGameStop=true;}else requestAnimationFrame(watch)};requestAnimationFrame(watch)})()`);
 await button('#pause');await until('window.__trafficGameStop&&window.cityManager.parks().paused');
 const result=await evaluate('window.cityManager.snapshot()');assert.equal(result,serialize(expectedEconomy),'Actual three-day economy equals pure replay');return result;
}
try{
 let page;for(let i=0;i<100;i++){try{page=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(p=>p.type==='page'&&p.url==='about:blank');if(page)break;}catch{}await sleep(100);}
 if(launchError)throw launchError;assert.ok(page,'Installed Edge started');ws=new WebSocket(page.webSocketDebuggerUrl);
 ws.onmessage=event=>{const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}}
  else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);
  else if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error'){const a=m.params.args;const expected=blocked&&a.length===2&&/^Failed to load resource \[\/CityManager\/assets\/kenney-city\/models\/([a-z]+(?:-[a-z]+)?)\.glb-container\]: Network error$/.test(a[0]?.value)&&a[1]?.value==='Network error';(expected?expectedErrors:errors).push(a);}
  else if(m.method==='Fetch.requestPaused'){const request=m.params.request.url,local=!/^https?:/.test(request)||new URL(request).origin===origin,model=/\/assets\/kenney-city\/models\/[^/]+\.glb(?:\?|$)/.test(request);if(!local)externalRequests.push(request);void send(!local||blocked&&model?'Fetch.failRequest':'Fetch.continueRequest',!local||blocked&&model?{requestId:m.params.requestId,errorReason:'Failed'}:{requestId:m.params.requestId}).catch(error=>errors.push(String(error)));}
  else if(m.method==='Network.requestWillBeSent'){const u=m.params.request.url;if(/^https?:/.test(u)&&new URL(u).origin!==origin)externalRequests.push(u);}
 };
 await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});await send('Runtime.enable');await send('Page.enable');await send('Network.enable');await send('Network.setCacheDisabled',{cacheDisabled:true});await send('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});await viewport(false);
 // Fresh profile has no explicit preference; this must be the *new* game model,
 // not the old assignment fleet. Its workload is a bounded visual allocation.
 let d=await navigate(economyRaw);if(!expectDefault){assert.equal(d.traffic,null,'pre-release default is off');d=await navigate(economyRaw,'?traffic=1');}
 await waitModel();d=await diag();assert.equal(d.traffic.mode,'allocation-game');assert.equal(d.traffic.paused,true);assert.ok(d.traffic.roads>0);assert.ok(d.decorative.trucks>0&&d.decorative.plumes>0);assert.equal(d.decorative.cars,0);assert.equal(await evaluate("localStorage.getItem('citymanager.traffic')"),expectDefault?null:'1');
 const initialCity=await evaluate('window.cityManager.snapshot()');assert.equal(initialCity,economyCityRaw);checks.push(expectDefault?'Fresh no-query launch uses default allocation game with delivery trucks/factory smoke':'Pre-release default OFF; explicit ON uses allocation game with delivery trucks/factory smoke');
 await button('#pause');await until('window.cityManager.traffic()?.moving>0 && window.cityManager.traffic()?.cars>0 && window.cityManager.traffic()?.step>0',30000);d=await diag();assert.ok(d.traffic.demandRate>0);await screenshot('desktop-traffic-game.png');
 await button('#pause');await waitPausedModel();const paused=await diag(),pausedCity=await evaluate('window.cityManager.snapshot()');await sleep(600);const afterPause=await diag();for(const key of ['step','waiting','moving','completed','dropped','cancelled'])assert.equal(afterPause.traffic[key],paused.traffic[key],`Paused ${key} must not advance`);assert.equal(await evaluate('window.cityManager.snapshot()'),pausedCity);checks.push('Game creates real rendered representative cars; pause freezes model and city');
 // Persist the ordinary city and park session only: game counters are ephemeral.
 const oldEpoch=paused.traffic.worker.epoch;await gameMenu();await button('#save');await until("window.__trafficWrites.some(x=>x.method==='setItem'&&x.key==='citymanager.save.v7')");const saved=await evaluate("localStorage.getItem('citymanager.save.v7')");const savedDoc=JSON.parse(saved);assert.equal(savedDoc.trafficRuntime,undefined);assert.equal(savedDoc.trafficGame,undefined);assert.deepEqual(deserializeParkSession(saved).city,deserialize(pausedCity));assert.deepEqual(JSON.parse(saved),JSON.parse(await evaluate('window.cityManager.sessionSnapshot()')));
 await button('#load');await until(`window.cityManager.parks().paused&&window.cityManager.traffic()?.worker?.epoch!==${JSON.stringify(oldEpoch)}`);await waitModel();assert.equal((await diag()).traffic.step,0,'Accepted load starts a fresh ephemeral game');assert.equal(await evaluate('window.cityManager.snapshot()'),pausedCity);checks.push('Save/load preserves city and journals, stores no game sidecar, and resets the ephemeral epoch');
 // Test the actual game-menu control as well as URL preferences.
 await button('#traffic-game-toggle');await until('window.cityManager.traffic()===null');assert.equal(await evaluate("localStorage.getItem('citymanager.traffic')"),'0');assert.equal(await evaluate("document.querySelector('#traffic-game-toggle').getAttribute('aria-pressed')"),'false');
 await button('#traffic-game-toggle');await waitModel();assert.equal(await evaluate("localStorage.getItem('citymanager.traffic')"),'1');checks.push('Game-menu toggle switches the model and records both explicit OFF and ON');
 // OFF is a durable explicit preference; no-query reload must stay off. Re-enable
 // and compare deterministic economy replay to OFF, not just visual appearance.
 d=await navigate(economyRaw,'?traffic=0');assert.equal(d.traffic,null);assert.equal(await evaluate("localStorage.getItem('citymanager.traffic')"),'0');assert.equal((await navigate(economyRaw)).traffic,null);
 assert.equal(await runThreeDays('?traffic=1'),await runThreeDays('?traffic=0'));checks.push('Explicit OFF survives reload; ON and OFF play identical three-day city/economy replay');
 // Paused road construction must update the actual model snapshot without
 // advancing its game clock or changing anything beyond ordinary road costs.
 d=await navigate(roadRaw,'?traffic=1');await waitModel();const beforeRoad=(await diag()).traffic;assert.equal(beforeRoad.roads,road.cells.filter(c=>c.road).length);await button('[data-tool="road"]');await tapCell(cell(5,13));await tapCell(cell(10,13));await until(`window.cityManager.traffic()?.roads===${roadExpected.cells.filter(c=>c.road).length}`);await waitPausedModel();d=await diag();assert.equal(d.traffic.step,beforeRoad.step);assert.equal(await evaluate('window.cityManager.snapshot()'),serialize(roadExpected));checks.push('Real road tool updates paused game topology while preserving ordinary construction accounting');
 // Real player input builds a connected bypass. One game minute/second keeps
 // the economic city day unchanged while each road game runs ten real seconds.
 await navigate(bypassRaw,'?traffic=1');await waitModel();const beforeBypass=await gameTenSteps();assert.equal(beforeBypass.completed,baselineTen.completed);
 await navigate(bypassRaw,'?traffic=1');await waitModel();await button('[data-tool="road"]');for(const [a,b] of [[296,320],[320,323],[323,275]]){await tapCell(a);await tapCell(b);}await until(`window.cityManager.traffic()?.roads===${bypassExpected.cells.filter(c=>c.road).length}`);await waitPausedModel();
 assert.equal(await evaluate('window.cityManager.snapshot()'),serialize(bypassExpected),'Real bypass construction matches validated economic commands');
 const afterBypass=await gameTenSteps();assert.equal(afterBypass.completed,bypassTen.completed);assert.ok(afterBypass.completed>beforeBypass.completed);checks.push('Real player-built connected bypass increases modeled throughput at the same ten-step workload');
 // A valid, reconciled synthetic population fixture checks density and mobile
 // rendering. It is not claimed to be a natural-growth or real-device benchmark.
 await viewport(true);d=await navigate(denseRaw,'?traffic=1');await waitModel();d=await diag();assert.ok(d.traffic.demandRate>0);assert.equal(d.traffic.roads,dense.cells.filter(c=>c.road).length);assert.equal(d.traffic.failure,null);await button('#toggle-inspector');await until('document.querySelector("#inspector").dataset.page==="city"');await evaluate("document.querySelector('#traffic-game-status').scrollIntoView({block:'nearest'})");await paints();const statusLayout=await evaluate(`(()=>{const e=document.querySelector('#traffic-game-status'),r=e.getBoundingClientRect();return {text:e.innerText,hidden:e.hidden,x:r.x,right:r.right,width:r.width,screen:innerWidth}})()`);assert.equal(statusLayout.hidden,false);assert.ok(/จำลอง/.test(statusLayout.text)&&/ไม่ใช่/.test(statusLayout.text),'UI explicitly identifies the allocation as simulated, not real trips');assert.ok(statusLayout.width>0&&statusLayout.x>=0&&statusLayout.right<=statusLayout.screen+1,JSON.stringify(statusLayout));await screenshot('mobile-dense-game-paused.png');await closeInspector();
 await button('#pause');await until('window.cityManager.traffic()?.step>=1&&window.cityManager.traffic()?.moving>0',30000);await screenshot('mobile-dense-game-moving.png');
 // Actual browser rAF intervals during active game in the 390px viewport. This
 // broad CI regression gate is not a physical-mobile or 60 FPS certification.
 const intervals=await evaluate(`new Promise(resolve=>{const a=[];let previous;const sample=t=>{if(previous!==undefined)a.push(t-previous);previous=t;if(a.length>=130)resolve(a.slice(10));else requestAnimationFrame(sample)};requestAnimationFrame(sample)})`);
 const sorted=[...intervals].sort((a,b)=>a-b);frameIntervals={count:sorted.length,p95:sorted[Math.floor((sorted.length-1)*.95)],max:sorted.at(-1)};assert.ok(frameIntervals.p95<100&&frameIntervals.max<1000,JSON.stringify(frameIntervals));assert.equal((await diag()).traffic.failure,null);
 await button('#pause');await waitPausedModel();checks.push('390px touch viewport loads active bounded traffic; real browser animation intervals stay within broad CI regression thresholds');
 assert.deepEqual(errors,[]);assert.deepEqual(externalRequests,[]);if(blocked)assert.ok(expectedErrors.length>=41);
 const report={browser:await send('Browser.getVersion'),blockedModels:blocked,softwareWebGL:software,expectDefault,fixtures:{economy:{day:economyCity.tick,trucks:plan.trucks.length,smoke:plan.smoke.length},dense:{population:dense.households.reduce((n,h)=>n+h.members,0),buildings:dense.buildings.length}},checks,errors,externalRequests,screenshots,frameIntervals,note:'Installed Edge desktop/mobile emulation; not physical Android, FPS certification or live-site acceptance.'};
 await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}catch(error){try{await screenshot('failure.png');await writeFile(resolve(output,'failure.json'),JSON.stringify({error:String(error),errors,externalRequests,state:await diag(),page:await evaluate('({url:location.href,text:document.body.innerText.slice(-3000)})')},null,2));}catch{}throw error;}
finally{clearTimeout(watchdog);if(ws?.readyState===1){try{await send('Browser.close');}catch{}ws.close();}child.kill();}
