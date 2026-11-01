import test from 'node:test';import assert from 'node:assert/strict';
import {chooseSignal,SIGNAL_MIN_GREEN,SIGNAL_MAX_GREEN,SIGNAL_CLEARANCE,SIGNAL_URGENT_WAIT} from '../src/traffic/adaptive-signals.ts';
import {TrafficGame} from '../src/traffic/game.ts';
const demand=(approach:number,queue=1,oldest=0)=>({approach,queue,oldest});
test('queue pressure chooses real demand, skips empty phases, and is deterministic',()=>{
 assert.equal(chooseSignal(undefined,[],0,false).approach,null);
 assert.equal(chooseSignal(undefined,[demand(2,1),demand(1,8)],0,false).approach,1);
 assert.deepEqual(chooseSignal(undefined,[demand(2),demand(1)],0,false),chooseSignal(undefined,[demand(1),demand(2)],0,false));
});
test('minimum green holds bursts; maximum green and oldest feasible demand trigger all-red',()=>{
 const phase={approach:1,since:0,clearUntil:0},rows=[demand(1),demand(2,9)];
 assert.equal(chooseSignal(phase,rows,SIGNAL_MIN_GREEN-1,false),phase);
 const red=chooseSignal(phase,rows,SIGNAL_MIN_GREEN,false);assert.equal(red.approach,null);
 assert.equal(chooseSignal(red,rows,SIGNAL_MIN_GREEN+SIGNAL_CLEARANCE-1,false),red);
 assert.equal(chooseSignal(red,rows,SIGNAL_MIN_GREEN+SIGNAL_CLEARANCE,false).approach,2);
 const maximum=chooseSignal(phase,[demand(1,20),demand(2)],SIGNAL_MAX_GREEN,false);assert.equal(maximum.approach,null);
 assert.equal(chooseSignal(maximum,[demand(1,20),demand(2)],SIGNAL_MAX_GREEN+SIGNAL_CLEARANCE,false).approach,2);
 const now=SIGNAL_URGENT_WAIT;assert.equal(chooseSignal(undefined,[demand(1,30,now-1),demand(2,1,0)],now,false).approach,2);
});
test('physical occupant cannot be revoked, even after max green; empty active approach gaps out',()=>{
 const phase={approach:1,since:0,clearUntil:0};assert.equal(chooseSignal(phase,[demand(2)],999,true),phase);
 const red=chooseSignal(phase,[demand(2)],1000,false);assert.equal(red.approach,null);assert.equal(red.clearUntil,1000+SIGNAL_CLEARANCE);
 const held=chooseSignal(red,[demand(2)],2000,true);assert.equal(held.approach,null);assert.equal(held.clearUntil,2000+SIGNAL_CLEARANCE);
});
const sample=()=>{const roads=new Set([49,50,51,26,74]);return {map:{cells:Array.from({length:576},(_,i)=>({road:roads.has(i)}))},demand:[{from:49,to:51,rate:3},{from:26,to:74,rate:.2},{from:51,to:26,rate:.2},{from:74,to:49,rate:.2}]};};
test('asymmetric straight and turning traffic all progress; pause, clone and reset isolate phases',()=>{
 const s=sample(),g=new TrafficGame(s),served=new Map<number,number>();let before=g.frame;
 for(let i=0;i<240;i++){const frame=g.step(),ids=new Set(frame.cars.map(c=>c.id));for(const c of before.cars)if(!ids.has(c.id))served.set(c.destination!,1+(served.get(c.destination!)??0));before=frame;}
 assert.equal(served.size,4);assert.ok(Math.min(...served.values())>10);assert.ok(served.get(51)!>served.get(74)!);
 assert.deepEqual(g.step(true),g.frame);const clone=g.clone();for(let i=0;i<20;i++)assert.deepEqual(g.step(),clone.step());
 g.reset();assert.deepEqual(g.frame,new TrafficGame(s).frame);const fresh=new TrafficGame(s);for(let i=0;i<20;i++)assert.deepEqual(g.step(),fresh.step());
});

test('saturated exit does not win a phase or admit into the box; road edits clear phases without consuming time',()=>{
 const s=sample(),g=new TrafficGame({...s,demand:[]});
 type A={id:number;destination:number;path:number[];index:number;blocked:boolean;progress:number;speed:number;lane:number};
 const state=g as unknown as {cars:A[];signals:Map<number,{approach:number|null}>;substep(dt:number,grant:Map<number,number>):void};
 const actor=(id:number,path:number[],progress:number):A=>({id,path,destination:path.at(-1)!,index:0,blocked:false,progress,speed:0,lane:0});
 state.cars=[actor(1,[49,50,51],.6),actor(2,[50,51],.01),actor(3,[26,50,74],.6)];
 const grants=new Map<number,number>();state.substep(0,grants);assert.equal(state.signals.get(50)?.approach,26);assert.equal(grants.get(50),3);
 const before=g.frame;const cut=structuredClone(s);cut.map.cells[49].road=false;g.setSample(cut);assert.equal(state.signals.size,0);assert.equal(g.frame.step,before.step);assert.equal(g.frame.cars.length,before.cars.length);
});
test('a phase change leaves all-red without new grants, then admits only the selected approach',()=>{
 const s=sample(),g=new TrafficGame({...s,demand:[]});
 type A={id:number;destination:number;path:number[];index:number;blocked:boolean;progress:number;speed:number;lane:number};
 const state=g as unknown as {cars:A[];junctionClock:number;signals:Map<number,{approach:number|null;since:number;clearUntil:number}>;substep(dt:number,grant:Map<number,number>):void};
 state.cars=[{id:1,destination:74,path:[26,50,74],index:0,blocked:false,progress:.6,speed:0,lane:0}];
 state.signals.set(50,{approach:49,since:0,clearUntil:0});state.junctionClock=20;
 for(let i=0;i<SIGNAL_CLEARANCE;i++){const grants=new Map<number,number>();state.substep(0,grants);assert.equal(grants.has(50),false);}
 const grants=new Map<number,number>();state.substep(0,grants);assert.equal(grants.get(50),1);assert.equal(state.signals.get(50)?.approach,26);
});

test('unknown signal after topology rebuild waits for incumbent and a fresh clearance interval',()=>{
 const demandRows=[demand(26)];let phase=chooseSignal(undefined,demandRows,10,true);assert.equal(phase.approach,null);
 phase=chooseSignal(phase,demandRows,30,true);assert.equal(phase.approach,null);assert.equal(phase.clearUntil,30+SIGNAL_CLEARANCE);
 assert.equal(chooseSignal(phase,demandRows,31,false).approach,null);
 assert.equal(chooseSignal(phase,demandRows,32,false).approach,26);
});
test('topology rebuild reconstructs the incumbent grant before initializing unknown signals',()=>{
 const s=sample(),g=new TrafficGame({...s,demand:[]});
 type A={id:number;destination:number;path:number[];index:number;blocked:boolean;progress:number;speed:number;lane:number};
 const state=g as unknown as {cars:A[];signals:Map<number,{approach:number|null;clearUntil:number}>;junctionClock:number;substep(dt:number,grant:Map<number,number>):void};
 state.cars=[{id:1,destination:51,path:[50,51],index:0,blocked:false,progress:.1,speed:0,lane:0},{id:2,destination:74,path:[26,50,74],index:0,blocked:false,progress:.6,speed:0,lane:0}];
 const edit=structuredClone(s);edit.demand=[];edit.map.cells[100].road=true;g.setSample(edit);assert.equal(state.signals.size,0);
 const original=state.substep.bind(g);let first=true,clearing=false,sawClearance=false;
 state.substep=(dt,grant)=>{if(first)assert.equal(grant.get(50),1);original(dt,grant);if(first){assert.equal(state.signals.get(50)?.approach,null);first=false;}
  if(grant.get(50)===1){assert.equal(state.signals.get(50)?.approach,null);clearing=true;}
  else if(clearing&&state.junctionClock<state.signals.get(50)!.clearUntil){assert.equal(grant.has(50),false);sawClearance=true;}
 };
 for(let i=0;i<5;i++)g.step();assert.ok(sawClearance);
});
test('handoff re-evaluates spillback and may return to old green only if no alternative is feasible',()=>{
 const phase={approach:1,since:0,clearUntil:0},red=chooseSignal(phase,[demand(1,20),demand(2)],SIGNAL_MAX_GREEN,false);
 assert.equal(chooseSignal(red,[demand(1,20)],SIGNAL_MAX_GREEN+SIGNAL_CLEARANCE,false).approach,1);
 assert.equal(chooseSignal(red,[demand(1,20),demand(3)],SIGNAL_MAX_GREEN+SIGNAL_CLEARANCE,false).approach,3);
});
test('grouped eligibility keeps live bus-capacity and physical tail-room guards',()=>{
 for(const [load,tail,expected] of [[0,.7,true],[1,.7,true],[2,.7,false],[3,.7,false],[0,.01,false]] as const){
  const g=new TrafficGame({...sample(),demand:[]});g.setBus({stops:[],lines:[],load:{'50>51':load},returns:{}});
  type A={id:number;destination:number;path:number[];index:number;blocked:boolean;progress:number;speed:number;lane:number};
  const state=g as unknown as {cars:A[];substep(dt:number,grant:Map<number,number>):void;junctionExitClear(key:string,lane:number):boolean};
  state.cars=[{id:1,destination:51,path:[49,50,51],index:0,blocked:false,progress:.6,speed:0,lane:0},{id:2,destination:51,path:[50,51],index:0,blocked:false,progress:tail,speed:0,lane:0}];
  assert.equal(state.junctionExitClear('50>51',0),expected);const grants=new Map<number,number>();state.substep(0,grants);assert.equal(grants.get(50)===1,expected);
 }
});
