// Default-on allocation-game acceptance against the built app in a disposable
// loopback Edge profile. No live accounts, production storage or provider calls.
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {decodeSaveCopy} from '../src/save-copy-codec.ts';
import {SAVE_KEY,AUTOSAVE_CHECKPOINT_KEY,PRE_AUTOSAVE_BACKUP} from '../src/save-storage.ts';
import {installTrafficSaveTrace} from './traffic-save-trace.mjs';
import {createCity as legacyCity,step as legacyStep,serialize as legacySerialize} from '../src/legacy-v4.ts';
import {createCity,buildRoad,buildParallelRoad,deserialize,serialize,adoptSavedEducation,step,GATEWAY,SIZE} from '../src/sim.ts';
import {createParkRuntime,serializeParkSession,deserializeParkSession} from '../src/park-runtime.ts';
import {trafficPlan} from '../src/traffic-plan.ts';
import {populationFixture} from './population-capacity-fixture.ts';
import {trafficGamePeakFixture} from './traffic-game-peak-fixture.ts';
import {TrafficGame,captureTrafficGameSample} from '../src/traffic/game.ts';
import {reachTouch} from './touch-reach.mjs';
import {enterSeededCity,observeRecoveryIdb,denyRecoveryIdbForTraffic} from './traffic-seeded-city-entry.mjs';
import {trafficGameCase} from './traffic-game-cases.mjs';
import {fallbackMetrics} from './traffic-game-fallback-metrics.mjs';
import {peakTriplicateMetrics} from './traffic-game-peak-metrics.mjs';
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
// Both paths get the same bounded 20-step warmup: acceleration and safe corner traversal
// consume the first ten steps. Demand and strict improvement remain unchanged.
const baselineTwenty=pureGame(bypassCity,20),bypassTwenty=pureGame(bypassExpected,20);assert.ok(bypassTwenty.completed>baselineTwenty.completed,'Validated player-built bypass must improve the independent game');
const blocked=process.env.CITYMANAGER_BLOCK_MODELS==='1',software=process.env.CITYMANAGER_SOFTWARE_WEBGL==='1',expectDefault=process.env.TRAFFIC_GAME_EXPECT_DEFAULT==='1';
const testPlan=trafficGameCase(process.env.TRAFFIC_GAME_CASE||'full',blocked);
const denyRecoveryStorage=testPlan.name==='full'||testPlan.name==='core';
const recoveryStorageMode=denyRecoveryStorage?'synthetic-recovery-idb-denied':'native-observed';
const evidenceCase=denyRecoveryStorage?`${testPlan.output}-idb-denied`:testPlan.output;
const fallbackAutosaveSchedule=blocked&&testPlan.extended?'dense OFF/ON only: capture single native60000ms callback; invoke after strict isolation sample; lifecycle native':'native';
if(process.argv.includes('--preflight')){console.log(JSON.stringify({testPlan,evidenceCase,recoveryStorageMode,fallbackAutosaveSchedule,fixture:{day:economyCity.tick,trucks:plan.trucks.length,smoke:plan.smoke.length},dense:{population:dense.households.reduce((n,h)=>n+h.members,0),buildings:dense.buildings.length,roads:dense.cells.filter(c=>c.road).length},roadBytes:roadRaw.length,expectedRoads:roadExpected.cells.filter(c=>c.road).length,bypass:{before:baselineTwenty.completed,after:bypassTwenty.completed}}));process.exit(0);}
const url=process.env.CITYMANAGER_URL||'http://127.0.0.1:4195/CityManager/',origin=new URL(url).origin;assert.equal(new URL(url).hostname,'127.0.0.1');
const output=resolve('.test-output/traffic-game',evidenceCase),port=9366;await mkdir(output,{recursive:true});const profile=await mkdtemp(resolve(output,'profile-'));
let occupied=false;try{occupied=(await fetch(`http://127.0.0.1:${port}/json/version`,{signal:AbortSignal.timeout(500)})).ok;}catch{}assert.equal(occupied,false,'Dedicated CDP port already in use');
const args=['--headless=new','--no-first-run','--no-default-browser-check','--disable-extensions','--disable-background-networking','--disable-component-update','--remote-debugging-address=127.0.0.1',`--remote-debugging-port=${port}`,`--user-data-dir=${profile}`];
if(software)args.push('--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader');
const child=spawn(process.env.CITYMANAGER_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',[...args,'about:blank'],{windowsHide:true,stdio:'ignore'});
let ws,sequence=0,initScript,seedGeneration=0,touchMode=false,launchError;const pending=new Map(),errors=[],expectedErrors=[],externalRequests=[],checks=[],screenshots=[],bypassTraces=[];const controlledAutosaveChecks=[];let lastSaveTrace=null,frameIntervals=null,peakComparison=null,lastDiagnostic=null,lastDiagnosticAt=null,lastBypassTrace=null;
const runStarted=Date.now(),stages=[];let stage='browser launch',stageAt=runStarted;
function setStage(name){stage=name;stageAt=Date.now();stages.push({name,elapsedMs:stageAt-runStarted});console.log(`[traffic-game ${evidenceCase}] ${name} (+${stageAt-runStarted} ms)`);}
child.on('error',error=>{launchError=error;});
// The deadline remains 240 seconds. Write already-available context synchronously;
// do not wait on a potentially hung CDP connection or extend the watchdog.
const watchdog=setTimeout(()=>{const state={error:'Allocation game acceptance exceeded bounded run',fallbackAutosaveSchedule,controlledAutosaveChecks,lastSaveTrace,stage,stageElapsedMs:Date.now()-stageAt,totalElapsedMs:Date.now()-runStarted,blockedModels:blocked,softwareWebGL:software,testCase:testPlan.name,evidenceCase,recoveryStorageMode,checks,stages,lastDiagnostic,lastDiagnosticAt,frameIntervals,peakComparison,bypassTraces,lastBypassTrace,errors,externalRequests,pending:[...pending.values()].map(x=>({method:x.method,elapsedMs:Date.now()-x.startedAt}))};console.error(JSON.stringify(state));try{writeFileSync(resolve(output,'failure.json'),JSON.stringify(state,null,2));}catch{}child.kill();process.exit(1);},240_000);const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function send(method,params={}){const id=++sequence,result=new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error(`CDP timeout ${method} at ${stage}`));},30000);pending.set(id,{method,startedAt:Date.now(),resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});});ws.send(JSON.stringify({id,method,params}));return result;}
async function evaluate(expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
async function until(expression,timeout=60000,onProgress){const start=Date.now();while(Date.now()-start<timeout){const result=await evaluate(expression);if(onProgress)onProgress(result);if(onProgress?result.done:result)return;await sleep(60);}throw Error(`Timeout ${expression}`);}
const paints=()=>evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
async function diag(){lastDiagnostic=await evaluate('({traffic:window.cityManager.traffic(),decorative:window.cityManager.atmosphere().traffic,parks:window.cityManager.parks(),paused:window.cityManager.parks().paused})');lastDiagnosticAt=Date.now();return lastDiagnostic;}
async function screenshot(name){const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(resolve(output,name),Buffer.from(r.data,'base64'));screenshots.push(name);}
async function click(x,y){if(touchMode){await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});return;}for(const type of ['mouseMoved','mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,x,y,button:type==='mouseMoved'?'none':'left',clickCount:1});}
async function button(selector){if(await reachTouch(evaluate,button,selector))return;await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest',inline:'nearest'})`);await paints();const p=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height,disabled:e.disabled}})()`);assert.ok(p.w&&p.h&&!p.disabled,`Visible enabled ${selector}`);assert.equal(await evaluate(`!!document.elementFromPoint(${p.x},${p.y})?.closest(${JSON.stringify(selector)})`),true,`Actual hit ${selector}`);await click(p.x,p.y);}
async function viewport(mobile){touchMode=mobile;await send('Emulation.setDeviceMetricsOverride',{width:mobile?390:1440,height:mobile?844:1000,screenWidth:mobile?390:1440,screenHeight:mobile?844:1000,deviceScaleFactor:1,mobile});await send('Emulation.setTouchEmulationEnabled',{enabled:mobile,maxTouchPoints:2});await until(`innerWidth===${mobile?390:1440}`);await paints();}
async function navigate(raw,query='',controlAutosave=false){
 const oldBoot=await evaluate('window.__trafficGameBoot ?? null');if(initScript)await send('Page.removeScriptToEvaluateOnNewDocument',{identifier:initScript});const token=`game-case-${++seedGeneration}`;
 const source=`${denyRecoveryStorage?denyRecoveryIdbForTraffic:''}${observeRecoveryIdb}window.__trafficGameBoot=crypto.randomUUID();if(location.origin===${JSON.stringify(origin)}){if(sessionStorage.getItem('traffic-game-seed')!==${JSON.stringify(token)}){sessionStorage.setItem('traffic-game-seed',${JSON.stringify(token)});const pref=localStorage.getItem('citymanager.traffic');localStorage.clear();if(pref!==null)localStorage.setItem('citymanager.traffic',pref);localStorage.setItem('citymanager.save.v7',${JSON.stringify(raw)});localStorage.setItem('citymanager.visual.v1',JSON.stringify({timeMode:'noon',quality:'low',rain:false,seasons:false,traffic:true,mapInfo:false}));}window.__trafficWrites=[];for(const method of ['setItem','removeItem']){const old=Storage.prototype[method];Storage.prototype[method]=function(key,...args){if(this===localStorage)window.__trafficWrites.push({method,key});return old.call(this,key,...args)}}}`;
 initScript=(await send('Page.addScriptToEvaluateOnNewDocument',{source:source+(blocked?`(${installTrafficSaveTrace.toString()})(${controlAutosave});`:'')})).identifier;await send('Page.navigate',{url:url+query});await until(`window.__trafficGameBoot!==${JSON.stringify(oldBoot)}&&!!window.cityManager&&window.cityManager.visuals().ready`);
 if(denyRecoveryStorage){
  const storage=await evaluate('window.__trafficRecoveryStorage');
  assert.equal(storage?.mode,recoveryStorageMode);assert.ok(storage.denials>=1,'Declared denied-storage fixture actually exercised recovery startup');
  assert.equal(await evaluate("!!document.querySelector('#startup-recovery-chooser[open]')"),true,'Denied recovery storage keeps the real protection dialog');
  console.log('Traffic storage fixture',JSON.stringify(storage));
 }
 await enterSeededCity({evaluate,button,send,until,raw});
 if(controlAutosave)assert.deepEqual(await evaluate('window.__trafficAutosaveSchedule'),{mode:'controlled-single-60000ms-after-fallback-sample',registrations:1,invocations:0});
 assert.equal(await evaluate('window.cityManager.parks().paused'),true);assert.equal(await evaluate("localStorage.getItem('citymanager.save.v7')"),raw,'Startup retains exact original bytes');
 assert.deepEqual(await evaluate("window.__trafficWrites.filter(x=>/^citymanager\\.(save|backup|checkpoint|market)/.test(x.key))"),[],'Startup performs no save writes');
 const assets=await evaluate('window.cityManager.visuals()');assert.equal(assets.failed.length,blocked?41:0);return diag();
}
async function tapCell(i){await paints();const p=await evaluate(`window.cityManager.cellScreen(${i})`);assert.equal(await evaluate(`document.elementFromPoint(${p.x},${p.y})?.id`),'city-canvas');await click(p.x,p.y);}
async function closeInspector(){if(await evaluate('document.querySelector("#inspector").dataset.open==="true"'))await button('#close-inspector');}
async function mobileRaf(){return evaluate(`new Promise(resolve=>{const a=[],longTasks=[];let previous,observer=null;try{if(globalThis.PerformanceObserver?.supportedEntryTypes?.includes('longtask')){observer=new PerformanceObserver(list=>{for(const e of list.getEntries())longTasks.push(e.duration)});observer.observe({entryTypes:['longtask']})}}catch{}const sample=t=>{if(previous!==undefined)a.push(t-previous);previous=t;if(a.length>=130){if(observer){for(const e of observer.takeRecords())longTasks.push(e.duration);observer.disconnect()}resolve({intervals:a.slice(10),longTasks,longTaskSupported:!!observer,visibility:document.visibilityState})}else requestAnimationFrame(sample)};requestAnimationFrame(sample)})`);}
// Wall-time bound avoids requiring 130 frames on a software renderer. The
// timer ends even with too few frames; downstream marks those results UNKNOWN.
async function fallbackRaf(){return evaluate(`new Promise(resolve=>{window.__trafficSaveMark?.('fallback-sample-start');const a=[],longTasks=[],start=performance.now();let previous,observer=null,done=false;try{if(globalThis.PerformanceObserver?.supportedEntryTypes?.includes('longtask')){observer=new PerformanceObserver(list=>{for(const e of list.getEntries())longTasks.push(e.duration)});observer.observe({entryTypes:['longtask']})}}catch{}const finish=()=>{done=true;window.__trafficSaveMark?.('fallback-sample-end');if(observer){for(const e of observer.takeRecords())longTasks.push(e.duration);observer.disconnect()}resolve({intervals:a,longTasks,longTaskSupported:!!observer,visibility:document.visibilityState,elapsedMs:performance.now()-start,trailingMs:previous===undefined?null:Math.max(0,performance.now()-previous)})};const sample=t=>{if(done)return;if(previous!==undefined)a.push(t-previous);previous=t;requestAnimationFrame(sample)};setTimeout(finish,12000);requestAnimationFrame(sample)})`);}
function summarizeRaf(sample){const sorted=[...sample.intervals].sort((a,b)=>a-b);return {count:sorted.length,p50:sorted[Math.floor((sorted.length-1)*.5)],p95:sorted[Math.floor((sorted.length-1)*.95)],max:sorted.at(-1),over50ms:sorted.filter(v=>v>50).length,over100ms:sorted.filter(v=>v>100).length,longTaskSupported:sample.longTaskSupported,longTaskCount:sample.longTasks.length,longTaskMaxMs:Math.max(0,...sample.longTasks),visibility:sample.visibility};}
async function assertProtectedSaveUnchanged(raw){
 const actual=await evaluate("localStorage.getItem('citymanager.save.v7')");
 const trace=await evaluate('window.__trafficSaveTrace ?? []');
 if(actual!==raw||trace.some(e=>e.type==='protected-write')){
  const fingerprint=value=>value===null?null:{utf16Length:value.length,utf8Bytes:Buffer.byteLength(value),sha256:createHash('sha256').update(value).digest('hex')};
  const evidence=lastSaveTrace={stage,expected:fingerprint(raw),actual:fingerprint(actual),events:trace.map(({before,after,...event})=>({...event,...(before!==undefined?{before:fingerprint(before),after:fingerprint(after)}:{})}))};
  await writeFile(resolve(output,`save-write-trace-${seedGeneration}.json`),JSON.stringify(evidence,null,2));
  console.error('Protected save write trace',JSON.stringify(evidence));
 }
 assert.equal(actual,raw,'Fallback sample does not change primary save bytes');
 assert.deepEqual(trace.filter(e=>e.type==='protected-write').map(({before,after,...event})=>event),[],'Fallback sample has no protected writes including clear');
 assert.deepEqual(await evaluate("window.__trafficWrites.filter(x=>/^citymanager\\.(save|backup|checkpoint|market)/.test(x.key))"),[],'Fallback sample does not write protected storage');
}
// Keep traffic isolation strict, then exercise the captured production autosave
// callback separately. No lifecycle writers are suppressed. Full-session reload
// below uses the production deserializer, not a claim of a browser restart.
async function verifyControlledAutosave(original,condition){
 assert.equal(await evaluate('window.cityManager.parks().paused'),true);
 await assertProtectedSaveUnchanged(original);
 const expected=await evaluate('window.cityManager.sessionSnapshot()');
 assert.notEqual(expected,original,'Citizen runtime advanced despite unchanged economic City');
 await evaluate('window.__trafficInvokeAutosave()');
 await until(`localStorage.getItem(${JSON.stringify(SAVE_KEY)})===${JSON.stringify(expected)}`);
 const stored=await evaluate(`({primary:localStorage.getItem(${JSON.stringify(SAVE_KEY)}),checkpoint:localStorage.getItem(${JSON.stringify(AUTOSAVE_CHECKPOINT_KEY)}),backup:localStorage.getItem(${JSON.stringify(PRE_AUTOSAVE_BACKUP)}),schedule:window.__trafficAutosaveSchedule})`);
 assert.equal(stored.primary,expected);assert.equal(decodeSaveCopy(stored.checkpoint),expected);assert.equal(decodeSaveCopy(stored.backup),original);
 const restored=deserializeParkSession(stored.primary),baseline=deserializeParkSession(original);
 assert.equal(serialize(restored.city),serialize(baseline.city),'Autosave changes runtime, not economic City');
 assert.equal(serializeParkSession(restored.city,restored.runtime,restored.city.market),expected,'Production full-session deserialization round-trips saved runtime');
 assert.equal(await evaluate('window.cityManager.snapshot()'),serialize(baseline.city));
 assert.deepEqual(stored.schedule,{mode:'controlled-single-60000ms-after-fallback-sample',registrations:1,invocations:1});
 controlledAutosaveChecks.push({condition,...stored.schedule,primarySha256:createHash('sha256').update(stored.primary).digest('hex'),originalSha256:createHash('sha256').update(original).digest('hex'),primaryCheckpointEqual:true,originalBackupRetained:true,productionSessionRoundTrip:true,lifecycleHandlers:'native'});
}
async function citizenSpeed(){await button('#toggle-inspector');await until('document.querySelector("#inspector").dataset.page==="city"');await button('#park-recreation button[data-speed]');await closeInspector();}
async function gameMenu(){await closeInspector();await button('#toggle-game-menu');await until('document.querySelector("#inspector").dataset.page==="game"');}
async function waitModel(){await until("window.cityManager.traffic()?.mode==='allocation-game' && window.cityManager.traffic()?.worker?.applied>0 && !window.cityManager.traffic()?.failure");}
async function waitPausedModel(){await until("window.cityManager.parks().paused && window.cityManager.traffic()?.paused && !window.cityManager.traffic()?.worker?.inflight && !window.cityManager.traffic()?.worker?.pending");}
async function gameTwentySteps(){
 await button('#toggle-inspector');await until('document.querySelector("#inspector").dataset.page==="city"');await button('#park-recreation button[data-speed]');await closeInspector();
 await evaluate(`window.__trafficTwenty=false;window.__trafficBypassTrace={stage:${JSON.stringify(stage)},startWallMs:null,elapsedMs:0,frames:0,minIntervalMs:null,maxIntervalMs:0,over100ms:0,finalVisibleStep:null};(()=>{let start=null,previous=null;const watch=now=>{const t=window.cityManager.traffic(),paused=t?.paused??true,trace=window.__trafficBypassTrace;if(!paused&&start===null){start=now;trace.startWallMs=Date.now()}if(start!==null){trace.frames++;trace.elapsedMs=now-start;trace.finalVisibleStep=t?.step??null;if(previous!==null){const interval=now-previous;trace.minIntervalMs=trace.minIntervalMs===null?interval:Math.min(trace.minIntervalMs,interval);trace.maxIntervalMs=Math.max(trace.maxIntervalMs,interval);if(interval>100)trace.over100ms++}previous=now}if(t&&t.step>=20){if(!window.cityManager.parks().paused)document.querySelector('#pause').click();window.__trafficTwenty=true;}else requestAnimationFrame(watch)};requestAnimationFrame(watch)})()`);
 lastBypassTrace=null;await button('#pause');await until('({done:window.__trafficTwenty&&window.cityManager.parks().paused,trace:window.__trafficBypassTrace})',35000,result=>{lastBypassTrace=result.trace});await waitPausedModel();bypassTraces.push(lastBypassTrace);const t=(await diag()).traffic;assert.equal(t.step,20,'exactly twenty real-time game steps');return t;
}
async function runThreeDays(query){
 setStage(`three-day economy replay ${query}`);await navigate(economyRaw,query);const start=JSON.parse(economyCityRaw).tick;
 await evaluate(`window.__trafficGameStop=false;(()=>{const watch=()=>{if(JSON.parse(window.cityManager.snapshot()).tick>=${start+3}){if(!window.cityManager.parks().paused)document.querySelector('#pause').click();window.__trafficGameStop=true;}else requestAnimationFrame(watch)};requestAnimationFrame(watch)})()`);
 await button('#pause');await until('window.__trafficGameStop&&window.cityManager.parks().paused');
 const result=await evaluate('window.cityManager.snapshot()');assert.equal(result,serialize(expectedEconomy),'Actual three-day economy equals pure replay');return result;
}
setStage('browser launch');
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
 let d;
 if(testPlan.core){
 // Fresh profile has no explicit preference; this must be the *new* game model,
 // not the old assignment fleet. Its workload is a bounded visual allocation.
 setStage('fresh launch and default/opt-in');d=await navigate(economyRaw);if(!expectDefault){assert.equal(d.traffic,null,'pre-release default is off');d=await navigate(economyRaw,'?traffic=1');}
 await waitModel();d=await diag();assert.equal(d.traffic.mode,'allocation-game');assert.equal(d.traffic.paused,true);assert.ok(d.traffic.roads>0);assert.ok(d.decorative.trucks>0&&d.decorative.plumes>0);assert.equal(d.decorative.cars,0);assert.equal(await evaluate("localStorage.getItem('citymanager.traffic')"),expectDefault?null:'1');
 const initialCity=await evaluate('window.cityManager.snapshot()');assert.equal(initialCity,economyCityRaw);checks.push(expectDefault?'Fresh no-query launch uses default allocation game with delivery trucks/factory smoke':'Pre-release default OFF; explicit ON uses allocation game with delivery trucks/factory smoke');
 setStage('desktop activation and pause');await button('#pause');await until('window.cityManager.traffic()?.moving>0 && window.cityManager.traffic()?.cars>0 && window.cityManager.traffic()?.step>0',30000);d=await diag();assert.ok(d.traffic.demandRate>0);await screenshot('desktop-traffic-game.png');
 await button('#pause');await waitPausedModel();const paused=await diag(),pausedCity=await evaluate('window.cityManager.snapshot()');await sleep(600);const afterPause=await diag();for(const key of ['step','waiting','moving','completed','dropped','cancelled'])assert.equal(afterPause.traffic[key],paused.traffic[key],`Paused ${key} must not advance`);assert.equal(await evaluate('window.cityManager.snapshot()'),pausedCity);checks.push('Game creates real rendered representative cars; pause freezes model and city');
 // Persist the ordinary city and park session only: game counters are ephemeral.
 setStage('save and load');const oldEpoch=paused.traffic.worker.epoch;await gameMenu();await button('#save');await until("window.__trafficWrites.some(x=>x.method==='setItem'&&x.key==='citymanager.save.v7')");const saved=await evaluate("localStorage.getItem('citymanager.save.v7')");const savedDoc=JSON.parse(saved);assert.equal(savedDoc.trafficRuntime,undefined);assert.equal(savedDoc.trafficGame,undefined);assert.deepEqual(deserializeParkSession(saved).city,deserialize(pausedCity));assert.deepEqual(JSON.parse(saved),JSON.parse(await evaluate('window.cityManager.sessionSnapshot()')));
 await button('#load');await until(`window.cityManager.parks().paused&&window.cityManager.traffic()?.worker?.epoch!==${JSON.stringify(oldEpoch)}`);await waitModel();assert.equal((await diag()).traffic.step,0,'Accepted load starts a fresh ephemeral game');assert.equal(await evaluate('window.cityManager.snapshot()'),pausedCity);checks.push('Save/load preserves city and journals, stores no game sidecar, and resets the ephemeral epoch');
 // Test the actual game-menu control as well as URL preferences.
 setStage('toggle and persistent preference');await button('#traffic-game-toggle');await until('window.cityManager.traffic()===null');assert.equal(await evaluate("localStorage.getItem('citymanager.traffic')"),'0');assert.equal(await evaluate("document.querySelector('#traffic-game-toggle').getAttribute('aria-pressed')"),'false');
 await button('#traffic-game-toggle');await waitModel();assert.equal(await evaluate("localStorage.getItem('citymanager.traffic')"),'1');checks.push('Game-menu toggle switches the model and records both explicit OFF and ON');
 // OFF is a durable explicit preference; no-query reload must stay off. Re-enable
 // and compare deterministic economy replay to OFF, not just visual appearance.
 d=await navigate(economyRaw,'?traffic=0');assert.equal(d.traffic,null);assert.equal(await evaluate("localStorage.getItem('citymanager.traffic')"),'0');assert.equal((await navigate(economyRaw)).traffic,null);
 assert.equal(await runThreeDays('?traffic=1'),await runThreeDays('?traffic=0'));checks.push('Explicit OFF survives reload; ON and OFF play identical three-day city/economy replay');
 // Paused road construction must update the actual model snapshot without
 // advancing its game clock or changing anything beyond ordinary road costs.
 setStage('paused road construction');d=await navigate(roadRaw,'?traffic=1');await waitModel();const beforeRoad=(await diag()).traffic;assert.equal(beforeRoad.roads,road.cells.filter(c=>c.road).length);await button('[data-tool="road"]');await tapCell(cell(5,13));await tapCell(cell(10,13));await until(`window.cityManager.traffic()?.roads===${roadExpected.cells.filter(c=>c.road).length}`);await waitPausedModel();d=await diag();assert.equal(d.traffic.step,beforeRoad.step);assert.equal(await evaluate('window.cityManager.snapshot()'),serialize(roadExpected));checks.push('Real road tool updates paused game topology while preserving ordinary construction accounting');
 }
 if(testPlan.extended){
 // Real player input builds a connected bypass. One game minute/second keeps
 // the economic city day unchanged while each road game runs ten real seconds.
 setStage('bypass baseline ten steps');await navigate(bypassRaw,'?traffic=1');await waitModel();const beforeBypass=await gameTwentySteps();assert.equal(beforeBypass.completed,baselineTwenty.completed);
 setStage('construct bypass and ten steps');await navigate(bypassRaw,'?traffic=1');await waitModel();await button('[data-tool="road"]');for(const [a,b] of [[296,320],[320,323],[323,275]]){await tapCell(a);await tapCell(b);}await until(`window.cityManager.traffic()?.roads===${bypassExpected.cells.filter(c=>c.road).length}`);await waitPausedModel();
 assert.equal(await evaluate('window.cityManager.snapshot()'),serialize(bypassExpected),'Real bypass construction matches validated economic commands');
 const afterBypass=await gameTwentySteps();assert.equal(afterBypass.completed,bypassTwenty.completed);assert.ok(afterBypass.completed>beforeBypass.completed);checks.push('Real player-built connected bypass increases modeled throughput at the same twenty-step workload');
 // A valid, reconciled synthetic population fixture checks density and mobile
 // rendering. It is not claimed to be a natural-growth or real-device benchmark.
 // Paired runs start from the same validated city and use citizen-view speed,
 // so the economic City remains byte-identical during each short measurement.
 // OFF keeps decorative cars; ON replaces them with representative game cars.
 await viewport(true);let offBefore=null,offRaf=null,offAfter=null;
 {setStage('mobile dense OFF baseline');d=await navigate(denseRaw,'?traffic=0',blocked);assert.equal(d.traffic,null);await citizenSpeed();assert.equal(await evaluate('window.cityManager.snapshot()'),serialize(dense));await button('#pause');await sleep(1250);
  offBefore=await diag();{const sample=await (blocked?fallbackRaf():mobileRaf());offRaf={...summarizeRaf(sample),...(blocked?{elapsedMs:sample.elapsedMs,trailingMs:sample.trailingMs,intervalsMs:sample.intervals,longTaskDurationsMs:sample.longTasks}:{})};}offAfter=await diag();assert.equal(await evaluate('window.cityManager.snapshot()'),serialize(dense));if(blocked)await assertProtectedSaveUnchanged(denseRaw);await button('#pause');await until('window.cityManager.parks().paused');if(blocked)await verifyControlledAutosave(denseRaw,'OFF');}

 setStage('mobile dense ON setup');d=await navigate(denseRaw,'?traffic=1',blocked);await waitModel();d=await diag();assert.ok(d.traffic.demandRate>0);assert.equal(d.traffic.roads,dense.cells.filter(c=>c.road).length);assert.equal(d.traffic.failure,null);await button('#toggle-inspector');await until('document.querySelector("#inspector").dataset.page==="city"');await evaluate("document.querySelector('#traffic-game-status').scrollIntoView({block:'nearest'})");await paints();const statusLayout=await evaluate(`(()=>{const e=document.querySelector('#traffic-game-status'),r=e.getBoundingClientRect();return {text:e.innerText,hidden:e.hidden,x:r.x,right:r.right,width:r.width,screen:innerWidth}})()`);assert.equal(statusLayout.hidden,false);assert.ok(/จำลอง/.test(statusLayout.text)&&/ไม่ใช่/.test(statusLayout.text),'UI explicitly identifies the allocation as simulated, not real trips');assert.ok(/64/.test(statusLayout.text)&&/128/.test(statusLayout.text),'UI discloses the representative visual/model caps');assert.ok(/บางช่วงถนน/.test(statusLayout.text)&&/แม้แบบจำลองมีรถอยู่/.test(statusLayout.text),'UI discloses that modeled traffic may not be drawn on every road');assert.ok(statusLayout.width>0&&statusLayout.x>=0&&statusLayout.right<=statusLayout.screen+1,JSON.stringify(statusLayout));await screenshot('mobile-dense-game-paused.png');await button('#park-recreation button[data-speed]');await closeInspector();
 await button('#pause');await until('window.cityManager.traffic()?.step>=1&&window.cityManager.traffic()?.moving>0',30000);await screenshot('mobile-dense-game-moving.png');
 setStage('mobile dense ON paired frame measurement');const onBefore=await diag(),onSample=await (blocked?fallbackRaf():mobileRaf()),onRaf={...summarizeRaf(onSample),...(blocked?{elapsedMs:onSample.elapsedMs,trailingMs:onSample.trailingMs,intervalsMs:onSample.intervals,longTaskDurationsMs:onSample.longTasks}:{})},onAfter=await diag();assert.equal(await evaluate('window.cityManager.snapshot()'),serialize(dense));if(blocked)await assertProtectedSaveUnchanged(denseRaw);
 const fallbackAssessment=blocked?fallbackMetrics(offRaf,onRaf,onAfter.traffic?.timing):null;
 frameIntervals={paired:true,off:offRaf,on:onRaf,cityBytesEqual:true,offBefore,offAfter,onBefore,onAfter,worker:{before:onBefore.traffic?.worker??null,after:onAfter.traffic?.worker??null},gameTiming:{before:onBefore.traffic?.timing??null,after:onAfter.traffic?.timing??null},fallbackAssessment,note:blocked?'Paired 12 s visible OFF/ON sampling with single periodic autosave callback deferred until after strict no-write checks; native lifecycle handlers retained. Post-sample actual autosave persistence is verified separately. Poor/unknown status remains explicit; epoch maxima include startup. Worker round-trip includes queue, compute and message transfer after submit. Software renderer and browser emulation are not physical-device FPS certification.':'Same fixture and economic City at citizen-view speed; OFF uses decorative cars, ON uses allocation-game cars. Worker round-trip includes worker queue, compute and message transfer after submit, not time before submit. Browser emulation and broad thresholds do not establish smoothness or physical-device FPS.'};
 if(blocked)assert.deepEqual(fallbackAssessment.issues,[],JSON.stringify(fallbackAssessment));
 else assert.ok(onRaf.p95<100&&onRaf.max<1000,JSON.stringify(onRaf));
 assert.equal(onAfter.traffic.failure,null);
 await button('#pause');await waitPausedModel();if(blocked)await verifyControlledAutosave(denseRaw,'ON');checks.push(blocked?'Fallback paired 390px OFF/ON fixed-walltime browser intervals and worker/timing diagnostics captured':'Paired 390px OFF/ON browser frame intervals and worker/timing diagnostics captured on the same dense City; broad CI thresholds are not smoothness certification');
 // Preregistered fixed three-pair OFF→ON protocol: each condition starts
 // from a fresh copy of the same validated city, same camera and speed. Never
 // repeat, replace, or selectively discard any pair. One 240 s watchdog applies.
 if(!blocked){
  const peak=trafficGamePeakFixture(),peakCityRaw=serialize(peak),peakRaw=serializeParkSession(peak,createParkRuntime(peak));
  assert.equal(serialize(deserializeParkSession(peakRaw).city),peakCityRaw);
  const pairs=[];
  peakComparison={fixture:{population:2000,roads:490,buildings:peak.buildings.length},protocol:{pairCount:3,order:['OFF','ON'],frameIntervalsPerCondition:120,warmupDiscardedFrames:10,attainmentLimitMs:25000,retries:0,perPairOnP95StrictlyBelowMs:100,perPairRelativeFactor:1.25,perPairRelativeAllowanceMs:10,performanceRule:'ALL_PAIRS',median:'summary-only',modelActors:128,renderedActors:64},pairs,assessment:null,
   note:'Three fixed alternating pairs, same synthetic City bytes; OFF retains decorative cars, ON renders a representative 64-car sample of the real 128-actor model. Every pair must pass the original thresholds; medians are summary only. CI heuristics do not certify physical-device performance.'};
  console.log('Preregistered peak protocol:',JSON.stringify(peakComparison.protocol));
  for(let index=1;index<=3;index++){
   setStage(`mobile peak pair ${index} OFF baseline`);
   d=await navigate(peakRaw,'?traffic=0');assert.equal(d.traffic,null);await citizenSpeed();await button('#pause');await sleep(1250);
   const offBefore=await diag(),offSample=await mobileRaf(),off={...summarizeRaf(offSample),intervalsMs:offSample.intervals,longTaskDurationsMs:offSample.longTasks},offAfter=await diag();
   const offCityBytesEqual=await evaluate('window.cityManager.snapshot()')===peakCityRaw;
   const pair={index,off,on:null,offBefore,offAfter,onBefore:null,onAfter:null,offCityBytesEqual,onCityBytesEqual:null,cityBytesEqual:false,attainment:null};pairs.push(pair);
   await button('#pause');await until('window.cityManager.parks().paused');
   setStage(`mobile peak pair ${index} ON warmup`);
   d=await navigate(peakRaw,'?traffic=1');await waitModel();await citizenSpeed();await button('#pause');
   const attainment=await evaluate(`new Promise(resolve=>{const start=performance.now();let done=false;const finish=reason=>{if(done)return;done=true;clearTimeout(timer);const t=window.cityManager.traffic();resolve({reason,elapsedMs:performance.now()-start,step:t?.step??null,moving:t?.moving??null,cars:t?.cars??null})};const timer=setTimeout(()=>finish('observation-limit'),25000);const watch=()=>{if(done)return;const t=window.cityManager.traffic();if(t?.moving===128&&t?.cars===64)finish('near-cap');else requestAnimationFrame(watch)};requestAnimationFrame(watch)})`);
   setStage(`mobile peak pair ${index} ON frame measurement`);
   const onBefore=await diag(),onSample=await mobileRaf(),on={...summarizeRaf(onSample),intervalsMs:onSample.intervals,longTaskDurationsMs:onSample.longTasks},onAfter=await diag();
   const onCityBytesEqual=await evaluate('window.cityManager.snapshot()')===peakCityRaw;
   Object.assign(pair,{attainment,on,onBefore,onAfter,onCityBytesEqual,cityBytesEqual:offCityBytesEqual&&onCityBytesEqual});
   await button('#pause');await waitPausedModel();
  }
  peakComparison.assessment=peakTriplicateMetrics(pairs);
  assert.deepEqual(peakComparison.assessment.issues,[],JSON.stringify(peakComparison.assessment));
  checks.push('Normal browser fixed three-pair near-cap ON/OFF gate passed without injecting traffic actors');
 }
 }
 setStage('final evidence and assertions');assert.equal(checks.length,testPlan.expectedChecks,'All checks required for the selected case must run');assert.deepEqual(errors,[]);assert.deepEqual(externalRequests,[]);if(blocked)assert.ok(expectedErrors.length>=41);
 const report={fallbackAutosaveSchedule,controlledAutosaveChecks,browser:await send('Browser.getVersion'),blockedModels:blocked,softwareWebGL:software,testCase:testPlan.name,evidenceCase,recoveryStorageMode,expectDefault,fixtures:{economy:{day:economyCity.tick,trucks:plan.trucks.length,smoke:plan.smoke.length},dense:{population:dense.households.reduce((n,h)=>n+h.members,0),buildings:dense.buildings.length}},checks,stages,errors,externalRequests,screenshots,frameIntervals,peakComparison,bypassTraces,note:'Installed Edge desktop/mobile emulation; not physical Android, FPS certification or live-site acceptance. Core/full traffic fixtures use explicitly denied recovery IndexedDB; this does not fix or certify native-IDB startup performance. Extended retains native-observed IDB; save-safety/UX CI separately tests real IndexedDB.'};
 await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}catch(error){const failure={error:String(error),fallbackAutosaveSchedule,lastSaveTrace,controlledAutosaveChecks,stage,stageElapsedMs:Date.now()-stageAt,totalElapsedMs:Date.now()-runStarted,testCase:testPlan.name,evidenceCase,recoveryStorageMode,stages,errors,externalRequests,frameIntervals,peakComparison,bypassTraces,lastBypassTrace};try{await writeFile(resolve(output,'failure.json'),JSON.stringify(failure,null,2));}catch{}try{await screenshot('failure.png');await writeFile(resolve(output,'failure.json'),JSON.stringify({...failure,state:await diag(),page:await evaluate('({url:location.href,text:document.body.innerText.slice(-3000),idb:window.__recoveryIdb})')},null,2));}catch{}throw error;}
finally{clearTimeout(watchdog);if(ws?.readyState===1){try{await send('Browser.close');}catch{}ws.close();}child.kill();}
