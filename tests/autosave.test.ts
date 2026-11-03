import test from 'node:test';
import assert from 'node:assert/strict';
import { createAutosave, installAutosave, isQuotaError, describeAutosave } from '../src/autosave.ts';
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
