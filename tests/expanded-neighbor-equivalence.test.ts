import test from 'node:test';
import assert from 'node:assert/strict';
import { expandedCellAt, expandedCellCoordinate, expandedCellNeighbors, EXPANDED_MAP_CELLS } from '../src/expanded-map-grid.ts';

function coordinateNeighbors(cell: number): number[] {
  const { x, z } = expandedCellCoordinate(cell);
  return [[x - 1, z], [x + 1, z], [x, z - 1], [x, z + 1]]
    .map(([nx, nz]) => expandedCellAt(nx, nz)).filter((next): next is number => next !== null);
}

test('neighbor IDs and west/east/north/south order match coordinates for every cell', () => {
  for (let cell = 0; cell < EXPANDED_MAP_CELLS; cell++) {
    assert.deepEqual(expandedCellNeighbors(cell), coordinateNeighbors(cell), `cell ${cell}`);
  }
  assert.deepEqual(expandedCellNeighbors(-0), coordinateNeighbors(-0));
});

test('neighbor arrays remain independent and callers cannot mutate later results', () => {
  for (let cell = 0; cell < EXPANDED_MAP_CELLS; cell++) {
    const expected = coordinateNeighbors(cell), first = expandedCellNeighbors(cell), second = expandedCellNeighbors(cell);
    assert.notStrictEqual(first, second);
    first.splice(0, first.length, -999);
    second.reverse();
    assert.deepEqual(expandedCellNeighbors(cell), expected, `cell ${cell}`);
  }
});

test('neighbor lookup preserves exact invalid-cell errors', () => {
  const invalid: unknown[] = [-1, 672, -0.5, 0.5, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, -Infinity, undefined, null, '0', true, {}, [], new Number(0), 0n, Symbol('cell')];
  const error = (fn: () => unknown) => {
    try { fn(); return null; } catch (e) { const err = e as Error; return { name: err.name, message: err.message }; }
  };
  for (const cell of invalid) {
    const original = error(() => coordinateNeighbors(cell as number));
    assert.ok(original);
    assert.deepEqual(error(() => expandedCellNeighbors(cell as number)), original);
  }
});
