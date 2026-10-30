/** Isolated, synthetic integration host. No production entry point or storage access. */
import {createCity,buildRoad,step,type City} from '../sim.ts';
import {advanceParkRuntime,createParkRuntime,serializeParkSession,type ParkRuntime} from '../park-runtime.ts';
import {PassengerRail,type PassengerRailConfig} from './passenger.ts';
import {createRailGraph,railPath,type RailGraph} from './graph.ts';
import {offerLeasedPassengerDemand} from './offer-adapter.ts';
import {acknowledgeRailService,modalDemandSummary,type ModalDemand} from './demand-contract.ts';
import {railAccessPath} from './access.ts';
import {serializeRailPreview,restoreRailPreview,type RailPreviewBinding} from './preview-session.ts';

export const PASSENGER_RAIL_ENABLED=false;
/** Fixture tuning is deliberately confined to this preview, not game balance. */
export const PREVIEW_CONFIG:PassengerRailConfig={id:'preview-rail',lineId:'shuttle',trainId:'shuttle-1',seats:8,minimumDwellMinutes:2,minimumDepartureIntervalMinutes:4,maxBatches:128,
  stations:[{id:'a',cell:245,queueCapacity:12,boardingPerMinute:4,alightingPerMinute:4},{id:'b',cell:255,queueCapacity:12,boardingPerMinute:4,alightingPerMinute:4}]};
export function previewGraph(revision=1){const links=[];for(let from=245;from<255;from++)links.push({from,to:from+1,minutes:2},{from:from+1,to:from,minutes:2});return createRailGraph(revision,links);}
export class RailPreviewRuntime {
  revision=0;
  readonly sessionId:string;
  city:City;parks:ParkRuntime;rail:PassengerRail;graph:RailGraph;config:PassengerRailConfig;
  demands:ModalDemand[]=[];
  constructor(sessionId='synthetic-rail-preview'){
    this.sessionId=sessionId;this.city=createCity(61025,{starter:false});this.parks=createParkRuntime(this.city);this.config=structuredClone(PREVIEW_CONFIG);this.graph=previewGraph();
    buildRoad(this.city,288,264);buildRoad(this.city,264,281);
    this.rail=new PassengerRail(this.config,this.graph,this.city.tick*1440);
  }
  advance(minutes:number,paused=false,continueFrame?:()=>boolean){
    if(paused)return;
    const before=this.rail.snapshot.minute;
    advanceParkRuntime(this.city,this.parks,minutes,()=>step(this.city),undefined,continueFrame);
    const target=this.city.tick*1440+this.parks.activity.minute;
    this.rail.advanceTo(target,target-before);
    this.acknowledge();if(target!==before||minutes>0)this.revision++;
  }
  private acknowledge(){for(const receipt of this.rail.serviceReceipts()){const index=this.demands.findIndex(d=>d.id===receipt.requestId);if(index<0)throw Error('Unowned rail service');this.demands[index]=acknowledgeRailService(this.demands[index],receipt);}}
  /** A synthetic pending trip is leased only if BOTH pedestrian approaches are reachable.
   * Refused passengers remain in the preview's road-assignable pool; no road engine is modified. */
  offerTrip(from:number,to:number,persons:number){
    if(this.demands.length>=this.config.maxBatches)throw Error('Preview demand limit reached');
    const id=`trip:${this.demands.length}`;
    const demand:ModalDemand={id,from,to,offeredPersons:persons,roadAdmittedPersons:0,leases:[]};modalDemandSummary(demand);
    let best:{fromStation:string;toStation:string;access:number;egress:number;cost:number}|undefined;
    for(const a of this.config.stations)for(const b of this.config.stations)if(a.id!==b.id){
      const access=railAccessPath(this.city,from,a.cell),egress=railAccessPath(this.city,b.cell,to),path=railPath(this.graph,a.cell,b.cell);
      if(!access||!egress||!path)continue;
      // Explicit fixture-only walking limit: 8 road edges / 16 game minutes per approach.
      const first=(access.length-1)*2,last=(egress.length-1)*2;
      if(first>16||last>16)continue;const cost=first+last+path.minutes;
      if(!best||cost<best.cost)best={fromStation:a.id,toStation:b.id,access:first,egress:last,cost};
    }
    let accepted=false;
    if(best){const result=offerLeasedPassengerDemand(this.rail,demand,{id:`batch:${id}`,requestId:id,leaseId:`lease:${id}`,from,to,fromStation:best.fromStation,toStation:best.toStation,persons,readyAtMinute:this.rail.snapshot.minute+best.access,egressMinutes:best.egress});this.demands.push(result.demand);accepted=result.accepted;}
    else this.demands.push(demand);
    this.revision++;return accepted;
  }
  toggleStation(id:string){this.rail.setStationOpen(id,!this.rail.snapshot.openStations[id]);this.revision++;}
  toggleService(){this.rail.setServiceEnabled(!this.rail.snapshot.enabled);this.revision++;}
  editTrack(from:number,to:number,remove:boolean){
    const base=previewGraph().links;
    if(!base.some(l=>l.from===from&&l.to===to))throw Error('Choose an existing preview track segment');
    const links=remove?this.graph.links.filter(l=>!(l.from===from&&l.to===to||l.from===to&&l.to===from))
      :[...this.graph.links,...base.filter(l=>(l.from===from&&l.to===to||l.from===to&&l.to===from)&&!this.graph.links.some(old=>old.from===l.from&&old.to===l.to))];
    const graph=createRailGraph(this.graph.revision+1,links);this.rail.replaceGraph(graph);this.graph=graph;this.revision++;
  }
  capture(){
    const binding:RailPreviewBinding={sessionId:this.sessionId,revision:this.revision,cityRaw:serializeParkSession(this.city,this.parks)};
    return {binding,raw:serializeRailPreview({...binding,config:this.config,graph:this.graph,rail:this.rail.snapshot,demands:this.demands})};
  }
  restore(saved:{binding:RailPreviewBinding;raw:string}){
    if(saved.binding.sessionId!==this.sessionId)throw Error('Different preview city');
    const restored=restoreRailPreview(saved.raw,saved.binding);
    // Apply the complete validated transaction synchronously; failed restores change nothing.
    this.city=restored.city;this.parks=restored.parks;this.rail=restored.rail;this.graph=restored.graph;this.config=structuredClone(restored.record.config);this.demands=structuredClone(restored.record.demands);this.revision=restored.record.revision;
  }
  diagnostics(){const summaries=this.demands.map(modalDemandSummary);return {...this.rail.diagnostics(),minute:this.rail.snapshot.minute,revision:this.revision,
    roadAssignable:summaries.reduce((n,s)=>n+s.roadAssignable,0),modalConservationError:summaries.reduce((n,s)=>n+s.conservationError,0)};}
}
