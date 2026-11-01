import test from 'node:test';
import assert from 'node:assert/strict';
import { configureRoadPath } from '../src/road-topology.ts';
import { buildNetwork } from '../src/traffic/network.ts';
import { createBus, removeStopsFromState } from '../src/bus/buildings.ts';
import { busLineRoutes, createBusLine, type BusHost } from '../src/bus/lines.ts';
import { BusEngine, busRideMinutes, busClusterPocket, busConflictClusters, BUS_ROUTE_PLAN_SAMPLE_LIMIT, type BusSubmission } from '../src/bus/engine.ts';
import { BUS_CAPACITY, BUS_DWELL_MIN, BUS_PCU } from '../src/bus/types.ts';
import { SIZE } from '../src/sim.ts';

const W = SIZE, at = (x: number, y: number) => y * W + x;
const row = (y: number, a: number, b: number) => Array.from({ length: b - a + 1 }, (_, k) => at(a + k, y));
const col = (x: number, a: number, b: number) => Array.from({ length: b - a + 1 }, (_, k) => at(x, a + k));
function host(busCount = 3, stopIds = [10, 11, 12]): BusHost {
  const c: BusHost = { cells: Array.from({ length: W * W }, () => ({ road: false })), nextId: 100 };
  const draw = (p: number[]) => { const f = new Set(p.filter(i => !c.cells[i].road)); for (const i of p) c.cells[i].road = true; configureRoadPath(c, p, f, false); };
  draw(row(2, 0, 20)); draw(row(10, 0, 20)); draw(col(0, 2, 10)); draw(col(20, 2, 10));
  c.bus = createBus();
  c.bus.depots.push({ id: 1, cell: at(5, 1), level: 1, open: true, tick: 0 });
  c.bus.stops.push({ id: 10, cell: at(4, 2), side: 'n', level: 1 }, { id: 11, cell: at(14, 2), side: 'n', level: 1 }, { id: 12, cell: at(20, 6), side: 'e', level: 1 }, { id: 13, cell: at(10, 10), side: 's', level: 1 });
  assert.ok(createBusLine(c, { depotId: 1, stopIds, busCount, busLevel: 1 }).ok);
  return c;
}
const LINE = 100;
const req = (id: string, from: number, to: number, persons: number): BusSubmission => ({ requestId: id, purpose: 'commute', from: 0, to: 0, persons, lineId: LINE, fromStopId: from, toStopId: to, fareSatang: 30 });
const conserved = (e: BusEngine) => assert.equal(e.ledger().conservationError, 0, JSON.stringify(e.ledger()));
/** Sample snapshots while advancing (renderer-style). */
function sample(e: BusEngine, from: number, to: number, dt = 0.125) { const tl: { m: number; s: ReturnType<BusEngine['snapshot']> }[] = []; for (let m = from; m <= to + 1e-9; m += dt) { e.advanceTo(m); tl.push({ m, s: e.snapshot(m) }); } return tl; }

test('gated mid-edge hold preserves exact progress while global clock and timeouts continue',()=>{
 let allow=true;const e=new BusEngine(host(1),300,{maxWaitMinutes:.01,movementGate:()=>allow});e.advanceTo(300.02);
 const before=e.snapshot()[0];assert.ok(before.progress>0&&before.progress<1);allow=false;
 e.submit([req('waiting',10,11,3)]);e.advanceTo(300.12);const after=e.snapshot()[0];
 assert.equal(after.cell,before.cell);assert.equal(after.next,before.next);assert.ok(Math.abs(after.progress-before.progress)<1e-8);
 assert.equal(e.now,300.12);assert.equal(e.totals.releasedBy.timeout,3);conserved(e);
 allow=true;e.advanceTo(300.14);assert.ok(e.snapshot()[0].progress>after.progress);conserved(e);
});
test('blocked stop arrival cannot board/alight early; admitting arrival commits passenger events once',()=>{
 let denyArrival=true;const e=new BusEngine(host(1),300,{movementGate:p=>!(denyArrival&&p.kind==='transition'&&p.to.phase==='dwelling')});
 e.submit([req('passenger',10,11,5)]);e.advanceTo(301);assert.equal(e.totals.boarded,0);assert.equal(e.drainEvents().length,0);conserved(e);
 denyArrival=false;e.advanceTo(301.1);assert.equal(e.totals.boarded,5);assert.equal(e.drainEvents().filter(x=>x.kind==='board').length,1);
 e.advanceTo(305);assert.equal(e.totals.completed,5);assert.equal(e.drainEvents().filter(x=>x.kind==='alight').length,1);conserved(e);
});
test('held bus does not freeze service closure or release onboard passengers as timeout',()=>{
 let allow=true;const e=new BusEngine(host(1),1378,{maxWaitMinutes:100,movementGate:()=>allow});e.submit([req('aboard',10,11,4)]);e.advanceTo(1378.3);
 assert.equal(e.ledger().onboard,4);allow=false;e.submit([req('waiting',11,10,2)]);const before=e.snapshot()[0];e.advanceTo(1380.1);
 assert.equal(e.totals.releasedBy.serviceEnd,2);assert.equal(e.ledger().onboard,4);assert.equal(e.totals.completed,0);assert.equal(e.snapshot()[0].cell,before.cell);conserved(e);
 allow=true;e.advanceTo(1385);assert.equal(e.totals.completed,4);conserved(e);
});
test('always-admit gate matches legacy route and passenger semantics at sampled clocks',()=>{
 const a=new BusEngine(host(1),300),b=new BusEngine(host(1),300,{movementGate:()=>true});for(const e of[a,b])e.submit([req('p',10,11,5)]);
 for(let t=300;t<=306;t+=.125){a.advanceTo(t);b.advanceTo(t);assert.deepEqual(b.ledger(),a.ledger());const aa=a.snapshot()[0],bb=b.snapshot()[0];assert.equal(bb.phase,aa.phase);assert.equal(bb.cell,aa.cell);assert.equal(bb.next,aa.next);assert.ok(Math.abs(bb.progress-aa.progress)<1e-6);}
});

test('gated route edits retain occupied fractional edge instead of rewinding visible bus',()=>{
 const c=host(1),e=new BusEngine(c,300,{movementGate:()=>true});e.advanceTo(300.02);const before=e.snapshot()[0];assert.ok(before.progress>0);
 c.bus!.lines[0].busLevel=2;e.refresh();const after=e.snapshot()[0];assert.equal(after.cell,before.cell);assert.equal(after.next,before.next);assert.ok(Math.abs(after.progress-before.progress)<1e-8);conserved(e);
 e.advanceTo(305);conserved(e);
});
test('topology refresh invalidates reservations once before new movement proposals',()=>{
 const c=host(1),events:string[]=[],e=new BusEngine(c,300,{movementReset:()=>events.push('reset'),movementGate:()=>{events.push('move');return true;}});
 assert.deepEqual(events,['reset']);e.advanceTo(300.02);const rev=e.topologyRevision;events.length=0;e.refresh();assert.deepEqual(events,[]);
 c.bus!.lines[0].busLevel=2;e.advanceTo(300.03);assert.equal(e.topologyRevision,rev+1);assert.equal(events[0],'reset');assert.equal(events.filter(x=>x==='reset').length,1);assert.ok(events.includes('move'));
});
test('missing depot retains a visible stranded bus, releases riders once and never invents home arrival',()=>{
 const c=host(1),e=new BusEngine(c,300,{movementGate:()=>true});e.submit([req('p',10,11,4)]);e.advanceTo(300.3);assert.equal(e.ledger().onboard,4);assert.ok(e.hasActiveDepot(1));
 c.bus!.depots=[];e.refresh();e.advanceTo(310);assert.ok(e.snapshot().every(b=>b.phase!=='home'));assert.equal(e.ledger().onboard,0);assert.equal(e.totals.released,4);assert.equal(e.strandedCount,1);conserved(e);
 const before=e.snapshot();e.advanceTo(320);assert.deepEqual(e.snapshot(),before);assert.equal(e.totals.released,4);conserved(e);
});
test('denied terminal transition does not rewind the bus or replace its reservation with zero movement',()=>{
 let held=false,zeroDrive=0;const e=new BusEngine(host(1),300,{movementGate:p=>{if(p.kind==='drive'&&p.from.cell===p.to.cell&&p.from.next===p.to.next&&Math.abs(p.from.progress-p.to.progress)<1e-12)zeroDrive++;if(p.kind==='transition'&&p.to.phase==='dwelling'){held=true;return false;}return true;}});
 e.advanceTo(301);assert.ok(held);const p=e.snapshot()[0];assert.equal(p.cell,p.next);e.advanceTo(302);assert.deepEqual(e.snapshot()[0],p);assert.equal(zeroDrive,0);
});
test('removing a line retains home depot identity until the active bus really returns',()=>{
 const c=host(1),e=new BusEngine(c,300,{movementGate:()=>true});e.advanceTo(300.3);assert.ok(e.hasActiveDepot(1));
 c.bus!.lines=[];e.refresh();assert.ok(e.hasActiveDepot(1));e.advanceTo(305);assert.equal(e.hasActiveDepot(1),false);assert.equal(e.strandedCount,0);conserved(e);
});
test('line deletion reconciles onboard riders once then finishes return to retained depot',()=>{
 const c=host(1),released:number[]=[],e=new BusEngine(c,300,{movementGate:()=>true,release:(_id,n)=>released.push(n)});e.submit([req('onboard',10,11,4)]);e.advanceTo(300.3);assert.equal(e.ledger().onboard,4);
 c.bus!.lines=[];e.refresh();e.advanceTo(305);assert.equal(e.totals.released,4);assert.deepEqual(released,[4]);assert.equal(e.hasActiveDepot(1),false);assert.equal(e.snapshot().length,0);conserved(e);
});
test('retained legacy orphan fleet is bounded and does not advertise nonexistent new buses',()=>{
 const c=host(1),e=new BusEngine(c,300,{movementGate:()=>true});e.advanceTo(300.02);
 for(let n=1;n<=100;n++){
  c.bus!.depots[0].id=n+1;c.bus!.lines[0].depotId=n+1;c.bus!.lines[0].id=LINE+n;e.refresh();e.advanceTo(e.now+.02);assert.ok(e.snapshot().length<=80);conserved(e);
 }
 assert.equal(e.snapshot().length,80);assert.equal(e.activeLineIds.includes(LINE+100),false);
});
test('active bus retains current class through requested upgrade and line deletion',()=>{
 const c=host(1),e=new BusEngine(c,300,{movementGate:()=>true});e.advanceTo(300.02);assert.equal(e.snapshot()[0].capacity,40);
 c.bus!.lines[0].busLevel=3;e.refresh();assert.equal(e.snapshot()[0].capacity,40);
 c.bus!.lines=[];e.refresh();assert.equal(e.snapshot()[0].capacity,40);assert.ok(e.hasActiveDepot(1));e.advanceTo(305);assert.equal(e.hasActiveDepot(1),false);conserved(e);
});

test('requested class applies only at admitted depot return and downgrade never discards occupants',()=>{
 const c=host(1);c.bus!.lines[0].busLevel=3;let homeCapacity=0,admitHome=false;
 const e=new BusEngine(c,300,{movementGate:p=>{if(p.to.phase==='home'&&p.from.phase!=='home'){homeCapacity=p.to.capacity;return admitHome;}return true;}});
 e.submit([req('p',10,11,60)]);e.advanceTo(300.3);assert.equal(e.snapshot()[0].persons,60);assert.equal(e.snapshot()[0].capacity,80);
 c.bus!.lines[0].busLevel=1;e.refresh();assert.equal(e.snapshot()[0].persons,60);assert.equal(e.snapshot()[0].capacity,80);assert.equal(e.activeBusCapacity(LINE),80);
 c.bus!.depots[0].open=false;e.refresh();e.advanceTo(305);assert.equal(homeCapacity,40);assert.notEqual(e.snapshot()[0].phase,'home');assert.equal(e.snapshot()[0].capacity,80);assert.equal(e.totals.released,60);conserved(e);
 admitHome=true;e.advanceTo(305.1);assert.equal(e.hasActiveDepot(1),false);conserved(e);
 const d=host(1);let upgrade=0;const u=new BusEngine(d,300,{movementGate:p=>{if(p.to.phase==='home')upgrade=p.to.capacity;return true;}});u.advanceTo(300.02);d.bus!.lines[0].busLevel=3;u.refresh();assert.equal(u.snapshot()[0].capacity,40);d.bus!.depots[0].open=false;u.refresh();u.advanceTo(305);assert.equal(upgrade,80);assert.equal(u.hasActiveDepot(1),false);
});
test('denied sub-nanominute waypoint gap cannot repeatedly subdivide one host frame',()=>{
 let allow=true,calls=0;const e=new BusEngine(host(1),300,{movementGate:()=>{calls++;return allow;}});e.advanceTo(300.01);
 const bus=(e as unknown as {buses:{at:number[];until:number}[]}).buses[0],boundary=bus.at.find(t=>t>e.now)!;
 e.advanceTo(boundary-1.1e-9);const before=e.snapshot()[0];allow=false;calls=0;const target=e.now+.025/60;e.advanceTo(target);
 assert.equal(e.now,target);assert.ok(calls<=2,`must not retry a denied epsilon boundary ${calls} times in one frame`);const after=e.snapshot()[0];assert.equal(after.cell,before.cell);assert.equal(after.next,before.next);assert.ok(Math.abs(after.progress-before.progress)<1e-8);conserved(e);
 allow=true;e.advanceTo(target+.025/60);assert.notDeepEqual(e.snapshot()[0],after);
});
test('bounded current and next corner intents arrive upstream and persist through tail clearance',()=>{
 const seen:{id:string;from:number;next:number;p:number;samples:number[]}[]=[];
 const e=new BusEngine(host(1),300,{movementGate:p=>{assert.ok((p.turns?.length??0)<=3);for(const turn of p.turns??[])seen.push({id:turn.id,from:p.from.cell,next:p.from.next,p:p.from.progress,samples:turn.samples.map(s=>s.cell)});return true;}});e.advanceTo(310);
 assert.ok(seen.length>0);const first=seen[0],node=first.samples[2];assert.ok(first.p<.3,'intent precedes the nose entering the turn');assert.ok(seen.some(s=>s.id===first.id&&s.from===node&&s.p>.5),'same intent persists while the tail leaves');
 assert.ok(seen.every(s=>s.samples.length>=4&&s.samples.length<=5));conserved(e);
});
test('adjacent and mirrored no-pocket bends are acquired atomically as one bounded cluster',()=>{
 for(const mirror of[false,true]){
  const map=(i:number)=>mirror?Math.floor(i/24)*24+23-i%24:i,roads=new Set([294,295,296,272,273,274].map(map));
  const c:BusHost={cells:Array.from({length:576},(_,i)=>({road:roads.has(i)})),nextId:100,bus:createBus()};c.bus!.depots.push({id:1,cell:map(270),level:1,open:true,tick:0});c.bus!.stops.push({id:10,cell:map(274),side:'n',level:1},{id:11,cell:map(295),side:'s',level:1});assert.ok(createBusLine(c,{depotId:1,stopIds:[10,11],busCount:1,busLevel:3}).ok);
  let forward=false,reverse=false;const firstSeen=new Set<string>();const e=new BusEngine(c,300,{movementGate:p=>{assert.ok((p.turns?.length??0)<=3);for(const t of p.turns??[]){if(!t.id.includes(':corridor:'))continue;assert.equal(t.samples.length,6);const nodes=t.samples.filter((_,i)=>i>0&&i<t.samples.length-1&&i%2===0).map(s=>s.cell);assert.deepEqual(new Set(nodes),new Set([map(296),map(272)]));if(!firstSeen.has(t.id)){assert.ok(p.from.progress<.3);firstSeen.add(t.id);}if(p.from.cell===map(296)&&p.from.next===map(272))forward=true;if(p.from.cell===map(272)&&p.from.next===map(296))reverse=true;}return true;}});e.advanceTo(306);assert.ok(forward&&reverse);conserved(e);
 }
});
test('future stop-departure corridor is acquired before parking and retained across the real dwell',()=>{
 let approach:string|undefined,arrival:string|undefined,departure:string|undefined,left=false;
 const e=new BusEngine(host(1),300,{movementGate:p=>{
  const stop=p.turns?.find(t=>t.id.includes(':stop:'));
  if(p.kind==='drive'&&p.to.phase==='toStart'&&stop){approach??=stop.id;assert.equal(stop.samples.length,4);assert.ok(stop.samples[0].progress>.99,'exclude already traversed approach corridor');}
  if(p.kind==='transition'&&p.to.phase==='dwelling')arrival??=stop?.id;
  if(p.kind==='transition'&&p.from.phase==='dwelling'&&p.to.phase==='running')departure??=stop?.id;
  if(departure&&p.kind==='drive'&&p.from.progress>.5&&p.turns?.some(t=>t.id===departure))left=true;
  return true;
 }});e.submit([req('p',10,11,5)]);e.advanceTo(302);assert.ok(approach);assert.equal(arrival,approach);assert.equal(departure,approach);assert.ok(left);assert.equal(e.totals.boarded,5);conserved(e);
});
test('straight conflict-node traversals reserve before entry in all four directions',()=>{
 for(let rotation=0;rotation<4;rotation++){
  const map=(i:number)=>{for(let n=0;n<rotation;n++)i=(i%24)*24+23-Math.floor(i/24);return i;},roads=new Set([294,295,296,272,273,274,249].map(map));
  const c:BusHost={cells:Array.from({length:576},(_,i)=>({road:roads.has(i)})),nextId:100,bus:createBus()};c.bus!.depots.push({id:1,cell:map(270),level:1,open:true,tick:0});c.bus!.stops.push({id:10,cell:map(274),side:'n',level:1},{id:11,cell:map(295),side:'s',level:1});assert.ok(createBusLine(c,{depotId:1,stopIds:[10,11],busCount:1,busLevel:3}).ok);
  let out=false,back=false;const e=new BusEngine(c,300,{movementGate:p=>{assert.ok((p.turns?.length??0)<=3);for(const intent of p.turns??[]){if(intent.samples.some(s=>s.cell===map(273)&&s.next===map(274)))out=true;if(intent.samples.some(s=>s.cell===map(273)&&s.next===map(272)))back=true;}return true;}});e.advanceTo(306);assert.ok(out&&back,`rotation ${rotation}`);conserved(e);
 }
});

test('class-specific rotation/body/gap geometry requires a cluster only where no holding pocket fits',()=>{
 for(const capacity of[40,60,80]){assert.equal(busClusterPocket(capacity,2),false);assert.equal(busClusterPocket(capacity,4),true);}
 assert.equal(busClusterPocket(40,2.7),true);assert.equal(busClusterPocket(80,2.7),false);
 const path=[49,50,74,75,99,100,124];assert.deepEqual(busConflictClusters(path,new Set(),80),[[1,2,3,4,5]]);
});
test('dense routes longer than four conflicts operate at every class without a topology rejection',()=>{
 const roads=new Set([49,50,74,75,99,100,124,125]);
 for(const level of[1,2,3] as const){
  const c:BusHost={cells:Array.from({length:576},(_,i)=>({road:roads.has(i)})),nextId:100,bus:createBus()};
  c.bus!.depots.push({id:1,cell:25,level:1,open:true,tick:0});c.bus!.stops.push({id:10,cell:50,side:'n',level:1},{id:11,cell:125,side:'n',level:1});
  assert.ok(createBusLine(c,{depotId:1,stopIds:[10,11],busCount:1,busLevel:level}).ok);
  let large=false,reused=false;const plans=new Map<string,object>();const e=new BusEngine(c,300,{movementGate:p=>{for(const t of p.turns??[]){assert.ok(t.samples.length<=BUS_ROUTE_PLAN_SAMPLE_LIMIT);if(t.samples.length>10){large=true;if(plans.get(t.id)===t)reused=true;else plans.set(t.id,t);assert.ok(Object.isFrozen(t));assert.ok(Object.isFrozen(t.samples));}}return true;}});
  e.submit([req('dense',10,11,4)]);e.advanceTo(306);assert.ok(large&&reused);assert.equal(e.totals.completed,4);assert.ok(e.movementStats.committedTransition>=5);assert.ok(e.totals.departures>0);assert.equal(e.activeLineIds.includes(100),true);conserved(e);
 }
});
test('dense topology edit rebuilds cached continuation, preserves held pose and riders, then resumes',()=>{
 let allow=true;const c=host(1),plans=new Set<object>();const e=new BusEngine(c,300,{movementGate:p=>{for(const t of p.turns??[])if(t.samples.length>10)plans.add(t);return allow;}});e.submit([req('moving-retained',10,11,4)]);e.advanceTo(301.3);assert.equal(e.ledger().onboard,4);assert.equal(e.snapshot()[0].phase,'running');
 const branches=Array.from({length:7},(_,i)=>at(6+i,3));for(const cell of branches)c.cells[cell].road=true;e.refresh();allow=false;const before=e.snapshot()[0],boarded=e.totals.boarded;e.advanceTo(302);const after=e.snapshot()[0];assert.equal(after.cell,before.cell);assert.equal(after.next,before.next);assert.ok(Math.abs(after.progress-before.progress)<1e-8);assert.equal(e.now,302);assert.equal(e.totals.completed,0);assert.equal(e.totals.boarded,boarded);assert.equal(e.ledger().onboard,4);conserved(e);
 allow=true;e.advanceTo(310);assert.ok(plans.size>0);assert.equal(e.totals.completed,4);conserved(e);
});
test('fully connected 24x24 road grid plans complete actual routes for L1 L2 and L3',()=>{
 for(const level of[1,2,3] as const){
  const c:BusHost={cells:Array.from({length:576},(_,i)=>({road:i!==0})),nextId:100,bus:createBus()};c.bus!.depots.push({id:1,cell:0,level:1,open:true,tick:0});c.bus!.stops.push({id:10,cell:23,side:'n',level:1},{id:11,cell:575,side:'s',level:1});assert.ok(createBusLine(c,{depotId:1,stopIds:[10,11],busCount:1,busLevel:level}).ok);
  let longest=0;const e=new BusEngine(c,300,{movementGate:p=>{assert.ok((p.turns?.length??0)<=3);for(const t of p.turns??[]){longest=Math.max(longest,t.samples.length);assert.ok(t.samples.length<=BUS_ROUTE_PLAN_SAMPLE_LIMIT);}return true;}});e.submit([req('full-grid',10,11,3)]);e.advanceTo(320);assert.ok(longest>40);assert.equal(e.totals.completed,3);assert.ok(e.movementStats.committedTransition>=6);assert.ok(e.activeLineIds.includes(LINE));conserved(e);
 }
});
test('closed-service terminal guard predicts post-alight return or continuation without mutating riders',()=>{
 for(const remaining of[0,2]){
  let planned:number|undefined,actual:number|undefined;const e=new BusEngine(host(1),1378,{movementGate:p=>{if(p.kind==='transition'&&p.to.phase==='dwelling'&&p.to.cell===at(14,2))planned??=p.turns?.find(t=>t.id.includes(':stop:'))?.samples.at(-1)?.next;if(p.kind==='transition'&&p.from.phase==='dwelling'&&p.from.cell===at(14,2)&&p.to.phase==='running')actual??=p.to.next;return true;}});
  e.submit([req('last-riders',10,11,4),...(remaining?[req('continue-riders',10,12,remaining)]:[])]);e.advanceTo(1390);assert.equal(e.totals.completed,4+remaining);assert.notEqual(planned,undefined);assert.equal(planned,actual);assert.equal(actual,at(remaining?15:13,2));conserved(e);
 }
});
test('terminal preview accounts for eligible boarding before closure without consuming the queue',()=>{
 let planned:number|undefined,actual:number|undefined;const e=new BusEngine(host(1),1377,{movementGate:p=>{if(p.kind==='transition'&&p.to.phase==='dwelling'&&p.to.cell===at(14,2))planned??=p.turns?.find(t=>t.id.includes(':stop:'))?.samples.at(-1)?.next;if(p.kind==='transition'&&p.from.phase==='dwelling'&&p.from.cell===at(14,2)&&p.to.phase==='running')actual??=p.to.next;return true;}});
 e.submit([req('alight-before-close',10,11,4),req('board-before-close',11,12,2)]);e.advanceTo(1390);assert.equal(e.totals.boarded,6);assert.equal(e.totals.completed,6);assert.equal(planned,at(15,2));assert.equal(actual,planned);assert.equal(e.drainEvents().filter(x=>x.kind==='board').reduce((n,x)=>n+x.persons,0),6);conserved(e);
});
test('a denied empty departure crossing service close refreshes the protected actual return direction',()=>{
 let planned:number|undefined,actual:number|undefined;const e=new BusEngine(host(1),1376,{movementGate:p=>{if(p.kind==='transition'&&p.from.phase==='dwelling'&&p.from.cell===at(14,2)){if(p.minute<1380.1)return false;planned??=p.turns?.find(t=>t.id.includes(':stop:'))?.samples[3]?.next;actual??=p.to.next;}return true;}});e.advanceTo(1385);assert.equal(actual,at(13,2));assert.equal(planned,actual);assert.ok(e.movementStats.heldTransition>0);conserved(e);
});
