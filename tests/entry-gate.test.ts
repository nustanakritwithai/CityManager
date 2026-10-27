import assert from 'node:assert/strict';
import test from 'node:test';
import { entryDecision } from '../src/entry-gate.ts';

test('entry gate resumes a valid returning Guest without creating another identity', () => {
  assert.equal(entryDecision(true, 'valid'), 'resume');
});

test('entry gate creates only for a fresh unauthenticated visitor', () => {
  assert.equal(entryDecision(false, 'unauthenticated'), 'create');
  assert.equal(entryDecision(true, 'unauthenticated'), 'retry');
});

test('entry gate fails closed on transient or unknown authentication state', () => {
  assert.equal(entryDecision(false, 'transient'), 'retry');
  assert.equal(entryDecision(true, 'transient'), 'retry');
});
