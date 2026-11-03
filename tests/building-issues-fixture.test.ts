import test from 'node:test';
import assert from 'node:assert/strict';
import { deserialize, serialize } from '../src/sim.ts';
import { deserializeParkSession, expandValidatedParkSession } from '../src/park-runtime.ts';
import { buildingIssues } from '../src/building-issues.ts';
import { buildingIssuesFixture } from './building-issues-fixture.ts';
import { createPanelServerFixture } from './panel-server-entry-fixture.mjs';

test('building issues use a genuine legacy city, exact service ACK and preserved migrated issues', async () => {
  const { raw, city, campusCell } = buildingIssuesFixture(); const source = deserialize(raw);
  assert.equal(source.cells.length, 576); assert.equal(city.cells.length, 672);
  assert.deepEqual(city.cells.slice(0, 576), source.cells);
  assert.deepEqual(city.resources.fertility.slice(0, 576), source.resources.fertility);
  const { cells: _old, resources: _oldResources, ...oldState } = source;
  const { cells: _new, resources: _newResources, ...newState } = city;
  assert.deepEqual(newState, oldState);
  assert.deepEqual(buildingIssues(city), buildingIssues(source));
  assert.ok(buildingIssues(city).some(issue => issue.cell === campusCell));
  assert.ok(buildingIssues(city).some(issue => issue.remaining > 0));
  const server = createPanelServerFixture('http://127.0.0.1:4173/CityManager/');
  const ack = await server.seed(raw); assert.equal(ack.revision, 1); assert.equal(ack.raw, raw);
  assert.equal(server.active.raw, raw);
  assert.equal(serialize(expandValidatedParkSession(deserializeParkSession(ack.raw)).city), serialize(city));
});
