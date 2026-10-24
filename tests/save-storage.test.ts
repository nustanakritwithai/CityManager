import test from 'node:test';
import assert from 'node:assert/strict';
import { readStoredCity, saveStoredCity, SAVE_KEY, LEGACY_SAVE_KEY, LEGACY_BACKUP_KEY } from '../src/save-storage.ts';
function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial)), writes: string[] = [];
  return { data, writes, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { writes.push(key); data.set(key, value); } };
}
const old = JSON.stringify({ version: 1, tick: 65 }), current = JSON.stringify({ version: 2, tick: 65 });
test('read current, explicit legacy and recovery without changing storage', () => {
  const s = memory({ [LEGACY_SAVE_KEY]: old }); assert.deepEqual(readStoredCity(s), { raw: old, key: LEGACY_SAVE_KEY });
  s.data.set(SAVE_KEY, current); assert.equal(readStoredCity(s)?.raw, current); assert.equal(readStoredCity(s, 'legacy')?.raw, old);
  assert.equal(readStoredCity(s, 'backup'), null); assert.deepEqual(s.writes, []);
});
test('back up exact imported v1 once before saving v2 and preserve its original slot', () => {
  const s = memory({ [LEGACY_SAVE_KEY]: old }); assert.deepEqual(saveStoredCity(s, current, old), { backup: LEGACY_BACKUP_KEY });
  assert.equal(s.data.get(LEGACY_SAVE_KEY), old); assert.equal(s.data.get(LEGACY_BACKUP_KEY), old);
  assert.deepEqual(s.writes, [LEGACY_BACKUP_KEY, SAVE_KEY]); saveStoredCity(s, current, old);
  assert.deepEqual(s.writes, [LEGACY_BACKUP_KEY, SAVE_KEY, SAVE_KEY]);
});
test('retain distinct backups; corrupt current does not silently substitute another city', () => {
  const older = JSON.stringify({ version: 1, tick: 30 }), s = memory({ [LEGACY_BACKUP_KEY]: older }); saveStoredCity(s, current, old);
  assert.equal(s.data.get(LEGACY_BACKUP_KEY), older); assert.equal(readStoredCity(s, 'backup')?.raw, old);
  s.data.set(SAVE_KEY, '{broken'); s.data.set(LEGACY_SAVE_KEY, old);
  assert.equal(readStoredCity(s)?.raw, '{broken'); assert.equal(readStoredCity(s, 'legacy')?.raw, old);
});
test('backup quota failure prevents primary overwrite; failed primary retains a recovery copy', () => {
  const s = memory({ [SAVE_KEY]: 'previous', [LEGACY_SAVE_KEY]: old });
  assert.throws(() => saveStoredCity({ getItem: s.getItem, setItem: () => { throw Error('quota'); } }, current, old), /quota/);
  assert.equal(s.data.get(SAVE_KEY), 'previous');
  assert.throws(() => saveStoredCity({ getItem: s.getItem, setItem: (key, value) => { if (key === SAVE_KEY) throw Error('quota'); s.setItem(key, value); } }, current, old), /quota/);
  assert.equal(s.data.get(SAVE_KEY), 'previous'); assert.equal(s.data.get(LEGACY_BACKUP_KEY), old); assert.equal(s.data.get(LEGACY_SAVE_KEY), old);
});
test('fresh saves add no legacy data; bad versions and full backups preserve all bytes', () => {
  const s = memory(); saveStoredCity(s, current, null); assert.deepEqual(s.writes, [SAVE_KEY]);
  assert.throws(() => saveStoredCity(s, old, null)); assert.throws(() => saveStoredCity(s, current, current));
  for (let i = 0; i < 8; i++) s.data.set(i ? `${LEGACY_BACKUP_KEY}.${i}` : LEGACY_BACKUP_KEY, JSON.stringify({ version: 1, tick: i }));
  const before = [...s.data]; assert.throws(() => saveStoredCity(s, current, old), /full/); assert.deepEqual([...s.data], before);
});
