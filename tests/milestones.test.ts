import { test } from 'node:test';
import assert from 'node:assert/strict';
import { POPULATION_MILESTONES, milestoneCrossed } from '../src/milestones.ts';

test('crossing a population milestone celebrates once, the highest one crossed, and never on the way down', () => {
  assert.equal(milestoneCrossed(24, 25), 25); assert.equal(milestoneCrossed(25, 26), null, 'already past it');
  assert.equal(milestoneCrossed(40, 120), 100, 'a jump celebrates the highest milestone crossed');
  assert.equal(milestoneCrossed(120, 40), null); assert.equal(milestoneCrossed(50, 50), null);
  assert.equal(milestoneCrossed(0, 4001), 4000);
  for (let i = 1; i < POPULATION_MILESTONES.length; i++) assert.ok(POPULATION_MILESTONES[i] > POPULATION_MILESTONES[i - 1]);
});
