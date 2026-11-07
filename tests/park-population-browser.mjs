// Run after npm run build and npm run preview -- --port 4196.
// Real compiled Worker, isolated real-service fixture, native clocks and controls.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parkPopulationFixture} from './park-population-fixture.ts';
import {createParkRuntime,advanceParkRuntime,serializeParkSession,deserializeParkSession} from '../src/park-runtime.ts';
import {serialize,step,summary} from '../src/sim.ts';
import {panelEntryCity,saveAndReloadPanel} from './panel-ui-server.mjs';
import {startTrafficHttpFixture,installTrafficNetworkFence,reachTrafficControl} from './traffic-server-entry-fixture.mjs';
const city=parkPopulationFixture(),runtime=createParkRuntime(city);advanceParkRuntime(city,runtime,610,()=>step(city));
const fixture={raw:serializeParkSession(city,runtime),population:summary(city).population,minute:runtime.recreation.minute};
if(process.argv.includes('--preflight')){console.log(JSON.stringify({population:fixture.population,minute:fixture.minute,rawBytes:Buffer.byteLength(fixture.raw)}));process.exit(0);}
const output='.test-output/park-population-browser';await mkdir(output,{recursive:true});
const http=await startTrafficHttpFixture(process.env.CITYMANAGER_URL||'http://127.0.0.1:4196/CityManager/'),origin=new URL(http.url).origin;
await http.fixture.seed(fixture.raw);
const profile=await mkdtemp(join(tmpdir(),'park-population-browser-')),port=9379;
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
const watchdog=setTimeout(()=>{child.kill();console.error('Large population browser timeout');process.exit(1);},180000);
try{
 let page;for(let i=0;i<100;i++){try{page=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(p=>p.type==='page');if(page)break;}catch{}await sleep(100);}assert.ok(page,'Chromium did not start: '+launchError);
 ws=new WebSocket(page.webSocketDebuggerUrl);ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}}else if(m.method==='Page.javascriptDialogOpening')void http.fixture.dialog(m.params,send).catch(error=>errors.push(String(error)));else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);else if(m.method==='Network.requestWillBeSent'){const u=m.params.request.url;if(probe?.active&&u===probe.url)probe.requestId=m.params.requestId;else if(/^https?:/.test(u)&&new URL(u).origin!==origin)external.push(u);}else if(m.method==='Network.loadingFailed'&&m.params.requestId===probe?.requestId)probe.failed=m.params;};
 await new Promise(r=>ws.onopen=r);for(const domain of ['Page','Network','Runtime'])await send(domain+'.enable');
 await installTrafficNetworkFence({send,evaluate,protocol:await(await fetch(`http://127.0.0.1:${port}/json/protocol`)).json(),origin,observeProbe:url=>(probe={url})});
 await http.fixture.install(send);await send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});
 await send('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('citymanager.visual.v1',JSON.stringify({timeMode:'noon',quality:'low',rain:false,seasons:false,traffic:true,mapInfo:false}));`});
 await send('Page.navigate',{url:http.url});await http.fixture.enter({evaluate,button});
 assert.equal(await evaluate('window.cityManager.parks().paused'),true);
 const initial=deserializeParkSession(await evaluate('window.cityManager.sessionSnapshot()'));
 assert.equal(summary(initial.city).population,4098);
 assert.equal(serialize(initial.city),serialize(panelEntryCity(fixture.raw)));
 await button('#toggle-inspector');await until('document.querySelector("#inspector").dataset.page==="city"');
 await button('#park-recreation button[data-speed]');await button('#close-inspector');await button('#pause');
 await until(`window.cityManager.parks().recreation.minute>=${fixture.minute+5}`,30000);await button('#pause');
 const pausedRaw=await evaluate('window.cityManager.sessionSnapshot()'),paused=deserializeParkSession(pausedRaw);
 assert.equal(serialize(paused.city),serialize(initial.city),'Five real recreation minutes never step the economy');
 assert.ok(paused.runtime.recreation.minute>=fixture.minute+5);
 const earned=Object.values(paused.runtime.recreation.citizens).reduce((n,c)=>n+c.earnedMinutes,0);
 const initialEarned=Object.values(initial.runtime.recreation.citizens).reduce((n,c)=>n+c.earnedMinutes,0);
 assert.ok(earned>initialEarned,'Actual visitors continue earning benefit above 2048 residents');
 await sleep(750);assert.equal(await evaluate('window.cityManager.sessionSnapshot()'),pausedRaw,'Native pause freezes all saved state');
 await send('Emulation.setDeviceMetricsOverride',{width:412,height:915,deviceScaleFactor:1,mobile:true});
 await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
 assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true,'Mobile-emulated viewport has no page overflow');
 await button('#toggle-inspector');await until('document.querySelector("#inspector").dataset.page==="city"');
 const screenshot=await send('Page.captureScreenshot',{format:'png'});await writeFile(output+'/population-4098.png',Buffer.from(screenshot.data,'base64'));
 await button('#close-inspector');await button('#toggle-game-menu');
 const saved=await saveAndReloadPanel(http.fixture,paused.city,{send,evaluate,button,until});
 assert.equal(saved.raw,pausedRaw,'Native save and server ACK retain exact complete session');
 assert.equal(await evaluate('window.cityManager.sessionSnapshot()'),pausedRaw,'Reload preserves every park clock and earned record');
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(http.errors,[]);await http.fixture.assertNoCityWrites(evaluate);
 const evidence={population:4098,initialMinute:fixture.minute,finalMinute:paused.runtime.recreation.minute,initialEarned,earned,rawBytes:Buffer.byteLength(saved.raw),exactSaveAndReload:true,nativePause:true,mobileEmulated:true,physicalDeviceTest:false,externalRequests:external,errors,server:http.fixture.evidence};
 await writeFile(output+'/evidence.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
}catch(error){const diagnostics=ws?.readyState===1?await evaluate('window.cityManager?{parks:window.cityManager.parks(),body:document.body.innerText.slice(0,2000)}:null').catch(()=>null):null;await writeFile(output+'/failure.json',JSON.stringify({error:String(error),diagnostics,errors,external},null,2));throw error;}
finally{clearTimeout(watchdog);ws?.close();child.kill();await http.close();}
