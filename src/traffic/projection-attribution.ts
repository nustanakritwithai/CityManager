/** Diagnostic-only: one maximum among callbacks reaching the original end timestamp.
 * Uncaught callback failures are NOT timed as completed projections. Existing inner
 * bus/rail failure handling still reaches that timestamp and is explicitly flagged.
 * Probes add measured overhead; fixed context and retained snapshot allocations
 * happen after the original end and are NOT measured. No zero-overhead claim.
 * No identifiers, City values, messages, poses or save payloads are retained. */
export const PROJECTION_STAGES=['expiry','retired','filter','signalAccept','signalSync','bus','rail','caughtFailure','poses','presenter'] as const;
export type ProjectionStage=typeof PROJECTION_STAGES[number];
export type ProjectionContext={projectionIndex:number;signalHeadCount:number;paused:boolean;failed:boolean;busPresent:boolean;railPresent:boolean;inputCars:number;filteredCars:number;expiredCount:number;workTripCount:number};
export type WorstProjection={totalMs:number;stages:Record<ProjectionStage,number>;context:ProjectionContext};
export class ProjectionAttribution {
 private values=new Float64Array(PROJECTION_STAGES.length);private stage:ProjectionStage='expiry';private boundary=0;
 private worst:WorstProjection|null=null;
 resetEpoch():void {this.worst=null;}
 begin(start:number):void {this.values.fill(0);this.stage='expiry';this.boundary=start;}
 next(stage:ProjectionStage,now:number):void {this.values[PROJECTION_STAGES.indexOf(this.stage)]+=now-this.boundary;this.boundary=now;this.stage=stage;}
 finish(end:number,totalMs:number,context:ProjectionContext):void {
  this.values[PROJECTION_STAGES.indexOf(this.stage)]+=end-this.boundary;
  if(this.worst!==null&&totalMs<=this.worst.totalMs)return;
  this.worst={totalMs,stages:Object.fromEntries(PROJECTION_STAGES.map((stage,i)=>[stage,this.values[i]])) as Record<ProjectionStage,number>,context:{...context}};
 }
 snapshot():WorstProjection|null {return this.worst?{totalMs:this.worst.totalMs,stages:{...this.worst.stages},context:{...this.worst.context}}:null;}
}
