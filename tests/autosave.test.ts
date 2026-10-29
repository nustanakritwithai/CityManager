import test from 'node:test';
import assert from 'node:assert/strict';
import { createAutosave, installAutosave, isQuotaError, describeAutosave } from '../src/autosave.ts';
import { SAVE_KEY } from '../src/save-storage.ts';

class Mem { m = new Map<string, string>(); limit = Infinity; getItem(k: string) { return this.m.get(k) ?? null; } setItem(k: string, v: string) { if (v.length > this.limit) { const e = new Error('exceeded the quota'); e.name = 'QuotaExceededError'; throw e; } this.m.set(k, v); } }
const tickOver = () => new Promise(r => setImmediate(r));

test('periodic timer and tab hide/close trigger saves; unchanged ticks skipped', async () => {
  const store = new Mem(); let tick = 1, hidden = false; const results: unknown[] = []; const handlers: Record<string, () => void> = {}; let timer = () => {};
  const auto = createAutosave({ save: () => store.setItem(SAVE_KEY, JSON.stringify({ tick })), tick: () => tick, onResult: r => results.push(r) });
  const listen = { addEventListener: (t: string, f: () => void) => { handlers[t] = f; } };
  installAutosave(listen, { ...listen, setInterval: (f: () => void) => { timer = f; return 0; } }, auto, () => hidden);
  timer(); await tickOver(); assert.equal(store.getItem(SAVE_KEY), '{"tick":1}');
  timer(); await tickOver(); assert.equal(results.length, 1);
  tick = 2; hidden = true; handlers.visibilitychange(); await tickOver(); assert.equal(store.getItem(SAVE_KEY), '{"tick":2}');
  tick = 3; handlers.pagehide(); await tickOver(); assert.equal(store.getItem(SAVE_KEY), '{"tick":3}');
  tick = 4; handlers.beforeunload(); await tickOver(); assert.equal(store.getItem(SAVE_KEY), '{"tick":4}');
});

test('quota failure is reported, previous save kept, then retried', async () => {
  const store = new Mem(); store.setItem(SAVE_KEY, 'old'); store.limit = 10; const results: any[] = [];
  const auto = createAutosave({ save: () => store.setItem(SAVE_KEY, 'x'.repeat(12_000_000)), tick: () => 5, onResult: r => results.push(r) });
  const r: any = await auto.run(); assert.equal(r.ok, false); assert.equal(r.quota, true); assert.equal(store.getItem(SAVE_KEY), 'old');
  assert.match(describeAutosave(r), /quota/);
  store.limit = Infinity; const r2: any = await auto.run(); assert.equal(r2.ok, true);
});

test('quota detection variants and status text', () => {
  assert.ok(isQuotaError({ name: 'NS_ERROR_DOM_QUOTA_REACHED' })); assert.ok(isQuotaError({ code: 22 })); assert.ok(!isQuotaError(new Error('x')));
  assert.match(describeAutosave({ ok: true, at: 0 }, () => '10:00'), /10:00/);
});
