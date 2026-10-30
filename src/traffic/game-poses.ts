import {LANE_SLOTS,laneOffset,laneSlotCentres} from '../citizen-road-queue.ts';
import type {CitizenVehiclePose} from '../citizen-vehicle-poses.ts';
import type {GameCar,GameRenderGroup} from './game.ts';

/** Capped representative positions derived from actual game-model link occupants.
 * No rendered object feeds back into road capacity, demand or city state. */
export function gamePoses(cars:readonly GameCar[],groups:readonly GameRenderGroup[],size=24,unit=2):CitizenVehiclePose[] {
 const byLink=new Map<string,GameCar[]>(),groupByKey=new Map(groups.map(g=>[g.key,g]));
 for(const car of cars){const key=`${car.from}>${car.to}`;(byLink.get(key)??byLink.set(key,[]).get(key)!).push(car);}
 const result:CitizenVehiclePose[]=[];
 for(const [key,unsorted] of [...byLink].sort(([a],[b])=>a.localeCompare(b))){
  const g=groupByKey.get(key);if(!g||g.closed)continue;
  const lanes=Math.max(1,Math.min(2,Math.round(g.storage/4))),selected=[...unsorted].sort((a,b)=>a.id-b.id).slice(0,lanes*LANE_SLOTS);
  const ax=((g.from%size)-(size-1)/2)*unit,az=(Math.floor(g.from/size)-(size-1)/2)*unit;
  const bx=((g.to%size)-(size-1)/2)*unit,bz=(Math.floor(g.to/size)-(size-1)/2)*unit;
  const hx=Math.sign(bx-ax),hz=Math.sign(bz-az);
  for(let lane=0;lane<lanes;lane++){
   const people=selected.slice(lane*LANE_SLOTS,(lane+1)*LANE_SLOTS), slots=laneSlotCentres(people.length,people.some(c=>c.blocked)?1:.5);
   for(let i=0;i<people.length;i++){const c=people[i],s=slots[i],offset=laneOffset({cell:g.to,incoming:g.to-g.from,lane})*unit;
    result.push({vehicleId:`game:${c.id}`,x:ax+(bx-ax)*s+hz*offset,z:az+(bz-az)*s-hx*offset,headingX:hx,headingZ:hz,paint:c.id%6});}
  }
 }
 return result;
}
/** A bounded cosmetic interpolation between model snapshots. Simulation itself
 * stays on its independent cadence; a paused game leaves the interpolation fixed. */
export function blendGamePoses(previous:readonly CitizenVehiclePose[],next:readonly CitizenVehiclePose[],phase:number):CitizenVehiclePose[] {
 const before=new Map(previous.map(p=>[p.vehicleId,p])),t=Math.max(0,Math.min(1,phase));
 return next.map(p=>{const old=before.get(p.vehicleId);if(!old)return p;return {...p,x:old.x+(p.x-old.x)*t,z:old.z+(p.z-old.z)*t,
  headingX:t<.5?old.headingX:p.headingX,headingZ:t<.5?old.headingZ:p.headingZ};});
}
