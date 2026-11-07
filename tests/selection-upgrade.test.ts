import test from 'node:test';
import assert from 'node:assert/strict';
import { access, buildPlant, createCity, plantAt, serialize } from '../src/sim.ts';
import { selectionUpgrade } from '../src/selection-upgrade.ts';
for (const kind of ['power', 'water'] as const) test(`${kind} selection uses actual guarded upgrade and stable quotes`, () => {
  const c = createCity(61025); const cell = c.cells.findIndex((x, i) => !x.road && x.building === null && !plantAt(c, i) && access(c, i));
  assert.ok(buildPlant(c, cell, kind).ok);
  const before = serialize(c); const q = selectionUpgrade(c, cell, null, false)!;
  assert.equal(serialize(c), before); assert.equal(q.level, 1); assert.equal(q.reason, '');
  const money = c.accounts.treasury; assert.ok(q.run().ok); assert.equal(c.accounts.treasury, money - q.cost);
  const after = serialize(c); assert.equal(q.run().ok, false); assert.equal(serialize(c), after);
  assert.ok(selectionUpgrade(c, cell, null, false)!.run().ok); assert.ok(selectionUpgrade(c, cell, null, false)!.reason);
});
test('low funds gives disabled reason; empty land and private buildings have no invented upgrade', () => {
  const c = createCity(61025); const cell = c.cells.findIndex((x, i) => !x.road && x.building === null && !plantAt(c, i) && access(c, i));
  assert.ok(buildPlant(c, cell, 'power').ok); c.accounts.treasury = 0;
  assert.ok(selectionUpgrade(c, cell, null, false)!.reason);
  for (const b of c.buildings) assert.equal(selectionUpgrade(c, b.cell, null, false), null);
});

test('campus quotes reflect maximum, university credential and treasury gates', () => {
  const c = createCity(61025), cell = 100;
  const campus = { id: 9001, cell, kind: 'university', level: 1, workDays: {}, contract: 0 } as any;
  c.education!.campuses.push(campus); c.education!.residentHigher = 0;
  assert.match(selectionUpgrade(c, cell, null, false)!.reason, /วุฒิ/);
  c.education!.residentHigher = 1; c.accounts.treasury = 0;
  assert.match(selectionUpgrade(c, cell, null, false)!.reason, /เงิน/);
  c.accounts.treasury = 999_999; assert.equal(selectionUpgrade(c, cell, null, false)!.cost, 250_000);
  assert.equal(selectionUpgrade(c, cell, null, false)!.reason, '');
  campus.kind = 'school'; assert.equal(selectionUpgrade(c, cell, null, false)!.cost, 150_000);
  campus.level = 2; assert.match(selectionUpgrade(c, cell, null, false)!.reason, /สูงสุด/);
});
test('bus feature gate and depot/stop maximum follow existing contracts', () => {
  const c = createCity(61025); c.bus = { depots: [{ id: 9001, cell: 100, level: 1, open: true, tick: 0 }], stops: [{ id: 9002, cell: 101, level: 1, side: 'n' }], lines: [] } as any;
  assert.equal(selectionUpgrade(c, 100, null, false), null);
  const before = c.accounts.treasury;
  assert.ok(selectionUpgrade(c, 100, null, true)!.run().ok);
  assert.ok(selectionUpgrade(c, 100, null, true)!.run().ok);
  assert.match(selectionUpgrade(c, 100, null, true)!.reason, /สูงสุด/);
  assert.ok(selectionUpgrade(c, 101, null, true)!.run().ok);
  assert.match(selectionUpgrade(c, 101, null, true)!.reason, /สูงสุด/);
  assert.equal(c.accounts.treasury, before, 'Existing free bus upgrades stay free');
});

test('taxi shortcut keeps the play-session free upgrade contract and feature gate', async () => {
  const { createTaxiSession } = await import('../src/taxi/session.ts');
  const c = createCity(61025); c.taxi = { depots: [{ id: 9003, cell: 102, level: 1, open: true, tick: 0 }] } as any;
  const session = createTaxiSession(); session.bind(c);
  assert.equal(selectionUpgrade(c, 102, null, false), null);
  const before = c.accounts.treasury, q = selectionUpgrade(c, 102, session, false)!;
  assert.equal(q.cost, 0); assert.ok(q.run().ok); assert.equal(c.accounts.treasury, before);
  assert.match(selectionUpgrade(c, 102, session, false)!.reason, /สูงสุด/);
});
