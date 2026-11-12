/** Ephemeral attribution, not a new performance gate. Keep only one epoch maximum.
 * Boundaries use the existing frame clock; accounting/snapshot cost is not subtracted.
 * Boundary probes add overhead inside the original measured interval. finish()
 * runs after its existing end timestamp: context/snapshot allocation is bounded
 * but NOT included in totalMs, and no zero-overhead claim is made.
 * No identifiers, poses, messages, City values or save payloads are retained. */
export const FRAME_STAGES=['clockReset','schedule','bus','submit','presentation','reconcile','sceneSync','failure'] as const;
export type FrameStage=typeof FRAME_STAGES[number];
export type FrameContext={cityChanged:boolean;paused:boolean;advance:boolean;dirtyAtEntry:boolean;visible:boolean;failed:boolean;busPresent:boolean;presented:boolean;reconciled:boolean;drawnCount:number};
export type WorstFrame={totalMs:number;stages:Record<FrameStage,number>;context:FrameContext};
export class FrameAttribution {
 private values=new Float64Array(FRAME_STAGES.length);private stage:FrameStage='clockReset';private boundary=0;
 private worst:WorstFrame|null=null;
 /** Clearing epoch history must not discard a frame already entering reset(). */
 resetEpoch():void {this.worst=null;}
 begin(start:number):void {this.values.fill(0);this.stage='clockReset';this.boundary=start;}
 next(stage:FrameStage,now:number):void {this.values[FRAME_STAGES.indexOf(this.stage)]+=now-this.boundary;this.boundary=now;this.stage=stage;}
 finish(end:number,totalMs:number,context:FrameContext):void {
  this.values[FRAME_STAGES.indexOf(this.stage)]+=end-this.boundary;
  if(this.worst!==null&&totalMs<=this.worst.totalMs)return;
  this.worst={totalMs,stages:Object.fromEntries(FRAME_STAGES.map((stage,i)=>[stage,this.values[i]])) as Record<FrameStage,number>,context:{...context}};
 }
 snapshot():WorstFrame|null {return this.worst?{totalMs:this.worst.totalMs,stages:{...this.worst.stages},context:{...this.worst.context}}:null;}
}
