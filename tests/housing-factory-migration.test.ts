import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deserializeParkSession, serializeParkSession } from '../src/park-runtime.ts';
import { FACTORY_PROGRESS_BACKUP_KEY, SAVE_KEY, saveStoredCity } from '../src/save-storage.ts';

test('actual v16 housing session preserves populated park state and backups on factory migration', () => {
  // Produced by the housing integration at 982d44a from the observed v15 park fixture.
  const raw = readFileSync(new URL('./fixtures/housing-v16-park-session.json', import.meta.url), 'utf8');
  const old = JSON.parse(raw);
  assert.equal(old.version, 16); assert.equal(old.rulesVersion, 'chain-11');
  assert.equal(old.parkRuntime.activity.visitors.length, 6);
  assert.equal(Object.keys(old.parkRuntime.recreation.citizens).length, 6);
  const { version: _version, rulesVersion: _rules, parkRuntime, ...expectedCity } = old;
  const loaded = deserializeParkSession(raw);
  const { factoryProgressionStartTick, version, rulesVersion, ...actualCity } = loaded.city;
  assert.deepEqual(actualCity, expectedCity);
  assert.equal(version, 9); assert.equal(rulesVersion, 'chain-4');
  assert.equal(factoryProgressionStartTick, old.tick);
  assert.deepEqual(JSON.parse(JSON.stringify(loaded.runtime)), parkRuntime);
  const next = serializeParkSession(loaded.city, loaded.runtime);
  assert.equal(JSON.parse(next).version, 17);
  assert.deepEqual(deserializeParkSession(next), loaded);
  const values = new Map([[SAVE_KEY, raw]]);
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  saveStoredCity(storage, next, null);
  assert.equal(values.get(FACTORY_PROGRESS_BACKUP_KEY), raw);
  const forged = JSON.parse(raw); forged.factoryProgressionStartTick = 0;
  assert.throws(() => deserializeParkSession(JSON.stringify(forged)), /boundary/);
  // v16 can contain apartments but cannot contain the later factory tier.
  const apartment = JSON.parse(raw), home = apartment.buildings.find((b: { zone: string }) => b.zone === 'R');
  home.level = 4; home.housingType = 'apartment';
  const apartmentLoaded = deserializeParkSession(JSON.stringify(apartment));
  assert.equal(apartmentLoaded.city.buildings.find(b => b.id === home.id)?.housingType, 'apartment');
  const earlyFactory = JSON.parse(raw), factory = earlyFactory.buildings.find((b: { zone: string }) => b.zone === 'I');
  factory.level = 4;
  assert.throws(() => deserializeParkSession(JSON.stringify(earlyFactory)));
});
