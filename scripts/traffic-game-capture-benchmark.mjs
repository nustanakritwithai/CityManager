// Main-side capture/dispatch probe, not a real browser or rendered-frame test.
// node --experimental-strip-types scripts/traffic-game-capture-benchmark.mjs
// Uses a reconciled 1,005-person synthetic capacity fixture and the actual
// game worker client. Repeated samples estimate per-second (1x) capture costs;
// four successful user-equivalent road commands exercise a multi-edit burst.
import {Worker} from 'node:worker_threads';
import {performance,monitorEventLoopDelay} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {populationFixture} from '../tests/population-capacity-fixture.ts';
import {serialize,deserialize,step,buildParallelRoad} from '../src/sim.ts';
import {captureTrafficGameInput} from '../src/traffic/game.ts';
import {createTrafficGameClient} from '../src/traffic/game-worker-client.ts';
const files=['src/traffic/game.ts','src/traffic/game-worker-client.ts','src/traffic/game-worker-engine.ts','src/sim.ts','src/road-topology.ts','tests/population-capacity-fixture.ts'];
const hashes=()=>Object.fromEntries(files.map(p=>[p,createHash('sha256').update(readFileSync(new URL('../'+p,import.meta.url))).digest('hex')]));const sourceBefore=hashes();
let city=populationFixture(334,true);step(city);city=deserialize(serialize(city));const rawBefore=serialize(city),startRoads=city.cells.filter(c=>c.road).length;
const worker=new Worker(new URL('./traffic-game-worker-node.mjs',import.meta.url),{execArgv:['--experimental-strip-types']}),posts=[];
const port={postMessage:m=>{const t=performance.now();worker.postMessage(m);posts.push(performance.now()-t);},terminate:()=>{void worker.terminate();},addEventListener:(kind,fn)=>worker.on(kind,kind==='message'?data=>fn({data}):fn)};
let fault='';const client=createTrafficGameClient(port,'capture-bench',{onFrame:()=>{},onFailure:m=>{fault=m;}},30_000);
const wait=ms=>new Promise(r=>setTimeout(r,ms)),delay=monitorEventLoopDelay({resolution:10});delay.enable();
const captures=[],cloneMs=[],submits=[],bursts=[];
function captureAndSubmit(){
 const before=serialize(city),t=performance.now(),sample=captureTrafficGameInput(city),capture=performance.now()-t;let clone=0,submitted;
 const original=globalThis.structuredClone;globalThis.structuredClone=(...args)=>{const n=performance.now();try{return original(...args);}finally{clone+=performance.now()-n;}};
 const submitAt=performance.now();try{submitted=client.submit(sample,{advance:false,paused:true});}finally{globalThis.structuredClone=original;}const submit=performance.now()-submitAt;
 if(!submitted||serialize(city)!==before)throw Error('Capture/dispatch changed City or rejected input');captures.push(capture);cloneMs.push(clone);submits.push(submit);return {capture,clone,submit};
}
try{
 for(let n=0;n<30;n++)captureAndSubmit();
 if(serialize(city)!==rawBefore)throw Error('Repeated capture changed the validated source city');
 for(let i=0;i<6;i++){city=deserialize(rawBefore);const burstStart=performance.now(),edits=[],samples=[];for(const y of [2,5,8,11]){const t=performance.now(),result=buildParallelRoad(city,y*24+2,y*24+12);edits.push(performance.now()-t);if(!result.ok)throw Error(`Real road edit failed at row ${y}: ${result.message}`);samples.push(captureAndSubmit());}bursts.push({edits,samples,measuredWorkMs:edits.reduce((a,b)=>a+b,0)+samples.reduce((n,x)=>n+x.capture+x.submit,0),wallWithValidationMs:performance.now()-burstStart});}
 const postEdit=serialize(city),deadline=performance.now()+30_000;while((client.status.inflight||client.status.pending)&&!fault&&performance.now()<deadline)await wait(5);
 if(fault||client.status.inflight||client.status.pending)throw Error(fault||'Worker did not drain');if(serialize(city)!==postEdit)throw Error('Worker dispatch mutated city after edit');deserialize(postEdit);
 const p=(a,q)=>[...a].sort((x,y)=>x-y)[Math.min(a.length-1,Math.floor((a.length-1)*q))]??0,stat=a=>({p95:p(a,.95),max:Math.max(0,...a)}),sourceAfter=hashes(),stable=JSON.stringify(sourceBefore)===JSON.stringify(sourceAfter);delay.disable();
 console.log(JSON.stringify({kind:'traffic-game-capture',fixture:{validatedSynthetic:true,population:city.households.reduce((n,h)=>n+h.members,0),households:city.households.length,buildings:city.buildings.length,roadsBefore:startRoads,roadsAfter:city.cells.filter(c=>c.road).length},
  baseline1xSamples:30,captureMs:stat(captures.slice(0,30)),structuredCloneMs:stat(cloneMs.slice(0,30)),submitMs:stat(submits.slice(0,30)),postMessageMs:stat(posts),
  multiEdit:{bursts:bursts.length,editsPerBurst:4,measuredWorkMs:stat(bursts.map(x=>x.measuredWorkMs)),wallWithValidationMs:stat(bursts.map(x=>x.wallWithValidationMs)),details:bursts},worker:client.status,mainEventLoopDelayMs:{p95:delay.percentile(95)/1e6,max:delay.max/1e6},
  sourceBefore,sourceAfter,sourcesUnchanged:stable,cityCaptureUnchanged:true,cityAfterEditStrictlyValidated:true,note:'Node main-side CPU capture + real worker-client dispatch, synthetic fixture; no actual browser paint or physical mobile proof.'}));if(!stable)process.exitCode=1;
}finally{delay.disable();client.dispose();}
