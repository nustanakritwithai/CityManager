// Diagnostic-only transformations, applied identically to both pinned checkouts.
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve(process.argv[2]);
const changed=[];
function edit(file,changes){let text=readFileSync(resolve(root,file),'utf8');for(const [from,to] of changes){if(text.split(from).length!==2)throw Error(`Expected one match in ${file}: ${from.slice(0,90)}`);text=text.replace(from,to);}writeFileSync(resolve(root,file),text);changed.push(file);}
writeFileSync(resolve(root,'src/__rail-diagnostic.ts'),`export function diagnosticPhase<T>(name:string,fn:()=>T):T {const start=performance.now();try{return fn();}finally{diagnosticRecord(name,start,performance.now());}}
export function diagnosticRecord(name:string,start:number,end:number):void {try{performance.measure('rail-diagnostic:'+name,{start,end});(globalThis as any).__railDiagRecord?.(name,start,end);}catch{}}
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
const diagSetup=`
let diagnosticTraceActive=false,diagnosticTraceComplete=false,diagnosticTraceBytes=0,diagnosticTraceTruncated=false,diagnosticTraceDataLoss=false,diagnosticTraceBufferMax=0;
function recordTrace(events){const lines=[];for(const event of events){const line=JSON.stringify(event)+'\\n';const size=Buffer.byteLength(line);if(diagnosticTraceBytes+size>64*1024*1024){diagnosticTraceTruncated=true;break;}lines.push(line);diagnosticTraceBytes+=size;}if(lines.length)appendFileSync(resolve(output,'trace-events.jsonl'),lines.join(''));}
async function stopDiagnosticTrace(){if(!diagnosticTraceActive)return;try{await send('Tracing.end');const until=Date.now()+10000;while(!diagnosticTraceComplete&&Date.now()<until)await sleep(100);}catch(error){appendFileSync(resolve(output,'trace-errors.log'),String(error)+'\\n');}finally{await writeFile(resolve(output,'trace-status.json'),JSON.stringify({instrumented:true,complete:diagnosticTraceComplete,bytes:diagnosticTraceBytes,truncated:diagnosticTraceTruncated,dataLossOccurred:diagnosticTraceDataLoss,maxBufferUsage:diagnosticTraceBufferMax,maxBytes:64*1024*1024}));}}
`;
edit('tests/traffic-game-smoke.mjs',[
 ["import {writeFileSync} from 'node:fs';","import {writeFileSync,appendFileSync} from 'node:fs';"],
 ['let lastExpression=null;',diagSetup+'\nlet lastExpression=null;'],
 ['if(m.method)networkAudit.observe(m.method,m.params);',"if(m.method==='Tracing.dataCollected')recordTrace(m.params.value);if(m.method==='Tracing.tracingComplete'){diagnosticTraceComplete=true;diagnosticTraceDataLoss=!!m.params.dataLossOccurred;}if(m.method==='Tracing.bufferUsage')diagnosticTraceBufferMax=Math.max(diagnosticTraceBufferMax,m.params.percentFull??m.params.value??0);if(m.method)networkAudit.observe(m.method,m.params);"],
 ["await send('Page.enable');await send('Network.enable');",`await send('Page.enable');await send('Page.addScriptToEvaluateOnNewDocument',{source:${JSON.stringify(injection)}});await send('Tracing.start',{transferMode:'ReportEvents',bufferUsageReportingInterval:1000,traceConfig:{recordMode:'recordUntilFull',traceBufferSizeInKb:32768,includedCategories:['devtools.timeline','v8','blink.user_timing','disabled-by-default-v8.cpu_profiler']}});diagnosticTraceActive=true;await writeFile(resolve(output,'trace-status.json'),JSON.stringify({instrumented:true,complete:false,note:'Started; final status absent if original hard watchdog exits'}));await send('Network.enable');`],
 ["lastDiagnosticAt=Date.now();return lastDiagnostic;", "lastDiagnosticAt=Date.now();try{const diagnostic=await evaluate('window.__railDiagnostic??null');appendFileSync(resolve(output,'phase-snapshots.jsonl'),JSON.stringify({stage,at:Date.now(),diagnostic})+'\\n');}catch{}return lastDiagnostic;"],
 ['finally{clearTimeout(watchdog);if(ws?.readyState===1)', 'finally{clearTimeout(watchdog);await stopDiagnosticTrace();if(ws?.readyState===1)']
]);
writeFileSync(resolve(root,'diagnostic-modifications.json'),JSON.stringify({instrumented:true,files:['src/__rail-diagnostic.ts',...changed],thresholdsChanged:false,startupIncluded:true},null,2));
console.log('Instrumented',root,changed);
