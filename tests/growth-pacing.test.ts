import test from 'node:test';
import assert from 'node:assert/strict';
import { MONTH, OUTSIDE_INDUSTRY_CROPS, OUTSIDE_INDUSTRY_POPULATION, SIZE, buildRoad, createCity, deserialize, industryGrowthStatus, serialize, step, summary, zoneCell, type City } from '../src/sim.ts';
import { CROP_EXPORT, CROP_STOCK_CAPS } from '../src/agriculture.ts';

/** The sample city on day 200, plus a big new block the player zones in one go. */
function zonedBlock(): City {
  const c = createCity(61025); for (let d = 0; d < 200; d++) step(c);
  buildRoad(c, 12 * SIZE + 11, 18 * SIZE + 11); buildRoad(c, 18 * SIZE + 2, 18 * SIZE + 20); buildRoad(c, 15 * SIZE + 11, 15 * SIZE + 20);
  for (let x = 2; x <= 10; x++) { zoneCell(c, 17 * SIZE + x, 'R'); zoneCell(c, 19 * SIZE + x, 'R'); }
  for (let x = 12; x <= 19; x++) { zoneCell(c, 16 * SIZE + x, x < 16 ? 'I' : 'C'); zoneCell(c, 14 * SIZE + x, 'F'); zoneCell(c, 19 * SIZE + x, 'F'); }
  return c;
}
const crops = (c: City) => c.crops.harvested - c.crops.processed - c.crops.consumed - c.crops.writtenOff - (c.crops.exported ?? 0);

test('farms sell only their surplus above the local reserve to outside, at the export price', { timeout: 120_000 }, () => {
  const c = createCity(61025); let exportDays = 0;
  for (let d = 0; d < 400; d++) {
    step(c);
    const today = c.cropLedger.filter(e => e.tick === c.tick && e.kind === 'export');
    if (today.length) exportDays++;
    for (const e of today) {
      const farm = c.firms.find(f => f.wallet === e.from)!;
      assert.equal(farm.zone, 'F'); assert.equal(e.to, 'outside'); assert.equal(e.cash, e.quantity * CROP_EXPORT.price);
      const paid = c.ledger.filter(m => m.reason === e.reason); assert.equal(paid.length, 1); assert.equal(paid[0].from, 'outside'); assert.equal(paid[0].to, farm.wallet); assert.equal(paid[0].amount, e.cash);
    }
    for (const f of c.firms.filter(f => f.zone === 'F')) assert.ok(f.cropInventory <= CROP_STOCK_CAPS.F);
  }
  assert.ok(exportDays > 0, 'a full farm exports instead of wasting its harvest');
  assert.equal(crops(c), c.firms.reduce((n, f) => n + f.cropInventory, 0), 'crops reconcile with exports');
  assert.ok(CROP_EXPORT.price < 200, 'exports pay less than any local buyer');
  assert.deepEqual(deserialize(serialize(c)), c);
  const raw = JSON.parse(serialize(c)), at = raw.cropLedger.findIndex((e: { kind: string }) => e.kind === 'export');
  for (const mutate of [
    (x: any) => { x.cropLedger[at].cash += 1; },
    (x: any) => { x.crops.exported += 1; },
    (x: any) => { x.cropLedger[at].to = x.firms.find((f: any) => f.zone === 'I').wallet; },
  ]) { const bad = structuredClone(raw); mutate(bad); assert.throws(() => deserialize(JSON.stringify(bad))); }
});

test('a zoned block fills: outside investors open factories for idle crops, homes follow the jobs, no farm sits full', { timeout: 180_000 }, () => {
  const c = zonedBlock(), outsideDays: number[] = [];
  for (let d = 0; d < 330; d++) {
    const before = c.firms.length; step(c);
    for (const f of c.firms.slice(before)) if (c.ledger.some(e => e.reason === `Outside industry equity #${f.id}`)) {
      outsideDays.push(c.tick);
      assert.ok(summary(c).population >= OUTSIDE_INDUSTRY_POPULATION, 'investors only look at an established city');
    }
    if (c.tick % 90 === 0) assert.deepEqual(deserialize(serialize(c)), c);
  }
  assert.ok(outsideDays.length >= 1, 'outside investors funded at least one factory');
  assert.ok(outsideDays.every((day, i) => i === 0 || day - outsideDays[i - 1] >= MONTH), `at most one a month: ${outsideDays}`);
  const factories = c.firms.filter(f => f.zone === 'I').length, s = summary(c);
  assert.ok(factories >= 5, `${factories} factories built on the zoned industrial plots`);
  assert.ok(s.population >= 60, `population ${s.population} grew with the new jobs`);
  assert.equal(c.firms.filter(f => f.zone === 'F' && f.cropInventory >= CROP_STOCK_CAPS.F).length, 0, 'no farm sits at its crop cap');
  assert.ok(OUTSIDE_INDUSTRY_CROPS >= 240);
});

test('outside equity is only valid for a later factory opened that day', { timeout: 120_000 }, () => {
  const c = zonedBlock(); for (let d = 0; d < 330; d++) step(c);
  const raw = JSON.parse(serialize(c)), at = raw.ledger.findIndex((e: { reason: string }) => /^Outside industry equity #/.test(e.reason));
  assert.ok(at >= 0);
  for (const mutate of [
    (x: any) => { x.ledger[at].amount = 1; },
    (x: any) => { x.ledger[at].from = 'treasury'; },
    (x: any) => { const id = Number(/#(\d+)/.exec(x.ledger[at].reason)![1]); x.firms.find((f: any) => f.id === id).zone = 'F'; },
  ]) { const bad = structuredClone(raw); mutate(bad); assert.throws(() => deserialize(JSON.stringify(bad))); }
});

test('the HUD counts only jobs a firm can pay for; a small early city still grows on its own savings', { timeout: 120_000 }, () => {
  const c = createCity(61025); let outside = 0;
  for (let d = 0; d < 300; d++) {
    step(c);
    const s = summary(c), status = industryGrowthStatus(c);
    assert.ok(s.openJobs >= 0 && s.unfundedJobs >= 0);
    assert.equal(s.openJobs, status.fundedVacancies, 'open jobs on the HUD are the funded vacancies arrivals answer');
    if (c.ledger.some(e => e.tick === c.tick && /^Outside industry equity #/.test(e.reason))) outside++;
  }
  assert.equal(outside, 0, 'below the population gate the sample city grows only from factory savings');
});
