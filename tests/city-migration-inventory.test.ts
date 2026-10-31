import test from 'node:test';
import assert from 'node:assert/strict';
import { inventoryLegacyCities } from '../src/city-migration-inventory.ts';
import { createCity } from '../src/sim.ts';
import { createParkRuntime, serializeParkSession } from '../src/park-runtime.ts';
import { encodeSaveCopy } from '../src/save-copy-codec.ts';
import type { RecoveryListing } from '../src/recovery-idb.ts';

function memory(entries: Record<string, string>) {
  const keys = Object.keys(entries);
  return { length: keys.length, key: (i: number) => keys[i] ?? null, getItem: (k: string) => entries[k] ?? null,
    setItem() { throw Error('browser writes prohibited'); }, removeItem() { throw Error('deletion prohibited'); } };
}
function raw(tick = 0) { const city = createCity(61025); city.tick = tick; return serializeParkSession(city, createParkRuntime(city)); }
function recovery(raw: string, slot: 'baseline'|'previous'|'current', branchId = 'active-branch'): RecoveryListing {
  const parsed = JSON.parse(raw);
  return { branchId, slot, snapshot: { raw, slot, branchId, revision: `${slot}-revision`, capturedAt: 1, tick: parsed.tick, version: parsed.version } };
}

test('imports every primary/checkpoint/retained backup, decompressing losslessly and retaining provenance', async () => {
  const first = raw(4), latest = raw(2), oldest = raw(1);
  const entries = {
    'citymanager.save.v7': latest,
    'citymanager.checkpoint.latest': encodeSaveCopy(latest),
    'citymanager.backup.before-education.7': first,
    'citymanager.backup.save-conflict.19': oldest,
    'citymanager.backup.save-conflict.index': JSON.stringify(['citymanager.backup.save-conflict.19']),
    'citymanager.backup.save-conflict.latest': 'citymanager.backup.save-conflict.19',
    'citymanager.backup.latest': 'citymanager.backup.before-education.7',
    'citymanager.audio.v1': 'not-a-city',
    'citymanager.market.v10': 'legacy-identity-not-city',
  };
  const original = JSON.stringify(entries);
  const result = await inventoryLegacyCities(memory(entries), async () => [recovery(latest, 'current'), recovery(first, 'baseline'), recovery(oldest, 'previous')]);
  assert.deepEqual(result.issues, []);
  assert.equal(result.candidates.length, 3);
  assert.equal(result.candidates.find(c => c.raw === latest)?.sources.length, 3);
  assert.ok(result.candidates.find(c => c.raw === latest)?.sources.includes('indexedDB:active-branch:current:current-revision'));
  assert.deepEqual(result.candidates.map(c => c.tick).sort(), [1, 2, 4]);
  assert.equal(JSON.stringify(entries), original);
});

test('unreadable slots report issues without hiding readable cities or selecting a higher tick', async () => {
  const current = raw(3), stale = raw(80);
  const result = await inventoryLegacyCities(memory({ 'citymanager.save.v7': current, 'citymanager.backup.old': stale, 'citymanager.save.v2': '{broken' }), async () => [{ branchId: 'broken', slot: 'current', snapshot: null }]);
  assert.equal(result.candidates.length, 2);
  assert.equal(result.issues.length, 2);
  assert.ok(result.issues.some(i => i.includes('localStorage:citymanager.save.v2')));
  assert.ok(result.issues.some(i => i.includes('indexedDB:broken:current')));
  assert.equal('selected' in result, false);
});

test('empty inventory is distinct from unavailable storage and IDB', async () => {
  assert.deepEqual(await inventoryLegacyCities(memory({}), async () => []), { candidates: [], issues: [] });
  const blocked = { get length(): number { throw Error('SecurityError'); }, key: () => null, getItem: () => null };
  assert.deepEqual(await inventoryLegacyCities(blocked, async () => { throw Error('SecurityError'); }), { candidates: [], issues: ['localStorage: unavailable', 'indexedDB: unavailable'] });
});

test('continues past an unreadable slot and diagnoses dangling reference metadata', async () => {
  const saved = raw(1), base = memory({ 'citymanager.save.v7': saved, 'citymanager.backup.bad': saved, 'citymanager.backup.latest': 'citymanager.backup.missing' });
  const result = await inventoryLegacyCities({ ...base, getItem: key => { if (key === 'citymanager.backup.bad') throw Error('SecurityError'); return base.getItem(key); } }, async () => []);
  assert.equal(result.candidates.length, 1);
  assert.deepEqual(result.issues, ['localStorage:citymanager.backup.bad: unreadable', 'localStorage:citymanager.backup.latest: missing-reference']);
});

test('repeated inventories are idempotent and preserve exact bytes rather than reserializing', async () => {
  const saved = JSON.stringify(JSON.parse(raw(9)), null, 2);
  const storage = memory({ 'citymanager.save.v7': saved, 'citymanager.backup.chain-2': saved });
  const list = async () => [recovery(saved, 'baseline'), recovery(saved, 'current')];
  const first = await inventoryLegacyCities(storage, list), second = await inventoryLegacyCities(storage, list);
  assert.deepEqual(first, second);
  assert.equal(first.candidates.length, 1);
  assert.equal(first.candidates[0].raw, saved);
  assert.equal(first.candidates[0].sources.length, 4);
});

test('preserves park/session and embedded market journal bytes without normalization', async () => {
  const city = createCity(61025), runtime = createParkRuntime(city);
  const market = { version: 10 as const, rulesVersion: 'chain-5' as const,
    guestId: '11111111-1111-4111-8111-111111111111', cityId: '22222222-2222-4222-8222-222222222222',
    operations: [], escrow: [], receipts: {}, seq: '7' };
  const saved = JSON.stringify(JSON.parse(serializeParkSession(city, runtime, market)), null, 2);
  const result = await inventoryLegacyCities(memory({ 'citymanager.save.v7': encodeSaveCopy(saved) }), async () => []);
  assert.deepEqual(result.issues, []);
  assert.equal(result.candidates[0].raw, saved);
  assert.deepEqual(JSON.parse(result.candidates[0].raw).parkRuntime, JSON.parse(saved).parkRuntime);
  assert.deepEqual(JSON.parse(result.candidates[0].raw).market, market);
});
