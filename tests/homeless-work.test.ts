import test from 'node:test';
import assert from 'node:assert/strict';
import { createCity, step, serialize, deserialize, summary, zoneCell, access, homelessWork, type City } from '../src/sim.ts';
import { keepSupplied } from './plants.ts';
import { legacySizes } from './legacy-sizes.ts';

/** The starter city with farmland zoned and no more lots for houses. */
function farmTown(prepare: (c: City) => City = c => c) {
  const c = prepare(createCity(61025));
  let zoned = 0;
  for (let i = 0; i < c.cells.length && zoned < 6; i++) if (!c.cells[i].road && !c.cells[i].zone && c.cells[i].building === null && access(c, i) && zoneCell(c, i, 'F').ok) zoned++;
  return c;
}

test('people come to work on the farms before there are houses for them, and work without a home', { timeout: 300_000 }, () => {
  const c = farmTown(); assert.equal(homelessWork(c), true);
  for (let d = 0; d < 120; d++) { step(c); keepSupplied(c); }
  const homeless = c.households.filter(h => h.home === null);
  assert.ok(homeless.length > 0, 'some households have no home yet');
  const working = homeless.filter(h => c.employment.some(e => e.householdId === h.id));
  assert.ok(working.length > 0, 'and they work');
  assert.ok(working.some(h => c.firms.find(f => f.id === c.employment.find(e => e.householdId === h.id)!.firmId)!.zone === 'F'), 'on the farms');
  // They draw wages, buy food and pay no rent or bills.
  for (const h of working) {
    assert.ok(c.ledger.some(e => e.to === h.wallet && e.reason === 'Monthly wages'), `household #${h.id} was paid`);
    assert.ok(!c.ledger.some(e => e.from === h.wallet && (e.reason === 'Monthly household rent' || e.reason === 'Monthly household water and power bill')));
  }
  // Their need for homes is housing demand.
  assert.ok(summary(c).demand.R >= 1);
  assert.deepEqual(deserialize(serialize(c)), c, 'the save accepts households working with no home');
});

test('a home that opens goes to a household that had none', { timeout: 300_000 }, () => {
  const c = farmTown();
  for (let d = 0; d < 90; d++) { step(c); keepSupplied(c); }
  const waiting = c.households.filter(h => h.home === null).map(h => h.id);
  assert.ok(waiting.length > 0);
  let zoned = 0;
  for (let i = 0; i < c.cells.length && zoned < 4; i++) if (!c.cells[i].road && !c.cells[i].zone && c.cells[i].building === null && access(c, i) && zoneCell(c, i, 'R').ok) zoned++;
  for (let d = 0; d < 30; d++) { step(c); keepSupplied(c); }
  assert.ok(c.households.some(h => waiting.includes(h.id) && h.home !== null), 'a waiting household moved into a new house');
});

test('a city saved before still needs a home to come to', { timeout: 300_000 }, () => {
  const c = farmTown(legacySizes); assert.equal(homelessWork(c), false);
  for (let d = 0; d < 120; d++) { step(c); keepSupplied(c); }
  assert.equal(c.households.filter(h => h.home === null).length, 0);
});
