import {LANE_SLOTS,laneOffset,laneSlotCentres} from '../citizen-road-queue.ts';
import type {CitizenVehiclePose} from '../citizen-vehicle-poses.ts';
import type {GameCar,GameRenderGroup} from './game.ts';

/** Rendering is cosmetic: the game model still tracks at most 128 cars. */
export const GAME_VISUAL_CAR_CAP=64;
type Candidate={pose:CitizenVehiclePose;cell:number;link:string};
/** Sample across the whole city, not just the current viewport. Equal-turn
 * selection across fixed spatial sectors, then links within each sector, keeps
 * a distant low-ranked occupied area represented when the camera pans. The
 * 64-pose budget cannot show every link if more than 64 links are occupied. */
function spatialSample(candidates:readonly Candidate[],size:number,limit:number):CitizenVehiclePose[] {
 // Preserve the pre-cap output exactly when no sampling is needed.
 if(candidates.length<=limit)return candidates.map(c=>c.pose);
 const sectors=new Map<number,Map<string,CitizenVehiclePose[]>>();
 for(const c of candidates){const x=c.cell%size,y=Math.floor(c.cell/size),sx=Math.min(7,Math.floor(x*8/size)),sy=Math.min(7,Math.floor(y*8/size)),id=sy*8+sx;
  let links=sectors.get(id);if(!links){links=new Map();sectors.set(id,links);}const bucket=links.get(c.link)??[];bucket.push(c.pose);links.set(c.link,bucket);}
 const order=[...sectors].sort((a,b)=>a[0]-b[0]).map(([,links])=>({links:[...links].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([,poses])=>({poses,next:0})),cursor:0}));
 const out:CitizenVehiclePose[]=[];
 // First cover as many occupied links as the budget permits; only then draw
 // second cars on already represented links. Sector turns prevent geographic
 // rank order from monopolizing the cap when more than 64 links are occupied.
 for(const firstOnly of [true,false]){let progress=true;while(out.length<limit&&progress){progress=false;for(const sector of order){if(out.length>=limit)break;for(let i=0;i<sector.links.length;i++){const at=(sector.cursor+i)%sector.links.length,link=sector.links[at];if(link.next>=link.poses.length||(firstOnly&&link.next>0))continue;out.push(link.poses[link.next++]);sector.cursor=(at+1)%sector.links.length;progress=true;break;}}}}
 return out;
}
/** Capped representative positions derived only from occupied game-model links.
 * No rendered object feeds back into road capacity, demand, queues or city state.
 * The optional cap exists for equivalence tests, not to change model mass. */
export function gamePoses(cars:readonly GameCar[],groups:readonly GameRenderGroup[],size=24,unit=2,limit=GAME_VISUAL_CAR_CAP,includeTaxi=false):CitizenVehiclePose[] {
 if(!Number.isSafeInteger(limit)||limit<0||limit>128)throw Error('Invalid visual traffic cap');
 const fleet=includeTaxi?cars:cars.filter(c=>!(c as GameCar & {taxi?:boolean}).taxi);
 const byLink=new Map<string,GameCar[]>(),groupByKey=new Map(groups.map(g=>[g.key,g]));
 for(const car of fleet){const key=`${car.from}>${car.to}`;(byLink.get(key)??byLink.set(key,[]).get(key)!).push(car);}
 const result:Candidate[]=[];
 for(const [key,unsorted] of [...byLink].sort(([a],[b])=>a.localeCompare(b))){
  const g=groupByKey.get(key);if(!g||g.closed)continue;
  const lanes=Math.max(1,Math.min(2,Math.round(g.storage/4))),selected=[...unsorted].sort((a,b)=>a.id-b.id).slice(0,lanes*LANE_SLOTS);
  const ax=((g.from%size)-(size-1)/2)*unit,az=(Math.floor(g.from/size)-(size-1)/2)*unit;
  const bx=((g.to%size)-(size-1)/2)*unit,bz=(Math.floor(g.to/size)-(size-1)/2)*unit;
  const hx=Math.sign(bx-ax),hz=Math.sign(bz-az);
  for(let lane=0;lane<lanes;lane++){
   const people=selected.slice(lane*LANE_SLOTS,(lane+1)*LANE_SLOTS), slots=laneSlotCentres(people.length,people.some(c=>c.blocked)?1:.5);
   for(let i=0;i<people.length;i++){const c=people[i],s=slots[i],offset=laneOffset({cell:g.to,incoming:g.to-g.from,lane})*unit;
    result.push({cell:g.from,link:key,pose:{vehicleId:`game:${c.id}`,x:ax+(bx-ax)*s+hz*offset,z:az+(bz-az)*s-hx*offset,headingX:hx,headingZ:hz,paint:c.id%6}});}
  }
 }
 return spatialSample(result,size,limit);
}
/** A bounded cosmetic interpolation between model snapshots. Simulation itself
 * stays on its independent cadence; a paused game leaves the interpolation fixed. */
export function blendGamePoses(previous:readonly CitizenVehiclePose[],next:readonly CitizenVehiclePose[],phase:number):CitizenVehiclePose[] {
 const before=new Map(previous.map(p=>[p.vehicleId,p])),t=Math.max(0,Math.min(1,phase));
 return next.map(p=>{const old=before.get(p.vehicleId);if(!old)return p;return {...p,x:old.x+(p.x-old.x)*t,z:old.z+(p.z-old.z)*t,
  headingX:t<.5?old.headingX:p.headingX,headingZ:t<.5?old.headingZ:p.headingZ};});
}
