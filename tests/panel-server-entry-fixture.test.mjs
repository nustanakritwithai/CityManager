import test from 'node:test';import assert from 'node:assert/strict';import{randomUUID}from'node:crypto';
import{createPanelServerFixture,PANEL_OWNER}from'./panel-server-entry-fixture.mjs';
test('panel fixture seeds through actual service ACK and serves only its synthetic loopback Guest',async()=>{
 const f=createPanelServerFixture('http://127.0.0.1:4187/CityManager/'),raw=JSON.stringify({version:25,tick:4,households:[]});const ack=await f.seed(raw);assert.equal(ack.raw,raw);assert.equal(ack.revision,1);assert.equal(ack.owner,PANEL_OWNER);
 const messages=[];const send=async(method,params)=>messages.push({method,params});
 assert.equal(await f.intercept({requestId:'me',request:{url:'http://127.0.0.1:4187/citymanager-api/v1/me',method:'GET'}},send),true);assert.equal(JSON.parse(Buffer.from(messages[0].params.body,'base64').toString()).guest_id,PANEL_OWNER);
 await f.intercept({requestId:'save',request:{url:'http://127.0.0.1:4187/citymanager-api/v1/city-save',method:'POST',headers:{'Idempotency-Key':randomUUID()},postData:JSON.stringify({action:'save',cityId:ack.cityId,expectedRevision:1,raw,metadata:ack.metadata})}},send);assert.equal(f.active.revision,2);assert.equal(f.active.raw,raw);
 await assert.rejects(f.intercept({requestId:'external',request:{url:'https://example.com/citymanager-api/v1/me',method:'GET'}},send),/external account/);
 assert.equal(await f.intercept({request:{url:'http://127.0.0.1:4187/assets/app.js'}},send),false);
 await assert.rejects(f.dialog({type:'beforeunload'},send),/explicit fixture/);await assert.rejects(f.dialog({type:'alert'},send),/explicit fixture/);
});
test('panel fixture refuses non-loopback hosts and foreign stored identities',async()=>{
 assert.throws(()=>createPanelServerFixture('https://example.com/'));
 const f=createPanelServerFixture('http://127.0.0.1:4187/');await assert.rejects(f.seed(JSON.stringify({tick:0,market:{guestId:randomUUID()}})),/synthetic fixture Guest/);
});
