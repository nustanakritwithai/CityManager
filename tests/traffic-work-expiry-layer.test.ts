import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {buildRoad,bulldoze,createCity,type City} from '../src/sim.ts';
import {workExpiryBrowserFixture} from './traffic-work-expiry-browser-fixture.ts';
import {createTrafficGameWorkerEngine} from '../src/traffic/game-worker-engine.ts';
import {TrafficGame} from '../src/traffic/game.ts';
import {gamePoses} from '../src/traffic/game-poses.ts';
import {WORK_STALL_GRACE_SECONDS} from '../src/traffic/work-stall.ts';
import type {GameWorkerInput,GameWorkerOutput} from '../src/traffic/game-worker-client.ts';
import type {TrafficGameInput,TrafficGameFrame} from '../src/traffic/game.ts';

registerHooks({load(url,context,next){if(url.endsWith('/scene-citizen-vehicles.ts')||url.endsWith('/traffic/layer.ts'))return {format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(new URL(url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText};return next(url,context);}});
const {TrafficLayer}=await import('../src/traffic/layer.ts');
class WorkerFixture {
 engine=createTrafficGameWorkerEngine();queue:GameWorkerInput<TrafficGameInput>[]=[];listeners:Record<string,Function[]>={};
 advances:{day:number;minute:number}[]=[];expirations:number[]=[];posts=0;maxWork=0;
 postMessage(m:GameWorkerInput<TrafficGameInput>){this.posts++;if(m.advance&&m.sample.work)this.advances.push({day:m.sample.work.day,minute:m.sample.work.minute});this.queue.push(structuredClone(m));}
 addEventListener(type:string,fn:Function){(this.listeners[type]??=[]).push(fn);}
 terminate(){}
 emit(result:GameWorkerOutput<TrafficGameFrame>){for(const fn of this.listeners.message??[])fn({data:result});}
 flush(){while(this.queue.length){const result=this.engine(this.queue.shift()!);if(result.kind==='frame'){this.maxWork=Math.max(this.maxWork,(result.frame.workTrips??[]).length);for(const e of result.frame.expiredWorkTrips??[])this.expirations.push(e.id);}for(const fn of this.listeners.message??[])fn({data:result as GameWorkerOutput<TrafficGameFrame>});}}
}

test('ordinary all-red waiting at 17:00 survives and the same work car later proceeds',()=>{
 const roads=[25,26,27,28,2,50],map={cells:Array.from({length:576},(_,i)=>({road:roads.includes(i)}))};
 const game=new TrafficGame({map,demand:[{from:25,to:28,rate:4},{from:2,to:50,rate:4}]});
 game.setWork({day:1,minute:1019,ack:0,candidates:Array.from({length:60},(_,i)=>({citizenId:`h:${i}:m:0`,home:25,work:28}))});
 game.step();const frame=game.step(),car=frame.cars.find(c=>c.id===1)!;
 assert.ok(frame.workTrips?.some(t=>t.id===1));assert.equal(car.blocked,true);assert.equal(frame.signals?.phases.find(s=>s.node===26)?.state,'all-red');
 const scene={sync:()=>{},setEnabled:()=>{},destroy:()=>{},diagnostics:{cars:0,drawBatches:0,trianglesPerCar:24,capacity:0}};
 const layer=new TrafficLayer({} as never,()=>true,()=>{},()=>{throw Error('unused');},scene as never,false,()=>0);
 (layer as any).latest=frame;(layer as any).workClock={day:1,minute:1020};const presenter=(layer as any).presenter;
 const poses=gamePoses([car],frame.groups);presenter.update(poses,poses,['game:1']);presenter.frame(.025,false);
 assert.equal((layer as any).reconcileWorkTrips(.025),false,'one red phase is not sustained stagnation');
 assert.notEqual(presenter.motionState('game:1'),'absent');
 let proceeds=false;for(let i=0;i<20;i++){const next=game.step().cars.find(c=>c.id===1);if(!next||next.from!==car.from||next.progress!>car.progress!+1e-5){proceeds=true;break;}}
 assert.ok(proceeds,'the same car proceeds when the signal clears');layer.destroy();
});

test('native fixture can exercise an entered reservation and its work-trip expiry without injecting actors',()=>{
 const {city,runtime,closedRoad}=workExpiryBrowserFixture(),worker=new WorkerFixture(),faults:string[]=[];let now=0;
 const scene={sync:()=>{},setEnabled:()=>{},destroy:()=>{},diagnostics:{cars:0,drawBatches:0,trianglesPerCar:24,capacity:0}};
 const layer=new TrafficLayer({} as never,()=>true,m=>faults.push(m),()=>worker as never,scene as never,false,()=>now);
 const frame=(minute:number)=>{now+=25;layer.frame(city,minute,false,.025,runtime.activity.day);worker.flush();};
 for(let i=0;i<41;i++)frame(1018);frame(1018);
 const latest=(layer as any).latest as TrafficGameFrame;assert.equal(latest.step,1);
 const target=latest.cars.find(c=>latest.workTrips?.some(t=>t.id===c.id)&&c.destination===closedRoad+1);assert.ok(target);
 assert.ok(latest.cars.every(c=>c.from!==closedRoad&&c.to!==closedRoad));assert.equal(bulldoze(city,closedRoad).ok,true);layer.afterMapEdit(city);frame(1018);
 let entered=false;for(let i=0;i<3000&&!worker.expirations.includes(target.id);i++){frame(1020);if(layer.diagnostics.presentation.cornerOwners.some(r=>r.owner===`game:${target.id}`&&r.active&&r.entered))entered=true;}
 assert.equal(entered,true,'Actual presenter grants and enters this car corridor before expiration');
 assert.ok(worker.expirations.includes(target.id),'The actual worker acknowledges expiration');
 assert.ok(layer.diagnostics.presentation.cornerOwners.every(r=>r.owner!==`game:${target.id}`));assert.ok(!layer.diagnostics.presentation.selectedIds.includes(`game:${target.id}`));assert.deepEqual(faults,[]);layer.destroy();
});

test('native closure fixture retains the same generic follower through expiry and road repair',()=>{
 const {city,runtime,closedRoad}=workExpiryBrowserFixture(),worker=new WorkerFixture(),faults:string[]=[];let now=0;
 const scene={sync:()=>{},setEnabled:()=>{},destroy:()=>{},diagnostics:{cars:0,drawBatches:0,trianglesPerCar:24,capacity:0}};
 const layer=new TrafficLayer({} as never,()=>true,m=>faults.push(m),()=>worker as never,scene as never,false,()=>now);
 const frame=()=>{now+=25;layer.frame(city,1018+Math.floor(now/1000),false,.025,runtime.activity.day);worker.flush();};
 for(let i=0;i<122;i++)frame();const before=(layer as any).latest as TrafficGameFrame;assert.equal(before.step,3);
 const workIds=new Set(before.workTrips?.map(t=>t.id)),target=before.cars.find(c=>workIds.has(c.id)&&c.destination===closedRoad+1),follower=before.cars.find(c=>!workIds.has(c.id)&&c.destination===target?.destination);assert.ok(target&&follower);
 assert.ok(before.cars.every(c=>c.from!==closedRoad&&c.to!==closedRoad));assert.equal(bulldoze(city,closedRoad).ok,true);layer.afterMapEdit(city);frame();
 for(let i=0;i<3000&&!worker.expirations.includes(target.id);i++)frame();assert.ok(worker.expirations.includes(target.id));
 const workerBefore=((layer as any).latest as TrafficGameFrame).cars.find(c=>c.id===follower.id),poseBefore=layer.diagnostics.presentation.renderedPoses.find(p=>p.vehicleId===`game:${follower.id}`);assert.ok(workerBefore&&poseBefore,'Same unrelated follower remains in worker and physical scene');
 assert.equal(buildRoad(city,closedRoad-1,closedRoad).ok,true);layer.afterMapEdit(city);frame();
 let moved=false;for(let i=0;i<1200;i++){frame();const pose=layer.diagnostics.presentation.renderedPoses.find(p=>p.vehicleId===`game:${follower.id}`);if(pose&&Math.hypot(pose.x-poseBefore.x,pose.z-poseBefore.z)>.01){moved=true;break;}}
 assert.equal(moved,true,'Same unrelated car physically moves after expiry and real road repair');assert.deepEqual(faults,[]);layer.destroy();
});

test('10x at 10 FPS crossing whole work windows still classifies new work traffic',()=>{
 const c=city(),workers:WorkerFixture[]=[],faults:string[]=[];let now=0;
 const scene={sync:()=>{},setEnabled:()=>{},destroy:()=>{},diagnostics:{cars:0,drawBatches:0,trianglesPerCar:24,capacity:0}};
 const layer=new TrafficLayer({} as never,()=>true,m=>faults.push(m),()=>{const w=new WorkerFixture();workers.push(w);return w as never;},scene as never,false,()=>now);
 for(let frame=0;frame<200;frame++){now=frame*100;layer.frame(c,0,false,.1,7+frame);workers[0].flush();}
 assert.ok(workers[0].advances.length>5);assert.ok(workers[0].maxWork>0,'crossed work windows must not lose their representative trip');
 assert.deepEqual(faults,[]);layer.destroy();
});
function city():City {
 const c=createCity(1,{starter:false});for(const i of [25,26,27,28])c.cells[i].road=true;
 c.buildings=[{id:1,cell:49,zone:'R',level:1,age:0},{id:2,cell:52,zone:'C',level:2,age:0}];
 c.firms=[{id:3,building:2} as City['firms'][number]];
 c.households=[{id:4,home:1,members:16,workforce:1,dependents:15,workerSkills:{general:1,manufacturing:0,retail:0},skillSource:'arrival-profile',profile:'family',origin:'arrival',wallet:'h:4',lastPurchaseTick:-1,needs:0}];
 c.employment=[{householdId:4,firmId:3,skill:'general',workers:1,occupation:'manufacturing',rank:'entry'}];return c;
}

test('the game-day boundary preserves a work car on an open road',()=>{
 const c=city(),before=JSON.stringify(c),workers:WorkerFixture[]=[],faults:string[]=[];let now=0;
 const scene={sync:()=>{},setEnabled:()=>{},destroy:()=>{},diagnostics:{cars:0,drawBatches:0,trianglesPerCar:24,capacity:0}};
 const layer=new TrafficLayer({} as never,()=>true,m=>faults.push(m),()=>{const w=new WorkerFixture();workers.push(w);return w as never;},scene as never,false,()=>now);
 layer.frame(c,1019,false,.025,7);workers[0].flush();
 for(let i=0;i<3;i++){now+=1000;layer.frame(c,1019,false,.025,7);workers[0].flush();}
 layer.frame(c,1019,false,.025,7);
 const work=(layer as any).latest.workTrips?.[0];assert.ok(work);
 const workId=`game:${work.id}`;assert.ok(layer.diagnostics.presentation.selectedIds.includes(workId));
 const oldStep=layer.diagnostics.step;layer.frame(c,1020,false,.025,7);
 assert.equal((layer as any).workClock.minute,1020,'the game clock advances without waiting for a worker step');
 workers[0].flush();layer.frame(c,1020,false,.025,7);
 assert.equal(layer.diagnostics.step,oldStep);assert.ok(layer.diagnostics.presentation.selectedIds.includes(workId));
 assert.ok(!layer.diagnostics.presentation.lastRemoved.includes(workId));
 assert.deepEqual(faults,[]);assert.equal(JSON.stringify(c),before);layer.destroy();
});

test('an overdue work car blocked on a disconnected future road is removed in presenter and worker',()=>{
 const c=city(),workers:WorkerFixture[]=[],faults:string[]=[];let now=0;
 const scene={sync:()=>{},setEnabled:()=>{},destroy:()=>{},diagnostics:{cars:0,drawBatches:0,trianglesPerCar:24,capacity:0}};
 const layer=new TrafficLayer({} as never,()=>true,m=>faults.push(m),()=>{const w=new WorkerFixture();workers.push(w);return w as never;},scene as never,false,()=>now);
 layer.frame(c,1019,false,.025,7);workers[0].flush();
 for(let i=0;i<3;i++){now+=1000;layer.frame(c,1019,false,.025,7);workers[0].flush();}
 layer.frame(c,1019,false,.025,7);
 const work=(layer as any).latest.workTrips?.[0];assert.ok(work);
 const before=(layer as any).latest.cars.find((x:any)=>x.id===work.id);assert.ok(before);
 assert.notEqual(before.from,28);assert.notEqual(before.to,28);
 c.cells[28].road=false;layer.afterMapEdit(c);layer.frame(c,1019,false,.025,7);workers[0].flush();
 const blocked=(layer as any).latest.cars.find((x:any)=>x.id===work.id);assert.equal(blocked.blocked,true);
 // Let any already-queued physical travel finish, then exceed the full grace.
 for(let i=0;i<Math.ceil(WORK_STALL_GRACE_SECONDS/.25)+80;i++)layer.frame(c,1019,false,.25,7);
 assert.notEqual((layer as any).presenter.motionState(`game:${work.id}`),'moving');
 now+=1000;layer.frame(c,1019,false,.025,7);assert.ok(workers[0].queue.length>0);
 layer.frame(c,1020,false,.025,7);
 assert.equal((layer as any).presenter.motionState(`game:${work.id}`),'absent','the blocked car is removed before worker acknowledgement');
 const stale=workers[0].engine(workers[0].queue.shift()!);assert.equal(stale.kind,'frame');
 if(stale.kind==='frame')assert.ok(stale.frame.cars.some(x=>x.id===work.id),'the in-flight frame still contains the car');
 workers[0].emit(stale);
 assert.equal((layer as any).presenter.motionState(`game:${work.id}`),'absent','a coalesced frame must not restore it');
 workers[0].flush();layer.frame(c,1020,false,.025,7);
 assert.ok(!(layer as any).latest.cars.some((x:any)=>x.id===work.id));
 assert.equal((layer as any).presenter.motionState(`game:${work.id}`),'absent');
 assert.ok(workers[0].expirations.includes(work.id));assert.deepEqual(faults,[]);layer.destroy();
});

test('the default one-day-per-second clock labels crossed work windows without changing cadence',()=>{
 const c=city(),workers:WorkerFixture[]=[],faults:string[]=[];let now=0;
 const scene={sync:()=>{},setEnabled:()=>{},destroy:()=>{},diagnostics:{cars:0,drawBatches:0,trianglesPerCar:24,capacity:0}};
 const layer=new TrafficLayer({} as never,()=>true,m=>faults.push(m),()=>{const w=new WorkerFixture();workers.push(w);return w as never;},scene as never,false,()=>now);
 for(let frame=0;frame<600;frame++){
  now=frame*1000/60;layer.frame(c,(frame%60)*24,false,1/60,7+Math.floor(frame/60));workers[0].flush();
 }
 assert.ok(workers[0].advances.length>=8&&workers[0].advances.length<=10,JSON.stringify(workers[0].advances));
 assert.ok(workers[0].maxWork>0,'matching work cars must be classified even when each step samples midnight');
 assert.deepEqual(faults,[]);layer.destroy();
});

test('a slowly moving night clock keeps the ordinary worker cadence without accumulating a burst',()=>{
 const c=city(),workers:WorkerFixture[]=[],faults:string[]=[];let now=0;
 const scene={sync:()=>{},setEnabled:()=>{},destroy:()=>{},diagnostics:{cars:0,drawBatches:0,trianglesPerCar:24,capacity:0}};
 const layer=new TrafficLayer({} as never,()=>true,m=>faults.push(m),()=>{const w=new WorkerFixture();workers.push(w);return w as never;},scene as never,false,()=>now);
 for(let frame=0;frame<=40;frame++){now=frame*100;layer.frame(c,Math.floor(frame/10),false,.025,7);workers[0].flush();}
 assert.equal(workers[0].advances.length,4);assert.deepEqual(faults,[]);layer.destroy();
});

for(const frameMs of [100,250])test(`skipping the work window every ${frameMs} ms does not halve traffic throughput or flood the worker`,()=>{
 const c=city(),workers:WorkerFixture[]=[],faults:string[]=[];let now=0;
 const scene={sync:()=>{},setEnabled:()=>{},destroy:()=>{},diagnostics:{cars:0,drawBatches:0,trianglesPerCar:24,capacity:0}};
 const layer=new TrafficLayer({} as never,()=>true,m=>faults.push(m),()=>{const w=new WorkerFixture();workers.push(w);return w as never;},scene as never,false,()=>now);
 for(let frame=0;frame<=10000/frameMs;frame++){now=frame*frameMs;layer.frame(c,0,false,frameMs/1000,7+frame);workers[0].flush();}
 assert.ok(workers[0].advances.length>=8&&workers[0].advances.length<=10,JSON.stringify(workers[0].advances));
 assert.ok(workers[0].posts<=workers[0].advances.length+2,`unexpected worker requests: ${workers[0].posts}`);
 assert.deepEqual(faults,[]);layer.destroy();
});

test('a rolled-back clock does not repeatedly resubmit or re-open an earlier work period',()=>{
 const c=city(),workers:WorkerFixture[]=[],faults:string[]=[];let now=0;
 const scene={sync:()=>{},setEnabled:()=>{},destroy:()=>{},diagnostics:{cars:0,drawBatches:0,trianglesPerCar:24,capacity:0}};
 const layer=new TrafficLayer({} as never,()=>true,m=>faults.push(m),()=>{const w=new WorkerFixture();workers.push(w);return w as never;},scene as never,false,()=>now);
 layer.frame(c,1020,true,.025,7);workers[0].flush();const before=layer.diagnostics.timing.samples;
 for(let i=0;i<50;i++){layer.frame(c,600,true,.025,7);workers[0].flush();}
 assert.equal(layer.diagnostics.timing.samples,before);assert.equal((layer as any).workClock.minute,1020);
 assert.deepEqual(faults,[]);layer.destroy();
});

test('paused frames do not advance the work clock or consume a crossed window',()=>{
 const c=city(),workers:WorkerFixture[]=[],faults:string[]=[];let now=0;
 const scene={sync:()=>{},setEnabled:()=>{},destroy:()=>{},diagnostics:{cars:0,drawBatches:0,trianglesPerCar:24,capacity:0}};
 const layer=new TrafficLayer({} as never,()=>true,m=>faults.push(m),()=>{const w=new WorkerFixture();workers.push(w);return w as never;},scene as never,false,()=>now);
 layer.frame(c,0,false,.025,7);workers[0].flush();
 layer.frame(c,0,true,.025,8);workers[0].flush();
 assert.deepEqual((layer as any).workClock,{day:7,minute:0});assert.equal((layer as any).crossedWorkDay,null);
 now+=10000;layer.frame(c,0,true,.025,8);workers[0].flush();assert.equal((layer as any).crossedWorkDay,null);
 layer.frame(c,0,false,.025,8);workers[0].flush();assert.equal((layer as any).crossedWorkDay,7);
 assert.deepEqual(faults,[]);layer.destroy();
});

test('reloading after cutoff fences an old worker and opens a fresh commute on the next day',()=>{
 const c=city(),before=JSON.stringify(c),workers:WorkerFixture[]=[],faults:string[]=[];let now=0;
 const scene={sync:()=>{},setEnabled:()=>{},destroy:()=>{},diagnostics:{cars:0,drawBatches:0,trianglesPerCar:24,capacity:0}};
 const layer=new TrafficLayer({} as never,()=>true,m=>faults.push(m),()=>{const w=new WorkerFixture();workers.push(w);return w as never;},scene as never,false,()=>now);
 layer.frame(c,1019,false,.025,7);workers[0].flush();
 now+=1000;layer.frame(c,1019,false,.025,7);const old=workers[0];
 const stale=old.engine(old.queue.shift()!);assert.equal(stale.kind,'frame');
 const restored=structuredClone(c);layer.frame(restored,1020,false,.025,7);workers[1].flush();
 const accepted=layer.diagnostics.step;old.emit(stale);assert.equal(layer.diagnostics.step,accepted);
 now+=1000;layer.frame(restored,1020,false,.025,7);workers[1].flush();
 assert.deepEqual(layer.diagnostics.presentation.lastRemoved,[]);
 layer.frame(restored,390,false,.025,8);workers[1].flush();
 for(let i=0;i<3;i++){now+=1000;layer.frame(restored,390,false,.025,8);workers[1].flush();}
 layer.frame(restored,390,false,.025,8);const work=(layer as any).latest.workTrips?.[0];assert.ok(work);
 const workId=`game:${work.id}`;assert.ok(layer.diagnostics.presentation.selectedIds.includes(workId));
 layer.frame(restored,1020,false,.025,8);workers[1].flush();
 assert.ok(layer.diagnostics.presentation.selectedIds.includes(workId),'the work car survives the deadline');
 assert.deepEqual(faults,[]);assert.equal(JSON.stringify(c),before);assert.equal(JSON.stringify(restored),before);layer.destroy();
});
