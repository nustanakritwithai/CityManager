// Diagnostic only. Immutable applications; unchanged peak harness and gates.
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {readFile,writeFile,cp,copyFile,readdir,mkdir} from 'node:fs/promises';
import {resolve,dirname,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
export const protocol=Object.freeze({order:['base','candidate'],pins:{base:'e65eb66ea35522bc7fb92caea65f60a34127a050',candidate:'88bf31ef293c829752d5765f39cf8797fed214f4'},pairsPerApplication:3,retries:0,case:'peak',artifact:'pr181-matched-peak-base-candidate'});
const hash=b=>createHash('sha256').update(b).digest('hex');
const git=(cwd,args)=>{const r=spawnSync('git',args,{cwd,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
async function hashes(root,sub){const result={};async function visit(path){for(const e of await readdir(path,{withFileTypes:true})){const p=resolve(path,e.name);if(e.isDirectory())await visit(p);else if(e.isFile())result[relative(root,p).replaceAll('\\','/')]=hash(await readFile(p));else throw Error('Unexpected non-file in pinned fixture tree');}}await visit(resolve(root,sub));return result;}
const env={...process.env,TRAFFIC_GAME_EXPECT_DEFAULT:'1',TRAFFIC_GAME_CASE:'peak',CITYMANAGER_BLOCK_MODELS:'0',CITYMANAGER_SOFTWARE_WEBGL:'0',VITE_MARKET_URL:'',VITE_CITY_ADVISOR_ONLINE:'false',VITE_CITY_ENTITY_ADVISOR_ONLINE:'false',VITE_CITY_OWNER_ADVISOR_ONLINE:'false'};
const run=(cmd,args,cwd,timeout=300000)=>{const r=spawnSync(cmd,args,{cwd,env,stdio:'inherit',timeout,shell:process.platform==='win32'&&cmd.endsWith('.cmd')});if(r.error)throw r.error;return r.status;};
const observe=()=>{const r=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`$ErrorActionPreference='Stop'; $rows=@(Get-CimInstance Win32_Process -Filter "Name = 'msedge.exe'" | ForEach-Object { [pscustomobject]@{pid=$_.ProcessId;parentPid=$_.ParentProcessId} }); ConvertTo-Json -Compress -InputObject $rows`],{encoding:'utf8',timeout:10000});if(r.error||r.status!==0)return {available:false};try{return {available:true,processes:JSON.parse(r.stdout||'[]')};}catch{return {available:false};}};
const systemInfo=()=>{const r=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`$ErrorActionPreference='Stop'; $os=Get-CimInstance Win32_OperatingSystem; $edge=(Get-Item 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe').VersionInfo.ProductVersion; [pscustomobject]@{windows=$os.Caption;build=$os.BuildNumber;edge=$edge;cpuCount=$env:NUMBER_OF_PROCESSORS}|ConvertTo-Json -Compress`],{encoding:'utf8',timeout:10000});if(r.error||r.status!==0)return {available:false};try{return {available:true,...JSON.parse(r.stdout)};}catch{return {available:false};}};
export const evidenceFile=name=>name==='report.json'||name==='failure.json'||/^[^/\\]+\.png$/.test(name);
export function requireTerminalEvidence(passed,files){assert.ok(Object.hasOwn(files,passed?'report.json':'failure.json'),'Required terminal report/failure evidence missing');}
export function residual(before,after){if(!before.available||!after.available)return {known:false,pids:[]};const ids=new Set(before.processes.map(p=>p.pid));return {known:true,pids:after.processes.filter(p=>!ids.has(p.pid)).map(p=>p.pid)};}
async function main(){
 const diagnostic=resolve(dirname(fileURLToPath(import.meta.url)),'..'),workspace=resolve(diagnostic,'..'),out=resolve(workspace,'matched-peak-evidence');await mkdir(out,{recursive:true});
 const manifest={...protocol,diagnosticSha:git(diagnostic,['rev-parse','HEAD']),node:process.version,platform:process.platform,system:systemInfo(),env:Object.fromEntries(['TRAFFIC_GAME_EXPECT_DEFAULT','TRAFFIC_GAME_CASE','CITYMANAGER_BLOCK_MODELS','CITYMANAGER_SOFTWARE_WEBGL','VITE_MARKET_URL','VITE_CITY_ADVISOR_ONLINE','VITE_CITY_ENTITY_ADVISOR_ONLINE','VITE_CITY_OWNER_ADVISOR_ONLINE'].map(k=>[k,env[k]])),results:[],note:'Fixed base-first order is a confounder. All six original OFF/ON pairs retained, no retries or threshold waiver. Native CI emulation is not physical-device certification.'};
 const save=()=>writeFile(resolve(out,'manifest.json'),JSON.stringify(manifest,null,2));await save();
 const candidate=resolve(workspace,'candidate');assert.equal(git(candidate,['rev-parse','HEAD']),protocol.pins.candidate);const harnessHashes=await hashes(candidate,'tests');manifest.harnessHashes=harnessHashes;
 for(const name of protocol.order){const cwd=resolve(workspace,name),r={name,expectedSha:protocol.pins[name],status:'preparing',startedAt:new Date().toISOString()};manifest.results.push(r);let preview;await save();
  try{r.sha=git(cwd,['rev-parse','HEAD']);assert.equal(r.sha,r.expectedSha);assert.equal(git(cwd,['status','--porcelain']),'');r.tree=git(cwd,['rev-parse','HEAD^{tree}']);
   if(name==='base')await cp(resolve(candidate,'tests'),resolve(cwd,'tests'),{recursive:true});
   assert.deepEqual(await hashes(cwd,'tests'),harnessHashes,'Exact same native HTTP peak harness/fixtures/metrics');
   assert.equal(git(cwd,['diff','--name-only','--','src','index.html','package.json','package-lock.json','public']),'','Application source unchanged');r.sourceHashes=await hashes(cwd,'src');
   assert.equal(run('npm.cmd',['ci','--no-audit','--no-fund'],cwd),0,'dependency install');assert.equal(run('npm.cmd',['run','build'],cwd),0,'pinned build');r.buildHashes=await hashes(cwd,'dist');
   preview=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','4195','--strictPort'],{cwd,env,stdio:'inherit'});
   let ready=false;for(let i=0;i<40;i++){assert.equal(preview.exitCode,null);try{ready=(await fetch('http://127.0.0.1:4195/CityManager/',{signal:AbortSignal.timeout(2000)})).status===200;}catch{}if(ready)break;await new Promise(r=>setTimeout(r,500));}assert.ok(ready,'preview ready');
   r.edgeBefore=observe();assert.ok(r.edgeBefore.available,'cleanup observability required');r.status='running';await save();r.exitCode=run(process.execPath,['--experimental-strip-types','tests/traffic-game-smoke.mjs'],cwd,270000);r.status=r.exitCode===0?'passed':'failed';
  }catch(e){r.status='failed';r.error=String(e);}
  finally{if(preview&&preview.exitCode===null){preview.kill();await new Promise(done=>{const timer=setTimeout(done,5000);preview.once('exit',()=>{clearTimeout(timer);done();});});}
   await new Promise(r=>setTimeout(r,2000));r.edgeAfter=observe();r.cleanup=residual(r.edgeBefore??{available:false},r.edgeAfter);r.finishedAt=new Date().toISOString();
   try{const source=resolve(cwd,'.test-output','traffic-game','normal-peak'),target=resolve(out,name);await mkdir(target,{recursive:true});r.evidenceHashes={};for(const file of await readdir(source,{withFileTypes:true})){if(!file.isFile()||!evidenceFile(file.name))continue;await copyFile(resolve(source,file.name),resolve(target,file.name));r.evidenceHashes[file.name]=hash(await readFile(resolve(target,file.name)));}requireTerminalEvidence(r.exitCode===0,r.evidenceHashes);}catch(e){r.evidenceError=String(e);r.status='failed';}
   await save();
  }
  // Do not run the next application under unknown/leaked browser load. No process killing.
  if(!r.cleanup.known||r.cleanup.pids.length){manifest.aborted='Unknown or residual Edge processes; remaining comparison would be contaminated';await save();break;}
 }
 console.log(JSON.stringify(manifest,null,2));if(manifest.results.length!==2||manifest.results.some(r=>r.status!=='passed')||manifest.aborted)process.exitCode=1;
}
if(process.argv.includes('--preflight'))console.log(JSON.stringify(protocol));else if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
