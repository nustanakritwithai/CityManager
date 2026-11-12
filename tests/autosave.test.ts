import test from 'node:test';
import assert from 'node:assert/strict';
import { createAutosave, installAutosave, isQuotaError, describeAutosave } from '../src/autosave.ts';
import { createSaveAttemptQueue } from '../src/save-feedback.ts';
// Transport-neutral stub: test autosave scheduling without browser persistence.
class Store { value: string | null = null; limit = Infinity; read() { return this.value; } async write(v: string) { if (v.length > this.limit) { const e = new Error('exceeded the quota'); e.name = 'QuotaExceededError'; throw e; } this.value = v; } }
const tickOver = () => new Promise(r => setImmediate(r));

test('periodic timer and tab hide/close trigger saves; unchanged ticks skipped', async () => {
  const store = new Store(); let tick = 1, hidden = false; const results: unknown[] = []; const handlers: Record<string, () => void> = {}; let timer = () => {};
  const auto = createAutosave({ save: () => store.write(JSON.stringify({ tick })), tick: () => tick, onResult: r => results.push(r) });
  const listen = { addEventListener: (t: string, f: () => void) => { handlers[t] = f; } };
  installAutosave(listen, { ...listen, setInterval: (f: () => void) => { timer = f; return 0; } }, auto, () => hidden);
  timer(); await tickOver(); assert.equal(store.read(), '{"tick":1}');
  timer(); await tickOver(); assert.equal(results.length, 1);
  tick = 2; hidden = true; handlers.visibilitychange(); await tickOver(); assert.equal(store.read(), '{"tick":2}');
  tick = 3; handlers.pagehide(); await tickOver(); assert.equal(store.read(), '{"tick":3}');
  tick = 4; handlers.beforeunload(); await tickOver(); assert.equal(store.read(), '{"tick":4}');
});

test('quota failure is reported, previous save kept, then retried', async () => {
  const store = new Store(); await store.write('old'); store.limit = 10; const results: any[] = [];
  const auto = createAutosave({ save: () => store.write('x'.repeat(12_000_000)), tick: () => 5, onResult: r => results.push(r) });
  const r: any = await auto.run(); assert.equal(r.ok, false); assert.equal(r.quota, true); assert.equal(store.read(), 'old');
  assert.match(describeAutosave(r), /quota/); assert.match(describeAutosave(r), /ยังไม่ยืนยันบนเซิร์ฟเวอร์/); assert.doesNotMatch(describeAutosave(r), /เบราว์เซอร์เต็ม|เซฟเดิมยังอยู่/);
  store.limit = Infinity; const r2: any = await auto.run(); assert.equal(r2.ok, true);
});

test('quota detection variants and status text', () => {
  assert.ok(isQuotaError({ name: 'NS_ERROR_DOM_QUOTA_REACHED' })); assert.ok(isQuotaError({ code: 22 })); assert.ok(!isQuotaError(new Error('x')));
  assert.match(describeAutosave({ ok: true, at: 0 }, () => '10:00'), /10:00/);
  const uncertain = describeAutosave({ ok: false, at: 0, quota: false, message: 'lost-response' });
  assert.match(uncertain, /lost-response/); assert.match(uncertain, /ยังไม่ยืนยันบนเซิร์ฟเวอร์/); assert.doesNotMatch(uncertain, /เซฟเดิมยังอยู่/);
});

test('after Load, autosave adopts the loaded bytes and does not rewrite them until the city changes', async () => {
  const store = new Store(); const original = '{"version":1,"legacy":true}'; await store.write(original);
  let revision = 'loaded-rev', tick = 7, writes = 0;
  const auto = createAutosave({ save: async () => { writes++; await store.write(JSON.stringify({ tick, revision })); }, tick: () => tick, revision: () => revision, onResult: () => {} });
  auto.adoptLoaded(); assert.equal(auto.last, null, 'adopting does not claim a save happened');
  for (let i = 0; i < 3; i++) await auto.run();
  assert.equal(writes, 0); assert.equal(store.read(), original, 'Loading does not rewrite the original save bytes');
  revision = 'edited'; tick = 8; await auto.run();
  assert.equal(writes, 1); assert.equal(store.read(), '{"tick":8,"revision":"edited"}');
  await auto.run(); assert.equal(writes, 1, 'unchanged after the write is skipped');
  auto.adoptLoaded(); await auto.run(true); assert.equal(writes, 2, 'explicit flush still writes');
});

test('autosave records the bytes actually acknowledged after queueing, not an earlier snapshot',async()=>{
 let current='A',saved='';let release!:()=>void;const held=new Promise<void>(r=>release=r);
 const auto=createAutosave({tick:()=>1,revision:()=>current,onResult:()=>{},save:async()=>{await held;const revision='B';saved=revision;return {revision};}});
 const pending=auto.run();current='B';release();await pending;current='A';
 assert.equal(saved,'B');assert.notEqual(await auto.run(),null,'Reverting to pre-queue bytes is still dirty after B was saved');
});

test('explicit saved bytes and newer generations cannot be overwritten by stale autosave completion',async()=>{
 let current='A',calls=0,release!:(value:{revision:string})=>void;const held=new Promise<{revision:string}>(r=>release=r);
 const auto=createAutosave({tick:()=>1,revision:()=>current,onResult:()=>{},save:async()=>{calls++;return calls===1?held:{revision:current};}});
 const pending=auto.run();current='B';auto.markSaved(1,'B');release({revision:'A'});await pending;
 assert.equal(await auto.run(),null,'The newer explicit B acknowledgement remains current');current='A';assert.ok(await auto.run());
});

test('queued work is synchronously visible and failed verification remains retryable',async()=>{
 let fail=true;const auto=createAutosave({tick:()=>1,revision:()=>'same',onResult:()=>{},save:async()=>{if(fail)throw Error('verification-failed');return {revision:'same'};}});
 auto.adoptLoaded();const pending=auto.run(true);assert.equal(auto.running,true);await pending;assert.equal(auto.running,false);assert.equal(auto.last?.ok,false);
 fail=false;assert.equal((await auto.run())?.ok,true,'Failed force verification is not skipped merely because bytes are unchanged');
});

test('automatic verification queued behind manual ACK reports its own failure and retries',async()=>{
 const queue=createSaveAttemptQueue();let release!:()=>void,attempts=0;
 const held=new Promise<void>(r=>release=r);
 const auto=createAutosave({tick:()=>1,revision:()=>'same',onResult:()=>{},save:onStart=>queue(async()=>{onStart();attempts++;if(attempts===1)throw Error('verification-failed');return {revision:'same'};})});
 auto.adoptLoaded();
 const manual=queue(async()=>{await held;auto.markSaved(1,'same');});
 const checking=auto.run(true);release();await manual;assert.equal((await checking)?.ok,false);
 assert.equal(auto.last?.ok,false,'Manual success before the verification cannot hide its failure');
 assert.equal((await auto.run())?.ok,true,'A later timer retries unchanged bytes');assert.equal(attempts,2);
});

test('reset after queued work starts still prevents stale completion from overwriting loaded state',async()=>{
 let started!:()=>void,release!:()=>void;const inFlight=new Promise<void>(r=>started=r),held=new Promise<void>(r=>release=r);let current='old';
 const auto=createAutosave({tick:()=>1,revision:()=>current,onResult:()=>{},save:async onStart=>{onStart();started();await held;throw Error('old verification failed');}});
 const checking=auto.run(true);await inFlight;current='new';auto.adoptLoaded();release();assert.equal((await checking)?.ok,false);
 assert.equal(auto.last,null);assert.equal(await auto.run(),null,'Loaded state remains adopted');
});

test('replacing city before queued work starts does not attach stale failure to the new city',async()=>{
 const queue=createSaveAttemptQueue();let release!:()=>void,cityGeneration=1,current='old',notified=0;const held=new Promise<void>(r=>release=r);
 const blocker=queue(async()=>{await held;});
 const auto=createAutosave({tick:()=>1,revision:()=>current,onResult:()=>{notified++;},save:onStart=>{
  const captured=cityGeneration;return queue(async()=>{if(captured===cityGeneration)onStart();if(captured!==cityGeneration)throw Error('city changed');return {revision:current};});
 }});
 const checking=auto.run(true);cityGeneration++;current='new';auto.adoptLoaded();release();await blocker;assert.equal((await checking)?.ok,false);
 assert.equal(notified,0);assert.equal(auto.last,null);assert.equal(await auto.run(),null);
});
