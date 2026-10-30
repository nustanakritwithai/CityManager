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
const manifest={harnessSha:git(harness,['rev-parse','HEAD']),node:process.version,order:['base','candidate'],retries:0,storageMode:'synthetic-recovery-idb-denied',note:'Diagnostic only. Each build retains all three OFF/ON pairs and unchanged absolute/relative gates. Fixed base-first ordering still has time/order effects; not physical-device certification. Native IDB startup is outside this experiment.',harnessFiles:{},results:[]};
for(const file of files)manifest.harnessFiles[file]=hash(await readFile(resolve(harness,file)));
const persist=()=>writeFile(resolve(workspace,'matched-traffic-manifest.json'),JSON.stringify(manifest,null,2));
await persist();
for(const name of manifest.order){
 const cwd=resolve(workspace,name),expected=process.env[`${name.toUpperCase()}_SHA`];let preview;
 const result={name,expectedSha:expected,startedAt:new Date().toISOString(),status:'running'};manifest.results.push(result);await persist();
 try{
  assert.match(expected??'',/^[a-f0-9]{40}$/,'Only immutable application commits are accepted');
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
  run(process.execPath,['--experimental-strip-types','tests/traffic-game-smoke.mjs'],cwd,{timeout:270000});
  result.status='passed';
 }catch(error){result.status='failed';result.error=String(error);console.error(name,error);}
 finally{if(preview&&preview.exitCode===null){await new Promise(resolve=>{preview.once('exit',resolve);preview.kill();});}result.finishedAt=new Date().toISOString();await persist();}
}
console.log(JSON.stringify(manifest,null,2));
if(manifest.results.some(r=>r.status!=='passed'))process.exitCode=1;
