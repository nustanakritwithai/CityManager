import test from 'node:test';
import assert from 'node:assert/strict';
import {createCity,step} from '../src/sim.ts';
import {createParkRuntime,advanceParkRuntime,serializeParkSession,deserializeParkSession} from '../src/park-runtime.ts';

test('education v22 city with park clock saves and loads without losing education or people',()=>{
 const city=createCity(61025),runtime=createParkRuntime(city);
 advanceParkRuntime(city,runtime,1440+421.25,()=>step(city));
 const raw=serializeParkSession(city,runtime),envelope=JSON.parse(raw);assert.equal(envelope.version,22);assert.equal(envelope.rulesVersion,'chain-17');
 const restored=deserializeParkSession(raw);assert.deepEqual(restored.city,city);assert.deepEqual(restored.runtime,runtime);
 assert.equal(serializeParkSession(restored.city,restored.runtime),raw);
});
test('education version does not admit a mismatched rules tag or corrupt park clock',()=>{
 const city=createCity(61025),runtime=createParkRuntime(city),raw=JSON.parse(serializeParkSession(city,runtime));
 const wrong=structuredClone(raw);wrong.rulesVersion='chain-16';assert.throws(()=>deserializeParkSession(JSON.stringify(wrong)));
 const corrupt=structuredClone(raw);corrupt.parkRuntime.activity.day++;assert.throws(()=>deserializeParkSession(JSON.stringify(corrupt)));
});
