/** Renderer-neutral, uncapped snapshot of physically admitted road vehicles.
 * Cars waiting for road space remain in the garage queue, not hidden road actors.
 */
import {type JourneyState} from './citizen-journey.ts';
import {type RoadQueueState} from './citizen-road-queue.ts';
export type CitizenVehiclePose={vehicleId:string;passengerIds:string[];x:number;z:number;headingX:number;headingZ:number;paint:number};
const paint=(s:string)=>{let n=0;for(const c of s)n=(Math.imul(n,31)+c.charCodeAt(0))|0;return (n>>>0)%6;};
export function citizenVehiclePoses(journeys:JourneyState,queue:RoadQueueState):CitizenVehiclePose[] {
 const vehicles=new Map(journeys.vehicles.map(v=>[v.vehicleId,v]));
 return Object.entries(queue.positions).sort(([a],[b])=>a.localeCompare(b)).map(([vehicleId,p])=>{
   const v=vehicles.get(vehicleId);if(!v||v.status!=='moving')throw new Error('Render pose has no real moving vehicle');
   const hx=Math.abs(p.incoming)===1?Math.sign(p.incoming):0,hz=Math.abs(p.incoming)===24?Math.sign(p.incoming):0;
   const offset=p.lane===0?.36:-.36;
   return {vehicleId,passengerIds:[...v.occupants],x:(p.cell%24-11.5)*2+hz*offset,z:(Math.floor(p.cell/24)-11.5)*2-hx*offset,headingX:hx,headingZ:hz,paint:paint(vehicleId)};
 });
}
/** World matrix for the low-poly car, whose long axis is local +Z. */
export function writeVehicleMatrix(target:Float32Array,offset:number,pose:CitizenVehiclePose):void {
 const x=pose.headingX,z=pose.headingZ;
 target.set([z,0,-x,0, 0,1,0,0, x,0,z,0, pose.x,.14,pose.z,1],offset);
}
