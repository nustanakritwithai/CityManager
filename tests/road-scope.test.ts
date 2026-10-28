import test from 'node:test';
import assert from 'node:assert/strict';
import { access, buildRoad, bulldoze, connectedRoads, createCity, GATEWAY, serialize, deserialize, step, summary } from '../src/sim.ts';
import { buildingIssues } from '../src/map-overlay.ts';

test('road results reflect direct edits, road commands, and loaded cities between operations', () => {
  const c = createCity(42);
  for (let i = 0; i < 60; i++) step(c);
  const initial = summary(c);
  assert.ok(initial.jobs > 0);
  connectedRoads(c).clear();
  assert.equal(access(c, GATEWAY + 1), true, 'the returned Set is independent');
  c.cells[GATEWAY].road = false;
  assert.equal(access(c, GATEWAY + 1), false);
  assert.equal(summary(c).jobs, 0);
  c.cells[GATEWAY].road = true;
  assert.deepEqual(summary(c), initial);
  assert.equal(bulldoze(c, GATEWAY + 1).ok, true);
  assert.equal(access(c, GATEWAY + 2), false);
  assert.equal(buildRoad(c, GATEWAY + 1, GATEWAY + 1).ok, true);
  assert.equal(access(c, GATEWAY + 2), true);
  const loaded = deserialize(serialize(c));
  assert.deepEqual(summary(loaded), summary(c));
});

test('a failed summary cannot leave a stale road scope', () => {
  const c = createCity(42);
  const ledger = c.ledger;
  c.ledger = null as unknown as typeof c.ledger;
  assert.throws(() => summary(c));
  c.ledger = ledger;
  c.cells[GATEWAY].road = false;
  assert.equal(summary(c).jobs, 0);
  assert.equal(access(c, GATEWAY + 1), false);
});

test('building warnings reflect road changes between separate reads', () => {
  const c = createCity(42);
  for (let i = 0; i < 60; i++) step(c);
  const before = buildingIssues(c);
  c.cells[GATEWAY].road = false;
  const disconnected = buildingIssues(c);
  assert.ok(disconnected.some(issue => issue.kind === 'no-road'));
  c.cells[GATEWAY].road = true;
  assert.deepEqual(buildingIssues(c), before);
});
