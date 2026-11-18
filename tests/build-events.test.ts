import test from 'node:test';
import assert from 'node:assert/strict';
import { diffBuildings, buildScale, diffRoads, dustPuff, placeList, DUST_SECONDS } from '../src/build-events.ts';

test('new buildings and level-ups become events; loads and first frames do not', () => {
  const first = diffBuildings(new Map(), [{ id: 1, cell: 5, level: 1 }]);
  assert.deepEqual(first.events, [], 'first frame never animates');
  const grow = diffBuildings(first.next, [{ id: 1, cell: 5, level: 2 }, { id: 2, cell: 9, level: 1 }]);
  assert.deepEqual(grow.events, [{ cell: 5, kind: 'upgraded' }, { cell: 9, kind: 'built' }]);
  const rebuilt = diffBuildings(grow.next, [{ id: 7, cell: 5, level: 1 }, { id: 2, cell: 9, level: 1 }]);
  assert.deepEqual(rebuilt.events, [{ cell: 5, kind: 'built' }], 'a different building on the same parcel is new');
  const burst = diffBuildings(rebuilt.next, Array.from({ length: 20 }, (_, i) => ({ id: 100 + i, cell: 100 + i, level: 1 })));
  assert.deepEqual(burst.events, [], 'a save load is not construction');
  assert.equal(diffBuildings(burst.next, []).next.size, 0, 'demolished parcels are forgotten');
});

test('animation curves start small, end at full size and stay bounded', () => {
  assert.ok(buildScale('built', 0) <= .1); assert.equal(buildScale('built', 1), 1); assert.equal(buildScale('upgraded', 1), 1);
  for (let t = 0; t <= 1; t += .05) { assert.ok(buildScale('built', t) > 0 && buildScale('built', t) < 1.15); assert.ok(buildScale('upgraded', t) >= 1 && buildScale('upgraded', t) <= 1.13); }
});

test('every kind of place animates, and losing one is an event too', () => {
  const city = (extra: Partial<Parameters<typeof placeList>[0]> = {}) => ({ buildings: [{ id: 1, cell: 5, level: 1 }], parks: [], plants: [], ...extra });
  const start = diffBuildings(new Map(), placeList(city()));
  const placed = diffBuildings(start.next, placeList(city({ parks: [{ id: 1, cell: 8 }], civic: { sites: [{ id: 1, cell: 12 }] }, plants: [{ id: 1, cell: 20 }], education: { campuses: [{ id: 1, cell: 30, level: 1 }] } })));
  assert.deepEqual(placed.events, [8, 12, 20, 30].map(cell => ({ cell, kind: 'built' })), 'a park, a service, a plant and a campus with the same id as a home are all new');
  const upgraded = diffBuildings(placed.next, placeList(city({ parks: [{ id: 1, cell: 8 }], civic: { sites: [{ id: 1, cell: 12 }] }, plants: [{ id: 1, cell: 20, level: 2 }], education: { campuses: [{ id: 1, cell: 30, level: 2 }] } })));
  assert.deepEqual(upgraded.events, [{ cell: 20, kind: 'upgraded' }, { cell: 30, kind: 'upgraded' }]);
  const cleared = diffBuildings(upgraded.next, placeList(city()));
  assert.deepEqual(cleared.events, [8, 12, 20, 30].map(cell => ({ cell, kind: 'removed' })));
});

test('new road parcels are paved events, but a first frame or a load is not', () => {
  const cells = (roads: number[]) => Array.from({ length: 100 }, (_, i) => ({ road: roads.includes(i) }));
  const first = diffRoads(null, cells([1, 2, 3]));
  assert.deepEqual(first.paved, []); assert.deepEqual([...first.next], [1, 2, 3]);
  assert.deepEqual(diffRoads(first.next, cells([1, 2, 3, 4, 5])).paved, [4, 5]);
  assert.deepEqual(diffRoads(first.next, cells([2])).paved, [], 'removing road paves nothing');
  assert.deepEqual(diffRoads(first.next, cells(Array.from({ length: 60 }, (_, i) => i))).paved, [], 'a burst is a load');
});

test('dust puffs drift out and up, then vanish on time', () => {
  for (let i = 0; i < 6; i++) {
    const start = dustPuff(i, 6, 0), mid = dustPuff(i, 6, DUST_SECONDS / 2), end = dustPuff(i, 6, DUST_SECONDS);
    assert.ok(mid.y > start.y && Math.hypot(mid.x, mid.z) > Math.hypot(start.x, start.z));
    assert.ok(mid.size > 0 && mid.size < 1); assert.equal(end.size, 0);
  }
});
