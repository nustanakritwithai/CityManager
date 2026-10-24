import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { deserializeV2 } from '../src/legacy-v2.ts';
import { deserializeV3 } from '../src/legacy-v3.ts';
import { readStoredCity, saveStoredCity, SAVE_KEY, COMMERCIAL_SAVE_KEY, COMMERCIAL_BACKUP_KEY, AGRICULTURE_SAVE_KEY, AGRICULTURE_BACKUP_KEY, WORKER_SAVE_KEY, HOUSEHOLD_SAVE_KEY, LEGACY_SAVE_KEY, LEGACY_BACKUP_KEY, HOUSEHOLD_BACKUP_KEY, WORKER_BACKUP_KEY, LATEST_BACKUP_KEY } from '../src/save-storage.ts';
function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial)), writes: string[] = [];
  return { data, writes, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { writes.push(key); data.set(key, value); } };
}
const old = JSON.stringify({ version: 1, tick: 65 }), household = JSON.stringify({ version: 2, tick: 180 }), worker = JSON.stringify({ version: 3, tick: 180 }), agriculture = JSON.stringify({ version: 4, tick: 180 }), commercial = JSON.stringify({ version: 5, tick: 388 }), current = JSON.stringify({ version: 6, tick: 180 });
test('read v6, then v5/v4/v3/v2/v1 and explicit old sources without changing storage', () => {
  const s = memory({ [LEGACY_SAVE_KEY]: old }); assert.deepEqual(readStoredCity(s), { raw: old, key: LEGACY_SAVE_KEY });
  s.data.set(HOUSEHOLD_SAVE_KEY, household); assert.deepEqual(readStoredCity(s), { raw: household, key: HOUSEHOLD_SAVE_KEY });
  s.data.set(WORKER_SAVE_KEY, worker); assert.deepEqual(readStoredCity(s), { raw: worker, key: WORKER_SAVE_KEY });
  s.data.set(AGRICULTURE_SAVE_KEY, agriculture); assert.deepEqual(readStoredCity(s), { raw: agriculture, key: AGRICULTURE_SAVE_KEY });
  assert.deepEqual(readStoredCity(s, 'agriculture'), { raw: agriculture, key: AGRICULTURE_SAVE_KEY });
  s.data.set(COMMERCIAL_SAVE_KEY, commercial); assert.deepEqual(readStoredCity(s), { raw: commercial, key: COMMERCIAL_SAVE_KEY });
  assert.deepEqual(readStoredCity(s, 'commercial'), { raw: commercial, key: COMMERCIAL_SAVE_KEY });
  s.data.set(SAVE_KEY, current); assert.equal(readStoredCity(s)?.raw, current); assert.equal(readStoredCity(s, 'legacy')?.raw, old);
  assert.deepEqual(readStoredCity(s, 'household'), { raw: household, key: HOUSEHOLD_SAVE_KEY });
  assert.deepEqual(readStoredCity(s, 'worker'), { raw: worker, key: WORKER_SAVE_KEY });
  assert.equal(readStoredCity(s, 'backup'), null); assert.deepEqual(s.writes, []);
});
test('back up exact imported v1 once before saving v6 and preserve all original slots', () => {
  const s = memory({ [LEGACY_SAVE_KEY]: old, [HOUSEHOLD_SAVE_KEY]: household, [WORKER_SAVE_KEY]: worker }); assert.deepEqual(saveStoredCity(s, current, old), { backup: LEGACY_BACKUP_KEY });
  assert.equal(s.data.get(LEGACY_SAVE_KEY), old); assert.equal(s.data.get(LEGACY_BACKUP_KEY), old);
  assert.equal(s.data.get(HOUSEHOLD_SAVE_KEY), household);
  assert.equal(s.data.get(WORKER_SAVE_KEY), worker);
  assert.deepEqual(s.writes, [LEGACY_BACKUP_KEY, LATEST_BACKUP_KEY, SAVE_KEY]); saveStoredCity(s, current, old);
  assert.deepEqual(s.writes, [LEGACY_BACKUP_KEY, LATEST_BACKUP_KEY, SAVE_KEY, SAVE_KEY]);
});
test('retain distinct backups; corrupt current does not silently substitute another city', () => {
  const older = JSON.stringify({ version: 1, tick: 30 }), s = memory({ [LEGACY_BACKUP_KEY]: older }); saveStoredCity(s, current, old);
  assert.equal(s.data.get(LEGACY_BACKUP_KEY), older); assert.equal(readStoredCity(s, 'backup')?.raw, old);
  s.data.set(SAVE_KEY, '{broken'); s.data.set(LEGACY_SAVE_KEY, old);
  assert.equal(readStoredCity(s)?.raw, '{broken'); assert.equal(readStoredCity(s, 'legacy')?.raw, old);
  s.data.delete(SAVE_KEY); s.data.set(WORKER_SAVE_KEY, '{broken-v3');
  assert.equal(readStoredCity(s)?.raw, '{broken-v3'); assert.equal(readStoredCity(s, 'household'), null);
  s.data.delete(WORKER_SAVE_KEY); s.data.set(HOUSEHOLD_SAVE_KEY, '{broken-v2');
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
  for (const raw of [old, household, worker, agriculture, commercial, '{broken', JSON.stringify({ version: 7 })]) assert.throws(() => saveStoredCity(s, raw, null));
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

test('backup, metadata and primary quotas preserve the previous v6 and original v2 bytes', () => {
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

test('v3 original and immutable backup survive repeated v6 saves; latest recovery follows all old versions', () => {
  const key = `${WORKER_BACKUP_KEY}.4`, s = memory({ [LEGACY_SAVE_KEY]: old, [HOUSEHOLD_SAVE_KEY]: household, [WORKER_SAVE_KEY]: worker, [key]: worker });
  assert.deepEqual(saveStoredCity(s, current, worker), { backup: key });
  assert.equal(s.data.has(WORKER_BACKUP_KEY), false); assert.deepEqual(s.writes, [LATEST_BACKUP_KEY, SAVE_KEY]);
  saveStoredCity(s, current, worker); assert.deepEqual(s.writes, [LATEST_BACKUP_KEY, SAVE_KEY, SAVE_KEY]);
  for (const [raw, original, expected] of [[household, HOUSEHOLD_SAVE_KEY, HOUSEHOLD_BACKUP_KEY], [worker, WORKER_SAVE_KEY, key], [old, LEGACY_SAVE_KEY, LEGACY_BACKUP_KEY]] as const) {
    saveStoredCity(s, current, raw); assert.equal(s.data.get(original), raw); assert.deepEqual(readStoredCity(s, 'backup'), { raw, key: expected });
  }
  assert.equal(s.data.get(WORKER_SAVE_KEY), worker); assert.equal(s.data.get(key), worker);
});

test('v3 backup, metadata and primary quota failures preserve original slots and previous v6', () => {
  for (const blocked of [WORKER_BACKUP_KEY, LATEST_BACKUP_KEY, SAVE_KEY]) {
    const s = memory({ [SAVE_KEY]: 'previous', [WORKER_SAVE_KEY]: worker, [HOUSEHOLD_SAVE_KEY]: household, [LEGACY_SAVE_KEY]: old });
    assert.throws(() => saveStoredCity({ getItem: s.getItem, setItem: (key, value) => { if (key === blocked) throw Error('quota'); s.setItem(key, value); } }, current, worker), /quota/);
    assert.equal(s.data.get(SAVE_KEY), 'previous'); assert.equal(s.data.get(WORKER_SAVE_KEY), worker);
    assert.equal(s.data.get(HOUSEHOLD_SAVE_KEY), household); assert.equal(s.data.get(LEGACY_SAVE_KEY), old);
    if (blocked === WORKER_BACKUP_KEY) assert.equal(s.data.has(WORKER_BACKUP_KEY), false);
    else assert.equal(s.data.get(WORKER_BACKUP_KEY), worker);
  }
});

test('v3 backup capacity is independent and full slots never overwrite; recovery allowlist includes v3 only bounded keys', () => {
  const s = memory({ [SAVE_KEY]: 'previous', [WORKER_SAVE_KEY]: worker });
  for (let i = 0; i < 8; i++) s.data.set(i ? `${WORKER_BACKUP_KEY}.${i}` : WORKER_BACKUP_KEY, JSON.stringify({ version: 3, tick: i }));
  const before = [...s.data]; assert.throws(() => saveStoredCity(s, current, worker), /full/); assert.deepEqual([...s.data], before);
  saveStoredCity(s, current, household); assert.equal(s.data.get(HOUSEHOLD_BACKUP_KEY), household);
  s.data.set(`${WORKER_BACKUP_KEY}.7`, worker); s.data.set(LATEST_BACKUP_KEY, `${WORKER_BACKUP_KEY}.7`);
  assert.deepEqual(readStoredCity(s, 'backup'), { raw: worker, key: `${WORKER_BACKUP_KEY}.7` });
  s.data.set(LATEST_BACKUP_KEY, WORKER_SAVE_KEY); assert.deepEqual(readStoredCity(s, 'backup'), { raw: worker, key: `${WORKER_BACKUP_KEY}.7` });
  s.data.set(LATEST_BACKUP_KEY, `${WORKER_BACKUP_KEY}.8`); assert.deepEqual(readStoredCity(s, 'backup'), { raw: worker, key: `${WORKER_BACKUP_KEY}.7` });
});

const frozenV3Hashes = {
  96: 'd3df2066643b63e0e2839215922c373c302f84907c55fd2890b56fb467652fdb',
  97: '16b5b547aaf12732cb179b3634946e6fd9c8a973aba7ce948b623e8490579327',
  119: '2f63fa3d0863568907009ae405b770fd3fc7a79bcd9306d4aced72391aed2727',
  180: '59518ff5b7d2a7c7de52ef8cb8362ed387f91df67ffc09934c93e97f3a556693',
} as const;

test('frozen v3 readers preserve published skill/job/economic history including unsettled wages byte-for-byte', () => {
  for (const tick of [96, 97, 119, 180] as const) {
    const raw = readFileSync(new URL(`./fixtures/legacy-v3-day${tick}.json`, import.meta.url), 'utf8');
    assert.equal(createHash('sha256').update(raw).digest('hex'), frozenV3Hashes[tick]);
    const old = deserializeV3(raw); assert.equal(old.version, 3); assert.equal(old.rulesVersion, 'worker-1'); assert.equal(old.tick, tick);
    assert.equal(JSON.stringify(old), raw); assert.equal(JSON.stringify(deserializeV3(raw)), raw);
    if (tick !== 180) assert.ok(old.firms.some(f => Object.values(f.workDays).some(days => days > 0)), 'Actual earned wage claims remain, not cleared by the reader');
    assert.ok(old.employment.every(e => e.skill === 'general' || e.skill === e.occupation));
  }
});

test('frozen v3 reader rejects corrupt old skills, claims, journals, capacities and unsupported versions before conversion', () => {
  const raw = readFileSync(new URL('./fixtures/legacy-v3-day119.json', import.meta.url), 'utf8'), old = deserializeV3(raw);
  const corruptions = [
    (c: typeof old) => { c.households[0].workerSkills.general++; },
    (c: typeof old) => { c.households[0].members++; },
    (c: typeof old) => { c.employment[0].workers += 100; },
    (c: typeof old) => { c.employment.push({ ...c.employment[0] }); },
    (c: typeof old) => { c.employment[0].skill = (c.employment[0].occupation === 'manufacturing' ? 'retail' : 'manufacturing'); },
    (c: typeof old) => { c.firms[0].workDays[c.households[0].wallet] = 1000; },
    (c: typeof old) => { c.ledger[0].amount++; },
    (c: typeof old) => { c.goodsLedger[0].quantity++; },
    (c: typeof old) => { c.nextId = c.households[0].id; },
    (c: typeof old) => { c.rulesVersion = 'agriculture-1' as typeof c.rulesVersion; },
    (c: typeof old) => { c.firms[0].zone = 'F' as typeof c.firms[0]['zone']; },
  ];
  for (const corrupt of corruptions) { const copy = JSON.parse(raw); corrupt(copy); assert.throws(() => deserializeV3(JSON.stringify(copy))); }
  for (const invalid of ['{broken', old.version.toString(), JSON.stringify({ version: 1 }), household, current, ' '.repeat(12_000_001)]) assert.throws(() => deserializeV3(invalid));
});


test('v4 agriculture originals, bounded immutable backups and v6 primary remain distinct through repeated saves', () => {
  assert.equal(SAVE_KEY, 'citymanager.save.v6'); assert.equal(AGRICULTURE_SAVE_KEY, 'citymanager.save.v4');
  const s = memory({ [AGRICULTURE_SAVE_KEY]: agriculture, [WORKER_SAVE_KEY]: worker });
  assert.deepEqual(saveStoredCity(s, current, agriculture), { backup: AGRICULTURE_BACKUP_KEY });
  assert.equal(s.data.get(AGRICULTURE_SAVE_KEY), agriculture); assert.equal(s.data.get(AGRICULTURE_BACKUP_KEY), agriculture);
  assert.equal(s.data.get(SAVE_KEY), current); assert.deepEqual(readStoredCity(s, 'backup'), { raw: agriculture, key: AGRICULTURE_BACKUP_KEY });
  assert.deepEqual(s.writes, [AGRICULTURE_BACKUP_KEY, LATEST_BACKUP_KEY, SAVE_KEY]);
  saveStoredCity(s, current, agriculture); assert.deepEqual(s.writes, [AGRICULTURE_BACKUP_KEY, LATEST_BACKUP_KEY, SAVE_KEY, SAVE_KEY]);
  assert.equal(s.data.get(WORKER_SAVE_KEY), worker);
});

test('v4 backup quota and full-slot failure retain original bytes and the previous v6 city', () => {
  for (const blocked of [AGRICULTURE_BACKUP_KEY, LATEST_BACKUP_KEY, SAVE_KEY]) {
    const s = memory({ [SAVE_KEY]: 'previous-v6', [AGRICULTURE_SAVE_KEY]: agriculture });
    assert.throws(() => saveStoredCity({ getItem: s.getItem, setItem: (key, value) => { if (key === blocked) throw Error('quota'); s.setItem(key, value); } }, current, agriculture), /quota/);
    assert.equal(s.data.get(SAVE_KEY), 'previous-v6'); assert.equal(s.data.get(AGRICULTURE_SAVE_KEY), agriculture);
  }
  const s = memory({ [SAVE_KEY]: 'previous-v6', [AGRICULTURE_SAVE_KEY]: agriculture });
  for (let i = 0; i < 8; i++) s.data.set(i ? `${AGRICULTURE_BACKUP_KEY}.${i}` : AGRICULTURE_BACKUP_KEY, JSON.stringify({ version: 4, tick: i }));
  const before = [...s.data]; assert.throws(() => saveStoredCity(s, current, agriculture), /full/); assert.deepEqual([...s.data], before);
  const exact = `${AGRICULTURE_BACKUP_KEY}.5`; s.data.set(exact, agriculture);
  assert.deepEqual(saveStoredCity(s, current, agriculture), { backup: exact }); assert.equal(s.data.get(AGRICULTURE_SAVE_KEY), agriculture);
});

test('v5 commercial source is read-only, preferred over v4 and immutably backed before explicit v6 save', () => {
  assert.equal(COMMERCIAL_SAVE_KEY, 'citymanager.save.v5'); assert.equal(COMMERCIAL_BACKUP_KEY, 'citymanager.backup.v5');
  const s = memory({ [COMMERCIAL_SAVE_KEY]: commercial, [AGRICULTURE_SAVE_KEY]: agriculture });
  assert.deepEqual(readStoredCity(s), { raw: commercial, key: COMMERCIAL_SAVE_KEY });
  assert.deepEqual(readStoredCity(s, 'commercial'), { raw: commercial, key: COMMERCIAL_SAVE_KEY });
  assert.deepEqual(s.writes, []);
  assert.deepEqual(saveStoredCity(s, current, commercial), { backup: COMMERCIAL_BACKUP_KEY });
  assert.equal(s.data.get(COMMERCIAL_SAVE_KEY), commercial); assert.equal(s.data.get(COMMERCIAL_BACKUP_KEY), commercial);
  assert.equal(s.data.get(AGRICULTURE_SAVE_KEY), agriculture); assert.equal(s.data.get(SAVE_KEY), current);
  assert.deepEqual(readStoredCity(s, 'backup'), { raw: commercial, key: COMMERCIAL_BACKUP_KEY });
  assert.deepEqual(s.writes, [COMMERCIAL_BACKUP_KEY, LATEST_BACKUP_KEY, SAVE_KEY]);
  saveStoredCity(s, current, commercial);
  assert.deepEqual(s.writes, [COMMERCIAL_BACKUP_KEY, LATEST_BACKUP_KEY, SAVE_KEY, SAVE_KEY]);
});

test('v5 backup/full-slot/metadata/primary quota failures preserve old bytes and v6 primary', () => {
  for (const blocked of [COMMERCIAL_BACKUP_KEY, LATEST_BACKUP_KEY, SAVE_KEY]) {
    const s = memory({ [SAVE_KEY]: 'previous-v6', [COMMERCIAL_SAVE_KEY]: commercial });
    assert.throws(() => saveStoredCity({ getItem: s.getItem, setItem: (key, value) => { if (key === blocked) throw Error('quota'); s.setItem(key, value); } }, current, commercial), /quota/);
    assert.equal(s.data.get(COMMERCIAL_SAVE_KEY), commercial); assert.equal(s.data.get(SAVE_KEY), 'previous-v6');
  }
  const s = memory({ [SAVE_KEY]: 'previous-v6', [COMMERCIAL_SAVE_KEY]: commercial });
  for (let i = 0; i < 8; i++) s.data.set(i ? `${COMMERCIAL_BACKUP_KEY}.${i}` : COMMERCIAL_BACKUP_KEY, JSON.stringify({ version: 5, tick: i }));
  const before = [...s.data]; assert.throws(() => saveStoredCity(s, current, commercial), /full/); assert.deepEqual([...s.data], before);
  const exact = `${COMMERCIAL_BACKUP_KEY}.4`; s.data.set(exact, commercial);
  assert.deepEqual(saveStoredCity(s, current, commercial), { backup: exact }); assert.equal(s.data.get(COMMERCIAL_SAVE_KEY), commercial);
});
