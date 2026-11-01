import test from 'node:test';
import assert from 'node:assert/strict';
import {bulldoze} from '../src/sim.ts';
import {captureTrafficGameInput,trafficGameSampleFromInput,TrafficGame} from '../src/traffic/game.ts';
import {deserializeParkSession} from '../src/park-runtime.ts';
import {workExpiryBrowserFixture} from './traffic-work-expiry-browser-fixture.ts';

test('browser fixture has validated employment and a future road closure for actual work actors',()=>{
 const {city,runtime,raw,closedRoad}=workExpiryBrowserFixture();
 assert.equal(deserializeParkSession(raw).runtime.activity.minute,1018);
 const input=captureTrafficGameInput(city,{workClock:{day:runtime.activity.day,minute:1018,ack:0}});
 assert.ok(input.work!.candidates.length>0,'Real employment supplies work candidates');
 const game=new TrafficGame(trafficGameSampleFromInput(input));game.setWork(input.work!);
 const first=game.step(),work=new Set(first.workTrips?.map(t=>t.id));
 const targets=first.cars.filter(c=>work.has(c.id)&&c.destination===closedRoad+1);
 assert.ok(targets.length>0,'Actual generated work actors approach the fixture closure');
 assert.ok(first.cars.every(c=>c.from!==closedRoad&&c.to!==closedRoad),'Closure is unoccupied');
 assert.equal(bulldoze(city,closedRoad).ok,true,'Closure uses the actual city command');
 const next=captureTrafficGameInput(city,{workClock:{day:runtime.activity.day,minute:1018,ack:0}});
 game.setSample(trafficGameSampleFromInput(next));game.setWork(next.work!);
 const after=game.frame;
 assert.ok(targets.every(t=>after.cars.some(c=>c.id===t.id&&c.blocked)), 'Same work identities are blocked after real road edit');
});

test('signal fixture offers a real work car a red phase then later movement',()=>{
 const {city,runtime}=workExpiryBrowserFixture('signal');
 const input=captureTrafficGameInput(city,{workClock:{day:runtime.activity.day,minute:runtime.activity.minute,ack:0}});
 const game=new TrafficGame(trafficGameSampleFromInput(input));game.setWork(input.work!);
 let waiting:{id:number;from:number;to:number;progress:number}|undefined,advanced=false;
 for(let i=0;i<30;i++){
  game.setWork({...input.work!,minute:Math.min(1439,runtime.activity.minute+i)});
  const frame=game.step(),ids=new Set(frame.workTrips?.map(t=>t.id));
  if(!waiting&&runtime.activity.minute+i>=1020){const car=frame.cars.find(c=>ids.has(c.id)&&c.blocked&&frame.signals?.phases.some(p=>p.node===c.to&&(p.state!=='green'||p.approach!==c.from)));if(car)waiting={id:car.id,from:car.from,to:car.to,progress:car.progress??0};}
  else if(waiting){const car=frame.cars.find(c=>c.id===waiting!.id);if(car&&(car.from!==waiting.from||car.to!==waiting.to||(car.progress??0)>waiting.progress+1e-6)){advanced=true;break;}}
 }
 assert.ok(waiting,'A real work identity is stopped at a red signal');assert.ok(advanced,'The same work identity advances in a later worker frame');
});
