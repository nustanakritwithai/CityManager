// Diagnostic only: no publish, production data, budget changes, or retries.
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {readFile,writeFile,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const harness=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const workspace=resolve(harness,'..');
const files=['tests/traffic-game-smoke.mjs','tests/traffic-game-cases.mjs','tests/traffic-seeded-city-entry.mjs','tests/touch-reach.mjs'];
const run=(command,args,cwd,extra={})=>{const r=spawnSync(command,args,{cwd,stdio:'inherit',...extra});if(r.error)throw r.error;if(r.status!==0)throw Error(`${command} ${args.join(' ')} exited ${r.status}`);};
const git=(cwd,args)=>{const r=spawnSync('git',args,{cwd,encoding:'utf8'});if(r.status!==0)throw Error(r.stderr);return r.stdout.trim();};
const hash=data=>createHash('sha256').update(data).digest('hex');
const plan={order:['candidate','base'],retries:0,pins:{base:'74e51d89637c9cfccc70e5a93c427f9c41fea33f',candidate:'b6ce68152c98217363080ef85339d083b9ad228c'},artifact:'matched-traffic-candidate-base-all-results',previousRun:41135762599};
if(process.argv.includes('--preflight')){console.log(JSON.stringify(plan));process.exit(0);}
// Read-only process observations; never terminate browsers or unrelated processes.
const edgeSnapshot=cwd=>{
 if(process.platform!=='win32')return {available:false,reason:'Windows-only diagnostic'};
 const command=`$ErrorActionPreference='Stop'; $prefix=$env:DIAGNOSTIC_PROFILE_PREFIX.Replace('/','\\').ToLowerInvariant(); $rows=@(Get-CimInstance Win32_Process -Filter "Name = 'msedge.exe'" | ForEach-Object { [pscustomobject]@{ pid=$_.ProcessId; parentPid=$_.ParentProcessId; hasCommandLine=[bool]$_.CommandLine; ownedProfile=($_.CommandLine -and $_.CommandLine.Replace('/','\\').ToLowerInvariant().Contains($prefix)) } }); ConvertTo-Json -Compress -InputObject $rows`;
 const r=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{encoding:'utf8',timeout:10000,env:{...process.env,DIAGNOSTIC_PROFILE_PREFIX:resolve(cwd,'.test-output','traffic-game')}});
 if(r.error||r.status!==0)return {available:false,reason:String(r.error??r.stderr)};
 try{return {available:true,processes:JSON.parse(r.stdout||'[]')};}catch(error){return {available:false,reason:String(error)};}
};
const manifest={harnessSha:git(harness,['rev-parse','HEAD']),node:process.version,...plan,storageMode:'synthetic-recovery-idb-denied',note:'Diagnostic only. Each build retains all three OFF/ON pairs and unchanged absolute/relative gates. One predeclared reverse candidate-first run complements prior run41135762599; all prior results remain evidence. Ordering and machine differences still limit causality; not physical-device certification. Native IDB startup is outside this experiment.',harnessFiles:{},results:[]};
for(const file of files)manifest.harnessFiles[file]=hash(await readFile(resolve(harness,file)));
const persist=()=>writeFile(resolve(workspace,'matched-traffic-manifest.json'),JSON.stringify(manifest,null,2));
await persist();
for(const name of manifest.order){
 const cwd=resolve(workspace,name),expected=process.env[`${name.toUpperCase()}_SHA`];let preview;
 const result={name,expectedSha:expected,startedAt:new Date().toISOString(),status:'running'};manifest.results.push(result);await persist();
 try{
  assert.match(expected??'',/^[a-f0-9]{40}$/,'Only immutable application commits are accepted');
  assert.equal(expected,plan.pins[name],'Reverse diagnostic must use the original pinned application');
  result.actualSha=git(cwd,['rev-parse','HEAD']);assert.equal(result.actualSha,expected);
  assert.equal(git(cwd,['status','--porcelain']),'','Application checkout starts clean');
  for(const file of files)await copyFile(resolve(harness,file),resolve(cwd,file));
  // These imported fixture/measurement modules must be identical for both applications.
  result.measurementFiles={};
  for(const file of ['tests/traffic-game-peak-fixture.ts','tests/traffic-game-peak-metrics.mjs','tests/traffic-game-fallback-metrics.mjs','tests/population-capacity-fixture.ts']){
   const bytes=await readFile(resolve(cwd,file));assert.equal(hash(bytes),hash(await readFile(resolve(harness,file))),`${file} must match harness`);result.measurementFiles[file]=hash(bytes);
  }
  assert.equal(git(cwd,['diff','--name-only','--','src','index.html','package.json','package-lock.json','public']),'','No application changes permitted');
  run(process.platform==='win32'?'npm.cmd':'npm',['ci','--no-audit','--no-fund'],cwd,{shell:process.platform==='win32'});
  run(process.platform==='win32'?'npm.cmd':'npm',['run','build'],cwd,{shell:process.platform==='win32'});
  preview=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','4195','--strictPort'],{cwd,stdio:'inherit'});
  let ready=false;for(let i=0;i<40;i++){if(preview.exitCode!==null)throw Error('Preview exited before ready');try{ready=(await fetch('http://127.0.0.1:4195/CityManager/',{signal:AbortSignal.timeout(2000)})).status===200;}catch{}if(ready)break;await new Promise(r=>setTimeout(r,500));}assert.ok(ready,'Preview ready');
  result.edgeBefore=edgeSnapshot(cwd);await persist();
  run(process.execPath,['--experimental-strip-types','tests/traffic-game-smoke.mjs'],cwd,{timeout:270000});
  result.status='passed';
 }catch(error){result.status='failed';result.error=String(error);console.error(name,error);}
 finally{if(preview&&preview.exitCode===null){await new Promise(resolve=>{preview.once('exit',resolve);preview.kill();});}if(result.edgeBefore){
   result.edgeAfter=edgeSnapshot(cwd);
   await new Promise(resolve=>setTimeout(resolve,2000));
   result.edgeAfterGrace=edgeSnapshot(cwd);
   const before=new Set((result.edgeBefore.processes??[]).map(p=>p.pid));
   result.possibleResidualEdgePids=(result.edgeAfterGrace.processes??[]).filter(p=>p.ownedProfile||!before.has(p.pid)).map(p=>p.pid);
   result.cleanupObservation='Read-only PID snapshots, not proof all descendants exited. New or profile-matching residual PIDs are a possible comparison confounder, not permission to kill. Observation failure means cleanup unknown.';
  }result.finishedAt=new Date().toISOString();await persist();}
}
console.log(JSON.stringify(manifest,null,2));
if(manifest.results.some(r=>r.status!=='passed'))process.exitCode=1;
