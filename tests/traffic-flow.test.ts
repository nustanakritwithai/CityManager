import test from 'node:test';
import assert from 'node:assert/strict';
import { TrafficFlow, FLOW_LANE_CAPACITY, FLOW_STORAGE_PER_LANE } from '../src/traffic/flow.ts';
import { buildNetwork, linkKey, type Link, type LinkNetwork } from '../src/traffic/network.ts';
import { demandForPeriods } from '../src/traffic/demand.ts';
import { TrafficClock } from '../src/traffic/clock.ts';
import { cityDemandInput } from '../src/traffic/snapshot.ts';
import { createCity, type City } from '../src/sim.ts';

function graph(paths: number[][]): LinkNetwork {
  const links = new Map<string, Link>();
  for (const path of paths) for (let i = 1; i < path.length; i++) for (const [a,b] of [[path[i-1],path[i]],[path[i],path[i-1]]]) links.set(linkKey(a,b), { from:a,to:b,length:100,freeFlowKmh:40,lanes:1,capacityPerHour:FLOW_LANE_CAPACITY });
  const out = new Map<number,Link[]>(); for (const l of links.values()) out.set(l.from,[...(out.get(l.from)??[]),l]); return {links,out};
}
const base = () => graph([[25,26,27,28],[26,50]]);
function check(flow: TrafficFlow, net: LinkNetwork) {
  const d=flow.diagnostics(net); assert.ok(Math.abs(d.conservationError)<1e-6,JSON.stringify(d));
  assert.ok(Math.abs(d.offered-d.completed-d.onRoad-d.waiting-d.unreachable)<1e-6);
  for(const l of d.links) if(!l.closed) assert.ok(l.amount<=l.storage+1e-6,JSON.stringify(l));
  assert.ok(d.completed<=d.admitted+1e-6 && d.admitted<=d.offered+1e-6); return d;
}

test('finite storage spills upstream, retaining all offered demand across quiet periods',()=>{
 const net=base(),f=new TrafficFlow();f.advancePeriod(net,[{from:25,to:28,vehicles:100}]);let d=check(f,net);
 assert.equal(d.offered,100);assert.ok(d.waiting>70);assert.ok(d.completed<=12+1e-6);
 assert.ok(d.links.some(l=>Math.abs(l.amount-FLOW_STORAGE_PER_LANE)<1e-6));
 for(let i=0;i<12;i++){f.advancePeriod(net,[]);d=check(f,net);}
 assert.ok(Math.abs(d.completed-100)<1e-6);assert.equal(d.waiting,0);assert.ok(d.onRoad<1e-6);
});

test('road deletion and restoration never clears existing or new requests',()=>{
 const net=base(),f=new TrafficFlow();f.advancePeriod(net,[{from:25,to:28,vehicles:50}]);const before=f.diagnostics(net);
 const closed=graph([[25,26],[26,50]]);f.roadEdited(closed);let d=check(f,closed);
 assert.equal(d.offered,before.offered);assert.equal(d.completed,before.completed);assert.ok(d.unreachable>0);
 f.advancePeriod(closed,[{from:25,to:28,vehicles:30}]);d=check(f,closed);assert.equal(d.offered,80);assert.equal(d.completed,before.completed);
 f.roadEdited(net);for(let i=0;i<12;i++)f.advancePeriod(net,[]);d=check(f,net);assert.ok(Math.abs(d.completed-80)<1e-6);
});

test('flow codec restores exact continued conservation and rejects lost demand',()=>{
 const net=base(),a=new TrafficFlow();a.advancePeriod(net,[{from:25,to:28,vehicles:100}]);const b=TrafficFlow.restore(JSON.parse(JSON.stringify(a.snapshot)));
 for(let i=0;i<3;i++){a.advancePeriod(net,[]);b.advancePeriod(net,[]);}assert.deepEqual(a.snapshot,b.snapshot);check(a,net);
 const broken=a.snapshot;broken.waiting=[];assert.throws(()=>TrafficFlow.restore(broken),/conservation/);
});

test('fixed topology population growth increases offered demand and unresolved queues',()=>{
 const rows=[];
 for(const P of [200,500,1000,2000]) {
  const net=base(),f=new TrafficFlow();const input={households:[{cell:25,amount:P}],jobs:[{cell:28,amount:.5*P}],schoolSeats:[{cell:28,amount:.2*P}],parks:[{cell:28,amount:1}],freight:[],entrance:25};
  for(const r of demandForPeriods(input,0,24*2)){f.advancePeriod(net,r.od);check(f,net);}
  const d=f.diagnostics(net);rows.push({population:P,offered:d.offered,completed:d.completed,queued:d.queued,peak:d.peakQueued});
 }
 console.log('FIXED_TOPOLOGY',JSON.stringify(rows));
 for(let i=1;i<rows.length;i++){assert.ok(rows[i].offered>rows[i-1].offered);assert.ok(rows[i].peak>rows[i-1].peak);}
 assert.ok(rows.at(-1)!.queued>100);
});

test('genuine bypass helps but an extra approach to the same bottleneck does not invent capacity',()=>{
 const bottleneck=base(),extra=graph([[25,26,27,28],[25,49,50,26]]),bypass=graph([[25,26,27,28],[26,50],[25,49,73,74,75,76,52,28]]);
 const run=(net:LinkNetwork)=>{const f=new TrafficFlow();for(let i=0;i<6;i++){f.advancePeriod(net,[{from:25,to:28,vehicles:60}]);check(f,net);}return f.diagnostics(net)};
 const a=run(bottleneck),b=run(extra),c=run(bypass);
 assert.ok(b.completed<=6*12+1e-6);assert.ok(c.completed>a.completed+30,JSON.stringify({base:a.completed,extra:b.completed,bypass:c.completed}));assert.ok(c.waiting<a.waiting);
});

test('disconnected parcel demand retains stable identity and becomes routable after a frontage repair',()=>{
 const c=createCity(1),before=cityDemandInput(c,true),population=before.households.reduce((n,h)=>n+h.amount,0);
 c.cells.forEach(cell=>cell.road=false);const disconnected=cityDemandInput(c,true);
 assert.equal(disconnected.households.reduce((n,h)=>n+h.amount,0),population);assert.deepEqual(disconnected.households,before.households);
 const net=buildNetwork(c,{capacityPerLane:30,parcelZones:true}),f=new TrafficFlow();f.advancePeriod(net,[{from:601,to:604,vehicles:10}]);assert.equal(check(f,net).unreachable,10);
 for(const cell of [25,26,27,28])c.cells[cell].road=true;const repaired=buildNetwork(c,{capacityPerLane:30,parcelZones:true});f.roadEdited(repaired);for(let i=0;i<2;i++)f.advancePeriod(repaired,[]);assert.ok(Math.abs(check(f,repaired).completed-10)<1e-6);
});

test('clock lifecycle suspension never silently resets unresolved flow',()=>{
 const c={cells:Array.from({length:576},(_,i)=>({road:[25,26,27,28,50].includes(i)}))} as City;
 const input={households:[{cell:25,amount:2000}],jobs:[{cell:28,amount:1000}],schoolSeats:[{cell:28,amount:400}],parks:[{cell:28,amount:1}],freight:[],entrance:25};
 const k=new TrafficClock({enabled:true,snapshot:()=>input});k.advance(c,0);k.advance(c,12*60);const before=k.flow.snapshot;
 k.advance(structuredClone(c),13*60);assert.equal(k.lifecycle,'different-city');assert.deepEqual(k.flow.snapshot,before);
 k.advance(c,60);assert.equal(k.lifecycle,'time-reversed');assert.deepEqual(k.flow.snapshot,before);
 const restored=new TrafficClock({enabled:true,snapshot:()=>input});restored.restoreState(c,12*60,k.exportState());k.advance(c,24*60);restored.advance(c,24*60);assert.deepEqual(restored.flow.snapshot,k.flow.snapshot);
});
