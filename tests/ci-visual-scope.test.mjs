import test from 'node:test';
import assert from 'node:assert/strict';
import { towerOnly, visualKind, changedPaths, visualSources } from '../scripts/ci-visual-scope.mjs';
const base = 'a'.repeat(40), head = 'b'.repeat(40), ancestor = 'c'.repeat(40);
test('only explicitly allowed paths with an actual visual source change select tower checks', () => {
  assert.equal(towerOnly([...visualSources, 'tests/building-visuals.test.ts']), true);
  for (const paths of [[], ['tests/building-visuals.test.ts'], ['.github/workflows/citymanager.yml'], ['src/save-safety.ts', ...visualSources], ['src/main.ts', ...visualSources], ['src/renderer.ts.old'], ['package.json', ...visualSources]]) assert.equal(towerOnly(paths), false);
});
test('PR uses merge base and exact checked-out head; push uses entire before/after range', () => {
  const calls = [];
  const git = args => { calls.push(args); return args[0] === 'merge-base' ? ancestor : args[0] === 'rev-parse' ? head : 'src/renderer.ts\0'; };
  assert.deepEqual(changedPaths('pull_request', { pull_request: { base: { sha: base }, head: { sha: head } } }, git), ['src/renderer.ts']);
  assert.deepEqual(calls.at(-1), ['diff', '--name-only', '--no-renames', '-z', ancestor, head]);
  changedPaths('push', { before: base, after: head }, git);
  assert.deepEqual(calls.at(-1), ['diff', '--name-only', '--no-renames', '-z', base, head]);
});
test('unknown event, zero ranges and checkout mismatch fail closed', () => {
  assert.throws(() => changedPaths('workflow_dispatch', {}, () => head));
  assert.throws(() => changedPaths('push', { before: '0'.repeat(40), after: head }, () => head));
  assert.throws(() => changedPaths('push', { before: base, after: head }, () => base));
  assert.throws(() => changedPaths('pull_request', {}, () => head));
});

test('factory route requires its source marker and rejects mixed scopes or unrelated changes', () => {
  const paths = ['src/factory-visuals.ts', 'src/renderer.ts', 'tests/factory-visuals.test.ts', 'tests/factory-preview.ts', 'tests/factory-preview.html', 'tests/factory-smoke.mjs', 'vite.factory.config.ts', '.github/workflows/citymanager.yml', '.github/workflows/player-feedback.yml', 'scripts/ci-visual-scope.mjs', 'tests/ci-visual-scope.test.mjs'];
  assert.equal(visualKind(paths), 'factory');
  assert.equal(visualKind(visualSources), 'tower');
  for (const invalid of [[], ['tests/factory-visuals.test.ts'], ['.github/workflows/citymanager.yml'], [...paths, 'src/main.ts'], [...paths, 'src/auto-cleanup.ts'], [...paths, 'src/factory-visuals.ts.old'], [...paths, 'src/asset-models.ts'], [...paths, 'tests/luxury-tower-smoke.mjs']]) assert.equal(visualKind(invalid), 'full');
  assert.equal(visualKind(['src/renderer.ts', 'tests/factory-smoke.mjs']), 'full', 'shared renderer alone does not select factory route');
});
