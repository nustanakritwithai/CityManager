import test from 'node:test';
import assert from 'node:assert/strict';
import { createCity, deserialize, firmWorkerCount, isRetail, retailDemand, serialize, step, type City } from '../src/sim.ts';
import { retailCapacity, staffedRetailCapacity } from '../src/retail-capacity.ts';
import { keepSupplied } from './plants.ts';
import { RETAIL_BACKUP_KEY, SAVE_KEY, readStoredCity, saveStoredCity } from '../src/save-storage.ts';
import { createParkRuntime, deserializeParkSession, serializeParkSession } from '../src/park-runtime.ts';

function grown(): City {
  const c = createCity(61025);
  for (let d = 0; d < 400 && !c.firms.some(f => isRetail(f) && f.convertedAt !== undefined); d++) { step(c); keepSupplied(c); }
  assert.ok(c.firms.some(f => isRetail(f) && f.convertedAt !== undefined));
  return c;
}

test('retail capacity preserves the old shelf and adds capacity only for actual staff', () => {
  for (const level of [2, 3, 4]) {
    assert.equal(retailCapacity(level).stock, 24);
    assert.equal(staffedRetailCapacity(level, 1).stock, 24);
    assert.equal(retailCapacity(level).workers, level - 1);
  }
  assert.deepEqual([5, 6, 7].map(level => retailCapacity(level).stock), [48, 72, 96]);
  assert.equal(staffedRetailCapacity(7, 0).stock, 0);
  assert.equal(staffedRetailCapacity(7, 3).stock, 24);
  assert.equal(staffedRetailCapacity(7, 4).stock, 48);
  assert.equal(staffedRetailCapacity(7, 6).stock, 96);
});

test('legacy state migrates intact; only the new envelope admits extended levels', () => {
  const original = grown(), raw = JSON.parse(serialize(original));
  raw.version = 15; raw.rulesVersion = 'chain-10';
  const old = JSON.stringify(raw), loaded = deserialize(old);
  assert.deepEqual(loaded, original);
  const firm = loaded.firms.find(f => f.convertedAt !== undefined)!;
  const premise = loaded.buildings.find(b => b.id === firm.building)!;
  premise.level = 7;
  const upgraded = serialize(loaded);
  assert.deepEqual(deserialize(upgraded), loaded);
  const forged = JSON.parse(upgraded); forged.version = 15; forged.rulesVersion = 'chain-10';
  assert.throws(() => deserialize(JSON.stringify(forged)), /corrupt/);
  assert.equal(deserialize(upgraded).firms.find(f => f.id === firm.id)!.convertedAt, firm.convertedAt);
  assert.deepEqual(deserialize(upgraded).firms.find(f => f.id === firm.id)!.owner, firm.owner);
  const runtime = createParkRuntime(loaded);
  assert.deepEqual(deserializeParkSession(serializeParkSession(loaded, runtime)), { city: loaded, runtime });
  const oldSession = { ...JSON.parse(old), parkRuntime: createParkRuntime(original) };
  assert.deepEqual(deserializeParkSession(JSON.stringify(oldSession)).city, original);
  const items = new Map<string, string>([[SAVE_KEY, old]]);
  const storage = { getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => { items.set(k, v); } };
  saveStoredCity(storage, upgraded, null);
  assert.equal(items.get(RETAIL_BACKUP_KEY), old);
  assert.equal(readStoredCity(storage, 'backup')?.raw, old);
});

test('a real shop upgrades on the same cell and buys and sells its expanded stock', () => {
  const c = createCity(61025);
  let upgradedId = 0, transitionTick = 0, beforeIdentity: unknown;
  for (let d = 0; d < 400; d++) {
    const before = c.firms.filter(isRetail).map(f => ({ id: f.id, building: f.building, wallet: f.wallet, owner: structuredClone(f.owner), convertedAt: f.convertedAt, level: c.buildings.find(b => b.id === f.building)!.level, cell: c.buildings.find(b => b.id === f.building)!.cell }));
    step(c); keepSupplied(c);
    for (const prev of before) {
      const f = c.firms.find(x => x.id === prev.id), b = c.buildings.find(x => x.id === prev.building);
      if (!upgradedId && prev.level === 4 && f && b?.level === 5) {
        upgradedId = f.id; transitionTick = c.tick; beforeIdentity = prev;
        assert.equal(b.cell, prev.cell); assert.equal(f.wallet, prev.wallet);
        assert.equal(f.owner?.householdId, prev.owner?.householdId); assert.equal(f.owner?.capitalContributed, prev.owner?.capitalContributed);
        assert.equal(f.convertedAt, prev.convertedAt);
        assert.ok(c.ledger.some(e => e.tick === c.tick && e.from === f.wallet && e.to === 'construction' && e.amount === 20_000 && e.reason === 'Profitable firm height investment'));
      }
    }
  }
  assert.ok(upgradedId && beforeIdentity, 'the shop autonomously reached level five');
  const shop = c.firms.find(f => f.id === upgradedId)!;
  assert.ok(shop.inventory > 24, 'the staffed shop held more than the legacy shelf');
  assert.ok(c.goodsLedger.some(e => e.tick > transitionTick && e.to === shop.wallet && (e.reason === 'Wholesale stock delivery' || e.reason === 'Imported shop stock')));
  assert.ok(c.goodsLedger.some(e => e.tick > transitionTick && e.from === shop.wallet && e.reason === 'Household final consumption'));
  assert.equal(Object.values(c.accounts).reduce((a, b) => a + b, 0), 0);
  assert.equal(c.goods.produced + c.goods.imported - c.goods.consumed - c.goods.exported, c.firms.reduce((n, f) => n + f.inventory, 0));
  assert.deepEqual(deserialize(serialize(c)), c);
  const demandCity = deserialize(serialize(c)), expanded = demandCity.firms.find(f => f.id === upgradedId)!;
  const building = demandCity.buildings.find(b => b.id === expanded.building)!;
  assert.ok(firmWorkerCount(demandCity, expanded.id) >= 4);
  // Extra buyers isolate the demand signal; the snapshot is not stepped or saved.
  for (let i = 0; i < 24; i++) demandCity.households.push({ ...demandCity.households[0] });
  const highDemand = retailDemand(demandCity);
  building.level = 4;
  assert.equal(retailDemand(demandCity), highDemand + 1);
  building.level = 5;
  const stock = expanded.inventory;
  expanded.inventory = 0;
  assert.equal(retailDemand(demandCity), highDemand + 1, 'empty extra shelf does not suppress new shop demand');
  expanded.inventory = stock;
  demandCity.employment = demandCity.employment.filter(e => e.firmId !== expanded.id);
  assert.equal(retailDemand(demandCity), highDemand + 1, 'vacant extra jobs do not suppress new shop demand');
});
