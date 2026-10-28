import test from 'node:test';
import assert from 'node:assert/strict';
import { createCity, deserialize, serialize } from '../src/sim.ts';
import { FOOD_BACKUP_KEY, SAVE_KEY, LATEST_BACKUP_KEY, readStoredCity, saveStoredCity } from '../src/save-storage.ts';

function oldCity(seed: number): string {
  const raw = JSON.parse(serialize(createCity(seed)));
  raw.version = 12; raw.rulesVersion = 'chain-7'; delete raw.foodDemandStartTick;
  return JSON.stringify(raw);
}
function storage(initial: Record<string, string> = {}, fail?: string) {
  const data = new Map(Object.entries(initial));
  return { data, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { if (key === fail) throw new Error('quota'); data.set(key, value); } };
}
test('distinct v12 cities are backed up separately and latest recovery points to the second', () => {
  const first = oldCity(1), second = oldCity(2);
  const s = storage({ [SAVE_KEY]: second, [FOOD_BACKUP_KEY]: first });
  saveStoredCity(s, serialize(deserialize(second)), null);
  assert.equal(s.data.get(FOOD_BACKUP_KEY), first);
  assert.equal(s.data.get(`${FOOD_BACKUP_KEY}.1`), second);
  assert.equal(s.data.get(LATEST_BACKUP_KEY), `${FOOD_BACKUP_KEY}.1`);
  assert.equal(readStoredCity(s, 'backup')?.raw, second);
});
test('matching v12 backup is reused even when all backup slots are full', () => {
  const current = oldCity(7), rows = Object.fromEntries(Array.from({length: 8}, (_, i) => [i ? `${FOOD_BACKUP_KEY}.${i}` : FOOD_BACKUP_KEY, oldCity(i)]));
  const s = storage({ ...rows, [SAVE_KEY]: current });
  saveStoredCity(s, serialize(deserialize(current)), null);
  assert.equal(s.data.get(LATEST_BACKUP_KEY), `${FOOD_BACKUP_KEY}.7`);
  assert.equal(s.data.size, 10);
});
test('full backup slots or backup write failure keep the original v12 save', () => {
  const current = oldCity(99), next = serialize(deserialize(current));
  const rows = Object.fromEntries(Array.from({length: 8}, (_, i) => [i ? `${FOOD_BACKUP_KEY}.${i}` : FOOD_BACKUP_KEY, oldCity(i)]));
  const full = storage({ ...rows, [SAVE_KEY]: current });
  assert.throws(() => saveStoredCity(full, next, null), /backup slots are full/i);
  assert.equal(full.data.get(SAVE_KEY), current);
  const quota = storage({ [SAVE_KEY]: current }, FOOD_BACKUP_KEY);
  assert.throws(() => saveStoredCity(quota, next, null), /quota/);
  assert.equal(quota.data.get(SAVE_KEY), current);
});
test('failed recovery pointer or primary write does not replace the original save', () => {
  const current = oldCity(100), next = serialize(deserialize(current));
  for (const key of [LATEST_BACKUP_KEY, SAVE_KEY]) {
    const s = storage({ [SAVE_KEY]: current }, key);
    assert.throws(() => saveStoredCity(s, next, null), /quota/);
    assert.equal(s.data.get(SAVE_KEY), current);
    assert.equal(s.data.get(FOOD_BACKUP_KEY), current);
  }
});
