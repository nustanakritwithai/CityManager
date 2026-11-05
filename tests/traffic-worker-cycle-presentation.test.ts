import test from 'node:test';import assert from 'node:assert/strict';
import {TrafficGame,type TrafficGameSample} from '../src/traffic/game.ts';
import {gamePoses} from '../src/traffic/game-poses.ts';
import {TrafficPresentation} from '../src/traffic/presentation.ts';
import {vehicleBox,boxesOverlap} from '../src/traffic/spacing.ts';
const sample=():TrafficGameSample=>{const roads=new Set<number>();for(let y=3;y<=5;y++)for(let x=3;x<=5;x++)roads.add(y*24+x);const corners=[75,77,123,125];return {map:{cells:Array.from({length:576},(_,i)=>({road:roads.has(i)}))},demand:corners.flatMap(from=>corners.filter(to=>to!==from).map(to=>({from,to,rate:1})))};};
for(const cadence of [{name:'normal',wall:25,dt:.025},{name:'low FPS',wall:435,dt:.1}])test(`dense worker cycle prevention drains actual stable presentation at ${cadence.name}`,()=>{
 const source=sample(),game=new TrafficGame(source),presenter=new TrafficPresentation();let now=0,anchor=0,stopAt:number|null=null,completedAt160=0;
 let prior=new Set<string>();const ever=new Set<string>();let sawCars=false,frame=game.frame;
 const accept=()=>presenter.update(gamePoses(frame.cars,frame.groups,24,2,128),gamePoses(frame.cars,frame.groups),frame.cars.map(c=>`game:${c.id}`),frame.cars);accept();
 // Production scheduling: no catch-up burst; worker wall clock and capped physical dt remain distinct.
 const loadFrames=Math.ceil(240*1000/cadence.wall)*2,drainFrames=Math.ceil(240/cadence.dt);
 for(let i=0;i<loadFrames+drainFrames;i++){
  now+=cadence.wall;
  if(now-anchor>=1000){anchor=now;frame=game.step();accept();if(frame.step===160)completedAt160=frame.completed;
   if(frame.step===240){assert.ok(frame.completed>completedAt160,'saturated worker still completes trips instead of entering a closed wait cycle');const moving=frame.moving;game.setSample({...source,demand:[]});frame=game.frame;assert.equal(frame.moving,moving,'only waiting demand is cancelled, no active actor dropped');accept();stopAt=i;}
  }
  const poses=presenter.frame(cadence.dt,false),diag=presenter.diagnostics,current=new Set(poses.map(p=>p.vehicleId));sawCars ||= poses.length>0;
  for(const id of prior)if(!current.has(id)){assert.ok(diag.lastRemoved.includes(id),'every visible removal is recorded terminal retirement');assert.ok(!frame.cars.some(c=>`game:${c.id}`===id),'live worker identity cannot disappear');}
  for(const id of current){if(!prior.has(id))assert.ok(!ever.has(id),'admitted identity cannot flash out and reappear');ever.add(id);}prior=current;
  for(let a=0;a<poses.length;a++)for(let b=a+1;b<poses.length;b++){const x=vehicleBox(poses[a],.42,.3),y=vehicleBox(poses[b],.42,.3);assert.equal(boxesOverlap({minX:x.minX-.09,maxX:x.maxX+.09,minZ:x.minZ-.09,maxZ:x.maxZ+.09},y,1e-7),false,'actual displayed bodies preserve the full gap');}
  assert.ok(Math.abs(frame.offered-frame.completed-frame.dropped-frame.cancelled-frame.waiting-frame.moving)<1e-6);
  if(stopAt!==null&&i-stopAt>=drainFrames)break;
 }
 assert.ok(sawCars&&stopAt!==null);assert.equal(frame.moving,0,'all actual active worker trips finish after finite demand stops');assert.equal(presenter.diagnostics.renderedIds.length,0,'no retired actor remains permanently frozen at a junction');assert.equal(presenter.diagnostics.queuedWaypoints,0);
});
