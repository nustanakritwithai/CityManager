import test from 'node:test';
import assert from 'node:assert/strict';
import { towerOnly, visualKind, toolbarMainOnly, changedPaths, visualSources } from '../scripts/ci-visual-scope.mjs';
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

test('vehicle route needs its geometry marker and excludes bus, driving, saves and other visual scopes', () => {
  const paths = ['src/vehicle-geometry.ts', 'src/vehicle-lighting.ts', 'src/scene-citizen-vehicles.ts', 'src/scene-traffic.ts', 'src/scene-atmosphere.ts', 'src/taxi/scene-vehicles.ts', 'tests/vehicle-visuals.test.ts', 'tests/vehicle-preview.ts', 'tests/vehicle-preview.html', 'tests/vehicle-smoke.mjs', 'tests/vehicle-baseline.ts', 'vite.vehicle.config.ts', '.github/workflows/traffic-enabled.yml', '.github/workflows/citymanager.yml', '.github/workflows/player-feedback.yml', 'scripts/ci-visual-scope.mjs', 'tests/ci-visual-scope.test.mjs'];
  assert.equal(visualKind(paths), 'vehicle');
  for (const extra of ['src/main.ts', 'src/bus/presentation.ts', 'src/traffic/layer.ts', 'src/traffic/game-poses.ts', 'src/taxi/vehicle-poses.ts', 'src/auto-cleanup.ts', 'src/factory-visuals.ts', 'src/vehicle-geometry.ts.old']) assert.equal(visualKind([...paths, extra]), 'full');
  assert.equal(visualKind(['src/scene-citizen-vehicles.ts', 'tests/vehicle-smoke.mjs']), 'full');
});

test('combined apartment/toolbar route verifies main content, not just its path', () => {
  const before = ["import './player-feedback.css';",'installHudIcons(); installKeycaps(); installSheetHandle(node);',"if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || document.querySelector('dialog[open]')) return;", "const shortcuts: Record<string, string> = { v: 'select', r: 'road', '1': 'R', '2': 'C', '3': 'I', '4': 'F', '5': 'power', '6': 'water', '7': 'park', b: 'bulldoze', p: 'select' };",'saveGuard.write(raw);'].join('\n');
  const after = "import { installBuildToolbar, BUILD_SHORTCUTS, blocksGameShortcuts } from './build-toolbar.ts';\n" + before.replace("import './player-feedback.css';", "import './player-feedback.css';\nimport './build-toolbar.css';").replace('installKeycaps();','installKeycaps(); installBuildToolbar();').replace('e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement','blocksGameShortcuts(e)').replace(/const shortcuts: Record<string, string> = .*;/,'const shortcuts = BUILD_SHORTCUTS;');
  const paths = ['src/apartment-visuals.ts','src/build-toolbar.ts','src/main.ts'];
  assert.equal(toolbarMainOnly(before,after),true);
  assert.equal(visualKind(paths,{mainBefore:before,mainAfter:after}),'visual-final');
  assert.equal(visualKind(paths),'full','missing main evidence fails closed');
  for(const bad of [after.replace('saveGuard.write(raw);','saveGuard.write(other);'),after+'\nmutateSave();',after.replace('blocksGameShortcuts(e)','false'),after.replace('installBuildToolbar();','')]) {
    assert.equal(toolbarMainOnly(before,bad),false);
    assert.equal(visualKind(paths,{mainBefore:before,mainAfter:bad}),'full');
  }
  for(const extra of ['src/save-storage.ts','src/traffic/layer.ts','server/city-advisor/index.ts','src/vehicle-geometry.ts']) assert.equal(visualKind([...paths,extra],{mainBefore:before,mainAfter:after}),'full');
  assert.equal(visualKind(paths.slice(1),{mainBefore:before,mainAfter:after}),'full');
});
