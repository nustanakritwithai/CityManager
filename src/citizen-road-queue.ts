/** Deterministic cell/lane admission for real journeys. One call is one simulation
 * movement quantum, not a render frame. Queued vehicles are retained, never culled.
 * Conservative junction reservation trades throughput for non-overlap in V1.
 */
import { roadDriveAllowed, roadNeighbors, type RoadMap } from './road-topology.ts';
import { journeyRoute, moveJourneyVehicle, prepareJourneyFrame, type JourneyState } from './citizen-journey.ts';
export type LanePosition={cell:number;incoming:number;lane:number};
export type RoadQueueState={version:1;quantum:number;positions:Record<string,LanePosition>;waiting:Record<string,number>;blocked:Record<string,'road-closed'|'queue'|'junction'>};
export const createRoadQueue=():RoadQueueState=>({version:1,quantum:0,positions:{},waiting:{},blocked:{}});
const slot=(p:LanePosition)=>`${p.cell}:${p.incoming}:${p.lane}`;
const junction=(roads:RoadMap,cell:number)=>roadNeighbors(cell).filter(n=>roads.cells[n]?.road).length>2;
const axis=(delta:number)=>Math.abs(delta)===1?'x':'z';
/** No car can move more than one edge per quantum, even when queues clear. The
 * caller owns canonical clock pacing and must not call again for a redraw alone. */
export function advanceRoadQueue(journeys:JourneyState,queue:RoadQueueState,roads:RoadMap):{moved:number;waiting:number} {
 if(!Number.isSafeInteger(queue.quantum)||queue.quantum<0||queue.quantum>=Number.MAX_SAFE_INTEGER)throw new RangeError('Invalid road quantum');
 const frame=prepareJourneyFrame(journeys),moving=journeys.vehicles.filter(v=>v.status==='moving');
 const live=new Set(moving.map(v=>v.vehicleId));
 for(const id of Object.keys(queue.positions))if(!live.has(id))delete queue.positions[id];
 for(const id of Object.keys(queue.waiting))if(!live.has(id))delete queue.waiting[id];
 const occupied=new Map<string,string>(),byCell=new Map<number,Set<string>>();
 const insert=(id:string,p:LanePosition)=>{
   if(occupied.has(slot(p)))throw new Error('Overlapping traffic slots');occupied.set(slot(p),id);
   const ids=byCell.get(p.cell)??new Set<string>();ids.add(id);byCell.set(p.cell,ids);
 };
 const remove=(id:string,p:LanePosition)=>{occupied.delete(slot(p));byCell.get(p.cell)?.delete(id);};
 for(const [id,p] of Object.entries(queue.positions)) {
   const v=frame.vehicles.get(id)!;
   if(journeyRoute(v)[v.routeIndex]!==p.cell)throw new Error('Traffic and journey positions differ');
   insert(id,p);
 }
 queue.quantum++;queue.blocked={};const reservations=new Set<number>();let moved=0;
 moving.sort((a,b)=>(queue.waiting[b.vehicleId]??0)-(queue.waiting[a.vehicleId]??0)||a.vehicleId.localeCompare(b.vehicleId));
 for(const v of moving) {
   const id=v.vehicleId,route=journeyRoute(v),from=route[v.routeIndex],to=route[v.routeIndex+1];
   let reason:RoadQueueState['blocked'][string]|null=null;
   if(to===undefined||!roadDriveAllowed(roads,from,to))reason='road-closed';
   const delta=to-from;
   const junctions=[from,to].filter(cell=>junction(roads,cell));
   if(!reason&&junctions.some(cell=>reservations.has(cell)))reason='junction';
   // Occupants entering on a perpendicular axis cannot share the destination cell.
   if(!reason&&[...(byCell.get(to)??[])].some(other=>other!==id&&axis(queue.positions[other].incoming)!==axis(delta)))reason='queue';
   const capacity=roads.roadTopology?.oneWay[to]===delta?2:1;
   let target:LanePosition|undefined;
   if(!reason)for(let lane=0;lane<capacity;lane++) {
     const p={cell:to,incoming:delta,lane};if(!occupied.has(slot(p))){target=p;break;}
   }
   if(!reason&&!target)reason='queue';
   if(reason) {queue.blocked[id]=reason;queue.waiting[id]=(queue.waiting[id]??0)+1;continue;}
   // The admission above is the sole movement authority. No timeout permits overlap.
   if(!moveJourneyVehicle(journeys,id,()=>true,frame))throw new Error('Admitted vehicle failed to move');
   const old=queue.positions[id];if(old)remove(id,old);
   for(const cell of junctions)reservations.add(cell);
   if(v.status==='moving') {queue.positions[id]=target!;insert(id,target!);}else delete queue.positions[id];
   delete queue.waiting[id];moved++;
 }
 return {moved,waiting:Object.keys(queue.blocked).length};
}

/** Restore road occupancy together with, never independently from, its journeys.
 * A changed road may block a car; it must not erase it from the saved population.
 */
export function restoreRoadQueue(value:unknown,journeys:JourneyState):RoadQueueState {
 const q=value as RoadQueueState;
 if(!q||q.version!==1||!Number.isSafeInteger(q.quantum)||q.quantum<0||!q.positions||!q.waiting||!q.blocked||[q.positions,q.waiting,q.blocked].some(v=>typeof v!=='object'||Array.isArray(v)))throw new Error('Invalid road queue snapshot');
 const vehicles=new Map(journeys.vehicles.map(v=>[v.vehicleId,v])),slots=new Set<string>(),axes=new Map<number,string>();
 for(const [id,p] of Object.entries(q.positions)) {
   const v=vehicles.get(id);if(!v||v.status!=='moving'||!p||!Number.isSafeInteger(p.cell)||!Number.isSafeInteger(p.lane)||p.lane<0||p.lane>1||![1,-1,24,-24].includes(p.incoming)||v.routeIndex<1)throw new Error('Invalid saved lane position');
   const route=journeyRoute(v);
   if(p.cell!==route[v.routeIndex]||p.incoming!==route[v.routeIndex]-route[v.routeIndex-1]||slots.has(slot(p)))throw new Error('Saved lane collision or journey mismatch');
   if(axes.has(p.cell)&&axes.get(p.cell)!==axis(p.incoming))throw new Error('Crossing vehicles share a road cell');
   axes.set(p.cell,axis(p.incoming));slots.add(slot(p));
 }
 for(const v of journeys.vehicles)if(v.status==='moving'&&v.routeIndex>0&&!q.positions[v.vehicleId])throw new Error('Moving car missing road occupancy');
 for(const [id,wait] of Object.entries(q.waiting))if(vehicles.get(id)?.status!=='moving'||!Number.isSafeInteger(wait)||wait<0)throw new Error('Invalid saved queue age');
 for(const [id,reason] of Object.entries(q.blocked))if(vehicles.get(id)?.status!=='moving'||!['road-closed','queue','junction'].includes(reason))throw new Error('Invalid saved road block');
 return structuredClone(q);
}
