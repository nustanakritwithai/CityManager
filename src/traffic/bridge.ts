import {TrafficFlow, type FlowReceipt, type TrafficFlowState} from './flow.ts';
import {resolveTrafficZone, type LinkNetwork} from './network.ts';
import {PEOPLE_PER_VEHICLE, type TripPurpose} from './types.ts';
import {roadNeighbors} from '../road-topology.ts';

/** The accepted save/session owner supplies these opaque identifiers. No storage I/O here. */
export type TrafficScope = {cityId:string; revisionId:string; epoch:string};
export type PassengerOffer = {scope:TrafficScope; requestId:string; purpose:Exclude<TripPurpose,'freight'>; from:number; to:number; persons:number};
export type ModeLeaseRequest = {scope:TrafficScope; requestId:string; leaseId:string; mode:'taxi'|'rail'|'bus'; persons:number};
export type ModeServiceReceipt = {scope:TrafficScope; leaseId:string; boardedPersons:number; releasedPersons:number; completedPersons:number};
export type TaxiRegistration = {scope:TrafficScope; unitId:string; cell:number};
export type TaxiRoadMove = {scope:TrafficScope; moveId:string; unitId:string; from:number; to:number; carriedPersons:number; leaseId?:string};
export type FreightOffer = {scope:TrafficScope; requestId:string; from:number; to:number; vehicleUnits:number};
export type RoadAdmissionReceipt = {scope:TrafficScope; moveId:string; offeredVehicleUnits:number; admittedVehicleUnits:number; completedVehicleUnits:number; waitingVehicleUnits:number; activeVehicleUnits:number; arrived:boolean};
export type ModeLeaseReceipt = {scope:TrafficScope; requestId:string; leaseId:string; mode:'taxi'|'rail'|'bus'; reservedPersons:number; boardedPersons:number; releasedPersons:number; completedPersons:number; pendingPersons:number};
export type PassengerReceipt = {scope:TrafficScope; requestId:string; offeredPersons:number; privateWaitingPersons:number; privateAdmittedPersons:number; privateActivePersons:number; privateCompletedPersons:number; taxiPendingPersons:number; taxiCompletedPersons:number; railPendingPersons:number; railCompletedPersons:number; busPendingPersons:number; busCompletedPersons:number; conservationError:number};
type Passenger = Omit<PassengerOffer,'scope'> & {roadIds:string[]};
type Lease = Omit<ModeLeaseReceipt,'scope'|'pendingPersons'>;
type Taxi = {unitId:string; cell:number; moveIds:string[]};
type Move = Omit<TaxiRoadMove,'scope'>;
type Freight = Omit<FreightOffer,'scope'>;
export type TrafficBridgeState = {version:1; scope:TrafficScope; baseMinute:number; minute:number; observedMinute:number; passengers:Passenger[]; leases:Lease[]; taxis:Taxi[]; moves:Move[]; freight:Freight[]; flow:TrafficFlowState};
export const MAX_BRIDGE_CATCHUP_MINUTES=1440;
const MODES:readonly string[]=['taxi','rail','bus'];
/** Bus road-load sink (contract of src/bus/traffic-hook.ts). `load` = linkKey → PCU of buses on that link
 * (BUS_PCU = 2 each). Each call REPLACES the previous load; empty map clears; same call again is a no-op;
 * non-finite/≤0 values and unknown links are ignored (never throw). Only consumes road capacity:
 * no passenger request, lease or road move is created. */
export type BusLoadSink = {readonly acceptsBus:true; applyBusLoad(minute:number,load:ReadonlyMap<string,number>):void; readonly load:ReadonlyMap<string,number>};
export function createBusLoadSink(apply:(load:ReadonlyMap<string,number>)=>void,knownLink:(key:string)=>boolean=()=>true):BusLoadSink {
  let current:ReadonlyMap<string,number>=new Map();
  return {acceptsBus:true,get load(){return current;},applyBusLoad(_minute,load){
    const next=new Map<string,number>();
    try{for(const [k,v] of load??[])if(typeof k==='string'&&typeof v==='number'&&Number.isFinite(v)&&v>0&&knownLink(k))next.set(k,v);}catch{/* malformed input → treat as empty */}
    current=next;apply(next);
  }};
}
const EPS=1e-7;
const clone=<T>(v:T):T=>structuredClone(v);
const id=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=96&&!/[\u0000-\u001f]/.test(v);
const whole=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=Number.MAX_SAFE_INTEGER;
const cell=(v:unknown):v is number=>whole(v)&&v<576;
const fields=(v:unknown,keys:string)=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===keys;
function requireValid(condition:unknown,message:string):asserts condition {if(!condition)throw Error(message);}
const equal=(a:number,b:number)=>Math.abs(a-b)<=Math.max(EPS,Number.EPSILON*32*Math.max(a,b));
const flowId=(kind:'private'|'taxi'|'freight',key:string,index?:number)=>JSON.stringify(index===undefined?[kind,key]:[kind,key,index]);
function validScope(scope:TrafficScope) {return fields(scope,'cityId,epoch,revisionId')&&id(scope.cityId)&&id(scope.revisionId)&&id(scope.epoch);}
function sameScope(a:TrafficScope,b:TrafficScope) {return validScope(a)&&validScope(b)&&a.cityId===b.cityId&&a.revisionId===b.revisionId&&a.epoch===b.epoch;}
function validPassenger(p:Omit<PassengerOffer,'scope'>) {return id(p.requestId)&&['commute','school','park'].includes(p.purpose)&&whole(p.from)&&whole(p.to)&&whole(p.persons)&&p.persons>0;}
function validMove(m:Move) {return fields(m,m.leaseId===undefined?'carriedPersons,from,moveId,to,unitId':'carriedPersons,from,leaseId,moveId,to,unitId')&&id(m.moveId)&&id(m.unitId)&&cell(m.from)&&cell(m.to)&&whole(m.carriedPersons)&&m.carriedPersons<=PEOPLE_PER_VEHICLE&&(m.carriedPersons>0?id(m.leaseId):m.leaseId===undefined);}
// Structural frontage check also works after a road has been cut: restore must
// retain the historical journey, but cannot move its endpoint to another parcel.
function frontageGeometry(zone:number,roadCell:number) {
  return zone<576?zone===roadCell:zone<1152&&(zone-576===roadCell||roadNeighbors(zone-576).includes(roadCell));
}

/** One shared road engine for private traffic, freight and every taxi leg. This bridge
 * owns the passenger ledger; mode workers own dispatch/service, never road capacity.
 * Commands occur at the processed minute. Drain pending catch-up before new commands.
 * No clock/runtime/save activation or automatic demand generation is performed here. */
export class TrafficBridge {
  private scopeValue:TrafficScope;
  private baseMinute:number;
  private minute:number;
  private observedMinute:number;
  private flow=new TrafficFlow();
  private passengers=new Map<string,Passenger>();
  private leases=new Map<string,Lease>();
  private taxis=new Map<string,Taxi>();
  private moves=new Map<string,Move>();
  private freight=new Map<string,Freight>();
  constructor(scope:TrafficScope,startMinute=0) {
    requireValid(validScope(scope)&&whole(startMinute),'Invalid traffic bridge binding');
    this.scopeValue=clone(scope);this.baseMinute=this.minute=this.observedMinute=startMinute;
  }
  get scope():TrafficScope{return clone(this.scopeValue);}
  private guard(scope:TrafficScope,mutation=false) {
    requireValid(sameScope(scope,this.scopeValue),'Traffic scope mismatch');
    if(mutation)requireValid(this.minute===this.observedMinute,'Drain traffic catch-up before issuing commands');
  }
  /** Call only after the host has accepted this same city/revision. Rejects old callbacks. */
  renewEpoch(scope:TrafficScope,nextEpoch:string):TrafficScope {
    this.guard(scope);requireValid(id(nextEpoch)&&nextEpoch!==this.scopeValue.epoch,'Invalid replacement traffic epoch');
    this.scopeValue={...this.scopeValue,epoch:nextEpoch};return this.scope;
  }
  offerPassenger(command:PassengerOffer):PassengerReceipt {
    this.guard(command.scope,true);
    requireValid(fields(command,'from,persons,purpose,requestId,scope,to')&&validPassenger(command),'Invalid passenger offer');
    const {requestId,purpose,from,to,persons}=command,old=this.passengers.get(requestId);
    if(old)requireValid(old.purpose===purpose&&old.from===from&&old.to===to&&old.persons===persons,'Passenger request ID reused');
    else {
      const roadId=flowId('private',requestId,0);
      this.flow.enqueue([{requestId:roadId,from,to,vehicles:persons/PEOPLE_PER_VEHICLE}]);
      this.passengers.set(requestId,{requestId,purpose,from,to,persons,roadIds:[roadId]});
    }
    return this.passengerReceipt(command.scope,requestId);
  }
  reserveMode(command:ModeLeaseRequest):ModeLeaseReceipt {
    this.guard(command.scope,true);
    requireValid(fields(command,'leaseId,mode,persons,requestId,scope')&&id(command.leaseId)&&id(command.requestId)&&MODES.includes(command.mode)&&whole(command.persons)&&command.persons>0,'Invalid mode reservation');
    const old=this.leases.get(command.leaseId);
    if(old) {
      requireValid(old.requestId===command.requestId&&old.mode===command.mode&&old.reservedPersons===command.persons,'Mode lease ID reused');
      return this.modeReceipt(command.scope,command.leaseId);
    }
    const passenger=this.passengers.get(command.requestId);requireValid(passenger,'Unknown passenger request');
    const available=passenger.roadIds.map(key=>this.flow.receipt(key)!);
    requireValid(command.persons<=Math.floor(available.reduce((n,r)=>n+r.waiting,0)*PEOPLE_PER_VEHICLE+EPS),'Mode reservation exceeds unadmitted passengers');
    let remaining=command.persons/PEOPLE_PER_VEHICLE;
    for(const r of available) {
      const amount=Math.min(remaining,r.waiting);if(amount>0)this.flow.transferWaiting(r.requestId,amount);
      remaining-=amount;if(remaining<=EPS)break;
    }
    this.leases.set(command.leaseId,{requestId:command.requestId,leaseId:command.leaseId,mode:command.mode,reservedPersons:command.persons,boardedPersons:0,releasedPersons:0,completedPersons:0});
    return this.modeReceipt(command.scope,command.leaseId);
  }
  acknowledgeMode(command:ModeServiceReceipt):ModeLeaseReceipt {
    this.guard(command.scope,true);
    requireValid(fields(command,'boardedPersons,completedPersons,leaseId,releasedPersons,scope')&&id(command.leaseId)&&[command.boardedPersons,command.releasedPersons,command.completedPersons].every(whole),'Invalid mode receipt');
    const lease=this.leases.get(command.leaseId);requireValid(lease,'Unknown mode lease');
    // Validate the incoming receipt, then its monotonic merge. Two individually
    // valid but contradictory out-of-order receipts must not overdraw a grant.
    requireValid(command.completedPersons<=command.boardedPersons&&command.boardedPersons+command.releasedPersons<=lease.reservedPersons,'Invalid mode ownership receipt');
    const boarded=Math.max(lease.boardedPersons,command.boardedPersons),released=Math.max(lease.releasedPersons,command.releasedPersons),completed=Math.max(lease.completedPersons,command.completedPersons);
    requireValid(completed<=boarded&&boarded+released<=lease.reservedPersons,'Mode receipt overdraws reservation');
    if(lease.mode==='taxi')requireValid(completed<=this.deliveredTaxiPersons(lease.leaseId),'Taxi completion precedes road arrival');
    const returned=released-lease.releasedPersons;
    if(returned>0) {
      const p=this.passengers.get(lease.requestId)!,roadId=flowId('private',p.requestId,p.roadIds.length);
      this.flow.enqueue([{requestId:roadId,from:p.from,to:p.to,vehicles:returned/PEOPLE_PER_VEHICLE}]);p.roadIds.push(roadId);
    }
    lease.boardedPersons=boarded;lease.releasedPersons=released;lease.completedPersons=completed;
    return this.modeReceipt(command.scope,lease.leaseId);
  }
  registerTaxi(command:TaxiRegistration):void {
    this.guard(command.scope,true);requireValid(fields(command,'cell,scope,unitId')&&id(command.unitId)&&cell(command.cell),'Invalid taxi registration');
    const old=this.taxis.get(command.unitId);
    if(old)requireValid(old.cell===command.cell,'Taxi registration ID reused');
    else this.taxis.set(command.unitId,{unitId:command.unitId,cell:command.cell,moveIds:[]});
  }
  requestTaxiMove(net:LinkNetwork,command:TaxiRoadMove):RoadAdmissionReceipt {
    this.guard(command.scope,true);
    const {scope:_scope,...move}=command;requireValid(validMove(move),'Invalid taxi road move');
    const old=this.moves.get(move.moveId);
    if(old) {
      requireValid(old.unitId===move.unitId&&old.from===move.from&&old.to===move.to&&old.carriedPersons===move.carriedPersons&&old.leaseId===move.leaseId,'Taxi move ID reused');
      return this.roadReceipt(command.scope,move.moveId);
    }
    const taxi=this.taxis.get(move.unitId);requireValid(taxi,'Unknown taxi unit');
    const previous=taxi.moveIds.length?this.moves.get(taxi.moveIds.at(-1)!)!:null;
    requireValid(!previous||this.arrived(flowId('taxi',previous.moveId)),'Taxi already has an unfinished move');
    requireValid(move.from===(previous?previous.to:taxi.cell),'Taxi movement does not start at its current cell');
    if(move.carriedPersons>0) {
      const lease=this.leases.get(move.leaseId!);requireValid(lease?.mode==='taxi','Loaded taxi requires a taxi lease');
      const p=this.passengers.get(lease.requestId)!;
      requireValid(resolveTrafficZone(net,p.from).includes(move.from)&&resolveTrafficZone(net,p.to).includes(move.to),'Loaded taxi endpoints do not match the passenger journey');
      const assigned=[...this.moves.values()].filter(m=>m.leaseId===lease.leaseId).reduce((n,m)=>n+m.carriedPersons,0);
      requireValid(assigned+move.carriedPersons<=lease.boardedPersons,'Taxi load exceeds boarded ownership');
    }
    this.flow.enqueue([{requestId:flowId('taxi',move.moveId),from:move.from,to:move.to,vehicles:1}]);
    this.moves.set(move.moveId,clone(move));taxi.moveIds.push(move.moveId);
    return this.roadReceipt(command.scope,move.moveId);
  }
  offerFreight(command:FreightOffer):RoadAdmissionReceipt {
    this.guard(command.scope,true);requireValid(fields(command,'from,requestId,scope,to,vehicleUnits')&&id(command.requestId)&&whole(command.from)&&whole(command.to)&&finite(command.vehicleUnits)&&command.vehicleUnits>0,'Invalid freight offer');
    const old=this.freight.get(command.requestId);
    if(old)requireValid(old.from===command.from&&old.to===command.to&&old.vehicleUnits===command.vehicleUnits,'Freight request ID reused');
    else {
      const {scope:_scope,...offer}=command;
      this.flow.enqueue([{requestId:flowId('freight',offer.requestId),from:offer.from,to:offer.to,vehicles:offer.vehicleUnits}]);this.freight.set(offer.requestId,clone(offer));
    }
    return this.freightReceipt(command.scope,command.requestId);
  }
  advanceTo(scope:TrafficScope,net:LinkNetwork,minute:number,paused=false) {
    this.guard(scope);requireValid(whole(minute)&&minute>=this.observedMinute,'Traffic time cannot reverse');
    this.observedMinute=minute;
    if(!paused) {
      const elapsed=Math.min(minute-this.minute,MAX_BRIDGE_CATCHUP_MINUTES);
      this.flow.advanceMinutes(net,[],elapsed);this.minute+=elapsed;
    }
    return {minute:this.minute,observedMinute:this.observedMinute,pendingMinutes:this.observedMinute-this.minute};
  }
  /** Sink for `trafficLayer.bus?.hook.connect(...)`: bus PCU reduce this bridge's link capacity. */
  busRoadSink():BusLoadSink {return createBusLoadSink(load=>this.flow.setBusLoad(load));}
  roadEdited(scope:TrafficScope,net:LinkNetwork):void {this.guard(scope,true);this.flow.roadEdited(net);}
  private arrived(key:string) {const r=this.flow.receipt(key)!;return r.completed+EPS>=r.offered;}
  private deliveredTaxiPersons(leaseId:string) {return [...this.moves.values()].filter(m=>m.leaseId===leaseId&&this.arrived(flowId('taxi',m.moveId))).reduce((n,m)=>n+m.carriedPersons,0);}
  private roadResult(moveId:string,r:FlowReceipt):RoadAdmissionReceipt {
    return {scope:this.scope,moveId,offeredVehicleUnits:r.offered,admittedVehicleUnits:r.admitted,completedVehicleUnits:r.completed,waitingVehicleUnits:r.waiting,activeVehicleUnits:r.active,arrived:r.completed+EPS>=r.offered};
  }
  roadReceipt(scope:TrafficScope,moveId:string):RoadAdmissionReceipt {
    this.guard(scope);requireValid(this.moves.has(moveId),'Unknown taxi move');return this.roadResult(moveId,this.flow.receipt(flowId('taxi',moveId))!);
  }
  freightReceipt(scope:TrafficScope,requestId:string):RoadAdmissionReceipt {
    this.guard(scope);requireValid(this.freight.has(requestId),'Unknown freight request');return this.roadResult(requestId,this.flow.receipt(flowId('freight',requestId))!);
  }
  modeReceipt(scope:TrafficScope,leaseId:string):ModeLeaseReceipt {
    this.guard(scope);const l=this.leases.get(leaseId);requireValid(l,'Unknown mode lease');return {...l,scope:this.scope,pendingPersons:l.reservedPersons-l.completedPersons-l.releasedPersons};
  }
  passengerReceipt(scope:TrafficScope,requestId:string):PassengerReceipt {
    this.guard(scope);const p=this.passengers.get(requestId);requireValid(p,'Unknown passenger request');
    const road=p.roadIds.map(key=>this.flow.receipt(key)!);
    const result:PassengerReceipt={scope:this.scope,requestId,offeredPersons:p.persons,privateWaitingPersons:road.reduce((n,r)=>n+r.waiting,0)*PEOPLE_PER_VEHICLE,privateAdmittedPersons:road.reduce((n,r)=>n+r.admitted,0)*PEOPLE_PER_VEHICLE,privateActivePersons:road.reduce((n,r)=>n+r.active,0)*PEOPLE_PER_VEHICLE,privateCompletedPersons:road.reduce((n,r)=>n+r.completed,0)*PEOPLE_PER_VEHICLE,taxiPendingPersons:0,taxiCompletedPersons:0,railPendingPersons:0,railCompletedPersons:0,busPendingPersons:0,busCompletedPersons:0,conservationError:0};
    for(const l of this.leases.values())if(l.requestId===requestId) {
      result[`${l.mode}PendingPersons` as const]+=l.reservedPersons-l.completedPersons-l.releasedPersons;
      result[`${l.mode}CompletedPersons` as const]+=l.completedPersons;
    }
    result.conservationError=p.persons-result.privateWaitingPersons-result.privateActivePersons-result.privateCompletedPersons-result.taxiPendingPersons-result.taxiCompletedPersons-result.railPendingPersons-result.railCompletedPersons-result.busPendingPersons-result.busCompletedPersons;
    return result;
  }
  diagnostics(net:LinkNetwork) {return this.flow.diagnostics(net);}
  renderGroups(net:LinkNetwork) {return this.flow.renderGroups(net);}
  exportState():TrafficBridgeState {
    return clone({version:1,scope:this.scopeValue,baseMinute:this.baseMinute,minute:this.minute,observedMinute:this.observedMinute,passengers:[...this.passengers.values()],leases:[...this.leases.values()],taxis:[...this.taxis.values()],moves:[...this.moves.values()],freight:[...this.freight.values()],flow:this.flow.exportState()});
  }
  static restore(scope:TrafficScope,value:unknown):TrafficBridge {
    const s=value as TrafficBridgeState;
    requireValid(fields(s,'baseMinute,flow,freight,leases,minute,moves,observedMinute,passengers,scope,taxis,version')&&s.version===1&&sameScope(scope,s.scope)&&[s.baseMinute,s.minute,s.observedMinute].every(whole)&&s.baseMinute<=s.minute&&s.minute<=s.observedMinute&&[s.passengers,s.leases,s.taxis,s.moves,s.freight].every(Array.isArray),'Invalid traffic bridge snapshot');
    const b=new TrafficBridge(scope,s.baseMinute);b.minute=s.minute;b.observedMinute=s.observedMinute;b.flow=TrafficFlow.restore(s.flow);
    requireValid(b.flow.snapshot.minute===s.minute-s.baseMinute,'Traffic bridge clock mismatch');
    b.validateRecords(s);
    return b;
  }
  private validateRecords(s:TrafficBridgeState):void {
    // This is an unpublished instance: every field and coupled ledger must validate
    // before restore returns it. Current road closures do not invalidate old journeys.
    const expectedRoad=new Set<string>();
    const road=(key:string,from:number,to:number,offered?:number)=>{
      const r=this.flow.receipt(key);
      requireValid(!expectedRoad.has(key)&&r&&r.from===from&&r.to===to&&(offered===undefined||equal(r.offered,offered)),'Invalid bridge road ownership');
      expectedRoad.add(key);return r;
    };
    for(const p of s.passengers) {
      requireValid(fields(p,'from,persons,purpose,requestId,roadIds,to')&&validPassenger(p)&&!this.passengers.has(p.requestId)&&Array.isArray(p.roadIds)&&p.roadIds.length>0,'Invalid passenger snapshot');
      p.roadIds.forEach((key,i)=>{
        requireValid(key===flowId('private',p.requestId,i),'Invalid private road request ID');
        road(key,p.from,p.to,i===0?p.persons/PEOPLE_PER_VEHICLE:undefined);
      });
      this.passengers.set(p.requestId,clone(p));
    }
    for(const l of s.leases) {
      requireValid(fields(l,'boardedPersons,completedPersons,leaseId,mode,releasedPersons,requestId,reservedPersons')&&id(l.leaseId)&&!this.leases.has(l.leaseId)&&this.passengers.has(l.requestId)&&MODES.includes(l.mode)&&[l.reservedPersons,l.boardedPersons,l.releasedPersons,l.completedPersons].every(whole)&&l.reservedPersons>0&&l.completedPersons<=l.boardedPersons&&l.boardedPersons+l.releasedPersons<=l.reservedPersons,'Invalid mode lease snapshot');
      this.leases.set(l.leaseId,clone(l));
    }
    for(const t of s.taxis) {
      requireValid(fields(t,'cell,moveIds,unitId')&&id(t.unitId)&&!this.taxis.has(t.unitId)&&cell(t.cell)&&Array.isArray(t.moveIds)&&t.moveIds.every(id)&&new Set(t.moveIds).size===t.moveIds.length,'Invalid taxi unit snapshot');
      this.taxis.set(t.unitId,clone(t));
    }
    for(const m of s.moves) {
      requireValid(m&&validMove(m)&&!this.moves.has(m.moveId)&&this.taxis.has(m.unitId),'Invalid taxi move snapshot');
      const r=road(flowId('taxi',m.moveId),m.from,m.to,1);requireValid(r.transferred===0,'Taxi vehicle load cannot be leased');
      if(m.carriedPersons>0) {
        const lease=this.leases.get(m.leaseId!);requireValid(lease?.mode==='taxi','Taxi move lost its passenger lease');
        const p=this.passengers.get(lease.requestId)!;
        requireValid(frontageGeometry(p.from,m.from)&&frontageGeometry(p.to,m.to),'Taxi movement changed its passenger endpoints');
      }
      this.moves.set(m.moveId,clone(m));
    }
    for(const f of s.freight) {
      requireValid(fields(f,'from,requestId,to,vehicleUnits')&&id(f.requestId)&&!this.freight.has(f.requestId)&&whole(f.from)&&whole(f.to)&&finite(f.vehicleUnits)&&f.vehicleUnits>0,'Invalid freight snapshot');
      const r=road(flowId('freight',f.requestId),f.from,f.to,f.vehicleUnits);requireValid(r.transferred===0,'Freight cannot be leased');
      this.freight.set(f.requestId,clone(f));
    }
    const state=this.flow.snapshot;
    requireValid(state.requests.length===expectedRoad.size&&state.requests.every(r=>expectedRoad.has(r.requestId))&&[...state.waiting,...state.batches].every(x=>x.requestId!==undefined),'Unowned road traffic in bridge');
    for(const key of ['offered','admitted','completed','transferred'] as const)requireValid(equal(state[key],state.requests.reduce((n,r)=>n+r[key],0)),'Bridge road totals differ');
    for(const p of this.passengers.values()) {
      const records=p.roadIds.map(key=>this.flow.receipt(key)!),leases=[...this.leases.values()].filter(l=>l.requestId===p.requestId);
      requireValid(equal(records.reduce((n,r)=>n+r.offered,0)*PEOPLE_PER_VEHICLE,p.persons+leases.reduce((n,l)=>n+l.releasedPersons,0)),'Released passenger road offers differ');
      requireValid(equal(records.reduce((n,r)=>n+r.transferred,0)*PEOPLE_PER_VEHICLE,leases.reduce((n,l)=>n+l.reservedPersons,0)),'Passenger reservations differ from road transfers');
      requireValid(equal(this.passengerReceipt(this.scopeValue,p.requestId).conservationError,0),'Passenger conservation mismatch');
    }
    const unitMoves=new Set<string>();
    for(const t of this.taxis.values()) {
      let current=t.cell;
      t.moveIds.forEach((key,i)=>{
        const m=this.moves.get(key);requireValid(m&&m.unitId===t.unitId&&m.from===current&&!unitMoves.has(key),'Taxi location chain mismatch');
        requireValid(i===t.moveIds.length-1||this.arrived(flowId('taxi',key)),'Taxi passed an unfinished movement');
        unitMoves.add(key);current=m.to;
      });
    }
    requireValid(unitMoves.size===this.moves.size,'Taxi move missing from its unit');
    for(const l of this.leases.values())if(l.mode==='taxi') {
      const assigned=[...this.moves.values()].filter(m=>m.leaseId===l.leaseId).reduce((n,m)=>n+m.carriedPersons,0);
      requireValid(assigned<=l.boardedPersons&&l.completedPersons<=this.deliveredTaxiPersons(l.leaseId),'Taxi passenger completion exceeds road receipts');
    }
  }
}
