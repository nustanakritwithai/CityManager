import test from 'node:test';import assert from 'node:assert/strict';
import {TrafficPresentation,presentationPath} from '../src/traffic/presentation.ts';
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
