import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {instrumentMaxEvidenceLayer,instrumentMaxEvidenceSmoke} from '../scripts/diagnostic-max-evidence.mjs';
const layer=readFileSync(new URL('../src/traffic/layer.ts',import.meta.url),'utf8');
const smoke=readFileSync(new URL('./traffic-game-smoke.mjs',import.meta.url),'utf8');
test('max metadata keeps original clock reads, max math and reset ownership',()=>{
 const marked=instrumentMaxEvidenceLayer(layer);
 assert.equal((marked.match(/performance.now\(\)/g)||[]).length,(layer.match(/performance.now\(\)/g)||[]).length);
 assert.ok(marked.includes('this.diagnosticMaxima={};this.diagnosticEpoch++;'));
 assert.ok(marked.includes('diagnosticMaxima:{...this.diagnosticMaxima}'));
 for(const kind of ['Frame','Projection'])assert.ok(marked.includes(`this.timing.max${kind}Ms=Math.max(this.timing.max${kind}Ms,ms);`));
 assert.throws(()=>instrumentMaxEvidenceLayer(layer.replace(' private reset(city:City):void {',' private reset(city:City){')),/Unique max-evidence insertion/);
});
test('latest max captured before trace emission with exact original endpoints and counters',()=>{
 const marked=instrumentMaxEvidenceLayer(layer);
 for(const kind of ['Frame','Projection']){
  const count=kind==='Frame'?'frames':'projections';
  const line=marked.split('\n').find(x=>x.includes(`ms=diagnosticEnd-${kind==='Frame'?'frameStart':'start'},`));
  const snippet=line.slice(line.indexOf('const diagnosticEnd='),line.lastIndexOf('performance.mark'));
  const state={timing:{frames:4,projections:2,[`max${kind}Ms`]:1},latest:{step:7},paused:true,diagnosticMaxima:{},diagnosticLayerIdentity:3,diagnosticEpoch:2};
  let clockCalls=0;const perf={timeOrigin:1000,now(){clockCalls++;return 40;},measure(){assert.equal(state.diagnosticMaxima[kind.toLowerCase()].endMs,40);}};
  Function('performance','start','frameStart','frame','diagnosticSequence',snippet).call(state,perf,10,10,{step:7},8);
  assert.equal(clockCalls,1);assert.equal(state.timing[`max${kind}Ms`],30);
  const record=state.diagnosticMaxima[kind.toLowerCase()];assert.equal(record.startMs,10);assert.equal(record.endMs,40);assert.equal(record.instance,3);assert.equal(record.epoch,2);assert.equal(record.documentTimeOrigin,1000);assert.equal(record.detail.sequence,8);assert.equal(record.detail[count],state.timing[count]);
 }
});
test('same snapshot is persisted before unchanged acceptance assertion even when it fails',()=>{
 const generated=instrumentMaxEvidenceSmoke(smoke,'evidence.json');
 assert.deepEqual([...generated.matchAll(/assert\.[^\n]+/g)].map(x=>x[0]),[...smoke.matchAll(/assert\.[^\n]+/g)].map(x=>x[0]));
 assert.equal((generated.match(/await evaluate\(/g)||[]).length,(smoke.match(/await evaluate\(/g)||[]).length);
 const persistence=generated.split('\n').find(x=>x.startsWith(' try{saveDiagnosticMaxima('));
 const assertion=generated.split('\n').find(x=>x.startsWith(' if(blocked)assert.deepEqual(fallbackAssessment.issues'));
 assert.ok(generated.indexOf(persistence)<generated.indexOf(assertion));
 const writes=[];
 assert.throws(()=>runInNewContext(persistence+'\n'+assertion,{saveDiagnosticMaxima:(path,data)=>writes.push(JSON.parse(data)),stage:'sample',onBefore:{traffic:{diagnosticMaxima:{frame:{startMs:1,endMs:30}}}},onAfter:{traffic:{diagnosticMaxima:{frame:{startMs:1,endMs:30}}}},frameIntervals:{gameTiming:{after:{maxFrameMs:29}}},blocked:true,assert,fallbackAssessment:{issues:['over 8ms']}}));
 assert.equal(writes.length,1);assert.equal(writes[0].after.frame.endMs,30);
 assert.ok(generated.includes('},240_000)'));assert.ok(generated.includes('30000'));
});

test('evidence write failure does not suppress original assertion',()=>{
 const generated=instrumentMaxEvidenceSmoke(smoke,'evidence.json');
 const persistence=generated.split('\n').find(x=>x.startsWith(' try{saveDiagnosticMaxima('));
 const assertion=generated.split('\n').find(x=>x.startsWith(' if(blocked)assert.deepEqual(fallbackAssessment.issues'));
 let asserted=false;const context={saveDiagnosticMaxima(){throw Error('disk full');},console:{error(){}},diagnosticMaxEvidenceFailure:null,stage:'sample',onBefore:{},onAfter:{},frameIntervals:{gameTiming:{}},blocked:true,assert:{deepEqual(){asserted=true;throw Error('Original acceptance failure');}},fallbackAssessment:{issues:['over 8ms']}};
 assert.throws(()=>runInNewContext(persistence+'\n'+assertion,context),/Original acceptance failure/);assert.equal(asserted,true);assert.match(context.diagnosticMaxEvidenceFailure,/disk full/);
});
