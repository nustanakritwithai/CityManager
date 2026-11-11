// Actual production UI and server-acknowledged session only; no synthetic rail state injection.
import assert from 'node:assert/strict';
export async function railBrowserChecks({send,evaluate,capture,acknowledge,reload}){
 const checks=[],sleep=ms=>new Promise(r=>setTimeout(r,ms));let touchMode=false;
 const paints=()=>evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
 const until=async(fn,label)=>{const start=Date.now();while(Date.now()-start<15000){if(await fn())return;await sleep(80);}throw Error(`Rail UI timeout: ${label}`);};
 const tapPoint=async({x,y})=>{assert(Number.isFinite(x)&&Number.isFinite(y));if(touchMode){await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});return;}await send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1});};
 const tap=async selector=>{
  // Phone tools live in the real horizontally scrolling dock. Bring the chosen
  // control into view, then require a real hit target before native input.
  await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled||!e.getClientRects().length)throw Error('Rail control unavailable');e.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});})()`);await paints();
  const p=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return{x,y,hit:e.contains(document.elementFromPoint(x,y))}})()`);assert.ok(p.hit,`Rail control must be visible and hit-testable: ${selector}`);await tapPoint(p);
 };
 const cell=async i=>{await paints();const p=await evaluate(`(()=>{const p=window.cityManager.cellScreen(${i}),r=document.querySelector('#city-canvas').getBoundingClientRect();return{x:p.x+r.left,y:p.y+r.top}})()`);assert.equal(await evaluate(`document.elementFromPoint(${p.x},${p.y})?.id`),'city-canvas','Rail target must be visible on the actual canvas');await tapPoint(p);};
 const menu=async action=>{await tap('#rail-tool');await tap(`[data-rail-action="${action}"]`);};
 const confirm=async()=>{await until(()=>evaluate("!!document.querySelector('#rail-management-confirm[open]')"),'confirmation');await tap('#rail-confirm-accept');await until(()=>evaluate("!document.querySelector('#rail-management-confirm[open]')"),'confirmation close');};
 const rail=()=>evaluate('window.cityManager.rail()');
 assert.ok(await evaluate('window.cityManager.traffic()'),'Rail intake requires the traffic model to be enabled');
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 if(!await evaluate('window.cityManager.parks().paused'))await tap('#pause');
 assert.equal(await evaluate('window.cityManager.parks().paused'),true);
 const before=JSON.parse(await evaluate('window.cityManager.sessionSnapshot()'));
 assert.equal(before.version,27,'Loading the legacy fixture does not activate happiness before gameplay');
 assert.equal((await rail()).snapshot,null,'Seed does not prebuild rail');
 for(const i of[315,317,339,341])assert.deepEqual(before.cells[i],{road:false,zone:null,building:null},'Recorded synthetic fixture route is actually empty');
 // Use real confirmation gestures and the current camera projection, not dispatching application callbacks.
 for(const i of[315,317]){await menu('station');await cell(i);await confirm();}
 assert.deepEqual((await rail()).snapshot.stations.map(s=>s.cell),[315,317]);
 for(const[a,b]of[[315,339],[339,341],[341,317]]){await menu('add-track');await cell(a);await cell(b);await confirm();}

 const built=(await rail()).snapshot;
 await menu('remove-track');await cell(339);await cell(341);
 await until(()=>evaluate("!!document.querySelector('#rail-management-confirm[open]')"),'multi-cell removal confirmation');
 assert.match(await evaluate("document.querySelector('.rail-confirm-detail').textContent"),/2 ช่วง/);
 await capture('rail-remove-desktop-confirm');await tap('#rail-confirm-cancel');assert.deepEqual((await rail()).snapshot,built,'Cancelled removal changes nothing');
 await cell(339);await cell(341);await confirm();
 assert.equal((await rail()).snapshot.graph.links.length,4,'Whole straight run is removed in both directions');assert.deepEqual((await rail()).snapshot.stations,built.stations,'Removal retains both stations');
 const removedSave=await acknowledge();await reload();assert.deepEqual((await rail()).snapshot,removedSave.parkRuntime.rail.network,'Removed run stays removed after authoritative server ACK/reload');
 await capture('rail-remove-desktop-reloaded');
 await menu('add-track');await cell(339);await cell(341);await confirm();
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,screenWidth:390,screenHeight:844,deviceScaleFactor:1,mobile:true});await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:2});touchMode=true;await paints();
 // Ordinary demolition is discoverable from the select tool on a touch-sized viewport.
 await tap('[data-tool="select"]');await tap('[data-tool="bulldoze"]');
 const mobileBefore=(await rail()).snapshot;await cell(340);await until(()=>evaluate("!!document.querySelector('#rail-management-confirm[open]')"),'touch demolition confirmation');
 await capture('rail-remove-mobile-confirm');await tap('#rail-confirm-cancel');assert.deepEqual((await rail()).snapshot,mobileBefore);
 await cell(340);await confirm();let removed=(await rail()).snapshot;
 assert.equal(removed.graph.links.length,4);assert.equal(removed.graph.links.some(l=>l.from===340||l.to===340),false);assert.deepEqual(removed.stations,built.stations);
 const touchSave=await acknowledge();await reload();assert.deepEqual((await rail()).snapshot,touchSave.parkRuntime.rail.network);await capture('rail-remove-mobile-reloaded');
 await menu('add-track');await cell(341);await cell(339);await confirm();
 // Selecting a track also exposes a direct, confirmed removal action.
 await tap('[data-tool="select"]');await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape'});
 await cell(340);await tap('[data-rail-remove="340"]');await confirm();assert.equal((await rail()).snapshot.graph.links.some(l=>l.from===340||l.to===340),false);
 await menu('add-track');await cell(341);await cell(339);await confirm();
 assert.deepEqual((await rail()).snapshot.graph.links,built.graph.links);
 await send('Emulation.setTouchEmulationEnabled',{enabled:false});touchMode=false;await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,screenWidth:1440,screenHeight:1000,deviceScaleFactor:1,mobile:false});await paints();
 checks.push('Desktop multi-cell cancellation/removal and touch demolition/place-card removal retain stations, untouched tracks and exact server ACK/reload state');
 await menu('manage');await tap('#rail-configure-service');await confirm();
 const note=await evaluate('document.querySelector(".rail-management-note").textContent');
 assert.match(note,/ความต้องการเดินทางในแบบจำลองจราจร/);assert.match(note,/ไม่ใช่ประชาชนรายบุคคล/);assert.match(note,/ต้องเปิดแบบจำลองจราจร/);
 let state=await rail();assert.ok(state.snapshot.service);assert.equal(state.snapshot.service.config.seats,32);assert.equal(state.trains,1);assert.equal(state.trackMeshInstances,3);
 const after=JSON.parse(await evaluate('window.cityManager.sessionSnapshot()'));assert.deepEqual(after.accounts,before.accounts,'Rail construction/configuration introduces no fare, charge or money');assert.deepEqual(after.cells,before.cells,'Rail does not rewrite road/building allocation');
 checks.push('Native station, atomic track and service confirmation; real scene with three batched track meshes; no cash or road mutation');
 await capture('rail-built');
 const pose=state.trainPosition;assert.ok(pose&&['x','y','z'].every(k=>Number.isFinite(pose[k])),'Actual rendered train pose is exposed read-only');
 await tap('[data-speed="1"]');await tap('#pause');
 await until(async()=>{const s=await rail();return s.snapshot.model.offeredPersons>0&&s.snapshot.service.snapshot.train.destination!==null&&JSON.stringify(s.trainPosition)!==JSON.stringify(pose);},'actual train movement with accepted traffic-model demand');
 await tap('#pause');assert.equal(await evaluate('window.cityManager.parks().paused'),true);
 state=await rail();const paused=structuredClone(state);await sleep(250);const stable=await rail();assert.deepEqual(stable.snapshot,paused.snapshot,'Game pause freezes authoritative rail minute and passengers');assert.deepEqual(stable.trainPosition,paused.trainPosition,'Game pause freezes rendered train');
 assert.ok(state.snapshot.model.offeredPersons>0);assert.ok(state.snapshot.service.snapshot.batches.length<=32);
 checks.push('Enabled traffic model supplies bounded accepted rider queues, not individual citizen journeys; normal game clock moves the train, and pause freezes both');
 await capture('rail-moving-paused');
 const occupied=(await rail()).snapshot;await menu('remove-track');await cell(339);await cell(341);await confirm();
 assert.deepEqual((await rail()).snapshot,occupied,'Occupied removal preserves every passenger and link');
 assert.match(await evaluate("document.querySelector('#status').textContent"),/หยุดรับผู้โดยสารใหม่/,'Blocked removal explains how to drain safely');

 await menu('manage');await tap('#rail-service-toggle');assert.equal((await rail()).snapshot.service.snapshot.enabled,false);await tap('#rail-management [aria-label="ปิดหน้าจัดการรถไฟ"]');
 const saved=await acknowledge();const savedRail=saved.parkRuntime.rail;assert.ok(savedRail);assert.equal(saved.version,28,'Normal gameplay activates the v28 happiness save envelope');assert.equal(saved.mapBaseVersion,before.mapBaseVersion);
 await reload();const restored=JSON.parse(await evaluate('window.cityManager.sessionSnapshot()'));assert.deepEqual(restored.parkRuntime.rail,savedRail,'Actual server ACK restores rail service, train, queues and modeled counters exactly');assert.equal((await rail()).trains,1);
 await capture('rail-restored');checks.push('Service paused through UI, complete rail session ACKed and reloaded exactly from isolated server');
 return{status:'passed',checks,stations:savedRail.network.stations,offeredPersons:savedRail.network.model.offeredPersons};
}
