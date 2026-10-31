import type {CitizenVehiclePose} from '../citizen-vehicle-poses.ts';
import {TRAFFIC_SPACING} from './spacing.ts';
export type PresentationObstacle={x:number;z:number;headingX:number;headingZ:number;length:number;width:number};
type Entry={pose:CitizenVehiclePose;last:CitizenVehiclePose;path:CitizenVehiclePose[];speed:number;retiring:boolean;retiredFor:number};
const EPS=1e-7,MAX_POINTS=8192;
const distance=(a:CitizenVehiclePose,b:CitizenVehiclePose)=>Math.hypot(a.x-b.x,a.z-b.z);
function footprint(p:PresentationObstacle){const hx=Math.abs(p.headingX),hz=Math.abs(p.headingZ);return {minX:p.x-(hx*p.length+hz*p.width)/2,maxX:p.x+(hx*p.length+hz*p.width)/2,minZ:p.z-(hz*p.length+hx*p.width)/2,maxZ:p.z+(hz*p.length+hx*p.width)/2};}
const body=(p:CitizenVehiclePose)=>footprint({...p,length:TRAFFIC_SPACING.lengths.sedan,width:.3});
const intersects=(a:ReturnType<typeof body>,b:ReturnType<typeof body>,gap:number=TRAFFIC_SPACING.standstillGap)=>a.minX-gap<b.maxX-EPS&&b.minX-gap<a.maxX-EPS&&a.minZ-gap<b.maxZ-EPS&&b.minZ-gap<a.maxZ-EPS;
/** Rounded legal lane intersection, never a diagonal across the corner parcel. */
export function presentationPath(a:CitizenVehiclePose,b:CitizenVehiclePose):CitizenVehiclePose[]{
 if(distance(a,b)<EPS)return [];
 const dot=a.headingX*b.headingX+a.headingZ*b.headingZ;
 if(Math.abs(dot)<EPS){
  const x=a.headingX?b.x:a.x,z=a.headingZ?b.z:a.z;
  const incoming=(x-a.x)*a.headingX+(z-a.z)*a.headingZ,outgoing=(b.x-x)*b.headingX+(b.z-z)*b.headingZ;
  if(incoming>=-EPS&&outgoing>=-EPS){
   const r=Math.min(.14,Math.max(0,incoming)/2,Math.max(0,outgoing)/2),start={x:x-a.headingX*r,z:z-a.headingZ*r},end={x:x+b.headingX*r,z:z+b.headingZ*r};
   const path:CitizenVehiclePose[]=[{...a,...start}];
   for(let n=1;n<=6;n++){const t=n/6,u=1-t,dx=2*(u*(x-start.x)+t*(end.x-x)),dz=2*(u*(z-start.z)+t*(end.z-z)),length=Math.hypot(dx,dz);path.push({...b,x:u*u*start.x+2*u*t*x+t*t*end.x,z:u*u*start.z+2*u*t*z+t*t*end.z,headingX:length>EPS?dx/length:b.headingX,headingZ:length>EPS?dz/length:b.headingZ});}
   path.push({...b});return path.filter((p,i)=>distance(i?path[i-1]:a,p)>EPS);
  }
 }
 // Same-lane model correction must not make the visible car reverse/teleport.
 if(dot>.99&&(b.x-a.x)*a.headingX+(b.z-a.z)*a.headingZ<-EPS)return [];
 return [{...b}];
}
function appendPath(entry:Entry,points:CitizenVehiclePose[]){
 for(const point of points){
  const last=entry.path.at(-1),before=entry.path.length>1?entry.path.at(-2)!:entry.pose;
  if(last&&Math.abs(last.headingX-point.headingX)+Math.abs(last.headingZ-point.headingZ)<EPS
   &&Math.abs((last.x-before.x)*last.headingZ-(last.z-before.z)*last.headingX)<EPS
   &&Math.abs((point.x-last.x)*last.headingZ-(point.z-last.z)*last.headingX)<EPS
   &&(point.x-last.x)*last.headingX+(point.z-last.z)*last.headingZ>=-EPS){entry.path[entry.path.length-1]={...point};continue;}
  if(entry.path.length>=MAX_POINTS)throw Error('Traffic presentation path budget exceeded');entry.path.push({...point});
 }
}
/** Cosmetic, bounded identity lifecycle. Does not change worker actors or bus ownership. */
export class TrafficPresentation {
 private entries=new Map<string,Entry>();private pending:CitizenVehiclePose[]=[];private live=new Set<string>();private shown:CitizenVehiclePose[]=[];
 private admitted=0;private removed=0;private busIntrusions=0;private lastRemoved:string[]=[];
 private readonly limit:number;
 constructor(limit=64){this.limit=limit;if(!Number.isInteger(limit)||limit<0||limit>64)throw Error('Invalid presentation limit');}
 update(raw:readonly CitizenVehiclePose[],preferred:readonly CitizenVehiclePose[]=raw,liveIds:readonly string[]=raw.map(p=>p.vehicleId)){
  const byId=new Map(raw.map(p=>[p.vehicleId,p]));this.live=new Set(liveIds);
  for(const [id,e]of this.entries){
   if(!this.live.has(id)){
    if(!e.retiring){e.retiring=true;if(e.last.exitX!==undefined&&e.last.exitZ!==undefined){const exit={...e.last,x:e.last.exitX,z:e.last.exitZ};appendPath(e,presentationPath(e.last,exit));e.last=exit;}}
    continue;
   }
   const next=byId.get(id);if(!next)continue;
   if(e.retiring)throw Error('Traffic identity reappeared after removal');
   const additions=presentationPath(e.last,next);appendPath(e,additions);e.last={...next};
  }
  const order=[...preferred,...raw],seen=new Set<string>();this.pending=[];
  for(const p of order)if(!seen.has(p.vehicleId)&&this.live.has(p.vehicleId)&&!this.entries.has(p.vehicleId)){seen.add(p.vehicleId);this.pending.push({...p});}
 }
 frame(dt:number,paused:boolean,buses:readonly PresentationObstacle[]=[]):CitizenVehiclePose[]{
  if(!Number.isFinite(dt)||dt<0)throw Error('Invalid presentation timestep');if(paused)return this.shown.map(p=>({...p}));
  const obstacles=buses.map(footprint),total=Math.min(dt,.25),steps=Math.max(1,Math.ceil(total/.025)),slice=total/steps;
  const footprints=new Map([...this.entries].map(([id,e])=>[id,body(e.pose)]));
  const clear=(p:CitizenVehiclePose,id:string,swept?:ReturnType<typeof body>)=>{const box=swept??body(p);if(obstacles.some(b=>intersects(box,b)))return false;for(const [other,b]of footprints)if(other!==id&&intersects(box,b))return false;return true;};
  // Safe births are deferred rather than flashed for a frame and subsequently hidden.
  for(const p of this.pending){if(this.entries.size>=this.limit)break;if(clear(p,p.vehicleId)){this.entries.set(p.vehicleId,{pose:{...p},last:{...p},path:[],speed:Math.max(0,Math.min(2,p.speed??0)),retiring:false,retiredFor:0});footprints.set(p.vehicleId,body(p));this.admitted++;}}
  this.pending=this.pending.filter(p=>!this.entries.has(p.vehicleId));
  for(let iteration=0;iteration<steps;iteration++){
   const ordered=[...this.entries].sort(([,a],[,b])=>(b.pose.x*b.pose.headingX+b.pose.z*b.pose.headingZ)-(a.pose.x*a.pose.headingX+a.pose.z*a.pose.headingZ));
   for(const [id,e]of ordered){
    // An independently moving bus can intrude; retain identity and report it, never
    // conceal this missing shared right-of-way by dropping or teleporting the car.
    if(obstacles.some(b=>intersects(body(e.pose),b,0)))this.busIntrusions=Math.min(Number.MAX_SAFE_INTEGER,this.busIntrusions+1);
    while(e.path.length&&distance(e.pose,e.path[0])<EPS){e.pose={...e.path.shift()!};}
    const goal=e.path[0];
    if(goal){
     const remaining=e.path.reduce((sum,p,i)=>sum+distance(i?e.path[i-1]:e.pose,p),0),turn=Math.abs(e.pose.headingX*goal.headingZ-e.pose.headingZ*goal.headingX)>.01;
     const aim=Math.min(turn?1.2:2,Math.sqrt(2*4*remaining));e.speed=Math.max(0,aim<e.speed?Math.max(aim,e.speed-4*slice):Math.min(aim,e.speed+2.5*slice));
     const length=distance(e.pose,goal),step=Math.min(length,e.speed*slice),fraction=length?step/length:1;
     const hx=e.pose.headingX+(goal.headingX-e.pose.headingX)*fraction,hz=e.pose.headingZ+(goal.headingZ-e.pose.headingZ)*fraction,n=Math.hypot(hx,hz);
     const candidate={...e.pose,x:e.pose.x+(goal.x-e.pose.x)*fraction,z:e.pose.z+(goal.z-e.pose.z)*fraction,headingX:n>EPS?hx/n:goal.headingX,headingZ:n>EPS?hz/n:goal.headingZ};
     const a=body(e.pose),b=body(candidate),swept={minX:Math.min(a.minX,b.minX),maxX:Math.max(a.maxX,b.maxX),minZ:Math.min(a.minZ,b.minZ),maxZ:Math.max(a.maxZ,b.maxZ)};
     if(clear(candidate,id,swept)){e.pose=candidate;footprints.set(id,body(candidate));if(step>=length-EPS){e.pose={...goal};e.path.shift();}}else e.speed=0;
    }else e.speed=0;
    if(e.retiring&&!e.path.length){e.retiredFor+=slice;e.pose={...e.pose,scale:Math.max(.05,1-e.retiredFor/.3)};if(e.retiredFor>=.3){this.entries.delete(id);footprints.delete(id);this.removed++;this.lastRemoved.push(id);if(this.lastRemoved.length>32)this.lastRemoved.shift();}}
   }
  }
  this.shown=[...this.entries.values()].map(e=>({...e.pose,speed:e.speed}));return this.shown.map(p=>({...p}));
 }
 get diagnostics(){return {queuedWaypoints:[...this.entries.values()].reduce((n,e)=>n+e.path.length,0),renderedPoses:this.shown.map(p=>({...p})),selectedIds:[...this.entries.keys()],renderedIds:this.shown.map(p=>p.vehicleId),deferredIds:this.pending.map(p=>p.vehicleId),retiringIds:[...this.entries].filter(([,e])=>e.retiring).map(([id])=>id),admitted:this.admitted,removed:this.removed,lastRemoved:[...this.lastRemoved],busIntrusions:this.busIntrusions};}
}
