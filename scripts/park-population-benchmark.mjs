// Diagnostic CPU measurements, not a frame-rate or physical-device guarantee.
import { performance } from 'node:perf_hooks';
import { parkPopulationFixture } from '../tests/park-population-fixture.ts';
import { createParkRuntime, advanceParkRuntime, serializeParkSession } from '../src/park-runtime.ts';
import { step, summary } from '../src/sim.ts';
import { assertServerCitySize } from '../src/server-save-size.ts';
const rows=[];
for(const families of [683,1366,3000]){
 const city=parkPopulationFixture(families),runtime=createParkRuntime(city),elapsed=[];
 advanceParkRuntime(city,runtime,600,()=>step(city));
 for(let n=0;n<20;n++){
  const start=performance.now();advanceParkRuntime(city,runtime,10,()=>step(city));elapsed.push((performance.now()-start)/10);
 }
 elapsed.sort((a,b)=>a-b);const raw=serializeParkSession(city,runtime);assertServerCitySize(raw);
 rows.push({population:summary(city).population,observedGameMinutes:200,parks:city.parks.length,earnedRecords:Object.keys(runtime.recreation.citizens).length,p50CpuMsPerMinute:elapsed[10],p95CpuMsPerMinute:elapsed[18],saveBytes:Buffer.byteLength(raw)});
}
console.log(JSON.stringify({environment:`Node ${process.version} ${process.platform}/${process.arch}`,syntheticFixtures:true,physicalDeviceTest:false,rows},null,2));
