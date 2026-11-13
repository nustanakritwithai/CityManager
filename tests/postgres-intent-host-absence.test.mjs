import {test} from 'node:test';
import assert from 'node:assert/strict';
import {intentHost} from '../server/save-slots/postgres-intent-host.mjs';
import {createRegistryIntegration} from '../server/city-registry/integration.mjs';
import {createLegacyMigration} from '../server/city-registry/legacy-migration.mjs';

const owner='11111111-1111-4111-8111-111111111111',cityId='22222222-2222-4222-8222-222222222222',requestId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const row=state=>({owner_id:owner,request_id:requestId,city_id:cityId,session_hash:'a'.repeat(64),expected_revision:'1',body_hash:'b'.repeat(64),payload_hash:'c'.repeat(64),raw_hash:'d'.repeat(64),state,manual_code:state==='manual'?'save-conflict':null,ack_revision:null,ack_hash:null,key_id:'fixture',body_nonce:Buffer.alloc(12),body_tag:Buffer.alloc(16),body_cipher:Buffer.from('fixture')});
const codec={seal(){throw Error('unexpected-seal');},open(){throw Error('unexpected-open');}};
async function fixture(result){return intentHost(()=>({}),codec)({query:async()=>{if(result instanceof Error)throw result;return result;}},owner);}

test('empty active and keyed intent queries return null',async()=>{
 const tx=await fixture({rows:[]});assert.equal(await tx.activeIntent(),null);assert.equal(await tx.findIntent(requestId),null);
});
for(const state of ['pending','manual','applied'])test(`${state} remains present and blocks migration and direct creation`,async()=>{
 const tx=await fixture({rows:[row(state)]});assert.equal((await tx.activeIntent()).state,state);
 const adapter={transaction:async(_owner,fn)=>fn(tx)};
 await assert.rejects(createLegacyMigration(adapter).copyToSlot1(owner),/pending-intent-conflict/);
 await assert.rejects(createRegistryIntegration(adapter).create(owner,requestId,{cityId,slot:1,raw:'{}',metadata:{name:'fixture',population:0,tick:0}}),/pending-intent-conflict/);
});
test('null absence passes the fence and reaches the next operation',async()=>{
 const tx=await fixture({rows:[]});tx.cutoverReady=async()=>{throw Error('reached-migration-cutover');};tx.lockLegacyMarker=async()=>{throw Error('reached-create-marker');};
 const adapter={transaction:async(_owner,fn)=>fn(tx)};
 await assert.rejects(createLegacyMigration(adapter).copyToSlot1(owner),/reached-migration-cutover/);
 await assert.rejects(createRegistryIntegration(adapter).create(owner,requestId,{cityId,slot:1,raw:'{}',metadata:{name:'fixture',population:0,tick:0}}),/reached-create-marker/);
});
for(const result of [{rows:[null]},{rows:[false]},{rows:[{}]},{rows:[row('unknown')]},{rows:[{...row('pending'),owner_id:'other-owner'}]},{rows:[row('pending'),row('manual')]},{rows:null},new Error('database-unavailable')])test('malformed query result or database failure never becomes absence',async()=>{
 const tx=await fixture(result);await assert.rejects(tx.activeIntent());await assert.rejects(tx.findIntent(requestId));
});
test('completed intent remains findable but is not a valid active result',async()=>{
 const tx=await fixture({rows:[row('completed')]});assert.equal((await tx.findIntent(requestId)).state,'completed');await assert.rejects(tx.activeIntent(),/invalid-intent-row/);
});
test('missing receipt returns null after the legacy receipt fence',async()=>{
 const calls=[],q={query:async(sql,params)=>{calls.push({sql,params});return {rows:[],rowCount:0};}};
 const tx=await intentHost(()=>({}),codec)(q,owner);assert.equal(await tx.readIntentReceipt(cityId,requestId),null);
 assert.equal(calls.length,2);assert.deepEqual(calls[0].params,[owner,requestId]);assert.deepEqual(calls[1].params,[owner,cityId,requestId]);
});
