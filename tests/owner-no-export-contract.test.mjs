import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('owner replay remains available in memory without a checkpoint download control', () => {
  const source = readFileSync(new URL('../src/owner-decision-panel.ts', import.meta.url), 'utf8');
  assert.match(source, /button\('owner-verify'/);
  assert.match(source, /replayOwnerJournal\(captured\)/);
  assert.match(source, /controls\.append\(evaluate, cancelTyphoon, verify\)/);
  assert.doesNotMatch(source, /owner-export|createObjectURL|\.download\s*=|new Blob\s*\(/);
});
