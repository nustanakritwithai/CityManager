import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as legacy from '../src/legacy-v4.ts';
import { createCity, deserialize, serialize, step, zoneCell, firmCapacity, firmWage, firmRent, firmWorkerCount, isCommercial, isMarket, isRetail, summary, ownerFinance, contributeOwnerCapital, withdrawOwnerProfit, type City } from '../src/sim.ts';
import { SAVE_KEY, AGRICULTURE_SAVE_KEY, AGRICULTURE_BACKUP_KEY, LATEST_BACKUP_KEY, readStoredCity, saveStoredCity } from '../src/save-storage.ts';

function oldCity(day = 179) {
  const c = legacy.createCity();
  for (let i = 0; i < day; i++) legacy.step(c);
  return legacy.deserializeV4(legacy.serialize(c));
}
function preserved(c: City | legacy.City, throughTick = -1) {
  const { commercialUnifiedStartTick: _commercialTick, commercialUnifiedBaseline: _commercialBaseline, history: _history, version: _version, rulesVersion: _rules, typeBaseline: _types, growthStartTick: _growth, foodDemandStartTick: _food, factoryProgressionStartTick: _factory, farmLevelStartTick: _farm, cells: _cells, buildings: _buildings, firms: _firms, utilities: _utilities, plants: _plants, parks: _parks, ...state } = c as City;
  // Water and power changed shape in chain-4 (an outside contract and plants); the facts below did not.
  return {...state,ledger:state.ledger.filter(e=>e.tick>throughTick),goodsLedger:state.goodsLedger.filter(e=>e.tick>throughTick),cropLedger:state.cropLedger.filter(e=>e.tick>throughTick)};
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
  assert.equal(city.version, 9); assert.equal(city.rulesVersion, 'chain-4');
  assert.equal(city.factoryProgressionStartTick, city.tick); assert.equal(city.farmLevelStartTick, city.tick);
  assert.deepEqual(preserved(city,city.history?.throughTick), preserved(old,city.history?.throughTick));
  for (const f of old.firms) {
    const current = city.firms.find(n => n.id === f.id)!;
    const { zone: _zone, commercialKind: _kind, crops: _crops, products: _products, recipe: _recipe, ...rest } = current;
    const { zone: _oldZone, ...oldRest } = f;
    assert.deepEqual(rest, oldRest);
    assert.equal(current.zone, f.zone === 'T' ? 'C' : f.zone);
    assert.equal(current.commercialKind, f.zone === 'T' ? 'market' : f.zone === 'C' ? 'retail' : undefined);
    assert.equal(firmCapacity(city.buildings.find(b => b.id === f.building)!), legacy.firmCapacity(old.buildings.find(b => b.id === f.building)!));
    assert.equal(firmWage(current), current.zone==='C'?42_000:legacy.firmWage(f)); assert.equal(firmRent(current), current.zone==='C'?10_000:legacy.firmRent(f)); // Future unified rates; historical workDays/cash above remain exact.
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
    assert.throws(() => deserialize(serialize(bad)), /corrupt/);
  }
  const bad = structuredClone(city); bad.buildings.find(b => b.id === market.building)!.level = 2;
  assert.equal(loaded(bad).buildings.find(b=>b.id===market.building)!.level,2,'v25 admits shared commercial progression without retyping');
  const frozen = JSON.parse(serialize(city));
  frozen.version = frozen.commercialBaseVersion;
  frozen.rulesVersion = ({19:'chain-14',20:'chain-15',21:'chain-16',22:'chain-17',23:'chain-18',24:'chain-19'} as Record<number,string>)[frozen.version];
  delete frozen.commercialBaseVersion; delete frozen.commercialUnifiedStartTick; delete frozen.commercialUnifiedBaseline;
  assert.doesNotThrow(() => deserialize(JSON.stringify(frozen)), 'the same legacy wrapper with the original L1 remains valid');
  frozen.buildings.find((b: {id:number}) => b.id === market.building).level = 2;
  assert.throws(() => deserialize(JSON.stringify(frozen)), /corrupt/, 'a legacy wrapper cannot admit the new higher-level crop provenance');
});

test('legacy v1/v2/v3 migration remains validated, lossless through frozen v4, and idempotent', () => {
  for (const file of ['legacy-v1-day65.json', 'legacy-v2-day180.json', 'legacy-v3-day180.json']) {
    const raw = readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf8'), old = legacy.deserializeV4(raw), city = deserialize(raw);
    assert.deepEqual(preserved(city,city.history?.throughTick), preserved(old,city.history?.throughTick));
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

test('fresh commercial zoning creates one business type with both shelves, real funding and shared growth', () => {
  const city=createCity(),before=serialize(city);assert.equal(zoneCell(city,0,'T' as never).ok,false);assert.equal(serialize(city),before);
  const observed: City['ledger'] = [];
  for(let i=0;i<180;i++){step(city);observed.push(...city.ledger.filter(e=>e.tick===city.tick));loaded(city);}
  const shops=city.firms.filter(isCommercial);assert.ok(shops.length>0);
  assert.ok(shops.every(f=>{const l=city.buildings.find(b=>b.id===f.building)!.level;return l>=1&&l<=9;}));
  for(const f of shops){
    assert.ok(observed.some(e=>e.to===f.wallet&&e.reason===(f.owner?'Owner capital contribution':'Outside firm equity investment')&&e.amount===(f.owner?60_000:300_000)));
    assert.ok(observed.every(e=>e.from!==f.wallet||e.reason!=='Market to shop conversion'));
  }
  assert.ok(city.goodsLedger.some(e=>e.reason==='Household final consumption'&&shops.some(f=>f.wallet===e.from)));
  assert.ok(city.cropLedger.some(e=>e.kind==='process'));
  assert.ok(shops.some(f=>f.cropInventory>0&&f.inventory>0),'same business holds both shelves');
  assert.ok(city.buildings.every(b=>b.zone!==('T' as never))&&city.cells.every(b=>b.zone!==('T' as never)));
  assert.deepEqual(Object.keys(summary(city).demand).sort(),['C','F','I','R']);
  for(const f of shops.filter(f=>f.owner)){
    const copy=loaded(city),facts=ownerFinance(copy,f.id)!;
    assert.equal(withdrawOwnerProfit(copy,f.id,10_000).ok,facts.withdrawAvailable>=10_000);
    const contribution=ownerFinance(copy,f.id)!.contributeAvailable;
    assert.equal(contributeOwnerCapital(copy,f.id,10_000).ok,contribution>=10_000);loaded(copy);
  }
});

test('migrated stock, wage liabilities and owner distributions survive deterministic continuation and repeated load', () => {
  const raw = legacy.serialize(oldCity()), a = deserialize(raw), b = deserialize(raw);
  const initial = serialize(a); let paidAt180=false;
  for (let i = 0; i < 65; i++) { step(a); step(b); if(a.tick===180)paidAt180=a.ledger.some(e=>e.tick===180&&e.reason==='Monthly wages'); assert.deepEqual(loaded(a), b); }
  assert.notEqual(serialize(a), initial);
  assert.ok(paidAt180,'actual monthly wages observed before the approved detail-retention cutoff');
  assert.equal(Object.values(a.accounts).reduce((n, value) => n + value, 0), 0);
  assert.equal(a.crops.harvested - a.crops.processed - a.crops.consumed - a.crops.writtenOff - (a.crops.exported ?? 0), a.firms.reduce((n, f) => n + f.cropInventory, 0));
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
