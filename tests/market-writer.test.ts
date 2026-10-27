import assert from 'node:assert/strict';
import test from 'node:test';
import { withMarketWriter, type MarketWriterLocks } from '../src/market-writer.ts';

test('two tabs cannot start conflicting work while a writer holds the lock', async () => {
  let held = false, journal = 'original', release!: () => void, sends = 0;
  const locks: MarketWriterLocks = { async request(_name, _options, callback) { if (held) return callback(null); held = true; try { return await callback({}); } finally { held = false; } } };
  const delayed = new Promise<void>(resolve => { release = resolve; });
  const first = withMarketWriter({ locks, expectedJournal: journal, readJournal: () => journal, work: async () => { sends++; journal = 'pending-original-key'; await delayed; return 'done'; } });
  await assert.rejects(withMarketWriter({ locks, expectedJournal: 'original', readJournal: () => journal, work: async () => { sends++; } }), /market-writer-busy/);
  assert.equal(sends, 1); release(); await first;
  await assert.rejects(withMarketWriter({ locks, expectedJournal: 'original', readJournal: () => journal, work: async () => { sends++; } }), /market-state-changed-reload/);
  assert.equal(journal, 'pending-original-key'); assert.equal(sends, 1);
});

test('missing lock support and storage failures do not send mutations', async () => {
  let sends = 0; const work = async () => { sends++; };
  await assert.rejects(withMarketWriter({ locks: undefined, expectedJournal: null, readJournal: () => null, work }), /market-writer-lock-unavailable/);
  const locks: MarketWriterLocks = { request: async (_name, _options, callback) => callback({}) };
  await assert.rejects(withMarketWriter({ locks, expectedJournal: null, readJournal: () => { throw new Error('storage failure'); }, work }), /storage failure/);
  assert.equal(sends, 0);
});
