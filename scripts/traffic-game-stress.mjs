// Bounded allocation-game stress, NOT a browser/mobile/rendered-frame benchmark.
// node --experimental-strip-types scripts/traffic-game-stress.mjs --steps=60
// Run only on an isolated host; set --assert-mean-ms=N for a CI throughput gate.
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {serialize,deserialize,step} from '../src/sim.ts';
import {populationFixture} from '../tests/population-capacity-fixture.ts';
import {TrafficGame,captureTrafficGameSample,GAME_MAX_CARS,GAME_MAX_ODS,GAME_MAX_QUEUE,GAME_MAX_RATE} from '../src/traffic/game.ts';
const arg=(name,def)=>{const v=process.argv.find(x=>x.startsWith(`--${name}=`));return v?Number(v.slice(name.length+3)):def;};
const steps=arg('steps',60),limit=arg('assert-mean-ms',Infinity),p95Limit=arg('assert-p95-ms',Infinity);if(!Number.isSafeInteger(steps)||steps<1||steps>10000||!(limit>0)||!(p95Limit>0))throw Error('Invalid stress arguments');
const files=['src/traffic/game.ts','src/traffic/network.ts','src/traffic/routing.ts','src/road-topology.ts','src/sim.ts','tests/population-capacity-fixture.ts'];
const hashes=()=>Object.fromEntries(files.map(p=>[p,createHash('sha256').update(readFileSync(new URL('../'+p,import.meta.url))).digest('hex')]));const sourceBefore=hashes();
const city=populationFixture(334,true);step(city);const before=serialize(city);deserialize(before);const c0=performance.now(),citySample=captureTrafficGameSample(city),captureMs=performance.now()-c0;
const cityModel=new TrafficGame(citySample);for(let i=0;i<10;i++)cityModel.step();if(serialize(city)!==before)throw Error('Allocation game mutated City or its economic journals');
// Explicit all-road, 64-OD, maximum-rate synthetic load tests public caps. It
// represents pressure on the game abstraction, not 64 real trips or citizens.
const demand=Array.from({length:GAME_MAX_ODS},(_,i)=>({from:(i*7)%240,to:575-(i*5)%240,rate:GAME_MAX_RATE}));
const sample={map:{cells:Array.from({length:576},()=>({road:true}))},demand},constructAt=performance.now(),model=new TrafficGame(sample),constructMs=performance.now()-constructAt;
const times=[],rows=[];let maxCars=0,maxWaiting=0,maxError=0;
for(let i=1;i<=steps;i++){
 if(i===Math.floor(steps/3)){const map=structuredClone(sample.map);map.cells[275].road=false;model.setSample({map,demand});}
 if(i===Math.floor(steps*2/3))model.setSample(sample);
 const t=performance.now(),frame=model.step(),ms=performance.now()-t;times.push(ms);
 maxCars=Math.max(maxCars,frame.moving);maxWaiting=Math.max(maxWaiting,frame.waiting);
 const error=Math.abs(frame.offered-frame.completed-frame.dropped-frame.cancelled-frame.waiting-frame.moving);maxError=Math.max(maxError,error);
 if(frame.moving>GAME_MAX_CARS||frame.waiting>GAME_MAX_ODS*GAME_MAX_QUEUE+1e-7||error>1e-6)throw Error(`Allocation caps or accounting violated at step ${i}: ${error}`);
 rows.push({step:i,ms,moving:frame.moving,waiting:frame.waiting,blocked:frame.blocked,offered:frame.offered,completed:frame.completed,dropped:frame.dropped,cancelled:frame.cancelled});
}
const order=[...times].sort((a,b)=>a-b),mean=times.reduce((a,b)=>a+b,0)/times.length,p95=order[Math.min(order.length-1,Math.floor((order.length-1)*.95))];
const sourceAfter=hashes(),sourcesUnchanged=JSON.stringify(sourceBefore)===JSON.stringify(sourceAfter);
const report={kind:'traffic-game-stress',node:process.version,steps,sourceBefore,sourceAfter,sourcesUnchanged,fixture:{validatedSynthetic:true,population:city.households.reduce((n,h)=>n+h.members,0),buildings:city.buildings.length,roads:city.cells.filter(c=>c.road).length,demandRows:citySample.demand.length,sampleAssemblyMs:captureMs},worstCase:{roads:576,ods:GAME_MAX_ODS,rateEach:GAME_MAX_RATE,constructMs,meanMs:mean,p95Ms:p95,maxMs:Math.max(...times),maxCars,maxWaiting,maxError,final:rows.at(-1)},cadence:{actualGameStepMs:1000,meanComputeFraction:mean/1000,hypotheticalFiveSecondCycleMs:5000,hypotheticalRealTimeStepsPerCycle:5,note:'Illustrative only: this does not change or depend on the economic clock.'},rows,citySha256:createHash('sha256').update(before).digest('hex'),cityUnchanged:serialize(city)===before,note:'Synthetic Node host compute only: not browser frame, real-device/mobile or natural-city throughput.'};
console.log(JSON.stringify(report));if(mean>=limit||p95>=p95Limit||!sourcesUnchanged)process.exitCode=1;
