import type {GameModalStats} from './game-modal.ts';
import {roadNeighbors,roadTopologyKey,validateRoadTopology,type RoadMap} from '../road-topology.ts';
import type {City} from '../sim.ts';
import type {TaxiDepotSite} from '../taxi/sites.ts';
import {buildNetwork,linkKey,type LinkNetwork} from './network.ts';
import {shortestPath} from './routing.ts';

/** Bounded, ephemeral road-game traffic. One step represents one real second,
 * not a city day or a citizen trip. The game never writes City or a save. */
export const GAME_MAX_ODS=64, GAME_MAX_CARS=128, GAME_MAX_QUEUE=32, GAME_MAX_RATE=4;
const STORAGE_PER_LANE=4, REROUTE_STEPS=5;
export type GameDemand = {from:number;to:number;rate:number};
export type TrafficGameSample = {map:RoadMap;demand:GameDemand[];clippedRate?:number};
export type TrafficGameInput = {map:RoadMap;homes:{cell:number;amount:number}[];destinations:{cell:number;amount:number}[];taxis?:TaxiDepotSite[]};
export type GameCar = {id:number;from:number;to:number;blocked:boolean};
export type GameRenderGroup = {key:string;from:number;to:number;amount:number;queued:number;storage:number;closed:boolean};
export type TrafficGameFrame = {modal?:GameModalStats|null;step:number;offered:number;completed:number;dropped:number;cancelled:number;waiting:number;moving:number;blocked:number;clippedRate:number;demandRate:number;roads:number;congestedLinks:number;cars:GameCar[];groups:GameRenderGroup[];loadByCell:{cell:number;load:number;queued:number}[]};
type OD = GameDemand & {waiting:number;path:number[]|null};
type Actor = {id:number;destination:number;path:number[];index:number;blocked:boolean};
const cell=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0&&n<576;
const pair=(a:number,b:number)=>`${a}:${b}`;
const frontages=(map:RoadMap,at:number):number[]=>map.cells[at]?.road?[at]:roadNeighbors(at).filter(i=>map.cells[i]?.road).sort((a,b)=>a-b);
/** Cab flow already included in an OD rate. Omitted from the public demand type so bus can extend the frame types on their own lines. */
type TaxiDemand = GameDemand & {taxiRate?: number};
type TaxiOd = OD & {taxiRate?: number; taxiCredit?: number; taxiMarkedStep?: number};
type TaxiActor = Actor & {taxi?: boolean};
const asTaxiDemand = (d: GameDemand): TaxiDemand => d;
export function demandTaxiRate(d: GameDemand): number { return asTaxiDemand(d).taxiRate ?? 0; }
export function gameCarIsTaxi(c: GameCar): boolean { return (c as unknown as {taxi?: boolean}).taxi === true; }
/** In-memory stands captured on the next taxi-enabled sample. The layer submit line stays unchanged so bus can attach `input.bus` beside it. */
let boundTaxiDepots: TaxiDepotSite[] = [];
export function bindTaxiSessionDepots(depots: readonly TaxiDepotSite[] | null): void {
  boundTaxiDepots = (depots ?? []).map(d => ({ id: d.id, cell: d.cell, level: d.level, open: d.open }));
}

/** Read only building placement/density and road topology; no economy, journals,
 * actual travel, city clock, financial data or persistence participates. */
export function captureTrafficGameInput(city:City,options:{taxiEnabled?:boolean;sessionDepots?:TaxiDepotSite[]}={}):TrafficGameInput {
  if(options.taxiEnabled!==undefined&&typeof options.taxiEnabled!=='boolean')throw Error('Invalid taxi game preference');
  const map:RoadMap={cells:city.cells.map(c=>({road:c.road})),...(city.roadTopology?{roadTopology:structuredClone(city.roadTopology)}:{})};
  const homes=new Map<number,number>(),destinations=new Map<number,number>(),homeAccess=new Map<number,number>();
  // Precompute frontage once per building; many households may share a tower.
  for(const b of city.buildings){if(!frontages(map,b.cell).length)continue;if(b.zone==='R')homeAccess.set(b.id,b.cell);else destinations.set(b.cell,(destinations.get(b.cell)??0)+Math.max(1,Math.min(9,b.level)));}
  // Actual resident counts make population growth affect the game even when
  // the buildings and road map are unchanged; these are not real trip records.
  for(const h of city.households){const at=h.home===null?undefined:homeAccess.get(h.home);if(at!==undefined)homes.set(at,(homes.get(at)??0)+h.members);}
  const depots=city.taxi?.depots??[],ids=new Set<number>();if(!Array.isArray(depots)||depots.length>4)throw Error('Invalid traffic game taxi depots');
  const saved=depots.map(d=>{if(!Number.isSafeInteger(d.id)||d.id<1||ids.has(d.id)||!cell(d.cell)||(d.level!==1&&d.level!==2)||typeof d.open!=='boolean')throw Error('Invalid traffic game taxi depot');ids.add(d.id);return {id:d.id,cell:d.cell,level:d.level,open:d.open};});
  // Session depots are in-memory only. Ignored unless the taxi flag is on, so traffic-off
  // and taxi-off captures stay identical to a city with no taxi service.
  const session=options.taxiEnabled?options.sessionDepots??boundTaxiDepots:[];
  if(!Array.isArray(session)||saved.length+session.length>4)throw Error('Invalid traffic game taxi depots');
  const extra=session.map(d=>{if(!d||!Number.isSafeInteger(d.id)||d.id<1||ids.has(d.id)||!cell(d.cell)||(d.level!==1&&d.level!==2)||typeof d.open!=='boolean')throw Error('Invalid traffic game taxi depot');ids.add(d.id);return {id:d.id,cell:d.cell,level:d.level,open:d.open};});
  return {map,homes:[...homes].map(([cell,amount])=>({cell,amount})),destinations:[...destinations].map(([cell,amount])=>({cell,amount})),taxis:options.taxiEnabled?[...saved,...extra]:[]};
}
/** Worker-side OD assembly: prefer road-reachable destinations over visually
 * close disconnected ones; when none are reachable retain an unreachable OD so
 * the game can display pressure until a road repair. */
export function trafficGameSampleFromInput(input:TrafficGameInput):TrafficGameSample {
  if(!input||!input.map||!Array.isArray(input.map.cells)||input.map.cells.length!==576||input.map.cells.some(c=>!c||typeof c.road!=='boolean')||!Array.isArray(input.homes)||!Array.isArray(input.destinations)||input.homes.length>576||input.destinations.length>576||[...input.homes,...input.destinations].some(x=>!x||!cell(x.cell)||!Number.isFinite(x.amount)||x.amount<0))throw Error('Invalid traffic game input');
  if(input.map.roadTopology)validateRoadTopology(input.map,input.map.roadTopology);
  const net=buildNetwork(input.map),work=[...input.destinations].sort((a,b)=>a.cell-b.cell),demand:GameDemand[]=[];
  const cached=new Map<number,Int16Array>();
  const distances=(from:number)=>{let dist=cached.get(from);if(dist)return dist;dist=new Int16Array(576);dist.fill(-1);dist[from]=0;const queue=[from];for(let i=0;i<queue.length;i++)for(const l of net.out.get(queue[i])??[])if(dist[l.to]<0){dist[l.to]=dist[queue[i]]+1;queue.push(l.to);}cached.set(from,dist);return dist;};
  for(const {cell:parcel,amount:weight} of [...input.homes].sort((a,b)=>a.cell-b.cell)) {
    const origins=frontages(input.map,parcel),options:{from:number;to:number;distance:number;size:number;parcel:number}[]=[];
    for(const d of work){let best:{from:number;to:number;distance:number}|null=null;
      for(const from of origins)for(const to of frontages(input.map,d.cell)){if(from===to)continue;const n=distances(from)[to];if(n<0)continue;if(!best||n<best.distance||n===best.distance&&(from<best.from||from===best.from&&to<best.to))best={from,to,distance:n};}
      if(best)options.push({...best,size:d.amount,parcel:d.cell});
    }
    // If no destination is reachable, preserve one representative disconnected
    // pressure route when both parcels have frontage; repair can then unlock it.
    if(!options.length&&origins.length){for(const d of work){const to=frontages(input.map,d.cell).find(n=>n!==origins[0]);if(to!==undefined)options.push({from:origins[0],to,distance:Math.abs(to%24-origins[0]%24)+Math.abs(Math.floor(to/24)-Math.floor(origins[0]/24)),size:d.amount,parcel:d.cell});}}
    options.sort((a,b)=>a.distance-b.distance||a.parcel-b.parcel||a.from-b.from||a.to-b.to);
    for(const {from,to,size} of options.slice(0,2))demand.push({from,to,rate:Math.sqrt(weight*size)*.12});
  }
  return {map:input.map,demand};
}
/** Convenience for tests; in the UI call captureTrafficGameInput on main and
 * trafficGameSampleFromInput in the worker to avoid routing on the render thread. */
export const captureTrafficGameSample=(city:City):TrafficGameSample=>trafficGameSampleFromInput(captureTrafficGameInput(city));

function cleanSample(sample:TrafficGameSample) {
  if(!sample||sample.clippedRate!==undefined&&(!Number.isFinite(sample.clippedRate)||sample.clippedRate<0||sample.clippedRate>Number.MAX_SAFE_INTEGER)||!sample.map||!Array.isArray(sample.map.cells)||sample.map.cells.length!==576||sample.map.cells.some(c=>!c||typeof c.road!=='boolean')||!Array.isArray(sample.demand)||sample.demand.length>4096)throw Error('Invalid traffic game sample');
  const map:RoadMap={cells:sample.map.cells.map(c=>({road:c.road})),...(sample.map.roadTopology?{roadTopology:structuredClone(sample.map.roadTopology)}:{})};
  if(map.roadTopology)validateRoadTopology(map,map.roadTopology);
  const grouped=new Map<string,GameDemand>();let clippedRate=sample.clippedRate??0;
  for(const d of sample.demand){if(!d||!cell(d.from)||!cell(d.to)||typeof d.rate!=='number'||!Number.isFinite(d.rate)||d.rate<0||d.rate>1_000_000)throw Error('Invalid traffic game demand');const taxi=asTaxiDemand(d).taxiRate??0;if(asTaxiDemand(d).taxiRate!==undefined&&(typeof asTaxiDemand(d).taxiRate!=='number'||!Number.isFinite(taxi)||taxi<0||taxi>d.rate+1e-6))throw Error('Invalid traffic game taxi demand');if(d.from===d.to){clippedRate+=d.rate;continue;}const k=pair(d.from,d.to),old=grouped.get(k) as TaxiDemand|undefined;if(old){old.rate+=d.rate;old.taxiRate=(old.taxiRate??0)+taxi;}else if(taxi>0){const row:TaxiDemand={from:d.from,to:d.to,rate:d.rate,taxiRate:taxi};grouped.set(k,row);}else grouped.set(k,{from:d.from,to:d.to,rate:d.rate});}
  const rows=[...grouped.values()].sort((a,b)=>a.from-b.from||a.to-b.to);
  // Aggregate adjacent ordered ODs into at most 64 representative bins. The
  // total demand from all areas is included; excess above per-bin capacity is
  // reported as clipped rather than silently erased. Taxi flow scales with the
  // same clip so a binned OD cannot dispatch more cabs than its modeled rate.
  const kept:GameDemand[]=[];const bins=Math.min(rows.length,GAME_MAX_ODS);
  for(let i=0;i<bins;i++){const start=Math.floor(i*rows.length/bins),end=Math.floor((i+1)*rows.length/bins),slice=rows.slice(start,end),representative=slice[Math.floor(slice.length/2)],total=slice.reduce((n,d)=>n+d.rate,0),taxiTotal=slice.reduce((n,d)=>n+demandTaxiRate(d),0),modeled=Math.min(GAME_MAX_RATE,total),taxiModeled=total>0?modeled*taxiTotal/total:0;const row:TaxiDemand={from:representative.from,to:representative.to,rate:modeled};if(taxiModeled>1e-12)row.taxiRate=taxiModeled;kept.push(row);clippedRate+=Math.max(0,total-GAME_MAX_RATE);}
  return {map,rows:kept,clippedRate};
}

/** Normalize a captured sample once before optional mode adapters. Clipping is
 * returned separately so omitted representative demand is never called served. */
export function normalizeTrafficGameSample(sample:TrafficGameSample):{sample:TrafficGameSample;clippedRate:number} {const s=cleanSample(sample);return {sample:{map:s.map,demand:s.rows,clippedRate:s.clippedRate},clippedRate:s.clippedRate};}

/** Capacity per directed lane per second is one actor; link storage is four
 * actors per lane. Intersections with >2 distinct neighbors share one crossing
 * per second across all approaches. Cars move at most one road link per step.
 * Source queues and visual actors are deliberately capped; `dropped` and
 * `clippedRate` expose approximation rather than claiming complete trips. */
export class TrafficGame {
  private map:RoadMap;private network:LinkNetwork;private signature:string;
  private ods:OD[]=[];private cars:Actor[]=[];private stepValue=0;private nextId=1;private demandSignature='';
  private offered=0;private completed=0;private dropped=0;private cancelled=0;private clippedRate=0;
  private junctions=new Set<number>();
  constructor(sample:TrafficGameSample){const s=cleanSample(sample);this.map=s.map;this.signature=this.key(s.map);this.network=buildNetwork(this.map);this.replaceRows(s.rows,s.clippedRate);this.prepareJunctions();this.replan();}
  private key(map:RoadMap){return map.cells.map(c=>c.road?'1':'0').join('')+roadTopologyKey(map);}
  private prepareJunctions(){const adj=new Map<number,Set<number>>();for(const l of this.network.links.values())for(const [a,b] of [[l.from,l.to],[l.to,l.from]])(adj.get(a)??adj.set(a,new Set()).get(a)!).add(b);this.junctions=new Set([...adj].filter(([,v])=>v.size>2).map(([n])=>n));}
  private replaceRows(rows:GameDemand[],clippedRate:number){const prior=new Map(this.ods.map(o=>[pair(o.from,o.to),o]));this.ods=rows.map(d=>{const old=prior.get(pair(d.from,d.to)) as TaxiOd|undefined;prior.delete(pair(d.from,d.to));const taxiRate=Math.min(d.rate,Math.max(0,demandTaxiRate(d)));const row:TaxiOd={...d,waiting:old?.waiting??0,path:old?.path??null};if(taxiRate>1e-12)row.taxiRate=taxiRate;else delete row.taxiRate;row.taxiCredit=taxiRate>0?old?.taxiCredit??0:0;row.taxiMarkedStep=old?.taxiMarkedStep??-1;return row;});for(const old of prior.values())this.cancelled+=old.waiting;this.clippedRate=clippedRate;this.demandSignature=JSON.stringify(rows);}
  setSample(sample:TrafficGameSample):void {const s=cleanSample(sample),signature=this.key(s.map),changed=signature!==this.signature, demandChanged=JSON.stringify(s.rows)!==this.demandSignature;this.replaceRows(s.rows,s.clippedRate);if(changed){this.map=s.map;this.signature=signature;this.network=buildNetwork(this.map);this.prepareJunctions();this.reconcileActors();}if(changed||demandChanged)this.replan();}
  /** Reconcile topology without consuming time, including while paused. */
  private reconcileActors():void {const times=new Map([...this.network.links].map(([key])=>[key,1])),routes=new Map<string,number[]|null>();for(const c of this.cars){const from=c.path[c.index],head=c.path[c.index+1];if(!this.network.links.has(linkKey(from,head))){c.blocked=true;continue;}if(head===c.destination){c.blocked=false;continue;}const key=pair(head,c.destination);if(!routes.has(key))routes.set(key,shortestPath(this.network,times,head,c.destination));const tail=routes.get(key)!;if(!tail)c.blocked=true;else{c.path=[from,...tail];c.index=0;c.blocked=false;}}}
  reset(sample?:TrafficGameSample):void {const s=sample?cleanSample(sample):null,rows=s?.rows??this.ods.map(o=>{const row:TaxiDemand={from:o.from,to:o.to,rate:o.rate};const taxi=demandTaxiRate(o);if(taxi>0)row.taxiRate=taxi;return row;}),clipped=s?.clippedRate??this.clippedRate;this.cars=[];this.ods=[];this.stepValue=0;this.nextId=1;this.offered=this.completed=this.dropped=this.cancelled=0;if(s){this.map=s.map;this.signature=this.key(s.map);this.network=buildNetwork(this.map);this.prepareJunctions();}this.replaceRows(rows,clipped);this.replan();}
  /** Detached in-memory transaction candidate; never a save representation. */
  clone():TrafficGame {const copy=Object.create(TrafficGame.prototype) as TrafficGame;
    // Network, map and junction set are immutable after construction; road edits
    // replace them wholesale. Mutable actors/queues are detached before a step.
    copy.map=this.map;copy.network=this.network;copy.junctions=this.junctions;copy.signature=this.signature;
    copy.ods=structuredClone(this.ods);copy.cars=structuredClone(this.cars);copy.stepValue=this.stepValue;copy.nextId=this.nextId;copy.offered=this.offered;copy.completed=this.completed;copy.dropped=this.dropped;copy.cancelled=this.cancelled;copy.clippedRate=this.clippedRate;copy.demandSignature=this.demandSignature;return copy;}
  private replan():void {const occupancy=new Map<string,number>();for(const c of this.cars){const k=linkKey(c.path[c.index],c.path[c.index+1]);occupancy.set(k,(occupancy.get(k)??0)+1);}const times=new Map([...this.network.links].map(([k,l])=>[k,1+(occupancy.get(k)??0)/Math.max(1,l.lanes)*3]));for(const od of this.ods)od.path=shortestPath(this.network,times,od.from,od.to);}
  step(paused=false):TrafficGameFrame {
    if(paused)return this.frame;
    this.stepValue++;
    for(const od of this.ods){this.offered+=od.rate;const value=od.waiting+od.rate;od.waiting=Math.min(GAME_MAX_QUEUE,value);this.dropped+=Math.max(0,value-GAME_MAX_QUEUE);}
    if(this.stepValue%REROUTE_STEPS===0)this.replan();
    const occupied=new Map<string,number>();for(const c of this.cars){const k=linkKey(c.path[c.index],c.path[c.index+1]);occupied.set(k,(occupied.get(k)??0)+1);}
    const entered=new Map<string,number>(),exited=new Map<string,number>(),reserved=new Map<string,number>(),crossings=new Map<number,number>();
    const canNode=(n:number)=>!this.junctions.has(n)||(crossings.get(n)??0)<1;
    const takeNode=(n:number)=>{if(this.junctions.has(n))crossings.set(n,(crossings.get(n)??0)+1);};
    const canEnter=(k:string)=>{const link=this.network.links.get(k);return !!link&&(entered.get(k)??0)<link.lanes&&(occupied.get(k)??0)+(reserved.get(k)??0)<link.lanes*STORAGE_PER_LANE;};
    const enter=(k:string)=>{entered.set(k,(entered.get(k)??0)+1);reserved.set(k,(reserved.get(k)??0)+1);};
    const pathCache=new Map<string,number[]|null>();let freeTimes:Map<string,number>|undefined;
    const reroute=(from:number,to:number)=>{const k=pair(from,to);if(!pathCache.has(k)){freeTimes??=new Map([...this.network.links].map(([key])=>[key,1]));pathCache.set(k,shortestPath(this.network,freeTimes,from,to));}return pathCache.get(k)!;};
    const completed=new Set<number>();const offset=this.cars.length?this.stepValue%this.cars.length:0;
    for(const c of [...this.cars.slice(offset),...this.cars.slice(0,offset)]){
      c.blocked=false;let from=c.path[c.index],head=c.path[c.index+1],current=linkKey(from,head),link=this.network.links.get(current);
      if(!link){c.blocked=true;continue;}
      if((exited.get(current)??0)>=link.lanes||!canNode(head)){c.blocked=true;continue;}
      if(head!==c.destination&&(c.path[c.index+2]===undefined||!this.network.links.has(linkKey(head,c.path[c.index+2])))) {const tail=reroute(head,c.destination);if(!tail){c.blocked=true;continue;}c.path=[from,...tail];c.index=0;}
      const end=head===c.destination,next=end?null:linkKey(head,c.path[c.index+2]);
      if(next&&!canEnter(next)){c.blocked=true;continue;}
      exited.set(current,(exited.get(current)??0)+1);takeNode(head);
      if(end){completed.add(c.id);this.completed++;}else{enter(next!);c.index++;}
    }
    this.cars=this.cars.filter(c=>!completed.has(c.id));
    const shift=this.ods.length?this.stepValue%this.ods.length:0;
    for(const od of [...this.ods.slice(shift),...this.ods.slice(0,shift)]) {
      while(od.waiting>=1&&this.cars.length<GAME_MAX_CARS){let p=od.path;if(!p||p.length<2||!canNode(od.from))break;let first=linkKey(p[0],p[1]);
        if(!canEnter(first)){const graph={...this.network,out:new Map(this.network.out).set(od.from,(this.network.out.get(od.from)??[]).filter(l=>canEnter(linkKey(l.from,l.to))))};const times=new Map([...this.network.links].map(([k,l])=>[k,1+((occupied.get(k)??0)+(reserved.get(k)??0))/Math.max(1,l.lanes)*3]));p=shortestPath(graph,times,od.from,od.to);if(!p||p.length<2)break;first=linkKey(p[0],p[1]);if(!canEnter(first))break;}
        enter(first);takeNode(p[0]);od.waiting-=1;this.cars.push({id:this.nextId++,destination:od.to,path:[...p],index:0,blocked:false});}
    }
    return this.frame;
  }
  /** Tag a share of each OD's cars as taxis once per step. Lives off the inflow and spawn lines so bus load can edit those independently. */
  private markDispatchedTaxis(): void {
    for (const od of this.ods) {
      const book = od as TaxiOd;
      if (book.taxiMarkedStep === this.stepValue) continue;
      book.taxiMarkedStep = this.stepValue;
      const taxiIn = Math.min(od.rate, book.taxiRate ?? 0);
      if (taxiIn > 0) book.taxiCredit = (book.taxiCredit ?? 0) + taxiIn;
      const fleet = this.cars.filter(c => !(c as TaxiActor).taxi && c.destination === od.to && c.path[0] === od.from);
      while ((book.taxiCredit ?? 0) >= 1 && fleet.length) { (fleet.shift() as TaxiActor).taxi = true; book.taxiCredit = (book.taxiCredit ?? 0) - 1; }
    }
  }
  get frame():TrafficGameFrame {
    this.markDispatchedTaxis();
    const cars=this.cars.map(c=>{const car:GameCar={id:c.id,from:c.path[c.index],to:c.path[c.index+1],blocked:c.blocked};if((c as TaxiActor).taxi)(car as unknown as {taxi?:boolean}).taxi=true;return car;});
    const grouped=new Map<string,GameRenderGroup>(),loads=new Map<number,{cell:number;load:number;queued:number}>();
    for(const c of cars){const key=linkKey(c.from,c.to),link=this.network.links.get(key);let group=grouped.get(key);if(!group){group={key,from:c.from,to:c.to,amount:0,queued:0,storage:(link?.lanes??0)*STORAGE_PER_LANE,closed:!link};grouped.set(key,group);}group.amount++;if(c.blocked)group.queued++;let load=loads.get(c.to);if(!load){load={cell:c.to,load:0,queued:0};loads.set(c.to,load);}load.load++;if(c.blocked)load.queued++;}
    // Waiting demand lives at its origin; include it in the cell-level queue
    // rather than falsely depicting it as cars occupying an arbitrary road.
    for(const od of this.ods)if(od.waiting>0){let load=loads.get(od.from);if(!load){load={cell:od.from,load:0,queued:0};loads.set(od.from,load);}load.queued+=od.waiting;}
    const groups=[...grouped.values()].sort((a,b)=>a.key.localeCompare(b.key));
    return {step:this.stepValue,offered:this.offered,completed:this.completed,dropped:this.dropped,cancelled:this.cancelled,waiting:this.ods.reduce((n,o)=>n+o.waiting,0),moving:cars.length,blocked:cars.filter(c=>c.blocked).length,clippedRate:this.clippedRate,demandRate:this.ods.reduce((n,o)=>n+o.rate,0),roads:this.map.cells.filter(c=>c.road).length,congestedLinks:groups.filter(g=>g.queued>0).length,cars,groups,loadByCell:[...loads.values()].sort((a,b)=>a.cell-b.cell)};
  }
}
