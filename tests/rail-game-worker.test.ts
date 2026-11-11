import test from 'node:test';
import assert from 'node:assert/strict';
import {TrafficGame,type TrafficGameSample} from '../src/traffic/game.ts';
import {railGameCovers} from '../src/rail/game-rail.ts';
const map={cells:Array.from({length:576},(_,i)=>({road:i>=25&&i<=32}))};
const sample:TrafficGameSample={map,demand:[{from:25,to:32,rate:2}]};
const stations:[number,number]=[49,56];
const near=(a:number,b:number)=>Math.abs(a-b)<1e-8;

test('reservations, accepted riders and rejected returns conserve the same road demand',()=>{
 assert.equal(railGameCovers(map,stations,25,32),true);
 const g=new TrafficGame(sample),base=new TrafficGame(sample);g.setRail({stations,key:'line',results:[]});
 let f=g.step(),b=base.step();assert.ok(f.rail!.offers.length);assert.ok(near(f.offered+f.rail!.held,b.offered));
 const first=f.rail!.offers[0];g.setRail({stations,key:'line',results:[{id:first.id,accepted:true}]});
 f=g.step();b=base.step();assert.equal(f.rail!.accepted,1);assert.ok(near(f.offered+f.rail!.held+f.rail!.accepted,b.offered));
 const second=f.rail!.offers[0];g.setRail({stations,key:'line',results:[{id:second.id,accepted:false}]});
 f=g.step();b=base.step();assert.ok(near(f.offered+f.rail!.held+f.rail!.accepted,b.offered));
 const repeated=g.frame;g.setRail({stations,key:'line',results:[{id:first.id,accepted:true},{id:second.id,accepted:false}]});assert.deepEqual(g.frame,repeated,'result retries cannot double accept or return');
});
test('disabled or uncovered rail makes no reservation; disabling returns fractional carry',()=>{
 const uncovered=new TrafficGame(sample),base=new TrafficGame(sample);uncovered.setRail({stations:[100,101],key:'line',results:[]});assert.equal(uncovered.step().rail!.held,0);assert.equal(uncovered.frame.offered,base.step().offered);
 const g=new TrafficGame({...sample,demand:[{from:25,to:32,rate:.5}]}),control=new TrafficGame({...sample,demand:[{from:25,to:32,rate:.5}]});g.setRail({stations,key:'line',results:[]});const f=g.step();control.step();assert.ok(f.rail!.held>0&&f.rail!.held<1);g.setRail({stations:null,key:null,results:[]});assert.equal(g.frame.rail!.held,0);assert.ok(near(g.frame.offered,control.frame.offered));
});
test('candidate clone rollback cannot leak reservations or accepted counts',()=>{
 const g=new TrafficGame(sample);g.setRail({stations,key:'line',results:[]});const candidate=g.clone();assert.ok(candidate.step().rail!.offers.length);assert.equal(g.frame.rail!.offers.length,0);assert.equal(g.frame.rail!.accepted,0);
});
test('binned road ODs retain original coverage, and never divert uncovered sources',()=>{
 const g=new TrafficGame(sample);g.setRail({stations,key:'line',results:[]},[
  {roadFrom:25,roadTo:32,from:25,to:32,weight:.25},
  {roadFrom:25,roadTo:32,from:25,to:28,weight:.75},
 ]);for(let i=0;i<8;i++)g.step();const f=g.frame;
 assert.ok(near(f.offered+f.rail!.held,16));assert.ok(near(f.rail!.held,2));
 assert.ok(f.rail!.offers.every(o=>o.from===25&&o.to===32));
});
test('taxi and bus traffic never become rail riders',()=>{
 const g=new TrafficGame({map,demand:[{from:25,to:32,rate:2,taxiRate:2} as any]});g.setRail({stations,key:'line',results:[]});for(let i=0;i<10;i++)g.step();assert.equal(g.frame.rail!.held,0);assert.equal(g.frame.rail!.accepted,0);
});
test('bounded catchments match pedestrian paths including blocked roads',async()=>{
 const {railGameCatchments}=await import('../src/rail/game-rail.ts');const blocked={...map,roadTopology:{version:1 as const,blocked:[27*576+28],oneWay:{}}};
 for(const m of [map,blocked]){const reach=railGameCatchments(m,stations);for(let from=25;from<=32;from++)for(let to=25;to<=32;to++)assert.equal(reach[0].has(from)&&reach[1].has(to)||reach[1].has(from)&&reach[0].has(to),railGameCovers(m,stations,from,to),`${from}->${to}`);}
});
test('changing OD weights retains covered fractional demand instead of starving rail',()=>{
 const g=new TrafficGame({...sample,demand:[{from:25,to:32,rate:1}]}),input={stations,key:'line',results:[]};
 for(let i=0;i<30;i++){const w=i%2?.50:.51;g.setRail(input,[{roadFrom:25,roadTo:32,from:25,to:32,weight:w},{roadFrom:25,roadTo:32,from:25,to:28,weight:1-w}]);g.step();}
 const f=g.frame;assert.ok(f.rail!.offers.length>=7);assert.ok(near(f.offered+f.rail!.held,30));
});
test('removed OD contributor returns its fractional reservation',()=>{
 const g=new TrafficGame({...sample,demand:[{from:25,to:32,rate:1}]});const input={stations,key:'line',results:[]};
 g.setRail(input,[{roadFrom:25,roadTo:32,from:25,to:32,weight:.5}]);g.step();assert.ok(near(g.frame.rail!.held,.25));
 g.setRail(input,[{roadFrom:25,roadTo:32,from:25,to:28,weight:1}]);assert.equal(g.frame.rail!.held,0);assert.ok(near(g.frame.offered,1));
});
test('mixed bus and rail use the same private road budget without duplicate diversion',()=>{
 const g=new TrafficGame(sample),base=new TrafficGame(sample);
 g.setBus({stops:[{id:1,cell:25,side:'n',level:1},{id:2,cell:32,side:'n',level:1}],lines:[{line:{id:1,depotId:1,stopIds:[1,2],busCount:1,busLevel:1},waitMinutes:0,ride:{'1:2':1,'2:1':1}}],load:{},returns:{}});
 g.setRail({stations,key:'line',results:[]});
 for(let i=0;i<20;i++){const f=g.step();base.step();const results=f.rail!.offers.map(o=>({id:o.id,accepted:o.id%2===0}));g.setRail({stations,key:'line',results});const settled=g.frame;assert.ok(near(settled.offered+settled.rail!.held+settled.rail!.accepted+settled.bus!.diverted,base.frame.offered));}
 assert.ok(g.frame.bus!.diverted>0);assert.ok(g.frame.rail!.accepted>0);
});
