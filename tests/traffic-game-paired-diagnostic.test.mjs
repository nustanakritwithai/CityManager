import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {instrument,PLAN,BASELINE,HEAD,plannedResults,executePlan} from '../scripts/traffic-game-paired-diagnostic.mjs';
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
 assert.ok(generated.indexOf("await send('Tracing.start'")<generated.indexOf('let d;'));
 assert.ok(generated.includes("'trace.ndjson'"));assert.ok(generated.includes("'timing.ndjson'"));
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
