import test from 'node:test';
import assert from 'node:assert/strict';
import {busCommuteBrowserFixture} from './bus-commute-browser-fixture.ts';
import {deserializeParkSession} from '../src/park-runtime.ts';
import {captureTrafficGameInput,trafficGameSampleFromInput} from '../src/traffic/game.ts';
import {createTrafficGameWorkerEngine} from '../src/traffic/game-worker-engine.ts';
import {BusGameBridge} from '../src/bus/game-bridge.ts';
test('browser bus fixture roundtrips and employer lies beyond nearest-two demand',()=>{
 const f=busCommuteBrowserFixture(),{city}=deserializeParkSession(f.raw),bridge=new BusGameBridge(city,420);
 assert.equal(city.households.reduce((n,h)=>n+h.members,0),4);assert.equal(bridge.engine.snapshot().length,3);
 const input=captureTrafficGameInput(city,{busCommutes:true});
 assert.deepEqual(input.commutes,[{home:f.home,work:f.work,workers:4}]);
 const legacy=trafficGameSampleFromInput(input);assert.equal(legacy.demand.filter(d=>d.from===f.homeRoad).length,2);assert.ok(legacy.demand.every(d=>d.to!==f.workRoad));
 input.bus=bridge.input();const actual=trafficGameSampleFromInput(input);assert.ok(actual.demand.some(d=>d.from===f.homeRoad&&d.to===f.workRoad));
 const worker=createTrafficGameWorkerEngine();let waitingAt:number|null=null,boardedAt:number|null=null;
 for(let seq=1;seq<=200;seq++){
  input.bus=bridge.input();const out=worker({kind:'compute',epoch:'browser-fixture',seq,commitPrevious:seq>1,advance:true,paused:false,sample:input});
  assert.equal(out.kind,'frame');if(out.kind!=='frame')throw Error(out.message);
  bridge.onFrame(out.frame.bus,420+seq/60);bridge.tick(420+seq/60);
  const e=bridge.ledger();assert.equal(e.engineError,0);assert.ok(Math.abs(e.splitError)<1e-8);
  if(e.engine.waiting>0)waitingAt??=seq;if(e.engine.onboard+e.engine.completed>0)boardedAt??=seq;
 }
 assert.ok(waitingAt!==null&&waitingAt<=60,`waiting begins in ${waitingAt} steps`);
 assert.ok(boardedAt!==null&&boardedAt<=200,`boarding begins in ${boardedAt} steps`);
});
