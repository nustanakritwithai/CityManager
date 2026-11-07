import test from 'node:test';
import assert from 'node:assert/strict';
import {createCity,serialize,type City} from '../src/sim.ts';
import {createBus} from '../src/bus/buildings.ts';
import {createBusLine} from '../src/bus/lines.ts';
import {BusGameBridge} from '../src/bus/game-bridge.ts';
import {TrafficGame,captureTrafficGameInput,trafficGameSampleFromInput,normalizeTrafficGameSample,type TrafficGameInput} from '../src/traffic/game.ts';
import {createTrafficGameWorkerEngine} from '../src/traffic/game-worker-engine.ts';
import {allocateGameModes,compileGameModal} from '../src/traffic/game-modal.ts';

const at=(x:number,y:number)=>y*24+x;
const approx=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
function fixture(){
 const c=createCity(1,{starter:false});
 for(let x=0;x<=20;x++)c.cells[at(x,2)].road=true;
 c.buildings=[{id:1,cell:at(2,3),zone:'R',level:1,age:0},{id:2,cell:at(3,3),zone:'C',level:1,age:0},{id:3,cell:at(4,3),zone:'C',level:1,age:0},{id:4,cell:at(19,3),zone:'I',level:1,age:0}];
 c.households=[{id:5,home:1,members:4,workforce:3,dependents:1,workerSkills:{general:3,manufacturing:0,retail:0},skillSource:'arrival-profile',profile:'family',origin:'arrival',wallet:'h:5',lastPurchaseTick:-1,needs:0}];
 c.firms=[{id:6,building:4} as City['firms'][number]];
 c.employment=[{householdId:5,firmId:6,skill:'general',workers:3,occupation:'manufacturing',rank:'entry'}];
 c.bus=createBus();c.bus.depots=[{id:7,cell:at(1,1),level:1,open:true,tick:0}];
 c.bus.stops=[{id:8,cell:at(2,2),side:'n',level:1},{id:9,cell:at(19,2),side:'n',level:1}];c.nextId=10;
 assert.ok(createBusLine(c,{depotId:7,stopIds:[8,9],busCount:3,busLevel:1}).ok);
 return c;
}
function inputs(c=fixture()){
 const bridge=new BusGameBridge(c,420),legacy=captureTrafficGameInput(c);
 const input={...captureTrafficGameInput(c,{busCommutes:true}),bus:bridge.input()};
 assert.ok(input.bus.lines.length);return {c,bridge,legacy,input};
}
const total=(s:ReturnType<typeof trafficGameSampleFromInput>)=>s.demand.reduce((n,d)=>n+d.rate,0)+(s.clippedRate??0);

test('four residents use a distant real employer, retaining the exact origin budget and city bytes',()=>{
 const {c,legacy,input}=inputs(),before=serialize(c),old=trafficGameSampleFromInput(legacy),next=trafficGameSampleFromInput(input);
 assert.deepEqual(old.demand.map(d=>d.to),[at(3,2),at(4,2)]);
 assert.deepEqual(input.commutes,[{home:at(2,3),work:at(19,3),workers:3}]);
 const commute=next.demand.find(d=>d.to===at(19,2));assert.ok(commute);approx(commute.rate,total(old)*.75);
 approx(total(next),total(old));assert.equal(serialize(c),before);
 assert.equal('commutes' in legacy,false);assert.deepEqual(captureTrafficGameInput(c,{busCommutes:false}),legacy);
});

test('no bus, empty active service, no assignments, and inaccessible workplaces retain legacy demand',()=>{
 const {c,legacy,input}=inputs(),old=trafficGameSampleFromInput(legacy);
 for(const bus of [undefined,{...input.bus,lines:[]}])assert.deepEqual(trafficGameSampleFromInput({...input,bus}),old);
 c.employment=[];const empty={...captureTrafficGameInput(c,{busCommutes:true}),bus:input.bus};assert.deepEqual(trafficGameSampleFromInput(empty),old);
 const unreachable={...input,commutes:[{home:at(2,3),work:at(19,18),workers:3}]};assert.deepEqual(trafficGameSampleFromInput(unreachable),old);
 const a=createTrafficGameWorkerEngine(),b=createTrafficGameWorkerEngine();
 for(let seq=1;seq<=20;seq++){
  const message={kind:'compute' as const,epoch:'same',seq,commitPrevious:seq>1,advance:true,paused:false};
  assert.deepEqual(a({...message,sample:legacy}),b({...message,sample:{...legacy,commutes:input.commutes}}));
 }
});

test('owners and park staff are captured once, even outside the work-label window, and moves resample homes',()=>{
 const c=fixture();c.employment[0].workers=1;
 c.ownerLabor=[{householdId:5,firmId:6,skill:'general',workers:1} as City['ownerLabor'][number]];
 c.parks=[{id:20,cell:at(12,3),staffing:{allocations:[{householdId:5,parkId:20,skill:'general',workers:1}]}} as City['parks'][number]];
 const before=serialize(c),inside=captureTrafficGameInput(c,{busCommutes:true,workClock:{day:1,minute:600,ack:0}});
 assert.deepEqual(inside.commutes,[{home:at(2,3),work:at(12,3),workers:1},{home:at(2,3),work:at(19,3),workers:2}]);
 assert.equal(inside.work?.candidates.length,3);
 const night=captureTrafficGameInput(c,{busCommutes:true,workClock:{day:1,minute:1439,ack:0}});
 assert.deepEqual(night.commutes,inside.commutes);assert.deepEqual(night.work?.candidates,[]);assert.equal(serialize(c),before);
 c.buildings.push({id:30,cell:at(10,3),zone:'R',level:1,age:0});c.households[0].home=30;
 assert.ok(captureTrafficGameInput(c,{busCommutes:true}).commutes?.every(d=>d.home===at(10,3)));
});

test('duplicate/reordered commute rows aggregate deterministically without multiplying origin demand',()=>{
 const {input}=inputs(),old=trafficGameSampleFromInput(input);
 const c=input.commutes![0];
 const split={...input,commutes:[{...c,workers:1},{...c,workers:2}]};assert.deepEqual(trafficGameSampleFromInput(split),old);
 assert.deepEqual(trafficGameSampleFromInput({...split,commutes:[...split.commutes].reverse()}),old);
 const inflated=trafficGameSampleFromInput({...input,commutes:[{...c,workers:100}]});approx(total(inflated),total(old));assert.ok(inflated.demand.every(d=>d.to===at(19,2)));
 for(const row of [{...c,workers:0},{...c,workers:1.2},{...c,work:999999}])assert.throws(()=>trafficGameSampleFromInput({...input,commutes:[row]}),/Invalid traffic game commutes/);
});

test('one-way road reachability and unreachable work fall back without inventing a path',()=>{
 const {input}=inputs();const cut=structuredClone(input);cut.map.cells[at(10,2)].road=false;
 const baseline=trafficGameSampleFromInput({...cut,bus:undefined}),actual=trafficGameSampleFromInput(cut);assert.deepEqual(actual,baseline);
 const westOnly=structuredClone(input);westOnly.map.roadTopology={version:1,blocked:[],oneWay:{[at(10,2)]:-1}};
 assert.deepEqual(trafficGameSampleFromInput(westOnly),trafficGameSampleFromInput({...westOnly,bus:undefined}));
});

test('mixed reachable jobs consume only their resident fraction and an empty service restores the old routes',()=>{
 const {c,input,legacy}=inputs(),old=trafficGameSampleFromInput(legacy);
 const mixed=trafficGameSampleFromInput({...input,commutes:[{home:at(2,3),work:at(19,3),workers:1},{home:at(2,3),work:at(19,18),workers:2}]});
 approx(mixed.demand.find(d=>d.to===at(19,2))!.rate,total(old)/4);approx(total(mixed),total(old));
 c.bus!.lines[0].busCount=0;const bridge=new BusGameBridge(c,420),bus=bridge.input();assert.deepEqual(bus.lines,[]);
 const disabled={...captureTrafficGameInput(c,{busCommutes:!!bus.lines.length}),bus};assert.equal('commutes' in disabled,false);
 assert.deepEqual(trafficGameSampleFromInput(disabled),old);
});

test('park-only origin with no old ambient destinations does not mint a new demand budget',()=>{
 const {input}=inputs();assert.deepEqual(trafficGameSampleFromInput({...input,destinations:[],commutes:[{home:at(2,3),work:at(12,3),workers:3}]}).demand,[]);
});

test('more than 4096 genuine job pairs are bounded and all omitted mass is explicitly clipped',()=>{
 const {input}=inputs();
 const dense:TrafficGameInput={map:{cells:Array.from({length:576},()=>({road:true}))},homes:Array.from({length:70},(_,cell)=>({cell,amount:70})),destinations:Array.from({length:70},(_,i)=>({cell:300+i,amount:1})),bus:input.bus,commutes:[]};
 for(const home of dense.homes)for(const work of dense.destinations)dense.commutes!.push({home:home.cell,work:work.cell,workers:1});
 const base=trafficGameSampleFromInput({...dense,bus:undefined}),next=trafficGameSampleFromInput(dense),normalized=normalizeTrafficGameSample(next);
 assert.equal(next.demand.length,4096);assert.ok(next.clippedRate!>0);assert.equal(normalized.sample.demand.length,64);
 approx(total(base),total(next));approx(total(base),total(normalized.sample));
 const allocated=allocateGameModes(next,compileGameModal(next.map,{taxis:[{id:1,cell:72,level:1,open:true}],rail:[]}));
 const s=allocated.stats;approx(total(base),total(allocated.sample)+s.taxiDiverted-s.taxiLoaded-s.taxiEmpty+s.railDiverted);
 assert.doesNotThrow(()=>new TrafficGame(allocated.sample));
});

test('actual worker frames submit whole bus riders; bus and private-road demand conserve one budget',()=>{
 const {bridge,input}=inputs(),sample=trafficGameSampleFromInput(input),rate=total(sample),engine=createTrafficGameWorkerEngine();
 let last;let maxWaiting=0,maxOnboard=0;
 for(let seq=1;seq<=240;seq++){
  input.bus=bridge.input();const out=engine({kind:'compute',epoch:'commute',seq,commitPrevious:seq>1,advance:true,paused:false,sample:input});
  assert.equal(out.kind,'frame');if(out.kind!=='frame')throw Error(out.message);last=out.frame;
  bridge.onFrame(last.bus,420+seq/60);bridge.tick(420+seq/60);
  const ledger=bridge.ledger();maxWaiting=Math.max(maxWaiting,ledger.engine.waiting);maxOnboard=Math.max(maxOnboard,ledger.engine.onboard);
  approx(ledger.splitError,0);approx(ledger.engineError,0);approx(ledger.releaseError,0);
  approx(last.offered+last.bus!.diverted-last.bus!.returned,seq*rate);
 }
 assert.ok(bridge.totals.submitted>0);assert.ok(maxWaiting>0);assert.ok(maxOnboard>0,'actual BusEngine boards riders');
 assert.ok(last!.bus!.totals.some(t=>t.to===at(19,2)&&t.total>0));
});

test('taxi-only vehicle flow cannot become bus riders; mixed demand diverts only its private-car portion',()=>{
 const {bridge,input}=inputs(),from=at(2,2),to=at(19,2);
 const run=(taxiRate:number)=>{const g=new TrafficGame({map:input.map,demand:[{from,to,rate:2,taxiRate} as never]});g.setBus(bridge.input());for(let i=0;i<20;i++)g.step();return g.frame;};
 const only=run(2),mixed=run(1),privateOnly=run(0);assert.equal(only.bus!.diverted,0);approx(mixed.bus!.diverted,privateOnly.bus!.diverted/2);
 for(const frame of [only,mixed,privateOnly])approx(frame.offered+frame.bus!.diverted,40);
});
