// Diagnostic only: never replaces acceptance, retries a sample, or changes budgets.
import {spawn,spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,existsSync,openSync,closeSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {createConnection} from 'node:net';
export const BASELINE='cc5aea7291ed777b853c4679eec31949dfb09b77';
export const HEAD='56effd0114c25605ba105966fab7f290ded58148';
export const PLAN=Object.freeze(['baseline','head','head','baseline','baseline','head']);
const hash=s=>createHash('sha256').update(s).digest('hex');
function replaceOnce(source,from,to){assert.equal(source.split(from).length,2,`Unique diagnostic insertion: ${from}`);return source.replace(from,to);}
// Experiment 1 (run42363992254) failed all six trials before ON; broad tracing
// is an unproven confound. This revision does not assert disk-write causality.
export function instrument(source,fixture,output){
 source="import {readFileSync as diagnosticRead,writeFileSync as diagnosticWrite} from 'node:fs';\nimport {appendFile as diagnosticAppend} from 'node:fs/promises';\n"+source;
 source=replaceOnce(source,'const dense=populationFixture(334,true);step(dense);const denseRaw=serializeParkSession(dense,createParkRuntime(dense)),denseLive=loadedTrafficSession(denseRaw).city;',`const denseRaw=diagnosticRead(${JSON.stringify(fixture)},'utf8'),dense=deserializeParkSession(denseRaw).city,denseLive=loadedTrafficSession(denseRaw).city;assert.equal(serializeParkSession(dense,createParkRuntime(dense)),denseRaw,'Canonical fixture round trip');`);
 source=replaceOnce(source,"resolve('.test-output/traffic-game',evidenceCase)",JSON.stringify(output));
 source=replaceOnce(source,'const m=JSON.parse(event.data);',`const m=JSON.parse(event.data);if(m.method==='Tracing.tracingComplete'){diagnosticTraceEvent=m.params;diagnosticTraceState.flushEventAt=Date.now();diagnosticTraceState.dataLossOccurred=m.params.dataLossOccurred??false;}`);
 source=replaceOnce(source,"await send('Runtime.enable');",`diagnosticWrite(resolve(output,'browser.json'),JSON.stringify(await send('Browser.getVersion')));await send('Runtime.enable');`);
 source=replaceOnce(source,"setStage('mobile dense ON setup');d=await navigate",`setStage('mobile dense ON setup');await diagnosticStartTrace();d=await navigate`);
 source=replaceOnce(source,"child.on('error',error=>{launchError=error;});","child.on('error',error=>{launchError=error;});diagnosticWrite(resolve(output,'owned-browser.json'),JSON.stringify({pid:child.pid??null}));");
 source=source.replaceAll('child.kill();',`if(child.pid&&child.exitCode===null&&child.signalCode===null){const cleanup=diagnosticSpawnSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{encoding:'utf8',timeout:5000,windowsHide:true});diagnosticWrite(resolve(output,'browser-cleanup.json'),JSON.stringify({pid:child.pid,status:cleanup.status,error:cleanup.error?.message??null}));}child.kill();`);
 source=replaceOnce(source,'lastDiagnosticAt=Date.now();return lastDiagnostic;',`lastDiagnosticAt=Date.now();diagnosticSnapshots.push({stage,wallMs:lastDiagnosticAt,...lastDiagnostic});return lastDiagnostic;`);
 source=replaceOnce(source,"try{await send('Browser.close');}",`try{await diagnosticDrainTrace();await send('Browser.close');}`);
 source=replaceOnce(source,"const watchdog=setTimeout(()=>{",`const diagnosticFlushTimer=setTimeout(()=>{void diagnosticEndTrace().catch(error=>{diagnosticTraceState.stopError=String(error);});},225_000);const watchdog=setTimeout(()=>{diagnosticTraceState.incompleteReason='Original 240s failure watchdog: stream not drained';diagnosticSaveState();`);
 source=replaceOnce(source,'finally{clearTimeout(watchdog);','finally{clearTimeout(diagnosticFlushTimer);clearTimeout(watchdog);diagnosticSaveState();');
 return `import {spawnSync as diagnosticSpawnSync} from 'node:child_process';
const diagnosticSnapshots=[],diagnosticTraceState={started:false,stopRequested:false,streamEof:false,bytes:0};let diagnosticTraceEvent=null;
function diagnosticSaveState(){diagnosticWrite(${JSON.stringify(resolve(output,'trace-status.json'))},JSON.stringify(diagnosticTraceState,null,2));diagnosticWrite(${JSON.stringify(resolve(output,'timing.json'))},JSON.stringify(diagnosticSnapshots,null,2));}
async function diagnosticStartTrace(){await send('Tracing.start',{categories:'devtools.timeline,blink.user_timing',options:'record-continuously',transferMode:'ReturnAsStream'});diagnosticTraceState.started=true;diagnosticTraceState.startedAt=Date.now();}
async function diagnosticEndTrace(){if(!diagnosticTraceState.started||diagnosticTraceState.stopRequested||ws?.readyState!==1)return;diagnosticTraceState.stopRequested=true;diagnosticTraceState.stopRequestedAt=Date.now();await send('Tracing.end');}
async function diagnosticDrainTrace(){
 if(!diagnosticTraceState.started){diagnosticTraceState.incompleteReason='Traffic ON navigation was never reached';diagnosticSaveState();return;}
 let handle;const deadline=Date.now()+20000;
 const bounded=(method,params)=>{let timer;return Promise.race([send(method,params),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Trace drain deadline')),Math.max(1,deadline-Date.now()));})]).finally(()=>clearTimeout(timer));};
 try{
  await Promise.race([diagnosticEndTrace(),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('Trace stop deadline')),5000);timer.unref();})]);
  while(!diagnosticTraceEvent&&Date.now()<deadline)await sleep(25);
  handle=diagnosticTraceEvent?.stream;if(!handle)throw Error('Missing trace stream handle');
  diagnosticWrite(${JSON.stringify(resolve(output,'trace.json'))},'');
  while(Date.now()<deadline){
   const chunk=await bounded('IO.read',{handle,size:1048576});const data=Buffer.from(chunk.data,chunk.base64Encoded?'base64':'utf8');
   if(diagnosticTraceState.bytes+data.length>134217728)throw Error('Trace exceeds 128MiB diagnostic bound');
   await diagnosticAppend(${JSON.stringify(resolve(output,'trace.json'))},data);diagnosticTraceState.bytes+=data.length;
   diagnosticTraceState.firstByteAt??=Date.now();
   if(chunk.eof){diagnosticTraceState.streamEof=true;diagnosticTraceState.completedAt=Date.now();if(diagnosticTraceState.dataLossOccurred)throw Error('Browser reported trace data loss');diagnosticWrite(${JSON.stringify(resolve(output,'trace-complete.json'))},JSON.stringify(diagnosticTraceState));break;}
  }
  if(!diagnosticTraceState.streamEof)throw Error('Trace drain deadline');
 }catch(error){diagnosticTraceState.incompleteReason=String(error);}
 finally{if(handle&&Date.now()<deadline){try{await bounded('IO.close',{handle});}catch(error){diagnosticTraceState.closeError=String(error);}}diagnosticSaveState();}
}
`+source;
}

function run(command,args,cwd,log,env={},timeout=600000){
 const result=spawnSync(command,args,{cwd,env:{...process.env,...env},encoding:'utf8',timeout,maxBuffer:64*1024*1024,windowsHide:true});
 writeFileSync(log,(result.stdout??'')+'\n'+(result.stderr??'')+'\n'+(result.error?.stack??''));
 return {status:result.status,signal:result.signal,error:result.error?.message??null};
}
export function diagnosticSucceeded(results){return results.filter(r=>r.phase==='browser').length===6&&results.every(r=>r.status===0&&(r.phase!=='browser'||r.traceComplete===true));}
export function plannedResults(){return PLAN.map((side,i)=>({trial:i+1,pair:Math.floor(i/2)+1,side,phase:'browser',outcome:'not-run',status:null,reason:'Experiment preparation has not completed'}));}
export async function executePlan(results,execute,save){
 let stopReason=null;
 for(const entry of results){
  if(stopReason){Object.assign(entry,{outcome:'skipped',reason:stopReason});save();continue;}
  try{Object.assign(entry,await execute({...entry}));}
  catch(error){Object.assign(entry,{outcome:'setup-failed',status:null,error:String(error),safeToContinue:false});}
  delete entry.reason;
  if(entry.safeToContinue!==true)stopReason=`Trial ${entry.trial} cleanup/setup was not confirmed safe; no replacement or retry`;
  save();
 }
}
async function portOpen(port){return new Promise(resolve=>{const socket=createConnection({host:'127.0.0.1',port});const done=value=>{socket.destroy();resolve(value);};socket.once('connect',()=>done(true));socket.once('error',()=>done(false));socket.setTimeout(500,()=>done(true));});}
async function waitPortsFree(){for(let i=0;i<20;i++){if(!await portOpen(4195)&&!await portOpen(9366))return true;await new Promise(r=>setTimeout(r,250));}return false;}
async function runBrowser(args,cwd,log,env){
 const fd=openSync(log,'w');let child;
 try{return await new Promise(resolve=>{
  child=spawn(process.execPath,args,{cwd,env:{...process.env,...env},stdio:['ignore',fd,fd],windowsHide:true});
  let timedOut=false;
  const timer=setTimeout(()=>{timedOut=true;if(child.pid&&child.exitCode===null&&child.signalCode===null)spawnSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{timeout:5000,windowsHide:true});child.kill();child.unref();resolve({status:null,outcome:'timeout',timedOut:true,error:'Harness exceeded 300 s; owned process-tree cleanup attempted; remaining trials must not run'});},300000);
  child.once('error',error=>{clearTimeout(timer);resolve({status:null,error:String(error),outcome:'launch-failed'});});
  child.once('exit',(status,signal)=>{clearTimeout(timer);resolve({status,signal,outcome:timedOut?'timeout':status===0?'passed':'failed',timedOut});});
 });}finally{closeSync(fd);}
}
async function main(){
 assert.equal(process.platform,'win32','Diagnostic requires a Windows Edge runner');
 const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),out=resolve(root,'.test-output/paired-diagnostic');
 assert.ok(!existsSync(out),'Refuse to overwrite any previous experiment');mkdirSync(out,{recursive:true});
 const git=(args)=>{const r=spawnSync('git',args,{cwd:root,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
 const manifest={instrumentationRevision:2,priorExperiment:{run:42363992254,artifact:13571680688,outcome:'All six failed before ON; no comparative timing evidence'},baseline:BASELINE,head:HEAD,plan:PLAN.map((side,i)=>({trial:i+1,pair:Math.floor(i/2)+1,side})),runner:{platform:process.platform,node:process.version,host:process.env.COMPUTERNAME,image:process.env.ImageVersion},results:plannedResults(),note:'All six planned slots retained, including not-run/skipped. Revision2: initial run42363992254 had six pre-ON failures; broad tracing is an unproven confound, not proven disk-write starvation. Lightweight ReturnAsStream starts immediately before ON navigation and drains after acceptance. trace-complete.json confirms EOF, not whole-test coverage; best-effort stop225s/original failure watchdog240s. Tracing perturbs timing. Diagnostic is not a replacement acceptance gate.'};
 const save=()=>writeFileSync(resolve(out,'manifest.json'),JSON.stringify(manifest,null,2));save();
 try{
 const dirs={};
 for(const [side,sha] of Object.entries({baseline:BASELINE,head:HEAD})){
  assert.equal(git(['rev-parse',sha]),sha);const dir=resolve(out,side);git(['worktree','add','--detach',dir,sha]);dirs[side]=dir;
  const source=readFileSync(resolve(dir,'tests/traffic-game-smoke.mjs'),'utf8');
  manifest[side+'SmokeSha256']=hash(source);save();
  for(const [label,args] of [['install',['ci','--no-audit','--no-fund']],['build',['run','build','--','--sourcemap','hidden']]]){
   const result=run('cmd.exe',['/d','/s','/c',`npm ${args.join(' ')}`],dir,resolve(out,side+'-'+label+'.log'),{VITE_MARKET_URL:'',VITE_CITY_ADVISOR_ONLINE:'false',VITE_CITY_ENTITY_ADVISOR_ONLINE:'false',VITE_CITY_OWNER_ADVISOR_ONLINE:'false'});
   manifest.results.push({side,phase:label,...result});save();assert.equal(result.status,0,`${side} ${label} failed; see preserved log`);
  }
 }
 assert.equal(manifest.baselineSmokeSha256,manifest.headSmokeSha256,'Require identical smoke harness before instrumentation');
 const fixture=resolve(out,'canonical-dense.json'),baseSmoke=readFileSync(resolve(dirs.baseline,'tests/traffic-game-smoke.mjs'),'utf8');
 const exportSource=replaceOnce(baseSmoke,"const httpFixture=await startTrafficHttpFixture",`writeFileSync(${JSON.stringify(fixture)},denseRaw);process.exit(0);\nconst httpFixture=await startTrafficHttpFixture`);
 const exportPath=resolve(dirs.baseline,'tests/traffic-game-export.generated.mjs');writeFileSync(exportPath,exportSource);
 const exported=run(process.execPath,['--experimental-strip-types',exportPath],dirs.baseline,resolve(out,'fixture.log'));
 assert.equal(exported.status,0,'Canonical fixture export failed');manifest.fixtureSha256=hash(readFileSync(fixture));save();
 await executePlan(manifest.results.filter(r=>r.phase==='browser'),async entry=>{
  const dir=dirs[entry.side],trialOut=resolve(out,`trial-${entry.trial}-${entry.side}`);mkdirSync(trialOut);
  const generated=resolve(dir,'tests/traffic-game-diagnostic.generated.mjs');writeFileSync(generated,instrument(baseSmoke,fixture,trialOut));
  let preview,previewLog,result,cleanup=false;
  try{
   assert.equal(await portOpen(4195)||await portOpen(9366),false,'Dedicated preview/CDP port occupied; no unrelated process will be killed');
   previewLog=openSync(resolve(trialOut,'preview.log'),'w');
   preview=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','4195','--strictPort'],{cwd:dir,stdio:['ignore',previewLog,previewLog],windowsHide:true});
   let previewError=null;preview.on('error',error=>{previewError=error;});
   let ready=false;
   for(let i=0;i<40;i++){
    if(previewError||preview.exitCode!==null)break;
    try{ready=(await fetch('http://127.0.0.1:4195/CityManager/',{signal:AbortSignal.timeout(1000)})).ok;}catch{}
    if(ready)break;await new Promise(r=>setTimeout(r,500));
   }
   assert.ok(ready&&!previewError&&preview.exitCode===null,'Dedicated preview failed');
   result=await runBrowser(['--experimental-strip-types',generated],dir,resolve(trialOut,'process.log'),{TRAFFIC_GAME_CASE:'dense',TRAFFIC_GAME_EXPECT_DEFAULT:'1',CITYMANAGER_BLOCK_MODELS:'1',CITYMANAGER_SOFTWARE_WEBGL:'1'});
  }catch(error){result={status:null,error:String(error),outcome:'setup-failed'};writeFileSync(resolve(trialOut,'setup-error.txt'),error.stack);}
  finally{
   if(preview?.pid&&preview.exitCode===null&&preview.signalCode===null){const stopped=new Promise(r=>preview.once('exit',r));preview.kill();await Promise.race([stopped,new Promise(r=>setTimeout(r,5000))]);}
   if(previewLog!==undefined)closeSync(previewLog);
   cleanup=!!preview&&(preview.exitCode!==null||preview.signalCode!==null)&&await waitPortsFree();
  }
  const traceComplete=existsSync(resolve(trialOut,'trace-complete.json'));
  return {...result,fixtureSha256:hash(readFileSync(fixture)),traceComplete,traceStatus:traceComplete?'complete':existsSync(resolve(trialOut,'trace.json'))?'partial':'missing',safeToContinue:cleanup&&!result.timedOut,cleanupConfirmed:cleanup};
 },save);
 assert.equal(manifest.results.filter(r=>r.phase==='browser').length,6);
 assert.ok(diagnosticSucceeded(manifest.results),'One or more acceptance outcomes failed or diagnostic traces are incomplete; all six outcomes retained. Do not retry selectively.');
 }catch(error){manifest.error=String(error);for(const result of manifest.results)if(result.outcome==='not-run')result.reason='Preparation aborted: '+String(error);throw error;}finally{save();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
