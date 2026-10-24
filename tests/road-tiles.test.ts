import test from 'node:test';
import assert from 'node:assert/strict';
import { roadTileFor, SIDES, TILE_OPEN, type Side } from '../src/road-tiles.ts';

const rotate = (side: Side, degrees: number) => SIDES[(SIDES.indexOf(side) + degrees / 90) % 4];

test('every neighbour combination gets a tile whose rotated open sides match exactly', () => {
  for (let mask = 0; mask < 16; mask++) {
    const open = new Set(SIDES.filter((_, k) => mask & 1 << k));
    const { tile, rotation } = roadTileFor(open, 0);
    const rotated = new Set(TILE_OPEN[tile].map(side => rotate(side, rotation)));
    assert.deepEqual([...rotated].sort(), [...open].sort(), `mask ${mask} → ${tile} @ ${rotation}`);
  }
});

test('tile families follow the neighbour count and shape', () => {
  assert.equal(roadTileFor(new Set(), 0).tile, 'road-square');
  assert.equal(roadTileFor(new Set<Side>(['-z']), 0).tile, 'road-end');
  assert.equal(roadTileFor(new Set<Side>(['+z', '-z']), 0).tile, 'road-straight');
  assert.equal(roadTileFor(new Set<Side>(['+z', '-z']), 4).tile, 'road-crossing', 'some straight parcels get a crosswalk');
  assert.equal(roadTileFor(new Set<Side>(['+x', '+z']), 0).tile, 'road-corner');
  assert.equal(roadTileFor(new Set<Side>(['+x', '-x', '-z']), 0).tile, 'road-tee');
  assert.equal(roadTileFor(new Set<Side>(SIDES), 0).tile, 'road-cross');
});
