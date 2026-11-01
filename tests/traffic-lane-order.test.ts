import test from 'node:test';
import assert from 'node:assert/strict';
import {TrafficGame} from '../src/traffic/game.ts';
import {gamePoses} from '../src/traffic/game-poses.ts';
import {TrafficPresentation} from '../src/traffic/presentation.ts';
import {vehicleBox,boxesOverlap} from '../src/traffic/spacing.ts';
test('four-arm junction does not leave a visible car permanently waiting behind a same-lane reservation',()=>{
const roads = new Set<number>();
for (let i=3;i<=9;i++){roads.add(6*24+i);roads.add(i*24+6);}
const ends=[147,78,222,153];
const game=new TrafficGame({map:{cells:Array.from({length:576},(_,i)=>({road:roads.has(i)}))},demand:ends.flatMap(from=>ends.filter(to=>to!==from).map(to=>({from,to,rate:.5})))});
const presenter:any=new TrafficPresentation();let frame=game.frame;
let longest={id:'',seconds:0,greenSeconds:0};
const stationary=new Map<string,{x:number;z:number;start:number;green:number}>();
const seen=new Set<string>();let previous=new Map<string,{x:number;z:number}>(),sameIdAdvanced=false;
let sourceStopped=false,longestAtStop=0;
for(let tick=1;tick<=9600;tick++){
 const seconds=tick*.025;
 if(tick%40===0){frame=game.step();if(tick===2400){game.setSample({map:{cells:Array.from({length:576},(_,i)=>({road:roads.has(i)}))},demand:[]});frame=game.frame;sourceStopped=true;}presenter.update(gamePoses(frame.cars,frame.groups,24,2,128),gamePoses(frame.cars,frame.groups),frame.cars.map(c=>`game:${c.id}`));}
 const poses=presenter.frame(.025,false),current=new Map(poses.map(p=>[p.vehicleId,p]));
 for(const [id,old] of previous)if(!current.has(id)){assert.ok(presenter.diagnostics.lastRemoved.includes(id),'visible removal is recorded');assert.ok(!frame.cars.some(c=>`game:${c.id}`===id),'live identity cannot disappear');}
 for(const pose of poses){
  const prior=previous.get(pose.vehicleId);
  if(!prior){assert.ok(!seen.has(pose.vehicleId),'removed identity cannot reappear');seen.add(pose.vehicleId);}
  else {const d=Math.hypot(pose.x-prior.x,pose.z-prior.z);assert.ok(d<=.05+1e-7,'no teleport');if(pose.vehicleId==='game:2'&&seconds>10&&d>1e-6)sameIdAdvanced=true;}
  const old=stationary.get(pose.vehicleId);const state=old&&Math.hypot(pose.x-old.x,pose.z-old.z)<1e-6?old:{x:pose.x,z:pose.z,start:seconds,green:0};stationary.set(pose.vehicleId,state);
  const entry=presenter.entries.get(pose.vehicleId);const hint=entry.path.find((p:any)=>p.upcomingTurn)?.upcomingTurn??entry.last.upcomingTurn;
  if(hint?.nodeX!==undefined){const node=Math.round(hint.nodeZ/2+11.5)*24+Math.round(hint.nodeX/2+11.5);const approach=node-(hint.incomingHeadingX??pose.headingX)-(hint.incomingHeadingZ??pose.headingZ)*24;const phase=frame.signals?.phases.find(s=>s.node===node);if(phase?.state==='green'&&phase.approach===approach)state.green+=.025;}
  if(seconds-state.start>longest.seconds)longest={id:pose.vehicleId,seconds:seconds-state.start,greenSeconds:state.green};
 }
 for(let a=0;a<poses.length;a++)for(let b=a+1;b<poses.length;b++){const x=vehicleBox(poses[a],.42,.3),y=vehicleBox(poses[b],.42,.3);assert.equal(boxesOverlap({minX:x.minX-.09,maxX:x.maxX+.09,minZ:x.minZ-.09,maxZ:x.maxZ+.09},y,1e-7),false,'standstill gap');}
 assert.ok(Math.abs(frame.offered-frame.completed-frame.dropped-frame.cancelled-frame.waiting-frame.moving)<1e-6,'worker conservation');
 previous=new Map(poses.map(p=>[p.vehicleId,{x:p.x,z:p.z}]));
 if(tick===2400)longestAtStop=longest.seconds;
 if(sourceStopped&&frame.moving===0&&presenter.diagnostics.renderedIds.length===0&&presenter.diagnostics.deferredIds.length===0)break;
}
assert.ok(frame.completed>20, 'worker made progress');
assert.ok(longestAtStop<25, `longest visible stop at 60 seconds: ${longestAtStop}`);
assert.ok(sameIdAdvanced,'same visible leader advances after its initial wait');
assert.ok(sourceStopped);assert.equal(frame.moving,0);assert.equal(presenter.diagnostics.renderedIds.length,0);assert.equal(presenter.diagnostics.queuedWaypoints,0);
});

for(const [hx,hz] of [[1,0],[0,1],[-1,0],[0,-1]])for(const turn of [-1,0,1]){
 test(`front vehicle gets the incoming corridor first: heading ${hx},${hz}, turn ${turn}`,()=>{
  const p:any=new TrafficPresentation(),at=(id:string,along:number)=>({vehicleId:id,x:hx*along,z:hz*along,headingX:hx,headingZ:hz,paint:0,speed:0});
  const out=turn===0?{x:hx,z:hz}:turn===1?{x:-hz,z:hx}:{x:hz,z:-hx};
  const hint=(x:number,z:number)=>({x:.71*x,z:.71*z,headingX:x,headingZ:z,nodeX:0,nodeZ:0,incomingHeadingX:hx,incomingHeadingZ:hz,entryX:0,entryZ:0,visit:1});
  const rear=at('rear',-3),front=at('front',-2);
  p.update([rear,front]);p.frame(.025,false);
  p.update([{...rear,upcomingTurn:hint(hx,hz)},{...front,upcomingTurn:hint(out.x,out.z)}]);p.frame(.025,false);
  const grants=[...p.corners.values()] as any[];
  assert.equal(grants.find(g=>g.owner==='front')?.active,true);
  assert.equal(grants.find(g=>g.owner==='rear')?.active,false);
  assert.deepEqual(new Set(p.diagnostics.renderedIds),new Set(['front','rear']));
 });
}

test('a new leader cannot appear in front of an already committed incoming corridor',()=>{
 const p:any=new TrafficPresentation(),pose=(id:string,x:number)=>({vehicleId:id,x,z:0,headingX:1,headingZ:0,paint:0,speed:0});
 const hint={x:.71,z:0,headingX:1,headingZ:0,nodeX:0,nodeZ:0,incomingHeadingX:1,incomingHeadingZ:0,entryX:0,entryZ:0,visit:1};
 const rear=pose('rear',-3),front=pose('front',-2);
 p.update([rear]);p.frame(.025,false);p.update([{...rear,upcomingTurn:hint}]);p.frame(.025,false);
 assert.equal([...p.corners.values()].find((r:any)=>r.owner==='rear').active,true);
 p.update([{...rear,x:2,upcomingTurn:hint},front]);p.frame(.025,false);
 assert.deepEqual(p.diagnostics.renderedIds,['rear']);assert.deepEqual(p.diagnostics.deferredIds,['front']);
 for(let i=0;i<200&&!p.diagnostics.renderedIds.includes('front');i++)p.frame(.025,false);
 assert.ok(p.diagnostics.renderedIds.includes('front'),'deferred front actor is admitted after the grant clears');
 assert.equal(p.diagnostics.removed,0);
});
