import test from 'node:test';import assert from 'node:assert/strict';
import {TrafficGame} from '../src/traffic/game.ts';
test('saturated four-way junction serves all approaches fairly without stealing an occupied corridor',()=>{
 const roads=new Set([49,50,51,26,74]),sample={map:{cells:Array.from({length:576},(_,i)=>({road:roads.has(i)}))},demand:[{from:49,to:51,rate:2},{from:26,to:74,rate:2},{from:51,to:26,rate:2},{from:74,to:49,rate:2}]};
 const game=new TrafficGame(sample),copy=game.clone(),counts=new Map<number,number>();let before=game.frame;
 for(let n=0;n<120;n++){const frame=game.step();assert.deepEqual(frame,copy.step());const live=new Set(frame.cars.map(c=>c.id));for(const c of before.cars)if(!live.has(c.id))counts.set(c.destination!,1+(counts.get(c.destination!)??0));before=frame;}
 assert.equal(counts.size,4);assert.ok(Math.min(...counts.values())>=12);assert.ok(Math.max(...counts.values())-Math.min(...counts.values())<=2);
 const f=game.frame;assert.ok(Math.abs(f.offered-f.completed-f.cars.length-f.waiting-f.dropped-f.cancelled)<1e-6);
 const clone=game.clone();for(let n=0;n<20;n++)assert.deepEqual(game.step(),clone.step());
});

test('a downstream link with spare count but no physical tail room cannot grant the junction',()=>{
 const roads=new Set([49,50,51,26,74]);const game=new TrafficGame({map:{cells:Array.from({length:576},(_,i)=>({road:roads.has(i)}))},demand:[]});
 type A={id:number;destination:number;path:number[];index:number;blocked:boolean;progress:number;speed:number;lane:number};
 const internal=game as unknown as {cars:A[];substep(dt:number,grant:Map<number,number>):void;pickLaneWouldFit(key:string,lane:number):boolean;junctionExitClear(key:string,lane:number):boolean};
 internal.cars=[{id:1,destination:51,path:[49,50,51],index:0,blocked:false,progress:.6,speed:0,lane:0},{id:2,destination:51,path:[50,51],index:0,blocked:false,progress:.01,speed:0,lane:0}];
 const key=game.frame.groups.find(g=>g.from===50&&g.to===51)!.key;assert.equal(internal.pickLaneWouldFit(key,0),true);assert.equal(internal.junctionExitClear(key,0),false);
 const grants=new Map<number,number>();internal.substep(0,grants);assert.notEqual(grants.get(50),1);assert.ok(internal.cars.find(c=>c.id===1)!.progress<=.645);
 internal.cars[1].progress=.7;assert.equal(internal.junctionExitClear(key,0),true);
});
test('junction visit identity remains monotonic across actor route replans and clones',()=>{
 const roads=new Set([49,50,51,26,74]),sample=()=>({map:{cells:Array.from({length:576},(_,i)=>({road:roads.has(i)}))},demand:[{from:49,to:51,rate:2},{from:26,to:74,rate:2}]});const game=new TrafficGame(sample()),seen=new Map<number,number>();let advanced=false;
 for(let n=0;n<40;n++){
  if(n===8){roads.add(25);roads.add(27);game.setSample(sample());}
  const clone=game.clone(),frame=game.step();assert.deepEqual(frame,clone.step());
  for(const c of frame.cars){assert.ok(Number.isSafeInteger(c.nextVisit)&&c.nextVisit!>=1);const prior=seen.get(c.id);if(prior!==undefined){assert.ok(c.nextVisit!>=prior);if(c.nextVisit!>prior)advanced=true;}seen.set(c.id,c.nextVisit!);}
 }
 assert.ok(advanced);
});
