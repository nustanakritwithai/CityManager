import test from 'node:test';
import assert from 'node:assert/strict';
import { createCity, step, serialize, deserialize, farmCrop, firmWage, wagesFor, WAGES, REAL_WAGES, MONTH, type City } from '../src/sim.ts';
import { REAL_CROPS, REAL_BAHT_PER_GAME_BAHT, farmInputs, millRunningCost, FARM_INPUTS_REASON, MILL_COSTS_REASON } from '../src/industry-scale.ts';
import { keepSupplied } from './plants.ts';
import { legacyIndustry } from './legacy-sizes.ts';

const RICE = REAL_CROPS.rice, real = (satang: number) => satang / 100 * REAL_BAHT_PER_GAME_BAHT;
const grown = (days: number, prepare: (c: City) => City = c => c) => { const c = prepare(createCity(61025)); for (let d = 0; d < days; d++) { step(c); keepSupplied(c); } return c; };

test('prices of milled rice and sugar are the real ones at the game scale', () => {
  // White rice 5%: about 12.5 baht a kilo wholesale, 11.6 for export (356 US$ a tonne); white sugar 21 at the mill gate.
  assert.equal(Math.round(real(RICE.prices.wholesale) * 10) / 10, 12.6);
  assert.equal(Math.round(real(RICE.prices.export) * 10) / 10, 11.7);
  assert.equal(Math.round(real(REAL_CROPS.sugarcane.prices.wholesale)), 21);
});

test('a farm pays for the seed, fertilizer, chemicals, fuel and machines of what it harvests', { timeout: 300_000 }, () => {
  // 1,500 baht a rai a crop over 413 kg a rai: about 3.63 baht a kilo of paddy, 1.96 a 10 kg lot here.
  assert.equal(farmInputs(RICE, 1, 1), 196);
  assert.equal(farmInputs(RICE, 6, 100), Math.round(100 * 10 * 1500 * 100 / (700 * 18.5)), 'higher yields spread the same inputs a rai over more kilos');
  const c = grown(60), farm = c.firms.find(f => f.zone === 'F')!, level = c.buildings.find(b => b.id === farm.building)!.level;
  for (let tick = c.tick - 20; tick <= c.tick; tick++) {
    const harvested = c.cropLedger.filter(e => e.tick === tick && e.kind === 'harvest' && e.to === farm.wallet).reduce((n, e) => n + e.quantity, 0);
    const paid = c.ledger.filter(e => e.tick === tick && e.reason === FARM_INPUTS_REASON && e.from === farm.wallet);
    if (!harvested) { assert.equal(paid.length, 0); continue; }
    assert.equal(paid.length, 1); assert.equal(paid[0].to, 'outside');
    assert.equal(paid[0].amount, farmInputs(REAL_CROPS[farmCrop(c, farm)], level, harvested));
  }
  assert.deepEqual(deserialize(serialize(c)), c);
});

test('a mill pays to run for what it makes, and buys from outside the crop the town cannot sell it', { timeout: 300_000 }, () => {
  const c = grown(60), mill = c.firms.find(f => f.zone === 'I')!, spec = REAL_CROPS.rice;
  const made = c.cropLedger.filter(e => e.kind === 'process' && e.from === mill.wallet && e.tick > c.tick - 20);
  assert.ok(made.length > 0);
  for (const e of made) {
    const paid = c.ledger.filter(m => m.tick === e.tick && m.reason === MILL_COSTS_REASON && m.from === mill.wallet);
    assert.equal(paid.length, 1); assert.equal(paid[0].amount, millRunningCost(spec, e.outputQuantity));
  }
  const imports = c.cropLedger.filter(e => e.kind === 'import');
  assert.ok(imports.length > 0, 'the mill buys paddy from outside');
  // Older entries are folded into the save's history (city-history.ts), which keeps their total.
  assert.equal(c.crops.imported, imports.reduce((n, e) => n + e.quantity, 0) + (c.history?.cropTotals.imported ?? 0));
  const raw = serialize(c), forged = (mutate: (x: any) => void) => { const x = JSON.parse(raw); mutate(x); return JSON.stringify(x); };
  const last = (x: any) => x.cropLedger.findLast((e: any) => e.kind === 'import');
  assert.throws(() => deserialize(forged(x => { last(x).cash -= 350; last(x).toValue -= 350; })), 'an import below the farm price');
  assert.throws(() => deserialize(forged(x => { x.crops.imported += 1; })), 'an import count that no journal entry supports');
});

test('firms pay the real average wage of their industry; a city saved before keeps the old wages', { timeout: 300_000 }, () => {
  // 2024 averages (Bank of Thailand EC_RL_014_S2, from the NSO Labour Force Survey) at 18.5 real baht to one.
  for (const [zone, actual] of [['F', 7_919.54], ['I', 14_418.89], ['C', 13_761.40]] as const) {
    assert.ok(Math.abs(real(REAL_WAGES[zone]) - actual) < 20, `${zone}: ${real(REAL_WAGES[zone])} against ${actual}`);
    assert.equal(REAL_WAGES[zone] % MONTH, 0, 'a whole satang a day');
  }
  const c = grown(31);
  assert.equal(c.wageScale, 1); assert.deepEqual(wagesFor(c), REAL_WAGES);
  const paid = c.ledger.filter(e => e.reason === 'Monthly wages');
  assert.ok(paid.length > 0);
  for (const e of paid) {
    const f = c.firms.find(f => f.wallet === e.from); if (!f) continue;
    assert.equal(e.amount % (firmWage(f, c) / MONTH), 0, 'whole days at the real rate');
  }
  const old = grown(31, legacyIndustry);
  assert.deepEqual(wagesFor(old), WAGES);
  for (const e of old.ledger.filter(e => e.reason === 'Monthly wages')) { const f = old.firms.find(f => f.wallet === e.from); if (f) assert.equal(e.amount % (WAGES[f.zone] / MONTH), 0); }
  assert.deepEqual(deserialize(serialize(c)), c);
  const bad = JSON.parse(serialize(c)); bad.wageScale = 2;
  assert.throws(() => deserialize(JSON.stringify(bad)));
});
