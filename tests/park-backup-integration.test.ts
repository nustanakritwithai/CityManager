import test from 'node:test';
import assert from 'node:assert/strict';
import { createCity, deserialize, serialize } from '../src/sim.ts';
import { FOOD_BACKUP_KEY, PARKS_BACKUP_KEY, SAVE_KEY, LATEST_BACKUP_KEY, readStoredCity, saveStoredCity } from '../src/save-storage.ts';

function oldCity(version: 12 | 13, seed: number): string {
  const raw = JSON.parse(serialize(createCity(seed, { starter: false })));
  raw.version = version; raw.rulesVersion = version === 12 ? 'chain-7' : 'chain-8'; delete raw.parks;
  if (version === 12) delete raw.foodDemandStartTick;
  return JSON.stringify(raw);
}
function storage(initial: Record<string, string>, fail?: string) {
  const data = new Map(Object.entries(initial));
  return { data, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { if (key === fail) throw new Error('quota'); data.set(key, value); } };
}

test('v14 saves retain distinct food and park migration backups and recover the latest exact bytes', () => {
  const foodFirst = oldCity(12, 1), parkFirst = oldCity(13, 2), foodNext = oldCity(12, 3), parkNext = oldCity(13, 4);
  const s = storage({ [SAVE_KEY]: foodNext, [FOOD_BACKUP_KEY]: foodFirst, [PARKS_BACKUP_KEY]: parkFirst });
  saveStoredCity(s, serialize(deserialize(foodNext)), null);
  assert.equal(s.data.get(`${FOOD_BACKUP_KEY}.1`), foodNext);
  assert.equal(readStoredCity(s, 'backup')?.raw, foodNext);
  s.data.set(SAVE_KEY, parkNext);
  saveStoredCity(s, serialize(deserialize(parkNext)), null);
  assert.equal(s.data.get(FOOD_BACKUP_KEY), foodFirst);
  assert.equal(s.data.get(`${FOOD_BACKUP_KEY}.1`), foodNext);
  assert.equal(s.data.get(PARKS_BACKUP_KEY), parkFirst);
  assert.equal(s.data.get(`${PARKS_BACKUP_KEY}.1`), parkNext);
  assert.equal(s.data.get(LATEST_BACKUP_KEY), `${PARKS_BACKUP_KEY}.1`);
  assert.equal(readStoredCity(s, 'backup')?.raw, parkNext);
});

test('full park backup slots preserve a new v13 city and reuse an existing exact match', () => {
  const current = oldCity(13, 99), rows = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [i ? `${PARKS_BACKUP_KEY}.${i}` : PARKS_BACKUP_KEY, oldCity(13, i)]));
  const s = storage({ ...rows, [SAVE_KEY]: current });
  assert.throws(() => saveStoredCity(s, serialize(deserialize(current)), null), /backup slots are full/i);
  assert.equal(s.data.get(SAVE_KEY), current);
  const matching = oldCity(13, 7); s.data.set(SAVE_KEY, matching);
  saveStoredCity(s, serialize(deserialize(matching)), null);
  assert.equal(s.data.get(LATEST_BACKUP_KEY), `${PARKS_BACKUP_KEY}.7`);
  assert.equal(readStoredCity(s, 'backup')?.raw, matching);
  assert.equal(s.data.size, 10);
});

test('failed park backup, recovery pointer, or primary write preserves original v13 bytes', () => {
  const current = oldCity(13, 100), next = serialize(deserialize(current));
  for (const key of [PARKS_BACKUP_KEY, LATEST_BACKUP_KEY, SAVE_KEY]) {
    const s = storage({ [SAVE_KEY]: current }, key);
    assert.throws(() => saveStoredCity(s, next, null), /quota/);
    assert.equal(s.data.get(SAVE_KEY), current);
    if (key !== PARKS_BACKUP_KEY) assert.equal(s.data.get(PARKS_BACKUP_KEY), current);
  }
});
