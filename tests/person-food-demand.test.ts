import test from 'node:test';
import assert from 'node:assert/strict';
import { createCity, step } from '../src/sim.ts';

test('a family can purchase one food unit for each member on the same day', () => {
  const city = createCity(61025);
  let observed = false;
  for (let day = 0; day < 240; day++) {
    step(city);
    for (const household of city.households.filter(h => h.members > 1)) {
      const crops = city.cropLedger.filter(e => e.tick === city.tick && e.kind === 'consumption' && e.to === household.wallet).reduce((sum, e) => sum + e.quantity, 0);
      const goods = city.goodsLedger.filter(e => e.tick === city.tick && e.reason === 'Household final consumption' && e.to === household.wallet).reduce((sum, e) => sum + e.quantity, 0);
      assert.ok(crops + goods <= household.members, 'purchases cannot exceed the number of members');
      if (crops + goods === household.members) observed = true;
    }
  }
  assert.ok(observed, 'at least one family obtains one unit per member');
});

test('daily purchases remain bounded and save/load preserves the new journals', async () => {
  const { serialize, deserialize } = await import('../src/sim.ts');
  let city = createCity(61025); let sales = 0;
  for (let day = 0; day < 180; day++) {
    step(city);
    for (const h of city.households) {
      const count = city.cropLedger.filter(e => e.tick === city.tick && e.kind === 'consumption' && e.to === h.wallet).reduce((n, e) => n + e.quantity, 0) + city.goodsLedger.filter(e => e.tick === city.tick && e.reason === 'Household final consumption' && e.to === h.wallet).reduce((n, e) => n + e.quantity, 0);
      assert.ok(count <= h.members); sales += count;
      if (count > 0 && count < h.members) assert.ok(h.needs > 0);
    }
    if (day % 30 === 29) city = deserialize(serialize(city));
    assert.equal(Object.values(city.accounts).reduce((n, value) => n + value, 0), 0);
  }
  assert.ok(sales > 0);
});


test('a family with only enough cash for one unit records unmet need', () => {
  const city = createCity(61025); let observed = false;
  for (let day = 0; day < 200 && !observed; day++) {
    const family = city.households.find(h => h.members === 3 && city.accounts[h.wallet] > 800);
    if (family) {
      const amount = city.accounts[family.wallet] - 800;
      city.accounts[family.wallet] -= amount; city.accounts.outside += amount;
      if (amount) city.ledger.push({ tick: city.tick, from: family.wallet, to: 'outside', amount, reason: 'Test expense' });
    }
    step(city);
    if (family) {
      const n = city.goodsLedger.filter(e => e.tick === city.tick && e.to === family.wallet && e.reason === 'Household final consumption').reduce((a, e) => a + e.quantity, 0) + city.cropLedger.filter(e => e.tick === city.tick && e.to === family.wallet && e.kind === 'consumption').reduce((a, e) => a + e.quantity, 0);
      if (n) { assert.equal(n, 1); assert.ok(family.needs > 0); observed = true; }
    }
  }
  assert.ok(observed, 'the constrained household purchased one unit');
});

test('saving the food version first preserves the previous version 12 bytes', async () => {
  const { SAVE_KEY, FOOD_BACKUP_KEY, saveStoredCity } = await import('../src/save-storage.ts');
  const { serialize, deserialize } = await import('../src/sim.ts');
  // Build the legacy fixture from a city before any per-person purchases are recorded.
  const empty = createCity(61025); const old = JSON.parse(serialize(empty)); old.version = 12; old.rulesVersion = 'chain-7'; delete old.foodDemandStartTick; delete old.parks;
  const raw = JSON.stringify(old), loaded = deserialize(raw); assert.equal(loaded.tick, empty.tick);
  const values = new Map([[SAVE_KEY, raw]]);
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  saveStoredCity(storage, serialize(loaded), null);
  assert.equal(values.get(FOOD_BACKUP_KEY), raw); assert.equal(JSON.parse(values.get(SAVE_KEY)!).version, 14);
  assert.equal(deserialize(values.get(SAVE_KEY)!).tick, empty.tick);
});
