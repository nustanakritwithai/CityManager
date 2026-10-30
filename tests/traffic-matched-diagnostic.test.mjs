import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,mkdir,copyFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..'),script=resolve(root,'scripts/traffic-matched-diagnostic.mjs');
test('reverse protocol is immutable, explicit, and retains original experiment',()=>{
 const r=spawnSync(process.execPath,[script,'--preflight'],{encoding:'utf8'});assert.equal(r.status,0);
 const p=JSON.parse(r.stdout);assert.deepEqual(p.order,['candidate','base']);assert.equal(p.retries,0);assert.equal(p.previousRun,41135762599);
 assert.deepEqual(p.pins,{base:'74e51d89637c9cfccc70e5a93c427f9c41fea33f',candidate:'b6ce68152c98217363080ef85339d083b9ad228c'});
 assert.equal(p.artifact,'matched-traffic-candidate-base-all-results');
});
test('invalid pins fail both applications in reverse order, preserving failures without app execution',async()=>{
 const dir=await mkdtemp(resolve(tmpdir(),'cm-reverse-plan-test-')),h=resolve(dir,'harness');
 try{
  await mkdir(resolve(h,'scripts'),{recursive:true});await mkdir(resolve(h,'tests'));
  await copyFile(script,resolve(h,'scripts/traffic-matched-diagnostic.mjs'));
  for(const name of ['traffic-game-smoke.mjs','traffic-game-cases.mjs','traffic-seeded-city-entry.mjs','touch-reach.mjs'])await copyFile(resolve(root,'tests',name),resolve(h,'tests',name));
  for(const args of [['init','-q'],['-c','user.name=diagnostic-test','-c','user.email=test@example.invalid','commit','--allow-empty','-qm','fixture']])assert.equal(spawnSync('git',args,{cwd:h,encoding:'utf8'}).status,0);
  const r=spawnSync(process.execPath,[resolve(h,'scripts/traffic-matched-diagnostic.mjs')],{env:{...process.env,BASE_SHA:'invalid',CANDIDATE_SHA:'a'.repeat(40)},encoding:'utf8'});
  assert.equal(r.status,1);const m=JSON.parse(await readFile(resolve(dir,'matched-traffic-manifest.json'),'utf8'));
  assert.deepEqual(m.results.map(x=>x.name),['candidate','base']);assert.ok(m.results.every(x=>x.status==='failed'));
  assert.match(m.results[0].error,/original pinned application/);assert.match(m.results[1].error,/immutable application commits/);
  assert.ok(m.results.every(x=>!x.actualSha&&!x.edgeBefore));
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('process observer is read-only; benchmark and application code remain unchanged',async()=>{
 const source=await readFile(script,'utf8'),observer=source.slice(source.indexOf('const edgeSnapshot='),source.indexOf('const manifest='));
 assert.match(observer,/Get-CimInstance Win32_Process/);assert.doesNotMatch(observer,/Stop-Process|taskkill|Terminate\(|\.kill\(/);
 assert.match(source,/timeout:270000/);assert.match(source,/possibleResidualEdgePids/);assert.match(source,/Observation failure means cleanup unknown/);
 const smoke=await readFile(resolve(root,'tests/traffic-game-smoke.mjs'),'utf8');assert.match(smoke,/240_000/);assert.match(smoke,/pairCount:3/);assert.match(smoke,/perPairOnP95StrictlyBelowMs:100/);
});
