// Run after npm run build and npm run preview -- --port 4195.
// Real compiled Worker, isolated real-service fixture, native clocks and controls.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {busCommuteBrowserFixture} from './bus-commute-browser-fixture.ts';
import {startTrafficHttpFixture,installTrafficNetworkFence,reachTrafficControl} from './traffic-server-entry-fixture.mjs';
const fixture=busCommuteBrowserFixture();
if(process.argv.includes('--preflight')){console.log(JSON.stringify({population:fixture.population,buses:fixture.buses,home:fixture.home,work:fixture.work,rawBytes:Buffer.byteLength(fixture.raw)}));process.exit(0);}
const output='.test-output/bus-commute-browser';await mkdir(output,{recursive:true});
const http=await startTrafficHttpFixture(process.env.CITYMANAGER_URL||'http://127.0.0.1:4195/CityManager/'),origin=new URL(http.url).origin;
await http.fixture.seed(fixture.raw);
const profile=await mkdtemp(join(tmpdir(),'bus-commute-browser-')),port=9378;
const child=spawn(process.env.CITYMANAGER_BROWSER||(process.platform==='win32'?'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe':'/usr/bin/chromium'),['--headless=new','--no-sandbox','--no-first-run','--disable-background-networking','--disable-extensions','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader',`--remote-debugging-port=${port}`,`--user-data-dir=${profile}`,'about:blank'],{stdio:['ignore','ignore','pipe']});
let launchError=null;child.on('error',e=>{launchError=String(e);});child.stderr.on('data',b=>{launchError=((launchError??'')+String(b)).slice(-4000);});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let ws,seq=0,probe;const pending=new Map(),errors=[],external=[];
function send(method,params={}){return new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
async function until(expression,ms=30000){const t=Date.now();while(Date.now()-t<ms){const r=await evaluate(expression);if(r)return r;await sleep(100);}throw Error('Timeout: '+expression);}
async function button(selector){
 if(await reachTrafficControl(evaluate,button,selector))return;
 await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest',inline:'nearest'})`);
 await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
 const p=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height,disabled:e.disabled}})()`);
 assert.ok(p.w&&p.h&&!p.disabled,`Visible enabled ${selector}`);
 assert.equal(await evaluate(`!!document.elementFromPoint(${p.x},${p.y})?.closest(${JSON.stringify(selector)})`),true,`Actual hit ${selector}`);
 for(const type of ['mouseMoved','mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,x:p.x,y:p.y,button:type==='mouseMoved'?'none':'left',clickCount:1});
}
function observer(){
 window.__busRequests=[];window.__busFrames=[];const Native=window.Worker;
 window.Worker=new Proxy(Native,{construct(target,args,newTarget){const w=Reflect.construct(target,args,newTarget);if(String(args[0]).includes('game-worker-entry')){const post=w.postMessage;w.postMessage=function(m,...rest){if(m?.sample?.commutes)window.__busRequests.push({commutes:m.sample.commutes,advance:m.advance,paused:m.paused});return Reflect.apply(post,this,[m,...rest]);};w.addEventListener('message',e=>{if(e.data?.kind==='frame'){window.__busFrames.push({step:e.data.frame.step,bus:e.data.frame.bus});if(window.__busFrames.length>180)window.__busFrames.shift();}});}return w;}});
}
let evidence;const watchdog=setTimeout(()=>{child.kill();console.error('Bus browser timeout');process.exit(1);},240000);
try{
 let page;for(let i=0;i<100;i++){try{page=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(p=>p.type==='page');if(page)break;}catch{}await sleep(100);}assert.ok(page,'Chromium did not start: '+launchError);
 ws=new WebSocket(page.webSocketDebuggerUrl);ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}}else if(m.method==='Page.javascriptDialogOpening')void http.fixture.dialog(m.params,send).catch(error=>errors.push(String(error)));else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);else if(m.method==='Network.requestWillBeSent'){const u=m.params.request.url;if(probe?.active&&u===probe.url)probe.requestId=m.params.requestId;else if(/^https?:/.test(u)&&new URL(u).origin!==origin)external.push(u);}else if(m.method==='Network.loadingFailed'&&m.params.requestId===probe?.requestId)probe.failed=m.params;};
 await new Promise(r=>ws.onopen=r);for(const domain of ['Page','Network','Runtime'])await send(domain+'.enable');
 await installTrafficNetworkFence({send,evaluate,protocol:await(await fetch(`http://127.0.0.1:${port}/json/protocol`)).json(),origin,observeProbe:url=>(probe={url})});
 await http.fixture.install(send);await send('Emulation.setDeviceMetricsOverride',{width:1024,height:640,deviceScaleFactor:1,mobile:false});
 await send('Page.addScriptToEvaluateOnNewDocument',{source:`(${observer})();localStorage.setItem('citymanager.visual.v1',JSON.stringify({timeMode:'noon',quality:'low',rain:false,seasons:false,traffic:true,mapInfo:false}));`});
 await send('Page.navigate',{url:http.url+'?traffic=1&bus=1'});await http.fixture.enter({evaluate,button});
 await until('window.cityManager.traffic()?.ready');assert.equal(await evaluate('window.cityManager.parks().paused'),true);
 // Existing infrastructure must remain visible and unchanged when live traffic is disabled.
 const baseline=await evaluate('window.cityManager.snapshot()');
 const expectedStops=fixture.stops,expectedDepots=fixture.depots;
 await until(`(()=>{const b=window.cityManager.bus();return b&&b.poles+b.shelters===${expectedStops}&&b.depots===${expectedDepots}})()`);
 assert.equal(await evaluate(`(()=>{const e=document.querySelector('#bus-tool'),r=e.getBoundingClientRect();return !e.hidden&&r.width>0&&r.height>0})()`),true,'Bus tool remains available');
 await button('#toggle-game-menu');await button('#traffic-game-toggle');
 await until(`(()=>{const b=window.cityManager.bus();return window.cityManager.traffic()===null&&b&&b.poles+b.shelters===${expectedStops}&&b.depots===${expectedDepots}&&b.buses===0})()`);
 assert.equal(await evaluate('window.cityManager.snapshot()'),baseline,'Traffic off does not change the city');
 const offShot=await send('Page.captureScreenshot',{format:'png'});await writeFile(output+'/traffic-off-stops.png',Buffer.from(offShot.data,'base64'));
 // Reload the synthetic server-backed city with traffic explicitly disabled.
 await http.fixture.assertNoCityWrites(evaluate);const outgoing=await evaluate('window.cityManager.sessionSnapshot()');
 http.fixture.allowNavigation(outgoing);await send('Page.navigate',{url:http.url+'?traffic=0&bus=1'});await http.fixture.enter({evaluate,button});
 await until(`(()=>{const b=window.cityManager.bus();return window.cityManager.traffic()===null&&b&&b.poles+b.shelters===${expectedStops}&&b.depots===${expectedDepots}})()`);
 assert.equal(await evaluate('window.cityManager.snapshot()'),baseline,'Reload with traffic off preserves city');
 await button('#toggle-game-menu');await button('#traffic-game-toggle');await button('#close-inspector');await until('window.cityManager.traffic()?.ready');
 await until(`(()=>{const b=window.cityManager.bus();return b&&b.poles+b.shelters===${expectedStops}&&b.depots===${expectedDepots}})()`);
 assert.equal(await evaluate('window.cityManager.snapshot()'),baseline,'Traffic on does not change the city');
 await button('#toggle-inspector');await until('document.querySelector("#inspector").dataset.page==="city"');await button('#park-recreation button[data-speed]');await button('#close-inspector');
 await button('#pause');
 // A passenger can board immediately when the bus is already dwelling.
 // Observe actual admitted people, whether waiting, aboard, or already served.
 const admitted=await until('(()=>{const t=window.cityManager.traffic(),e=t.busLedger?.engine;return e&&e.waiting+e.onboard+e.completed>=1?{step:t.step,ledger:t.busLedger,buses:window.cityManager.busSnapshot()}:null})()',60000);
 assert.ok(await evaluate(`window.__busRequests.some(r=>r.commutes.some(c=>c.home===${fixture.home}&&c.work===${fixture.work}&&c.workers===4))`),'Real worker received actual employment OD');
 assert.ok(await evaluate(`window.__busFrames.some(f=>f.bus?.totals.some(t=>t.from===${fixture.homeRoad}&&t.to===${fixture.workRoad}&&t.total>0))`),'Real worker diverted far-employer commuters');
 await button('#pause');await until('!window.cityManager.traffic().worker.inflight&&!window.cityManager.traffic().worker.pending');
 await writeFile(output+'/admitted.json',JSON.stringify({admitted,external,errors},null,2));
 const admittedImage=await send('Page.captureScreenshot',{format:'png'});await writeFile(output+'/admitted.png',Buffer.from(admittedImage.data,'base64'));
 const before=await evaluate('({step:window.cityManager.traffic().step,ledger:window.cityManager.traffic().busLedger,buses:window.cityManager.busSnapshot(),minute:window.cityManager.traffic().busMinute})');await sleep(1500);assert.deepEqual(await evaluate('({step:window.cityManager.traffic().step,ledger:window.cityManager.traffic().busLedger,buses:window.cityManager.busSnapshot(),minute:window.cityManager.traffic().busMinute})'),before,'Native pause freezes worker and bus engine');
 await button('#pause');const boarded=await until('(()=>{const t=window.cityManager.traffic();return t.busLedger?.engine.onboard>=1||t.busLedger?.engine.completed>=1?{step:t.step,ledger:t.busLedger,buses:window.cityManager.busSnapshot()}:null})()',150000);
 await button('#pause');await until('!window.cityManager.traffic().worker.inflight&&!window.cityManager.traffic().worker.pending');
 const screenshot=await send('Page.captureScreenshot',{format:'png'});await writeFile(output+'/boarded.png',Buffer.from(screenshot.data,'base64'));
 assert.equal(boarded.ledger.engine.conservationError,0);assert.ok(Math.abs(boarded.ledger.splitError)<1e-8);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(http.errors,[]);await http.fixture.assertNoCityWrites(evaluate);
 // A deliberately disabled bus feature stays hidden and does not erase saved sites.
 const busSaved=JSON.parse(await evaluate('window.cityManager.snapshot()')).bus;
 const outgoingDisabled=await evaluate('window.cityManager.sessionSnapshot()');http.fixture.allowNavigation(outgoingDisabled);
 await send('Page.navigate',{url:http.url+'?traffic=0&bus=0'});await http.fixture.enter({evaluate,button});
 assert.equal(await evaluate('window.cityManager.bus()'),null);assert.equal(await evaluate("document.querySelector('#bus-tool').hidden"),true);
 assert.deepEqual(JSON.parse(await evaluate('window.cityManager.snapshot()')).bus,busSaved);
 await http.fixture.assertNoCityWrites(evaluate);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(http.errors,[]);
 evidence={population:fixture.population,buses:fixture.buses,home:fixture.home,work:fixture.work,admitted,pause:before,boarded,externalRequests:external,errors,server:http.fixture.evidence};await writeFile(output+'/evidence.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
}catch(error){const diagnostics=ws?.readyState===1?await evaluate('window.cityManager?{traffic:window.cityManager.traffic(),bus:window.cityManager.busSnapshot(),requests:window.__busRequests,frames:window.__busFrames}:null').catch(()=>null):null;await writeFile(output+'/failure.json',JSON.stringify({error:String(error),diagnostics,errors,external},null,2));if(ws?.readyState===1){const shot=await send('Page.captureScreenshot',{format:'png'}).catch(()=>null);if(shot)await writeFile(output+'/failure.png',Buffer.from(shot.data,'base64'));}throw error;}
finally{clearTimeout(watchdog);ws?.close();child.kill();await http.close();}
