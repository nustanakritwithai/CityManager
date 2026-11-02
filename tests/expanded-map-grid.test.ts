import test from 'node:test';
import assert from 'node:assert/strict';
import { expandedCellAt, expandedCellCoordinate, expandedCellNeighbors, EXPANDED_MAP_CELLS, LEGACY_MAP_CELLS } from '../src/expanded-map-grid.ts';

test('all legacy IDs retain their coordinates and every added cell has a unique north coordinate', () => {
  const coordinates = new Set<string>();
  for (let cell = 0; cell < EXPANDED_MAP_CELLS; cell++) {
    const { x, z } = expandedCellCoordinate(cell);
    if (cell < LEGACY_MAP_CELLS) assert.deepEqual({ x, z }, { x: cell % 24, z: Math.floor(cell / 24) });
    else assert.ok(z >= -4 && z <= -1);
    assert.equal(expandedCellAt(x, z), cell);
    coordinates.add(`${x},${z}`);
  }
  assert.equal(coordinates.size, 672);
  for (const [x, z] of [[-1,0],[24,0],[0,-5],[0,24],[0.5,0],[NaN,0]]) assert.equal(expandedCellAt(x,z), null);
  for (const cell of [-1,672,1.5,NaN]) assert.throws(() => expandedCellCoordinate(cell), RangeError);
});

test('cardinal roads meet across the old north boundary without wrapping at map edges', () => {
  for (let cell = 0; cell < EXPANDED_MAP_CELLS; cell++) {
    const origin = expandedCellCoordinate(cell);
    const neighbors = expandedCellNeighbors(cell);
    assert.equal(new Set(neighbors).size, neighbors.length);
    for (const next of neighbors) {
      const target = expandedCellCoordinate(next);
      assert.equal(Math.abs(target.x - origin.x) + Math.abs(target.z - origin.z), 1);
      assert.ok(expandedCellNeighbors(next).includes(cell));
    }
  }
  for (let x = 0; x < 24; x++) {
    assert.ok(expandedCellNeighbors(x).includes(expandedCellAt(x, -1)!));
    assert.equal(expandedCellNeighbors(x).includes(576 + x), false);
  }
  assert.deepEqual(expandedCellNeighbors(expandedCellAt(0,-4)!), [expandedCellAt(1,-4), expandedCellAt(0,-3)]);
});
