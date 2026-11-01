import test from 'node:test';import assert from 'node:assert/strict';import {trafficGameCase} from './traffic-game-cases.mjs';
test('disjoint CI partitions preserve every former full/core/extended assertion and paired comparison',()=>{
 for(const blocked of [false,true]){
  const full=trafficGameCase('full',blocked),extended=trafficGameCase('extended',blocked),names=blocked?['lifecycle','economy','bypass','dense']:['lifecycle','economy','bypass','dense','peak'];
  const parts=names.map(n=>trafficGameCase(n,blocked));assert.equal(full.expectedChecks,blocked?8:9);assert.equal(extended.expectedChecks,blocked?2:3);
  assert.equal(parts.reduce((n,p)=>n+p.expectedChecks,0),full.expectedChecks);
  assert.equal(new Set(parts.map(p=>p.output)).size,parts.length);
  for(const flag of ['lifecycle','economy','bypass','dense','peak'])assert.equal(parts.filter(p=>p[flag]).length,full[flag]?1:0,`${flag} covered exactly once`);
  assert.equal(parts.filter(p=>p.economy).length,1,'ON/OFF economy replay and paused road accounting remain together');
  assert.equal(parts.filter(p=>p.dense).length,1,'OFF/ON dense pair remains together');assert.equal(parts.filter(p=>p.peak).length,blocked?0:1,'All three normal peak pairs remain together');
  assert.equal(trafficGameCase('core',blocked).expectedChecks+extended.expectedChecks,full.expectedChecks);
 }
 assert.throws(()=>trafficGameCase('peak',true),/normal assets/);assert.throws(()=>trafficGameCase('typo',true),/Unknown/);
});

test('standalone mobile partitions load the actual viewport-meta page before asserting 390px',async()=>{
 const {readFileSync}=await import('node:fs');const source=readFileSync(new URL('traffic-game-smoke.mjs',import.meta.url),'utf8');
 assert.match(source,/viewport\(true,false\);d=await navigate\(denseRaw,'\?traffic=0',blocked\)/,'OFF boots at the same mobile metrics as ON');
 assert.match(source,/if\(testPlan\.peak\)\{\s*await viewport\(true,false\)/);
 assert.match(source,/navigate\(denseRaw,'\?traffic=0',blocked\);await viewport\(true\)/);
 assert.match(source,/navigate\(peakRaw,'\?traffic=0'\);await viewport\(true\)/);
 assert.doesNotMatch(source,/if\(testPlan\.(dense|peak)\)\{\s*await viewport\(true\)/);
 assert.match(source,/innerWidth===\$\{mobile\?390:1440\}/,'actual mobile width assertion remains mandatory');
});
