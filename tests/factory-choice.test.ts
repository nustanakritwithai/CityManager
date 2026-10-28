import test from 'node:test';
import assert from 'node:assert/strict';
import { createCity, deserialize, selectFactoryRecipe, selectFarmCrop, serialize, step } from '../src/sim.ts';
import { RECIPE, RECIPES } from '../src/goods.ts';
import { FACTORY_CHOICE_BACKUP_KEY, LATEST_BACKUP_KEY, SAVE_KEY, readStoredCity, saveStoredCity } from '../src/save-storage.ts';

test('factory recipe can change without losing existing stocks and survives save and continued simulation', () => {
  const city = createCity(61025);
  for (let day = 0; day < 120; day++) step(city);
  const firm = city.firms.find(f => f.zone === 'I' && f.recipe && f.cropInventory > 0)!;
  assert.ok(firm);
  const before = { crops: structuredClone(firm.crops), products: structuredClone(firm.products), money: city.accounts[firm.wallet] };
  const oldCrop = RECIPE[firm.recipe!].crop;
  const next = RECIPES.find(recipe => recipe !== firm.recipe)!;
  assert.equal(selectFactoryRecipe(city, firm.id, next).ok, true);
  assert.deepEqual(firm.crops, before.crops); assert.deepEqual(firm.products, before.products); assert.equal(city.accounts[firm.wallet], before.money);
  const loaded = deserialize(serialize(city));
  assert.equal(loaded.firms.find(f => f.id === firm.id)?.recipe, next);
  const ledgerStart = loaded.cropLedger.length;
  for (let day = 0; day < 30; day++) step(loaded);
  const events = loaded.cropLedger.slice(ledgerStart);
  assert.ok(events.some(e => e.kind === 'trade' && e.from === firm.wallet && e.crop === oldCrop), 'old inputs are sold to an actual market');
  assert.ok(events.filter(e => e.kind === 'process' && e.from === firm.wallet).every(e => e.crop === RECIPE[next].crop), 'only matching crops are processed');
  assert.deepEqual(deserialize(serialize(loaded)), loaded);
});

test('v11 save is preserved before the first v12 save and can be recovered', () => {
  const city = createCity(61025), current = serialize(city);
  const prior = JSON.parse(current); delete prior.foodDemandStartTick; delete prior.factoryProgressionStartTick; delete prior.farmLevelStartTick;
  const old = JSON.stringify({ ...prior, version: 11, rulesVersion: 'chain-6' });
  const data = new Map([[SAVE_KEY, old]]);
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
  saveStoredCity(storage, current, null);
  assert.equal(data.get(FACTORY_CHOICE_BACKUP_KEY), old);
  assert.equal(data.get(LATEST_BACKUP_KEY), FACTORY_CHOICE_BACKUP_KEY);
  assert.equal(readStoredCity(storage, 'backup')?.raw, old);
  assert.deepEqual(deserialize(old), city);
});

test('distinct v11 saves receive distinct backups, and a full backup set preserves the old primary', () => {
  const next = serialize(createCity(61025));
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
  for (let i = 0; i < 8; i++) {
    const raw = JSON.stringify({ version: 11, tick: i }); data.set(SAVE_KEY, raw);
    saveStoredCity(storage, next, null);
    assert.equal(data.get(i ? `${FACTORY_CHOICE_BACKUP_KEY}.${i}` : FACTORY_CHOICE_BACKUP_KEY), raw);
  }
  const old = JSON.stringify({ version: 11, tick: 9 }); data.set(SAVE_KEY, old);
  assert.throws(() => saveStoredCity(storage, next, null), /backup slots are full/);
  assert.equal(data.get(SAVE_KEY), old);
});

test('a changed factory sells its old input then processes the newly selected crop', () => {
  const city = createCity(61025);
  for (let day = 0; day < 120; day++) step(city);
  const farm = city.firms.find(f => f.zone === 'F')!;
  const factory = city.firms.find(f => f.zone === 'I' && f.recipe === 'rice-mill' && f.crops.rice > 0)!;
  assert.ok(farm && factory);
  assert.equal(selectFarmCrop(city, farm.id, 'vegetables').ok, true);
  assert.equal(selectFactoryRecipe(city, factory.id, 'cannery').ok, true);
  const begin = city.cropLedger.length;
  for (let day = 0; day < 60; day++) step(city);
  const events = city.cropLedger.slice(begin).filter(e => e.from === factory.wallet);
  assert.ok(events.some(e => e.kind === 'trade' && e.crop === 'rice'));
  assert.ok(events.some(e => e.kind === 'process' && e.crop === 'vegetables'));
  assert.ok(events.filter(e => e.kind === 'process').every(e => e.crop === 'vegetables'));
  assert.deepEqual(deserialize(serialize(city)), city);
});

test('automatic selection can be restored and invalid requests do not change the city', () => {
  const city = createCity(61025);
  for (let day = 0; day < 120; day++) step(city);
  const firm = city.firms.find(f => f.zone === 'I')!;
  assert.ok(firm);
  assert.equal(selectFactoryRecipe(city, firm.id, 'sugar-mill').ok, true);
  assert.equal(firm.recipeMode, 'manual');
  assert.equal(selectFactoryRecipe(city, firm.id, 'auto').ok, true);
  assert.equal(firm.recipeMode, 'auto');
  const before = serialize(city);
  assert.equal(selectFactoryRecipe(city, -1, 'cannery').ok, false);
  assert.equal(serialize(city), before);
  assert.deepEqual(deserialize(before), city);
});
