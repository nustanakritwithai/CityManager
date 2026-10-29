import test from 'node:test';
import assert from 'node:assert/strict';
import { GATEWAY, access, automaticFarmCrop, buildRoad, chooseRecipe, createCity, deserialize, farmCrop, selectFarmCrop, serialize, step, summary, zoneCell, type City } from '../src/sim.ts';
import { CROPS, CROP_BANDS, PRODUCTS, RECIPE, RECIPES, cropForFertility, freshPreference, mixTotal, productPreference, takeLargest } from '../src/goods.ts';
import { createCity as v6City, serialize as v6Serialize, step as v6Step } from '../src/legacy-v6.ts';
import { untyped } from './untyped.ts';
import { keepSupplied } from './plants.ts';

/** An empty-start city with two farms on each fertility band, homes, shops, and factory plots added on day 400. */
function threeCropCity(observe?: (city: City) => void): City {
  const c = createCity(61025, { starter: false });
  buildRoad(c, GATEWAY, GATEWAY + 20); buildRoad(c, 12 * 24 + 10, 4 * 24 + 10); buildRoad(c, 12 * 24 + 16, 20 * 24 + 16);
  const frontage = c.cells.map((cell, i) => !cell.road && !cell.zone && access(c, i) ? i : -1).filter(i => i >= 0), used = new Set<number>();
  const take = (list: number[], n: number) => list.filter(i => !used.has(i)).slice(0, n).map(i => (used.add(i), i));
  for (const crop of CROPS) for (const i of take(frontage.filter(i => cropForFertility(c.resources.fertility[i]) === crop), 2)) zoneCell(c, i, 'F');
  for (const i of take(frontage, 10)) zoneCell(c, i, 'R');
  for (const i of take(frontage, 4)) zoneCell(c, i, 'I');
  for (const i of take(frontage, 3)) zoneCell(c, i, 'C');
  for (let d = 1; d <= 600; d++) {
    step(c);
    for (const farm of c.firms.filter(f => f.zone === 'F')) { const parcel = c.buildings.find(b => b.id === farm.building)!; selectFarmCrop(c, farm.id, cropForFertility(c.resources.fertility[parcel.cell])!); }
    keepSupplied(c);
    observe?.(c);
    if (d === 400) for (const i of take(frontage.filter(i => !c.cells[i].zone), 2)) zoneCell(c, i, 'I');
  }
  return c;
}

test('expanded farms expose a missing crop only for real reachable buyers without altering manual choices', { timeout: 240_000 }, () => {
  let checked = false;
  threeCropCity(city => {
    if (checked) return;
    const farms = city.firms.filter(f => f.zone === 'F');
    if (!farms.some(f => city.buildings.find(b => b.id === f.building)!.level > 3)) return;
    const missing = CROPS.filter(crop => !farms.some(f => farmCrop(city, f) === crop));
    if (!missing.length || summary(city).demand.F !== 1) return;
    const noBuyerCash = structuredClone(city);
    for (const household of noBuyerCash.households) noBuyerCash.accounts[household.wallet] = 0;
    if (summary(noBuyerCash).demand.F !== 0) return; // Aggregate capacity still has its own demand.
    const before = serialize(city);
    assert.ok(missing.includes(automaticFarmCrop(city)), 'a new automatic farm chooses a missing crop');
    assert.ok(farms.every(f => f.cropMode === 'manual'), 'existing manual crop choices remain manual');
    assert.equal(serialize(city), before, 'the demand check has no side effects');
    checked = true;
  });
  assert.ok(checked, 'observed missing-crop demand distinct from aggregate crop capacity');
});

test('the catalog: three farm-to-table lines, crops by fertility band, daily rotating baskets', () => {
  assert.deepEqual(RECIPES.map(r => [RECIPE[r].crop, RECIPE[r].product]), [['rice', 'milled-rice'], ['vegetables', 'canned-food'], ['sugarcane', 'sugar']]);
  assert.equal(cropForFertility(49), null); assert.equal(cropForFertility(50), 'sugarcane'); assert.equal(cropForFertility(67), 'vegetables'); assert.equal(cropForFertility(100), 'rice');
  for (let f = 50; f <= 100; f++) assert.equal(CROPS.filter(k => f >= CROP_BANDS[k][0] && f <= CROP_BANDS[k][1]).length, 1, `${f}% belongs to one band`);
  const firsts = new Set([0, 1, 2].map(t => productPreference(7, t)[0])); assert.equal(firsts.size, 3, 'a household rotates its first choice');
  assert.equal(new Set(productPreference(3, 9)).size, PRODUCTS.length);
  assert.equal(freshPreference(1, 1).at(-1), 'sugarcane', 'sugarcane is a last resort at a market');
  assert.deepEqual(takeLargest({ a: 5, b: 3 } as Record<'a' | 'b', number>, ['a', 'b'], 6), { a: 5, b: 1 }, 'largest stock first');
});

test('a city farming all three bands runs all three recipes and households buy a mix', { timeout: 240_000 }, () => {
  const c = threeCropCity();
  const recipes = new Set(c.firms.filter(f => f.zone === 'I').map(f => f.recipe));
  assert.deepEqual([...recipes].sort(), [...RECIPES].sort(), 'rice mill, cannery and sugar mill');
  for (const f of c.firms) {
    if (f.zone === 'F') assert.ok(CROPS.every(k => k === farmCrop(c, f) || f.crops[k] === 0), 'a farm holds only its crop');
    if (f.zone === 'I') assert.ok(PRODUCTS.every(p => p === RECIPE[f.recipe!].product || f.products[p] === 0), 'a factory makes only its product');
    assert.equal(mixTotal(f.crops), f.cropInventory); assert.equal(mixTotal(f.products), f.inventory);
  }
  const bought = new Map<string, number>();
  for (const e of c.goodsLedger) if (e.tick > c.tick - 60 && e.reason === 'Household final consumption') bought.set(e.product!, (bought.get(e.product!) ?? 0) + 1);
  assert.deepEqual([...bought.keys()].sort(), [...PRODUCTS].sort(), 'households bought every product');
  const counts = [...bought.values()]; assert.ok(Math.min(...counts) > Math.max(...counts) / 3, `a real mix, not one product: ${JSON.stringify(Object.fromEntries(bought))}`);
  // Late in the run factories take the market's stock, so look at the whole run for fresh sales.
  const fresh = new Set(c.cropLedger.filter(e => e.kind === 'consumption').map(e => e.crop));
  assert.ok(fresh.has('rice') && fresh.has('vegetables'), 'markets sell more than one fresh crop');
  assert.deepEqual(deserialize(serialize(c)), c);
});

test('typed saves reject goods that do not add up', { timeout: 240_000 }, () => {
  const c = createCity(61025); for (let d = 0; d < 200; d++) step(c);
  const raw = JSON.parse(serialize(c));
  const farm = raw.firms.findIndex((f: any) => f.zone === 'F' && f.cropInventory > 0), factory = raw.firms.findIndex((f: any) => f.zone === 'I');
  const harvest = raw.cropLedger.findIndex((e: any) => e.kind === 'harvest'), sale = raw.goodsLedger.findIndex((e: any) => e.reason === 'Household final consumption');
  assert.ok(farm >= 0 && factory >= 0 && harvest >= 0 && sale >= 0);
  for (const mutate of [
    (x: any) => { const f = x.firms[farm], own = CROPS.find(k => f.crops[k] > 0)!, other = CROPS.find(k => k !== own)!; f.crops[own]--; f.crops[other]++; },
    (x: any) => { x.firms[factory].recipe = RECIPES.find(r => r !== x.firms[factory].recipe); },
    (x: any) => { x.cropLedger[harvest].crop = CROPS.find(k => k !== x.cropLedger[harvest].crop); },
    (x: any) => { x.goodsLedger[sale].product = PRODUCTS.find(p => p !== x.goodsLedger[sale].product); },
    (x: any) => { delete x.goodsLedger[sale].product; },
    (x: any) => { x.typeBaseline.cropEntries = x.cropLedger.length + 1; },
    (x: any) => { delete x.typeBaseline; },
  ]) { const bad = structuredClone(raw); mutate(bad); assert.throws(() => deserialize(JSON.stringify(bad)), /corrupt/); }
});

test('1.x saves load typed: v6 and chain-2 v7 cities keep every fact and keep running', { timeout: 240_000 }, () => {
  const old = v6City(61025); for (let d = 0; d < 200; d++) v6Step(old);
  const fromV6 = deserialize(v6Serialize(old));
  assert.equal(fromV6.version, 9); assert.equal(fromV6.typeBaseline.tick, 200); assert.equal(fromV6.typeBaseline.cropEntries, fromV6.cropLedger.length);
  for (const f of fromV6.firms) { assert.equal(mixTotal(f.crops), f.cropInventory); assert.equal(mixTotal(f.products), f.inventory); }
  // A 1.3 city saved as chain-2 v7: the same facts without typing.
  const current = fromV6; // This v7 fixture must contain only transactions valid under v7.
  const chain2 = JSON.stringify(untyped(serialize(current))), loaded = deserialize(chain2);
  assert.equal(loaded.version, 9); assert.deepEqual(untyped(serialize(loaded)), JSON.parse(chain2), 'typing is the only change a load makes');
  for (const f of loaded.firms.filter(f => f.zone === 'I')) assert.ok(RECIPES.includes(f.recipe!));
  for (const city of [fromV6, loaded]) { for (let d = 0; d < 90; d++) step(city); assert.deepEqual(deserialize(serialize(city)), city); }
  assert.equal(chooseRecipe(createCity(1, { starter: false })), 'rice-mill', 'an empty map starts with a rice mill');
});
