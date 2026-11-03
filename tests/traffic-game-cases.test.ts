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

test('work-expiry native case is an additional normal-asset partition',()=>{
 const work=trafficGameCase('work-expiry',false);assert.equal(work.workExpiry,true);assert.equal(work.expectedChecks,4);
 assert.equal(work.output,'normal-work-expiry');assert.equal(work.lifecycle||work.economy||work.bypass||work.dense||work.peak,false);
 assert.throws(()=>trafficGameCase('work-expiry',true),/normal assets/);
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

test('four disjoint fault jobs preserve all seven assertions exactly once with unchanged watchdog',async()=>{
 const {trafficFaultCase}=await import('./traffic-game-cases.mjs'),{readFileSync}=await import('node:fs');const full=trafficFaultCase(),parts=['preferences','economy','construct','async'].map(trafficFaultCase);
 assert.equal(full.expectedChecks,7);assert.equal(parts.reduce((n,p)=>n+p.expectedChecks,0),7);assert.equal(parts.filter(p=>p.preferences).length,1);assert.equal(parts.filter(p=>p.economy).length,1);assert.deepEqual(parts.flatMap(p=>p.faults),['construct','async']);assert.throws(()=>trafficFaultCase('typo'),/Unknown/);
 const source=readFileSync(new URL('traffic-default-fault-smoke.mjs',import.meta.url),'utf8');assert.match(source,/180000/);assert.match(source,/for\(const fault of testPlan\.faults\)/);assert.match(source,/await threeDays\(\);const workers=await assertFaultWorkers/);assert.match(source,/checks.length,testPlan.expectedChecks/);assert.match(source,/if\(testPlan.preferences\)/);assert.match(source,/if\(testPlan.economy\)/);
 assert.match(source,/UI OFF is visit-only/);assert.match(source,/legacy traffic preference ignored/);assert.match(source,/traffic preference avoids browser writes/);
 const reload=source.slice(source.indexOf('async function literalReload(){'),source.indexOf('/** Creation can happen'));
 assert.ok(reload.startsWith('async function literalReload(){'),'Literal reload helper is present');
 // Verify each actual assertion and operation in order: do not treat a read or
 // navigation call by itself as proof that the current session was durably saved.
 const sequence=[
  "await settleInterceptions();await server.settle();const before=server.active;",
  "assert.equal(await evaluate('window.cityManager.parks().paused'),true);",
  "const outgoing=await evaluate('window.cityManager.sessionSnapshot()');",
  "assert.equal(serialize(loadedTrafficSession(outgoing).city),cityRaw",
  "server.allowNavigation(outgoing);await send('Page.reload');await server.enter({send,evaluate,button,until});",
  "assert.notEqual(await evaluate('window.__boot'),oldBoot);",
  "const navigation=server.navigationEvidence.at(-1);",
  "assert.equal(server.active.raw,navigation.lifecycleSaves ? outgoing : before.raw",
  "assert.equal(server.active.cityId,before.cityId);",
  "assert.equal(navigation.beforeRevision,before.revision",
  "assert.equal(await evaluate('window.cityManager.snapshot()'),cityRaw);await preserved();",
 ];
 const verifyReload=(text:string)=>{let at=-1;for(const part of sequence){const next=text.indexOf(part,at+1);assert.ok(next>at,`Missing or out-of-order reload proof: ${part}`);at=next;}};
 verifyReload(reload);
 // A dropped pause/capture/ACK assertion or reordered permission must fail.
 for(const i of [1,2,3,4,7,8,9,10])assert.throws(()=>verifyReload(reload.replace(sequence[i],'')),/Missing or out-of-order reload proof/);
 const unpaused=reload.replace(sequence[1],'').replace(sequence[2],`${sequence[2]}${sequence[1]}`);assert.throws(()=>verifyReload(unpaused),/Missing or out-of-order reload proof/);

 assert.match(source,/button\('#atmosphere-toggle'\);await button\('input\[name="atmosphere-time"\]\[value="noon"\]'\)/,'Decorative fallback sets noon through the current page-memory UI');
 assert.match(source,/server\.active\.raw,await evaluate\('window\.cityManager\.sessionSnapshot\(\)'\)/,'Paused revealed session must receive an exact server ACK');assert.match(source,/await revealDecorativeCars\(\);await acknowledgeRevealedSession\(\);await literalReload\(\)/);
});
