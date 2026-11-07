import {test} from 'node:test';
import {runInNewContext} from 'node:vm';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {instrument,PLAN,BASELINE,HEAD,plannedResults,executePlan,diagnosticSucceeded,instrumentTrafficLayer} from '../scripts/traffic-game-paired-diagnostic.mjs';
const source=readFileSync(new URL('./traffic-game-smoke.mjs',import.meta.url),'utf8');
test('exactly three predeclared pairs, no replacement outcomes',()=>{
 assert.deepEqual(PLAN,['baseline','head','head','baseline','baseline','head']);
 for(let i=0;i<6;i+=2)assert.deepEqual(PLAN.slice(i,i+2).sort(),['baseline','head']);
 for(const sha of [BASELINE,HEAD])assert.match(sha,/^[0-9a-f]{40}$/);
});
test('instrumentation preserves every assertion and starts tracing before navigation',()=>{
 const generated=instrument(source,'C:/canonical.json','C:/evidence');
 // Every original assertion remains in exactly the original sequence.
 assert.deepEqual([...generated.matchAll(/assert\.(?:ok|equal|deepEqual|notEqual)\([^\n;]+/g)].map(x=>x[0]).filter(x=>!x.includes('Canonical fixture round trip')),[...source.matchAll(/assert\.(?:ok|equal|deepEqual|notEqual)\([^\n;]+/g)].map(x=>x[0]));
 assert.ok(generated.includes("setStage('mobile dense ON setup');await diagnosticStartTrace();d=await navigate"));
 assert.ok(!generated.includes('Tracing.dataCollected'));assert.ok(!generated.includes('ReportEvents'));assert.ok(!generated.includes('cpu_profiler'));assert.ok(!generated.includes('appendFileSync'));
 assert.ok(generated.includes("transferMode:'ReturnAsStream'"));assert.ok(generated.includes("categories:'devtools.timeline,blink.user_timing'"));
 assert.ok(generated.includes("try{await diagnosticDrainTrace();await send('Browser.close');}"));
 const file=resolve(mkdtempSync(resolve(tmpdir(),'paired-contract-')),'generated.mjs');writeFileSync(file,generated);
 const checked=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});assert.equal(checked.status,0,checked.stderr);
});
test('source drift fails closed',()=>{assert.throws(()=>instrument(source.replace('lastDiagnosticAt=Date.now();return lastDiagnostic;','return lastDiagnostic;'),'fixture','output'),/Unique diagnostic insertion/);});

test('all six slots exist before setup and failed assertions never select replacements',async()=>{
 const results=plannedResults();assert.equal(results.length,6);assert.ok(results.every(r=>r.outcome==='not-run'));
 const calls=[];await executePlan(results,async entry=>{calls.push(entry.trial);return {status:entry.trial===2?1:0,outcome:entry.trial===2?'failed':'passed',safeToContinue:true};},()=>{});
 assert.deepEqual(calls,[1,2,3,4,5,6]);assert.equal(results[1].outcome,'failed');assert.equal(results.length,6);
});
test('occupied port or unexpected setup error records failure and remaining skipped slots',async()=>{
 const results=plannedResults();let calls=0;await executePlan(results,async()=>{calls++;throw Error('Dedicated port occupied');},()=>{});
 assert.equal(calls,1);assert.equal(results[0].outcome,'setup-failed');assert.match(results[0].error,/occupied/);
 assert.ok(results.slice(1).every(r=>r.outcome==='skipped'&&r.status===null));
});
test('uncertain timeout cleanup stops instead of contaminating later pairs',async()=>{
 const results=plannedResults();const calls=[];await executePlan(results,async entry=>{calls.push(entry.trial);return entry.trial===3?{status:null,outcome:'timeout',safeToContinue:false}:{status:0,outcome:'passed',safeToContinue:true};},()=>{});
 assert.deepEqual(calls,[1,2,3]);assert.equal(results[2].outcome,'timeout');assert.ok(results.slice(3).every(r=>r.outcome==='skipped'));
});
test('watchdog unchanged; best-effort flush is earlier and workflow is narrow push only',()=>{
 const generated=instrument(source,'fixture','evidence');assert.ok(generated.includes('},240_000)'));assert.ok(generated.includes('},225_000)'));
 assert.ok(generated.includes("'taskkill.exe',['/PID',String(child.pid),'/T','/F']"));
 const workflow=readFileSync(new URL('../.github/workflows/traffic-paired-diagnostic.yml',import.meta.url),'utf8');
 assert.ok(!workflow.includes('workflow_dispatch'));assert.ok(!workflow.includes('pull_request:'));assert.ok(workflow.includes("branches: ['diagnostic/housing-ci-timing']"));
});

test('stream reads occur only during explicit post-result drain, with EOF attestation',async()=>{
 const generated=instrument(source,'fixture','output');const prefix=generated.slice(0,generated.indexOf('import {readFileSync as diagnosticRead')).replace(/^import .*;\n/,'');
 const calls=[],writes=[];let context;
 context={Buffer,Date,setTimeout,clearTimeout,ws:{readyState:1},sleep:async()=>{},diagnosticWrite:(path,data)=>writes.push([path,data]),diagnosticAppend:async(path,data)=>writes.push([path,String(data)]),send:async(method,params)=>{
  calls.push(method);if(method==='Tracing.end')runInNewContext('diagnosticTraceEvent={stream:"owned-stream"};',context);
  if(method==='IO.read')return {data:'{"traceEvents":[]}',eof:true};return {};
 }};
 await runInNewContext(prefix+'diagnosticStartTrace();',context);
 assert.deepEqual(calls,['Tracing.start']);assert.equal(writes.length,0);
 await runInNewContext('diagnosticDrainTrace();',context);
 assert.deepEqual(calls,['Tracing.start','Tracing.end','IO.read','IO.close']);assert.ok(writes.some(([path])=>path.endsWith('trace-complete.json')));
});
test('no ON start means no trace commands or invented complete stream',async()=>{
 const generated=instrument(source,'fixture','output');const prefix=generated.slice(0,generated.indexOf('import {readFileSync as diagnosticRead')).replace(/^import .*;\n/,'');
 const writes=[];await runInNewContext(prefix+'diagnosticDrainTrace();',{Date,diagnosticWrite:(path,data)=>writes.push([path,data]),send:()=>{throw Error('No CDP expected');}});
 assert.ok(!writes.some(([path])=>path.endsWith('trace-complete.json')));assert.ok(writes.some(([,data])=>data.includes('Traffic ON navigation was never reached')));
});

test('stream failure or browser data loss never receives complete attestation',async()=>{
 for(const failure of ['read-error','data-loss']){
  const generated=instrument(source,'fixture','output');const prefix=generated.slice(0,generated.indexOf('import {readFileSync as diagnosticRead')).replace(/^import .*;\n/,'');
  const writes=[];let context;context={Buffer,Date,setTimeout,clearTimeout,ws:{readyState:1},sleep:async()=>{},diagnosticWrite:(path,data)=>writes.push([path,data]),diagnosticAppend:async()=>{},send:async method=>{
   if(method==='Tracing.end')runInNewContext(`diagnosticTraceEvent={stream:'owned-stream'};diagnosticTraceState.dataLossOccurred=${failure==='data-loss'};`,context);
   if(method==='IO.read'){if(failure==='read-error')throw Error('read failed');return {data:'{}',eof:true};}return {};
  }};
  await runInNewContext(prefix+'(async()=>{await diagnosticStartTrace();await diagnosticDrainTrace();})()',context);
  assert.ok(!writes.some(([path])=>path.endsWith('trace-complete.json')));assert.ok(writes.some(([path,data])=>path.endsWith('trace-status.json')&&data.includes('incompleteReason')));
 }
});

test('diagnostic success additionally requires six complete traces without replacing acceptance status',()=>{
 const results=plannedResults().map(r=>({...r,status:0,outcome:'passed',traceComplete:true}));
 assert.equal(diagnosticSucceeded(results),true);results[2].traceComplete=false;assert.equal(diagnosticSucceeded(results),false);assert.equal(results[2].status,0);
 results[2].traceComplete=true;results[3].status=1;assert.equal(diagnosticSucceeded(results),false);assert.equal(diagnosticSucceeded(results.slice(0,5)),false);
});

test('layer overlay keeps clock count, original max/counter math and fails closed on drift',()=>{
 const layer=readFileSync(new URL('../src/traffic/layer.ts',import.meta.url),'utf8'),overlaid=instrumentTrafficLayer(layer);
 assert.equal((overlaid.match(/performance.now\(\)/g)||[]).length,(layer.match(/performance.now\(\)/g)||[]).length);
 for(const kind of ['Frame','Projection'])assert.ok(overlaid.includes(`this.timing.max${kind}Ms=Math.max(this.timing.max${kind}Ms,ms);`));
 assert.throws(()=>instrumentTrafficLayer(layer.replace('const ms=performance.now()-frameStart;','const ms=0;')),/Unique diagnostic insertion/);
 assert.equal((overlaid.match(/performance.measure\(/g)||[]).length,2);
});
test('retrospective marks exclude their own cost and do not change timing/counters',()=>{
 const layer=instrumentTrafficLayer(readFileSync(new URL('../src/traffic/layer.ts',import.meta.url),'utf8'));
 for(const kind of ['Frame','Projection']){
  const count=kind==='Frame'?'frames':'projections';
  const snippet=layer.match(new RegExp(`const diagnosticEnd=performance.now\\(\\),ms=diagnosticEnd-[^;]+;this.timing.${count}[^\n]+?performance.measure[^\n]+?;`))[0];
  const state={timing:{frames:0,projections:0,[`max${kind}Ms`]:1},latest:{step:7},paused:true};let clocks=0,now=40;const marks=[];
  const perf={now:()=>{clocks++;return now;},measure:(name,options)=>{marks.push({name,...options});now+=1000;}};
  const invoke=Function('performance','start','frameStart','frame','diagnosticSequence',snippet);
  invoke.call(state,perf,10,10,{step:7},1);
  assert.equal(clocks,1);assert.equal(state.timing[`last${kind}Ms`],30);assert.equal(state.timing[`max${kind}Ms`],30);assert.equal(state.timing[count],1);
  assert.equal(marks[0].start,10);assert.equal(marks[0].end,40);assert.equal(marks[0].detail.durationMs,30);assert.equal(marks[0].detail.workerStep,7);
  now=40;invoke.call(state,perf,10,10,{step:8},2);assert.equal(marks.length,1,'Equal maximum is not marked again');assert.equal(state.timing[count],2);
 }
});

test('sequence marks bracket original timed intervals without adding clock reads',()=>{
 const layer=instrumentTrafficLayer(readFileSync(new URL('../src/traffic/layer.ts',import.meta.url),'utf8'));
 assert.ok(layer.includes("performance.mark('citymanager.traffic.frame.begin',{detail:{sequence:diagnosticSequence}});const frameStart=performance.now();"));
 assert.ok(layer.includes("performance.mark('citymanager.traffic.projection.begin',{detail:{sequence:diagnosticSequence}});const start=performance.now();"));
 for(const kind of ['frame','projection']){
  assert.ok(layer.includes(`performance.mark('citymanager.traffic.${kind}.end',{detail:{sequence:diagnosticSequence,durationMs:ms`));
  assert.ok(layer.indexOf(`performance.measure('citymanager.traffic.${kind}.new-max'`)<layer.indexOf(`performance.mark('citymanager.traffic.${kind}.end'`));
 }
 assert.ok(layer.includes('++this.diagnosticFrameSequence'));assert.ok(layer.includes('++this.diagnosticProjectionSequence'));
});
