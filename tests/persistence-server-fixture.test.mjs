import test from 'node:test';import assert from 'node:assert/strict';import{randomUUID}from'node:crypto';
import {startPersistenceFixture} from './persistence-server-fixture.mjs';
import {createServer} from 'node:http';
test('loopback persistence fixture creates a real service ACK and injected failure cannot change its head',async()=>{
 const upstream=createServer((req,res)=>res.end('fixture'));await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
 const f=await startPersistenceFixture(`http://127.0.0.1:${upstream.address().port}/CityManager/`);
 try{
  const {createCity,serialize}=await import('../src/sim.ts');const raw=serialize(createCity(61025));
  const ack=await f.fixture.seed(raw);assert.equal(ack.revision,1);assert.equal(ack.raw,raw);
  const before=f.fixture.active,key=randomUUID(),command={action:'save',cityId:ack.cityId,expectedRevision:ack.revision,raw,metadata:ack.metadata};
  const post=(requestKey,body)=>fetch(new URL('/citymanager-api/v1/city-save',f.url),{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':requestKey},body:JSON.stringify(body)});
  f.setSaveFailure(true);const res=await post(key,command);
  assert.equal(res.status,503);assert.deepEqual(await res.json(),{error:'synthetic-save-unavailable'});assert.deepEqual(f.fixture.active,before);assert.equal(f.rejected.length,1);
  assert.equal(f.rejected[0].requestKey,key);assert.deepEqual(f.rejected[0].command,command);
  f.setSaveFailure(false);const retry=await post(key,command);assert.equal(retry.status,200);const first=await retry.json();assert.equal(first.revision,2);assert.equal(first.raw,raw);
  const next=await post(randomUUID(),{...command,expectedRevision:2});assert.equal(next.status,200);const second=await next.json();assert.equal(second.revision,3);assert.equal(second.raw,raw);
  const read=await fetch(new URL('/citymanager-api/v1/city-save',f.url));assert.equal(read.status,200);assert.deepEqual(await read.json(),second);
  assert.deepEqual(f.errors,[]);
 }finally{await f.close();await new Promise(r=>upstream.close(r));}
});
test('fixture refuses non-loopback upstream',async()=>{await assert.rejects(startPersistenceFixture('https://example.com/'));});

test('persistence fixture exposes normal and synthetic failure diagnostics without payloads',async()=>{
 const upstream=createServer((_req,res)=>res.end('fixture'));await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
 const f=await startPersistenceFixture(`http://127.0.0.1:${upstream.address().port}/CityManager/`);
 try{
  const {createCity,serialize}=await import('../src/sim.ts');const raw=serialize(createCity(61025)),before=await f.fixture.seed(raw);
  const post=()=>fetch(new URL('/citymanager-api/v1/city-save',f.url),{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':'private-key'},body:'private-malformed-body'});
  assert.equal((await post()).status,500);assert.equal(f.failureDetails[0].kind,'city-save');assert.equal(f.failureDetails[0].phase,'service');
  f.setSaveFailure(true);assert.equal((await post()).status,500);assert.equal(f.failureDetails[1].phase,'synthetic-reject');
  for(const detail of f.failureDetails){assert.equal(detail.bodyBytes,22);assert.equal(detail.bodyComplete,true);assert.equal(detail.requestComplete,true);assert.equal(detail.requestAborted,false);assert.equal(detail.serviceStatus,null);assert.equal(detail.errorName,'SyntaxError');}
  assert.equal(f.errors.length,2);assert.throws(()=>assert.deepEqual(f.errors,[]));assert.deepEqual(f.fixture.active,before);assert.deepEqual(f.rejected,[]);
  assert.doesNotMatch(JSON.stringify({errors:f.errors,details:f.failureDetails}),/private-|citymanager-api|idempotency|raw|stack/i);
  const {readFile}=await import('node:fs/promises'),source=await readFile(new URL('agriculture-smoke.mjs',import.meta.url),'utf8');
  assert.match(source,/assert\.deepEqual\(server\.errors,\[\]\)/,'Agriculture remains fail-closed');
  assert.match(source,/if\(server\.errors\.length\)console\.error\('HTTP fixture failure details:',JSON\.stringify\(server\.failureDetails\)\)/,'Agriculture exposes safe diagnostics on failure');
 }finally{await f.close();await new Promise(r=>upstream.close(r));}
});
