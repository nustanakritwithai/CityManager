// Diagnostic-only overlay. Not used by production or the retained V3 runner.
import assert from 'node:assert/strict';
import {instrumentTrafficLayer} from './traffic-game-paired-diagnostic.mjs';
function once(source,from,to){assert.equal(source.split(from).length,2,`Unique max-evidence insertion: ${from}`);return source.replace(from,to);}
export function instrumentMaxEvidenceLayer(original){
 let source=instrumentTrafficLayer(original);
 source=once(source,'export class TrafficLayer {',`let diagnosticLayerIdentitySequence=0;
export class TrafficLayer {
 private readonly diagnosticLayerIdentity=++diagnosticLayerIdentitySequence;
 private diagnosticEpoch=0;
 private diagnosticMaxima:Record<string,unknown>={};`);
 source=once(source,' private reset(city:City):void {',' private reset(city:City):void {\n  this.diagnosticMaxima={};this.diagnosticEpoch++;');
 for(const [kind,start] of [['frame','frameStart'],['projection','start']]){
  const from=`if(ms>diagnosticPreviousMax)performance.measure('citymanager.traffic.${kind}.new-max',`;
  const begin=source.indexOf(from);assert.ok(begin>=0);
  const end=source.indexOf(');performance.mark(',begin);assert.ok(end>begin);
  const measure=source.slice(begin+from.indexOf('performance.measure'),end+2);
  // Mirror precisely the measure detail and original endpoints. No additional clock reads.
  const detail=measure.slice(measure.indexOf('detail:')+7,-3);
  assert.ok(detail.startsWith('{')&&detail.endsWith('}'));
  source=once(source,source.slice(begin,end+2),`if(ms>diagnosticPreviousMax){this.diagnosticMaxima.${kind}={documentTimeOrigin:performance.timeOrigin,instance:this.diagnosticLayerIdentity,epoch:this.diagnosticEpoch,startMs:${start},endMs:diagnosticEnd,detail:${detail}};${measure}}`);
 }
 source=once(source,'timing:{...this.timing}};}', 'timing:{...this.timing},diagnosticMaxima:{...this.diagnosticMaxima}};}');
 return source;
}
export function instrumentMaxEvidenceSmoke(source,output){
 source="import {writeFileSync as saveDiagnosticMaxima} from 'node:fs';\nlet diagnosticMaxEvidenceFailure=null;\n"+source;
 // Existing diag() response already contains traffic diagnostics. No new CDP round trip.
 const assertion=' if(blocked)assert.deepEqual(fallbackAssessment.issues,[],JSON.stringify({assessment:fallbackAssessment,gameTiming:frameIntervals.gameTiming}));';
 const persistence=` try{saveDiagnosticMaxima(${JSON.stringify(output)},JSON.stringify({stage,before:onBefore.traffic?.diagnosticMaxima??null,after:onAfter.traffic?.diagnosticMaxima??null,gameTiming:frameIntervals.gameTiming},null,2));}catch(error){diagnosticMaxEvidenceFailure=String(error);console.error('Diagnostic max evidence persistence failed:',diagnosticMaxEvidenceFailure); }\n`;
 return once(source,assertion,persistence+assertion);
}
