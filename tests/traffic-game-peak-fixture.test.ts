import test from 'node:test';
import assert from 'node:assert/strict';
import {serialize} from '../src/sim.ts';
import {createParkRuntime,serializeParkSession,deserializeParkSession} from '../src/park-runtime.ts';
import {TrafficGame,captureTrafficGameSample,GAME_MAX_CARS} from '../src/traffic/game.ts';
import {gamePoses,GAME_VISUAL_CAR_CAP} from '../src/traffic/game-poses.ts';
import {trafficGamePeakFixture} from './traffic-game-peak-fixture.ts';

test('validated stress city produces near-cap real model poses without changing city bytes',()=>{
 const city=trafficGamePeakFixture(),before=serialize(city);
 assert.equal(city.households.reduce((n,h)=>n+h.members,0),2000);
 assert.equal(city.cells.filter(c=>c.road).length,490);
 const runtime=createParkRuntime(city),session=serializeParkSession(city,runtime);
 assert.equal(serialize(deserializeParkSession(session).city),before);
 const sample=captureTrafficGameSample(city),game=new TrafficGame(sample);
 assert.equal(sample.demand.length,42);
 let peakMoving=0,peakPoses=0,peakUncapped=0;const twin=game.clone();
 for(let step=1;step<=15;step++){
  const frame=game.step(),other=twin.step(),beforeFrame=structuredClone(frame);peakMoving=Math.max(peakMoving,frame.moving);
  const capped=gamePoses(frame.cars,frame.groups),uncapped=gamePoses(other.cars,other.groups,24,2,128);
  peakPoses=Math.max(peakPoses,capped.length);peakUncapped=Math.max(peakUncapped,uncapped.length);
  assert.deepEqual(frame,beforeFrame);assert.deepEqual(frame,other,'visual sampling never changes frame, queues or heat');assert.deepEqual(game,twin,'full bounded model/OD state stays identical');
 }
 assert.equal(peakMoving,GAME_MAX_CARS);assert.equal(peakPoses,GAME_VISUAL_CAR_CAP);assert.ok(peakUncapped>=120,'real model still supports the uncapped representative fixture');
 assert.equal(serialize(city),before);assert.equal(serializeParkSession(city,runtime),session);
});
