import test from 'node:test';import assert from 'node:assert/strict';import {trafficGameCase} from './traffic-game-cases.mjs';
test('normal execution remains full and fallback parts form the complete suite',()=>{
 const normal=trafficGameCase('full',false),fallback=trafficGameCase('full',true),core=trafficGameCase('core',true),extended=trafficGameCase('extended',true);
 assert.deepEqual([normal.core,normal.extended,normal.expectedChecks,normal.output],[true,true,9,'normal']);
 assert.deepEqual([fallback.core,fallback.extended,fallback.expectedChecks,fallback.output],[true,true,8,'fallback']);
 assert.deepEqual([core.core,core.extended,core.expectedChecks,core.output],[true,false,6,'fallback-core']);
 assert.deepEqual([extended.core,extended.extended,extended.expectedChecks,extended.output],[false,true,2,'fallback-extended']);
 assert.equal(core.expectedChecks+extended.expectedChecks,fallback.expectedChecks);assert.notEqual(core.output,extended.output);
 assert.throws(()=>trafficGameCase('core',false),/Only/);assert.throws(()=>trafficGameCase('extended',false),/Only/);assert.throws(()=>trafficGameCase('typo',true),/Unknown/);
});
