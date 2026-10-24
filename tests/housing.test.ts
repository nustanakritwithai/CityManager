import test from 'node:test';
import assert from 'node:assert/strict';
import { getHousingCapacity, buildOccupancyIndex, canAccommodate, type HousingCapacity } from '../src/housing.ts';

test('cottage levels expose the proposed household-1 dual capacities as independent objects', () => {
  assert.deepEqual([1, 2, 3].map(level => getHousingCapacity('cottage', level)), [
    { households: 1, persons: 4 }, { households: 2, persons: 8 }, { households: 3, persons: 12 },
  ]);
  const changed = getHousingCapacity('cottage', 1); changed.households = 99; changed.persons = 99;
  assert.deepEqual(getHousingCapacity('cottage', 1), { households: 1, persons: 4 });
});

test('housing catalog rejects unsupported types and noncanonical levels', () => {
  for (const type of ['tower', '', null, undefined, 1]) assert.throws(() => getHousingCapacity(type as any, 1));
  for (const level of [0, -1, 1.5, 4, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1', null, undefined]) assert.throws(() => getHousingCapacity('cottage', level as any));
});

test('vacant and shared homes count households separately from their members', () => {
  assert.deepEqual([...buildOccupancyIndex([])], []);
  const index = buildOccupancyIndex([
    { home: 10, members: 3 }, { home: 10, members: 1 }, { home: 20, members: 2 },
    { home: null, members: 3 }, { home: 0, members: 1 },
  ]);
  assert.deepEqual([...index], [[10, { households: 2, persons: 4 }], [20, { households: 1, persons: 2 }], [0, { households: 1, persons: 1 }]]);
  assert.equal(index.has(30), false, 'Vacant homes do not acquire fabricated occupancy');
});

test('admission independently enforces household slots and person capacity', () => {
  const cottage = getHousingCapacity('cottage', 2);
  assert.equal(canAccommodate(cottage, { households: 0, persons: 0 }, 3), true);
  assert.equal(canAccommodate(cottage, { households: 1, persons: 4 }, 4), true);
  assert.equal(canAccommodate(cottage, { households: 2, persons: 2 }, 1), false, 'Free person capacity does not create a household slot');
  assert.equal(canAccommodate(cottage, { households: 1, persons: 7 }, 2), false, 'A spare household slot does not override the person limit');
  assert.equal(canAccommodate(cottage, { households: 1, persons: 8 }, 1), false);
  assert.equal(canAccommodate(cottage, { households: 3, persons: 9 }, 1), false, 'Already overfull housing cannot admit another family');
  assert.equal(canAccommodate({ households: 0, persons: 0 }, { households: 0, persons: 0 }, 1), false);
});

test('rebuilding after a move or displacement counts each household once without stale occupancy', () => {
  const initial = [{ home: 10, members: 3 }, { home: 10, members: 1 }, { home: 20, members: 1 }];
  const before = buildOccupancyIndex(initial);
  const moved = initial.map((household, index) => index === 0 ? { ...household, home: 20 } : household);
  const after = buildOccupancyIndex(moved);
  assert.deepEqual(after.get(10), { households: 1, persons: 1 });
  assert.deepEqual(after.get(20), { households: 2, persons: 4 });
  assert.deepEqual(before.get(10), { households: 2, persons: 4 }, 'The previous snapshot is independent');
  assert.equal([...after.values()].reduce((sum, value) => sum + value.households, 0), 3);
  assert.equal([...after.values()].reduce((sum, value) => sum + value.persons, 0), 5);
  const displaced = buildOccupancyIndex(moved.map((household, index) => index === 0 ? { ...household, home: null } : household));
  assert.deepEqual(displaced.get(20), { households: 1, persons: 1 });
  assert.deepEqual([...buildOccupancyIndex(moved)], [...after], 'A repeated rebuild never accumulates a duplicate household');
});

test('occupancy and admission read frozen inputs without mutation or shared output references', () => {
  const households = Object.freeze([Object.freeze({ home: 5, members: 3 }), Object.freeze({ home: 6, members: 1 })]);
  const original = JSON.stringify(households), first = buildOccupancyIndex(households), second = buildOccupancyIndex(households);
  first.get(5)!.persons = 100;
  assert.deepEqual(second.get(5), { households: 1, persons: 3 });
  assert.deepEqual(first.get(6), { households: 1, persons: 1 });
  const capacity = Object.freeze(getHousingCapacity('cottage', 2)), occupied = Object.freeze({ households: 1, persons: 3 });
  assert.equal(canAccommodate(capacity, occupied, 3), true);
  assert.equal(JSON.stringify(households), original);
  assert.deepEqual(occupied, { households: 1, persons: 3 });
});

test('occupancy rejects missing, fractional, negative and unsafe household data including displaced families', () => {
  for (const input of [null, undefined, {}, 'households']) assert.throws(() => buildOccupancyIndex(input as any));
  for (const household of [null, [], {}, { home: 1 }, { home: undefined, members: 1 }, { home: -1, members: 1 }, { home: 1.5, members: 1 }, { home: Infinity, members: 1 }, { home: 1, members: 0 }, { home: 1, members: -1 }, { home: 1, members: 1.5 }, { home: 1, members: NaN }, { home: null, members: 0 }, { home: null, members: '3' }]) assert.throws(() => buildOccupancyIndex([household] as any));
  assert.throws(() => buildOccupancyIndex([{ home: 1, members: Number.MAX_SAFE_INTEGER }, { home: 1, members: 1 }]), /safe integer/);
});

test('admission rejects invalid counters and incoming sizes without overflowing valid extremes', () => {
  const valid = { households: 1, persons: 4 };
  for (const invalid of [null, [], {}, { households: -1, persons: 4 }, { households: 1.5, persons: 4 }, { households: 1, persons: NaN }, { households: 1, persons: Number.MAX_SAFE_INTEGER + 1 }]) {
    assert.throws(() => canAccommodate(invalid as HousingCapacity, valid, 1));
    assert.throws(() => canAccommodate(valid, invalid as HousingCapacity, 1));
  }
  for (const members of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1', undefined]) assert.throws(() => canAccommodate(valid, { households: 0, persons: 0 }, members as number));
  const maximum = { households: Number.MAX_SAFE_INTEGER, persons: Number.MAX_SAFE_INTEGER };
  assert.equal(canAccommodate(maximum, { households: Number.MAX_SAFE_INTEGER - 1, persons: Number.MAX_SAFE_INTEGER - 1 }, 1), true);
  assert.equal(canAccommodate(maximum, maximum, 1), false);
});
