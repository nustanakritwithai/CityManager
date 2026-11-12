import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { manualSaveFixture, manualSuccess, deferred, turn } from './manual-save-listener-fixture.mjs';
import { assertPanelSaveChain } from './panel-ui-server.mjs';

// These tests invoke the real production listener with synthetic gestures. They
// prove listener/queue behavior, not native mouse/touch or full browser QA.
for(const newline of ['LF','CRLF','mixed'])test(`production Save extraction preserves behavior with ${newline} line endings`,async()=>{
 const lf=readFileSync(new URL('../src/main.ts',import.meta.url),'utf8').replaceAll('\r\n','\n');
 const source=newline==='LF'?lf:newline==='CRLF'?lf.replaceAll('\n','\r\n'):lf.split('\n').map((line,index)=>line+(line.includes('    canOpen:')||index%2===0?'\r\n':'\n')).join('');
 if(newline!=='LF')assert.ok(source.includes('\r\n'));
 if(newline==='mixed')assert.ok(/[^\r]\n/.test(source),'Mixed source retains LF as well as CRLF');
 const h=await manualSaveFixture(source),gate=h.holdNextPost();h.edit();
 const saving=h.actual.autosave.run();await gate.started;
 const before=h.fixture.active,cursor=h.fixture.writes.length,manual=h.click();
 assert.equal(h.actual.manualPending,true);assert.equal(h.actual.canOpen(),false);await h.click();assert.equal(h.authCalls,1);
 gate.release();await saving;await manual;
 assert.deepEqual(assertPanelSaveChain(before,h.fixture.active,h.fixture.writes.slice(cursor),h.raw,h.fixture.writes.slice(0,cursor)),{beforeRevision:2,afterRevision:3,saves:1});
 assert.deepEqual(h.notices,[manualSuccess]);assert.equal(h.actual.manualPending,false);assert.equal(h.actual.canOpen(),true);
});
test('Save during a committed but unacknowledged autosave queues a fresh exact revision',async()=>{
 const h=await manualSaveFixture(),gate=h.holdNextPost();h.edit();
 const saving=h.actual.autosave.run();await gate.started;
 const before=h.fixture.active,cursor=h.fixture.writes.length;
 assert.equal(before.revision,2);assert.equal(h.client.confirmed.revision,1);assert.equal(h.actual.busy,true);
 const manual=h.click();assert.equal(h.actual.manualPending,true);assert.equal(h.authCalls,1,'Authentication starts synchronously from the gesture');
 await h.click();await h.click();assert.equal(h.authCalls,1,'Repeated busy clicks coalesce');
 assert.equal(h.actual.canOpen(),false);assert.equal(h.warn(),true);assert.equal(h.fixture.writes.length,cursor);
 gate.release();await saving;await manual;
 assert.deepEqual(assertPanelSaveChain(before,h.fixture.active,h.fixture.writes.slice(cursor),h.raw,h.fixture.writes.slice(0,cursor)),{beforeRevision:2,afterRevision:3,saves:1});
 assert.deepEqual(h.notices,[manualSuccess]);assert.equal(h.actual.manualPending,false);assert.equal(h.actual.busy,false);
 assert.equal(h.actual.canOpen(),true);assert.equal(h.warn(),false);
});

test('idle same-byte Save is fresh; synchronous and in-flight duplicate gestures do not stack',async()=>{
 const h=await manualSaveFixture(),gate=h.holdNextPost(),before=h.fixture.active;
 const manual=h.click();assert.equal(h.actual.manualPending,true);assert.equal(h.actual.busy,false,'Before the queue microtask');
 assert.equal(h.actual.canOpen(),false);assert.equal(h.warn(),true);
 await h.click();await gate.started;await h.click();
 assert.equal(h.authCalls,1);gate.release();await manual;
 assert.equal(h.fixture.active.revision,before.revision+1);assert.equal(h.fixture.writes.length,1);assert.equal(h.fixture.active.raw,h.raw);
 await h.click();assert.equal(h.fixture.active.revision,before.revision+2,'A later independent gesture is not swallowed');assert.equal(h.notices.length,2);
});

test('queued Save captures latest bytes of its original session, not bytes at the click',async()=>{
 const h=await manualSaveFixture(),gate=h.holdNextPost();h.edit();const saving=h.actual.autosave.run();await gate.started;
 const old=h.raw,manual=h.click();h.edit();const current=h.raw;assert.notEqual(old,current);
 gate.release();await saving;await manual;
 assert.equal(h.fixture.active.raw,current);assert.equal(h.client.confirmed.raw,current);assert.equal(h.fixture.active.revision,3);assert.ok(h.notices.includes(manualSuccess));
});

test('lost autosave ACK replays its exact request before one queued explicit Save',async()=>{
 const h=await manualSaveFixture(),gate=h.holdNextPost({lose:true});h.edit();const saving=h.actual.autosave.run();await gate.started;
 const manual=h.click();h.edit();gate.release();await saving;await manual;
 const posts=h.calls.filter(c=>c.method==='POST');assert.equal(posts.length,3);assert.deepEqual(posts[0].init,posts[1].init);assert.notEqual(posts[1].init.headers['Idempotency-Key'],posts[2].init.headers['Idempotency-Key']);
 assert.equal(h.fixture.active.revision,3);assert.equal(h.fixture.active.raw,h.raw);assert.equal(h.client.pending,false);assert.equal(h.actual.manualPending,false);assert.equal(h.feedback.at(-1).failure,null);assert.ok(h.notices.includes(manualSuccess));
});

test('autosave conflict discovered after the gesture blocks the queued Save without overwriting',async()=>{
 const h=await manualSaveFixture(),gate=h.holdNextPost({reject:true});h.edit();const saving=h.actual.autosave.run();await gate.started;
 const manual=h.click();gate.release();await saving;await manual;
 assert.equal(h.client.conflict,true);assert.equal(h.fixture.active.revision,1);assert.equal(h.calls.filter(c=>c.method==='POST').length,1);
 assert.equal(h.actual.manualPending,false);assert.equal(h.actual.busy,false);assert.equal(h.notices.includes(manualSuccess),false);assert.ok(h.feedback.at(-1).failure);assert.equal(h.warn(),true);
});

for(const reason of ['synthetic-auth-offline','save-owner-mismatch'])test(`${reason} clears manual intent without any save, and a later gesture can retry`,async()=>{
 const h=await manualSaveFixture();h.authenticate=()=>Promise.reject(Error(reason));await h.click();
 assert.equal(h.fixture.writes.length,0);assert.equal(h.actual.manualPending,false);assert.equal(h.actual.busy,false);assert.equal(h.notices.includes(manualSuccess),false);assert.ok(h.feedback.at(-1).failure);
 h.authenticate=()=>Promise.resolve();await h.click();assert.equal(h.fixture.active.revision,2);assert.ok(h.notices.includes(manualSuccess));
});

test('queued authentication rejection stays handled until autosave releases the queue',async()=>{
 const h=await manualSaveFixture(),gate=h.holdNextPost();h.edit();const saving=h.actual.autosave.run();await gate.started;
 h.authenticate=()=>Promise.reject(Error('save-owner-mismatch'));const manual=h.click();await turn();assert.equal(h.actual.manualPending,true);
 gate.release();await saving;await manual;assert.equal(h.fixture.active.revision,2);assert.equal(h.fixture.writes.length,1);assert.equal(h.actual.manualPending,false);assert.equal(h.notices.includes(manualSuccess),false);
});

test('Save rejected by management does not authenticate or enqueue work',async()=>{
 const h=await manualSaveFixture();h.actual.managing=true;await h.click();assert.equal(h.authCalls,0);assert.equal(h.fixture.writes.length,0);assert.equal(h.actual.manualPending,false);
 h.actual.managing=false;await h.click();assert.equal(h.fixture.active.revision,2);
});

test('management beginning before queued execution rejects Save and clears its pending flag',async()=>{
 const h=await manualSaveFixture();const manual=h.click();h.actual.managing=true;await manual;
 assert.equal(h.fixture.writes.length,0);assert.equal(h.actual.manualPending,false);assert.equal(h.actual.busy,false);assert.equal(h.notices.includes(manualSuccess),false);
});

for(const stage of ['queued','authentication'])test(`session replacement while ${stage} cannot save the replacement or retry an old intent`,async()=>{
 const h=await manualSaveFixture(),gate=h.holdNextPost({lose:true});h.edit();const saving=h.actual.autosave.run();await gate.started;
 let manual;
 if(stage==='queued'){manual=h.click();h.replace();gate.release();await saving;}
 else{gate.release();await saving;const auth=deferred();h.authenticate=()=>auth.promise;manual=h.click();await turn();h.replace();auth.release();}
 const replacement=h.raw;await manual;
 assert.equal(h.calls.filter(c=>c.method==='POST').length,1,'No replay or new POST after changing the captured session');
 assert.equal(h.fixture.active.revision,2);assert.notEqual(h.fixture.active.raw,replacement);assert.equal(h.actual.manualPending,false);assert.equal(h.actual.busy,false);assert.equal(h.notices.includes(manualSuccess),false);
});

test('in-flight edits never receive current manual completion; next gesture saves them',async()=>{
 const h=await manualSaveFixture(),gate=h.holdNextPost();const manual=h.click();await gate.started;h.edit();gate.release();await manual;
 assert.equal(h.notices.includes(manualSuccess),false);assert.notEqual(h.fixture.active.raw,h.raw);assert.equal(h.warn(),true);assert.equal(h.actual.manualPending,false);
 await h.click();assert.equal(h.fixture.active.raw,h.raw);assert.equal(h.notices.at(-1),manualSuccess);
});

test('autosave queued behind manual save verifies it without extra writes or deadlock',async()=>{
 const h=await manualSaveFixture(),gate=h.holdNextPost(),cursor=h.calls.length;const manual=h.click();await gate.started;
 const checking=h.actual.autosave.run();gate.release();await manual;await checking;
 assert.deepEqual(h.calls.slice(cursor).map(c=>c.method),['POST','GET']);assert.equal(h.fixture.active.revision,2);assert.equal(h.actual.manualPending,false);assert.equal(h.actual.busy,false);assert.equal(h.scope.saveSuccessLabel,'ตรวจสอบแล้วว่าเซฟบนเซิร์ฟเวอร์ตรงกัน');assert.ok(h.notices.includes(manualSuccess));
});

test('cancelling conflict confirmation releases manual intent and never queues a write',async()=>{
 const h=await manualSaveFixture();h.actual.resolving=true;await h.click();await h.click();
 assert.equal(h.confirms,2);assert.equal(h.authCalls,0);assert.equal(h.fixture.writes.length,0);assert.equal(h.actual.manualPending,false);
});

test('conflict recovery does not archive a replacement session after authentication waits',async()=>{
 const h=await manualSaveFixture(),auth=deferred();h.actual.resolving=true;h.confirm=true;h.authenticate=()=>auth.promise;
 const manual=h.click();await turn();h.replace();auth.release();await manual;
 assert.equal(h.fixture.writes.length,0);assert.equal(h.calls.length,1,'Only the initial GET; no archive of replacement');assert.equal(h.actual.manualPending,false);assert.equal(h.actual.busy,false);assert.equal(h.notices.includes(manualSuccess),false);
});

test('management beginning during authentication cannot start transport',async()=>{
 const h=await manualSaveFixture(),auth=deferred();h.authenticate=()=>auth.promise;
 const manual=h.click();await turn();h.actual.managing=true;auth.release();await manual;
 assert.equal(h.fixture.writes.length,0);assert.equal(h.actual.manualPending,false);assert.equal(h.actual.busy,false);assert.ok(h.feedback.at(-1).failure);
});

test('failed explicit ACK clears only gesture state, retaining the exact retry intent',async()=>{
 const h=await manualSaveFixture(),gate=h.holdNextPost({lose:true});const manual=h.click();await gate.started;gate.release();await manual;
 assert.equal(h.client.pending,true);assert.equal(h.actual.manualPending,false);assert.equal(h.actual.busy,false);assert.equal(h.notices.includes(manualSuccess),false);assert.equal(h.warn(),true);
 await h.click();const posts=h.calls.filter(c=>c.method==='POST');assert.equal(posts.length,3);assert.deepEqual(posts[0].init,posts[1].init);assert.notEqual(posts[1].init.headers['Idempotency-Key'],posts[2].init.headers['Idempotency-Key']);assert.equal(h.fixture.active.revision,3);assert.equal(h.notices.at(-1),manualSuccess);
});

test('synchronous authentication failure cannot leak a pending manual gesture',async()=>{
 const h=await manualSaveFixture();h.authenticate=()=>{throw Error('synthetic-sync-auth-failure');};await h.click();
 assert.equal(h.actual.manualPending,false);assert.equal(h.actual.busy,false);assert.equal(h.fixture.writes.length,0);
 h.authenticate=()=>Promise.resolve();await h.click();assert.equal(h.fixture.active.revision,2);
});
