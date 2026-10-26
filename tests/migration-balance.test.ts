import test from 'node:test';
import assert from 'node:assert/strict';
import { DEPARTURE_FLOOR, DEPARTURE_MONTHS, MONTH, bulldoze, departureDay, createCity, deserialize, serialize, step, summary, zoneCell, type City } from '../src/sim.ts';
import { retrainingMoves } from '../src/labor.ts';

const closeIndustry = (c: City) => {
  const cells = c.firms.filter(f => f.zone === 'I' || f.zone === 'F').map(f => ({ cell: c.buildings.find(b => b.id === f.building)!.cell, zone: f.zone }));
  for (const { cell } of cells) assert.equal(bulldoze(c, cell).ok, true);
  return cells;
};

test('career change: idle specialists retrain only when their trade has no opening and the other trade has one', () => {
  const skills = { general: 1, manufacturing: 1, retail: 0 }, idle = { manufacturing: 0, retail: 0 };
  assert.deepEqual(retrainingMoves(skills, idle, { I: 0, C: 2 }), { manufacturing: 1, retail: 0 }, 'factories closed, a shop is hiring');
  assert.deepEqual(retrainingMoves(skills, idle, { I: 1, C: 2 }), { manufacturing: 0, retail: 0 }, 'their own trade still has an opening');
  assert.deepEqual(retrainingMoves(skills, idle, { I: 0, C: 0 }), { manufacturing: 0, retail: 0 }, 'no openings anywhere: retraining would not help');
  assert.deepEqual(retrainingMoves(skills, { manufacturing: 1, retail: 0 }, { I: 0, C: 2 }), { manufacturing: 0, retail: 0 }, 'an employed specialist keeps the trade');
  assert.deepEqual(retrainingMoves({ general: 0, manufacturing: 3, retail: 0 }, idle, { I: 0, C: 2 }), { manufacturing: 2, retail: 0 }, 'bounded by the openings');
  assert.deepEqual(retrainingMoves({ general: 0, manufacturing: 0, retail: 1 }, idle, { I: 1, C: 0 }), { manufacturing: 0, retail: 1 }, 'shops closed, a factory is hiring');
});

test('a healthy city keeps everyone: no household leaves in two years', { timeout: 120_000 }, () => {
  for (const seed of [61025, 2026]) {
    const c = createCity(seed); for (let d = 0; d < 720; d++) step(c);
    assert.equal(c.migration.departures ?? 0, 0, `seed ${seed}`);
    assert.equal(c.ledger.filter(e => e.reason === 'Emigration savings').length, 0);
  }
});

test('households with no paid work for two months leave gradually with their savings, down to a floor', { timeout: 120_000 }, () => {
  let c = createCity(61025); for (let d = 0; d < 400; d++) step(c);
  const outside = c.accounts.outside;
  closeIndustry(c);
  const months: [number, number][] = [], predicted = new Map<number, number>();
  for (let d = 0; d < 300; d++) {
    for (const h of c.households) { const day = departureDay(c, h.id); if (day !== null && !predicted.has(h.id)) predicted.set(h.id, day); else if (day === null) predicted.delete(h.id); }
    const count = c.households.length, left = c.migration.departures ?? 0, present = new Set(c.households.map(h => h.id)); step(c);
    for (const id of present) if (!c.households.some(h => h.id === id)) assert.ok(predicted.has(id) && c.tick >= predicted.get(id)!, `household ${id} left on day ${c.tick}, predicted ${predicted.get(id)}`);
    if (c.tick % MONTH === 0) months.push([count, (c.migration.departures ?? 0) - left]);
    if (c.tick % 90 === 0) c = deserialize(serialize(c));
  }
  const departed = c.migration.departures ?? 0;
  assert.ok(departed >= 4, `${departed} households left after the factories and farms closed`);
  assert.ok(c.households.length >= DEPARTURE_FLOOR);
  assert.ok(months.every(([count, left]) => left <= Math.ceil(count * .2)), `at most a fifth leave each month: ${JSON.stringify(months)}`);
  assert.ok(months.filter(([, left]) => left > 0).length >= 2, 'the exodus spreads over several months');
  const exits = c.ledger.filter(e => e.reason === 'Emigration savings');
  assert.ok(exits.length > 0 && exits.every(e => e.to === 'outside' && c.accounts[e.from] === 0 && !c.households.some(h => h.wallet === e.from)), 'savings leave with the household; its wallet stays at zero');
  for (const e of exits) {
    assert.ok(!c.ledger.some(w => w.reason === 'Monthly wages' && w.to === e.from && w.tick > e.tick - DEPARTURE_MONTHS * MONTH), 'nobody paid in the last two months leaves');
    assert.ok(e.tick % MONTH === 0, 'departures happen at month settlement');
  }
  assert.ok(c.accounts.outside > outside - 10_000_000, 'money is conserved through outside');
  assert.ok(c.households.every(h => h.home === null || c.buildings.some(b => b.id === h.home)));
  assert.deepEqual(deserialize(serialize(c)), c, 'a city with departures saves and loads');
  assert.ok(summary(c).population > 0);
});

test('after an exodus, rebuilding work brings new households back', { timeout: 120_000 }, () => {
  const c = createCity(61025); for (let d = 0; d < 400; d++) step(c);
  const closed = closeIndustry(c);
  for (let d = 0; d < 240; d++) step(c);
  assert.ok((c.migration.departures ?? 0) > 0);
  const arrivals = c.migration.arrivals, low = c.households.length;
  for (const { cell, zone } of closed) assert.equal(zoneCell(c, cell, zone as 'I' | 'F').ok, true);
  for (let d = 0; d < 360; d++) step(c);
  assert.ok(c.migration.arrivals > arrivals && c.households.length > low, `households ${low} → ${c.households.length}, arrivals ${arrivals} → ${c.migration.arrivals}`);
});

test('saves: old saves without a departure count load; forged departures are rejected', () => {
  const c = createCity(61025); for (let d = 0; d < 400; d++) step(c);
  closeIndustry(c); for (let d = 0; d < 120; d++) step(c);
  assert.ok((c.migration.departures ?? 0) > 0);
  const raw = JSON.parse(serialize(c));
  const old = JSON.parse(serialize(createCity(61025))); delete old.migration.departures;
  assert.doesNotThrow(() => deserialize(JSON.stringify(old)), 'a 1.1 save has no departure count');
  for (const mutate of [
    (x: any) => { x.migration.departures += 1; },
    (x: any) => { x.migration.departures = -1; },
    (x: any) => { const e = x.ledger.find((e: any) => e.reason === 'Emigration savings'); e.from = x.households[0].wallet; },
  ]) { const bad = structuredClone(raw); mutate(bad); assert.throws(() => deserialize(JSON.stringify(bad))); }
});
