// Diagnostic only: fixed browser/page transport cases, no application or remote URL.
import {spawn} from 'node:child_process';
import {mkdirSync, mkdtempSync, writeFileSync, appendFileSync, readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const root=resolve('evidence');mkdirSync(root,{recursive:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const results=[];
async function run(endpoint,index){
 const out=resolve(root,endpoint);mkdirSync(out,{recursive:true});
 const profile=mkdtempSync(resolve(out,'profile-')),port=9471+index;
 const result={endpoint,retries:0,status:'running',started:new Date().toISOString(),completion:null,bytes:0,eof:false};
 const record=(kind,value)=>appendFileSync(resolve(out,'protocol.jsonl'),JSON.stringify({at:new Date().toISOString(),kind,value})+'\n');
 const sockets=[];let child;
 const save=()=>writeFileSync(resolve(out,'result.json'),JSON.stringify(result,null,2));save();
 const watchdog=setTimeout(()=>{result.status='hard-timeout';save();child?.kill();process.exit(2);},100000);
 async function connect(url,label){
  const ws=new WebSocket(url);sockets.push(ws);const pending=new Map();let seq=0;let complete=null;
  ws.addEventListener('message',event=>{try{const message=JSON.parse(event.data);record(label+':receive',message);if(message.id){const p=pending.get(message.id);if(p){pending.delete(message.id);clearTimeout(p.timer);message.error?p.reject(Error(JSON.stringify(message.error))):p.resolve(message.result);}}if(message.method==='Tracing.tracingComplete')complete=message.params;}catch(e){record(label+':parse-error',String(e));}});
  ws.addEventListener('error',e=>record(label+':error',String(e.message??e)));
  ws.addEventListener('close',e=>{record(label+':close',{code:e.code,reason:e.reason});for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Socket closed'));}pending.clear();});
  await new Promise((res,rej)=>{const timer=setTimeout(()=>rej(Error('Socket open timeout')),5000);ws.addEventListener('open',()=>{clearTimeout(timer);res();},{once:true});ws.addEventListener('error',()=>{clearTimeout(timer);rej(Error('Socket open error'));},{once:true});});
  return {get complete(){return complete;},send(method,params={}){const id=++seq;record(label+':send',{id,method,params});return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},10000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});}};
 }
 try{
  let occupied=false;try{occupied=(await fetch(`http://127.0.0.1:${port}/json/version`,{signal:AbortSignal.timeout(500)})).ok;}catch{}assert.equal(occupied,false,'Dedicated port occupied');
  child=spawn(process.env.CITYMANAGER_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',['--headless=new','--no-first-run','--no-default-browser-check','--disable-extensions','--disable-background-networking','--disable-component-update','--remote-debugging-address=127.0.0.1',`--remote-debugging-port=${port}`,`--user-data-dir=${profile}`,'about:blank'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',d=>appendFileSync(resolve(out,'browser-stdout.log'),d));child.stderr.on('data',d=>appendFileSync(resolve(out,'browser-stderr.log'),d));child.on('error',e=>record('spawn-error',String(e)));child.on('exit',(code,signal)=>record('browser-exit',{code,signal}));
  let version;const launchDeadline=Date.now()+15000;while(Date.now()<launchDeadline){try{const r=await fetch(`http://127.0.0.1:${port}/json/version`,{signal:AbortSignal.timeout(1000)});if(r.ok){version=await r.json();break;}}catch{}await sleep(200);}assert.ok(version,'Browser launch deadline');result.browser=version;save();
  const targets=await(await fetch(`http://127.0.0.1:${port}/json/list`,{signal:AbortSignal.timeout(2000)})).json();const target=targets.find(x=>x.type==='page');assert.ok(target);
  const page=await connect(target.webSocketDebuggerUrl,'page');const trace=endpoint==='page'?page:await connect(version.webSocketDebuggerUrl,'browser');
  await page.send('Page.enable');
  await page.send('Page.navigate',{url:'data:text/html,<title>Trace canary</title><div id="box">Synthetic only</div>'});
  let ready=false;const pageDeadline=Date.now()+5000;while(Date.now()<pageDeadline){const r=await page.send('Runtime.evaluate',{expression:"document.readyState==='complete'&&document.title==='Trace canary'&&!!document.querySelector('#box')",returnByValue:true});if(r.result?.value===true){ready=true;break;}await sleep(50);}assert.ok(ready,'Synthetic page readiness deadline');
  await trace.send('Tracing.start',{transferMode:'ReturnAsStream',bufferUsageReportingInterval:500,traceConfig:{recordMode:'recordUntilFull',traceBufferSizeInKb:16384,includedCategories:['devtools.timeline','v8','blink.user_timing']}});
  const workload=await page.send('Runtime.evaluate',{expression:`(async()=>{performance.mark('canary-start');let sum=0;for(let frame=0;frame<6;frame++){await new Promise(requestAnimationFrame);for(let i=0;i<100000;i++)sum+=Math.sqrt(i);document.querySelector('#box').style.transform='translateX('+frame+'px)';}performance.mark('canary-end');performance.measure('cdp-stream-canary','canary-start','canary-end');return {sum,frames:6,marks:performance.getEntriesByName('cdp-stream-canary').length};})()`,awaitPromise:true,returnByValue:true});assert.equal(workload.exceptionDetails,undefined);assert.equal(workload.result.value.marks,1);result.workload=workload.result.value;
  const endAt=Date.now();await trace.send('Tracing.end');result.endAcknowledged=true;save();
  const completeDeadline=endAt+30000;while(!trace.complete&&Date.now()<completeDeadline)await sleep(50);
  result.completion=trace.complete;result.completionWaitMs=Date.now()-endAt;save();assert.ok(trace.complete?.stream,'No tracingComplete stream within fixed 30s');assert.equal(trace.complete.dataLossOccurred,false,'Trace reported data loss');
  const handle=trace.complete.stream;const deadline=Date.now()+20000;const tracePath=resolve(out,'trace.json');writeFileSync(tracePath,'');
  try{while(Date.now()<deadline){const chunk=await trace.send('IO.read',{handle,size:262144});const data=Buffer.from(chunk.data,chunk.base64Encoded?'base64':'utf8');assert.ok(result.bytes+data.length<=8*1024*1024,'Trace exceeds 8 MiB canary cap');appendFileSync(tracePath,data);result.bytes+=data.length;if(chunk.eof){result.eof=true;break;}}}finally{await trace.send('IO.close',{handle});}
  assert.equal(result.eof,true,'No EOF within read deadline');assert.ok(result.bytes>0);const parsed=JSON.parse(readFileSync(tracePath,'utf8'));assert.ok(Array.isArray(parsed.traceEvents)&&parsed.traceEvents.length>0);result.eventCount=parsed.traceEvents.length;result.markerCount=parsed.traceEvents.filter(e=>e.name==='cdp-stream-canary').length;assert.ok(result.markerCount>0,'Expected user-timing workload event absent');result.status='passed';
 }catch(e){result.status='failed';result.error=String(e);record('failure',e.stack??String(e));}
 finally{for(const ws of sockets)ws.close();child?.kill();clearTimeout(watchdog);result.finished=new Date().toISOString();save();results.push(result);writeFileSync(resolve(root,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(result));}
}
// Fixed protocol: exactly one browser-target case and one page-target control.
await run('browser',0);await run('page',1);
if(results.length!==2||results.some(r=>r.status!=='passed'))process.exitCode=1;
