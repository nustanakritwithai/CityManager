import test from 'node:test';import assert from 'node:assert/strict';
import {TrafficPresentation,presentationPath,presentationCarSweep} from '../src/traffic/presentation.ts';
import type {CitizenVehiclePose} from '../src/citizen-vehicle-poses.ts';
const pose=(id:string,x:number,z=0,hx=1,hz=0):CitizenVehiclePose=>({vehicleId:id,x,z,headingX:hx,headingZ:hz,paint:0,speed:0});
const ids=(p:CitizenVehiclePose[])=>p.map(p=>p.vehicleId).sort();
function gap(p:CitizenVehiclePose[]){const row=[...p].sort((a,b)=>a.x-b.x);for(let n=1;n<row.length;n++)assert.ok(row[n].x-row[n-1].x>=.42+.09-1e-6);}
test('selected IDs stay sticky when fair-sampling order changes; new unsafe births defer',()=>{
 const p=new TrafficPresentation(2),raw=[pose('a',0),pose('b',1),pose('c',2)];p.update(raw);assert.deepEqual(ids(p.frame(.01,false)),['a','b']);
 p.update(raw,[raw[2],raw[1],raw[0]]);for(let n=0;n<10;n++)assert.deepEqual(ids(p.frame(.1,false)),['a','b']);assert.deepEqual(p.diagnostics.deferredIds,['c']);
 const q=new TrafficPresentation();q.update([pose('a',0),pose('b',.1)]);assert.deepEqual(ids(q.frame(.1,false)),['a']);assert.deepEqual(q.diagnostics.deferredIds,['b']);
 q.update([pose('a',2),pose('b',.1)]);for(let n=0;n<40;n++){const shown=q.frame(.05,false);assert.ok(ids(shown).includes('a'));gap(shown);}assert.deepEqual(ids(q.frame(0,false)),['a','b']);
});
test('a stopped leader holds followers safely without ID omission across every render phase',()=>{
 const p=new TrafficPresentation(),initial=[pose('a',0),pose('b',.6),pose('c',1.2)];p.update(initial);p.frame(.01,false);
 p.update([pose('a',2),pose('b',2.6),pose('c',1.2)]);let previous=p.frame(0,false);
 for(let n=0;n<80;n++){const shown=p.frame(.025,false);assert.deepEqual(ids(shown),['a','b','c']);gap(shown);for(const v of shown){const old=previous.find(o=>o.vehicleId===v.vehicleId)!;assert.ok(Math.hypot(v.x-old.x,v.z-old.z)<=.05+1e-7);}previous=shown;}
 assert.equal(p.diagnostics.removed,0);
});
test('right-angle travel follows a rounded legal corner continuously, not freeze then snap',()=>{
 const a=pose('a',0),b=pose('a',1,1,0,1),path=presentationPath(a,b);assert.ok(path.length>=7);assert.ok(path.some(p=>p.headingX>0&&p.headingZ>0));
 const p=new TrafficPresentation();p.update([a]);p.frame(.01,false);p.update([b]);let previous=a,moving=0;
 for(let n=0;n<120;n++){const [next]=p.frame(.025,false);assert.ok(next);assert.ok(next.x>=-1e-7&&next.x<=1.000001&&next.z>=-1e-7&&next.z<=1.000001);assert.ok(next.x>.85||next.z<.15,'No diagonal pavement shortcut');const d=Math.hypot(next.x-previous.x,next.z-previous.z);assert.ok(d<=.05+1e-7);if(d>1e-6)moving++;previous=next;}
 assert.ok(moving>20);assert.ok(Math.hypot(previous.x-1,previous.z-1)<1e-5);
});
test('pause preserves IDs and poses; genuine removal finishes terminal segment before short retirement',()=>{
 const p=new TrafficPresentation(),a={...pose('a',0),exitX:1,exitZ:0};p.update([a]);const before=p.frame(.01,false);p.update([{...a,x:.4}]);assert.deepEqual(p.frame(.25,true),before);p.update([],[],[]);
 let endpoint=false,removed=false;for(let n=0;n<200;n++){const shown=p.frame(.025,false);if(shown[0]?.x>.999)endpoint=true;if(!shown.length){removed=true;break;}}
 assert.ok(endpoint&&removed);assert.equal(p.diagnostics.removed,1);assert.deepEqual(p.diagnostics.lastRemoved,['a']);
});
test('stationary bus holds visible cars; independent bus intrusion is diagnosed, never hidden',()=>{
 const p=new TrafficPresentation();p.update([pose('a',0)]);p.frame(.01,false);p.update([pose('a',2)]);
 const bus={x:1,z:0,headingX:1,headingZ:0,length:.78,width:.32};for(let n=0;n<80;n++){const [car]=p.frame(.025,false,[bus]);assert.ok(car);assert.ok(car.x+.21<=bus.x-.39-.09+1e-6);}assert.equal(p.diagnostics.busIntrusions,0);
 const [car]=p.frame(.025,false,[{...bus,x:0}]);assert.ok(car);assert.ok(p.diagnostics.busIntrusions>0);assert.equal(p.diagnostics.removed,0);
});
test('128 actors keep bounded 64 selection and a fresh city presenter has no stale identities',()=>{
 const raw=Array.from({length:128},(_,n)=>pose(String(n),n%16*1.2,Math.floor(n/16)*1.2));const p=new TrafficPresentation();p.update(raw);assert.equal(p.frame(.01,false).length,64);assert.equal(p.diagnostics.deferredIds.length,64);assert.deepEqual(new TrafficPresentation().frame(.1,false),[]);
});

test('all admitted car IDs survive each supported stationary bus body without overlap',()=>{for(const [length,width] of [[.78,.32],[1.02,.36],[1.32,.38]]){const p=new TrafficPresentation();p.update([pose('a',0),pose('b',-.6)]);p.frame(.01,false);p.update([pose('a',3),pose('b',2.4)]);const bus={x:1.4,z:0,headingX:1,headingZ:0,length,width};for(let n=0;n<100;n++){const shown=p.frame(.025,false,[bus]);assert.deepEqual(ids(shown),['a','b']);gap(shown);for(const car of shown)assert.ok(car.x+.21<=bus.x-length/2-.09+1e-6);}assert.equal(p.diagnostics.busIntrusions,0);}});

test('sustained blocked updates coalesce without false removal, then retire only at endpoint',()=>{const p=new TrafficPresentation(),start={...pose('a',0),exitX:3,exitZ:0};p.update([start]);p.frame(.01,false);const bus={x:1,z:0,headingX:1,headingZ:0,length:.78,width:.32};for(let n=1;n<=10000;n++)p.update([{...start,x:2*n/10000}]);assert.ok(p.diagnostics.queuedWaypoints<=2);p.update([],[],[]);for(let n=0;n<100;n++)assert.equal(p.frame(.025,false,[bus]).length,1);assert.equal(p.diagnostics.removed,0);let endpoint=false;for(let n=0;n<200;n++){const shown=p.frame(.025,false,[]);if(shown[0]?.x>2.999)endpoint=true;if(!shown.length)break;}assert.ok(endpoint);assert.equal(p.diagnostics.removed,1);});

test('bus reservation waits for incumbent, blocks new entry and admits only after the car clears',()=>{
 const p=new TrafficPresentation(),bus={x:0,z:-1,headingX:0,headingZ:1,length:1.32,width:.38},next={...bus,z:0};
 p.update([pose('incumbent',0),pose('following',-1)]);p.frame(.01,false);p.update([pose('incumbent',2),pose('following',2),pose('newborn',.1)]);
 assert.equal(p.allowBusMovement('bus',bus,next),false);
 for(let n=0;n<120;n++){const shown=p.frame(.025,false,[bus]);assert.ok(ids(shown).includes('incumbent'));assert.ok(!ids(shown).includes('newborn'));}
 assert.ok(p.diagnostics.renderedPoses.find(p=>p.vehicleId==='incumbent')!.x>.6);
 assert.ok(p.diagnostics.renderedPoses.find(p=>p.vehicleId==='following')!.x>.6,'all already admitted epoch cars retain escape rights');
 assert.equal(p.allowBusMovement('bus',bus,next),true);assert.equal(p.diagnostics.busReservations,0);
});
test('rotation/depot/kerb sweep includes intermediate full long-bus body, not only final position',()=>{
 const p=new TrafficPresentation();p.update([pose('car',.4,.4)]);p.frame(.01,false);
 const from={x:0,z:0,headingX:1,headingZ:0,length:1.32,width:.38},to={...from,headingX:0,headingZ:1};
 assert.equal(p.allowBusMovement('bus',from,to),false);assert.equal(p.diagnostics.removed,0);
 p.reconcileBuses([]);assert.equal(p.diagnostics.busReservations,0);
});
test('paused reservations preserve car identity; removing bus cancels stale admission barrier',()=>{
 const p=new TrafficPresentation(),from={x:0,z:-1,headingX:0,headingZ:1,length:.78,width:.32};p.update([pose('car',0)]);const before=p.frame(.01,false);
 assert.equal(p.allowBusMovement('bus',from,{...from,z:0}),false);assert.deepEqual(p.frame(.25,true,[from]),before);
 p.reconcileBuses(['bus']);assert.equal(p.diagnostics.busReservations,1);p.clearBusReservations();assert.equal(p.diagnostics.busReservations,0);assert.equal(p.diagnostics.removed,0);
});

test('overlapping bus requests let the oldest incumbent drain, then respect committed bus body',()=>{
 const p=new TrafficPresentation();p.update([pose('car',0)]);p.frame(.01,false);p.update([pose('car',2)]);
 const a={x:0,z:-1,headingX:0,headingZ:1,length:.78,width:.32},aTo={...a,z:0};
 const b={x:1,z:1,headingX:0,headingZ:-1,length:1.32,width:.38},bTo={...b,x:.3,z:0};
 assert.equal(p.allowBusMovement('first',a,aTo),false);assert.equal(p.allowBusMovement('second',b,bTo),false);
 for(let n=0;n<100;n++)assert.ok(p.frame(.025,false,[a,b]).some(p=>p.vehicleId==='car'));
 assert.ok(p.diagnostics.renderedPoses[0].x>1.7,'later request cannot trap the first incumbent');
 assert.equal(p.allowBusMovement('first',a,aTo),true);
 assert.equal(p.allowBusMovement('second',b,{...bTo,x:0},[aTo]),false,'actual granted bus body remains authoritative');
 p.reconcileBuses(['second']);assert.equal(p.diagnostics.busReservations,1);p.reconcileBuses([]);assert.equal(p.diagnostics.busReservations,0);
});

test('rear bus requesting first cannot lock the front bus that needs to drain its corridor',()=>{
 const p=new TrafficPresentation(),rear={x:0,z:0,headingX:1,headingZ:0,length:.78,width:.32},front={...rear,x:1};
 assert.equal(p.allowBusMovement('rear',rear,{...rear,x:.3},[front]),false);
 assert.equal(p.allowBusMovement('front',front,{...front,x:1.3},[rear]),true,'existing bus blocker must be allowed to drain');
 assert.equal(p.allowBusMovement('rear',rear,{...rear,x:.3},[{...front,x:1.3}]),true);
});

test('a bus leaving its granted stop corridor can finish clearing a later request',()=>{
 const p=new TrafficPresentation(),out={id:'out',x:0,z:0,headingX:1,headingZ:0,length:.78,width:.32};
 const incoming={...out,id:'return',x:4,headingX:-1};
 const exit={id:'stop-exit',samples:[out,{...out,x:2}]},arrival={id:'stop-arrival',samples:[incoming,{...incoming,x:2}]};
 const departed={...out,x:.1},clearing={...out,x:1.6};
 assert.equal(p.allowBusMovement(out.id,out,departed,[],[],[exit]),true);
 p.frame(.025,false,[departed,incoming]);
 assert.equal(p.allowBusMovement(incoming.id,incoming,{...incoming,x:3.9},[departed],[],[arrival]),false);
 assert.equal(p.diagnostics.selectedDrain,incoming.id);
 assert.equal(p.allowBusMovement(out.id,departed,clearing,[incoming],[],[exit]),true);
 assert.equal(p.allowBusMovement(out.id,clearing,{...clearing,x:1.8},[incoming]),true);
 assert.equal(p.allowBusMovement(out.id,{...clearing,x:1.8},{...clearing,x:2},[incoming]),true);
 assert.equal(p.allowBusMovement(out.id,{...clearing,x:2},incoming,[incoming]),false,'escape rights cannot bypass a real vehicle');
});

test('early next-link hint reserves full turn before a crossing follower enters the corner',()=>{
 const p=new TrafficPresentation(),hint={x:.71,z:0,headingX:1,headingZ:0};
 const turn={...pose('turn',0,1,0,-1),upcomingTurn:hint},cross=pose('cross',-1,0);
 p.update([turn,cross]);p.frame(.01,false);p.update([{...turn,z:.14},{...cross,x:3}]);
 const boxes=(q:CitizenVehiclePose)=>{const x=(Math.abs(q.headingX)*.42+Math.abs(q.headingZ)*.3)/2,z=(Math.abs(q.headingZ)*.42+Math.abs(q.headingX)*.3)/2;return {x0:q.x-x,x1:q.x+x,z0:q.z-z,z1:q.z+z};};
 for(let n=0;n<500;n++){
  if(n===50)p.update([pose('turn',3,0),pose('cross',2.4,0)]);
  const shown=p.frame(1/120,false);assert.deepEqual(ids(shown),['cross','turn']);const [a,b]=shown.map(boxes);
  assert.ok(!(a.x0<b.x1-1e-7&&b.x0<a.x1-1e-7&&a.z0<b.z1-1e-7&&b.z0<a.z1-1e-7),'full bodies never overlap');
 }
 assert.ok(p.diagnostics.renderedPoses.find(v=>v.vehicleId==='turn')!.x>2.9);
 assert.ok(p.diagnostics.renderedPoses.find(v=>v.vehicleId==='cross')!.x>2.3,'follower drains rather than permanent corner lock');assert.equal(p.diagnostics.removed,0);
});

test('bus turn intent keeps two independent corridors through grants, without reserving the inside of an L',()=>{
 const p=new TrafficPresentation();p.update([pose('interior',1,1)]);p.frame(.01,false);
 const east={x:0,z:0,headingX:1,headingZ:0,length:.78,width:.32},north={...east,x:2,headingX:0,headingZ:1};
 const first={id:'first',samples:[east,{...east,x:2},north,{...north,z:2}]},second={id:'second',samples:[{...north,z:2},{...north,z:3}]};
 assert.equal(p.allowBusMovement('bus',{...east,x:-1},{...east,x:-.9},[],[],[first,second]),true,'L corridor must not claim unrelated interior parcel');
 assert.equal(p.diagnostics.busReservations,2);p.update([pose('interior',1,1),pose('birth',.7,0)]);
 assert.deepEqual(ids(p.frame(.01,false)),['interior'],'granted future corridor still excludes a newborn');
 assert.equal(p.allowBusMovement('bus',{...north,z:2},{...north,z:2.1},[],[],[second]),true);
 assert.equal(p.diagnostics.busReservations,1);assert.deepEqual(ids(p.frame(.01,false)),['birth','interior'],'only actual cleared token is released');
 p.reconcileBuses([]);assert.equal(p.diagnostics.busReservations,0);
});


test('bus planning stays bounded to three unique actual-route intents with finite map-bounded samples',()=>{
 const p=new TrafficPresentation(),b={x:0,z:0,headingX:1,headingZ:0,length:.78,width:.32},t={id:'one',samples:[b,b]};
 assert.throws(()=>p.allowBusMovement('bus',b,b,[],[],[t,t]),/bounded/);
 assert.throws(()=>p.allowBusMovement('bus',b,b,[],[],[1,2,3,4].map(i=>({...t,id:String(i)}))),/bounded/);
 assert.throws(()=>p.allowBusMovement('bus',b,b,[],[],[{...t,samples:Array(1155).fill(b)}]),/bounded/);
 assert.equal(p.diagnostics.busReservations,0);
});

test('a bus already draining an older corner keeps that token priority after its body exits, never collision permission',()=>{
 const p=new TrafficPresentation(),car={...pose('corner-owner',0,1,0,-1),upcomingTurn:{x:.71,z:0,headingX:1,headingZ:0}};
 const bus={x:.2,z:0,headingX:1,headingZ:0,length:.78,width:.32},token={id:'stop-call',samples:[bus,{...bus,x:1.6}]};
 assert.equal(p.allowBusMovement('bus',bus,bus),true); // Known physical occupant before the car corridor activates.
 p.update([{...car,upcomingTurn:undefined}]);p.frame(.01,false,[bus]);p.update([{...car,z:.5}]);p.frame(0,false,[bus]);
 assert.equal(p.allowBusMovement('bus',bus,{...bus,x:.3},[],[],[token]),true);
 assert.equal(p.allowBusMovement('bus',{...bus,x:1.5},{...bus,x:1.6},[],[],[token]),true,'same acquired corridor must not lose drain priority while the older car waits behind');
 assert.equal(p.allowBusMovement('bus',{...bus,x:1.6},{...bus,x:0,z:1},[],[],[token]),false,'latched priority never permits moving into the real car body');
 assert.equal(p.diagnostics.removed,0);
});

test('a later bus cannot acquire incumbent status by placing its request inside an already-owned car node',()=>{
 const p=new TrafficPresentation(),car={...pose('node-owner',0,1,0,-1),upcomingTurn:{x:.71,z:0,headingX:1,headingZ:0}};
 p.update([car]);p.frame(.01,false);p.update([{...car,z:.5}]);p.frame(0,false);
 const bus={x:.2,z:0,headingX:1,headingZ:0,length:.78,width:.32};
 assert.equal(p.allowBusMovement('late-bus',bus,{...bus,x:.3}),false);
 assert.equal(p.allowBusMovement('late-bus',bus,{...bus,x:.3}),false,'repeated requests do not change the activation-time incumbent set');
 assert.equal(p.diagnostics.removed,0);
});

test('opposing turns use swept segment unions and explicit centre hold lines in every rotation',()=>{
 for(let turn=0;turn<4;turn++){
  const rotate=(x:number,z:number)=>{for(let n=0;n<turn;n++){const old=x;x=-z;z=old;}return {x,z};};
  const make=(id:string,x:number,z:number,hx:number,hz:number)=>{const p=rotate(x,z),h=rotate(hx,hz);return pose(id,p.x,p.z,h.x,h.z);};
  const hint=(exitX:number,exitZ:number,outX:number,outZ:number,inX:number,inZ:number,entryX:number,entryZ:number)=>{const e=rotate(exitX,exitZ),o=rotate(outX,outZ),i=rotate(inX,inZ),n=rotate(entryX,entryZ);return {x:e.x,z:e.z,headingX:o.x,headingZ:o.z,nodeX:0,nodeZ:0,entryX:n.x,entryZ:n.z,incomingHeadingX:i.x,incomingHeadingZ:i.z,visit:1};};
  const a={...make('a',-.24,1.4,0,-1),upcomingTurn:hint(.71,-.24,1,0,0,-1,-.24,0)},b={...make('b',1.4,.24,-1,0),upcomingTurn:hint(.24,.71,0,1,-1,0,0,.24)};
  const p=new TrafficPresentation();p.update([{...a,upcomingTurn:undefined},{...b,upcomingTurn:undefined}]);p.frame(.01,false);p.update([a,b]);p.frame(0,false);
  p.update([{...make('a',1.4,-.24,1,0),upcomingTurn:a.upcomingTurn},{...make('b',.24,1.4,0,1),upcomingTurn:b.upcomingTurn}]);
  for(let n=0;n<400;n++){
   const cars=p.frame(.025,false);assert.deepEqual(ids(cars),['a','b']);
   const boxes=cars.map(v=>({x:v.x,z:v.z,hx:(Math.abs(v.headingX)*.42+Math.abs(v.headingZ)*.3)/2,hz:(Math.abs(v.headingZ)*.42+Math.abs(v.headingX)*.3)/2}));
   assert.ok(Math.abs(boxes[0].x-boxes[1].x)>=boxes[0].hx+boxes[1].hx+.09-1e-7||Math.abs(boxes[0].z-boxes[1].z)>=boxes[0].hz+boxes[1].hz+.09-1e-7);
  }
  const final=p.diagnostics.renderedPoses;for(const [id,x,z]of [['a',1.4,-.24],['b',.24,1.4]] as const){const q=rotate(x,z),actual=final.find(v=>v.vehicleId===id)!;assert.ok(Math.hypot(actual.x-q.x,actual.z-q.z)<1e-6,'both legal opposing turns finish without losing identities');}
 }
});

test('collinear backlog preserves every conflict-node visit while coalescing only within one visit',()=>{
 const p=new TrafficPresentation();const sample=(x:number,node:number,visit:number)=>({...pose('route',x,-.24),upcomingTurn:{x:node+.71,z:-.24,headingX:1,headingZ:0,nodeX:node,nodeZ:0,entryX:node,entryZ:-.24,incomingHeadingX:1,incomingHeadingZ:0,visit}});
 p.update([sample(-2,0,1)]);p.frame(.01,false);
 p.update([sample(-.5,0,1)]);p.update([sample(1.5,2,2)]);p.update([sample(3.5,4,3)]);
 assert.equal(p.diagnostics.queuedWaypoints,3,'straight-node hints cannot disappear under render lag');
 for(let n=1;n<=100;n++)p.update([sample(3.5+n/200,4,3)]);
 assert.equal(p.diagnostics.queuedWaypoints,3,'same-visit updates remain bounded');
 for(let n=0;n<300;n++)p.frame(.025,false);
 assert.ok(Math.abs(p.diagnostics.renderedPoses[0].x-4)<1e-6);assert.deepEqual(p.diagnostics.renderedIds,['route']);
});

test('same-frame births acquire their node atomically before a follower can occupy its escape',()=>{
 const p=new TrafficPresentation(),front={...pose('front',-.1,-.24),upcomingTurn:{x:.71,z:-.24,headingX:1,headingZ:0,nodeX:0,nodeZ:0,entryX:0,entryZ:-.24,incomingHeadingX:1,incomingHeadingZ:0,visit:1}},rear=pose('rear',-.7,-.24);
 p.update([front,rear]);assert.deepEqual(ids(p.frame(.01,false)),['front']);
 p.update([{...front,x:2},rear]);for(let n=0;n<200;n++)p.frame(.025,false);
 assert.deepEqual(ids(p.frame(0,false)),['front','rear']);assert.equal(p.diagnostics.removed,0);
});

test('finite bus drain epoch lets a front bus escape but cannot promote a later arrival',()=>{
 const p=new TrafficPresentation(),b=(id:string,x:number)=>({id,x,z:0,headingX:1,headingZ:0,length:.78,width:.38});
 assert.equal(p.allowBusMovement('rear',b('rear',0),b('rear',.1),[b('front',.9)]),false);
 assert.equal(p.allowBusMovement('front',b('front',.9),b('front',1.1),[b('rear',0)]),true);
 assert.equal(p.allowBusMovement('new',b('new',.9),b('new',1.1),[b('rear',0)]),false,'a new ID cannot claim captured front identity');
 assert.equal(p.allowBusMovement('front',b('front',1.1),b('front',.9),[b('rear',0)]),false,'drain privilege ends after captured front clears the selected domain');
 assert.equal(p.allowBusMovement('rear',b('rear',0),b('rear',.1),[b('front',1.1)]),true);
});

test('delayed outgoing samples never make a hinted corner overshoot or move backwards',()=>{
 for(const dt of [1/60,.05,.1])for(let rotation=0;rotation<4;rotation++){
  const rot=(x:number,z:number)=>{for(let k=0;k<rotation;k++){const old=x;x=-z;z=old;}return {x,z};};
  const unrot=(x:number,z:number)=>{for(let k=0;k<rotation;k++){const old=x;x=z;z=-old;}return {x,z};};
  const incoming=rot(1,0),outgoing=rot(0,-1),entry=rot(0,-.24),exit=rot(-.24,-.71);
  const hint={x:exit.x,z:exit.z,headingX:outgoing.x,headingZ:outgoing.z,incomingHeadingX:incoming.x,incomingHeadingZ:incoming.z,entryX:entry.x,entryZ:entry.z,nodeX:0,nodeZ:0,visit:1};
  const point=(x:number,z:number,out=false)=>{const q=rot(x,z),h=out?outgoing:incoming;return {...pose('turn',q.x,q.z,h.x,h.z),upcomingTurn:out?undefined:hint};};
  const p=new TrafficPresentation();p.update([point(-1,-.24)]);p.frame(dt,false);p.update([point(0,-.24)]);
  for(let n=0;n<Math.ceil(2/dt);n++)p.frame(dt,false);
  const tangent=unrot(p.diagnostics.renderedPoses[0].x,p.diagnostics.renderedPoses[0].z);assert.ok(Math.abs(tangent.x+.38)<1e-6);
  for(const z of [0,-.05,-.1,-.2]){p.update([point(-.24,z,true)]);for(let n=0;n<4;n++)p.frame(dt,false);const q=unrot(p.diagnostics.renderedPoses[0].x,p.diagnostics.renderedPoses[0].z);assert.ok(Math.abs(q.x+.38)<1e-6&&Math.abs(q.z+.24)<1e-6,'unavailable outgoing geometry cannot move the legal anchor');}
  p.update([point(-.24,-1,true)]);let previous=tangent;
  for(let n=0;n<Math.ceil(3/dt);n++){const cars=p.frame(dt,false);assert.deepEqual(ids(cars),['turn']);const q=unrot(cars[0].x,cars[0].z);assert.ok(q.x>=previous.x-1e-7&&q.z<=previous.z+1e-7);assert.ok(q.x<=-.24+1e-7);previous=q;}
  assert.ok(Math.hypot(previous.x+.24,previous.z+1)<1e-6);
 }
});

test('analytic car sweeps contain all intermediate rotated bodies with the gap applied separately',()=>{
 for(let rotation=0;rotation<4;rotation++){
  const angle=rotation*Math.PI/2,a={...pose('a',0,0,Math.cos(angle),Math.sin(angle))},b={...pose('a',.07,.03,Math.cos(angle+.31),Math.sin(angle+.31))},sweep=presentationCarSweep(a,b);
  for(let n=0;n<=1000;n++){const t=n/1000,hx=a.headingX+(b.headingX-a.headingX)*t,hz=a.headingZ+(b.headingZ-a.headingZ)*t,h=Math.hypot(hx,hz),x=a.x+(b.x-a.x)*t,z=a.z+(b.z-a.z)*t,rx=(Math.abs(hx/h)*.42+Math.abs(hz/h)*.3)/2,rz=(Math.abs(hz/h)*.42+Math.abs(hx/h)*.3)/2;assert.ok(x-rx>=sweep.minX-1e-12&&x+rx<=sweep.maxX+1e-12&&z-rz>=sweep.minZ-1e-12&&z+rz<=sweep.maxZ+1e-12);}
 }
});

test('queued buses leave a real birth opportunity between selected-drain epochs',()=>{
 const p=new TrafficPresentation(),a={id:'a',x:0,z:-1,headingX:0,headingZ:1,length:.78,width:.32},b={id:'b',x:20,z:-1,headingX:0,headingZ:1,length:.78,width:.32};
 p.update([pose('existing',0)]);p.frame(.01,false);p.update([pose('existing',3),pose('newborn',10)]);
 assert.equal(p.allowBusMovement('a',a,{...a,z:0}),false);
 assert.equal(p.allowBusMovement('b',b,{...b,z:0},[a]),true,'disjoint downstream bus need not wait for this drain');
 for(let i=0;i<150;i++)p.frame(.025,false,[a,b]);assert.deepEqual(p.diagnostics.renderedIds,['existing']);
 assert.equal(p.allowBusMovement('a',a,{...a,z:0},[b]),true);
 assert.equal(p.allowBusMovement('b',b,{...b,z:0},[{...a,z:0}]),false,'next queued bus waits for the reserved birth opportunity');
 p.frame(.025,false,[{...a,z:0},b]);assert.ok(p.diagnostics.renderedIds.includes('newborn'));
 assert.equal(p.allowBusMovement('b',b,{...b,z:0},[{...a,z:0}]),true);assert.equal(p.diagnostics.removed,0);
});

test('selection captures the triggering caller when an older different bus wins FIFO',()=>{
 const p=new TrafficPresentation(),b=(id:string,x:number)=>({id,x,z:0,headingX:1,headingZ:0,length:.78,width:.38});
 assert.equal(p.allowBusMovement('previous',b('previous',20),b('previous',20.1)),true);
 assert.equal(p.allowBusMovement('rear',b('rear',0),b('rear',.1),[b('front',.9)]),false);
 p.frame(.025,false,[b('rear',0),b('front',.9)]);
 assert.equal(p.allowBusMovement('front',b('front',.9),b('front',1.1),[b('rear',0)]),true,'front caller is part of the fixed physical epoch even though older rear is selected');
 assert.equal(p.allowBusMovement('rear',b('rear',0),b('rear',.1),[b('front',1.1)]),true);
});

test('a changed pending direction selects a fresh physical epoch without clearing acquired grants',()=>{
 const p=new TrafficPresentation(),b=(id:string,x:number,z=0)=>({id,x,z,headingX:1,headingZ:0,length:.78,width:.38});
 p.update([pose('old-blocker',-1,-1)]);p.frame(.01,false);
 const from=b('a',-1),old={id:'old',samples:[from,b('a',-1,-2)]},next={id:'next',samples:[from,b('a',1)]};
 assert.equal(p.allowBusMovement('a',from,b('a',-.9),[],[],[old]),false);
 assert.equal(p.allowBusMovement('a',from,b('a',-.9),[b('front',0)],[],[next]),false);
 assert.equal(p.allowBusMovement('front',b('front',0),b('front',2),[from]),true,'new domain captures the already-present blocker at the new selection, not the obsolete direction');
 assert.equal(p.allowBusMovement('a',from,b('a',-.9),[b('front',2)],[],[next]),true);
 assert.equal(p.diagnostics.removed,0);
});

test('three-bus queue drains downstream actors outside the selected corridor without stealing its exit',()=>{
 const p=new TrafficPresentation(),b=(id:string,x:number)=>({id,x,z:0,headingX:1,headingZ:0,length:.78,width:.38});
 assert.equal(p.allowBusMovement('rear',b('rear',0),b('rear',.1),[b('front',.9),b('ahead',1.8)]),false);
 assert.equal(p.allowBusMovement('front',b('front',.9),b('front',1),[b('rear',0),b('ahead',1.8)]),false);
 assert.equal(p.allowBusMovement('ahead',b('ahead',1.8),b('ahead',2),[b('rear',0),b('front',.9)]),true,'disjoint downstream motion is not globally frozen');
 assert.equal(p.allowBusMovement('front',b('front',.9),b('front',1.1),[b('rear',0),b('ahead',2)]),true);
 assert.equal(p.allowBusMovement('rear',b('rear',0),b('rear',.1),[b('front',1.1),b('ahead',2)]),true);
});
