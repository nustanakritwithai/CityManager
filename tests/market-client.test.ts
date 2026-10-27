import assert from 'node:assert/strict';
import test from 'node:test';
import { marketJournalForTest, MARKET_RULES } from '../src/market-client.ts';

test('market journal starts at v10/chain-5 and has no guest token field', () => {
  const j = marketJournalForTest(null);
  assert.equal(j.version, 10);
  assert.equal(j.rulesVersion, MARKET_RULES);
  assert.equal(j.guestId, null);
  assert.deepEqual(j.operations, []);
});

test('market journal rejects malformed or unknown operation records', () => {
  assert.throws(() => marketJournalForTest(JSON.stringify({ version: 9, rulesVersion: 'chain-4', operations: [], receipts: {} })));
  assert.throws(() => marketJournalForTest(JSON.stringify({ version: 10, rulesVersion: 'chain-5', operations: [{ opId: 'x', guestId: 'g', kind: 'unknown', state: 'pending', payload: {} }], receipts: {} })));
});

test('market journal preserves unrelated fields only through explicit schema', () => {
  const j = marketJournalForTest(JSON.stringify({ version: 10, rulesVersion: 'chain-5', guestId: 'guest-a', operations: [{ opId: 'op-a', guestId: 'guest-a', cityFingerprint: '1:2:3', kind: 'buy', payload: { listing_id: 'l', quantity: 1 }, state: 'pending', createdAt: '2026-10-27T00:00:00.000Z' }], receipts: {}, seq: '4' }));
  assert.equal(j.guestId, 'guest-a');
  assert.equal(j.operations[0].state, 'pending');
  assert.equal(j.seq, '4');
});
