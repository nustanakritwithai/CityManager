import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {deserializeParkSession,expandValidatedParkSession} from '../src/park-runtime.ts';
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
