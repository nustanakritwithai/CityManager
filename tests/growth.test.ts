import test from 'node:test';
import assert from 'node:assert/strict';
import { createCity, step, summary, serialize, deserialize, industryGrowthStatus, firmWorkerCount, firmWage, bulldoze, zoneCell, access, type City } from '../src/sim.ts';
import { createCity as legacyCity, step as legacyStep, serialize as legacySerialize } from '../src/legacy-v5.ts';
import { createCity as agricultureCity, step as agricultureStep, serialize as agricultureSerialize } from '../src/legacy-v4.ts';
import { untyped } from './untyped.ts';
import { SAVE_KEY, COMMERCIAL_SAVE_KEY, COMMERCIAL_BACKUP_KEY, readStoredCity, saveStoredCity } from '../src/save-storage.ts';
import { keepSupplied } from './plants.ts';

function oldCity(day: number) { const c = legacyCity(61025); for (let n = 0; n < day; n++) legacyStep(c); return c; }
const legacy388 = oldCity(388), legacy251 = oldCity(251);
const oldRaw = legacySerialize(legacy388);
const clone = (c: City) => deserialize(serialize(c));
const current = (day = 388) => deserialize(legacySerialize(day === 388 ? legacy388 : day === 251 ? legacy251 : oldCity(day)));
function sameOldState(c: City, raw: string) { const projected = untyped(serialize(c)); delete projected.growthStartTick; projected.version = 5; projected.rulesVersion = 'commercial-1'; assert.deepEqual(projected, JSON.parse(raw)); }
function conservation(c: City) {
  assert.equal(Object.values(c.accounts).reduce((n, v) => n + v, 0), 0);
  assert.equal(c.goods.produced + c.goods.imported - c.goods.consumed - c.goods.exported, c.firms.reduce((n, f) => n + f.inventory, 0));
  assert.equal(c.crops.harvested - c.crops.processed - c.crops.consumed - c.crops.writtenOff - (c.crops.exported ?? 0), c.firms.reduce((n, f) => n + f.cropInventory, 0));
  assert.deepEqual(clone(c), c);
}

// Higher factory tiers can attract an outside investor before a local firm has
// saved enough. Provide another connected parcel only once the local sponsor
// has its real capital and all funded vacancies are filled. This keeps both
// investment paths active and makes the land assumption explicit.
function zoneFundedParcel(c: City, sponsorId?: number): number | null {
  const status = industryGrowthStatus(c);
  if (status.code !== 'growth.no-industrial-parcel' || status.availableCapital < 300_000 || status.fundedVacancies !== 0 || (sponsorId !== undefined && status.sponsorFirmId !== sponsorId)) return null;
  const i = c.cells.findIndex((cell, index) => cell.zone === null && !cell.road && cell.building === null && access(c, index) && zoneCell(c, index, 'I').ok);
  assert.ok(i >= 0, 'An additional connected industrial parcel is available');
  return i;
}

test('genuine v5 day388 plateau migrates without changing state, then existing capital creates paid jobs and real arrivals', () => {
  const c = current(); sameOldState(c, oldRaw); assert.equal(c.growthStartTick, 388);
  assert.deepEqual([summary(c).population, summary(c).jobs, summary(c).employed, summary(c).homeSlots], [10, 8, 8, 12]);
  assert.equal(industryGrowthStatus(c).ready, true);
  for (let n = 0; n < 15; n++) { step(c); conservation(c); }
  assert.ok(summary(c).population > 10); assert.ok(summary(c).jobs > 8);
  const child = c.firms.find(f => f.fundedBy)!; assert.ok(child); assert.ok(firmWorkerCount(c, child.id) > 0);
  const capital = c.ledger.filter(e => e.reason === `Industry expansion capital #${child.id}`);
  assert.equal(capital.length, 1); assert.equal(capital[0].from, `firm:${child.fundedBy!.firmId}`); assert.equal(capital[0].amount, 300_000);
  assert.equal(c.ledger.some(e => e.from === 'outside' && e.to === child.wallet && e.tick === capital[0].tick), false);
});

test('midmonth expansion preserves all earned wages, tax/rent/working reserves and operating results against old counterfactual', () => {
  const c = current(251), old = oldCity(251); assert.equal(industryGrowthStatus(c).ready, true);
  step(c); legacyStep(old);
  const child = c.firms.find(f => f.fundedBy)!; assert.ok(child); assert.equal(c.tick, 252);
  const sponsor = c.firms.find(f => f.id === child.fundedBy!.firmId)!, prior = old.firms.find(f => f.id === sponsor.id)!;
  assert.equal(c.accounts[sponsor.wallet], old.accounts[prior.wallet] - 300_000);
  // Farms now sell surplus crops to outside; that is the only outside flow the old rules lack.
  const cropExports = c.ledger.filter(e => e.tick === c.tick && /^Crop export #/.test(e.reason)).reduce((n, e) => n + e.amount, 0);
  assert.equal(c.accounts[child.wallet], 260_000); assert.equal(c.accounts.construction, old.accounts.construction + 40_000); assert.equal(c.accounts.outside + cropExports, old.accounts.outside);
  for (const key of ['workDays', 'profit', 'lastMonthProfit', 'monthlyRevenue', 'monthlyExpense'] as const) assert.deepEqual(sponsor[key], prior[key]);
  const earned = Object.values(sponsor.workDays).reduce((n, days) => n + days * firmWage(sponsor) / 30, 0);
  const tax = Math.floor(Math.max(0, sponsor.monthlyRevenue - sponsor.monthlyExpense - earned) / 5);
  assert.ok(c.accounts[sponsor.wallet] >= earned + tax + 10_000 + 20_000); conservation(c);
});

test('fresh deterministic cities use real outside and local capital with adequate industrial land', () => {
  for (const seed of [61025, 20261023]) {
    const c = createCity(seed), twin = createCity(seed); let firstExpansion = 0, addedParcel: number | null = null;
    for (let day = 1; day <= 388; day++) {
      step(c); step(twin); keepSupplied(c); keepSupplied(twin);
      if (addedParcel === null) { addedParcel = zoneFundedParcel(c); assert.equal(zoneFundedParcel(twin), addedParcel); }
      if (!firstExpansion && c.firms.some(f => f.fundedBy)) firstExpansion = day;
      if (day % 30 === 0) conservation(c);
    }
    // The new factory tiers bring the existing outside-investor trigger forward.
    // An outside-funded factory can occupy the original last industrial parcel;
    // the controlled extra parcel allows a genuinely funded local expansion too.
    const outside = c.ledger.find(e => /^Outside industry equity #/.test(e.reason));
    assert.ok(outside); assert.equal(outside.from, 'outside'); assert.equal(outside.amount, 300_000); assert.notEqual(addedParcel, null);
    assert.ok(firstExpansion > 120 && firstExpansion < 390, String(firstExpansion)); assert.ok(summary(c).population > 10); assert.ok(summary(c).jobs > 8); assert.deepEqual(c, twin);
    for (const f of c.firms.filter(f => f.fundedBy)) { const capital = c.ledger.find(e => e.reason === `Industry expansion capital #${f.id}`)!; assert.equal(c.ledger.some(e => e.to === f.wallet && e.from === 'outside' && e.tick === capital.tick), false); }
    for (const h of c.households.filter(h => h.origin === 'arrival')) assert.equal(c.ledger.filter(e => e.to === h.wallet && e.reason === 'New household arrival savings').length, 1);
    conservation(c);
  }
});

test('real cash, housing, road, utility and crop shortages remain blockers rather than triggering grants', () => {
  const saving = current(180); assert.equal(industryGrowthStatus(saving).code, 'growth.saving-capital');
  const housing = current(30); for (const [i, p] of housing.cells.entries()) if (p.zone === 'R' && p.building === null) assert.equal(zoneCell(housing, i, null).ok, true);
  assert.equal(industryGrowthStatus(housing).code, 'growth.housing-unavailable'); conservation(housing);
  const road = current(); for (const [i, p] of road.cells.entries()) if (p.zone === 'I' && p.building === null) assert.equal(zoneCell(road, i, null).ok, true);
  assert.equal(industryGrowthStatus(road).code, 'growth.no-industrial-parcel');
  const utilities = current(); utilities.utilities.outside.water = 0; assert.equal(industryGrowthStatus(utilities).code, 'growth.utilities-unavailable');
  const crop = current(); for (const f of [...crop.firms].filter(f => f.zone === 'F' || f.commercialKind === 'market')) assert.equal(bulldoze(crop, crop.buildings.find(b => b.id === f.building)!.cell).ok, true);
  assert.equal(industryGrowthStatus(crop).ready, false); assert.ok(['growth.no-crop-buffer', 'growth.vacancies-remain'].includes(industryGrowthStatus(crop).code));
  const before = crop.firms.length; for (let n = 0; n < 9; n++) step(crop); assert.equal(crop.firms.some(f => f.fundedBy), false); assert.ok(crop.firms.length >= before); conservation(crop);
});

test('funded factory closes only after claims and returns residual cash to its sponsor without operating income duplication', () => {
  const c = current(251); step(c); const child = c.firms.find(f => f.fundedBy)!, parent = c.firms.find(f => f.id === child.fundedBy!.firmId)!;
  const parentCash = c.accounts[parent.wallet], parentRevenue = parent.monthlyRevenue, childCash = c.accounts[child.wallet];
  assert.equal(bulldoze(c, c.buildings.find(b => b.id === child.building)!.cell).ok, true);
  assert.equal(c.accounts[child.wallet], 0); assert.equal(c.accounts[parent.wallet], parentCash + childCash); assert.equal(parent.monthlyRevenue, parentRevenue);
  assert.equal(c.ledger.filter(e => e.reason === `Industry expansion residual return #${child.id}`).length, 1); conservation(c);
  const estate = current(251); step(estate); const offspring = estate.firms.find(f => f.fundedBy)!, source = estate.firms.find(f => f.id === offspring.fundedBy!.firmId)!;
  assert.equal(bulldoze(estate, estate.buildings.find(b => b.id === source.building)!.cell).ok, true); const sourceCash = estate.accounts[source.wallet], residue = estate.accounts[offspring.wallet];
  assert.equal(bulldoze(estate, estate.buildings.find(b => b.id === offspring.building)!.cell).ok, true); assert.equal(estate.accounts[source.wallet], sourceCash + residue); conservation(estate);
});

test('a locally funded factory cannot create a new parcel or free capital after outside investment takes the last site', () => {
  const city = current(251); step(city);
  const funded = city.firms.find(f => f.fundedBy)!, parent = city.firms.find(f => f.id === funded.fundedBy!.firmId)!;
  const site = city.buildings.find(b => b.id === parent.building)!.cell;
  assert.equal(bulldoze(city, site).ok, true); assert.equal(zoneCell(city, site, 'I').ok, true);
  const zones = city.cells.map(cell => cell.zone);
  for (let n = 0; n < 500; n++) { step(city); keepSupplied(city); }
  const status = industryGrowthStatus(city);
  assert.equal(status.code, 'growth.no-industrial-parcel'); assert.equal(status.sponsorFirmId, funded.id); assert.ok(status.availableCapital >= 300_000);
  assert.deepEqual(city.cells.map(cell => cell.zone), zones, 'no industrial zoning is invented');
  assert.ok(city.ledger.some(e => /^Outside industry equity #/.test(e.reason) && e.from === 'outside' && e.amount === 300_000));
  assert.equal(city.firms.some(f => f.fundedBy?.firmId === funded.id), false);
  const capital = city.ledger.filter(e => e.reason === `Industry expansion capital #${funded.id}`);
  assert.equal(capital.length, 1); assert.equal(capital[0].from, parent.wallet); assert.equal(capital[0].amount, 300_000);
  conservation(city);
});

test('two-generation funded sponsors retain later estate receipts in either same-tick closure order', () => {
  const c = current(251); step(c); const b = c.firms.find(f => f.fundedBy)!, a = c.firms.find(f => f.id === b.fundedBy!.firmId)!, oldSite = c.buildings.find(home => home.id === a.building)!.cell;
  assert.equal(bulldoze(c, oldSite).ok, true); assert.equal(zoneCell(c, oldSite, 'I').ok, true);
  let child = c.firms.find(f => f.fundedBy?.firmId === b.id), addedParcel: number | null = null;
  for (let n = 0; n < 1500 && !child; n++) {
    step(c); keepSupplied(c);
    if (addedParcel === null) addedParcel = zoneFundedParcel(c, b.id);
    child = c.firms.find(f => f.fundedBy?.firmId === b.id);
  }
  assert.ok(c.ledger.some(e => /^Outside industry equity #/.test(e.reason) && e.from === 'outside' && e.amount === 300_000));
  assert.notEqual(addedParcel, null);
  assert.ok(child, 'Actual profitable funded B can later sponsor C from accumulated operating cash'); conservation(c);
  const funding = c.ledger.filter(e => e.reason === `Industry expansion capital #${child.id}`);
  assert.equal(funding.length, 1); assert.equal(funding[0].from, b.wallet); assert.equal(funding[0].amount, 300_000);
  assert.equal(c.ledger.some(e => e.to === child!.wallet && e.from === 'outside' && e.tick === funding[0].tick), false);
  for (const parentFirst of [true, false]) {
    const state = clone(c), parent = state.firms.find(f => f.id === b.id)!, offspring = state.firms.find(f => f.id === child!.id)!;
    const closing = parentFirst ? [parent, offspring] : [offspring, parent];
    for (const f of closing) { assert.equal(bulldoze(state, state.buildings.find(home => home.id === f.building)!.cell).ok, true); conservation(state); }
    if (parentFirst) assert.ok(state.accounts[parent.wallet] > 0, 'Later residual belongs to the retained closed sponsor wallet');
    else assert.equal(state.accounts[parent.wallet], 0, 'Earlier child receipt was included in its live sponsor settlement');
  }
});

test('funding metadata cannot be forged, omitted, assigned to a market or injected into legacy v5', () => {
  const c = current(251); step(c); const child = c.firms.find(f => f.fundedBy)!;
  for (const change of [(f: typeof child) => { delete f.fundedBy; }, (f: typeof child) => { f.fundedBy!.firmId = f.id; }, (f: typeof child) => { f.fundedBy!.capital--; }]) {
    const bad = JSON.parse(serialize(c)); change(bad.firms.find((f: typeof child) => f.id === child.id)); assert.throws(() => deserialize(JSON.stringify(bad)));
  }
  const legacy = JSON.parse(oldRaw); legacy.firms[0].fundedBy = { firmId: 1, capital: 300_000 }; assert.throws(() => deserialize(JSON.stringify(legacy)), /Legacy saves/);
  const fake = JSON.parse(serialize(c)); fake.firms.find((f: typeof child) => f.commercialKind === 'market').fundedBy = child.fundedBy; assert.throws(() => deserialize(JSON.stringify(fake)));
});

test('v5 bytes remain immutable through v6 repeated loading/saving and quota failure; v4 still migrates', () => {
  const map = new Map<string, string>([[COMMERCIAL_SAVE_KEY, oldRaw]]); const store = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); } };
  const item = readStoredCity(store)!; assert.equal(item.key, COMMERCIAL_SAVE_KEY); assert.equal(map.size, 1);
  const migrated = deserialize(item.raw); saveStoredCity(store, serialize(migrated), item.raw); assert.equal(map.get(COMMERCIAL_SAVE_KEY), oldRaw); assert.equal(map.get(COMMERCIAL_BACKUP_KEY), oldRaw);
  const count = map.size; saveStoredCity(store, serialize(deserialize(readStoredCity(store)!.raw)), oldRaw); assert.equal(map.size, count); assert.equal(map.get(COMMERCIAL_BACKUP_KEY), oldRaw);
  const saved = map.get(SAVE_KEY); assert.throws(() => saveStoredCity({ ...store, setItem: (k: string, v: string) => { if (k === SAVE_KEY) throw Error('quota'); store.setItem(k, v); } }, serialize(migrated), oldRaw)); assert.equal(map.get(SAVE_KEY), saved);
  const v4 = agricultureCity(61025); for (let n = 0; n < 90; n++) agricultureStep(v4); const loaded = deserialize(agricultureSerialize(v4)); assert.equal(loaded.version, 9); assert.equal(loaded.tick, 90); assert.deepEqual(loaded.accounts, v4.accounts); conservation(loaded);
});
