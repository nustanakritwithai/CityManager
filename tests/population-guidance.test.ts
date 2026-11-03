import test from 'node:test';
import assert from 'node:assert/strict';
import { populationGuidance } from '../src/population-guidance.ts';
import { overviewRevision } from '../src/overview-revision.ts';
import { citySideMissions } from '../src/city-goals.ts';
import { cityChallenges } from '../src/city-challenges.ts';
import { cityGoals } from '../src/city-goals.ts';
import { GATEWAY, SIZE, access, buildPlant, buildRoad, createCity, industryGrowthStatus, plantAt, serialize, deserialize, editRoadJunction, step, zoneCell } from '../src/sim.ts';
import { guideState } from '../src/guide-steps.ts';

/** Follow the existing empty-map guide test's real layout; no economy is forged. */
function guidedCity(seed: number) {
  const c = createCity(seed, { starter: false });
  assert.ok(buildRoad(c, GATEWAY, GATEWAY + 10).ok);
  for (const x of [2, 3, 5, 6]) assert.ok(zoneCell(c, 11 * SIZE + x, 'R').ok);
  const reserved = [4, 7, 9, 10].map(x => 13 * SIZE + x);
  const farm = c.cells.map((cell, i) => !cell.road && cell.zone === null && access(c, i) && i > 12 * SIZE + 10 && !reserved.includes(i) ? i : -1)
    .filter(i => i >= 0).sort((a, b) => c.resources.fertility[b] - c.resources.fertility[a])[0];
  assert.ok(zoneCell(c, farm, 'F').ok); assert.ok(zoneCell(c, 13 * SIZE + 9, 'I').ok);
  for (const x of [4, 7]) assert.ok(zoneCell(c, 13 * SIZE + x, 'C').ok);
  for (let i = 0; i < 120 && guideState(c).step?.id !== 'grow'; i++) step(c);
  assert.equal(guideState(c).step?.id, 'grow');
  for (const x of [8, 10]) assert.ok(zoneCell(c, 11 * SIZE + x, 'R').ok);
  assert.ok(zoneCell(c, 13 * SIZE + 10, 'I').ok);
  const sites = c.cells.map((cell, i) => !cell.road && cell.zone === null && cell.building === null && !plantAt(c, i) && access(c, i) ? i : -1).filter(i => i >= 0);
  assert.ok(buildPlant(c, sites[0], 'power').ok); assert.ok(buildPlant(c, sites[1], 'water').ok);
  return c;
}

test('guidance explains the actual guided-city capital bottleneck and follows live state', { timeout: 120_000 }, () => {
  const c = guidedCity(61025);
  while (c.tick < 150) step(c);
  const goals = cityGoals(c), state = industryGrowthStatus(c), before = serialize(c);
  assert.equal(goals.next?.id, 'city'); assert.equal(state.code, 'growth.saving-capital'); assert.equal(state.fundedVacancies, 0);
  const message = populationGuidance(c, goals); assert.ok(message);
  assert.match(message.reason, /0 ตำแหน่ง/); assert.match(message.capital, new RegExp(`#${state.sponsorFirmId}`));
  assert.match(message.capital, /ไม่ใช่คลังเมือง/); assert.match(message.action, /เงื่อนไขอาจเปลี่ยน/);
  assert.equal(serialize(c), before, 'advice is a read-only projection');
  assert.deepEqual(populationGuidance(deserialize(before), cityGoals(deserialize(before))), message);
  const missions = citySideMissions(c), challenges = cityChallenges(c);
  const originalKey = overviewRevision(c, goals, missions, challenges, message);
  const f = c.firms.find(f => f.id === state.sponsorFirmId)!;
  c.accounts[f.wallet] += 100;
  const changed = populationGuidance(c, cityGoals(c));
  assert.notEqual(changed?.capital, message.capital, 'same-tick capital changes appear in the rendered advice');
  assert.notEqual(overviewRevision(c, cityGoals(c), missions, challenges, changed), originalKey, 'same-tick advice changes invalidate the actual dashboard key');
});

test('guidance is hidden in bootstrap, at other goals, and once jobs open', { timeout: 120_000 }, () => {
  const empty = createCity(61025, { starter: false }); assert.equal(populationGuidance(empty, cityGoals(empty)), null);
  const c = guidedCity(61025);
  while (c.tick < 150) step(c);
  assert.ok(populationGuidance(c, cityGoals(c)));
  while (c.tick < 267) step(c);
  assert.notEqual(industryGrowthStatus(c).code, 'growth.saving-capital');
  assert.equal(populationGuidance(c, cityGoals(c)), null);
});


test('fresh goal snapshots and dashboard keys change on same-tick junction edits', { timeout: 120_000 }, () => {
  const c = guidedCity(61025);
  while (c.tick < 150) step(c);
  const first = cityGoals(c), missions = citySideMissions(c), challenges = cityChallenges(c);
  const key = overviewRevision(c, first, missions, challenges, populationGuidance(c, first));
  const tick = c.tick, ledgerSize = c.ledger.length;
  assert.ok(editRoadJunction(c, GATEWAY + 1, GATEWAY + 2, false).ok);
  assert.equal(c.tick, tick); assert.equal(c.ledger.length, ledgerSize);
  const fresh = cityGoals(c);
  assert.notDeepEqual(fresh, first);
  assert.notEqual(overviewRevision(c, fresh, citySideMissions(c), cityChallenges(c), populationGuidance(c, fresh)), key);
});

test('level 5 guidance follows the new population target, but never legacy level 5', { timeout: 120_000 }, () => {
  const c = guidedCity(61025);
  while (c.tick < 150) step(c);
  assert.equal(industryGrowthStatus(c).code, 'growth.saving-capital');
  // Change only a household member count to isolate population thresholds while preserving the
  // actual funded-job and factory-capital state from the guided simulation. No save is made.
  const household = c.households[0];
  const total = () => c.households.reduce((n, h) => n + h.members, 0);
  household.members += 20 - total();
  // With 20 residents, substantial recent exports activate outside investment. Remove those
  // synthetic test rows to isolate a real saving-capital state without that alternative.
  c.cropLedger = c.cropLedger.filter(e => e.kind !== 'export');
  assert.equal(industryGrowthStatus(c).code, 'growth.saving-capital');
  let goals = cityGoals(c);
  assert.equal(goals.next?.id, 'self-reliant');
  assert.ok(populationGuidance(c, goals), '20 residents is below the expanded target');
  household.members += 59 - total();
  goals = cityGoals(c);
  assert.equal(goals.next?.id, 'self-reliant');
  assert.ok(populationGuidance(c, goals), '59 residents is still below the target');
  household.members++;
  goals = cityGoals(c);
  assert.equal(goals.next?.id, 'self-reliant', 'other requirements remain incomplete');
  assert.equal(populationGuidance(c, goals), null, '60 residents meets the target');
  household.members -= 40; // restore population to 20
  delete c.goalRulesVersion;
  // Keep legacy level 5 incomplete without changing the factory-funding conditions.
  c.goodsLedger.push({ tick: c.tick, from: 'outside', to: c.firms.find(f => f.zone === 'C')!.wallet, quantity: 1, reason: 'Imported shop stock' });
  goals = cityGoals(c);
  assert.equal(goals.next?.id, 'self-reliant');
  assert.equal(populationGuidance(c, goals), null, 'legacy level 5 has no population target');
});
