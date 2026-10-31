/** Application-owned passenger infrastructure. No road admission or money mutation.
 * Service policy must be supplied explicitly; the pending traffic bridge owns leases. */
import type {City} from '../sim.ts';
import {createRailGraph,railPath,safeCount,validId,type RailGraph} from './graph.ts';
import {PassengerRail,type PassengerRailConfig,type PassengerRailSnapshot} from './passenger.ts';
import {acknowledgeRailService,modalDemandSummary,type ModalDemand} from './demand-contract.ts';
import {offerLeasedPassengerDemand} from './offer-adapter.ts';
import type {PassengerOffer} from './passenger.ts';
import {railAccessPath} from './access.ts';
import {snapshotDigest} from './snapshot-digest.ts';
import {replaceRailReservations} from './reserved-parcels.ts';
import {taxiAt} from '../taxi/buildings.ts';
import {busDepotAt} from '../bus/buildings.ts';

/** V1 game tuning, not real passenger forecasts. Initial service is economy-neutral. */
export const GAME_RAIL_TRACK_MINUTES=120, GAME_RAIL_MAX_TRACK_SEGMENTS=96;
export const GAME_RAIL_POLICY:RailServicePolicy=Object.freeze({seats:32,queueCapacity:64,boardingPerMinute:8,alightingPerMinute:8,minimumDwellMinutes:30,minimumDepartureIntervalMinutes:60,maxBatches:32});
export type RailModelState={version:1;accepting:boolean;nextSequence:number;nextOfferMinute:number;offeredPersons:number;retiredPersons:number};

export type RailStationSite={id:string;cell:number};
export type RailServicePolicy={seats:number;queueCapacity:number;boardingPerMinute:number;alightingPerMinute:number;minimumDwellMinutes:number;minimumDepartureIntervalMinutes:number;maxBatches:number};
export type RailNetworkState={version:1;cityId:string;epoch:number;revision:number;minute:number;stations:RailStationSite[];graph:RailGraph;
  service:{config:PassengerRailConfig;snapshot:PassengerRailSnapshot;demands:ModalDemand[]}|null;model?:RailModelState};
export type RailSessionSave={version:1;binding:{cityId:string;epoch:number;revision:number;cityRevision:string};network:RailNetworkState};
const exact=(value:object,keys:string)=>Object.keys(value).sort().join(',')===keys;
const coreRevision=(cityRaw:string)=>{const parsed=JSON.parse(cityRaw);return snapshotDigest(JSON.stringify(Object.fromEntries(Object.keys(parsed).sort().map(key=>[key,parsed[key]]))));};
function validate(state:RailNetworkState){
  if(!state||!exact(state,Object.hasOwn(state,'model')?'cityId,epoch,graph,minute,model,revision,service,stations,version':'cityId,epoch,graph,minute,revision,service,stations,version')||state.version!==1||!validId(state.cityId)||![state.epoch,state.revision,state.minute].every(safeCount)
    ||!Array.isArray(state.stations)||state.stations.length>2||!state.graph||!exact(state.graph,'links,revision')||!Array.isArray(state.graph.links)||state.graph.links.length>2208
    ||state.graph.links.some(l=>!l||!exact(l,'from,minutes,to')))throw Error('Invalid rail network');
  const ids=new Set<string>(),cells=new Set<number>();
  for(const site of state.stations){if(!site||!exact(site,'cell,id')||!validId(site.id)||!safeCount(site.cell)||site.cell>=576||ids.has(site.id)||cells.has(site.cell))throw Error('Invalid rail station site');ids.add(site.id);cells.add(site.cell);}
  const graph=createRailGraph(state.graph.revision,state.graph.links);
  if(Object.hasOwn(state,'model')&&(!state.model||typeof state.model!=='object'))throw Error('Invalid rail model');
  if(state.model){const m=state.model;if(!exact(m,'accepting,nextOfferMinute,nextSequence,offeredPersons,retiredPersons,version')||m.version!==1||typeof m.accepting!=='boolean'||![m.nextSequence,m.nextOfferMinute,m.offeredPersons,m.retiredPersons].every(safeCount)||m.retiredPersons>m.offeredPersons||m.nextOfferMinute<state.minute||m.nextOfferMinute>state.minute+60)throw Error('Invalid rail model counters');}
  if(state.service===null){if(state.model&&state.model.offeredPersons!==state.model.retiredPersons)throw Error('Unresolved removed rail service');return;}
  if(!state.service||typeof state.service!=='object')throw Error('Invalid rail service');
  const {config,snapshot,demands}=state.service;
  if(!exact(state.service,'config,demands,snapshot')||!exact(config,'id,lineId,maxBatches,minimumDepartureIntervalMinutes,minimumDwellMinutes,seats,stations,trainId')||state.stations.length!==2
    ||config.stations.some((s,i)=>!exact(s,'alightingPerMinute,boardingPerMinute,cell,id,queueCapacity')||s.id!==state.stations[i].id||s.cell!==state.stations[i].cell))throw Error('Rail service station mismatch');
  PassengerRail.restore(config,graph,snapshot);
  if(snapshot.minute!==state.minute||!Array.isArray(demands)||demands.length>config.maxBatches)throw Error('Rail service clock or ownership mismatch');
  const requests=new Set<string>(),leases=new Set<string>();
  for(const demand of demands){modalDemandSummary(demand);if(!exact(demand,'from,id,leases,offeredPersons,roadAdmittedPersons,to')||requests.has(demand.id))throw Error('Duplicate or malformed rail request');requests.add(demand.id);
    for(const lease of demand.leases){if(!exact(lease,'completedPersons,id,persons')||leases.has(lease.id))throw Error('Duplicate or malformed rail lease');leases.add(lease.id);
      const batch=snapshot.batches.find(b=>b.leaseId===lease.id);
      if(!batch||batch.requestId!==demand.id||batch.from!==demand.from||batch.to!==demand.to||batch.persons!==lease.persons||batch.completed!==lease.completedPersons)throw Error('Rail lease mismatch');
    }
  }
  if(leases.size!==snapshot.batches.length)throw Error('Unowned rail passengers');
  if(state.model){
    if(config.seats!==GAME_RAIL_POLICY.seats||config.maxBatches!==GAME_RAIL_POLICY.maxBatches||config.minimumDwellMinutes!==GAME_RAIL_POLICY.minimumDwellMinutes||config.minimumDepartureIntervalMinutes!==GAME_RAIL_POLICY.minimumDepartureIntervalMinutes||config.stations.some(s=>s.queueCapacity!==GAME_RAIL_POLICY.queueCapacity||s.boardingPerMinute!==GAME_RAIL_POLICY.boardingPerMinute||s.alightingPerMinute!==GAME_RAIL_POLICY.alightingPerMinute))throw Error('Unsupported modeled rail service policy');
    if(snapshot.batches.length>32||snapshot.batches.reduce((n,b)=>n+b.persons-b.completed,0)>128)throw Error('Modeled rail backlog exceeds bounds');
    const m=state.model;let live=0;for(const b of snapshot.batches){const match=/^model:(\d+)$/.exec(b.id);if(!match||Number(match[1])>=m.nextSequence||b.requestId!==b.id||b.leaseId!==b.id)throw Error('Invalid modeled rail sequence');live+=b.persons;}if(live+m.retiredPersons!==m.offeredPersons)throw Error('Modeled rail totals differ');}
}

export class RailNetworkRuntime {
  private state:RailNetworkState;
  private rail:PassengerRail|null=null;
  private densityCache:{key:string;persons:[number,number]}|null=null;
  private readonly city:City;
  private constructor(city:City,state:RailNetworkState){validate(state);this.city=city;this.state=structuredClone(state);if(state.service)this.rail=PassengerRail.restore(state.service.config,state.graph,state.service.snapshot);}
  /** Called only by explicit configuration. Loading an old city never creates an ID. */
  static create(city:City,cityId:string,minute:number,epoch=0){const runtime=new RailNetworkRuntime(city,{version:1,cityId,epoch,revision:0,minute,stations:[],graph:createRailGraph(0,[]),service:null});runtime.publishReservations();return runtime;}
  static restore(city:City,value:RailSessionSave,cityRaw:string,minute:number){
    if(!value||!exact(value,'binding,network,version')||value.version!==1||!value.binding||!exact(value.binding,'cityId,cityRevision,epoch,revision')
      ||value.binding.cityRevision!==coreRevision(cityRaw)||value.binding.cityId!==value.network?.cityId||value.binding.epoch!==value.network?.epoch||value.binding.revision!==value.network?.revision)throw Error('Rail city revision mismatch');
    const runtime=new RailNetworkRuntime(city,value.network);runtime.assertCity(city,minute);runtime.assertParcels();runtime.publishReservations();return runtime;
  }
  assertCity(city:City,minute:number){if(city!==this.city||minute!==this.state.minute)throw Error('Rail belongs to a different city or clock');}
  capture(city:City,cityRaw:string,minute:number):RailSessionSave {this.assertCity(city,minute);this.assertParcels();const network=this.snapshot;validate(network);return {version:1,binding:{cityId:network.cityId,epoch:network.epoch,revision:network.revision,cityRevision:coreRevision(cityRaw)},network};}
  get snapshot():RailNetworkState {return structuredClone(this.state);}
  private assertWritable(amount=1){if(!safeCount(amount)||!safeCount(this.state.revision+amount))throw Error('Rail revision overflow');}
  private reservedCells(){return new Set([...this.state.stations.map(s=>s.cell),...this.state.graph.links.flatMap(l=>[l.from,l.to])]);}
  private assertParcels(){for(const cell of this.reservedCells())this.available(cell);}
  private publishReservations(){replaceRailReservations(this.city,this.reservedCells());}
  private changed(){this.state.revision++;this.publishReservations();}
  private available(cell:number){const c=this.city.cells[cell];if(!c||c.building!==null||c.zone||c.road||this.city.parks.some(p=>p.cell===cell)||this.city.plants.some(p=>p.cell===cell)||this.city.education?.campuses.some(p=>p.cell===cell)||taxiAt(this.city,cell)||busDepotAt(this.city,cell))throw Error('Rail needs an empty reserved parcel; crossings are not configured');}
  isReserved(cell:number){return this.state.stations.some(s=>s.cell===cell)||this.state.graph.links.some(l=>l.from===cell||l.to===cell);}
  addStation(id:string,cell:number){this.assertWritable();if(this.state.service||this.state.stations.length>=2||!validId(id)||this.state.stations.some(s=>s.id===id||s.cell===cell))throw Error('This shuttle supports two distinct stations');this.available(cell);this.state.stations.push({id,cell});this.changed();}
  removeStation(id:string){this.assertWritable();if(this.state.service)throw Error('Remove the idle line before removing a station');const next=this.state.stations.filter(s=>s.id!==id);if(next.length===this.state.stations.length)throw Error('Unknown station');this.state.stations=next;this.changed();}
  editTrack(from:number,to:number,remove:boolean,minutes?:number){this.assertWritable();
    if(!remove){this.available(from);this.available(to);if(!safeCount(minutes)||(minutes??0)<1)throw Error('Track travel time is not configured');}
    const links=this.state.graph.links.filter(l=>!(l.from===from&&l.to===to||l.from===to&&l.to===from));
    if(remove&&links.length===this.state.graph.links.length)throw Error('Track segment not found');
    if(!remove)links.push({from,to,minutes:minutes!},{from:to,to:from,minutes:minutes!});
    if(!remove&&links.length>GAME_RAIL_MAX_TRACK_SEGMENTS*2)throw Error('V1 rail supports at most 96 track segments');
    const graph=createRailGraph(this.state.graph.revision+1,links);this.rail?.replaceGraph(graph);this.state.graph=graph;this.sync();this.changed();
  }
  /** One transaction: validate the whole straight route before publishing reservations. */
  addTrackPath(from:number,to:number){
    this.assertWritable();if(!safeCount(from)||!safeCount(to)||from>=576||to>=576||from===to||from%24!==to%24&&Math.floor(from/24)!==Math.floor(to/24))throw Error('Choose two different cells in one straight row or column');
    const delta=from%24===to%24?24*Math.sign(to-from):Math.sign(to-from),cells:number[]=[];
    for(let n=from;;n+=delta){this.available(n);cells.push(n);if(n===to)break;}
    let links=[...this.state.graph.links];for(let i=1;i<cells.length;i++){const a=cells[i-1],b=cells[i];links=links.filter(l=>!(l.from===a&&l.to===b||l.from===b&&l.to===a));links.push({from:a,to:b,minutes:GAME_RAIL_TRACK_MINUTES},{from:b,to:a,minutes:GAME_RAIL_TRACK_MINUTES});}
    if(links.length>GAME_RAIL_MAX_TRACK_SEGMENTS*2)throw Error('V1 rail supports at most 96 track segments');
    const graph=createRailGraph(this.state.graph.revision+1,links);this.rail?.replaceGraph(graph);this.state.graph=graph;this.sync();this.changed();
  }
  configureGameService(){this.configureService(GAME_RAIL_POLICY);this.state.model??={version:1,accepting:true,nextSequence:0,nextOfferMinute:this.state.minute+60,offeredPersons:0,retiredPersons:0};this.state.model.nextOfferMinute=this.state.minute+60;this.state.model.accepting=true;}
  setModelAccepting(accepting:boolean){this.assertWritable();if(!this.state.model||!this.state.service||typeof accepting!=='boolean')throw Error('No modeled rail service');this.state.model.accepting=accepting;this.changed();}
  /** No road-demand subtraction: these are independent illustrative passenger queues. */
  private canOfferModel():boolean {
    if(!this.rail||!this.state.service||!this.state.model)return false;
    const snap=this.state.service.snapshot,stations=this.state.stations;
    const a=railPath(this.state.graph,stations[0].cell,stations[1].cell),b=railPath(this.state.graph,stations[1].cell,stations[0].cell);
    const backlog=snap.batches.reduce((n,b)=>n+b.outside+b.waiting+b.onboard+b.egress.reduce((n,e)=>n+e.persons,0),0);
    return !!(this.state.model.accepting&&snap.enabled&&Object.values(snap.openStations).every(Boolean)&&a&&b&&backlog<128&&snap.batches.length<GAME_RAIL_POLICY.maxBatches);
  }
  private modelOffer(){
    const m=this.state.model,s=this.state.service;if(!m||!s||!this.canOfferModel())return;
    const stations=this.state.stations;
    // Cache only read-only density/access projection. The key includes same-tick
    // edits and households, not merely the economy tick; no finance is cached.
    const key=JSON.stringify([stations,this.city.cells.map(c=>c.road),this.city.roadTopology,this.city.buildings.map(b=>[b.id,b.zone,b.cell,b.level]),this.city.households.map(h=>[h.home,h.members])]);
    if(this.densityCache?.key!==key){
      const persons=stations.map((a,side)=>{
        const b=stations[1-side],near=(from:number,to:number)=>{const p=railAccessPath(this.city,from,to);return p!==null&&p.length-1<=3;};
        const homes=new Set(this.city.buildings.filter(x=>x.zone==='R'&&near(x.cell,a.cell)).map(x=>x.id));
        const population=this.city.households.filter(h=>h.home!==null&&homes.has(h.home)).reduce((n,h)=>n+h.members,0);
        const destinations=this.city.buildings.filter(x=>x.zone!=='R'&&near(b.cell,x.cell)).reduce((n,x)=>n+x.level,0);
        return population&&destinations?Math.max(1,Math.min(8,Math.floor(Math.sqrt(population*destinations)/2))):0;
      }) as [number,number];this.densityCache={key,persons};
    }
    for(let side=0;side<2;side++){
      if(this.state.service!.snapshot.batches.length>=GAME_RAIL_POLICY.maxBatches||!this.canOfferModel())break;
      const a=stations[side],b=stations[1-side];
      const outstanding=this.state.service!.snapshot.batches.reduce((n,b)=>n+b.persons-b.completed,0);
      const persons=Math.min(this.densityCache.persons[side],128-outstanding);if(!persons)continue;
      const id=`model:${this.state.model!.nextSequence}`;
      this.acceptPreparedDemand({id,from:a.cell,to:b.cell,offeredPersons:persons,roadAdmittedPersons:0,leases:[]},{id,requestId:id,leaseId:id,from:a.cell,to:b.cell,fromStation:a.id,toStation:b.id,persons,readyAtMinute:this.state.minute,egressMinutes:3});
    }
  }
  private retireModelCompleted(){
    if(!this.rail||!this.state.model||!this.state.service)return;
    const snap=this.rail.snapshot,retired=snap.batches.filter(b=>b.completed===b.persons);if(!retired.length)return;
    const ids=new Set(retired.map(b=>b.id));this.state.model.retiredPersons+=retired.reduce((n,b)=>n+b.persons,0);
    snap.batches=snap.batches.filter(b=>!ids.has(b.id));this.rail=PassengerRail.restore(this.state.service.config,this.state.graph,snap);
    this.state.service.demands=this.state.service.demands.filter(d=>!ids.has(d.id));this.state.service.snapshot=snap;
  }
  configureService(policy:RailServicePolicy){this.assertWritable();
    if(this.state.service||this.state.stations.length!==2)throw Error('Connect exactly two stations before configuring the shuttle');
    const stations=this.state.stations.map(s=>({...s,queueCapacity:policy.queueCapacity,boardingPerMinute:policy.boardingPerMinute,alightingPerMinute:policy.alightingPerMinute})) as PassengerRailConfig['stations'];
    const config:PassengerRailConfig={id:`rail:${this.state.epoch}`,lineId:'shuttle',trainId:'shuttle-1',stations,seats:policy.seats,minimumDwellMinutes:policy.minimumDwellMinutes,minimumDepartureIntervalMinutes:policy.minimumDepartureIntervalMinutes,maxBatches:policy.maxBatches};
    const rail=new PassengerRail(config,this.state.graph,this.state.minute);this.rail=rail;this.state.service={config,snapshot:rail.snapshot,demands:[]};this.changed();
  }
  removeService(){this.assertWritable();if(!this.rail||!this.state.service)throw Error('No shuttle line');const d=this.rail.diagnostics();if(d.outside+d.waiting+d.onboard+d.egress>0||this.state.service.demands.length>0)throw Error('Retained journeys require an authoritative retirement receipt');this.rail=null;this.state.service=null;this.changed();}
  setStationOpen(id:string,open:boolean){this.assertWritable();if(!this.rail||typeof open!=='boolean')throw Error('Service is not configured');this.rail.setStationOpen(id,open);this.sync();this.changed();}
  setServiceEnabled(enabled:boolean){this.assertWritable();if(!this.rail||typeof enabled!=='boolean')throw Error('Service is not configured');this.rail.setServiceEnabled(enabled);this.sync();this.changed();}
  planTrip(from:number,to:number,maximumWalkMinutes:number,minutesPerWalkEdge:number){
    if(!this.rail||!this.state.service||!this.rail.snapshot.enabled||!safeCount(maximumWalkMinutes)||!safeCount(minutesPerWalkEdge)||minutesPerWalkEdge<1)return null;
    let best:{fromStation:string;toStation:string;accessMinutes:number;egressMinutes:number;minutes:number}|null=null;
    for(const a of this.state.stations)for(const b of this.state.stations)if(a.id!==b.id&&this.rail.snapshot.openStations[a.id]&&this.rail.snapshot.openStations[b.id]){
      const access=railAccessPath(this.city,from,a.cell),egress=railAccessPath(this.city,b.cell,to),track=railPath(this.state.graph,a.cell,b.cell);if(!access||!egress||!track)continue;
      const first=(access.length-1)*minutesPerWalkEdge,last=(egress.length-1)*minutesPerWalkEdge;if(first>maximumWalkMinutes||last>maximumWalkMinutes)continue;const minutes=first+last+track.minutes;
      if(!best||minutes<best.minutes)best={fromStation:a.id,toStation:b.id,accessMinutes:first,egressMinutes:last,minutes};
    }return best;
  }
  /** Foundation adapter only. NOT called by main: authoritative traffic transaction is pending.
   * The future bridge must atomically persist its own reservation with this result. */
  acceptPreparedDemand(demand:ModalDemand,offer:PassengerOffer):ModalDemand {this.assertWritable();
    if(!this.rail||!this.state.service)throw Error('Service is not configured');
    if(this.state.model){const expected=`model:${this.state.model.nextSequence}`;if(demand.id!==expected||offer.id!==expected||offer.requestId!==expected||offer.leaseId!==expected)throw Error('Modeled rail accepts only its next sequence');}
    const copy=PassengerRail.restore(this.state.service.config,this.state.graph,this.rail.snapshot);
    const result=offerLeasedPassengerDemand(copy,demand,offer);if(!result.accepted)return demand;
    const old=this.state.service.demands.find(d=>d.id===demand.id);if(old&&JSON.stringify(old)!==JSON.stringify(result.demand))throw Error('Conflicting demand revision');
    if(old)return structuredClone(old);
    const next=this.snapshot;next.service!.snapshot=copy.snapshot;if(!old)next.service!.demands.push(result.demand);next.revision++;if(next.model){next.model.nextSequence++;next.model.offeredPersons+=offer.persons;}validate(next);
    this.rail=copy;this.state=next;return structuredClone(result.demand);
  }
  advanceTo(minute:number){
    if(!safeCount(minute)||minute<this.state.minute)throw Error('Invalid rail clock');if(minute===this.state.minute)return;
    const elapsed=minute-this.state.minute;this.assertWritable(elapsed);this.assertParcels();
    while(this.state.minute<minute){const target=this.state.model?Math.min(minute,this.state.model.nextOfferMinute):minute;
      this.rail?.advanceTo(target,target-this.state.minute);this.state.minute=target;this.sync();this.retireModelCompleted();
      if(this.state.model&&target===this.state.model.nextOfferMinute){this.state.model.nextOfferMinute=target+60;this.modelOffer();}
    }this.state.revision+=elapsed;
  }
  private sync(){if(this.rail&&this.state.service){this.state.service.snapshot=this.rail.snapshot;for(const receipt of this.rail.serviceReceipts()){const i=this.state.service.demands.findIndex(d=>d.id===receipt.requestId);if(i<0)throw Error('Unowned rail completion');this.state.service.demands[i]=acknowledgeRailService(this.state.service.demands[i],receipt);}}}
}
