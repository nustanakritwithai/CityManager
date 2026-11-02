import test from 'node:test';
import assert from 'node:assert/strict';
import { expandedCellCoordinate, EXPANDED_MAP_CELLS, LEGACY_MAP_CELLS } from '../src/expanded-map-grid.ts';
import { COAST, worldSurface } from '../src/scene-world-terrain.ts';

test('each proposed northern parcel is wholly inland under the current terrain formula', () => {
  assert.ok(COAST.west >= 0 && COAST.north-COAST.noiseNorth/2 >= 0 && COAST.east-COAST.noiseEast/2 >= 0);
  for (let cell = LEGACY_MAP_CELLS; cell < EXPANDED_MAP_CELLS; cell++) {
    const {x,z} = expandedCellCoordinate(cell);
    // Legacy world position uses 2 units/cell and an origin at the old grid centre.
    const left = 2*x-24, right = left+2, top = 2*z-24, bottom = top+2;
    const maxAbsX = Math.max(Math.abs(left), Math.abs(right)), nearZ = -bottom, farZ = -top;
    const minNorth = nearZ / Math.hypot(maxAbsX, nearZ);
    const minEast = left > 0 ? left / Math.hypot(left, farZ) : 0;
    const minWest = right < 0 ? -right / Math.hypot(right, farZ) : 0;
    // The noise is interpolated from hashes in [0,1]. All direction coefficients
    // below are positive, so these interval minima bound coast reach for every
    // point in the parcel, not just the sampled points.
    const coastLower = COAST.base - COAST.noiseBase/2 + minWest*COAST.west + minNorth*(COAST.north-COAST.noiseNorth/2) + minEast*(COAST.east-COAST.noiseEast/2);
    const furthestFromOldEdge = -top-24;
    assert.ok(coastLower - COAST.beachStart > furthestFromOldEdge, `cell ${cell} reaches beach`);
    // Boundary and centre checks also exercise the actual extracted terrain code.
    for (const px of [left,(left+right)/2,right]) for (const pz of [top,(top+bottom)/2,bottom]) {
      const surface = worldSurface(px,pz,24,1);
      assert.equal(surface.beach,0,`cell ${cell}`);
      assert.ok(surface.y > -.32,`cell ${cell} is submerged`);
    }
  }
});

test('prepared build strip is flat while every original build-grid sample is unchanged', async () => {
 const {playableWorldSurface,worldSurface}=await import('../src/scene-world-terrain.ts');
 for(let x=-24;x<=24;x+=.5)for(let z=-24;z<=24;z+=.5)assert.deepEqual(playableWorldSurface(x,z,24,1),worldSurface(x,z,24,1));
 for(let x=-24;x<=24;x+=.5)for(let z=-32;z<=-24;z+=.5){const s=playableWorldSurface(x,z,24,1);assert.equal(s.y,-.02);assert.equal(s.beach,0);}
});
