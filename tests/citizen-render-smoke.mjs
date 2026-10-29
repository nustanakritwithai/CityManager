// Independent renderer fixture, not a claim of whole-city FPS or 2,000 active trips.
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
const port=9378,output=resolve('.test-output/citizen-render-evidence');await mkdir(output,{recursive:true});
let occupied=false;try{occupied=(await fetch(`http://127.0.0.1:${port}/json/version`,{signal:AbortSignal.timeout(500)})).ok;}catch{}
assert.equal(occupied,false,'Isolated renderer CDP port must be free');
const profile=await mkdtemp(join(tmpdir(),'city-citizen-render-'));
const browser=spawn(process.env.CITYMANAGER_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',['--headless=new','--no-first-run','--no-default-browser-check','--disable-extensions','--remote-debugging-address=127.0.0.1',`--remote-debugging-port=${port}`,`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore',windowsHide:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let ws,serial=0;const pending=new Map(),errors=[],network=[];
async function send(method,params={}){const id=++serial;const response=new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error(`Timeout ${method}`));},30000);pending.set(id,{resolve:r=>{clearTimeout(timer);resolve(r);},reject:e=>{clearTimeout(timer);reject(e);}});});ws.send(JSON.stringify({id,method,params}));return response;}
async function evaluate(expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
try{
 let page;for(let i=0;i<80;i++){try{const tabs=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();page=tabs.find(t=>t.type==='page'&&t.url==='about:blank');if(page)break;}catch{}await sleep(100);}
 assert.ok(page,'Isolated about:blank page target started; never attach extension background pages');ws=new WebSocket(page.webSocketDebuggerUrl);
 ws.onmessage=event=>{const r=JSON.parse(event.data);if(r.id){const p=pending.get(r.id);pending.delete(r.id);if(r.error)p?.reject(Error(JSON.stringify(r.error)));else p?.resolve(r.result);}else if(r.method==='Runtime.exceptionThrown')errors.push(r.params.exceptionDetails);else if(r.method==='Runtime.consoleAPICalled'&&r.params.type==='error')errors.push(r.params.args);else if(r.method==='Network.responseReceived')network.push({url:r.params.response.url,status:r.params.response.status,mimeType:r.params.response.mimeType});else if(r.method==='Network.loadingFailed')network.push(r.params);};
 await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});await send('Runtime.enable');await send('Page.enable');await send('Network.enable');
 await send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});
 const navigation=await send('Page.navigate',{url:'http://127.0.0.1:4189/tests/fixtures/citizen-render.html'});assert.equal(navigation.errorText,undefined,'Navigate the actual browser page');
 let ready=false;for(let i=0;i<200;i++){const state=await evaluate('({ready:!!window.citizenRendererQA,error:window.citizenRendererError})');if(state.error)throw Error(state.error);if(state.ready){ready=true;break;}await sleep(100);}
 if(!ready){const page=await evaluate('({url:location.href,title:document.title,html:document.documentElement.outerHTML.slice(0,4000)})');await writeFile(join(output,'startup-failure.json'),JSON.stringify({navigation,page,errors,network},null,2));const shot=await send('Page.captureScreenshot',{format:'png'});await writeFile(join(output,'startup-failure.png'),Buffer.from(shot.data,'base64'));throw Error('Renderer startup failed: '+JSON.stringify({navigation,page,errors,network}));}await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
 const initial=await evaluate('window.citizenRendererQA.snapshot()');assert.equal(initial.cars,2000);assert.equal(initial.drawBatches,6);assert.equal(initial.trianglesPerCar,24);assert.ok(initial.drawCalls>0&&initial.drawCalls<=8,JSON.stringify(initial));
 const times=await evaluate('new Promise(resolve=>{const a=[];let last;function sample(t){if(last!==undefined)a.push(t-last);last=t;if(a.length===120)resolve(a);else requestAnimationFrame(sample)}requestAnimationFrame(sample)})');
 const shot=await send('Page.captureScreenshot',{format:'png'});
 const colouredPixels=await evaluate(`(async()=>{const img=await createImageBitmap(await(await fetch('data:image/png;base64,${shot.data}')).blob());const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);const d=ctx.getImageData(0,100,c.width,c.height-100).data;let count=0;for(let i=0;i<d.length;i+=4){const r=d[i],g=d[i+1],b=d[i+2];if(r>70&&r>g*1.3&&r>b*1.2)count++;}return count;})()`);
 assert.ok(colouredPixels>100,`Rendered paint pixels missing: ${colouredPixels}`);
 await writeFile(join(output,'2000-instanced-cars.png'),Buffer.from(shot.data,'base64'));
 for(const count of [0,7,2000]){await evaluate(`window.citizenRendererQA.setCount(${count})`);await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');assert.equal((await evaluate('window.citizenRendererQA.snapshot()')).cars,count);}
 await evaluate('window.citizenRendererQA.setEnabled(false);window.citizenRendererQA.setEnabled(true)');assert.equal((await evaluate('window.citizenRendererQA.snapshot()')).cars,2000);
 assert.deepEqual(errors,[]);times.sort((a,b)=>a-b);const result={scope:'isolated renderer only; synthetic 2000 car poses, not whole-city traffic',...initial,medianFrameMs:times[60],p95FrameMs:times[114],maxFrameMs:times.at(-1)};
 await writeFile(join(output,'metrics.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 const cityNavigation=await send('Page.navigate',{url:'http://127.0.0.1:4189/tests/fixtures/citizen-city.html'});assert.equal(cityNavigation.errorText,undefined);
 let cityReady=false;
 for(let i=0;i<600;i++){const v=await evaluate('({ready:!!window.citizenCityQA&&window.citizenCityQA.snapshot().assetsReady,error:window.citizenCityError})');if(v.error)throw Error(v.error);if(v.ready){cityReady=true;break;}await sleep(100);}
 assert.ok(cityReady,'Real CityView and admitted assets initialized');
 const cityInitial=await evaluate('window.citizenCityQA.snapshot()');assert.equal(cityInitial.population,2000);assert.ok(cityInitial.commuters>0);assert.equal(cityInitial.oldDecorativeActors,0);
 assert.equal(await evaluate('window.citizenCityQA.roundTrip()'),true,'Mid-trip coupled city save is exact');
 const cityTimes=await evaluate('new Promise(resolve=>{const a=[];let last;window.citizenCityQA.start();function sample(t){if(last!==undefined)a.push(t-last);last=t;if(a.length===120){window.citizenCityQA.pause();resolve(a);}else requestAnimationFrame(sample)}requestAnimationFrame(sample)})');
 const cityAfter=await evaluate('window.citizenCityQA.snapshot()');assert.equal(cityAfter.population,2000);assert.equal(cityAfter.commuters,cityInitial.commuters);assert.equal(cityAfter.vehicles,cityInitial.vehicles);assert.equal(cityAfter.rendered,cityAfter.onRoad);assert.equal(cityAfter.unchangedEconomy,true);assert.equal(cityAfter.oldDecorativeActors,0);
 assert.equal(await evaluate('window.citizenCityQA.roundTrip()'),true,'Moving city saves and restores identically');
 const cityShot=await send('Page.captureScreenshot',{format:'png'});await writeFile(join(output,'2000-resident-city-traffic.png'),Buffer.from(cityShot.data,'base64'));
 cityTimes.sort((a,b)=>a-b);const cityResult={scope:'CityView synthetic funded 2000 resident fixture, low visual quality, 390x844 CI Edge; one game minute per rendered frame, not production pacing or physical phone',initial:cityInitial,after:cityAfter,medianFrameMs:cityTimes[60],p95FrameMs:cityTimes[114],maxFrameMs:cityTimes.at(-1)};
 assert.deepEqual(errors,[]);await writeFile(join(output,'city-metrics.json'),JSON.stringify(cityResult,null,2));console.log(JSON.stringify(cityResult));

}finally{ws?.close();browser.kill();}
