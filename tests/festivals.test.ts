import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MONTH } from '../src/sim.ts';
import { festivalAt, gameDate } from '../src/festivals.ts';

const at = (month: number, day: number, year = 0) => (year * 12 + month - 1) * MONTH + day - 1;

test('the game calendar starts on 1 January and repeats every twelve months', () => {
  assert.deepEqual(gameDate(0), { month: 1, day: 1 });
  assert.deepEqual(gameDate(at(4, 13)), { month: 4, day: 13 });
  assert.deepEqual(gameDate(at(12, 30, 2)), { month: 12, day: 30 });
});

test('festivals fall on their days every year, and nowhere else', () => {
  for (const year of [0, 1, 5]) {
    for (const day of [13, 14, 15]) assert.equal(festivalAt(at(4, day, year)), 'songkran');
    assert.equal(festivalAt(at(4, 12, year)), null); assert.equal(festivalAt(at(4, 16, year)), null);
    assert.equal(festivalAt(at(11, 15, year)), 'loykrathong'); assert.equal(festivalAt(at(11, 14, year)), null);
    assert.equal(festivalAt(at(12, 30, year)), 'newyear'); assert.equal(festivalAt(at(1, 1, year + 1)), 'newyear');
    assert.equal(festivalAt(at(1, 2, year)), null);
  }
  let days = 0; for (let t = 0; t < 12 * MONTH; t++) if (festivalAt(t)) days++;
  assert.equal(days, 6, 'six festival days a year');
});
