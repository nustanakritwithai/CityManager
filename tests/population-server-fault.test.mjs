import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {createCity,serialize} from '../src/sim.ts';
import {createTrafficServerFixture} from './traffic-server-entry-fixture.mjs';
import {installPopulationSaveFault} from './population-server-fault.mjs';
const url='http://127.0.0.1:4173/CityManager/';
test('synthetic 503 never mutates the real service, exact retry gets one actual ACK',async()=>{
 const server=createTrafficServerFixture(url),fault=installPopulationSaveFault(server),raw=serialize(createCity(91)),before=await server.seed(raw),responses=[];
 const key=randomUUID(),command={action:'save',cityId:before.cityId,expectedRevision:before.revision,raw,metadata:before.metadata};
 const req={requestId:'save',request:{url:new URL('/citymanager-api/v1/city-save',url).href,method:'POST',headers:{'Idempotency-Key':key},postData:JSON.stringify(command)}};
 const send=async(method,payload)=>{assert.equal(method,'Fetch.fulfillRequest');responses.push(payload);};
 fault.arm();await server.intercept(req,send);assert.equal(responses.at(-1).responseCode,503);assert.deepEqual(server.active,before);assert.equal(server.writes.length,0);
 assert.equal(fault.failures[0].key,key);assert.deepEqual(fault.failures[0].command,command);
 await server.intercept(req,send);assert.equal(responses.at(-1).responseCode,200);assert.equal(server.active.revision,before.revision+1);assert.equal(server.active.raw,raw);assert.equal(server.writes[0].requestKey,key);assert.deepEqual(server.writes[0].command,command);
});
