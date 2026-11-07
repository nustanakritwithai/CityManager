// Team 2 compatibility tests; absence expectations updated to the null contract.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {intentHost} from '../server/save-slots/postgres-intent-host.mjs';
import {createIntentCipher} from '../server/save-slots/intent-cipher.mjs';
import {createHash} from 'node:crypto';
import {createDurableIntentService} from '../server/save-slots/durable-intents.mjs';

test('Postgres host uses the team 1 transaction client with owner-scoped parameterized queries',async()=>{
 const owner='11111111-1111-4111-8111-111111111111',requestId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',calls=[];
 const q={query:async(sql,params=[])=>{calls.push({sql,params});return {rows:sql.includes('count(*)')?[{count:'3'}]:[]};}};
 const codec=createIntentCipher({currentKeyId:'fixture-key',getKey:()=>Buffer.alloc(32,7)});
 const host=await intentHost((client,principal)=>{assert.equal(client,q);assert.equal(principal,owner);return {team1:true};},codec)(q,owner);
 assert.equal(host.team1,true);assert.equal(await host.activeIntent(),null);assert.equal(await host.findIntent(requestId),null);assert.equal(await host.intentCount(),3);
 await host.insertIntent({owner,requestId,cityId:'33333333-3333-4333-8333-333333333333',sessionHash:'a'.repeat(64),expectedRevision:1,body:'private payload',bodyHash:'b'.repeat(64),payloadHash:'c'.repeat(64),rawHash:'d'.repeat(64)});
 await host.savepoint();await host.rollbackSavepoint();await host.releaseSavepoint();
 await host.markManual(requestId,'legacy-receipt-reconciliation-required');await host.markApplied(requestId,2,'d'.repeat(64));await host.markCompleted(requestId);
 for(const c of calls.filter(c=>c.sql.includes('city_registry.save_intents'))){assert.equal(c.params[0],owner);assert.doesNotMatch(c.sql,/private payload/);assert.ok(!c.params.includes('private payload'));}
 assert.deepEqual(calls.filter(c=>c.sql.includes('SAVEPOINT')).map(c=>c.sql),['SAVEPOINT intent_attempt','ROLLBACK TO SAVEPOINT intent_attempt','RELEASE SAVEPOINT intent_attempt']);
});

test('receipt verification uses read-only owner-scoped queries and never obtains a writer',async()=>{
 const owner='11111111-1111-4111-8111-111111111111',cityId='33333333-3333-4333-8333-333333333333',requestId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',calls=[];
 const q={query:async(sql,params)=>{calls.push({sql,params});return sql.includes('legacy_receipt_archive')?{rows:[],rowCount:0}:{rows:[{payload_hash:'hash',response:{cityId}}]};}};
 const codec=createIntentCipher({currentKeyId:'fixture-key',getKey:()=>Buffer.alloc(32,7)});
 const host=await intentHost(()=>({citySaveStore:async()=>{throw Error('writer must remain private');}}),codec)(q,owner);
 assert.deepEqual(await host.readIntentReceipt(cityId,requestId),{payloadHash:'hash',response:{cityId}});
 assert.deepEqual(calls.map(c=>c.params),[[owner,requestId],[owner,cityId,requestId]]);assert.ok(calls.every(c=>c.sql.startsWith('SELECT')));
});

test('intent encryption binds owner, session and request and detects corruption',()=>{
 const codec=createIntentCipher({currentKeyId:'k1',getKey:id=>id==='k1'?Buffer.alloc(32,3):null});
 const i={owner:'o',cityId:'c',requestId:'r',sessionHash:'s',expectedRevision:1,bodyHash:'b',payloadHash:'p',rawHash:'h',body:'SECRET SAVE'};
 const sealed=codec.seal(i);assert.notEqual(sealed.ciphertext.toString('utf8'),i.body);assert.equal(codec.open(i,sealed),i.body);
 assert.throws(()=>codec.open({...i,owner:'other'},sealed));assert.throws(()=>codec.open({...i,sessionHash:'other'},sealed));
 const changed=Buffer.from(sealed.ciphertext);changed[0]^=1;assert.throws(()=>codec.open(i,{...sealed,ciphertext:changed}));
 assert.throws(()=>codec.open(i,{...sealed,keyId:'missing'}));
});

test('session is checked before the stored payload is decrypted',async()=>{
 const owner='11111111-1111-4111-8111-111111111111',sessionBinding='trusted-session-value-0123456789abcdef';let opens=0;
 const row={sessionHash:createHash('sha256').update(sessionBinding).digest('hex'),state:'pending',requestId:'r',cityId:'c',expectedRevision:1};
 const svc=createDurableIntentService({transaction:async(_owner,fn)=>fn({activeIntent:async()=>row,revealIntent:async r=>{opens++;return {...r,body:'private'};}})});
 await assert.rejects(svc.current({ownerId:owner,sessionBinding:'different-trusted-session-value-abcdef'}),/session-reconciliation-required/);assert.equal(opens,0);
 assert.equal((await svc.current({ownerId:owner,sessionBinding})).intent.intent.body,'private');assert.equal(opens,1);
});

test('Postgres adapter persists ciphertext and only opens it on explicit reveal',async()=>{
 const owner='11111111-1111-4111-8111-111111111111',codec=createIntentCipher({currentKeyId:'test',getKey:()=>Buffer.alloc(32,9)});let stored;
 const q={query:async(sql,p)=>{if(sql.startsWith('INSERT')){stored={owner_id:p[0],request_id:p[1],city_id:p[2],session_hash:p[3],expected_revision:p[4],body_cipher:p[5],body_nonce:p[6],body_tag:p[7],key_id:p[8],body_hash:p[9],payload_hash:p[10],raw_hash:p[11],state:p[12],manual_code:null,ack_revision:null,ack_hash:null};return {rows:[]};}return {rows:[stored]};}};
 const host=await intentHost(()=>({}),codec)(q,owner),data={owner,requestId:'a',cityId:'b',sessionHash:'c',expectedRevision:1,body:'secret body',bodyHash:'d',payloadHash:'e',rawHash:'f'};
 await host.insertIntent(data);assert.ok(Buffer.isBuffer(stored.body_cipher));assert.notEqual(stored.body_cipher.toString('utf8'),data.body);
 const locked=await host.activeIntent();assert.equal(locked.body,undefined);assert.equal((await host.revealIntent(locked)).body,data.body);
});
