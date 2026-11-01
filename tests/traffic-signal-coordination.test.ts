import test from 'node:test';import assert from 'node:assert/strict';
import {TrafficGame,type TrafficGameSample} from '../src/traffic/game.ts';
import {chooseSignal,SIGNAL_URGENT_WAIT} from '../src/traffic/adaptive-signals.ts';
import {buildSignalCorridors,neighborSignalBias,SIGNAL_NEIGHBOR_BIAS,type NeighborSignalState} from '../src/traffic/signal-coordination.ts';
import {buildNetwork} from '../src/traffic/network.ts';
const sample=():TrafficGameSample=>({map:{cells:Array.from({length:576},(_,i)=>({road:[49,50,51,52,53,54,26,74,29,77].includes(i)}))},demand:[{from:49,to:54,rate:1},{from:54,to:49,rate:.3},{from:26,to:74,rate:.1},{from:29,to:77,rate:.1}]});
test('bounded direct-road corridors stop at the next controlled junction',()=>{
 const net=buildNetwork(sample().map),rows=buildSignalCorridors(net,new Set([50,53]),new Set());assert.deepEqual(rows.get('50>51'),{from:50,to:53,approach:52,distance:3,first:51});assert.equal(rows.has('50>26'),false);
});
test('neighbor forecast is soft, bounded, arrival-aware and cannot override urgent age',()=>{
 const state:NeighborSignalState={node:53,phase:{approach:52,since:0,clearUntil:0},queue:1,space:1,byApproach:{52:1}};
 assert.equal(neighborSignalBias(state,52,5,1,1),SIGNAL_NEIGHBOR_BIAS);assert.equal(neighborSignalBias(state,52,50,1,1),0);assert.equal(neighborSignalBias(state,52,5,9,1),0);assert.equal(neighborSignalBias(state,52,5,1,0),0);assert.equal(neighborSignalBias(undefined,52,5,1,1),0);
 const now=SIGNAL_URGENT_WAIT;assert.equal(chooseSignal(undefined,[{approach:1,queue:3,oldest:now,coordination:.75},{approach:2,queue:1,oldest:0,coordination:-.75}],now,false).approach,2);
});
test('two-phase neighbor decisions are invariant to junction iteration and clone state',()=>{
 const g=new TrafficGame(sample()),reverse=g.clone();const intern=reverse as unknown as {junctions:Set<number>};intern.junctions=new Set([...intern.junctions].reverse());
 for(let i=0;i<180;i++){assert.deepEqual(g.step(i%29===0),reverse.step(i%29===0));if(i%40===0)assert.deepEqual(g.clone().step(),reverse.clone().step());}
});
test('red neighbors never veto buffered progress; lost messages fall back to local admission',()=>{
 const g=new TrafficGame(sample()),local=new TrafficGame(sample());const localState=local as unknown as {coordinateSignals(...args:unknown[]):void};localState.coordinateSignals=()=>{};const state=g as unknown as {signalPeers:{exchange(...args:unknown[]):void;read(...args:unknown[]):unknown[]}};state.signalPeers.exchange=()=>{};state.signalPeers.read=()=>[];
 let before=g.frame;const served=new Set<number>();for(let i=0;i<180;i++){const f=g.step(),ids=new Set(f.cars.map(c=>c.id));assert.deepEqual(f,local.step());for(const c of before.cars)if(!ids.has(c.id))served.add(c.destination!);before=f;}
 assert.equal(served.size,4);assert.ok(g.frame.completed>0);
});
test('neighbor red or green cannot bypass actual blocked exit space',()=>{
 const g=new TrafficGame(sample());type A={id:number;destination:number;path:number[];index:number;blocked:boolean;progress:number;speed:number;lane:number};
 const state=g as unknown as {cars:A[];signalPeers:{read(...args:unknown[]):unknown[]};signalSnapshots:Map<number,{queue:number;byApproach?:Readonly<Record<number,number>>}>;substep(dt:number,grant:Map<number,number>):void};
 state.signalPeers.read=()=>[{origin:53,route:[53,50],payload:{node:53,approach:52,since:0,clearUntil:0,queue:0,space:1,byApproach:{}}}];
 state.cars=[{id:1,destination:54,path:[49,50,51,52,53,54],index:0,blocked:false,progress:.6,speed:0,lane:0},{id:2,destination:54,path:[50,51,52,53,54],index:0,blocked:false,progress:.01,speed:0,lane:0}];
 const grants=new Map<number,number>();state.substep(0,grants);assert.notEqual(grants.get(50),1);assert.equal(state.signalSnapshots.get(50)?.byApproach?.[49],1);assert.ok(state.signalSnapshots.get(50)!.queue>0);
});
test('RRT-selected extra peer messages influence only bounded pressure on their routed first hop',()=>{
 const g=new TrafficGame(sample());type A={id:number;destination:number;path:number[];index:number;blocked:boolean;progress:number;speed:number;lane:number};
 const state=g as unknown as {signalPeers:{read(...args:unknown[]):unknown[]};coordinateSignals(...args:unknown[]):void};
 const actor:A={id:1,destination:54,path:[49,50,51,52,53,54],index:0,blocked:false,progress:.6,speed:0,lane:0};
 const direct={origin:53,route:[53,50],payload:{node:53,approach:52,since:0,clearUntil:0,queue:0,space:1,byApproach:{}}},far={origin:56,route:[56,53,50],payload:{node:56,approach:null,since:0,clearUntil:0,queue:3,space:0,byApproach:{}}};
 const score=(messages:unknown[])=>{state.signalPeers.read=()=>messages;const d={approach:49,queue:1,oldest:0,coordination:0};state.coordinateSignals(new Map([[50,new Map([[49,d]])]]),new Set([actor]),new Map());return d.coordination;};
 const base=score([direct]),pressure=score([direct,far]);assert.ok(pressure<base);assert.ok(Math.abs(pressure)<=SIGNAL_NEIGHBOR_BIAS);
 assert.equal(score([direct,{...far,route:[56,29,50]}]),base);
});
test('actual four-junction session exchanges cached multi-hop RRT replies without per-step search',()=>{
 const roads=[...Array.from({length:12},(_,i)=>49+i),26,74,29,77,32,80,35,83],g=new TrafficGame({map:{cells:Array.from({length:576},(_,i)=>({road:roads.includes(i)}))},demand:[{from:49,to:60,rate:1},{from:32,to:80,rate:.3}]});
 const state=g as unknown as {signalPeers:{stats():{searches:number;accepted:number};read(node:number,step:number):{route:readonly number[]}[]};junctionClock:number};const searches=state.signalPeers.stats().searches;let extra=false;
 for(let i=0;i<60;i++){g.step();extra||=state.signalPeers.read(50,state.junctionClock).some(m=>m.route.length>2);}
 assert.ok(extra);assert.ok(state.signalPeers.stats().accepted>0);assert.equal(state.signalPeers.stats().searches,searches);
});
test('a fresh neighboring green can decide an otherwise equal local tie through actual cached replies',()=>{
 const roads=[49,50,51,52,26,74,27,75],input={map:{cells:Array.from({length:576},(_,i)=>({road:roads.includes(i)}))},demand:[]};
 type A={id:number;destination:number;path:number[];index:number;blocked:boolean;progress:number;speed:number;lane:number};
 type Internal={cars:A[];junctionClock:number;signalSnapshots:Map<number,unknown>;signalSnapshotStep:number;coordinateSignals(...args:unknown[]):void;substep(dt:number,grant:Map<number,number>):void;signalPeers:{stats():{accepted:number}}};
 const run=(coordinate:boolean,age=0)=>{const g=new TrafficGame(input),state=g as unknown as Internal;state.junctionClock=age;
  state.cars=[{id:1,destination:52,path:[49,50,51,52],index:0,blocked:false,progress:.6,speed:0,lane:0},{id:2,destination:74,path:[26,50,74],index:0,blocked:false,progress:.6,speed:0,lane:0}];
  state.signalSnapshots=new Map([[51,{node:51,approach:50,state:'green',since:0,clearUntil:0,queue:1,space:1,byApproach:{50:1}}]]);state.signalSnapshotStep=0;if(!coordinate)state.coordinateSignals=()=>{};
  const grants=new Map<number,number>();state.substep(0,grants);assert.ok(state.signalPeers.stats().accepted>0);return grants.get(50);
 };
 assert.equal(run(false),2);assert.equal(run(true),1);assert.equal(run(true,3),2);
});
