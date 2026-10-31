import {test} from 'node:test';import assert from 'node:assert/strict';
import {freshServerCityRaw} from '../src/fresh-server-city.ts';
import {deserializeParkSession} from '../src/park-runtime.ts';
test('fresh world has new disabled financial identity, empty journal and same Guest',()=>{
 const owner='11111111-1111-4111-8111-111111111111';const a=deserializeParkSession(freshServerCityRaw(owner)).city,b=deserializeParkSession(freshServerCityRaw(owner)).city;
 assert.equal(a.tick,0);assert.equal(a.market?.guestId,owner);assert.notEqual(a.market?.cityId,b.market?.cityId);
 assert.deepEqual(a.market?.operations,[]);assert.deepEqual(a.market?.escrow,[]);assert.deepEqual(a.market?.receipts,{});
 assert.equal(a.market?.seq,'0');
});
