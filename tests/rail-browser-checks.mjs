// Actual production UI and server-acknowledged session only; no synthetic rail state injection.
import assert from 'node:assert/strict';
export async function railBrowserChecks({send,evaluate,capture,acknowledge,reload}){
 const checks=[],sleep=ms=>new Promise(r=>setTimeout(r,ms));
 const until=async(fn,label)=>{const start=Date.now();while(Date.now()-start<15000){if(await fn())return;await sleep(80);}throw Error(`Rail UI timeout: ${label}`);};
 const tapPoint=async({x,y})=>{assert(Number.isFinite(x)&&Number.isFinite(y));await send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1});};
 const tap=async selector=>{const p=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled||!e.getClientRects().length)throw Error('Rail control unavailable');const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);await tapPoint(p);};
 const cell=async i=>{const p=await evaluate(`(()=>{const p=window.cityManager.cellScreen(${i}),r=document.querySelector('#city-canvas').getBoundingClientRect();return{x:p.x+r.left,y:p.y+r.top}})()`);await tapPoint(p);};
 const menu=async action=>{await tap('#rail-tool');await tap(`[data-rail-action="${action}"]`);};
 const confirm=async()=>{await until(()=>evaluate("!!document.querySelector('#rail-management-confirm[open]')"),'confirmation');await tap('#rail-confirm-accept');await until(()=>evaluate("!document.querySelector('#rail-management-confirm[open]')"),'confirmation close');};
 const rail=()=>evaluate('window.cityManager.rail()');
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 if(!await evaluate('window.cityManager.parks().paused'))await tap('#pause');
 assert.equal(await evaluate('window.cityManager.parks().paused'),true);
 const before=JSON.parse(await evaluate('window.cityManager.sessionSnapshot()'));
 assert.equal((await rail()).snapshot,null,'Seed does not prebuild rail');
 for(const i of[315,312,339,336])assert.deepEqual(before.cells[i],{road:false,zone:null,building:null},'Recorded synthetic fixture route is actually empty');
 // Use real confirmation gestures and the current camera projection, not dispatching application callbacks.
 for(const i of[315,312]){await menu('station');await cell(i);await confirm();}
 assert.deepEqual((await rail()).snapshot.stations.map(s=>s.cell),[315,312]);
 for(const[a,b]of[[315,339],[339,336],[336,312]]){await menu('add-track');await cell(a);await cell(b);await confirm();}
 await menu('manage');await tap('#rail-configure-service');await confirm();
 let state=await rail();assert.ok(state.snapshot.service);assert.equal(state.snapshot.service.config.seats,32);assert.equal(state.trains,1);assert.equal(state.trackMeshInstances,3);
 const after=JSON.parse(await evaluate('window.cityManager.sessionSnapshot()'));assert.deepEqual(after.accounts,before.accounts,'Rail construction/configuration introduces no fare, charge or money');assert.deepEqual(after.cells,before.cells,'Rail does not rewrite road/building allocation');
 checks.push('Native station, atomic track and service confirmation; real scene with three batched track meshes; no cash or road mutation');
 await capture('rail-built');
 const pose=state.trainPosition;assert.ok(pose&&['x','y','z'].every(k=>Number.isFinite(pose[k])),'Actual rendered train pose is exposed read-only');
 await tap('[data-speed="1"]');await tap('#pause');
 await until(async()=>{const s=await rail();return s.snapshot.model.offeredPersons>0&&s.snapshot.service.snapshot.train.destination!==null&&JSON.stringify(s.trainPosition)!==JSON.stringify(pose);},'actual train movement with modeled riders');
 await tap('#pause');assert.equal(await evaluate('window.cityManager.parks().paused'),true);
 state=await rail();const paused=structuredClone(state);await sleep(250);const stable=await rail();assert.deepEqual(stable.snapshot,paused.snapshot,'Game pause freezes authoritative rail minute and passengers');assert.deepEqual(stable.trainPosition,paused.trainPosition,'Game pause freezes rendered train');
 assert.ok(state.snapshot.model.offeredPersons>0);assert.ok(state.snapshot.service.snapshot.batches.length<=32);
 checks.push('Normal game clock creates bounded modeled riders and moves actual mesh; pause freezes both without manual clock advancement');
 await capture('rail-moving-paused');
 await menu('manage');await tap('#rail-service-toggle');assert.equal((await rail()).snapshot.service.snapshot.enabled,false);await tap('#rail-management [aria-label="ปิดหน้าจัดการรถไฟ"]');
 const saved=await acknowledge();const savedRail=saved.parkRuntime.rail;assert.ok(savedRail);assert.equal(saved.version,25);
 await reload();const restored=JSON.parse(await evaluate('window.cityManager.sessionSnapshot()'));assert.deepEqual(restored.parkRuntime.rail,savedRail,'Actual server ACK restores rail service, train, queues and modeled counters exactly');assert.equal((await rail()).trains,1);
 await capture('rail-restored');checks.push('Service paused through UI, complete v25 rail session ACKed and reloaded exactly from isolated server');
 return{status:'passed',checks,stations:savedRail.network.stations,offeredPersons:savedRail.network.model.offeredPersons};
}
