/** Real leisure integration evidence. Usage:
 * node --experimental-strip-types scripts/verify-park-recreation.mjs <leisure-checkout>
 * The other checkout is read/imported only; no code or saves there are edited.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildPark, createCity, deserialize, serialize, step, SIZE } from '../src/sim.ts';
import { createParkRecreation, advanceParkRecreation, serializeParkRecreation, restoreParkRecreation } from '../src/park-recreation.ts';
import { observeParkRecreationMinute, parkRecreationMinute, parkRecreationResidentIds } from '../src/park-recreation-activity.ts';
import { parkRecreationPanelData } from '../src/park-recreation-panel.ts';

if (!process.argv[2]) throw new Error('Supply the reviewed leisure checkout to test real activity. No synthetic fallback exists.');
const source = resolve(process.argv[2], 'src/park-activity.ts');
const digest = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const sourceHash = digest(source);
const leisure = await import(pathToFileURL(source).href);
const { createParkActivity, advanceParkActivity, reconcileParkActivity, startParkActivityDay, serializeParkActivity, restoreParkActivity, parkActivityDiagnostics } = leisure;

function initialCity(withPark) {
  const city = createCity(61025);
  for (let i = 0; i < 180; i++) step(city);
  if (withPark) {
    const homes = city.buildings.filter(b => b.zone === 'R' && city.households.some(h => h.home === b.id));
    const neighbors = i => [i % SIZE ? i - 1 : -1, i % SIZE < SIZE - 1 ? i + 1 : -1, i >= SIZE ? i - SIZE : -1, i < SIZE * (SIZE - 1) ? i + SIZE : -1].filter(n => n >= 0);
    const sites = city.cells.map((cell, i) => ({ cell, i })).filter(({ cell, i }) => !cell.road && !cell.zone && cell.building === null && !city.plants.some(p => p.cell === i) && !neighbors(i).some(n => city.cells[n].road));
    sites.sort((a, b) => {
      const distance = site => Math.min(...homes.map(home => Math.abs(home.cell % SIZE - site.i % SIZE) + Math.abs(Math.floor(home.cell / SIZE) - Math.floor(site.i / SIZE))));
      return distance(a) - distance(b) || a.i - b.i;
    });
    assert.ok(sites.length && buildPark(city, sites[0].i).ok, 'real treasury funds an off-road single-tile park');
  }
  return city;
}

function run({ withPark = true, batch = 1, reload = false } = {}) {
  let city = initialCity(withPark), activity = createParkActivity(city);
  let recreation = createParkRecreation(parkRecreationMinute(activity.day, activity.minute));
  const economicReference = deserialize(serialize(city));
  let elapsed = 0, observedEligibleMinutes = 0, completedReturns = 0, maximumOccupancy = 0;
  const phases = {}, positiveIdentities = new Set();
  const total = 2 * 1440;
  while (elapsed < total) {
    for (let i = 0; i < batch && elapsed < total; i++) {
      reconcileParkActivity(city, activity);
      const frame = observeParkRecreationMinute(city, activity);
      for (const visitor of activity.visitors) phases[visitor.phase] = (phases[visitor.phase] ?? 0) + 1;
      observedEligibleMinutes += frame.visits.filter(v => v.eligible).length;
      maximumOccupancy = Math.max(maximumOccupancy, frame.visits.length);
      const next = advanceParkRecreation(recreation, frame);
      advanceParkActivity(city, activity, 1);
      recreation = next;
      for (const [id, person] of Object.entries(recreation.citizens)) if (person.scoreUnits > 0) positiveIdentities.add(id);
      elapsed++;
      if (reload && elapsed === 1087) {
        city = deserialize(serialize(city));
        activity = restoreParkActivity(city, serializeParkActivity(activity));
        recreation = restoreParkRecreation(serializeParkRecreation(recreation), parkRecreationMinute(activity.day, activity.minute));
      }
      if (activity.minute === 1440) {
        assert.equal(serialize(city), serialize(economicReference), 'activity and recreation never mutate the economy');
        completedReturns += parkActivityDiagnostics(activity).completedReturns;
        step(city); step(economicReference); startParkActivityDay(city, activity);
      }
    }
  }
  assert.equal(serialize(city), serialize(economicReference));
  assert.equal(recreation.minute, parkRecreationMinute(activity.day, activity.minute));
  return { city, activity, recreation, observedEligibleMinutes, completedReturns, maximumOccupancy, phases, positiveIdentities: [...positiveIdentities].sort() };
}

const normal = run(), fast = run({ batch: 37 }), resumed = run({ batch: 13, reload: true }), baseline = run({ withPark: false, batch: 60 });
assert.equal(serializeParkRecreation(normal.recreation), serializeParkRecreation(fast.recreation));
assert.equal(serializeParkRecreation(normal.recreation), serializeParkRecreation(resumed.recreation));
assert.equal(serializeParkActivity(normal.activity), serializeParkActivity(resumed.activity));
assert.equal(serialize(normal.city), serialize(resumed.city));
assert.equal(Object.keys(baseline.recreation.citizens).length, 0);
assert.equal(baseline.observedEligibleMinutes, 0);
assert.ok(normal.observedEligibleMinutes > 0 && normal.completedReturns > 0 && normal.positiveIdentities.length > 0);
assert.ok(Object.values(normal.recreation.citizens).reduce((n, p) => n + p.earnedMinutes, 0) <= normal.observedEligibleMinutes);
const ordinary = initialCity(false); step(ordinary); step(ordinary);
assert.equal(serialize(baseline.city), serialize(ordinary), 'no-park baseline matches ordinary economic engine byte for byte');
const pauseBefore = JSON.stringify({ activity: normal.activity, recreation: normal.recreation, city: normal.city });
advanceParkActivity(normal.city, normal.activity, 0);
assert.equal(JSON.stringify({ activity: normal.activity, recreation: normal.recreation, city: normal.city }), pauseBefore);
assert.equal(digest(source), sourceHash, 'leisure source remained unchanged during evidence run');

const residents = parkRecreationResidentIds(normal.city), summary = parkRecreationPanelData(normal.recreation, residents);
const evidence = {
  provenance: { source: 'Real park-activity candidate, sampled before every actual minute; no synthetic visits',
    leisureSourceSHA256: sourceHash, recreationSourceSHA256: digest(new URL('../src/park-recreation.ts', import.meta.url)),
    adapterSourceSHA256: digest(new URL('../src/park-recreation-activity.ts', import.meta.url)),
    seed: 61025, startEconomicDay: 180, endEconomicDay: 182, elapsedMinutes: 2880,
    observedEligibleMinutes: normal.observedEligibleMinutes, completedReturns: normal.completedReturns,
    maximumOccupancy: normal.maximumOccupancy, phases: normal.phases,
    verified: ['real visit benefit', 'ongoing eligible duration only', 'batch 1 = 37', 'save/reload at minute 1087 = uninterrupted', 'pause no change', 'economy byte equality', 'no parks / no visits / no score', 'no-road one-tile park'] },
  residents, recreation: normal.recreation,
  summary: { average: summary.average, positiveResidents: summary.withBenefit, totalResidents: summary.population }
};
mkdirSync(new URL('../public/', import.meta.url), { recursive: true });
writeFileSync(new URL('../public/park-recreation-review.json', import.meta.url), JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify({ ...evidence.provenance, summary: evidence.summary }, null, 2));
