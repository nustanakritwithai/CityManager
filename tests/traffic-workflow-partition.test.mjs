import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const normalize=s=>s.replace(/\r\n/g,'\n');
const text=normalize(readFileSync(new URL('../.github/workflows/traffic-enabled.yml',import.meta.url),'utf8'));
assert.equal(normalize(text.replace(/\n/g,'\r\n')),text,'Windows CRLF and Unix LF must parse identically');
const job=name=>{const marker=`\n  ${name}:\n`,start=text.indexOf(marker);assert.ok(start>=0,`Missing job ${name}`);const body=text.slice(start+marker.length),next=body.search(/\n  [a-z]+:\n/);return next<0?body:body.slice(0,next);};
test('traffic acceptance partitions bounded cases and gates every result',()=>{
 const checks=job('checks'),fault=job('fault'),browser=job('browser'),gate=job('enabled');
 for(const part of [checks,fault,browser,gate])assert.match(part,/timeout-minutes: 10/);
 assert.match(checks,/traffic-game-cases\.test\.ts/);assert.match(checks,/traffic-game-stress\.mjs --steps=60 --assert-mean-ms=750 --assert-p95-ms=1000/);
 assert.match(fault,/needs: checks/);assert.match(fault,/traffic-default-fault-smoke\.mjs/);assert.match(fault,/traffic-game-fault-evidence/);
 assert.match(browser,/needs: checks/);assert.match(browser,/fail-fast: false/);assert.match(browser,/- case: full\s+blocked: '0'\s+software: '0'/);assert.match(browser,/- case: core\s+blocked: '1'\s+software: '1'/);assert.match(browser,/- case: extended\s+blocked: '1'\s+software: '1'/);
 assert.match(browser,/TRAFFIC_GAME_CASE: \$\{\{ matrix\.case \}\}/);assert.match(browser,/traffic-game-\$\{\{ matrix\.case \}\}-evidence/);assert.match(browser,/traffic-game-smoke\.mjs/);
 assert.match(gate,/needs: \[checks, fault, browser\]/);assert.match(gate,/if: always\(\)/);for(const name of ['checks','fault','browser'])assert.match(gate,new RegExp(`needs\\.${name}\\.result.*'success'`));
 assert.match(text,/permissions:\s+contents: read/);assert.equal((text.match(/TRAFFIC_GAME_EXPECT_DEFAULT: '1'/g)??[]).length,1);
});

test('exact scoped routing propagates to downstream traffic jobs and aggregate without accepting failed checks',()=>{
 const scoped=['vehicle','visual-final','server-save','classic-toolbar','history','commercial'];
 const checks=job('checks'),gate=job('enabled');
 const exclusions=part=>[...part.matchAll(/(?:steps\.scope|needs\.checks)\.outputs\.kind != '([^']+)'/g)].map(m=>m[1]);
 const checkRoutes=[...new Set(exclusions(checks))];assert.deepEqual(checkRoutes,scoped);
 for(const name of ['fault','browser']){
  const header=job(name).split('runs-on:')[0];
  assert.match(header,/needs: checks/);
  const excluded=exclusions(header);assert.deepEqual(excluded,scoped,`${name} must use the same exact scopes as unit job`);
  const shouldRun=kind=>excluded.every(scope=>scope!==kind);
  for(const kind of scoped)assert.equal(shouldRun(kind),false);
  for(const kind of ['full','',undefined,'unknown','commercial-plus-auth'])assert.equal(shouldRun(kind),true,'Unknown scope retains traffic checks');
 }
 const list=gate.match(/needs\.checks\.outputs\.kind \}\}' -in @\(([^)]+)\)/);assert(list);
 assert.deepEqual([...list[1].matchAll(/'([^']+)'/g)].map(m=>m[1]),scoped);
 const branch=gate.slice(gate.indexOf("-in @("),gate.indexOf('exit 0'));
 assert.match(branch,/needs\.checks\.result \}\}' -ne 'success'\) \{ throw/,'A scoped path still requires successful classifier/regression checks');
 for(const name of ['checks','fault','browser'])assert.match(gate,new RegExp(`needs\\.${name}\\.result.*'success'`));
});
