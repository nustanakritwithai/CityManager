import test from 'node:test';
import assert from 'node:assert/strict';
import { isCommercial, serialize } from '../src/sim.ts';
import { createParkRuntime, serializeParkSession, deserializeParkSession } from '../src/park-runtime.ts';
import { executeOwnerProposal, validateOwnerProposal } from '../src/owner-decision.ts';
import { randomUUID } from 'node:crypto';
import { createTrafficServerFixture } from './traffic-server-entry-fixture.mjs';
import { ownerBrowserFixtures } from './owner-browser-fixture.ts';

test('natural migrated server fixtures contain a real commercial owner and executable proposal', () => {
  const { monthly, manual, proposal } = ownerBrowserFixtures();
  assert.equal(monthly.tick % 30, 29); assert.equal(monthly.cells.length, 672); assert.equal(manual.cells.length, 672);
  assert.ok(manual.firms.some(f => f.id === proposal.snapshot.firmId && isCommercial(f) && f.owner));
  assert.equal(validateOwnerProposal(manual, proposal).ok, true);
  const raw = serializeParkSession(manual, createParkRuntime(manual));
  assert.equal(serialize(deserializeParkSession(raw).city), serialize(manual));
  const result = executeOwnerProposal(manual, proposal); assert.equal(result.status, 'applied');
});


test('a real owner command survives the isolated server ACK and round trip', async () => {
  const {manual,proposal}=ownerBrowserFixtures(), service=createTrafficServerFixture('http://127.0.0.1:4191/CityManager/');
  const before=serializeParkSession(manual,createParkRuntime(manual)),ack=await service.seed(before);
  assert.equal(executeOwnerProposal(manual,proposal).status,'applied');
  const expected=serializeParkSession(manual,createParkRuntime(manual)); assert.notEqual(expected,before);
  const request={requestId:randomUUID(),request:{url:'http://127.0.0.1:4191/citymanager-api/v1/city-save',method:'POST',headers:{'Idempotency-Key':randomUUID()},postData:JSON.stringify({action:'save',cityId:ack.cityId,expectedRevision:ack.revision,raw:expected,metadata:ack.metadata})}};
  let status=0;await service.intercept(request,async(_method:string,payload:{responseCode:number})=>{status=payload.responseCode;});
  assert.equal(status,200);service.assertDurable(expected,2);assert.equal(serialize(deserializeParkSession(service.active!.raw).city),serialize(manual));
});
