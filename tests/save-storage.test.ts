import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deserializeV2 } from '../src/legacy-v2.ts';
import { readStoredCity, saveStoredCity, SAVE_KEY, HOUSEHOLD_SAVE_KEY, LEGACY_SAVE_KEY, LEGACY_BACKUP_KEY, HOUSEHOLD_BACKUP_KEY, LATEST_BACKUP_KEY } from '../src/save-storage.ts';
function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial)), writes: string[] = [];
  return { data, writes, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { writes.push(key); data.set(key, value); } };
}
const old = JSON.stringify({ version: 1, tick: 65 }), household = JSON.stringify({ version: 2, tick: 180 }), current = JSON.stringify({ version: 3, tick: 180 });
test('read v3, then v2, then v1 and explicit old sources without changing storage', () => {
  const s = memory({ [LEGACY_SAVE_KEY]: old }); assert.deepEqual(readStoredCity(s), { raw: old, key: LEGACY_SAVE_KEY });
  s.data.set(HOUSEHOLD_SAVE_KEY, household); assert.deepEqual(readStoredCity(s), { raw: household, key: HOUSEHOLD_SAVE_KEY });
  s.data.set(SAVE_KEY, current); assert.equal(readStoredCity(s)?.raw, current); assert.equal(readStoredCity(s, 'legacy')?.raw, old);
  assert.deepEqual(readStoredCity(s, 'household'), { raw: household, key: HOUSEHOLD_SAVE_KEY });
  assert.equal(readStoredCity(s, 'backup'), null); assert.deepEqual(s.writes, []);
});
test('back up exact imported v1 once before saving v3 and preserve both original slots', () => {
  const s = memory({ [LEGACY_SAVE_KEY]: old, [HOUSEHOLD_SAVE_KEY]: household }); assert.deepEqual(saveStoredCity(s, current, old), { backup: LEGACY_BACKUP_KEY });
  assert.equal(s.data.get(LEGACY_SAVE_KEY), old); assert.equal(s.data.get(LEGACY_BACKUP_KEY), old);
  assert.equal(s.data.get(HOUSEHOLD_SAVE_KEY), household);
  assert.deepEqual(s.writes, [LEGACY_BACKUP_KEY, LATEST_BACKUP_KEY, SAVE_KEY]); saveStoredCity(s, current, old);
  assert.deepEqual(s.writes, [LEGACY_BACKUP_KEY, LATEST_BACKUP_KEY, SAVE_KEY, SAVE_KEY]);
});
test('retain distinct backups; corrupt current does not silently substitute another city', () => {
  const older = JSON.stringify({ version: 1, tick: 30 }), s = memory({ [LEGACY_BACKUP_KEY]: older }); saveStoredCity(s, current, old);
  assert.equal(s.data.get(LEGACY_BACKUP_KEY), older); assert.equal(readStoredCity(s, 'backup')?.raw, old);
  s.data.set(SAVE_KEY, '{broken'); s.data.set(LEGACY_SAVE_KEY, old);
  assert.equal(readStoredCity(s)?.raw, '{broken'); assert.equal(readStoredCity(s, 'legacy')?.raw, old);
  s.data.delete(SAVE_KEY); s.data.set(HOUSEHOLD_SAVE_KEY, '{broken-v2');
  assert.equal(readStoredCity(s)?.raw, '{broken-v2'); assert.equal(readStoredCity(s, 'legacy')?.raw, old);
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
  for (const raw of [old, household, '{broken', JSON.stringify({ version: 4 })]) assert.throws(() => saveStoredCity(s, raw, null));
  for (const raw of [current, '{broken', JSON.stringify({ version: 0 })]) assert.throws(() => saveStoredCity(s, current, raw));
  for (let i = 0; i < 8; i++) s.data.set(i ? `${LEGACY_BACKUP_KEY}.${i}` : LEGACY_BACKUP_KEY, JSON.stringify({ version: 1, tick: i }));
  const before = [...s.data]; assert.throws(() => saveStoredCity(s, current, old), /full/); assert.deepEqual([...s.data], before);
});

test('v2 backup is immutable, reused even after an empty slot, and latest recovery spans old versions', () => {
  const key = `${HOUSEHOLD_BACKUP_KEY}.3`, s = memory({ [HOUSEHOLD_SAVE_KEY]: household, [key]: household });
  assert.deepEqual(saveStoredCity(s, current, household), { backup: key });
  assert.equal(s.data.get(HOUSEHOLD_SAVE_KEY), household); assert.equal(s.data.has(HOUSEHOLD_BACKUP_KEY), false);
  assert.deepEqual(s.writes, [LATEST_BACKUP_KEY, SAVE_KEY]);
  saveStoredCity(s, current, household); assert.deepEqual(s.writes, [LATEST_BACKUP_KEY, SAVE_KEY, SAVE_KEY]);
  assert.deepEqual(readStoredCity(s, 'backup'), { raw: household, key });
  saveStoredCity(s, current, old); assert.deepEqual(readStoredCity(s, 'backup'), { raw: old, key: LEGACY_BACKUP_KEY });
  saveStoredCity(s, current, household); assert.deepEqual(readStoredCity(s, 'backup'), { raw: household, key });
});

test('old backups without metadata recover; corrupt pointers cannot select the primary slot', () => {
  const s = memory({ [`${LEGACY_BACKUP_KEY}.7`]: old, [SAVE_KEY]: current });
  assert.deepEqual(readStoredCity(s, 'backup'), { raw: old, key: `${LEGACY_BACKUP_KEY}.7` });
  s.data.set(LATEST_BACKUP_KEY, SAVE_KEY); assert.equal(readStoredCity(s, 'backup')?.raw, old);
  s.data.set(HOUSEHOLD_BACKUP_KEY, household); assert.equal(readStoredCity(s, 'backup')?.raw, household);
  s.data.set(LATEST_BACKUP_KEY, `${HOUSEHOLD_BACKUP_KEY}.7`); assert.equal(readStoredCity(s, 'backup')?.raw, household);
  assert.deepEqual(s.writes, []);
});

test('backup, metadata and primary quotas preserve the previous v3 and original v2 bytes', () => {
  const s = memory({ [SAVE_KEY]: 'previous', [HOUSEHOLD_SAVE_KEY]: household });
  assert.throws(() => saveStoredCity({ getItem: s.getItem, setItem: () => { throw Error('backup quota'); } }, current, household), /backup quota/);
  assert.equal(s.data.get(SAVE_KEY), 'previous'); assert.equal(s.data.has(HOUSEHOLD_BACKUP_KEY), false);
  assert.throws(() => saveStoredCity({ getItem: s.getItem, setItem: (key, value) => { if (key === LATEST_BACKUP_KEY) throw Error('metadata quota'); s.setItem(key, value); } }, current, household), /metadata quota/);
  assert.equal(s.data.get(SAVE_KEY), 'previous'); assert.equal(s.data.get(HOUSEHOLD_BACKUP_KEY), household);
  assert.throws(() => saveStoredCity({ getItem: s.getItem, setItem: (key, value) => { if (key === SAVE_KEY) throw Error('primary quota'); s.setItem(key, value); } }, current, household), /primary quota/);
  assert.equal(s.data.get(SAVE_KEY), 'previous'); assert.equal(s.data.get(HOUSEHOLD_SAVE_KEY), household);
  assert.deepEqual(readStoredCity(s, 'backup'), { raw: household, key: HOUSEHOLD_BACKUP_KEY });
});

test('full v2 backup series aborts without changing any bytes; an identical copy still saves', () => {
  const s = memory({ [SAVE_KEY]: 'previous', [HOUSEHOLD_SAVE_KEY]: household });
  for (let i = 0; i < 8; i++) s.data.set(i ? `${HOUSEHOLD_BACKUP_KEY}.${i}` : HOUSEHOLD_BACKUP_KEY, JSON.stringify({ version: 2, tick: i }));
  const before = [...s.data]; assert.throws(() => saveStoredCity(s, current, household), /full/); assert.deepEqual([...s.data], before);
  const exact = `${HOUSEHOLD_BACKUP_KEY}.5`; s.data.set(exact, household);
  assert.deepEqual(saveStoredCity(s, current, household), { backup: exact }); assert.equal(s.data.get(HOUSEHOLD_SAVE_KEY), household);
});

test('frozen published v2 reader returns exact valid state and rejects corrupt old economics before migration', () => {
  const raw = readFileSync(new URL('./fixtures/legacy-v2-day180.json', import.meta.url), 'utf8'), old = deserializeV2(raw);
  assert.equal(old.version, 2); assert.equal(old.rulesVersion, 'household-1'); assert.equal(old.tick, 180);
  assert.equal(JSON.stringify(old), raw); assert.equal(JSON.stringify(deserializeV2(raw)), raw);
  const corruptions = [
    (c: typeof old) => { c.households[0].members++; },
    (c: typeof old) => { c.employment[0].workers += 100; },
    (c: typeof old) => { c.employment.push({ ...c.employment[0] }); },
    (c: typeof old) => { c.ledger[0].amount++; },
    (c: typeof old) => { c.goodsLedger[0].quantity++; },
    (c: typeof old) => { c.nextId = c.households[0].id; },
    (c: typeof old) => { c.firms[0].workDays[c.households[0].wallet] = 1; },
    (c: typeof old) => { c.rulesVersion = 'worker-1' as typeof c.rulesVersion; },
  ];
  for (const corrupt of corruptions) { const copy = JSON.parse(raw); corrupt(copy); assert.throws(() => deserializeV2(JSON.stringify(copy))); }
  for (const invalid of ['{broken', JSON.stringify({ version: 1 }), current, ' '.repeat(12_000_001)]) assert.throws(() => deserializeV2(invalid));
});
