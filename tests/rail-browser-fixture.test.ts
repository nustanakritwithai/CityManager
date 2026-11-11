import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {deserializeParkSession,expandValidatedParkSession,serializeParkSession,advanceParkRuntime} from '../src/park-runtime.ts';
import {step} from '../src/sim.ts';
import {captureTrafficGameInput,trafficGameSampleFromInput} from '../src/traffic/game.ts';
import {railGameCovers} from '../src/rail/game-rail.ts';

test('real rail browser fixture has empty legal track cells and covered road demand',()=>{
 const raw=readFileSync(new URL('fixtures/save-smoke/bus-optional-day60.json',import.meta.url),'utf8');
 const {city}=expandValidatedParkSession(deserializeParkSession(raw));
 for(const cell of [315,317,339,340,341]){
  assert.deepEqual(city.cells[cell],{road:false,zone:null,building:null},`track cell ${cell}`);
  assert.equal(city.parks.some(p=>p.cell===cell)||city.plants.some(p=>p.cell===cell)||!!city.education?.campuses.some(p=>p.cell===cell),false);
 }
 const sample=trafficGameSampleFromInput(captureTrafficGameInput(city,{taxiEnabled:true}));
 assert.ok(sample.demand.some(d=>d.rate>0&&railGameCovers(sample.map,[315,317],d.from,d.to)),'saved city must contain covered road demand');
});

test('rail browser fixture keeps its legacy version until gameplay creates the v28 envelope',()=>{
 const raw=readFileSync(new URL('fixtures/save-smoke/bus-optional-day60.json',import.meta.url),'utf8');
 const {city,runtime}=expandValidatedParkSession(deserializeParkSession(raw));
 const before=JSON.parse(serializeParkSession(city,runtime));
 assert.equal(before.version,27);assert.equal(city.happiness,undefined);
 advanceParkRuntime(city,runtime,1440,()=>step(city));
 const saved=serializeParkSession(city,runtime),after=JSON.parse(saved);
 assert.equal(after.version,28);assert.equal(after.mapBaseVersion,before.mapBaseVersion);
 const loaded=deserializeParkSession(saved);assert.equal(serializeParkSession(loaded.city,loaded.runtime),saved);
});
