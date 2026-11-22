import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCity, step, summary, serialize, deserialize, productionUpgradeStatus, realCropShortage, farmCrop, REAL_FARM_GROWTH_FUNDS, MONTH, type City, type Firm } from '../src/sim.ts';
import { REAL_CROPS, farmInputs, farmMaxLevel, realLotsPerYear } from '../src/industry-scale.ts';
import { keepSupplied } from './plants.ts';
import { legacyIndustry } from './legacy-sizes.ts';

const give = (c: City, wallet: string, amount: number) => { c.accounts.outside = (c.accounts.outside ?? 0) - amount; c.accounts[wallet] = (c.accounts[wallet] ?? 0) + amount; };
const run = (c: City, days: number) => { for (let d = 0; d < days; d++) { step(c); keepSupplied(c); } };
const farmOf = (c: City) => { const f = c.firms.find(f => f.zone === 'F')!; return { f, b: c.buildings.find(b => b.id === f.building)! }; };
/** Every worker in town holds a school diploma (and a university degree when `higher`), and the farm has had them for the
 * 30 days the education gate asks for. */
function diploma(c: City, f: Firm, higher: boolean) {
  const state = c.education!, b = c.buildings.find(b => b.id === f.building)!;
  state.people = c.households.map(h => ({ householdId: h.id, basic: h.workforce, higher: higher ? h.workforce : 0, school: 0, university: 0, teacher: 0, professor: 0, campusId: null, progress: 0 }));
  state.residentBasic = c.households.reduce((n, h) => n + h.workforce, 0); state.residentHigher = higher ? state.residentBasic : 0;
  state.sustain = [...state.sustain.filter(s => s.buildingId !== b.id), { buildingId: b.id, days: 30 }];
}
/** Step to the day before the month's review. */
const toEve = (c: City) => { while ((c.tick + 1) % MONTH !== 0) { step(c); keepSupplied(c); } };

test('nine farm levels: more crops a year to 3, better yields to 6, high-tech farms to 9', () => {
  for (const spec of Object.values(REAL_CROPS)) {
    for (const key of ['kgPerRai', 'cropsPerYear', 'hands'] as const) assert.equal(spec[key].length, 9);
    for (let level = 2; level <= 9; level++) assert.ok(realLotsPerYear(spec, level) > realLotsPerYear(spec, level - 1), 'each level grows more');
    // A high-tech farm spends on climate, nutrients and energy in step with its yield: a kilo costs what it does at level 6.
    for (const level of [7, 8, 9]) assert.equal(farmInputs(spec, level, 1000), farmInputs(spec, 6, 1000));
  }
  assert.deepEqual(REAL_CROPS.rice.kgPerRai.slice(6), [800, 900, 1000]);
  assert.deepEqual(REAL_CROPS.sugarcane.kgPerRai.slice(6), [18_000, 20_000, 25_000]);
  // A vertical farm grows 60 kg of greens a m² a year (1 rai is 1,600 m²), the average of commercial vertical farms.
  const veg = REAL_CROPS.vegetables; assert.equal(veg.kgPerRai[8] * veg.cropsPerYear[8] / 1600, 60);
  assert.equal(farmMaxLevel(createCity(61025)), 9);
  assert.equal(farmMaxLevel(legacyIndustry(createCity(61025))), 6, 'a city saved before keeps six levels');
});

test('a farm grows a level a month while the mill wants more of its crop, to level 3 with no diploma', { timeout: 300_000 }, () => {
  const c = createCity(61025); run(c, 29);
  const { f, b } = farmOf(c), levels: number[] = [];
  assert.ok(realCropShortage(c)[farmCrop(c, f)] > 0, 'the mill wants more paddy than the farm grows');
  for (let month = 0; month < 4; month++) {
    const before = b.level; do { step(c); keepSupplied(c); } while (c.tick % MONTH !== 0); levels.push(b.level);
    if (b.level > before) assert.ok(c.ledger.some(e => e.tick === c.tick && e.from === f.wallet && e.reason === 'Profitable firm height investment'), 'the farm paid to grow');
  }
  assert.deepEqual(levels.slice(1), [2, 3, 3], 'two harvests a year, then three, then it waits for a diploma');
  assert.ok(productionUpgradeStatus(c, f).reasons.some(r => r.includes('แรงงานฟาร์มที่ถือวุฒิพื้นฐาน')), 'level 4 needs a farm worker with a school diploma');
  assert.deepEqual(deserialize(serialize(c)), c, 'saves accept the grown farm');
});

test('a school diploma and money to invest take a farm to level 4, and only a university degree to the high-tech level 7', { timeout: 300_000 }, () => {
  const c = createCity(61025); run(c, 95);
  const { f, b } = farmOf(c);
  assert.equal(b.level, 3);
  give(c, f.wallet, 1_000_000);
  toEve(c); diploma(c, f, false); step(c); keepSupplied(c);
  assert.equal(b.level, 4, 'a worker with a school diploma lets the farm improve its yields');
  // At level 6 the next step is a high-tech farm: a school diploma is not enough.
  b.level = 6;
  toEve(c); diploma(c, f, false);
  assert.ok(productionUpgradeStatus(c, f).reasons.some(r => r.includes('แรงงานฟาร์มที่ถือวุฒิขั้นสูง')), 'level 7 needs a farm worker with a university degree');
  step(c); keepSupplied(c);
  assert.equal(b.level, 6);
  toEve(c); diploma(c, f, true); step(c); keepSupplied(c);
  assert.equal(b.level, 7, 'a graduate takes the farm high-tech');
  assert.ok(REAL_FARM_GROWTH_FUNDS.highTech > REAL_FARM_GROWTH_FUNDS.improved && REAL_FARM_GROWTH_FUNDS.improved > REAL_FARM_GROWTH_FUNDS.field);
});

test('new farmland waits while a farm growing that crop can still grow a level', { timeout: 300_000 }, () => {
  const c = createCity(61025); run(c, 50);
  const { f, b } = farmOf(c);
  assert.ok(realCropShortage(c)[farmCrop(c, f)] > 0);
  // The farm can grow at the coming review, so no new farm is wanted.
  assert.deepEqual(productionUpgradeStatus(c, f).reasons, []);
  assert.equal(summary(c).demand.F, 0);
  // A farm that cannot grow (here: no money) leaves the shortage to new farmland.
  c.accounts.outside += c.accounts[f.wallet]; c.accounts[f.wallet] = 0;
  assert.ok(productionUpgradeStatus(c, f).reasons.length > 0);
  assert.equal(summary(c).demand.F, 1);
  assert.ok(b.level <= 2);
});

test('a city saved before keeps six farm levels and the old growth rule', { timeout: 300_000 }, () => {
  const c = legacyIndustry(createCity(61025)); run(c, 60);
  const { f, b } = farmOf(c);
  assert.equal(productionUpgradeStatus(c, f).maximum, 6);
  const raw = JSON.parse(serialize(c)); raw.buildings.find((x: { id: number }) => x.id === b.id).level = 7;
  assert.throws(() => deserialize(JSON.stringify(raw)), 'a level-7 farm in a city saved before');
});
