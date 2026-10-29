import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deserializeParkSession, serializeParkSession } from '../src/park-runtime.ts';
import { FARM_LEVEL_BACKUP_KEY, SAVE_KEY, saveStoredCity } from '../src/save-storage.ts';

test('actual v17 factory session migrates to combined levels with city and populated park activity intact', () => {
  // Produced by housing/factory integration 0abf712 from the genuine v16 park fixture.
  const raw = readFileSync(new URL('./fixtures/factory-v17-park-session.json', import.meta.url), 'utf8');
  const old = JSON.parse(raw); assert.equal(old.version, 17); assert.equal(old.rulesVersion, 'chain-12');
  assert.equal(old.parkRuntime.activity.visitors.length, 6); assert.equal(Object.keys(old.parkRuntime.recreation.citizens).length, 6);
  const loaded = deserializeParkSession(raw), next = serializeParkSession(loaded.city, loaded.runtime);
  const { version: _oldVersion, rulesVersion: _oldRules, parkRuntime: _parkRuntime, ...expectedCity } = old;
  const { version, rulesVersion, farmLevelStartTick, ...actualCity } = loaded.city;
  assert.deepEqual(actualCity, expectedCity); assert.equal(version, 9); assert.equal(rulesVersion, 'chain-4');
  assert.equal(farmLevelStartTick, old.tick);
  assert.equal(loaded.city.factoryProgressionStartTick, old.factoryProgressionStartTick);
  assert.deepEqual(JSON.parse(JSON.stringify(loaded.runtime)), old.parkRuntime);
  assert.equal(JSON.parse(next).version, 19); assert.deepEqual(deserializeParkSession(next), loaded);
  const values = new Map([[SAVE_KEY, raw]]), storage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); } };
  saveStoredCity(storage, next, null); assert.equal(values.get(FARM_LEVEL_BACKUP_KEY), raw);
  const forged = JSON.parse(raw), shop = forged.buildings.find((b: { zone: string; level: number }) => b.zone === 'C' && b.level > 1);
  assert.ok(shop); shop.level = 5; assert.throws(() => deserializeParkSession(JSON.stringify(forged)));
});
