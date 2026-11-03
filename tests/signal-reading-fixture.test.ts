import test from 'node:test';
import assert from 'node:assert/strict';
import { deserialize, serialize } from '../src/sim.ts';
import { browserSnapshotState } from './browser-snapshot.ts';
import { signalReadingFixture } from './signal-reading-fixture.ts';

test('signal reading load expects validated expansion while preserving source and every non-map field', () => {
  const { sourceRaw, fixture } = signalReadingFixture();
  const source = deserialize(sourceRaw);
  assert.equal(source.cells.length, 576);
  assert.equal(fixture.cells.length, 672);
  assert.deepEqual(fixture.cells.slice(0, 576), source.cells);
  assert.deepEqual(fixture.resources.fertility.slice(0, 576), source.resources.fertility);
  const { cells: _oldCells, resources: _oldResources, ...oldState } = source;
  const { cells: _newCells, resources: _newResources, ...newState } = fixture;
  assert.deepEqual(newState, oldState);
  assert.deepEqual(browserSnapshotState(serialize(fixture)), fixture);
  assert.deepEqual(deserialize(sourceRaw), source, 'original server save remains unchanged');
});
