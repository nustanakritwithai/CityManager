import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MAX_CITY_BUILDINGS, MAX_CITY_FIRMS, bulldoze, createCity, deserialize, serialize as serializeRaw, step, zoneCell, shopSite, householdWorkerCount, firmWorkerCount, firmCapacity, explainCell, type City } from '../src/sim.ts';
import { parcelChecklist } from '../src/place-checklist.ts';
import { createParkRuntime, serializeParkSession, deserializeParkSession } from '../src/park-runtime.ts';
import { SAVE_KEY, BUSINESS_CAPACITY_BACKUP_KEY, businessCapacityBackupKeys, AUTOSAVE_CHECKPOINT_KEY, LATEST_BACKUP_KEY, readStoredCity, saveStoredCity } from '../src/save-storage.ts';
import { createSaveGuard } from '../src/save-guard.ts';
import { restoreStartupCity } from '../src/startup-save.ts';
import { loadLocalCitySession, saveLocalCitySession } from '../src/local-city-save.ts';
import { marketJournalForTest } from '../src/market-client.ts';
import * as v5 from '../src/legacy-v5.ts';
import {decodeSaveCopy} from '../src/save-copy-codec.ts';
import {compactCityHistory} from '../src/city-history.ts';
import { businessFixture, mixedBusinessFixture, vacantSite } from './business-capacity-fixture.ts';

const memory = (raw?: string) => { const data = new Map<string, string>(raw === undefined ? [] : [[SAVE_KEY, raw]]); return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } }; };
// Production sessions compact trusted runtime history before serializing. Apply the same
// canonical boundary to synthetic tick-400 cities, without changing any live assets.
const serialize=(c:City)=>{compactCityHistory(c);return serializeRaw(c);};
const baseVersion=(raw:string)=>{const s=JSON.parse(raw);return s.commercialBaseVersion===24?s.historyBaseVersion:s.commercialBaseVersion;};
const session = (c: City) => {compactCityHistory(c);return serializeParkSession(c, createParkRuntime(c));};
// Frozen synthetic envelopes produced and validated by base64a1763's actual serializer,
// not current snapshots relabeled as old versions. No private player data.
const historical=(version:22|23)=>readFileSync(new URL(`./fixtures/business-capacity-v${version}.json`,import.meta.url),'utf8');
function reconcile(c: City) {
  assert.equal(Object.values(c.accounts).reduce((a, b) => a + b, 0), 0);
  assert.equal(c.goods.produced + c.goods.imported - c.goods.consumed - c.goods.exported, c.firms.reduce((sum, f) => sum + f.inventory, 0));
  assert.equal(c.crops.harvested - c.crops.processed - c.crops.consumed - c.crops.writtenOff - (c.crops.exported ?? 0), c.firms.reduce((sum, f) => sum + f.cropInventory, 0));
  for (const h of c.households) assert.ok(householdWorkerCount(c, h.id) <= h.workforce);
  for (const f of c.firms) assert.ok(firmWorkerCount(c, f.id) <= firmCapacity(c.buildings.find(b => b.id === f.building)!));
  assert.deepEqual(deserialize(serialize(c)), c); // Includes ledger/typed stock/owner/occupancy reconciliation.
}

test('64 to 65 through normal zoned farm construction pays real capital and construction once', () => {
  const c = businessFixture(), parcel = vacantSite(c), old = serialize(c);
  assert.equal(JSON.parse(old).version, 25); assert.equal(baseVersion(old),22); assert.equal(serialize(deserialize(old)), old);
  assert.equal(zoneCell(c, parcel, 'F').ok, true);
  assert.ok(!explainCell(c, parcel).some(line => /^Firm limit/.test(line)));
  const priorFirms = new Set(c.firms.map(f => f.id)), priorConstruction = c.accounts.construction;
  for (let d = 0; d < 3; d++) step(c);
  const opened = c.firms.filter(f => !priorFirms.has(f.id)); assert.equal(opened.length, 1); assert.equal(opened[0].zone, 'F');
  assert.equal(c.firms.length, 65); assert.equal(c.businessCapacityVersion, 1);
  assert.equal(c.accounts.construction - priorConstruction, 40_000);
  assert.deepEqual(c.ledger.filter(e => e.to === opened[0].wallet && e.reason === 'Outside farm equity investment').map(e => e.amount), [300_000]);
  assert.deepEqual(c.ledger.filter(e => e.from === opened[0].wallet && e.reason === 'Firm building investment').map(e => e.amount), [40_000]);
  assert.equal(opened[0].inventory, 0); assert.equal(JSON.parse(serialize(c)).version, 25); assert.equal(baseVersion(serialize(c)), 23); reconcile(c);
});

test('automatic retail opening also crosses 64 without bypassing normal household capital', () => {
  const c = businessFixture(), parcel = vacantSite(c); assert.equal(zoneCell(c, parcel, 'C').ok, true); assert.equal(shopSite(c), parcel);
  const ids = new Set(c.firms.map(f => f.id)); for (let d = 0; d < 3; d++) step(c);
  const shop = c.firms.find(f => !ids.has(f.id))!; assert.equal(c.firms.length, 65); assert.equal(shop.commercialKind, 'retail');
  assert.ok(shop.owner); assert.equal(shop.owner.capitalContributed, 60_000);
  assert.deepEqual(c.ledger.filter(e => e.to === shop.wallet && e.reason === 'Owner capital contribution').map(e => e.amount), [60_000]);
  assert.deepEqual(c.ledger.filter(e => e.from === shop.wallet && e.reason === 'Self-employed shop construction').map(e => e.amount), [10_000]);
  reconcile(c);
});

test('128 businesses save/replay through payroll with conserved stocks, money and workforce', t => {
  const a = mixedBusinessFixture(), b = deserialize(serialize(a)), timings: number[] = [];
  for (let day = 0; day < 21; day++) { const start = performance.now(); step(a); timings.push(performance.now() - start); step(b); reconcile(a); }
  assert.deepEqual(b, a); assert.equal(a.firms.length, 128);
  assert.ok(a.crops.harvested > 0); assert.ok(a.crops.processed > 0); assert.ok(a.goods.produced > 0); assert.ok(a.goods.consumed > 0); assert.ok(a.goodsLedger.some(e => e.from.startsWith('firm:') && e.to.startsWith('firm:')));
  const raw = session(a); assert.equal(serializeParkSession(deserializeParkSession(raw).city, deserializeParkSession(raw).runtime), raw);
  const sorted = [...timings].sort((x, y) => x - y);
  t.diagnostic(`Synthetic 128-firm/96-household city, 21 cloud-CPU days including payroll: median ${sorted[10].toFixed(1)}ms, max ${sorted.at(-1)!.toFixed(1)}ms, session ${raw.length} chars. No renderer/mobile-FPS or natural-growth claim.`);
});

test('192 shared building parcels remain bounded; unique cells, business premises and safe IDs required', () => {
  assert.equal(MAX_CITY_FIRMS, MAX_CITY_BUILDINGS); assert.equal(MAX_CITY_BUILDINGS, 192);
  const c = businessFixture(MAX_CITY_FIRMS, 0), parcel = vacantSite(c); reconcile(c);
  zoneCell(c, parcel, 'C'); assert.equal(shopSite(c), null);
  const checklist = parcelChecklist(c, parcel)!;
  assert.match(checklist.checks.find(x => x.key === 'firm-limit')!.label, /192/);
  assert.match(checklist.checks.find(x => x.key === 'building-limit')!.label, /192/);
  const before = c.firms.length; for (let n = 0; n < 3; n++) step(c); assert.equal(c.firms.length, before);
  const raw = serialize(c);
  for (const mutate of [
    (s: City) => { s.firms.push(structuredClone(s.firms[0])); },
    (s: City) => { s.buildings.push(structuredClone(s.buildings[0])); },
    (s: City) => { s.firms[1].id = s.firms[0].id; },
    (s: City) => { s.buildings[1].cell = s.buildings[0].cell; },
    (s: City) => { s.firms[1].building = s.firms[0].building; },
    (s: City) => { s.nextId = Number.MAX_SAFE_INTEGER; },
    (s: City) => { s.accounts.treasury++; },
    (s: City) => { s.firms[0].inventory++; },
  ]) { const bad = JSON.parse(raw); mutate(bad); assert.throws(() => deserialize(JSON.stringify(bad))); }
  const noIds = businessFixture(); noIds.nextId = Number.MAX_SAFE_INTEGER - 2; const site = vacantSite(noIds); zoneCell(noIds, site, 'C');
  assert.equal(shopSite(noIds), null); assert.ok(explainCell(noIds, site).some(s => s.startsWith('Entity ID range exhausted')));
  const beforeIds = noIds.nextId, count = noIds.firms.length; for (let n = 0; n < 3; n++) step(noIds); assert.equal(noIds.nextId, beforeIds); assert.equal(noIds.firms.length, count); reconcile(noIds);
});

test('v23 handles education/population/roads combinations but rejects mismatched, future and downgraded saves', () => {
  for (const education of [false, true]) for (const population of [false, true]) for (const roads of [false, true]) {
    const c = businessFixture(65, population ? 129 : 96); if (!education) delete c.education; if (roads) c.roadTopology = { version: 1, blocked: [], oneWay: {} };
    const raw = serialize(c), saved = JSON.parse(raw); assert.equal(saved.version, 25); assert.equal(saved.rulesVersion, 'chain-20'); assert.equal(baseVersion(raw), 23); assert.equal(saved.businessCapacityVersion, 1); assert.equal(serialize(deserialize(raw)), raw);
    for (const edit of [(s: any) => { s.version = 24; }, (s: any) => { s.rulesVersion = 'chain-17'; }, (s: any) => { delete s.businessCapacityVersion; }, (s: any) => { s.businessCapacityVersion = 2; }, (s: any) => { s.version = education ? 22 : population ? 21 : roads ? 20 : 19; s.rulesVersion = `chain-${s.version - 5}`; delete s.businessCapacityVersion; }]) {
      const bad = JSON.parse(raw); edit(bad); assert.throws(() => deserialize(JSON.stringify(bad)));
    }
  }
  const old = JSON.parse(serialize(businessFixture())); old.businessCapacityVersion = 1; assert.throws(() => deserialize(JSON.stringify(old)));
});

test('v1, v5 and v22 remain loadable without modifying original bytes or promoting a small city', () => {
  const legacy5 = v5.createCity(); for (let day = 0; day < 12; day++) v5.step(legacy5);
  const originals = [readFileSync(new URL('./fixtures/legacy-v1-day65.json', import.meta.url), 'utf8'), v5.serialize(legacy5), historical(22)];
  for (const raw of originals) { const store = memory(raw), before = [...store.data], loaded = restoreStartupCity(store, createCity); assert.equal(loaded.error, null); assert.deepEqual([...store.data], before); assert.equal(loaded.city.businessCapacityVersion, undefined); reconcile(loaded.city); }
  const canonical=session(deserializeParkSession(originals[2]).city); assert.equal(session(deserializeParkSession(canonical).city),canonical); assert.equal(JSON.parse(originals[2]).version,22);
});

test('v23 local session/startup/recovery retain Guest identity, journal and exact original migration bytes', async () => {
  const old=historical(22), historicalNext=historical(23), journal=JSON.parse(old).market;
  const store=memory(old),guard=createSaveGuard(store);guard.acceptLoaded(old);
  // Exercise the actual dormant v22→v23 backup branch with exact original bytes.
  guard.write(historicalNext,null);
  assert.equal(decodeSaveCopy(store.getItem(BUSINESS_CAPACITY_BACKUP_KEY)!),old);assert.equal(readStoredCity(store,'backup')?.raw,old);assert.equal(readStoredCity(store,'checkpoint')?.raw,historicalNext);
  const startup=restoreStartupCity(store,createCity);assert.equal(startup.error,null);assert.deepEqual(startup.city.market,journal);assert.equal(startup.city.firms.length,65);
  let raw='';await saveLocalCitySession(startup.city,startup.runtime,undefined,value=>{raw=value;startup.guard.write(value,null);});
  assert.equal(JSON.parse(raw).version,25);assert.equal(serializeParkSession(deserializeParkSession(raw).city,deserializeParkSession(raw).runtime),raw);
  assert.throws(()=>startup.guard.write(old,null),/เวอร์ชันเก่า/);assert.equal(store.getItem(SAVE_KEY),raw);
  const before = [...store.data]; let loaded: City | undefined;
  await loadLocalCitySession(raw, undefined, startup.guard, restored => { loaded = restored.city; }); assert.deepEqual([...store.data], before); assert.deepEqual(loaded?.market, journal);
  startup.guard.write(raw, null); assert.equal(decodeSaveCopy(store.getItem(BUSINESS_CAPACITY_BACKUP_KEY)!), old);
});

test('migration planner full or quota-failed capacity backup cannot publish new primary/checkpoint/recovery pointer', () => {
  const old=historical(22),next=historical(23);
  for (const full of [false, true]) {
    const store = memory(old); store.setItem(LATEST_BACKUP_KEY, 'citymanager.backup.v1');
    if (full) businessCapacityBackupKeys().forEach((key, n) => store.setItem(key, `original ${n}`));
    const before = [...store.data], migrationStore = { ...store, setItem: (key:string, value:string) => { if (!full && key === BUSINESS_CAPACITY_BACKUP_KEY) throw Error('quota'); store.setItem(key, value); } };
    // Planner writes required migration backups before publication. The modern guard's
    // separate primary-first quota behavior is covered in save-quota-lossless.test.ts.
    assert.throws(() => saveStoredCity(migrationStore,next,null), full ? /backups full/ : /quota/); assert.deepEqual([...store.data], before); assert.equal(store.getItem(AUTOSAVE_CHECKPOINT_KEY), null);
  }
});

test('65 actual owners can retain one worker each without expanding any household workforce', () => {
  const c = businessFixture(65, 65);
  c.ledger = c.ledger.filter(e => e.reason !== 'Fixture historical business capital');
  for (const [index, f] of c.firms.entries()) {
    const h = c.households[index], b = c.buildings.find(b => b.id === f.building)!;
    c.accounts.outside += c.accounts[f.wallet]; c.accounts[f.wallet] = 50_000; c.accounts[h.wallet] -= 60_000; c.accounts.construction += 10_000;
    c.ledger.push({ tick: 0, from: h.wallet, to: f.wallet, amount: 60_000, reason: 'Owner capital contribution' }, { tick: 0, from: f.wallet, to: 'construction', amount: 10_000, reason: 'Self-employed market construction' });
    f.zone = 'C'; f.commercialKind = 'market'; delete f.recipe; b.zone = 'C'; c.cells[b.cell].zone = 'C';
    f.owner = { householdId: h.id, capitalContributed: 60_000, capitalReturned: 0, withdrawn: 0, taxPaid: 0 };
    c.ownerLabor.push({ householdId: h.id, firmId: f.id, skill: 'general', workers: 1 });
  }
  c.commercialUnifiedBaseline={moneyEntries:c.ledger.length,cropEntries:0,goodsEntries:0};
  assert.equal(c.ownerLabor.length, 65); reconcile(c); step(c); reconcile(c);
  const bad = JSON.parse(serialize(c)); bad.ownerLabor.push(bad.ownerLabor[0]); assert.throws(() => deserialize(JSON.stringify(bad)));
});

test('homes share the 192-building budget and closing a business never downgrades v23', () => {
  const c = businessFixture(187), parcel = vacantSite(c); assert.equal(c.buildings.length, 191); zoneCell(c, parcel, 'F');
  for (let n = 0; n < 3; n++) step(c); assert.equal(c.firms.length, 188); assert.equal(c.buildings.length, MAX_CITY_BUILDINGS); reconcile(c);
  const blocked = vacantSite(c); zoneCell(c, blocked, 'C'); assert.equal(shopSite(c), null); assert.equal(parcelChecklist(c, blocked)?.checks.find(check => check.key === 'building-limit')?.state, 'fail');
  const smaller = businessFixture(65), premise = smaller.buildings.find(b => b.id === smaller.firms[0].building)!;
  assert.equal(bulldoze(smaller, premise.cell).ok, true); assert.equal(smaller.firms.length, 64); assert.equal(smaller.businessCapacityVersion, 1); assert.equal(JSON.parse(serialize(smaller)).version, 25); assert.equal(baseVersion(serialize(smaller)), 23); reconcile(smaller);
});

test('v23 resumes exact key order with education before or after the unchanged market journal', () => {
  for (const educationFirst of [true, false]) {
    const c = businessFixture(65), j = marketJournalForTest(null); j.guestId = '00000000-0000-4000-8000-000000000003';
    const { education, ...rest } = c; const ordered = (educationFirst ? { ...rest, education, market: j } : { ...rest, market: j, education }) as City;
    const raw = session(ordered), loaded = deserializeParkSession(raw); assert.equal(serializeParkSession(loaded.city, loaded.runtime), raw);
  }
});
