import test from 'node:test';
import assert from 'node:assert/strict';
import {serialize} from '../src/sim.ts';
import {createParkRuntime,serializeParkSession,deserializeParkSession} from '../src/park-runtime.ts';
import {TrafficGame,captureTrafficGameSample,GAME_MAX_CARS} from '../src/traffic/game.ts';
import {gamePoses} from '../src/traffic/game-poses.ts';
import {trafficGamePeakFixture} from './traffic-game-peak-fixture.ts';

test('validated stress city produces near-cap real model poses without changing city bytes',()=>{
 const city=trafficGamePeakFixture(),before=serialize(city);
 assert.equal(city.households.reduce((n,h)=>n+h.members,0),2000);
 assert.equal(city.cells.filter(c=>c.road).length,490);
 const session=serializeParkSession(city,createParkRuntime(city));
 assert.equal(serialize(deserializeParkSession(session).city),before);
 const sample=captureTrafficGameSample(city),game=new TrafficGame(sample);
 assert.equal(sample.demand.length,42);
 let peakMoving=0,peakPoses=0;
 for(let step=1;step<=15;step++){
  const frame=game.step();peakMoving=Math.max(peakMoving,frame.moving);
  peakPoses=Math.max(peakPoses,gamePoses(frame.cars,frame.groups).length);
 }
 assert.equal(peakMoving,GAME_MAX_CARS);assert.ok(peakPoses>=120);
 assert.equal(serialize(city),before);
});
