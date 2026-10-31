import test from 'node:test';
import assert from 'node:assert/strict';
import { deleteOldSaves, CITY_RECOVERY_DB } from '../src/delete-old-saves.ts';
class Mem { m = new Map<string, string>(); get length() { return this.m.size; } key(i: number) { return [...this.m.keys()][i] ?? null; } getItem(k: string) { return this.m.get(k) ?? null; } setItem(k: string, v: string) { this.m.set(k, v); } removeItem(k: string) { this.m.delete(k); } }
const factory = (outcome: 'success' | 'blocked', seen: string[]) => ({ deleteDatabase(name: string) { seen.push(name); const r: any = {}; setTimeout(() => outcome === 'success' ? r.onsuccess?.() : r.onblocked?.(), 0); return r; } }) as unknown as IDBFactory;
const seed = () => { const s = new Mem(); for (const [k, v] of [['citymanager.save.v7', '{"old":1}'], ['citymanager.save.v6', '{"v":6}'], ['citymanager.save.v1', '{"v":1}'], ['citymanager.backup.before-autosave', 'x'], ['citymanager.checkpoint.latest', 'y'], ['citymanager.resume-choice.v1', '{}'], ['citymanager.traffic', '1'], ['citymanager.bus', '1'], ['strategy-game.save', 'KEEP'], ['other', 'KEEP']]) s.setItem(k, v); return s; };
test('keeps the chosen city as primary, deletes only other CityManager saves and its recovery DB', async () => {
  const s = seed(), seen: string[] = [];
  await deleteOldSaves('{"keep":true}', s, factory('success', seen));
  assert.deepEqual(seen, [CITY_RECOVERY_DB]);
  assert.equal(s.getItem('citymanager.save.v7'), '{"keep":true}');
  for (const k of ['citymanager.save.v6', 'citymanager.save.v1', 'citymanager.backup.before-autosave', 'citymanager.checkpoint.latest', 'citymanager.resume-choice.v1']) assert.equal(s.getItem(k), null, k);
  assert.equal(s.getItem('strategy-game.save'), 'KEEP'); assert.equal(s.getItem('other'), 'KEEP');
  assert.equal(s.getItem('citymanager.traffic'), '1'); assert.equal(s.getItem('citymanager.bus'), '1');
});
test('blocked recovery DB deletes nothing else; missing choice deletes nothing', async () => {
  const s = seed(); await assert.rejects(deleteOldSaves('{"keep":true}', s, factory('blocked', [])));
  assert.equal(s.getItem('citymanager.save.v6'), '{"v":6}'); assert.equal(s.getItem('citymanager.checkpoint.latest'), 'y');
  const t = seed(); await assert.rejects(deleteOldSaves('', t, factory('success', []))); assert.equal(t.getItem('citymanager.save.v7'), '{"old":1}'); assert.equal(t.getItem('citymanager.save.v6'), '{"v":6}');
});
test('full localStorage: frees old copies before writing the kept city', async () => {
  const s = seed(); const limit = [...s.m.values()].reduce((n, v) => n + v.length, 0);
  const full = Object.assign(Object.create(Object.getPrototypeOf(s)), s, { setItem(k: string, v: string) { const used = [...this.m].reduce((n: number, [kk, vv]: [string, string]) => n + (kk === k ? 0 : vv.length), 0); if (used + v.length > limit) throw new DOMException('full', 'QuotaExceededError'); this.m.set(k, v); } });
  const keep = '{"keep":1}';
  assert.throws(() => full.setItem('citymanager.save.v7', keep), 'primary write must fail while old copies fill the quota');
  await deleteOldSaves(keep, full, factory('success', []));
  assert.equal(full.getItem('citymanager.save.v7'), keep); assert.equal(full.getItem('citymanager.save.v6'), null); assert.equal(full.getItem('strategy-game.save'), 'KEEP');
});
