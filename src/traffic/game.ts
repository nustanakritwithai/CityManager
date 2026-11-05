import { expandedRoadDirection } from '../expanded-road-topology.ts';
import { expandedCellCoordinate, EXPANDED_MAP_CELLS } from '../expanded-map-grid.ts';
import {SignalPeers,type SignalPeerSnapshot} from './signal-peers.ts';
import {buildSignalCorridors,neighborSignalBias,type SignalCorridor,type NeighborSignalState} from './signal-coordination.ts';
import {chooseSignal,SIGNAL_URGENT_WAIT,signalTopologyKey,type TrafficSignalFrame,type SignalPhase,type SignalDemand} from './adaptive-signals.ts';
import type {GameModalStats} from './game-modal.ts';
import {roadNeighborsFor,validateRoadTopology,type RoadMap} from '../road-topology.ts';
import type {City} from '../sim.ts';
import type {TaxiDepotSite} from '../taxi/sites.ts';
import {buildNetwork,linkKey,type LinkNetwork} from './network.ts';
import {shortestPath} from './routing.ts';
import {createRoadNavigator,emptyNavigationStats,type NavigationStats} from './rrt-navigation.ts';
import {gameBusShare,validGameBusInput,type GameBusFrame,type GameBusInput,type GameBusShare,type GameBusTotal} from '../bus/game-bus.ts';
import {LANE_START,SLOT_PITCH} from '../citizen-road-queue.ts';
import {JUNCTION_STOP,TRAFFIC_SPACING,updateVehicleFollowing,type LaneVehicle} from './spacing.ts';
import {forEachParkActivityEmployedCitizen,WORK_END_MINUTE} from '../park-activity.ts';

/** Bounded, ephemeral road-game traffic. One step represents one real second,
 * not a city day or a literal citizen trip. Work labels are representative;
 * the game never writes City, payroll or a save. */
export const GAME_MAX_ODS=64, GAME_MAX_CARS=128, GAME_MAX_QUEUE=32, GAME_MAX_RATE=4;
const STORAGE_PER_LANE=TRAFFIC_SPACING.maxPerLanePerTile, REROUTE_STEPS=5, SUBSTEPS=5;
const JUNCTION_CLEAR=1-JUNCTION_STOP;
export type GameDemand = {from:number;to:number;rate:number};
export type TrafficGameSample = {map:RoadMap;demand:GameDemand[];clippedRate?:number};
/** The existing visual morning commute starts at 06:30; the 17:00 cutoff is
 * the city-wide work reservation convention, not an individual job shift. */
export const WORK_TRIP_START_MINUTE=6*60+30, WORK_TRIP_END_MINUTE=WORK_END_MINUTE;
const MAX_WORK_CANDIDATES=8192, MAX_UNACKNOWLEDGED_WORK_EXPIRATIONS=8192;
export type WorkTripClock={day:number;minute:number;ack:number;crossedWorkDay?:number};
export type WorkTripInput=WorkTripClock & {candidates:{citizenId:string;home:number;work:number}[];cancelIds?:number[];retiredIds?:number[]};
export type TrafficGameInput = {map:RoadMap;homes:{cell:number;amount:number}[];destinations:{cell:number;amount:number}[];taxis?:TaxiDepotSite[];bus?:GameBusInput;work?:WorkTripInput};
export type GameCar = {id:number;from:number;to:number;blocked:boolean;progress?:number;lane?:number;speed?:number;destination?:number;nextCell?:number;nextLane?:number;junction?:boolean;nextVisit?:number};
export type GameRenderGroup = {key:string;from:number;to:number;amount:number;queued:number;storage:number;closed:boolean};
export type TrafficGameFrame = {navigation?:NavigationStats;signals?:TrafficSignalFrame;modal?:GameModalStats|null;bus?:GameBusFrame;workTrips?:{id:number;day:number}[];expiredWorkTrips?:{sequence:number;id:number}[];/** Cumulative visual taxi movements and tiles; includes empty trips and is not an accounting input. */taxiTrips?:{trips:number;tiles:number};step:number;offered:number;completed:number;dropped:number;cancelled:number;waiting:number;moving:number;blocked:number;clippedRate:number;demandRate:number;roads:number;congestedLinks:number;cars:GameCar[];groups:GameRenderGroup[];loadByCell:{cell:number;load:number;queued:number}[]};
type OD = GameDemand & {waiting:number;path:number[]|null};
type Actor = {visits?:number;id:number;destination:number;path:number[];index:number;blocked:boolean;progress:number;speed:number;lane:number;workClaimPending?:boolean;workCitizen?:string};
const cell=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0&&n<EXPANDED_MAP_CELLS;
const pair=(a:number,b:number)=>`${a}:${b}`;
const frontages=(map:RoadMap,at:number):number[]=>map.cells[at]?.road?[at]:roadNeighborsFor(map,at).filter(i=>map.cells[i]?.road).sort((a,b)=>a-b);
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

/** Read building placement/density and road topology for ambient demand. The
 * optional work clock additionally reads existing assignments for work labels;
 * it never mutates the economy, financial journals or persistence. */
export function captureTrafficGameInput(city:City,options:{taxiEnabled?:boolean;sessionDepots?:TaxiDepotSite[];workClock?:WorkTripClock}={}):TrafficGameInput {
  if(options.taxiEnabled!==undefined&&typeof options.taxiEnabled!=='boolean')throw Error('Invalid taxi game preference');
  const map:RoadMap={cells:city.cells.map(c=>({road:c.road})),...(city.roadTopology?{roadTopology:structuredClone(city.roadTopology)}:{})};
  const homes=new Map<number,number>(),destinations=new Map<number,number>(),homeAccess=new Map<number,number>();
  // Precompute frontage once per building; many households may share a tower.
  for(const b of city.buildings){if(!frontages(map,b.cell).length)continue;if(b.zone==='R')homeAccess.set(b.id,b.cell);else destinations.set(b.cell,(destinations.get(b.cell)??0)+Math.max(1,Math.min(9,b.level)));}
  // Actual resident counts make population growth affect the game even when
  // the buildings and road map are unchanged; these are not real trip records.
  for(const h of city.households){const at=h.home===null?undefined:homeAccess.get(h.home);if(at!==undefined)homes.set(at,(homes.get(at)??0)+h.members);}
  const depots=city.taxi?.depots??[],ids=new Set<number>();if(!Array.isArray(depots)||depots.length>4)throw Error('Invalid traffic game taxi depots');
  const saved=depots.map(d=>{if(!Number.isSafeInteger(d.id)||d.id<1||ids.has(d.id)||!cell(d.cell)||d.cell>=map.cells.length||(d.level!==1&&d.level!==2)||typeof d.open!=='boolean')throw Error('Invalid traffic game taxi depot');ids.add(d.id);return {id:d.id,cell:d.cell,level:d.level,open:d.open};});
  // Session depots are in-memory only. Ignored unless the taxi flag is on, so traffic-off
  // and taxi-off captures stay identical to a city with no taxi service.
  const session=options.taxiEnabled?options.sessionDepots??boundTaxiDepots:[];
  if(!Array.isArray(session)||saved.length+session.length>4)throw Error('Invalid traffic game taxi depots');
  const extra=session.map(d=>{if(!d||!Number.isSafeInteger(d.id)||d.id<1||ids.has(d.id)||!cell(d.cell)||d.cell>=map.cells.length||(d.level!==1&&d.level!==2)||typeof d.open!=='boolean')throw Error('Invalid traffic game taxi depot');ids.add(d.id);return {id:d.id,cell:d.cell,level:d.level,open:d.open};});
  const result:TrafficGameInput={map,homes:[...homes].map(([cell,amount])=>({cell,amount})),destinations:[...destinations].map(([cell,amount])=>({cell,amount})),taxis:options.taxiEnabled?[...saved,...extra]:[]};
  if(options.workClock){
    // New work actors can only be claimed in the work window or when a
    // skipped window is being replayed. Keep the clock/ACK even when no
    // candidate roster is needed so outstanding cancellations still settle.
    const {minute,crossedWorkDay}=options.workClock;
    if((minute<WORK_TRIP_START_MINUTE||minute>=WORK_TRIP_END_MINUTE)&&crossedWorkDay===undefined){result.work={...options.workClock,candidates:[]};return result;}
    const buildings=new Map(city.buildings.map(b=>[b.id,b.cell]));
    const firms=new Map(city.firms.map(f=>[f.id,buildings.get(f.building)]));
    const parks=new Map(city.parks.map(p=>[p.id,p.cell]));
    const candidates:WorkTripInput['candidates']=[];
    const workAccess=new Map<number,boolean>();
    forEachParkActivityEmployedCitizen(city,(citizenId,homeId,firmId,parkJobId)=>{
      if(homeId===null)return;
      const home=homeAccess.get(homeId),work=firmId!==null?firms.get(firmId):parkJobId!==null?parks.get(parkJobId):undefined;
      if(home===undefined||work===undefined)return;
      let accessible=workAccess.get(work);if(accessible===undefined){accessible=frontages(map,work).length>0;workAccess.set(work,accessible);}
      if(!accessible)return;
      candidates.push({citizenId,home,work});
    });
    candidates.sort((a,b)=>a.citizenId.localeCompare(b.citizenId));
    result.work={...options.workClock,candidates:candidates.slice(0,MAX_WORK_CANDIDATES)};
  }
  return result;
}
/** Worker-side OD assembly: prefer road-reachable destinations over visually
 * close disconnected ones; when none are reachable retain an unreachable OD so
 * the game can display pressure until a road repair. */
export function trafficGameSampleFromInput(input:TrafficGameInput):TrafficGameSample {
  if(!input||!input.map||!Array.isArray(input.map.cells)||![576,EXPANDED_MAP_CELLS].includes(input.map.cells.length)||input.map.cells.some(c=>!c||typeof c.road!=='boolean')||!Array.isArray(input.homes)||!Array.isArray(input.destinations)||input.homes.length>input.map.cells.length||input.destinations.length>input.map.cells.length||[...input.homes,...input.destinations].some(x=>!x||!cell(x.cell)||x.cell>=input.map.cells.length||!Number.isFinite(x.amount)||x.amount<0))throw Error('Invalid traffic game input');
  if(input.map.roadTopology)validateRoadTopology(input.map,input.map.roadTopology);
  const net=buildNetwork(input.map),work=[...input.destinations].sort((a,b)=>a.cell-b.cell),demand:GameDemand[]=[];
  const cached=new Map<number,Int16Array>();
  const distances=(from:number)=>{let dist=cached.get(from);if(dist)return dist;dist=new Int16Array(input.map.cells.length);dist.fill(-1);dist[from]=0;const queue=[from];for(let i=0;i<queue.length;i++)for(const l of net.out.get(queue[i])??[])if(dist[l.to]<0){dist[l.to]=dist[queue[i]]+1;queue.push(l.to);}cached.set(from,dist);return dist;};
  for(const {cell:parcel,amount:weight} of [...input.homes].sort((a,b)=>a.cell-b.cell)) {
    const origins=frontages(input.map,parcel),options:{from:number;to:number;distance:number;size:number;parcel:number}[]=[];
    for(const d of work){let best:{from:number;to:number;distance:number}|null=null;
      for(const from of origins)for(const to of frontages(input.map,d.cell)){if(from===to)continue;const n=distances(from)[to];if(n<0)continue;if(!best||n<best.distance||n===best.distance&&(from<best.from||from===best.from&&to<best.to))best={from,to,distance:n};}
      if(best)options.push({...best,size:d.amount,parcel:d.cell});
    }
    // If no destination is reachable, preserve one representative disconnected
    // pressure route when both parcels have frontage; repair can then unlock it.
    if(!options.length&&origins.length){for(const d of work){const to=frontages(input.map,d.cell).find(n=>n!==origins[0]);if(to!==undefined)options.push({from:origins[0],to,distance:Math.abs(expandedCellCoordinate(to).x-expandedCellCoordinate(origins[0]).x)+Math.abs(expandedCellCoordinate(to).z-expandedCellCoordinate(origins[0]).z),size:d.amount,parcel:d.cell});}}
    options.sort((a,b)=>a.distance-b.distance||a.parcel-b.parcel||a.from-b.from||a.to-b.to);
    for(const {from,to,size} of options.slice(0,2))demand.push({from,to,rate:Math.sqrt(weight*size)*.12});
  }
  return {map:input.map,demand};
}
/** Convenience for tests; in the UI call captureTrafficGameInput on main and
 * trafficGameSampleFromInput in the worker to avoid routing on the render thread. */
export const captureTrafficGameSample=(city:City):TrafficGameSample=>trafficGameSampleFromInput(captureTrafficGameInput(city));

function cleanSample(sample:TrafficGameSample) {
  if(!sample||sample.clippedRate!==undefined&&(!Number.isFinite(sample.clippedRate)||sample.clippedRate<0||sample.clippedRate>Number.MAX_SAFE_INTEGER)||!sample.map||!Array.isArray(sample.map.cells)||![576,EXPANDED_MAP_CELLS].includes(sample.map.cells.length)||sample.map.cells.some(c=>!c||typeof c.road!=='boolean')||!Array.isArray(sample.demand)||sample.demand.length>4096)throw Error('Invalid traffic game sample');
  const map:RoadMap={cells:sample.map.cells.map(c=>({road:c.road})),...(sample.map.roadTopology?{roadTopology:structuredClone(sample.map.roadTopology)}:{})};
  if(map.roadTopology)validateRoadTopology(map,map.roadTopology);
  const grouped=new Map<string,GameDemand>();let clippedRate=sample.clippedRate??0;
  for(const d of sample.demand){if(!d||!cell(d.from)||!cell(d.to)||d.from>=sample.map.cells.length||d.to>=sample.map.cells.length||typeof d.rate!=='number'||!Number.isFinite(d.rate)||d.rate<0||d.rate>1_000_000)throw Error('Invalid traffic game demand');const taxi=asTaxiDemand(d).taxiRate??0;if(asTaxiDemand(d).taxiRate!==undefined&&(typeof asTaxiDemand(d).taxiRate!=='number'||!Number.isFinite(taxi)||taxi<0||taxi>d.rate+1e-6))throw Error('Invalid traffic game taxi demand');if(d.from===d.to){clippedRate+=d.rate;continue;}const k=pair(d.from,d.to),old=grouped.get(k) as TaxiDemand|undefined;if(old){old.rate+=d.rate;old.taxiRate=(old.taxiRate??0)+taxi;}else if(taxi>0){const row:TaxiDemand={from:d.from,to:d.to,rate:d.rate,taxiRate:taxi};grouped.set(k,row);}else grouped.set(k,{from:d.from,to:d.to,rate:d.rate});}
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

/** Each lane of a road tile holds up to three vehicles. Followers keep a bumper
 * gap of `standstillGap` when queued and `standstillGap + speed * headwayFactor`
 * while moving. A junction still admits one vehicle at a time, so a red light
 * packs that queue instead of reserving the tile for a single car. One step is
 * one real second, split into short following updates; a car still changes at
 * most one link per step. Source queues and visual actors stay capped; `dropped`
 * and `clippedRate` expose approximation rather than claiming complete trips. */
export class TrafficGame {
  private map:RoadMap;private network:LinkNetwork;private signature:string;
  private ods:OD[]=[];private cars:Actor[]=[];private stepValue=0;private nextId=1;private demandSignature='';
  private taxiTrips=0;private taxiTiles=0;private offered=0;private completed=0;private dropped=0;private cancelled=0;private clippedRate=0;
  private junctions=new Set<number>();private bends=new Set<number>();
  private navigation=emptyNavigationStats();
  private signals=new Map<number,SignalPhase>();
  private signalCorridors:ReadonlyMap<string,SignalCorridor>=new Map();private signalPeers?:SignalPeers;private signalSnapshots=new Map<number,SignalPeerSnapshot>();private signalSnapshotStep=0;
  private junctionRequests=new Map<number,{node:number;since:number}>();private junctionClock=0;
  private workMinute=-1;private workDay=-1;private workCandidates=new Map<string,string[]>();private workUsed=new Set<string>();
  private workUsedDay=-1;private workWindowDay=-1;private workLastWindow=-1;private workClaimDay=-1;
  // Keep completed worker cars too: their presentation queue may still occupy a junction.
  private workIssued=new Map<number,{day:number;citizenId:string}>();private workExpirationSequence=0;private workExpirationAck=0;
  private workExpirations:{sequence:number;id:number}[]=[];
  /** Advance only from the city's simulated clock; retain tombstones until the
   * host acknowledges an accepted frame, including across coalesced candidates. */
  setWork(input:WorkTripInput|undefined):void {
    if(!input)return;
    if(!Number.isSafeInteger(input.day)||input.day<0||!Number.isInteger(input.minute)||input.minute<0||input.minute>=1440||!Number.isSafeInteger(input.day*1440+input.minute)||!Number.isSafeInteger(input.ack)||input.ack<0||input.ack>this.workExpirationSequence||!Array.isArray(input.candidates)||input.candidates.length>MAX_WORK_CANDIDATES)throw Error('Invalid traffic work trip clock');
    if(input.crossedWorkDay!==undefined&&(!Number.isSafeInteger(input.crossedWorkDay)||input.crossedWorkDay<0||input.crossedWorkDay>input.day||input.crossedWorkDay*1440+WORK_TRIP_START_MINUTE>input.day*1440+input.minute))throw Error('Invalid crossed work window');
    const cancelIds=input.cancelIds??[],retiredIds=input.retiredIds??[];
    if(!Array.isArray(cancelIds)||!Array.isArray(retiredIds)||cancelIds.length>MAX_WORK_CANDIDATES||retiredIds.length>MAX_WORK_CANDIDATES||[...cancelIds,...retiredIds].some(id=>!Number.isSafeInteger(id)||id<1))throw Error('Invalid traffic work trip identities');
    const cancels=new Set(cancelIds),retirements=new Set(retiredIds);
    if(cancels.size!==cancelIds.length||retirements.size!==retiredIds.length||cancelIds.some(id=>retirements.has(id)))throw Error('Invalid traffic work trip identities');
    const ids=new Set<string>();
    for(const c of input.candidates){if(!c||typeof c.citizenId!=='string'||!c.citizenId||c.citizenId.length>128||ids.has(c.citizenId)||!cell(c.home)||!cell(c.work)||c.home>=this.map.cells.length||c.work>=this.map.cells.length)throw Error('Invalid traffic work trip candidate');ids.add(c.citizenId);}
    this.workExpirationAck=Math.max(this.workExpirationAck,input.ack);
    this.workExpirations=this.workExpirations.filter(e=>e.sequence>this.workExpirationAck);
    const absolute=input.day*1440+input.minute;
    if(absolute<this.workMinute)return; // stale clock cannot resurrect a prior day or trip
    const expiring=cancelIds.filter(id=>{const trip=this.workIssued.get(id);return trip&&(trip.day<input.day||trip.day===input.day&&input.minute>=WORK_TRIP_END_MINUTE);}).sort((a,b)=>a-b);
    if(this.workExpirations.length+expiring.length>MAX_UNACKNOWLEDGED_WORK_EXPIRATIONS)throw Error('Traffic work trip acknowledgements stalled');
    const expired=new Set(expiring);
    for(const id of expiring){this.workIssued.delete(id);this.junctionRequests.delete(id);this.workExpirations.push({sequence:++this.workExpirationSequence,id});}
    if(expired.size){const before=this.cars.length;this.cars=this.cars.filter(c=>!expired.has(c.id));this.cancelled+=before-this.cars.length;}
    // The host only reports terminal presentation retirement after an accepted
    // frame lacks the actor. Never discard an issued token for a live model car.
    const moving=new Set(this.cars.map(c=>c.id));
    for(const id of retiredIds)if(!moving.has(id))this.workIssued.delete(id);
    this.workDay=input.day;if(input.crossedWorkDay!==undefined)this.workWindowDay=Math.max(this.workWindowDay,input.crossedWorkDay);
    this.workMinute=absolute;
    const byPair=new Map<string,string[]>(),frontageCache=new Map<number,number[]>();
    const access=(at:number)=>{let list=frontageCache.get(at);if(!list){list=frontages(this.map,at);frontageCache.set(at,list);}return list;};
    for(const c of [...input.candidates].sort((a,b)=>a.citizenId.localeCompare(b.citizenId)))for(const from of access(c.home))for(const to of access(c.work)){
      if(from===to)continue;const key=pair(from,to);(byPair.get(key)??byPair.set(key,[]).get(key)!).push(c.citizenId);
    }
    this.workCandidates=byPair;
  }
  private claimNewWorkTrips():void {
    const claimDay=this.workClaimDay;
    const outstanding=new Set([...this.workIssued.values()].map(t=>t.citizenId));
    for(const car of this.cars){
      if(!car.workClaimPending)continue;car.workClaimPending=false;
      if(claimDay<0||(car as TaxiActor).taxi)continue;
      if(this.workIssued.size>=MAX_WORK_CANDIDATES)continue;
      const id=this.workCandidates.get(pair(car.path[0],car.destination))?.find(candidate=>!this.workUsed.has(candidate)&&!outstanding.has(candidate));
      if(id===undefined)continue;
      this.workUsed.add(id);outstanding.add(id);car.workCitizen=id;this.workIssued.set(car.id,{day:claimDay,citizenId:id});
    }
  }
  /** Bus (optional; null = unchanged game). Shares per OD, PCU load per link, cumulative totals/injections. */
  private bus:{input:GameBusInput;shares:Map<string,GameBusShare|null>}|null=null;private busTotals=new Map<string,GameBusTotal>();private busInjected:Record<string,number>={};private busDiverted=0;private busReturned=0;
  /** Set or clear bus input. Load replaces the previous load; returns are cumulative (delta injected once). */
  setBus(input:GameBusInput|null|undefined):void {
    if(!input){this.bus=null;return;}
    if(!validGameBusInput(input))throw Error('Invalid traffic game bus input');
    this.bus={input,shares:new Map()};
    for(const [k,total] of Object.entries(input.returns)){const done=this.busInjected[k]??0,delta=total-done;if(delta<=1e-9)continue;const [from,to]=k.split(':').map(Number);
      const od=this.ods.find(o=>o.from===from&&o.to===to);if(od){const value=od.waiting+delta;od.waiting=Math.min(GAME_MAX_QUEUE,value);this.dropped+=Math.max(0,value-GAME_MAX_QUEUE);}else this.cancelled+=delta; // no matching OD now: reported, not hidden
      this.offered+=delta;this.busReturned+=delta;this.busInjected[k]=total;}
  }
  private busLoad(k:string):number {return this.bus?.input.load[k]??0;}
  private busShareFor(od:OD):GameBusShare|null {if(!this.bus)return null;const k=pair(od.from,od.to);if(!this.bus.shares.has(k))this.bus.shares.set(k,gameBusShare(this.bus.input,od.from,od.to));return this.bus.shares.get(k)!;}
  constructor(sample:TrafficGameSample){const s=cleanSample(sample);this.map=s.map;this.signature=this.key(s.map);this.network=buildNetwork(this.map);this.replaceRows(s.rows,s.clippedRate);this.prepareJunctions();this.replan();}
  private key(map:RoadMap){return signalTopologyKey(map);}
  private prepareJunctions(){this.signals.clear();this.junctionRequests.clear();const adj=new Map<number,Set<number>>();for(const l of this.network.links.values())for(const [a,b] of [[l.from,l.to],[l.to,l.from]])(adj.get(a)??adj.set(a,new Set()).get(a)!).add(b);const bent=(n:number,v:Set<number>)=>{const [a,b]=[...v].map(expandedCellCoordinate),p=expandedCellCoordinate(n);return a.x+b.x!==2*p.x||a.z+b.z!==2*p.z;};this.bends=new Set([...adj].filter(([n,v])=>v.size===2&&bent(n,v)).map(([n])=>n));this.junctions=new Set([...adj].filter(([n,v])=>v.size>2||v.size===2&&bent(n,v)).map(([n])=>n));this.prepareSignalPeers();}
  private prepareSignalPeers():void {
    this.signalSnapshots.clear();this.signalSnapshotStep=this.junctionClock;this.signalCorridors=buildSignalCorridors(this.network,this.junctions,this.bends);
    const graph={revision:this.signature,nodes:[...this.junctions].filter(n=>!this.bends.has(n)),corridors:[...this.signalCorridors.values()]};
    this.signalPeers=this.signalPeers?.withGraph(graph)??new SignalPeers(graph);
  }
  private replaceRows(rows:GameDemand[],clippedRate:number){const prior=new Map(this.ods.map(o=>[pair(o.from,o.to),o]));this.ods=rows.map(d=>{const old=prior.get(pair(d.from,d.to)) as TaxiOd|undefined;prior.delete(pair(d.from,d.to));const taxiRate=Math.min(d.rate,Math.max(0,demandTaxiRate(d)));const row:TaxiOd={...d,waiting:old?.waiting??0,path:old?.path??null};if(taxiRate>1e-12)row.taxiRate=taxiRate;else delete row.taxiRate;row.taxiCredit=taxiRate>0?old?.taxiCredit??0:0;row.taxiMarkedStep=old?.taxiMarkedStep??-1;return row;});for(const old of prior.values())this.cancelled+=old.waiting;this.clippedRate=clippedRate;this.demandSignature=JSON.stringify(rows);}
  setSample(sample:TrafficGameSample):void {const s=cleanSample(sample),signature=this.key(s.map),changed=signature!==this.signature, demandChanged=JSON.stringify(s.rows)!==this.demandSignature;this.replaceRows(s.rows,s.clippedRate);if(changed){this.map=s.map;this.signature=signature;this.network=buildNetwork(this.map);this.prepareJunctions();this.reconcileActors();}if(changed||demandChanged)this.replan();}
  /** Reconcile topology without consuming time, including while paused. */
  private reconcileActors():void {const times=new Map([...this.network.links].map(([key])=>[key,1])),routes=new Map<string,number[]|null>();for(const c of this.cars){const from=c.path[c.index],head=c.path[c.index+1];if(!this.network.links.has(linkKey(from,head))){c.blocked=true;c.speed=0;continue;}if(head===c.destination){c.blocked=false;continue;}if(c.path.slice(c.index+1).every((node,i)=>i===0||this.network.links.has(linkKey(c.path[c.index+i],node)))){c.blocked=false;continue;}const key=pair(head,c.destination);if(!routes.has(key))routes.set(key,shortestPath(this.network,times,head,c.destination));const tail=routes.get(key)!;if(!tail){c.blocked=true;c.speed=0;}else{c.path=[from,...tail];c.index=0;c.blocked=false;}}}
  reset(sample?:TrafficGameSample):void {const s=sample?cleanSample(sample):null,rows=s?.rows??this.ods.map(o=>{const row:TaxiDemand={from:o.from,to:o.to,rate:o.rate};const taxi=demandTaxiRate(o);if(taxi>0)row.taxiRate=taxi;return row;}),clipped=s?.clippedRate??this.clippedRate;this.cars=[];this.ods=[];this.signals.clear();this.junctionRequests.clear();this.junctionClock=0;this.stepValue=0;this.nextId=1;this.offered=this.completed=this.dropped=this.cancelled=0;this.taxiTrips=this.taxiTiles=0;this.workMinute=-1;this.workDay=-1;this.workUsedDay=-1;this.workWindowDay=-1;this.workLastWindow=-1;this.workClaimDay=-1;this.workCandidates.clear();this.workUsed.clear();this.workIssued.clear();this.workExpirationSequence=0;this.workExpirationAck=0;this.workExpirations=[];if(s){this.map=s.map;this.signature=this.key(s.map);this.network=buildNetwork(this.map);this.prepareJunctions();}this.replaceRows(rows,clipped);this.replan();if(!s)this.prepareSignalPeers();}
  /** Detached in-memory transaction candidate; never a save representation. */
  clone():TrafficGame {const copy=Object.create(TrafficGame.prototype) as TrafficGame;
    // Network, map and junction set are immutable after construction; road edits
    // replace them wholesale. Mutable actors/queues are detached before a step.
    copy.navigation={...this.navigation};copy.signalCorridors=this.signalCorridors;copy.signalPeers=this.signalPeers?.clone();copy.signalSnapshots=new Map(this.signalSnapshots);copy.signalSnapshotStep=this.signalSnapshotStep;
    copy.signals=new Map([...this.signals].map(([node,phase])=>[node,{...phase}]));
    copy.junctionRequests=new Map([...this.junctionRequests].map(([id,r])=>[id,{...r}]));copy.junctionClock=this.junctionClock;
    copy.map=this.map;copy.network=this.network;copy.junctions=this.junctions;copy.bends=this.bends;copy.signature=this.signature;
    copy.workMinute=this.workMinute;copy.workDay=this.workDay;copy.workUsedDay=this.workUsedDay;copy.workWindowDay=this.workWindowDay;copy.workLastWindow=this.workLastWindow;copy.workClaimDay=this.workClaimDay;copy.workCandidates=new Map([...this.workCandidates].map(([key,ids])=>[key,[...ids]]));copy.workUsed=new Set(this.workUsed);copy.workIssued=new Map([...this.workIssued].map(([id,trip])=>[id,{...trip}]));copy.workExpirationSequence=this.workExpirationSequence;copy.workExpirationAck=this.workExpirationAck;copy.workExpirations=this.workExpirations.map(e=>({...e}));
    copy.ods=structuredClone(this.ods);copy.cars=structuredClone(this.cars);copy.stepValue=this.stepValue;copy.nextId=this.nextId;copy.taxiTrips=this.taxiTrips;copy.taxiTiles=this.taxiTiles;copy.offered=this.offered;copy.completed=this.completed;copy.dropped=this.dropped;copy.cancelled=this.cancelled;copy.clippedRate=this.clippedRate;copy.demandSignature=this.demandSignature;copy.bus=this.bus;copy.busTotals=new Map([...this.busTotals].map(([k,v])=>[k,{...v}]));copy.busInjected={...this.busInjected};copy.busDiverted=this.busDiverted;copy.busReturned=this.busReturned;return copy;}
  private replan():void {
    const occupancy=new Map<string,number>();for(const c of this.cars){const k=linkKey(c.path[c.index],c.path[c.index+1]);occupancy.set(k,(occupancy.get(k)??0)+1);}
    const times=new Map([...this.network.links].map(([k,l])=>[k,1+((occupancy.get(k)??0)+this.busLoad(k))/Math.max(1,l.lanes)*3]));
    const epoch=Math.floor(this.stepValue/REROUTE_STEPS),navigator=createRoadNavigator(this.network,times,{epoch});
    // Rotate bounded exploration opportunity; admitted actors retain their exact routes.
    const offset=this.ods.length?epoch%this.ods.length:0;
    for(let i=0;i<this.ods.length;i++){const od=this.ods[(i+offset)%this.ods.length];od.path=navigator.route(od.from,od.to).path;}
    this.navigation=navigator.stats();
  }
  private actorLink(c:Actor):string {return linkKey(c.path[c.index],c.path[c.index+1]);}
  private laneCount(key:string):number {return this.network.links.get(key)?.lanes??1;}
  /** Free lane index, or -1 when every lane of the link is at the per-lane cap or bus load fills it. */
  private pickLane(key:string,withheld:ReadonlySet<string>):number {
    const link=this.network.links.get(key);if(!link)return -1;
    const here=this.cars.filter(c=>this.actorLink(c)===key);
    if(here.length+this.busLoad(key)+1>link.lanes*STORAGE_PER_LANE)return -1;
    let best=-1,n=Infinity;
    for(let lane=0;lane<link.lanes;lane++){const count=here.filter(c=>c.lane===lane).length;if(withheld.has(key+":"+lane)||count>=STORAGE_PER_LANE||!this.tailClear(key,lane))continue;if(count<n){best=lane;n=count;}}
    return best;
  }
  private tailClear(key:string,lane:number):boolean {
    let tail=Infinity;for(const c of this.cars)if(this.actorLink(c)===key&&c.lane===lane)tail=Math.min(tail,c.progress);
    const start=this.junctions.has(this.network.links.get(key)!.from)?JUNCTION_CLEAR:LANE_START;
    return tail>=start+SLOT_PITCH-1e-9;
  }
  /** Nearest vehicle ahead in this lane, in tile units measured from the start of `c`'s link. */
  private leaderOf(c:Actor):{pos:number;speed:number}|null {
    const key=this.actorLink(c);let best:Actor|null=null;
    for(const o of this.cars){if(o===c||o.lane!==c.lane||this.actorLink(o)!==key||o.progress<=c.progress+1e-9)continue;if(!best||o.progress<best.progress)best=o;}
    if(best)return {pos:best.progress,speed:best.speed};
    const head=c.path[c.index+1];if(head===c.destination||c.path[c.index+2]===undefined)return null;
    const next=linkKey(head,c.path[c.index+2]),lane=Math.min(c.lane,this.laneCount(next)-1);let tail:Actor|null=null;
    for(const o of this.cars){if(o===c||o.lane!==lane||this.actorLink(o)!==next)continue;if(!tail||o.progress<tail.progress)tail=o;}
    return tail?{pos:1+tail.progress,speed:tail.speed}:null;
  }
  /** Move one car by `dt` seconds. `grant` is the single vehicle allowed through each junction this step. */
  private rollCar(c:Actor,dt:number,grant:Map<number,number>):boolean {
    const W=TRAFFIC_SPACING.worldPerTile,len=TRAFFIC_SPACING.lengths.sedan;
    const from=c.path[c.index],head=c.path[c.index+1],link=this.network.links.get(linkKey(from,head));
    if(!link){c.blocked=true;c.speed=0;return false;}
    c.lane=Math.min(c.lane,link.lanes-1);
    if(head!==c.destination&&(c.path[c.index+2]===undefined||!this.network.links.has(linkKey(head,c.path[c.index+2])))){
      const times=new Map([...this.network.links].map(([key])=>[key,1])),tail=shortestPath(this.network,times,head,c.destination);
      if(!tail){c.blocked=true;c.speed=0;return false;}c.path=[from,...tail];c.index=0;
    }
    const nextCell=c.path[c.index+2],priorCell=c.path[c.index-1];
    const approachingTurn=nextCell!==undefined&&expandedRoadDirection(from,head)!==expandedRoadDirection(head,nextCell)&&c.progress>.45;
    const leavingTurn=priorCell!==undefined&&expandedRoadDirection(priorCell,from)!==expandedRoadDirection(from,head)&&c.progress<JUNCTION_CLEAR;
    const maxSpeed=(approachingTurn||leavingTurn?TRAFFIC_SPACING.turnSpeedTiles:TRAFFIC_SPACING.maxSpeedTiles)*W;
    const junction=this.junctions.has(head),holder=grant.get(head),blockedNode=junction&&holder!==c.id;
    let ahead=this.leaderOf(c);
    // Treat a held crossing as a stopped leader, braking before the safety clamp.
    if(blockedNode){const stop=JUNCTION_STOP+(len+TRAFFIC_SPACING.standstillGap)/W;if(!ahead||stop<ahead.pos)ahead={pos:stop,speed:0};}
    const current:LaneVehicle={posOnLane:c.progress*W,speed:c.speed*W,maxSpeed,length:len};
    const leader:LaneVehicle|null=ahead?{posOnLane:ahead.pos*W,speed:ahead.speed*W,maxSpeed,length:len}:null;
    updateVehicleFollowing(current,leader,dt);
    let progress=current.posOnLane/W,speed=current.speed/W;
    if(!Number.isFinite(progress)||!Number.isFinite(speed)){c.blocked=true;c.speed=0;return false;}
    const end=head===c.destination,nextKey=end||c.path[c.index+2]===undefined?null:linkKey(head,c.path[c.index+2]);
    const nextLane=nextKey?Math.min(c.lane,this.laneCount(nextKey)-1):c.lane;
    if(blockedNode&&progress>JUNCTION_STOP){progress=JUNCTION_STOP;speed=0;c.blocked=true;}
    else if(junction&&progress>JUNCTION_STOP){grant.set(head,c.id);c.blocked=false;}
    else c.blocked=speed<0.05&&(ahead!==null||junction);
    c.progress=progress;c.speed=Math.max(0,speed);
    if(c.progress<1)return false;
    if(end){if(blockedNode){c.progress=JUNCTION_STOP;c.speed=0;c.blocked=true;return false;}if(junction)grant.set(head,c.id);return true;}
    if(!nextKey||!this.network.links.has(nextKey)||!this.pickLaneWouldFit(nextKey,nextLane)||blockedNode){c.progress=Math.min(c.progress,1-1e-4);c.speed=0;c.blocked=true;return false;}
    if(junction)grant.set(head,c.id);
    c.index++;c.visits=(c.visits??0)+1;c.progress-=1;c.lane=nextLane;c.blocked=false;return false;
  }
  /** True when `lane` can take one more car. Unlike pickLane, does not search other lanes. */
  private pickLaneWouldFit(key:string,lane:number):boolean {
    const link=this.network.links.get(key);if(!link||lane<0||lane>=link.lanes)return false;
    const here=this.cars.filter(c=>this.actorLink(c)===key);
    if(here.length+this.busLoad(key)+1>link.lanes*STORAGE_PER_LANE)return false;
    return here.filter(c=>c.lane===lane).length<STORAGE_PER_LANE;
  }
  private junctionExitClear(key:string,lane:number):boolean {
    if(!this.pickLaneWouldFit(key,lane))return false;
    const tail=this.cars.filter(c=>this.actorLink(c)===key&&c.lane===lane).reduce((v,c)=>Math.min(v,c.progress),Infinity);
    return tail>=JUNCTION_CLEAR+(TRAFFIC_SPACING.lengths.sedan+TRAFFIC_SPACING.standstillGap)/TRAFFIC_SPACING.worldPerTile;
  }
  /** Project already-reserved crossings plus this admission, then reject a circular
   * lane dependency. Followers depend on their leader; heads depend on the next
   * lane only when its eventual physical holding slots (or shared PCU capacity)
   * are full. A moving single tail with future room is not a permanent blocker.
   * Fixed routes and identities are never rewritten; external stationary loads
   * and road edits that already introduce cycles are not recovery guarantees.
   * At most128 actors, one dependency per actor: bounded queue construction and linear graph walk, not a search. */
  private admissionIsAcyclic(grant:ReadonlyMap<number,number>, entering?:Actor):boolean {
    type Position={actor:Actor;index:number;progress:number;lane:number};
    const lanes=new Map<string,Position[]>(),links=new Map<string,Position[]>(),positions:Position[]=[];
    for(const actor of entering?[...this.cars,entering]:this.cars){
      let index=actor.index,progress=actor.progress,lane=actor.lane;
      const head=actor.path[index+1];
      if(grant.get(head)===actor.id){if(head===actor.destination)continue;index++;progress=-1;lane=Math.min(lane,this.laneCount(linkKey(actor.path[index],actor.path[index+1]))-1);}
      const key=`${linkKey(actor.path[index],actor.path[index+1])}:${lane}`,position={actor,index,progress,lane};positions.push(position);const linkKeyValue=linkKey(actor.path[index],actor.path[index+1]),linkList=links.get(linkKeyValue)??[];linkList.push(position);links.set(linkKeyValue,linkList);const list=lanes.get(key)??[];list.push(position);lanes.set(key,list);
    }
    const dependency=new Map<number,number>();
    for(const list of lanes.values()){
      list.sort((a,b)=>b.progress-a.progress||a.actor.id-b.actor.id);
      for(let i=1;i<list.length;i++)dependency.set(list[i].actor.id,list[i-1].actor.id);
      const lead=list[0],next=lead.actor.path[lead.index+2];if(next===undefined||lead.actor.path[lead.index+1]===lead.actor.destination)continue;
      const nextKey=linkKey(lead.actor.path[lead.index+1],next),lane=Math.min(lead.lane,this.laneCount(nextKey)-1),target=lanes.get(`${nextKey}:${lane}`);
      const start=this.junctions.has(lead.actor.path[lead.index+1])?JUNCTION_CLEAR:LANE_START,stop=this.junctions.has(next)?JUNCTION_STOP:1;
      const holdingCapacity=Math.min(STORAGE_PER_LANE,Math.max(1,1+Math.floor((stop-start+1e-9)/SLOT_PITCH)));
      const link=this.network.links.get(nextKey),shared=links.get(nextKey)??[];
      const fullShared=!!link&&shared.length+this.busLoad(nextKey)+1>link.lanes*STORAGE_PER_LANE;
      const blockers=target&&target.length>=holdingCapacity?target:fullShared?(target?.length?target:shared):undefined;
      if(blockers?.length){const tail=blockers.reduce((a,b)=>a.progress<b.progress?a:b);dependency.set(lead.actor.id,tail.actor.id);}
    }
    const finished=new Set<number>();for(const p of positions){let id:number|undefined=p.actor.id;const path=new Set<number>();while(id!==undefined&&!finished.has(id)){if(path.has(id))return false;path.add(id);id=dependency.get(id);}for(const seen of path)finished.add(seen);}
    return true;
  }
  private substep(dt:number,grant:Map<number,number>):void {
    // Physical grants outlive phases and remain exclusive until the body clears.
    this.junctionClock++;
    for(const [node,id]of grant)if(!this.cars.some(c=>c.id===id&&(c.path[c.index]===node&&c.progress<JUNCTION_CLEAR||c.path[c.index+1]===node&&c.progress>JUNCTION_STOP)))grant.delete(node);
    const candidates=this.cars.filter(c=>this.junctions.has(c.path[c.index+1])&&c.progress>=.45);
    const candidateIds=new Set(candidates.map(c=>c.id));
    for(const id of this.junctionRequests.keys())if(!candidateIds.has(id))this.junctionRequests.delete(id);
    for(const c of candidates){const node=c.path[c.index+1];if(this.junctionRequests.get(c.id)?.node!==node)this.junctionRequests.set(c.id,{node,since:this.junctionClock});}
    candidates.sort((a,b)=>this.junctionRequests.get(a.id)!.since-this.junctionRequests.get(b.id)!.since||a.id-b.id);
    // Group once per substep: approach pressure is independent of the number
    // of junctions in the map and does not repeatedly scan the bounded fleet.
    const linkTotals=new Map<string,number>(),lanes=new Map<string,{count:number;head:number;tail:number}>(),allQueues=new Map<number,Map<number,number>>();
    const laneKey=(c:Actor)=>`${this.actorLink(c)}:${c.lane}`;
    for(const c of this.cars){const link=this.actorLink(c),key=`${link}:${c.lane}`,row=lanes.get(key);linkTotals.set(link,(linkTotals.get(link)??0)+1);if(row){row.count++;row.head=Math.max(row.head,c.progress);row.tail=Math.min(row.tail,c.progress);}else lanes.set(key,{count:1,head:c.progress,tail:c.progress});
      const node=c.path[c.index+1],from=c.path[c.index],incoming=allQueues.get(node)??new Map<number,number>();incoming.set(from,(incoming.get(from)??0)+1);allQueues.set(node,incoming);
    }
    const eligible=new Set<Actor>(),demands=new Map<number,Map<number,SignalDemand>>();
    for(const c of this.cars){
      const node=c.path[c.index+1];if(!this.junctions.has(node)||lanes.get(laneKey(c))!.head>c.progress)continue;
      const next=c.path[c.index+2];
      if(node!==c.destination){
        if(next===undefined)continue;const key=linkKey(node,next),link=this.network.links.get(key),lane=Math.min(c.lane,this.laneCount(key)-1),row=lanes.get(`${key}:${lane}`);
        // This read-only decision pass precedes every grant/move/spawn. Reuse
        // its exact occupancy snapshot; live movement checks below stay fresh.
        if(!link||lane<0||lane>=link.lanes||(linkTotals.get(key)??0)+this.busLoad(key)+1>link.lanes*STORAGE_PER_LANE||(row?.count??0)>=STORAGE_PER_LANE||!((row?.tail??Infinity)>=JUNCTION_CLEAR+(TRAFFIC_SPACING.lengths.sedan+TRAFFIC_SPACING.standstillGap)/TRAFFIC_SPACING.worldPerTile))continue;
      }
      eligible.add(c);if(this.bends.has(node))continue;
      const approach=c.path[c.index],oldest=this.junctionRequests.get(c.id)?.since??this.junctionClock;
      // Only followers behind this feasible head count; blocked adjacent lanes do not.
      const queue=lanes.get(laneKey(c))!.count,approaches=demands.get(node)??new Map<number,SignalDemand>();demands.set(node,approaches);
      const old=approaches.get(approach);if(old){old.oldest=Math.min(old.oldest,oldest);old.queue+=queue;}
      else approaches.set(approach,{approach,oldest,queue});
    }
    // Receive only last substep's immutable observations. All decisions commit
    // together, so neither node iteration order nor fresh peer writes feed back.
    if(this.signalSnapshots.size)this.signalPeers?.exchange(this.signalSnapshots,this.signalSnapshotStep,[...demands.keys()]);
    this.coordinateSignals(demands,eligible,lanes);
    const nextSignals=new Map<number,SignalPhase>();
    for(const node of this.junctions){
      if(this.bends.has(node))continue;
      nextSignals.set(node,chooseSignal(this.signals.get(node),[...(demands.get(node)?.values()??[])],this.junctionClock,grant.has(node)));
    }
    this.signals=nextSignals;
    const snapshots=new Map<number,SignalPeerSnapshot>();
    for(const [node,phase] of nextSignals){
      // Telemetry includes physically blocked queues, unlike local admission
      // demand. Report usable tail-space, not merely unused vehicle count.
      const byApproach=Object.fromEntries(allQueues.get(node)??[]);let capacity=0,free=0;
      for(const link of this.network.out.get(node)??[]){let linkFree=0;capacity+=link.lanes*STORAGE_PER_LANE;
        for(let lane=0;lane<link.lanes;lane++){const row=lanes.get(`${linkKey(node,link.to)}:${lane}`);if(!row||row.tail>=JUNCTION_CLEAR+(TRAFFIC_SPACING.lengths.sedan+TRAFFIC_SPACING.standstillGap)/TRAFFIC_SPACING.worldPerTile)linkFree+=STORAGE_PER_LANE-(row?.count??0);}
        free+=Math.max(0,linkFree-this.busLoad(linkKey(node,link.to)));
      }
      snapshots.set(node,{node,approach:phase.approach,state:phase.approach===null?'clearance':'green',since:phase.since,clearUntil:phase.clearUntil,byApproach,queue:Object.values(byApproach).reduce((a,b)=>a+b,0),space:capacity?Math.max(0,Math.min(1,free/capacity)):0});
    }
    this.signalSnapshots=snapshots;this.signalSnapshotStep=this.junctionClock;
    for(const c of candidates){
      if(!eligible.has(c))continue;
      const node=c.path[c.index+1];if(grant.has(node))continue;
      if(!this.bends.has(node)&&this.signals.get(node)?.approach!==c.path[c.index])continue;
      const proposed=new Map(grant).set(node,c.id);if(!this.admissionIsAcyclic(proposed))continue;
      grant.set(node,c.id);
    }
    const ids=new Set(this.cars.map(c=>c.id)),done=new Set<number>(),finished:number[]=[];
    while(done.size<ids.size){
      let pick:Actor|null=null;
      for(const c of this.cars)if(ids.has(c.id)&&!done.has(c.id)&&(!pick||c.progress>pick.progress+1e-9||(Math.abs(c.progress-pick.progress)<=1e-9&&c.id<pick.id)))pick=c;
      if(!pick)break;const id=pick.id;if(this.rollCar(pick,dt,grant))finished.push(id);done.add(id);
    }
    if(finished.length){const gone=new Set(finished);for(const c of this.cars)if(gone.has(c.id)){this.completed++;if((c as TaxiActor).taxi){this.taxiTrips++;this.taxiTiles+=Math.max(1,c.path.length-1);}}this.cars=this.cars.filter(c=>!gone.has(c.id));}
    this.spawnWave(grant);
  }
  /** RRT chooses cached nearby dissemination paths; messages, not the search,
   * carry state. Extra peers only add bounded pressure on their actual first hop. */
  private coordinateSignals(demands:Map<number,Map<number,SignalDemand>>,eligible:ReadonlySet<Actor>,lanes:ReadonlyMap<string,{count:number;head:number}>):void {
    const messages=new Map([...demands.keys()].map(node=>[node,this.signalPeers?.read(node,this.junctionClock)??[]]));
    const sums=new Map<SignalDemand,{sum:number;heads:number}>();
    for(const c of eligible){const node=c.path[c.index+1],next=c.path[c.index+2],demand=demands.get(node)?.get(c.path[c.index]);if(!demand)continue;
      const row=sums.get(demand)??{sum:0,heads:0};row.heads++;sums.set(demand,row);
      if(next===undefined)continue;const corridor=this.signalCorridors.get(linkKey(node,next));if(!corridor)continue;
      const peers=messages.get(node)??[],direct=peers.find(p=>p.origin===corridor.to);if(!direct)continue;
      const payload=direct.payload,state:NeighborSignalState={node:payload.node,phase:{approach:payload.approach,since:payload.since,clearUntil:payload.clearUntil},queue:payload.queue,space:payload.space,byApproach:payload.byApproach??{}};
      const far=peers.filter(p=>p.origin!==corridor.to&&p.route.at(-2)===corridor.to).reduce((max,p)=>Math.max(max,(p.payload.space<=0?Math.min(1,p.payload.queue/3):0)/Math.max(1,p.route.length-1)),0);
      const key=linkKey(node,next),lane=Math.min(c.lane,this.laneCount(key)-1),space=Math.max(0,1-(lanes.get(`${key}:${lane}`)?.count??0)/STORAGE_PER_LANE);
      row.sum+=neighborSignalBias(state,corridor.approach,Math.ceil(corridor.distance/TRAFFIC_SPACING.maxSpeedTiles*SUBSTEPS),this.junctionClock,space,far);
    }
    for(const [demand,row] of sums)demand.coordination=row.sum/row.heads;
  }
  /** One departure per OD per substep, only into a bumper gap, so cars leave in a line instead of a burst. */
  private spawnWave(grant:ReadonlyMap<number,number>):void {
    const shift=this.ods.length?this.stepValue%this.ods.length:0;
    const occupancy=new Map<string,number>(),withheld=new Set<string>();
    for(const car of this.cars){
      const current=this.actorLink(car);
      occupancy.set(current,(occupancy.get(current)??0)+1);
      const request=this.junctionRequests.get(car.id),node=car.path[car.index+1],next=car.path[car.index+2];
      if(!request || request.node!==node || next===undefined || !this.network.links.has(current))continue;
      if(this.junctionClock-request.since<SIGNAL_URGENT_WAIT)continue;
      // A new departure must not take the next free slot from an overdue through car.
      const exit=linkKey(node,next);
      withheld.add(exit+":"+Math.min(car.lane,this.laneCount(exit)-1));
    }
    let alternateTimes:Map<string,number>|undefined;
    for(const od of [...this.ods.slice(shift),...this.ods.slice(0,shift)]){
      if(od.waiting<1||this.cars.length>=GAME_MAX_CARS||grant.has(od.from))continue;
      let path=od.path;if(!path||path.length<2)continue;
      let lane=this.pickLane(linkKey(path[0],path[1]),withheld);
      if(lane<0||!this.tailClear(linkKey(path[0],path[1]),lane)){
        const starts=(this.network.out.get(od.from)??[]).filter(l=>{const key=linkKey(l.from,l.to),slot=this.pickLane(key,withheld);return slot>=0&&this.tailClear(key,slot);});
        if(!starts.length)continue;
        const graph={...this.network,out:new Map(this.network.out).set(od.from,starts)};
        alternateTimes??=new Map([...this.network.links].map(([k,l])=>[k,1+((occupancy.get(k)??0)+this.busLoad(k))/Math.max(1,l.lanes)*3]));
        const alt=shortestPath(graph,alternateTimes,od.from,od.to);if(!alt||alt.length<2)continue;
        path=alt;lane=this.pickLane(linkKey(path[0],path[1]),withheld);if(lane<0)continue;
      }
      const first=linkKey(path[0],path[1]);if(!this.tailClear(first,lane))continue;
      const actor:Actor={id:this.nextId,destination:od.to,path:[...path],index:0,visits:0,blocked:false,progress:this.junctions.has(path[0])?JUNCTION_CLEAR:LANE_START,speed:0,lane,...(this.workMinute>=0?{workClaimPending:true}:{})};
      if(!this.admissionIsAcyclic(grant,actor))continue;
      od.waiting-=1;this.nextId++;this.cars.push(actor);
      occupancy.set(first,(occupancy.get(first)??0)+1);
      if(alternateTimes){const link=this.network.links.get(first)!;alternateTimes.set(first,1+((occupancy.get(first)??0)+this.busLoad(first))/Math.max(1,link.lanes)*3);}
    }
  }
  step(paused=false):TrafficGameFrame {
    if(paused)return this.frame;
    const minute=this.workMinute<0?-1:this.workMinute%1440;
    let claimDay=minute>=WORK_TRIP_START_MINUTE&&minute<WORK_TRIP_END_MINUTE?this.workDay:this.workWindowDay>this.workLastWindow?this.workWindowDay:-1;
    if(claimDay<this.workUsedDay)claimDay=-1;
    if(claimDay>this.workUsedDay){this.workUsed.clear();this.workUsedDay=claimDay;}
    if(claimDay>=0)this.workLastWindow=Math.max(this.workLastWindow,claimDay);
    this.workClaimDay=claimDay;
    this.stepValue++;
    for(const od of this.ods){const b=this.busShareFor(od),busPart=b?od.rate*b.share:0;if(b&&busPart>0){const key=`${od.from}:${od.to}:${b.lineId}:${b.fromStopId}:${b.toStopId}`,t=this.busTotals.get(key)??{from:od.from,to:od.to,lineId:b.lineId,fromStopId:b.fromStopId,toStopId:b.toStopId,total:0};t.total+=busPart;this.busTotals.set(key,t);this.busDiverted+=busPart;}const road=od.rate-busPart;this.offered+=road;const value=od.waiting+road;od.waiting=Math.min(GAME_MAX_QUEUE,value);this.dropped+=Math.max(0,value-GAME_MAX_QUEUE);}
    if(this.stepValue%REROUTE_STEPS===0)this.replan();
    const grant=new Map<number,number>();
    // A body leaving the square still owns it across worker-step boundaries.
    for(const c of this.cars){if(c.progress<JUNCTION_CLEAR&&this.junctions.has(c.path[c.index]))grant.set(c.path[c.index],c.id);
      if(c.progress>JUNCTION_STOP&&this.junctions.has(c.path[c.index+1]))grant.set(c.path[c.index+1],c.id);}
    for(let i=0;i<SUBSTEPS;i++)this.substep(1/SUBSTEPS,grant);
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
      const fleet = this.cars.filter(c => !(c as TaxiActor).taxi && !c.workCitizen && c.destination === od.to && c.path[0] === od.from);
      while ((book.taxiCredit ?? 0) >= 1 && fleet.length) { (fleet.shift() as TaxiActor).taxi = true; book.taxiCredit = (book.taxiCredit ?? 0) - 1; }
    }
  }
  get frame():TrafficGameFrame {
    this.markDispatchedTaxis();
    this.claimNewWorkTrips();
    const cars=this.cars.map(c=>{const car:GameCar={id:c.id,from:c.path[c.index],to:c.path[c.index+1],blocked:c.blocked,progress:c.progress,lane:c.lane,speed:c.speed,destination:c.destination,nextVisit:(c.visits??0)+1,junction:this.junctions.has(c.path[c.index+1]),...(c.path[c.index+2]===undefined?{}:{nextCell:c.path[c.index+2],nextLane:Math.min(c.lane,this.laneCount(linkKey(c.path[c.index+1],c.path[c.index+2]))-1)})};if((c as TaxiActor).taxi)(car as unknown as {taxi?:boolean}).taxi=true;return car;});
    const grouped=new Map<string,GameRenderGroup>(),loads=new Map<number,{cell:number;load:number;queued:number}>();
    for(const c of cars){const key=linkKey(c.from,c.to),link=this.network.links.get(key);let group=grouped.get(key);if(!group){group={key,from:c.from,to:c.to,amount:0,queued:0,storage:(link?.lanes??0)*STORAGE_PER_LANE,closed:!link};grouped.set(key,group);}group.amount++;if(c.blocked)group.queued++;let load=loads.get(c.to);if(!load){load={cell:c.to,load:0,queued:0};loads.set(c.to,load);}load.load++;if(c.blocked)load.queued++;}
    // Waiting demand lives at its origin; include it in the cell-level queue
    // rather than falsely depicting it as cars occupying an arbitrary road.
    for(const od of this.ods)if(od.waiting>0){let load=loads.get(od.from);if(!load){load={cell:od.from,load:0,queued:0};loads.set(od.from,load);}load.queued+=od.waiting;}
    const groups=[...grouped.values()].sort((a,b)=>a.key.localeCompare(b.key));
    const bus=this.bus?{bus:{totals:[...this.busTotals.values()].map(t=>({...t})).sort((a,b)=>a.from-b.from||a.to-b.to||a.lineId-b.lineId),injected:{...this.busInjected},diverted:this.busDiverted,returned:this.busReturned}}:{};
    const signals:TrafficSignalFrame={topology:this.signature,phases:[...this.junctions].filter(node=>!this.bends.has(node)).sort((a,b)=>a-b).map(node=>{const approach=this.signals.get(node)?.approach??null;return {node,approach,state:approach===null?'all-red':'green'};})};
    return {navigation:{...this.navigation},signals,...bus,...(this.workIssued.size?{workTrips:[...this.workIssued].map(([id,t])=>({id,day:t.day}))}:{}),...(this.workExpirations.length?{expiredWorkTrips:this.workExpirations.map(e=>({...e}))}:{}),...(this.taxiTrips?{taxiTrips:{trips:this.taxiTrips,tiles:this.taxiTiles}}:{}),step:this.stepValue,offered:this.offered,completed:this.completed,dropped:this.dropped,cancelled:this.cancelled,waiting:this.ods.reduce((n,o)=>n+o.waiting,0),moving:cars.length,blocked:cars.filter(c=>c.blocked).length,clippedRate:this.clippedRate,demandRate:this.ods.reduce((n,o)=>n+o.rate,0),roads:this.map.cells.filter(c=>c.road).length,congestedLinks:groups.filter(g=>g.queued>0).length,cars,groups,loadByCell:[...loads.values()].sort((a,b)=>a.cell-b.cell)};
  }
}
