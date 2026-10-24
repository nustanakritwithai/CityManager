import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as legacy from '../src/legacy-v4.ts';
import { createCity, deserialize, serialize, step, zoneCell, firmCapacity, firmWage, firmRent, firmWorkerCount, isMarket, isRetail, summary, contributeOwnerCapital, withdrawOwnerProfit, type City } from '../src/sim.ts';
import { SAVE_KEY, AGRICULTURE_SAVE_KEY, AGRICULTURE_BACKUP_KEY, LATEST_BACKUP_KEY, readStoredCity, saveStoredCity } from '../src/save-storage.ts';

function oldCity(day = 179) {
  const c = legacy.createCity();
  for (let i = 0; i < day; i++) legacy.step(c);
  return legacy.deserializeV4(legacy.serialize(c));
}
function preserved(c: City | legacy.City) {
  const { version: _version, rulesVersion: _rules, growthStartTick: _growth, cells: _cells, buildings: _buildings, firms: _firms, ...state } = c as City;
  return state;
}
const loaded = (c: City) => deserialize(serialize(c));
function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial)), writes: string[] = [];
  return { data, writes, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); writes.push(key); } };
}

test('v4 T market becomes commercial L1 without changing any economic or labor fact', () => {
  const old = oldCity(), before = legacy.serialize(old);
  const owner = old.firms.find(f => f.zone === 'T')!;
  assert.ok(owner.owner && owner.cropInventory > 0 && owner.cropCost > 0);
  assert.ok(old.firms.some(f => Object.keys(f.workDays).length > 0));
  assert.equal(legacy.withdrawOwnerProfit(old, owner.id, 10000).ok, true);
  assert.equal(legacy.contributeOwnerCapital(old, owner.id, 10000).ok, true);
  const raw = legacy.serialize(old), city = deserialize(raw);
  assert.equal(city.version, 6); assert.equal(city.rulesVersion, 'growth-1');
  assert.deepEqual(preserved(city), preserved(old));
  for (const f of old.firms) {
    const current = city.firms.find(n => n.id === f.id)!;
    const { zone: _zone, commercialKind: _kind, ...rest } = current;
    const { zone: _oldZone, ...oldRest } = f;
    assert.deepEqual(rest, oldRest);
    assert.equal(current.zone, f.zone === 'T' ? 'C' : f.zone);
    assert.equal(current.commercialKind, f.zone === 'T' ? 'market' : f.zone === 'C' ? 'retail' : undefined);
    assert.equal(firmCapacity(city.buildings.find(b => b.id === f.building)!), legacy.firmCapacity(old.buildings.find(b => b.id === f.building)!));
    assert.equal(firmWage(current), legacy.firmWage(f)); assert.equal(firmRent(current), legacy.firmRent(f));
    assert.equal(firmWorkerCount(city, f.id), legacy.firmWorkerCount(old, f.id));
  }
  assert.equal(city.buildings.find(b => b.id === owner.building)!.level, 1);
  assert.notEqual(before, raw, 'Fixture exercises actual owner contribution and realized-profit withdrawal');
  assert.equal(legacy.serialize(old), raw, 'Loading cannot modify source state or history');
});

test('legacy retailers retain exact jobs at mapped commercial levels 2-4; market cannot masquerade as retail', () => {
  const old = oldCity(), shop = old.firms.find(f => f.zone === 'C')!;
  for (const level of [1, 2, 3]) {
    const fixture = structuredClone(old), b = fixture.buildings.find(b => b.id === shop.building)!;
    b.level = level;
    const city = deserialize(legacy.serialize(legacy.deserializeV4(legacy.serialize(fixture))));
    const current = city.firms.find(f => f.id === shop.id)!, premise = city.buildings.find(b => b.id === shop.building)!;
    assert.ok(isRetail(current)); assert.equal(premise.level, level + 1); assert.equal(firmCapacity(premise), level);
    assert.deepEqual(current.workDays, shop.workDays); assert.equal(city.accounts[current.wallet], old.accounts[shop.wallet]);
  }
  const city = deserialize(legacy.serialize(old)), market = city.firms.find(isMarket)!;
  for (const kind of [undefined, 'retail', 'other']) {
    const bad = structuredClone(city); (bad.firms.find(f => f.id === market.id)! as unknown as { commercialKind: unknown }).commercialKind = kind;
    assert.throws(() => deserialize(JSON.stringify(bad)), /corrupt/);
  }
  const bad = structuredClone(city); bad.buildings.find(b => b.id === market.building)!.level = 2;
  assert.throws(() => loaded(bad), /corrupt/);
});

test('legacy v1/v2/v3 migration remains validated, lossless through frozen v4, and idempotent', () => {
  for (const file of ['legacy-v1-day65.json', 'legacy-v2-day180.json', 'legacy-v3-day180.json']) {
    const raw = readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf8'), old = legacy.deserializeV4(raw), city = deserialize(raw);
    assert.deepEqual(preserved(city), preserved(old));
    assert.ok(city.firms.filter(f => f.zone === 'C').every(isRetail));
    assert.deepEqual(loaded(loaded(city)), city);
    assert.deepEqual(deserialize(raw), city, 'Repeated imports cannot append money, populations, stock or history');
  }
});

test('strict v4 validation precedes migration and rejects forged stock, owner capital, wages and unknown versions', () => {
  const old = oldCity(), corruptions = [
    (c: legacy.City) => { c.firms.find(f => f.zone === 'T')!.cropInventory++; },
    (c: legacy.City) => { c.firms.find(f => f.zone === 'T')!.owner!.capitalContributed++; },
    (c: legacy.City) => { c.firms.find(f => f.zone === 'C')!.workDays['household:16']++; },
    (c: legacy.City) => { c.accounts.treasury++; },
  ];
  for (const corrupt of corruptions) { const bad = structuredClone(old); corrupt(bad); assert.throws(() => deserialize(legacy.serialize(bad)), /corrupt/); }
  assert.throws(() => deserialize(JSON.stringify({ version: 7 })), /corrupt/);
});

test('fresh commercial zoning builds only owner-funded L1 markets, keeps crop consumption and never auto-upgrades', () => {
  const city = createCity(), before = serialize(city);
  assert.equal(zoneCell(city, 0, 'T' as never).ok, false); assert.equal(serialize(city), before);
  for (let i = 0; i < 180; i++) { step(city); loaded(city); }
  const markets = city.firms.filter(isMarket);
  assert.ok(markets.length > 0); assert.ok(city.firms.filter(f => f.zone === 'C').every(isMarket));
  assert.ok(city.buildings.every(b => b.zone !== ('T' as never)) && city.cells.every(b => b.zone !== ('T' as never)));
  assert.ok(markets.every(f => city.buildings.find(b => b.id === f.building)!.level === 1 && f.owner !== null && Object.keys(f.workDays).length === 0));
  assert.ok(city.cropLedger.some(e => e.kind === 'consumption'));
  assert.ok(city.cropLedger.some(e => e.kind === 'process'));
  assert.ok(city.cropLedger.some(e => e.kind === 'trade' && markets.some(f => f.wallet === e.from)));
  assert.ok(city.ledger.filter(e => markets.some(f => f.wallet === e.to)).every(e => !e.reason.includes('Outside') && e.from !== 'outside'));
  assert.deepEqual(Object.keys(summary(city).demand).sort(), ['C', 'F', 'I', 'R']);
  for (const f of markets) {
    const copy = loaded(city);
    assert.equal(withdrawOwnerProfit(copy, f.id, 10000).ok, true);
    assert.equal(contributeOwnerCapital(copy, f.id, 10000).ok, true); loaded(copy);
  }
});

test('migrated stock, wage liabilities and owner distributions survive deterministic continuation and repeated load', () => {
  const raw = legacy.serialize(oldCity()), a = deserialize(raw), b = deserialize(raw);
  const initial = serialize(a);
  for (let i = 0; i < 65; i++) { step(a); step(b); assert.deepEqual(loaded(a), b); }
  assert.notEqual(serialize(a), initial);
  assert.ok(a.ledger.some(e => e.tick === 180 && e.reason === 'Monthly wages'));
  assert.equal(Object.values(a.accounts).reduce((n, value) => n + value, 0), 0);
  assert.equal(a.crops.harvested - a.crops.processed - a.crops.consumed - a.crops.writtenOff, a.firms.reduce((n, f) => n + f.cropInventory, 0));
  const market = a.firms.find(isMarket)!;
  const factsBefore = structuredClone(market.owner);
  if (withdrawOwnerProfit(a, market.id, 10000).ok) { loaded(a); assert.equal(market.owner!.withdrawn, factsBefore!.withdrawn + 10000); }
  assert.deepEqual(loaded(loaded(a)), a);
});

test('v4 local slot remains byte-for-byte recoverable with one immutable backup before explicit v6 save', () => {
  const raw = legacy.serialize(oldCity()), migrated = serialize(deserialize(raw)), storage = memory({ [AGRICULTURE_SAVE_KEY]: raw });
  assert.deepEqual(readStoredCity(storage), { raw, key: AGRICULTURE_SAVE_KEY }); assert.deepEqual(storage.writes, []);
  assert.deepEqual(readStoredCity(storage, 'agriculture'), { raw, key: AGRICULTURE_SAVE_KEY });
  assert.equal(saveStoredCity(storage, migrated, raw).backup, AGRICULTURE_BACKUP_KEY);
  assert.equal(storage.data.get(AGRICULTURE_SAVE_KEY), raw); assert.equal(storage.data.get(AGRICULTURE_BACKUP_KEY), raw);
  assert.equal(storage.data.get(SAVE_KEY), migrated); assert.equal(storage.data.get(LATEST_BACKUP_KEY), AGRICULTURE_BACKUP_KEY);
  saveStoredCity(storage, migrated, raw);
  assert.equal(storage.writes.filter(key => key === AGRICULTURE_BACKUP_KEY).length, 1);
  assert.deepEqual(deserialize(readStoredCity(storage, 'backup')!.raw), deserialize(migrated));
});
