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
