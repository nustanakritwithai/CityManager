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

// Keep worker demand on its one-second wall cadence and physical bus movement
// on a distinct render clock. No inserted riders, clock jumps or frame facts.
// The low-FPS case models the CI artifact's capped dt, not accelerated playback.
for(const timing of [{name:'60fps',wallDt:1/60,physicalDt:1/60},{name:'software-renderer capped dt',wallDt:.4,physicalDt:.1}]){
 test(`first bus boards at its first stop within 20 physical seconds (${timing.name})`,()=>{
  const f=busCommuteBrowserFixture(),{city}=deserializeParkSession(f.raw),bridge=new BusGameBridge(city,420),worker=createTrafficGameWorkerEngine();
  let seq=0,physicalSeconds=0,wallSeconds=0,lastWorkerSecond=0,waitingSeconds:number|null=null;
  let boarding:{physicalSeconds:number;wallSeconds:number;busId:string;persons:number}|null=null;
  while(wallSeconds<100&&!boarding){
   wallSeconds+=timing.wallDt;physicalSeconds+=timing.physicalDt;
   const minute=420+physicalSeconds/60;
   bridge.tick(minute);
   if(Math.floor(wallSeconds+1e-8)>lastWorkerSecond){
    lastWorkerSecond=Math.floor(wallSeconds+1e-8);
    const sample=captureTrafficGameInput(city,{busCommutes:true});sample.bus=bridge.input();
    const out=worker({kind:'compute',epoch:timing.name,seq:++seq,commitPrevious:seq>1,advance:true,paused:false,sample});
    assert.equal(out.kind,'frame');if(out.kind!=='frame')throw Error(out.message);
    bridge.onFrame(out.frame.bus,minute);
   }
   const ledger=bridge.ledger();if(ledger.engine.waiting>0)waitingSeconds??=physicalSeconds;
   assert.equal(ledger.engineError,0);assert.ok(Math.abs(ledger.splitError)<1e-8);
   const event=bridge.engine.drainEvents().find(e=>e.kind==='board');
   if(event)boarding={physicalSeconds,wallSeconds,busId:event.busId,persons:event.persons};
  }
  assert.ok(boarding,'Natural first-arrival boarding must occur inside 100 wall seconds');
  assert.ok(waitingSeconds===null||waitingSeconds<=boarding.physicalSeconds);
  assert.ok(boarding.physicalSeconds>=2.5-1e-6&&boarding.physicalSeconds<=20);
  assert.equal(boarding.busId,bridge.engine.snapshot()[0].id,'First bus serves waiting riders, without awaiting a later headway');
  assert.ok(boarding.persons>=1);
 });
}
