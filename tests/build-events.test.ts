import test from 'node:test';
import assert from 'node:assert/strict';
import { diffBuildings, buildScale } from '../src/build-events.ts';

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
