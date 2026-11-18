import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCity, step, serialize, deserialize, runIncidents, type City } from '../src/sim.ts';
import { populationFixture } from './population-capacity-fixture.ts';
import { BURGLARY_REASON, INCIDENT, INCIDENT_MIN_POPULATION, MEDICAL_REASON, incidentRoll, isIncidentReason } from '../src/incidents.ts';

const population = (c: City) => c.households.reduce((n, h) => n + h.members, 0);
/** A large city from the population fixture, so incidents are active. */
function bigCity(): City {
  const c = populationFixture(60, true);
  assert.ok(population(c) >= INCIDENT_MIN_POPULATION, `fixture has ${population(c)} people`);
  return c;
}

test('the incident roll is fixed by seed, day, place and kind, and spreads over [0, 1)', () => {
  assert.equal(incidentRoll(61025, 40, 7, 'fire'), incidentRoll(61025, 40, 7, 'fire'));
  assert.notEqual(incidentRoll(61025, 40, 7, 'fire'), incidentRoll(61025, 41, 7, 'fire'));
  assert.notEqual(incidentRoll(61025, 40, 7, 'fire'), incidentRoll(61025, 40, 7, 'burglary'));
  const rolls = Array.from({ length: 20_000 }, (_, i) => incidentRoll(20261023, i, i % 97, 'illness'));
  assert.ok(rolls.every(r => r >= 0 && r < 1));
  const mean = rolls.reduce((a, b) => a + b, 0) / rolls.length; assert.ok(Math.abs(mean - 0.5) < 0.02, `mean ${mean}`);
  const hits = rolls.filter(r => r < 1 / 400).length; assert.ok(hits > 20 && hits < 80, `hits ${hits}`);
});

test('small cities have no incidents, and running them never touches the city random stream', () => {
  const c = createCity(61025); for (let i = 0; i < 120; i++) step(c);
  assert.ok(population(c) < INCIDENT_MIN_POPULATION);
  assert.equal(c.ledger.some(e => isIncidentReason(e.reason)), false);
  const big = bigCity(), rng = big.rng; runIncidents(big); assert.equal(big.rng, rng);
});

test('in a large city with no services incidents happen, cost no more than they say and conserve money', () => {
  const c = bigCity(), start = c.tick;
  const seen = { fire: 0, burglary: 0, illness: 0 };
  for (let i = 0; i < 60; i++) {
    const happened = runIncidents(c); seen.fire += happened.fire; seen.burglary += happened.burglary; seen.illness += happened.illness;
    c.tick++; // incidents only; the rest of the day is covered by the step test below
  }
  c.tick = start + 60;
  assert.ok(seen.fire + seen.burglary + seen.illness > 0, 'a large unprotected city sees incidents within two months');
  for (const e of c.ledger.filter(e => isIncidentReason(e.reason))) {
    if (e.reason === BURGLARY_REASON) { assert.match(e.from, /^household:/); assert.equal(e.to, 'outside'); assert.ok(e.amount <= INCIDENT.burglary.cost); }
    else if (e.reason === MEDICAL_REASON) { assert.match(e.from, /^household:/); assert.equal(e.to, 'outside'); assert.ok(e.amount <= INCIDENT.illness.cost); }
    else { assert.equal(e.from, 'treasury'); assert.equal(e.to, 'upkeep'); assert.ok(e.amount <= INCIDENT.fire.cost); }
  }
  assert.equal(Object.values(c.accounts).reduce((a, b) => a + b, 0), 0);
});

test('a large city keeps stepping, saving and loading with incidents in its ledger', () => {
  const c = bigCity();
  for (let i = 0; i < 31; i++) { step(c); const saved = serialize(c); assert.equal(serialize(deserialize(saved)), saved, `day ${i}`); }
  assert.equal(Object.values(c.accounts).reduce((a, b) => a + b, 0), 0);
});
