// Synthetic non-browser stress: node --experimental-strip-types scripts/traffic-game-worker-benchmark.mjs
// 576 roads, 64 representative OD rows; burst coalescing + one-second cadence.
// Does not prove browser rendering or mobile-device performance.
import {Worker} from 'node:worker_threads';import {performance} from 'node:perf_hooks';
import {createTrafficGameClient} from '../src/traffic/game-worker-client.ts';
const worker=new Worker(new URL('./traffic-game-worker-node.mjs',import.meta.url),{execArgv:['--experimental-strip-types']});
const port={postMessage:m=>worker.postMessage(m),terminate:()=>{void worker.terminate();},addEventListener:(kind,fn)=>worker.on(kind,kind==='message'?data=>fn({data}):fn)};
const sample={map:{cells:Array.from({length:576},()=>({road:true}))},homes:Array.from({length:32},(_,i)=>({cell:i,amount:100})),destinations:Array.from({length:32},(_,i)=>({cell:575-i,amount:100}))};
const latencies=[],dispatch=[],cadenceDispatch=[],heartbeats=[];let last=performance.now(),lastSent=0,lastFrame=null,fault=null;
const heartbeat=setInterval(()=>{const now=performance.now();heartbeats.push(now-last);last=now;},16);
const client=createTrafficGameClient(port,'bench',{onFrame:frame=>{lastFrame=frame;latencies.push(performance.now()-lastSent);},onFailure:m=>{fault=m;}},30_000);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
try{
 const start=performance.now();for(let i=0;i<500;i++){const t=performance.now();lastSent=t;client.submit(sample,{advance:true,paused:false});dispatch.push(performance.now()-t);}
 const peakOutstanding=Number(client.status.inflight)+Number(client.status.pending);let deadline=performance.now()+30_000;
 while((client.status.inflight||client.status.pending)&&!fault&&performance.now()<deadline)await wait(5);
 if(fault||client.status.inflight||client.status.pending)throw Error(fault||'drain timed out');
 const burstMs=performance.now()-start;heartbeats.length=0;latencies.length=0;
 for(let i=0;i<5;i++){await wait(1000);lastSent=performance.now();client.submit(sample,{advance:true,paused:false});cadenceDispatch.push(performance.now()-lastSent);deadline=performance.now()+30_000;while((client.status.inflight||client.status.pending)&&!fault&&performance.now()<deadline)await wait(5);if(fault||client.status.inflight||client.status.pending)throw Error(fault||'cadence timed out');}
 dispatch.sort((a,b)=>a-b);cadenceDispatch.sort((a,b)=>a-b);latencies.sort((a,b)=>a-b);heartbeats.sort((a,b)=>a-b);const pct=(a,p)=>a[Math.min(a.length-1,Math.floor(a.length*p))]??0;
 console.log(JSON.stringify({burstSubmissions:500,peakOutstanding,coalesced:client.status.coalesced,burstMs,burstDispatchP95Ms:pct(dispatch,.95),cadenceDispatchP95Ms:pct(cadenceDispatch,.95),cadenceResponseP95Ms:pct(latencies,.95),cadenceHeartbeatP95Ms:pct(heartbeats,.95),cadenceHeartbeatMaxMs:Math.max(0,...heartbeats),frameStep:lastFrame?.step,moving:lastFrame?.moving,note:'Node synthetic; not real browser or mobile evidence.'}));
}finally{clearInterval(heartbeat);client.dispose();}
