import { assertKeycapContract } from './visual-final-toolbar.mjs';
import { createHash } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { railPathsOnly, railOnly, commercialPathsOnly, commercialOnly, sessionLifetimePathsOnly, sessionLifetimeOnly, historyPathsOnly, historyOnly, classicToolbarPathsOnly, classicToolbarOnly, conflictFeedbackPathsOnly, serverSaveConflictFeedbackOnly, managementPathsOnly, serverSaveManagementOnly, towerOnly, visualKind, toolbarMainOnly, matchesReviewedSources, serverSaveEntryOnly, changedPaths, visualSources } from '../scripts/ci-visual-scope.mjs';
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

test('server-only scope uses exact reviewed main/index content and never a path-only bypass', () => {
  const evidence={mainBefore:'old main\n',mainAfter:'reviewed server main\n',indexBefore:'old html\n',indexAfter:'reviewed html\n'};
  const hashes=Object.fromEntries(Object.entries(evidence).map(([key,value])=>[key,createHash('sha256').update(value).digest('hex')]));
  assert.equal(matchesReviewedSources(evidence,hashes),true);
  assert.equal(matchesReviewedSources({...evidence,mainAfter:'unreviewed main\n'},hashes),false);
  assert.equal(matchesReviewedSources({...evidence,indexAfter:'unreviewed html\n'},hashes),false);
  assert.equal(matchesReviewedSources({},hashes),false);assert.equal(serverSaveEntryOnly({}),false);
  const paths=['src/server-city-save.ts','src/server-city-entry.ts','src/city-save-auth.ts','src/main.ts','index.html'];
  assert.equal(visualKind(paths,evidence),'full','synthetic content is not the reviewed server transition');
  assert.equal(visualKind([...paths,'src/sim.ts'],evidence),'full');
});

test('shortcut badge assertions enforce both pointer-capable and non-hover media branches', () => {
  const facts={minWidth:true,hover:true,finePointer:true,anyCoarse:false,maxTouchPoints:0,touchUi:false};
  const visible=['1','2','3','4'].map(key=>({key,content:JSON.stringify(key)})),hidden=visible.map(c=>({...c,content:'none'}));
  assert.equal(assertKeycapContract({facts,caps:visible}).eligible,true);
  assert.equal(assertKeycapContract({facts:{...facts,hover:false},caps:hidden}).eligible,false);
  assert.throws(()=>assertKeycapContract({facts,caps:hidden}));
  assert.throws(()=>assertKeycapContract({facts:{...facts,hover:false},caps:visible}));
  assert.throws(()=>assertKeycapContract({facts:{...facts,touchUi:true},caps:hidden}));
});


test('management route requires exact lifecycle markers and excludes backend installers/mixed scope',()=>{
 const paths=['src/fresh-server-city.ts','src/save-management-dialog.ts','src/main.ts','index.html','src/server-city-save.ts','src/server-city-entry.ts','server/city-saves/service.mjs'];
 assert.equal(managementPathsOnly(paths),true);
 for(const invalid of [[],paths.slice(1),['tests/save-management-dialog.test.ts'],...['src/sim.ts','src/build-toolbar.ts','src/city-save-auth.ts','server/city-saves/pg-store.mjs','server/city-saves/migration-management.sql','server/city-saves/management-installer/database-management.mjs'].map(p=>[...paths,p])])assert.equal(managementPathsOnly(invalid),false);
 assert.equal(serverSaveManagementOnly({}),false);
 assert.equal(visualKind(paths),'full','paths without reviewed main/index evidence cannot select management');
});


test('conflict feedback scope admits only required UI/client contracts, never backend or index edits',()=>{
 const paths=['src/main.ts','src/server-city-save.ts','src/save-management-dialog.ts','tests/server-city-save.test.ts','tests/save-management-dialog.test.ts'];
 assert.equal(conflictFeedbackPathsOnly(paths),true);
 assert.equal(conflictFeedbackPathsOnly([...paths,'tests/server-save-browser-smoke.mjs']),true);
 for(const invalid of [[],paths.slice(1),...['index.html','src/server-city-entry.ts','src/city-save-auth.ts','server/city-saves/service.mjs','.github/workflows/citymanager.yml','src/sim.ts'].map(p=>[...paths,p])])assert.equal(conflictFeedbackPathsOnly(invalid),false);
 assert.equal(serverSaveConflictFeedbackOnly({}),false);
 assert.equal(visualKind(paths),'full','reviewed main and unchanged index evidence is mandatory');
});


test('classic toolbar cosmetics require real toolbar changes and reject saving/simulation/entry paths',()=>{
 const paths=['src/main.ts','src/build-toolbar.ts','src/build-toolbar.css','tests/build-toolbar.test.ts','tests/visual-final-toolbar.mjs'];
 assert.equal(classicToolbarPathsOnly(paths),true);
 assert.equal(classicToolbarOnly(paths),false);assert.equal(visualKind(paths),'full','reviewed main label change and unchanged index evidence required');
 for(const invalid of [[],paths.slice(1),...['index.html','src/server-city-save.ts','src/server-city-entry.ts','server/city-saves/service.mjs','src/sim.ts','src/apartment-visuals.ts'].map(p=>[...paths,p])]){assert.equal(classicToolbarPathsOnly(invalid),false);assert.equal(visualKind(invalid),'full');}
});


test('history economic/save route requires reviewed source diff and rejects unrelated visuals/backend',()=>{
 const paths=['src/city-history.ts','src/city-history-validation.ts','src/sim.ts','src/server-city-entry.ts','src/city-save-auth.ts','tests/city-history.test.ts','tests/history-validators.test.ts','tests/server-save-browser-smoke.mjs'];
 assert.equal(historyPathsOnly(paths),true);assert.equal(historyPathsOnly([...paths,'src/save-storage.ts','tests/save-quota-lossless.test.ts']),true);assert.equal(historyOnly(paths),false);assert.equal(historyOnly(paths,{historySourceDiff:'unreviewed source changes'}),false);assert.equal(visualKind(paths),'full');
 for(const invalid of [[],paths.slice(1),...['src/main.ts','index.html','src/renderer.ts','src/build-toolbar.ts','server/city-saves/service.mjs'].map(p=>[...paths,p])]){assert.equal(historyPathsOnly(invalid),false);assert.equal(visualKind(invalid),'full');}
});


test('approved lifetime scope requires reviewed client source and excludes reconnect or backend changes',()=>{
 const paths=['src/pages-auth.ts','tests/pages-auth.test.ts'];assert.equal(sessionLifetimePathsOnly(paths),true);assert.equal(sessionLifetimePathsOnly([...paths,'tests/server-save-browser-smoke.mjs']),true);assert.equal(sessionLifetimeOnly(paths),false);assert.equal(visualKind(paths),'full');
 for(const invalid of [[],paths.slice(1),...['src/city-save-auth.ts','src/main.ts','index.html','server/city-saves/service.mjs','.github/workflows/citymanager.yml'].map(p=>[...paths,p])]){assert.equal(sessionLifetimePathsOnly(invalid),false);assert.equal(visualKind(invalid),'full');}
});


test('unified commercial route requires exact reviewed economic source and fails closed for mixed changes',()=>{
 const paths=['src/sim.ts','src/agriculture-validation.ts','src/main.ts','src/commercial-visuals.ts','tests/commercial-accounting.test.ts','tests/server-save-browser-smoke.mjs'];
 assert.equal(commercialPathsOnly(paths),true);assert.equal(commercialOnly(paths),false);assert.equal(commercialOnly(paths,{commercialSourceDiff:'unreviewed economics'}),false);assert.equal(visualKind(paths),'full');
 for(const invalid of [[],paths.slice(1),...['src/city-save-auth.ts','src/pages-auth.ts','index.html','src/build-toolbar.ts','server/city-saves/service.mjs','package.json','src/unknown.ts'].map(p=>[...paths,p])]){assert.equal(commercialPathsOnly(invalid),false);assert.equal(visualKind(invalid),'full');}
});


test('rail scope requires exact reviewed runtime diff and rejects unrelated allocation, auth and backend edits',()=>{
 const paths=['src/sim.ts','src/park-runtime.ts','src/main.ts','src/rail/network-runtime.ts','tests/rail-activation.test.ts','tests/rail-browser-checks.mjs'];
 assert.equal(railPathsOnly(paths),true);assert.equal(railOnly(paths),false);assert.equal(railOnly(paths,{railSourceDiff:'unreviewed'}),false);assert.equal(visualKind(paths),'full');
 for(const invalid of [[],paths.slice(1),...['src/traffic/game.ts','src/pages-auth.ts','src/city-save-auth.ts','server/city-saves/service.mjs','index.html','src/commercial-visuals.ts','package.json'].map(p=>[...paths,p])]){assert.equal(railPathsOnly(invalid),false);assert.equal(visualKind(invalid),'full');}
});

import {trafficGapPathsOnly,trafficGapOnly} from '../scripts/ci-visual-scope.mjs';
test('bumper-gap route requires exact reviewed physics and rejects mixed save or transport edits',()=>{
 const paths=['src/traffic/spacing.ts','src/traffic/game.ts','src/traffic/game-poses.ts','tests/traffic-spacing.test.ts','tests/traffic-gap-browser-checks.mjs'];
 assert.equal(trafficGapPathsOnly(paths),true);assert.equal(trafficGapOnly(paths),false);assert.equal(trafficGapOnly(paths,{trafficGapSourceDiff:'unreviewed'}),false);assert.equal(visualKind(paths),'full');
 for(const invalid of [[],paths.slice(1),...['src/main.ts','src/sim.ts','src/pages-auth.ts','src/bus/engine.ts','src/rail/network-runtime.ts','src/save-storage.ts','src/server-city-save.ts','server/city-saves/service.mjs','package.json'].map(p=>[...paths,p])]){assert.equal(trafficGapPathsOnly(invalid),false);assert.equal(visualKind(invalid),'full');}
});
