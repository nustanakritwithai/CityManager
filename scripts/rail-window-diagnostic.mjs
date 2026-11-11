// Diagnostic-only transformations, applied identically to both pinned checkouts.
import {readFileSync,writeFileSync,appendFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {fork} from 'node:child_process';
import assert from 'node:assert/strict';
async function controller(root){
 const id=process.env.TRAFFIC_DIAG_ID;assert.match(id??'',/^[a-z0-9-]+$/);
 const out=resolve(root,'.test-output/traffic-game','fallback-dense-'+id);mkdirSync(out,{recursive:true});
 const records=[];let active=null,child,ws,seq=0,pending=new Map(),completion=null,queue=Promise.resolve(),traceCount=0,windowTimer,windowDone;
 const protocol=(kind,value)=>appendFileSync(resolve(out,'trace-protocol.jsonl'),JSON.stringify({at:Date.now(),kind,value})+'\n');
 const save=()=>writeFileSync(resolve(out,'trace-status.json'),JSON.stringify({diagnosticOnly:true,records},null,2));
 const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 function send(method,params={}){const mid=++seq;protocol('send',{id:mid,method,params});return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(mid);reject(Error('CDP timeout '+method));},10000);pending.set(mid,{resolve,reject,timer});ws.send(JSON.stringify({id:mid,method,params}));});}
 async function connect(){
  const version=await(await fetch('http://127.0.0.1:9366/json/version',{signal:AbortSignal.timeout(2000)})).json();protocol('browser-version',version);ws=new WebSocket(version.webSocketDebuggerUrl);
  ws.addEventListener('message',event=>{try{const m=JSON.parse(event.data);protocol('receive',m);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}}if(m.method==='Tracing.tracingComplete'){completion={...m.params,receivedAt:Date.now()};if(active){active.completion=completion;save();}}}catch(e){protocol('parse-error',String(e));}});
  ws.addEventListener('error',e=>protocol('socket-error',String(e.message??e)));ws.addEventListener('close',e=>{protocol('socket-close',{code:e.code,reason:e.reason});for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Socket closed'));}pending.clear();});
  await new Promise((res,rej)=>{const timer=setTimeout(()=>rej(Error('Socket open timeout')),5000);ws.addEventListener('open',()=>{clearTimeout(timer);res();},{once:true});ws.addEventListener('error',()=>{clearTimeout(timer);rej(Error('Socket open error'));},{once:true});});
 }
 async function stop(reason){
  const rec=active;if(!rec||rec.stopping)return;rec.stopping=true;clearTimeout(windowTimer);rec.stopReason=reason;rec.endRequestedAt=Date.now();save();
  try{await send('Tracing.end');rec.endAcknowledgedAt=Date.now();save();const deadline=Date.now()+30000;while(!completion&&Date.now()<deadline)await sleep(50);assert.ok(completion?.stream,'No completion stream within30s');rec.completion=completion;rec.completionLatencyMs=completion.receivedAt-rec.endRequestedAt;save();
   const path=resolve(out,rec.name+'-trace.json');writeFileSync(path,'');const readDeadline=Date.now()+20000;
   try{while(Date.now()<readDeadline){const chunk=await send('IO.read',{handle:completion.stream,size:262144});const bytes=Buffer.from(chunk.data,chunk.base64Encoded?'base64':'utf8');assert.ok(rec.bytes+bytes.length<=32*1024*1024,'Trace exceeds32MiB cap');appendFileSync(path,bytes);rec.bytes+=bytes.length;if(chunk.eof){rec.eof=true;break;}}}finally{await send('IO.close',{handle:completion.stream});}
   assert.equal(rec.eof,true);assert.ok(rec.bytes>0);assert.equal(completion.dataLossOccurred,false);const trace=JSON.parse(readFileSync(path,'utf8'));assert.ok(Array.isArray(trace.traceEvents)&&trace.traceEvents.length>0);rec.events=trace.traceEvents.length;rec.phaseEvents=trace.traceEvents.filter(e=>e.name?.startsWith('rail-diagnostic:')).length;rec.status='complete';
  }catch(e){rec.status='incomplete';rec.error=String(e);protocol('flush-error',String(e));}finally{rec.finishedAt=Date.now();active=null;save();}
 }
 async function begin(name){
  if(name==='finish'){if(active)await windowDone;return;}
  assert.ok(['off-boot','on-boot'].includes(name));assert.equal(records.some(x=>x.name===name),false,'Repeated window forbidden');assert.ok(traceCount<2);traceCount++;
  if(active)await windowDone;
  if(!ws)await connect();completion=null;
  const rec={name,startedAt:Date.now(),durationLimitMs:20000,status:'starting',bytes:0,eof:false};records.push(rec);active=rec;
  await send('Tracing.start',{transferMode:'ReturnAsStream',bufferUsageReportingInterval:1000,traceConfig:{recordMode:'recordUntilFull',traceBufferSizeInKb:16384,includedCategories:['devtools.timeline','v8','blink.user_timing','disabled-by-default-v8.cpu_profiler']}});
  rec.status='recording';save();let finish;windowDone=new Promise(r=>finish=r);windowTimer=setTimeout(()=>{queue=queue.then(()=>stop('fixed20s-independent-timer')).finally(finish);},20000);
 }
 const hard=setTimeout(()=>{protocol('hard-timeout',{elapsedLimitMs:290000});if(active){active.status='hard-timeout';clearTimeout(windowTimer);}save();child?.kill();process.exit(2);},290000);
 const run=()=>new Promise(resolveRun=>{
  child=fork(resolve(root,'tests/traffic-game-smoke.mjs'),[],{cwd:root,execArgv:['--experimental-strip-types'],stdio:['ignore','pipe','pipe','ipc']});
  child.stdout.on('data',d=>process.stdout.write(d));child.stderr.on('data',d=>process.stderr.write(d));
  child.on('message',m=>{if(m?.type==='trace-window'){begin(m.name).then(()=>{if(child.connected)child.send({type:'trace-ready',name:m.name});}).catch(e=>{protocol('start-error',String(e));if(active){active.status='start-failed';active.error=String(e);clearTimeout(windowTimer);active=null;save();}if(child.connected)child.send({type:'trace-ready',name:m.name,error:String(e)});});}});
  child.on('error',e=>{protocol('child-error',String(e));resolveRun(2);});child.on('exit',(code,signal)=>{protocol('child-exit',{code,signal});resolveRun(code??2);});
 });
 const exitCode=await run();await queue;if(active)await stop('child-exit');clearTimeout(hard);if(ws)ws.close();protocol('finished',{exitCode,traceCount});save();
 if(exitCode!==0||records.length!==2||records.some(r=>r.status!=='complete'))process.exitCode=1;
}

if(process.argv[2]==='--run'){await controller(resolve(process.argv[3]));}else{
const root=resolve(process.argv[2]);
const changed=[];
function edit(file,changes){let text=readFileSync(resolve(root,file),'utf8');for(const [from,to] of changes){if(text.split(from).length!==2)throw Error(`Expected one match in ${file}: ${from.slice(0,90)}`);text=text.replace(from,to);}writeFileSync(resolve(root,file),text);changed.push(file);}
writeFileSync(resolve(root,'src/__rail-diagnostic.ts'),`export function diagnosticPhase<T>(name:string,fn:()=>T):T {const start=performance.now();try{return fn();}finally{diagnosticRecord(name,start,performance.now());}}
export function diagnosticRecord(name:string,start:number,end:number):void {try{performance.measure('rail-diagnostic:'+name,{start,end});(globalThis as any).__railDiagRecord?.(name,start,end);}catch{}finally{performance.clearMeasures('rail-diagnostic:'+name);}}
`);
edit('src/traffic/layer.ts',[
 ["import type {AppBase}","import {diagnosticPhase,diagnosticRecord} from '../__rail-diagnostic.ts';\nimport type {AppBase}"],
 ['this.drawn=this.presenter.frame(dt,paused,this.busObstacles());',"this.drawn=diagnosticPhase('presenter.frame',()=>this.presenter.frame(dt,paused,this.busObstacles()));"],
 ['if(this.reconcileWorkTrips(paused?0:dt))',"if(diagnosticPhase('reconcileWorkTrips',()=>this.reconcileWorkTrips(paused?0:dt)))"],
 ['this.drawn=this.presenter.frame(0,true);',"this.drawn=diagnosticPhase('presenter.reconcile',()=>this.presenter.frame(0,true));"],
 ['if(this.visible)this.cars.sync(this.drawn);',"if(this.visible)diagnosticPhase('cars.sync',()=>this.cars.sync(this.drawn));"],
 ['this.dirty=false;this.submit(city,advance,paused);',"this.dirty=false;diagnosticPhase('capture.submit',()=>this.submit(city,advance,paused));"],
 ['this.bus.tick(this.minute);',"diagnosticPhase('bus.tick',()=>this.bus!.tick(this.minute));"],
 ['this.timing.maxFrameMs=Math.max(this.timing.maxFrameMs,ms);',"this.timing.maxFrameMs=Math.max(this.timing.maxFrameMs,ms);diagnosticRecord('layer.frame',frameStart,frameStart+ms);"],
 ['this.timing.maxProjectionMs=Math.max(this.timing.maxProjectionMs,ms);',"this.timing.maxProjectionMs=Math.max(this.timing.maxProjectionMs,ms);diagnosticRecord('projection',start,start+ms);"]
]);
edit('src/traffic/game-worker-engine.ts',[
 ["import {TrafficGame,", "import {diagnosticPhase} from '../__rail-diagnostic.ts';\nimport {TrafficGame,"],
 ['let sample=trafficGameSampleFromInput(message.sample);',"let sample=diagnosticPhase('worker.sample',()=>trafficGameSampleFromInput(message.sample));"],
 ['candidate=base.clone();candidate.setSample(sample);',"candidate=diagnosticPhase('worker.clone',()=>base!.clone());diagnosticPhase('worker.setSample',()=>candidate!.setSample(sample));"],
 ['candidate.step(false):candidate.frame',"diagnosticPhase('worker.step',()=>candidate!.step(false)):diagnosticPhase('worker.frame',()=>candidate!.frame)"]
]);
const injection=`(()=>{const state=window.__railDiagnostic={url:location.href,timeOrigin:performance.timeOrigin,phases:[],longTasks:[],droppedPhases:0,droppedLongTasks:0};window.__railDiagRecord=(name,start,end)=>{if(state.phases.length<6000)state.phases.push({name,start,end,duration:end-start});else state.droppedPhases++;};try{new PerformanceObserver(list=>{for(const e of list.getEntries()){if(state.longTasks.length<1000)state.longTasks.push({start:e.startTime,duration:e.duration,name:e.name});else state.droppedLongTasks++;}}).observe({entryTypes:['longtask']});}catch{}})()`;
const diagSetup=`async function diagnosticWindow(name){if(!process.send)throw Error('Independent trace controller required');await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{process.off('message',listener);reject(Error('Trace start ACK timeout'));},80000);function listener(m){if(m?.type==='trace-ready'&&m.name===name){clearTimeout(timer);process.off('message',listener);m.error?reject(Error(m.error)):resolve();}}process.on('message',listener);process.send({type:'trace-window',name});});}`;
edit('tests/traffic-game-smoke.mjs',[
 ['const evidenceCase=testPlan.output;',"const diagnosticId=process.env.TRAFFIC_DIAG_ID??'local';assert.match(diagnosticId,/^[a-z0-9-]+$/);const evidenceCase=testPlan.output+'-'+diagnosticId;"],
 ["import {writeFileSync} from 'node:fs';","import {writeFileSync,appendFileSync} from 'node:fs';"],
 ['let lastExpression=null;',diagSetup+'\nlet lastExpression=null;'],
 ["await send('Page.enable');await send('Network.enable');",`await send('Page.enable');await send('Page.addScriptToEvaluateOnNewDocument',{source:${JSON.stringify(injection)}});await send('Network.enable');`],
 ["lastDiagnosticAt=Date.now();return lastDiagnostic;", "lastDiagnosticAt=Date.now();try{const diagnostic=await evaluate('window.__railDiagnostic??null');appendFileSync(resolve(output,'phase-snapshots.jsonl'),JSON.stringify({stage,at:Date.now(),diagnostic})+'\\n');}catch{}return lastDiagnostic;"],
 ["setStage('mobile dense OFF baseline');", "await diagnosticWindow('off-boot');setStage('mobile dense OFF baseline');"],
 ["setStage('mobile dense ON setup');", "await diagnosticWindow('on-boot');setStage('mobile dense ON setup');"],
 ['finally{clearTimeout(watchdog);if(ws?.readyState===1)', "finally{clearTimeout(watchdog);try{await diagnosticWindow('finish');}catch(error){appendFileSync(resolve(output,'trace-cleanup-errors.log'),String(error)+'\\n');}if(ws?.readyState===1)"]
]);
writeFileSync(resolve(root,'diagnostic-modifications.json'),JSON.stringify({diagnosticOnly:true,instrumented:true,files:['src/__rail-diagnostic.ts',...changed],thresholdsChanged:false,windowCount:2,windowDurationMs:20000,windowStarts:'before OFF navigation and before ON navigation',cpuSampling:true},null,2));
console.log('Instrumented',root,changed);
}
