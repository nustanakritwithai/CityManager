import {SIGNAL_CLEARANCE,SIGNAL_MAX_GREEN,SIGNAL_URGENT_WAIT} from './adaptive-signals.ts';
import {TRAFFIC_SPACING} from './spacing.ts';

/** Allow a four-approach maximum-green cycle plus the urgent-wait allowance.
 * Values in adaptive-signals are worker substeps; the presenter runs in seconds. */
export const WORK_STALL_GRACE_SECONDS=(4*(SIGNAL_MAX_GREEN+SIGNAL_CLEARANCE)+SIGNAL_URGENT_WAIT)/5;
/** Reset only after a whole car length of actual route progress, not jitter. */
export const WORK_PROGRESS_DISTANCE=TRAFFIC_SPACING.lengths.sedan;
type Observation={anchor:number;stalledSeconds:number};
export class WorkStallTracker {
 private entries=new Map<number,Observation>();
 observe(id:number,distance:number|null,blocked:boolean,dt:number):boolean {
  if(!Number.isFinite(dt)||dt<0||distance!==null&&(!Number.isFinite(distance)||distance<0))throw Error('Invalid work stall observation');
  let state=this.entries.get(id);
  if(!state){state={anchor:distance??0,stalledSeconds:0};this.entries.set(id,state);}
  if(distance!==null&&distance-state.anchor>=WORK_PROGRESS_DISTANCE){state.anchor=distance;state.stalledSeconds=0;}
  state.stalledSeconds+=Math.min(dt,.25);
  return blocked&&state.stalledSeconds>=WORK_STALL_GRACE_SECONDS;
 }
 retain(ids:ReadonlySet<number>):void {for(const id of this.entries.keys())if(!ids.has(id))this.entries.delete(id);}
}
