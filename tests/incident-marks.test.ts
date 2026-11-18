import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCity, step, runIncidents } from '../src/sim.ts';
import { populationFixture } from './population-capacity-fixture.ts';
import { BURGLARY_REASON, MEDICAL_REASON, fireReason } from '../src/incidents.ts';
import { MAX_INCIDENT_MARKS, incidentMarks } from '../src/incident-marks.ts';
import { moneyMark } from '../src/money-pops.ts';

test('each incident is marked at its parcel: fires at the building, the rest at the home', () => {
  const c = createCity(61025); for (let i = 0; i < 60; i++) step(c);
  const home = c.households.find(h => h.home !== null)!, homeCell = c.buildings.find(b => b.id === home.home)!.cell;
  const other = c.buildings.find(b => b.id !== home.home)!, from = moneyMark(c);
  c.ledger.push({ tick: c.tick, from: 'treasury', to: 'upkeep', amount: 1, reason: fireReason(other.id) });
  c.ledger.push({ tick: c.tick, from: home.wallet, to: 'outside', amount: 1, reason: BURGLARY_REASON });
  c.ledger.push({ tick: c.tick, from: home.wallet, to: 'outside', amount: 1, reason: MEDICAL_REASON });
  c.ledger.push({ tick: c.tick, from: 'treasury', to: 'upkeep', amount: 1, reason: fireReason(home.home!) });
  const marks = incidentMarks(c, from);
  assert.deepEqual(marks.map(m => m.kind), ['fire', 'fire'], 'one mark per parcel, the worst wins');
  assert.deepEqual(new Set(marks.map(m => m.cell)), new Set([other.cell, homeCell]));
  assert.deepEqual(incidentMarks(c, moneyMark(c)), [], 'nothing new, nothing marked');
  c.ledger.push({ tick: c.tick, from: 'treasury', to: 'upkeep', amount: 1, reason: fireReason(999) });
  assert.deepEqual(incidentMarks(c, moneyMark(c) - 1), [], 'a building that is gone has no parcel');
});

test('a large unprotected city produces marks from its real incidents, capped', () => {
  const c = populationFixture(60, true), from = moneyMark(c);
  let seen = 0; for (let i = 0; i < 60 && seen < 3; i++) { const h = runIncidents(c); seen += h.fire + h.burglary + h.illness; c.tick++; }
  const marks = incidentMarks(c, from), cells = new Set(c.buildings.map(b => b.cell));
  assert.ok(marks.length > 0 && marks.length <= MAX_INCIDENT_MARKS);
  for (const m of marks) assert.ok(cells.has(m.cell));
});

test('mark animations fade in and out on time, flicker within bounds and alternate lights', async () => {
  const { INCIDENT_SECONDS, markFade, flameHeight, smokePuff, lightLit } = await import('../src/incident-marks.ts');
  for (const kind of ['fire', 'burglary', 'illness'] as const) {
    assert.equal(markFade(kind, 0), 0); assert.equal(markFade(kind, 1), 1); assert.equal(markFade(kind, INCIDENT_SECONDS[kind]), 0);
  }
  for (let t = 0; t < 6; t += .07) for (let k = 0; k < 3; k++) { const h = flameHeight(k, t); assert.ok(h >= .55 - 1e-9 && h <= 1.15 + 1e-9); }
  for (let t = 0; t < 5; t += .1) for (let k = 0; k < 4; k++) { const p = smokePuff(k, 4, t); assert.ok(p.y >= 0 && p.y < 2.6 && p.size >= 0 && p.size < .9); }
  assert.equal(lightLit(0), 0); assert.equal(lightLit(.3), 1); assert.equal(lightLit(.55), 0);
});
