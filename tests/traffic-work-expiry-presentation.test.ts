import test from 'node:test';
import assert from 'node:assert/strict';
import {TrafficPresentation} from '../src/traffic/presentation.ts';
import type {CitizenVehiclePose} from '../src/citizen-vehicle-poses.ts';

const pose=(vehicleId:string,x:number,z=0):CitizenVehiclePose=>({vehicleId,x,z,headingX:1,headingZ:0,paint:0,speed:0});
const ids=(poses:readonly CitizenVehiclePose[])=>poses.map(p=>p.vehicleId).sort();

test('explicit expiry releases an occupied junction and lets an unrelated follower pass',()=>{
 const p=new TrafficPresentation();
 const owner={...pose('game:1',0,-.24),upcomingTurn:{x:.71,z:-.24,headingX:1,headingZ:0,nodeX:0,nodeZ:0,entryX:0,entryZ:-.24,incomingHeadingX:1,incomingHeadingZ:0,visit:1}};
 const follower=pose('game:2',-1.8,-.24);
 p.update([owner,follower]);p.frame(.025,false);
 assert.deepEqual(ids(p.frame(0,false)),['game:1','game:2']);
 const reservations=[...(p as any).corners.values()];
 assert.ok(reservations.some((r:any)=>r.owner==='game:1'&&r.active&&r.entered),'the expired car actually owns an entered junction');
 assert.ok(p.diagnostics.cornerOwners.some(r=>r.owner==='game:1'&&r.active&&r.entered),'read-only diagnostics identify the actual owner and occupancy');
 const snapshot=p.diagnostics.cornerOwners;snapshot[0].owner='diagnostic-only';assert.ok(p.diagnostics.cornerOwners.some(r=>r.owner==='game:1'),'mutating a diagnostic snapshot cannot change reservation ownership');
 p.update([owner,{...follower,x:2}]);
 for(let n=0;n<100;n++)p.frame(.025,false);
 const stopped=p.diagnostics.renderedPoses.find(v=>v.vehicleId==='game:2')!.x;
 assert.ok(stopped<-.4,'the occupied body and its corridor block the follower before expiry');
 p.expire(['game:1','game:1']);
 assert.deepEqual(ids(p.frame(0,true)),['game:2'],'the expired body is absent even from a paused frame');
 assert.ok([...(p as any).corners.values()].every((r:any)=>r.owner!=='game:1'));
 assert.ok(p.diagnostics.cornerOwners.every(r=>r.owner!=='game:1'),'expiry removes the owner from the public diagnostics');
 assert.equal(p.diagnostics.removed,1);assert.deepEqual(p.diagnostics.lastRemoved,['game:1']);
 for(let n=0;n<150;n++)p.frame(.025,false);
 assert.ok(p.diagnostics.renderedPoses.find(v=>v.vehicleId==='game:2')!.x>1.9,'the survivor can use the released road');
 p.expire(['game:1']);assert.equal(p.diagnostics.removed,1,'repeated cancellation is idempotent');
});

test('expiry clears deferred and retired identities without touching other cars',()=>{
 const p=new TrafficPresentation(1),a={...pose('game:1',0),exitX:2,exitZ:0},b=pose('game:2',4);
 p.update([a,b]);p.frame(.01,false);assert.deepEqual(p.diagnostics.deferredIds,['game:2']);
 p.expire(['game:2']);assert.deepEqual(p.diagnostics.deferredIds,[]);assert.equal(p.diagnostics.removed,0,'a never-admitted pending car is not counted as removed');
 p.update([],[],[]);assert.deepEqual(p.diagnostics.retiringIds,['game:1']);
 p.expire(['game:1']);assert.deepEqual(p.frame(.2,true),[]);assert.equal(p.diagnostics.removed,1);
 p.update([pose('game:3',4)]);assert.deepEqual(ids(p.frame(.01,false)),['game:3']);
});

test('expiry removes only the car from a selected bus epoch and preserves its reservation',()=>{
 const p=new TrafficPresentation(),car=pose('game:1',0),other=pose('game:2',5);
 p.update([car,other]);p.frame(.01,false);
 const bus={x:0,z:-1,headingX:0,headingZ:1,length:.78,width:.32},next={...bus,z:0},turn={id:'junction',samples:[bus,next]};
 assert.equal(p.allowBusMovement('bus:1',bus,next,[],[],[turn]),false);
 const reservations=(p as any).reservations as Map<string,{state:string;epoch:ReadonlySet<string>}>;
 assert.equal(reservations.size,1);assert.equal(reservations.get('bus:1:turn:junction')!.state,'SELECTED_DRAIN');
 assert.deepEqual([...reservations.get('bus:1:turn:junction')!.epoch].sort(),['game:1','game:2']);
 p.expire(['game:1']);
 assert.equal(reservations.size,1);assert.equal(reservations.get('bus:1:turn:junction')!.state,'SELECTED_DRAIN');
 assert.deepEqual([...reservations.get('bus:1:turn:junction')!.epoch],['game:2']);
 assert.equal(p.diagnostics.selectedDrain,'bus:1');
 assert.equal(p.allowBusMovement('bus:1',bus,next,[],[],[turn]),true,'the waiting bus can acquire once the physical car is removed');
 assert.equal(reservations.get('bus:1:turn:junction')!.state,'OCCUPIED','the bus still owns its corridor');
 assert.deepEqual(p.diagnostics.renderedIds,['game:2']);
});

test('expiry does not release an already acquired bus corridor',()=>{
 const p=new TrafficPresentation(),bus={x:0,z:0,headingX:1,headingZ:0,length:.78,width:.32},next={...bus,x:.1};
 const turn={id:'route',samples:[bus,{...bus,x:2}]};
 assert.equal(p.allowBusMovement('bus:1',bus,next,[],[],[turn]),true);
 p.update([pose('game:1',10),pose('game:2',1)]);p.frame(.01,false);
 assert.deepEqual(p.diagnostics.renderedIds,['game:1']);assert.deepEqual(p.diagnostics.deferredIds,['game:2']);
 p.expire(['game:1']);p.frame(.01,false);
 assert.deepEqual(p.diagnostics.renderedIds,[]);assert.deepEqual(p.diagnostics.deferredIds,['game:2'],'the bus corridor still excludes other traffic');
 assert.equal(((p as any).reservations as Map<string,{state:string}>).get('bus:1:turn:route')!.state,'OCCUPIED');
 p.reconcileBuses([]);p.frame(.01,false);assert.deepEqual(p.diagnostics.renderedIds,['game:2'],'ordinary admission resumes after the real bus clears');
});

test('motion status distinguishes no waypoint, progress, collision and paused or zero time',()=>{
 const p=new TrafficPresentation(),car={...pose('game:1',0),speed:2},obstacle=pose('game:2',1);
 assert.equal(p.motionState('game:1'),'absent');
 p.update([car,obstacle]);p.frame(.025,false);
 assert.equal(p.motionState('game:1'),'waiting','a positive model speed is not evidence of movement without a waypoint');
 assert.equal(p.motionState('game:2'),'waiting');
 p.update([{...car,x:3},obstacle]);p.frame(.025,false);
 assert.equal(p.motionState('game:1'),'moving');
 for(let n=0;n<100&&p.motionState('game:1')!=='blocked';n++)p.frame(.025,false);
 assert.equal(p.motionState('game:1'),'blocked','physical body clearance rejected forward travel');
 p.frame(.25,true);assert.equal(p.motionState('game:1'),'blocked','pause preserves the last physical evidence');
 p.frame(0,false);assert.equal(p.motionState('game:1'),'blocked','zero dt does not fabricate a new observation');
 p.expire(['game:2']);p.frame(.025,false);
 assert.equal(p.motionState('game:1'),'moving','a car that can physically move must not remain marked blocked');
 for(let n=0;n<200;n++)p.frame(.025,false);
 assert.equal(p.motionState('game:1'),'waiting','the reached waypoint is not a blockage');
});

test('any progress in a frame takes precedence over a later failed substep',()=>{
 const p=new TrafficPresentation(),car=pose('game:1',0),leader=pose('game:2',.7);
 p.update([car,leader]);p.frame(.025,false);p.update([{...car,x:2},leader]);
 let sawMixed=false;
 for(let n=0;n<10;n++){
  const before=p.diagnostics.renderedPoses.find(v=>v.vehicleId==='game:1')!.x;
  p.frame(.25,false);
  const after=p.diagnostics.renderedPoses.find(v=>v.vehicleId==='game:1')!;
  if(after.x>before+1e-9&&after.speed===0){sawMixed=true;assert.equal(p.motionState('game:1'),'moving');break;}
 }
 assert.ok(sawMixed,'fixture must move and encounter the leader within one multi-substep frame');
 p.frame(.025,false);assert.equal(p.motionState('game:1'),'blocked');
});

test('deferred and retired cars report their actual presenter lifecycle',()=>{
 const p=new TrafficPresentation(1),first=pose('game:1',0),deferred=pose('game:2',5);
 p.update([first,deferred]);assert.equal(p.motionState('game:1'),'pending');
 p.frame(.025,false);assert.equal(p.motionState('game:1'),'waiting');assert.equal(p.motionState('game:2'),'pending');
 p.update([],[],[]);assert.equal(p.motionState('game:2'),'absent');
 p.frame(.025,false);assert.equal(p.motionState('game:1'),'waiting','retirement itself is not blockage');
 for(let n=0;n<20;n++)p.frame(.025,false);
 assert.equal(p.motionState('game:1'),'absent','fully retired means no physical body');
});
