import type {CitizenVehiclePose} from '../citizen-vehicle-poses.ts';
import {TRAFFIC_SPACING} from './spacing.ts';
export type PresentationObstacle={id?:string;x:number;z:number;headingX:number;headingZ:number;length:number;width:number};
export type PresentationAdmissionBox={minX:number;maxX:number;minZ:number;maxZ:number};
type Box=PresentationAdmissionBox;
type CornerReservation={owner:string;plan:string;visit?:number;exit?:{x:number;z:number;headingX:number;headingZ:number};gate?:{x:number;z:number;headingX:number;headingZ:number};box:Box;boxes:Box[];order:number;entered:boolean;active:boolean};
type BusReservation={owner:string;boxes:Box[];order:number;state:'REQUESTED'|'SELECTED_DRAIN'|'ACQUIRED'|'OCCUPIED';epoch:ReadonlySet<string>;turnId?:string};
export type PresentationMotionState='blocked'|'moving'|'waiting'|'pending'|'absent';
type Entry={pose:CitizenVehiclePose;last:CitizenVehiclePose;path:CitizenVehiclePose[];speed:number;distance:number;motion:'blocked'|'moving'|'waiting';retiring:boolean;retiredFor:number;completedNodes:Set<string>;completedVisit:number;nodeGeometry:Map<string,NodePlan>};
const EPS=1e-7,MAX_POINTS=8192;
const distance=(a:CitizenVehiclePose,b:CitizenVehiclePose)=>Math.hypot(a.x-b.x,a.z-b.z);
function footprint(p:PresentationObstacle){const hx=Math.abs(p.headingX),hz=Math.abs(p.headingZ);return {minX:p.x-(hx*p.length+hz*p.width)/2,maxX:p.x+(hx*p.length+hz*p.width)/2,minZ:p.z-(hz*p.length+hx*p.width)/2,maxZ:p.z+(hz*p.length+hx*p.width)/2};}
const body=(p:CitizenVehiclePose)=>footprint({...p,length:TRAFFIC_SPACING.lengths.sedan,width:.3});
const intersects=(a:ReturnType<typeof body>,b:ReturnType<typeof body>,gap:number=TRAFFIC_SPACING.standstillGap)=>a.minX-gap<b.maxX-EPS&&b.minX-gap<a.maxX-EPS&&a.minZ-gap<b.maxZ-EPS&&b.minZ-gap<a.maxZ-EPS;
/** Conservative broad phase followed by the original exact child-box checks. */
export function presentationUnionIntersectsBox(union:Box,boxes:readonly Box[],other:Box):boolean {
 return intersects(union,other)&&boxes.some(box=>intersects(box,other));
}
export function presentationUnionsIntersect(a:Box,as:readonly Box[],b:Box,bs:readonly Box[]):boolean {
 return intersects(a,b)&&as.some(x=>bs.some(y=>intersects(x,y)));
}
/** Conservative continuous body sweep, including intermediate rotation (not just endpoint boxes). */
export function presentationSweep(from:PresentationObstacle,to:PresentationObstacle):Box {
 const a=footprint(from),b=footprint(to),box={minX:Math.min(a.minX,b.minX),maxX:Math.max(a.maxX,b.maxX),minZ:Math.min(a.minZ,b.minZ),maxZ:Math.max(a.maxZ,b.maxZ)};
 if(Math.abs(from.headingX-to.headingX)+Math.abs(from.headingZ-to.headingZ)>EPS){
  const radius=Math.max(Math.hypot(from.length,from.width),Math.hypot(to.length,to.width))/2;
  box.minX=Math.min(from.x,to.x)-radius;box.maxX=Math.max(from.x,to.x)+radius;
  box.minZ=Math.min(from.z,to.z)-radius;box.maxZ=Math.max(from.z,to.z)+radius;
 }
 return box;
}
/** Axis support maxima over the complete monotone heading interval.
 * This covers repeated normalization at any render cadence without sampling assumptions. */
export function presentationCarSweep(from:CitizenVehiclePose,to:CitizenVehiclePose):Box {
 const start=Math.atan2(from.headingZ,from.headingX);let end=Math.atan2(to.headingZ,to.headingX);while(end-start>Math.PI)end-=2*Math.PI;while(end-start< -Math.PI)end+=2*Math.PI;
 const lo=Math.min(start,end),hi=Math.max(start,end),length=TRAFFIC_SPACING.lengths.sedan,width=.3;
 // Most frames move straight with unchanged heading. The support extrema over a
 // zero-width angular interval are its single endpoint; avoid scanning critical
 // angles and allocating arrays while preserving the exact endpoint arithmetic.
 if(lo===hi){const c=Math.abs(Math.cos(lo)),s=Math.abs(Math.sin(lo)),hx=(length*c+width*s)/2,hz=(width*c+length*s)/2;
  return {minX:Math.min(from.x,to.x)-hx,maxX:Math.max(from.x,to.x)+hx,minZ:Math.min(from.z,to.z)-hz,maxZ:Math.max(from.z,to.z)+hz};}
 const support=(x:number,z:number)=>{const values=[lo,hi],critical=Math.atan2(z,x);for(let k=-2;k<=2;k++)for(const a of [critical,-critical,Math.PI-critical,Math.PI+critical]){const angle=a+k*2*Math.PI;if(angle>=lo&&angle<=hi)values.push(angle);}return Math.max(...values.map(a=>(x*Math.abs(Math.cos(a))+z*Math.abs(Math.sin(a)))/2));};
 const hx=support(length,width),hz=support(width,length);
 return {minX:Math.min(from.x,to.x)-hx,maxX:Math.max(from.x,to.x)+hx,minZ:Math.min(from.z,to.z)-hz,maxZ:Math.max(from.z,to.z)+hz};
}
/** Rounded legal lane intersection, never a diagonal across the corner parcel. */
export function presentationPath(a:CitizenVehiclePose,b:CitizenVehiclePose):CitizenVehiclePose[]{
 if(distance(a,b)<EPS)return [];
 const dot=a.headingX*b.headingX+a.headingZ*b.headingZ;
 if(Math.abs(dot)<EPS){
  const x=a.headingX?b.x:a.x,z=a.headingZ?b.z:a.z;
  const incoming=(x-a.x)*a.headingX+(z-a.z)*a.headingZ,outgoing=(b.x-x)*b.headingX+(b.z-z)*b.headingZ;
  if(incoming>=-EPS&&outgoing>=-EPS){
   const r=Math.min(.14,Math.max(0,incoming),Math.max(0,outgoing)),start={x:x-a.headingX*r,z:z-a.headingZ*r},end={x:x+b.headingX*r,z:z+b.headingZ*r};
   const path:CitizenVehiclePose[]=[{...a,...start}];
   for(let n=1;n<=6;n++){const t=n/6,u=1-t,dx=2*(u*(x-start.x)+t*(end.x-x)),dz=2*(u*(z-start.z)+t*(end.z-z)),length=Math.hypot(dx,dz);path.push({...b,x:u*u*start.x+2*u*t*x+t*t*end.x,z:u*u*start.z+2*u*t*z+t*t*end.z,headingX:length>EPS?dx/length:b.headingX,headingZ:length>EPS?dz/length:b.headingZ});}
   path.push({...b});return path.filter((p,i)=>distance(i?path[i-1]:a,p)>EPS);
  }
 }
 // Same-lane model correction must not make the visible car reverse/teleport.
 if(dot>.99&&(b.x-a.x)*a.headingX+(b.z-a.z)*a.headingZ<-EPS)return [];
 return [{...b}];
}
/** The model changes links at node centres; lane corners occur before that centre.
 * Keep an incoming target at the known legal tangent until an actual outgoing sample exists. */
export function presentationTarget(p:CitizenVehiclePose):CitizenVehiclePose {
 const h=p.upcomingTurn;if(!h||Math.abs(p.headingX*h.headingX+p.headingZ*h.headingZ)>.001)return p;
 const x=p.headingX?h.x:p.x,z=p.headingZ?h.z:p.z;
 const along=(p.x-x)*p.headingX+(p.z-z)*p.headingZ;
 return along>-.14?{...p,x:x-p.headingX*.14,z:z-p.headingZ*.14}:p;
}
function outgoingReady(a:CitizenVehiclePose,b:CitizenVehiclePose):boolean {
 if(Math.abs(a.headingX*b.headingX+a.headingZ*b.headingZ)>.001)return true;
 const x=a.headingX?b.x:a.x,z=a.headingZ?b.z:a.z;
 return (b.x-x)*b.headingX+(b.z-z)*b.headingZ>=.14-EPS;
}
function appendPath(entry:Entry,points:CitizenVehiclePose[]){
 for(const point of points){
  const last=entry.path.at(-1),before=entry.path.length>1?entry.path.at(-2)!:entry.pose;
  if(last&&last.upcomingTurn?.visit===point.upcomingTurn?.visit&&last.upcomingTurn?.nodeX===point.upcomingTurn?.nodeX&&last.upcomingTurn?.nodeZ===point.upcomingTurn?.nodeZ&&Math.abs(last.headingX-point.headingX)+Math.abs(last.headingZ-point.headingZ)<EPS
   &&Math.abs((last.x-before.x)*last.headingZ-(last.z-before.z)*last.headingX)<EPS
   &&Math.abs((point.x-last.x)*last.headingZ-(point.z-last.z)*last.headingX)<EPS
   &&(point.x-last.x)*last.headingX+(point.z-last.z)*last.headingZ>=-EPS){entry.path[entry.path.length-1]={...point};continue;}
  if(entry.path.length>=MAX_POINTS)throw Error('Traffic presentation path budget exceeded');entry.path.push({...point});
 }
}
/** One upcoming turn only: full rotation sweep plus one car of clear outgoing lane. */
function cornerBox(e:Entry):Box|null {
 const points=[e.pose,...e.path];let first=-1;
 for(let i=1;i<points.length;i++)if(Math.abs(points[i-1].headingX-points[i].headingX)+Math.abs(points[i-1].headingZ-points[i].headingZ)>.01){first=i;break;}
 if(first<0){
  const hint=e.last.upcomingTurn;if(!hint)return null;
  const x=e.last.headingX?hint.x:e.last.x,z=e.last.headingZ?hint.z:e.last.z;
  const incoming={...e.last,x:x-e.last.headingX*.14,z:z-e.last.headingZ*.14},outgoing={...e.last,...hint,x:x+hint.headingX*.14,z:z+hint.headingZ*.14};
  const box=presentationSweep({...incoming,length:TRAFFIC_SPACING.lengths.sedan,width:.3},{...outgoing,length:TRAFFIC_SPACING.lengths.sedan,width:.3}),exit=body({...e.last,...hint});
  box.minX=Math.min(box.minX,exit.minX);box.maxX=Math.max(box.maxX,exit.maxX);box.minZ=Math.min(box.minZ,exit.minZ);box.maxZ=Math.max(box.maxZ,exit.maxZ);return box;
 }
 let end=first;while(end+1<points.length&&Math.abs(points[end].headingX*points[end].headingZ)>.001)end++;
 const start=points[first-1],finish=points[end],box=presentationSweep({...start,length:TRAFFIC_SPACING.lengths.sedan,width:.3},{...finish,length:TRAFFIC_SPACING.lengths.sedan,width:.3});
 for(let i=first;i<=end;i++){const b=presentationSweep({...points[i-1],length:TRAFFIC_SPACING.lengths.sedan,width:.3},{...points[i],length:TRAFFIC_SPACING.lengths.sedan,width:.3});box.minX=Math.min(box.minX,b.minX);box.maxX=Math.max(box.maxX,b.maxX);box.minZ=Math.min(box.minZ,b.minZ);box.maxZ=Math.max(box.maxZ,b.maxZ);}
 const exit=body({...finish,x:finish.x+finish.headingX*.51,z:finish.z+finish.headingZ*.51});box.minX=Math.min(box.minX,exit.minX);box.maxX=Math.max(box.maxX,exit.maxX);box.minZ=Math.min(box.minZ,exit.minZ);box.maxZ=Math.max(box.maxZ,exit.maxZ);return box;
}
/** Preserve at most the occupied and next conflict node, including straight crossings. */
type NodePlan={key:string;visit?:number;nodeX?:number;nodeZ?:number;exit?:{x:number;z:number;headingX:number;headingZ:number};gate?:{x:number;z:number;headingX:number;headingZ:number};box:Box;boxes:Box[]};
function incomingPredecessor(owner:CitizenVehiclePose,other:CitizenVehiclePose,gate:NodePlan['gate']):boolean {
 if(!gate)return false;
 const along=(p:CitizenVehiclePose)=>(p.x-gate.x)*gate.headingX+(p.z-gate.z)*gate.headingZ;
 const lateral=(p:CitizenVehiclePose)=>(p.x-gate.x)*gate.headingZ-(p.z-gate.z)*gate.headingX;
 const position=along(owner);
 return position< -EPS&&other.headingX*gate.headingX+other.headingZ*gate.headingZ>.99
  &&Math.abs(lateral(other)-lateral(owner))<.3-EPS
  &&along(other)>position+EPS&&along(other)<=EPS;
}
function nodePlans(e:Entry):NodePlan[]{
 const plans:{key:string;visit?:number;nodeX?:number;nodeZ?:number;exit?:{x:number;z:number;headingX:number;headingZ:number};gate?:{x:number;z:number;headingX:number;headingZ:number};box:Box;boxes:Box[]}[]=[],seen=new Set<string>();
 for(const p of [e.pose,...e.path,e.last]){
  const h=p.upcomingTurn;if(!h||h.nodeX===undefined||h.nodeZ===undefined)continue;
  const hx=h.incomingHeadingX??p.headingX,hz=h.incomingHeadingZ??p.headingZ;
  if(Math.abs(hx*hz)>.001)continue;
  const key=`${h.visit??"legacy"}:${h.nodeX},${h.nodeZ}/${hx},${hz}/${h.headingX},${h.headingZ}`;
  if(seen.has(key)||(h.visit===undefined?e.completedNodes.has(key):h.visit<=e.completedVisit))continue;seen.add(key);
  const cached=e.nodeGeometry.get(key);if(cached){plans.push(cached);if(plans.length===2)break;continue;}
  const entry={...p,x:h.entryX??(hx?h.nodeX:p.x),z:h.entryZ??(hz?h.nodeZ:p.z),headingX:hx,headingZ:hz};
  const approach={...entry,x:entry.x-hx*.8,z:entry.z-hz*.8},exit={...p,...h};
  const points=[approach,...presentationPath(approach,exit)],boxes=points.slice(1).map((q,i)=>presentationCarSweep(points[i],q));
  if(!boxes.length)continue;
  plans.push({key,visit:h.visit,nodeX:h.nodeX,nodeZ:h.nodeZ,exit:{x:h.x,z:h.z,headingX:h.headingX,headingZ:h.headingZ},gate:{x:approach.x,z:approach.z,headingX:hx,headingZ:hz},boxes,box:{minX:Math.min(...boxes.map(b=>b.minX)),maxX:Math.max(...boxes.map(b=>b.maxX)),minZ:Math.min(...boxes.map(b=>b.minZ)),maxZ:Math.max(...boxes.map(b=>b.maxZ))}});e.nodeGeometry.set(key,plans.at(-1)!);if(plans.length===2)break;
 }
 for(const key of e.nodeGeometry.keys())if(!seen.has(key))e.nodeGeometry.delete(key);
 if(!plans.length&&e.completedVisit<0&&![e.pose,...e.path,e.last].some(p=>p.upcomingTurn?.nodeX!==undefined)){const box=cornerBox(e);if(box)plans.push({key:'legacy',box,boxes:[box]});}
 return plans;
}
/** Bounded visible-car lifecycle and bus movement reservations; worker actors remain unchanged. */
export class TrafficPresentation {
 private entries=new Map<string,Entry>();private pending:CitizenVehiclePose[]=[];private live=new Set<string>();private shown:CitizenVehiclePose[]=[];
 private admitted=0;private removed=0;private busIntrusions=0;private lastRemoved:string[]=[];
 private busPositions=new Map<string,PresentationObstacle>();
 private corners=new Map<string,CornerReservation>();
 private reservations=new Map<string,BusReservation>();private reservationSequence=0;private busHeld=0;private busGranted=0;
 private selectedBusEpoch=new Set<string>();private selectedPeerBodies:Box[]=[];private peersForSelection:PresentationObstacle[]=[];
 private selectedOwner:string|null=null;private birthOpportunity=0;private birthDeferredFrames=0;private drainFrames=0;private drainSeconds=0;private maxDrainSeconds=0;private birthOpportunities=0;
 private readonly limit:number;
 constructor(limit=64){this.limit=limit;if(!Number.isInteger(limit)||limit<0||limit>64)throw Error('Invalid presentation limit');}
 /** Last nonzero physical frame, not speed or worker progress. A deferred
  * birth has never acquired a body and is reported separately. */
 motionState(id:string):PresentationMotionState {
  const entry=this.entries.get(id);if(entry)return entry.motion;
  return this.pending.some(p=>p.vehicleId===id)?'pending':'absent';
 }
 /** Actual physical travel by this body since admission, never worker targets. */
 traveledDistance(id:string):number|null {return this.entries.get(id)?.distance??null;}
 private granted(r:BusReservation){return r.state==='ACQUIRED'||r.state==='OCCUPIED';}
 private selectDrain(){
  if(this.selectedOwner||this.birthOpportunity)return;
  const first=[...this.reservations.values()].filter(r=>!this.granted(r)).sort((a,b)=>a.order-b.order)[0];if(!first)return;
  this.selectedOwner=first.owner;
  const domain=[...this.reservations.values()].filter(r=>r.owner===first.owner).flatMap(r=>r.boxes);
  const peers=this.peersForSelection.filter(p=>p.id!==first.owner&&domain.some(b=>intersects(footprint(p),b)));
  this.selectedBusEpoch=new Set(peers.flatMap(p=>p.id?[p.id]:[]));this.selectedPeerBodies=peers.filter(p=>!p.id).map(footprint);
  const epoch=new Set(this.entries.keys());
  for(const r of this.reservations.values())if(r.owner===first.owner&&!this.granted(r)){r.state='SELECTED_DRAIN';r.epoch=epoch;}
 }
 /** One atomic actual-route-to-holding-slot request. Pending requests own no space.
  * Selected drain defers only births; every already admitted car retains its escape rights.
  * Acquired geometry is protected until the engine explicitly reports actual tail-clear. */
 allowBusMovement(id:string,from:PresentationObstacle,to:PresentationObstacle,others:readonly PresentationObstacle[]=[],samples:readonly PresentationObstacle[]=[],turns:readonly {id:string;samples:readonly PresentationObstacle[]}[]=[]):boolean {
  if(turns.length>3||turns.some(t=>t.samples.length<2||t.samples.length>1154)||new Set(turns.map(t=>t.id)).size!==turns.length)throw Error('Invalid bounded bus turn intents');
  this.busPositions.set(id,from);this.peersForSelection=[{...from,id},...others];
  const wasSelected=this.selectedOwner===id;let pendingChanged=false;
  const keep=new Set([id,...turns.map(t=>`${id}:turn:${t.id}`)]);
  for(const [key,r]of this.reservations)if(r.owner===id&&!keep.has(key)){if(!this.granted(r))pendingChanged=true;this.reservations.delete(key);}
  const sweep=(points:readonly PresentationObstacle[])=>points.slice(1).map((p,i)=>presentationSweep(points[i],p));
  const immediate=sweep([from,...samples,to]);
  const plans=turns.length?turns.map(t=>{const key=`${id}:turn:${t.id}`;return {key,boxes:this.reservations.get(key)?.boxes??sweep(t.samples),turnId:t.id};}):[{key:id,boxes:immediate,turnId:undefined}];
  for(const p of plans)if(!this.reservations.has(p.key)){pendingChanged=true;this.reservations.set(p.key,{owner:id,boxes:p.boxes,order:++this.reservationSequence,state:'REQUESTED',epoch:new Set(),turnId:p.turnId});}
  if(wasSelected&&pendingChanged){for(const r of this.reservations.values())if(r.owner===id&&!this.granted(r))r.state='REQUESTED';this.selectedOwner=null;this.selectedBusEpoch.clear();this.selectedPeerBodies=[];}
  this.selectDrain();
  const requests=plans.map(p=>this.reservations.get(p.key)!);const acquiring=requests.some(r=>!this.granted(r));
  let evacuating=false;
  if(this.selectedOwner&&this.selectedOwner!==id){
   const domain=[...this.reservations.values()].filter(r=>r.owner===this.selectedOwner).flatMap(r=>r.boxes),current=footprint(from);
   const stillInside=domain.some(b=>intersects(current,b));
   if(!stillInside)this.selectedBusEpoch.delete(id);
   if(stillInside&&!this.selectedBusEpoch.has(id)){const known=this.selectedPeerBodies.findIndex(b=>Math.abs(b.minX-current.minX)+Math.abs(b.maxX-current.maxX)+Math.abs(b.minZ-current.minZ)+Math.abs(b.maxZ-current.maxZ)<EPS);if(known>=0){this.selectedPeerBodies.splice(known,1);this.selectedBusEpoch.add(id);}}
   evacuating=this.selectedBusEpoch.has(id);
  }
  const selectedDomain=[...this.reservations.values()].filter(r=>r.owner===this.selectedOwner).flatMap(r=>r.boxes);
  const independent=this.selectedOwner!==null&&this.selectedOwner!==id&&![...immediate,...requests.flatMap(r=>r.boxes)].some(a=>selectedDomain.some(b=>intersects(a,b)));
  if(acquiring&&this.selectedOwner!==id&&!evacuating&&!independent){this.busHeld++;return false;}
  const protectedBoxes=acquiring?[...immediate,...requests.flatMap(r=>r.boxes)]:immediate;
  const blocked=this.entries.size&&[...this.entries.values()].some(e=>protectedBoxes.some(b=>intersects(body(e.pose),b)))
   ||others.some(p=>protectedBoxes.some(b=>intersects(footprint(p),b)))
   ||[...this.corners.values()].some(c=>c.active&&protectedBoxes.some(b=>c.boxes.some(a=>intersects(b,a))))
   ||[...this.reservations.values()].some(r=>r.owner!==id&&this.granted(r)&&r.boxes.some(a=>protectedBoxes.some(b=>intersects(a,b))));
  if(blocked){this.busHeld++;return false;}
  for(const r of requests)r.state='OCCUPIED';
  this.reservations.delete(id);this.busPositions.set(id,to);this.busGranted++;
  if(acquiring&&this.selectedOwner===id){this.maxDrainSeconds=Math.max(this.maxDrainSeconds,this.drainSeconds);this.drainSeconds=0;this.birthOpportunities++;this.selectedOwner=null;this.selectedBusEpoch.clear();this.selectedPeerBodies=[];this.birthOpportunity=1;}
  return true;
 }
 reconcileBuses(ids:readonly string[]):void {const live=new Set(ids);for(const id of this.busPositions.keys())if(!live.has(id))this.busPositions.delete(id);for(const [id,r]of this.reservations)if(!live.has(r.owner))this.reservations.delete(id);if(this.selectedOwner&&!live.has(this.selectedOwner))this.selectedOwner=null;}
 clearBusReservations():void {this.reservations.clear();this.busPositions.clear();this.selectedOwner=null;this.selectedBusEpoch.clear();this.selectedPeerBodies=[];this.birthOpportunity=1;}
 /** Immediately remove explicitly cancelled car identities. Normal completed
  * trips still use the terminal path in update(); this path is reserved for a
  * an explicitly identified cancellation or its worker receipt.
  * The caller must fence stale snapshots and never reuse an ID in its epoch. */
 expire(ids:readonly string[]):void {
  if(!ids.length)return;
  const expired=new Set(ids);
  for(const id of expired){
   this.live.delete(id);
   if(this.entries.delete(id)){this.removed++;this.lastRemoved.push(id);if(this.lastRemoved.length>32)this.lastRemoved.shift();}
   this.selectedBusEpoch.delete(id);
  }
  this.pending=this.pending.filter(p=>!expired.has(p.vehicleId));
  this.shown=this.shown.filter(p=>!expired.has(p.vehicleId));
  for(const [key,r]of this.corners)if(expired.has(r.owner))this.corners.delete(key);
  // The selected drain keeps its bus identity and physical rights. Only the
  // departed car members are removed from the captured incumbent set.
  for(const r of this.reservations.values())if([...expired].some(id=>r.epoch.has(id)))r.epoch=new Set([...r.epoch].filter(id=>!expired.has(id)));
 }
 private acquireCorners(obstacles:readonly Box[]){
  // No poses or collection membership change during acquisition. Reuse these
  // detached broad-phase bounds, but keep reading live grant flags in order.
  const entries=[...this.entries].map(([id,e])=>({id,pose:e.pose,box:body(e.pose)}));
  const corners=[...this.corners.values()],reservations=[...this.reservations.values()];
  for(const r of [...corners].sort((a,b)=>a.order-b.order)){
   if(r.active)continue;
   const owner=this.entries.get(r.owner);
   if(owner&&entries.some(e=>e.id!==r.owner&&incomingPredecessor(owner.pose,e.pose,r.gate)))continue;
   if(corners.some(c=>c.owner===r.owner&&c.order<r.order&&!c.active))continue;
   if(entries.some(e=>e.id!==r.owner&&intersects(e.box,r.box)&&r.boxes.some(b=>intersects(e.box,b))))continue;
   if(obstacles.some(b=>intersects(b,r.box)&&r.boxes.some(a=>intersects(b,a))))continue;
   if(corners.some(c=>c.active&&c.owner!==r.owner&&intersects(c.box,r.box)&&c.boxes.some(a=>r.boxes.some(b=>intersects(a,b)))))continue;
   if(reservations.some(b=>this.granted(b)&&b.boxes.some(box=>intersects(box,r.box)&&r.boxes.some(a=>intersects(box,a)))))continue;
   r.active=true;
  }
 }

 update(raw:readonly CitizenVehiclePose[],preferred:readonly CitizenVehiclePose[]=raw,liveIds:readonly string[]=raw.map(p=>p.vehicleId)){
  const byId=new Map(raw.map(p=>[p.vehicleId,presentationTarget(p)]));this.live=new Set(liveIds);
  for(const [id,e]of this.entries){
   if(!this.live.has(id)){
    if(!e.retiring){e.retiring=true;if(e.last.exitX!==undefined&&e.last.exitZ!==undefined){const exit={...e.last,x:e.last.exitX,z:e.last.exitZ};appendPath(e,presentationPath(e.last,exit));e.last=exit;}}
    continue;
   }
   const next=byId.get(id);if(!next)continue;
   if(e.retiring)throw Error('Traffic identity reappeared after removal');
   if(!outgoingReady(e.last,next))continue;
   const additions=presentationPath(e.last,next);appendPath(e,additions);e.last={...next};
  }
  const order=[...preferred,...raw],seen=new Set<string>();this.pending=[];
  for(const p of order)if(!seen.has(p.vehicleId)&&this.live.has(p.vehicleId)&&!this.entries.has(p.vehicleId)){seen.add(p.vehicleId);this.pending.push({...presentationTarget(p)});}
 }
 frame(dt:number,paused:boolean,buses:readonly PresentationObstacle[]=[]):CitizenVehiclePose[]{
  if(!Number.isFinite(dt)||dt<0)throw Error('Invalid presentation timestep');if(paused)return this.shown.map(p=>({...p}));
  for(const [key,r]of this.corners){const e=this.entries.get(r.owner);if(!e||(r.entered&&(r.exit?e.pose.headingX*r.exit.headingX+e.pose.headingZ*r.exit.headingZ>.99&&(e.pose.x-r.exit.x)*r.exit.headingX+(e.pose.z-r.exit.z)*r.exit.headingZ>=-EPS:!intersects(body(e.pose),r.box)))){if(e&&r.plan!=='legacy'){if(r.visit!==undefined)e.completedVisit=Math.max(e.completedVisit,r.visit);else e.completedNodes.add(r.plan);}this.corners.delete(key);}}
  // Partition once in original map order. Each loop iteration mutates only its
  // own entries, so other owners' snapshots remain valid.
  const ownedByOwner=new Map<string,[string,CornerReservation][]>();
  for(const pair of this.corners){const owner=pair[1].owner,owned=ownedByOwner.get(owner);if(owned)owned.push(pair);else ownedByOwner.set(owner,[pair]);}
  for(const [id,e]of this.entries){
   // The legacy decision uses the pre-prune set, as in the original algorithm.
   const owned=ownedByOwner.get(id)??[], nonlegacy=owned.some(([,r])=>r.plan!=='legacy');
   const plans=nodePlans(e).filter(p=>p.key!=='legacy'||!nonlegacy),desired=new Set(plans.map(p=>p.key));
   let count=owned.length;
   for(const [key,r]of owned)if(!r.entered&&!desired.has(r.plan)){this.corners.delete(key);count--;}
   for(const plan of plans){const key=`${id}@${plan.key}`;if(!this.corners.has(key)){if(count>=2)break;this.corners.set(key,{owner:id,plan:plan.key,visit:plan.visit,exit:plan.exit,gate:plan.gate,box:plan.box,boxes:plan.boxes,order:++this.reservationSequence,entered:false,active:false});count++;}}
  }
  const obstacles=buses.map(footprint);this.acquireCorners(obstacles);
  const corners=[...this.corners.values()],reservations=[...this.reservations.values()].filter(r=>this.granted(r)),total=Math.min(dt,.25),steps=Math.max(1,Math.ceil(total/.025)),slice=total/steps;
  const footprints=new Map([...this.entries].map(([id,e])=>[id,body(e.pose)]));
  const clear=(p:CitizenVehiclePose,id:string,swept?:ReturnType<typeof body>)=>{
   const box=swept??body(p);if(obstacles.some(b=>intersects(box,b)))return false;
   for(const r of reservations)if(r.boxes.some(b=>intersects(box,b)))return false;
   for(const r of corners){
    if(r.owner===id){if(!r.active&&(r.gate?(p.x-r.gate.x)*r.gate.headingX+(p.z-r.gate.z)*r.gate.headingZ>EPS:intersects(box,r.box)))return false;}
    else if(r.active&&intersects(box,r.box)&&r.boxes.some(b=>intersects(box,b)))return false;
   }
   for(const [other,b]of footprints)if(other!==id&&intersects(box,b))return false;return true;
  };
  // Safe births are deferred rather than flashed for a frame and subsequently hidden.
  if(this.selectedOwner){this.birthDeferredFrames+=this.pending.length?1:0;this.drainFrames++;this.drainSeconds+=Math.min(dt,.25);this.maxDrainSeconds=Math.max(this.maxDrainSeconds,this.drainSeconds);}
  for(const p of this.pending){if(this.entries.size>=this.limit||this.selectedOwner)break;
   // Do not introduce a new leader ahead of an already committed corridor.
   // Reject before constructing turn geometry when the answer is already known.
   if(corners.some(c=>c.active&&this.entries.has(c.owner)&&incomingPredecessor(this.entries.get(c.owner)!.pose,p,c.gate)))continue;
   const candidate:Entry={pose:{...p},last:{...p},path:[],speed:0,distance:0,motion:'waiting',retiring:false,retiredFor:0,completedNodes:new Set(),completedVisit:-1,nodeGeometry:new Map()};
   const birthPlans=nodePlans(candidate);
   if(birthPlans.some(n=>[...this.entries.values()].some(e=>incomingPredecessor(p,e.pose,n.gate))))continue;
   // Each union box encloses all of its exact boxes. A miss cannot intersect
   // any child box; a hit still runs the original exact collision checks.
   if(birthPlans.some(n=>[...footprints.values()].some(b=>presentationUnionIntersectsBox(n.box,n.boxes,b))||obstacles.some(b=>presentationUnionIntersectsBox(n.box,n.boxes,b))||corners.some(c=>c.active&&presentationUnionsIntersect(n.box,n.boxes,c.box,c.boxes))||reservations.some(r=>r.boxes.some(b=>presentationUnionIntersectsBox(n.box,n.boxes,b)))))continue;
   if(clear(p,p.vehicleId)){this.entries.set(p.vehicleId,{pose:{...p},last:{...p},path:[],speed:Math.max(0,Math.min(2,p.speed??0)),distance:0,motion:'waiting',retiring:false,retiredFor:0,completedNodes:new Set(),completedVisit:-1,nodeGeometry:new Map()});footprints.set(p.vehicleId,body(p));this.admitted++;
    for(const plan of birthPlans){const r:CornerReservation={owner:p.vehicleId,plan:plan.key,visit:plan.visit,exit:plan.exit,gate:plan.gate,box:plan.box,boxes:plan.boxes,order:++this.reservationSequence,entered:plan.boxes.some(b=>intersects(body(p),b)),active:true};this.corners.set(`${p.vehicleId}@${plan.key}`,r);corners.push(r);}
   }}
  this.pending=this.pending.filter(p=>!this.entries.has(p.vehicleId));
  // Record the complete physical frame: any real progress wins over a later
  // blocked substep so a still-moving car is never described as stationary.
  const motion=new Map([...this.entries.keys()].map(id=>[id,{moved:false,blocked:false}]));
  for(let iteration=0;iteration<steps;iteration++){
   for(const r of this.corners.values()){const e=this.entries.get(r.owner);if(e&&r.active&&intersects(body(e.pose),r.box))r.entered=true;}
   const ordered=[...this.entries].sort(([,a],[,b])=>(b.pose.x*b.pose.headingX+b.pose.z*b.pose.headingZ)-(a.pose.x*a.pose.headingX+a.pose.z*a.pose.headingZ));
   for(const [id,e]of ordered){
    // Defensive diagnostic for callers bypassing the movement gate: never conceal
    // an intrusion by dropping or teleporting the existing car.
    if(obstacles.some(b=>intersects(body(e.pose),b,0)))this.busIntrusions=Math.min(Number.MAX_SAFE_INTEGER,this.busIntrusions+1);
    while(e.path.length&&distance(e.pose,e.path[0])<EPS){e.pose={...e.path.shift()!};}
    const goal=e.path[0];
    if(goal){
     const remaining=e.path.reduce((sum,p,i)=>sum+distance(i?e.path[i-1]:e.pose,p),0),turn=Math.abs(e.pose.headingX*goal.headingZ-e.pose.headingZ*goal.headingX)>.01;
     const aim=Math.min(turn?1.2:2,Math.sqrt(2*4*remaining));e.speed=Math.max(0,aim<e.speed?Math.max(aim,e.speed-4*slice):Math.min(aim,e.speed+2.5*slice));
     const length=distance(e.pose,goal),step=Math.min(length,e.speed*slice),fraction=length?step/length:1;
     const hx=e.pose.headingX+(goal.headingX-e.pose.headingX)*fraction,hz=e.pose.headingZ+(goal.headingZ-e.pose.headingZ)*fraction,n=Math.hypot(hx,hz);
     const candidate={...e.pose,x:e.pose.x+(goal.x-e.pose.x)*fraction,z:e.pose.z+(goal.z-e.pose.z)*fraction,headingX:n>EPS?hx/n:goal.headingX,headingZ:n>EPS?hz/n:goal.headingZ};
     const swept=presentationCarSweep(e.pose,candidate);
     if(clear(candidate,id,swept)){if(step>0){motion.get(id)!.moved=true;e.distance+=distance(e.pose,candidate);}e.pose=candidate;footprints.set(id,body(candidate));if(step>=length-EPS){e.pose={...goal};e.path.shift();}}else{if(step>0)motion.get(id)!.blocked=true;e.speed=0;}
    }else e.speed=0;
    if(e.retiring&&!e.path.length){e.retiredFor+=slice;e.pose={...e.pose,scale:Math.max(.05,1-e.retiredFor/.3)};if(e.retiredFor>=.3){this.entries.delete(id);for(const [key,r]of this.corners)if(r.owner===id)this.corners.delete(key);footprints.delete(id);this.removed++;this.lastRemoved.push(id);if(this.lastRemoved.length>32)this.lastRemoved.shift();}}
   }
  }
  if(total>0)for(const [id,e]of this.entries){const observation=motion.get(id)!;e.motion=observation.moved?'moving':observation.blocked?'blocked':'waiting';}
  if(this.birthOpportunity>0)this.birthOpportunity--;
  this.shown=[...this.entries.values()].map(e=>({...e.pose,speed:e.speed}));return this.shown.map(p=>({...p}));
 }
 get diagnostics(){return {maxDrainSeconds:this.maxDrainSeconds,birthOpportunities:this.birthOpportunities,birthDeferredFrames:this.birthDeferredFrames,drainFrames:this.drainFrames,selectedDrain:this.selectedOwner,cornerReservations:this.corners.size,cornerOwners:[...this.corners.values()].map(({owner,active,entered})=>({owner,active,entered})),busReservations:this.reservations.size,busHeld:this.busHeld,busGranted:this.busGranted,queuedWaypoints:[...this.entries.values()].reduce((n,e)=>n+e.path.length,0),renderedPoses:this.shown.map(p=>({...p})),selectedIds:[...this.entries.keys()],renderedIds:this.shown.map(p=>p.vehicleId),deferredIds:this.pending.map(p=>p.vehicleId),retiringIds:[...this.entries].filter(([,e])=>e.retiring).map(([id])=>id),admitted:this.admitted,removed:this.removed,lastRemoved:[...this.lastRemoved],busIntrusions:this.busIntrusions};}
}
