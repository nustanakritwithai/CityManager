// A narrow visual-only route; unknown events/ranges/paths retain the full suite.
import { execFileSync } from 'node:child_process';
import { readFileSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const visualSources = ['src/asset-models.ts', 'src/building-visuals.ts', 'src/renderer.ts', 'src/scene-atmosphere.ts'];
const allowed = new Set([...visualSources,
  'tests/asset-models-runtime.test.ts', 'tests/building-visuals.test.ts',
  '.github/workflows/citymanager.yml', '.github/workflows/player-feedback.yml',
  'scripts/ci-visual-scope.mjs', 'tests/ci-visual-scope.test.mjs',
  'tests/luxury-tower-smoke.mjs', 'tests/luxury-tower-preview.html',
  'tests/luxury-tower-preview.ts', 'vite.luxury-tower.config.ts',
]);
export function towerOnly(paths) {
  return paths.length > 0 && paths.some(p => visualSources.includes(p)) && paths.every(p => allowed.has(p));
}
const factoryAllowed = new Set([
  'src/factory-visuals.ts', 'src/renderer.ts', 'tests/factory-visuals.test.ts',
  'tests/factory-preview.ts', 'tests/factory-preview.html', 'tests/factory-smoke.mjs', 'vite.factory.config.ts',
  '.github/workflows/citymanager.yml', '.github/workflows/player-feedback.yml',
  'scripts/ci-visual-scope.mjs', 'tests/ci-visual-scope.test.mjs',
]);
const vehicleAllowed = new Set([
  'src/vehicle-geometry.ts', 'src/vehicle-lighting.ts', 'src/scene-citizen-vehicles.ts',
  'src/scene-traffic.ts', 'src/scene-atmosphere.ts', 'src/taxi/scene-vehicles.ts',
  'tests/vehicle-visuals.test.ts', 'tests/vehicle-preview.ts', 'tests/vehicle-preview.html',
  'tests/vehicle-smoke.mjs', 'tests/vehicle-baseline.ts', 'vite.vehicle.config.ts',
  '.github/workflows/citymanager.yml', '.github/workflows/player-feedback.yml', '.github/workflows/traffic-enabled.yml',
  'scripts/ci-visual-scope.mjs', 'tests/ci-visual-scope.test.mjs',
]);
const finalAllowed = new Set([
  'src/apartment-visuals.ts','src/asset-models.ts','src/building-visuals.ts','src/renderer.ts',
  'src/build-toolbar.ts','src/build-toolbar.css','src/grouped-tool-menu.ts','src/select-menu.ts','src/ui-icons.ts','src/main.ts',
  'tests/apartment-preview.ts','tests/apartment-preview.html','tests/apartment-visuals.test.ts','vite.apartment.config.ts',
  'tests/asset-models-runtime.test.ts','tests/building-visuals.test.ts','tests/luxury-tower-smoke.mjs',
  'tests/build-toolbar.test.ts','tests/grouped-tool-menu.test.ts','tests/select-menu.test.ts',
  'tests/visual-final-smoke.mjs','tests/visual-final-toolbar.mjs',
  'scripts/ci-visual-scope.mjs','tests/ci-visual-scope.test.mjs',
  '.github/workflows/citymanager.yml','.github/workflows/player-feedback.yml','.github/workflows/traffic-enabled.yml',
  '.github/workflows/entity-explanation.yml','.github/workflows/owner-decisions.yml','.github/workflows/save-safety.yml',
]);
// Path allowlisting alone is insufficient for main.ts: permit exactly the five toolbar edits.
export function toolbarMainOnly(before, after) {
  if (typeof before !== 'string' || typeof after !== 'string') return false;
  const edits = [
    ["import './player-feedback.css';", "import './player-feedback.css';\nimport './build-toolbar.css';"],
    ['installHudIcons(); installKeycaps(); installSheetHandle', 'installHudIcons(); installKeycaps(); installBuildToolbar(); installSheetHandle'],
    ["if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || document.querySelector('dialog[open]')) return;", "if (blocksGameShortcuts(e) || document.querySelector('dialog[open]')) return;"],
    ["const shortcuts: Record<string, string> = { v: 'select', r: 'road', '1': 'R', '2': 'C', '3': 'I', '4': 'F', '5': 'power', '6': 'water', '7': 'park', b: 'bulldoze', p: 'select' };", 'const shortcuts = BUILD_SHORTCUTS;'],
  ];
  let expected = before.replace(/\r\n/g,'\n');
  for (const [from,to] of edits) { if (expected.split(from).length !== 2) return false; expected = expected.replace(from,to); }
  expected = "import { installBuildToolbar, BUILD_SHORTCUTS, blocksGameShortcuts } from './build-toolbar.ts';\n" + expected;
  return expected === after.replace(/\r\n/g,'\n');
}
const serverSaveAllowed = new Set(['tests/visual-final-toolbar.mjs','.github/workflows/citymanager.yml', '.github/workflows/save-safety.yml', '.github/workflows/save-smoke.yml', 'docs/server-only-city-entry.md', 'index.html', 'server/city-saves/service.mjs', 'src/city-migration-inventory.ts', 'src/city-save-auth.ts', 'src/main.ts', 'src/server-city-entry.ts', 'src/server-city-save.ts', 'tests/city-migration-inventory.test.ts', 'tests/fixtures/pages-login/existing-login-20261031.html', 'tests/pages-login-public-contract.test.mjs', 'tests/server-city-entry-flow.test.ts', 'tests/server-city-entry.test.ts', 'tests/server-city-save.test.ts', 'tests/server-save-browser-smoke.mjs', 'tests/server-save-live-readonly.mjs', 'scripts/ci-visual-scope.mjs', 'tests/ci-visual-scope.test.mjs', 'docs/server-save-ci-migration.md', '.github/workflows/entity-explanation.yml', '.github/workflows/owner-decisions.yml', '.github/workflows/player-feedback.yml', '.github/workflows/traffic-enabled.yml']);
// One reviewed server-only startup transition. Broad main/index paths cannot admit unrelated edits.
export function matchesReviewedSources(evidence, hashes) {
  return Object.entries(hashes).every(([key,hash])=>typeof evidence[key]==='string' && createHash('sha256').update(evidence[key].replace(/\r\n/g,'\n')).digest('hex')===hash);
}
export function serverSaveEntryOnly(evidence = {}) {
  const hashes = {'mainBefore': '0ca81c4354234b06539e0c42df80ffa692e0770938b0a8b40d72f84ad6a80123', 'mainAfter': 'bac1b8b3f976597e7ab5c014c13fb917d0e8e0329658c967c0bbfdc113f1f20a', 'indexBefore': '272e1d25d1578187de2d14514de2fadaeb7227edd871da858226e19aa247ae57', 'indexAfter': 'ab8849cf8e4804dfe2063b3cf56f6f64f1c794805d53b82ad0a674e62ac48209'};
  return matchesReviewedSources(evidence,hashes);
}
// Separate reviewed management transition; deployment installer files are intentionally excluded.
const managementAllowed=new Set(['src/fresh-server-city.ts','src/save-management-dialog.ts','src/main.ts','index.html','src/server-city-entry.ts','src/server-city-save.ts','server/city-saves/service.mjs','tests/fresh-server-city.test.ts','tests/save-management-dialog.test.ts','tests/server-city-entry-flow.test.ts','tests/server-city-save.test.ts','tests/server-save-browser-smoke.mjs','docs/server-only-city-entry.md','scripts/ci-visual-scope.mjs','tests/ci-visual-scope.test.mjs','.github/workflows/citymanager.yml','docs/server-save-ci-migration.md']);
export function managementPathsOnly(paths){
 return ['src/fresh-server-city.ts','src/save-management-dialog.ts','src/main.ts','index.html','src/server-city-save.ts','src/server-city-entry.ts','server/city-saves/service.mjs'].every(p=>paths.includes(p))&&paths.every(p=>managementAllowed.has(p));
}
export function serverSaveManagementOnly(evidence={}){
 const hashes={"mainBefore": "bac1b8b3f976597e7ab5c014c13fb917d0e8e0329658c967c0bbfdc113f1f20a", "mainAfter": "eb537a7892772e8805fc0c3bba5e2e47af1713cb9564b857d23ed5cb43441e04", "indexBefore": "ab8849cf8e4804dfe2063b3cf56f6f64f1c794805d53b82ad0a674e62ac48209", "indexAfter": "c1ab9b7591a0a793c791369eae4c724d4d6386547abf41f1a9cde0822d7d80e5"};
 return matchesReviewedSources(evidence,hashes);
}
// UI-only conflict feedback: no index/backend/entry/auth changes are admitted.
const conflictFeedbackAllowed=new Set(['src/main.ts','src/server-city-save.ts','src/save-management-dialog.ts','tests/server-city-save.test.ts','tests/save-management-dialog.test.ts','tests/server-save-browser-smoke.mjs','scripts/ci-visual-scope.mjs','tests/ci-visual-scope.test.mjs']);
export function conflictFeedbackPathsOnly(paths){
 return ['src/main.ts','src/server-city-save.ts','src/save-management-dialog.ts','tests/server-city-save.test.ts','tests/save-management-dialog.test.ts'].every(p=>paths.includes(p))&&paths.every(p=>conflictFeedbackAllowed.has(p));
}
export function serverSaveConflictFeedbackOnly(evidence={}){
 const hashes={"mainBefore": "eb537a7892772e8805fc0c3bba5e2e47af1713cb9564b857d23ed5cb43441e04", "mainAfter": "da3e8ec81343cdf3a66e60748ee2686122c70b8b16700b6382f144c9b2265f49", "indexBefore": "c1ab9b7591a0a793c791369eae4c724d4d6386547abf41f1a9cde0822d7d80e5", "indexAfter": "c1ab9b7591a0a793c791369eae4c724d4d6386547abf41f1a9cde0822d7d80e5"};
 return matchesReviewedSources(evidence,hashes);
}
// Cosmetic rollback plus exactly reviewed main save-label text; no save logic/backend/entry edits admitted.
const classicToolbarHashes={"mainBefore": "da3e8ec81343cdf3a66e60748ee2686122c70b8b16700b6382f144c9b2265f49", "mainAfter": "13405cff0e4f0d576ba0c6eae7eebe674098877c744df780c4aa09593e6f9e7a", "indexBefore": "c1ab9b7591a0a793c791369eae4c724d4d6386547abf41f1a9cde0822d7d80e5", "indexAfter": "c1ab9b7591a0a793c791369eae4c724d4d6386547abf41f1a9cde0822d7d80e5"};
const classicToolbarAllowed=new Set(['src/main.ts','src/build-toolbar.ts','src/build-toolbar.css','src/select-menu.ts','src/grouped-tool-menu.ts','tests/build-toolbar.test.ts','tests/select-menu.test.ts','tests/grouped-tool-menu.test.ts','tests/visual-final-toolbar.mjs','tests/server-save-browser-smoke.mjs','scripts/ci-visual-scope.mjs','tests/ci-visual-scope.test.mjs','.github/workflows/citymanager.yml','.github/workflows/entity-explanation.yml','.github/workflows/owner-decisions.yml','.github/workflows/player-feedback.yml','.github/workflows/traffic-enabled.yml']);
export function classicToolbarPathsOnly(paths){
 return ['src/main.ts','src/build-toolbar.ts','src/build-toolbar.css','tests/build-toolbar.test.ts','tests/visual-final-toolbar.mjs'].every(p=>paths.includes(p))&&paths.every(p=>classicToolbarAllowed.has(p));
}
export function classicToolbarOnly(paths,evidence={}){return classicToolbarPathsOnly(paths)&&matchesReviewedSources(evidence,classicToolbarHashes);}
// Reviewed bounded-history/ACK-only transition; broad runtime paths require exact source-diff content.
export const historySources=["src/save-storage.ts", "src/agriculture-runtime.ts", "src/agriculture-validation.ts", "src/audio-cues.ts", "src/building-issues.ts", "src/chart-modal.ts", "src/city-goals.ts", "src/city-history-types.ts", "src/city-history-validation.ts", "src/city-history.ts", "src/city-network.ts", "src/city-save-auth.ts", "src/city-series.ts", "src/context-data.ts", "src/goods-validation.ts", "src/market-client.ts", "src/owner-profit.ts", "src/park-runtime.ts", "src/server-city-entry.ts", "src/server-city-save.ts", "src/server-save-size.ts", "src/sim.ts", "src/submenus.ts"];
const historyAllowed=new Set(["src/save-storage.ts", "tests/save-quota-lossless.test.ts", "docs/city-history-retention.md", "src/agriculture-runtime.ts", "src/agriculture-validation.ts", "src/audio-cues.ts", "src/building-issues.ts", "src/chart-modal.ts", "src/city-goals.ts", "src/city-history-types.ts", "src/city-history-validation.ts", "src/city-history.ts", "src/city-network.ts", "src/city-save-auth.ts", "src/city-series.ts", "src/context-data.ts", "src/goods-validation.ts", "src/market-client.ts", "src/owner-profit.ts", "src/park-runtime.ts", "src/server-city-entry.ts", "src/server-city-save.ts", "src/server-save-size.ts", "src/sim.ts", "src/submenus.ts", "tests/agriculture-validation.test.ts", "tests/city-history.test.ts", "tests/city-series.test.ts", "tests/factory-takeover-input.test.ts", "tests/farm-levels.test.ts", "tests/goods.test.ts", "tests/history-fixture.ts", "tests/history-validators.test.ts", "tests/month-end-review-scope.test.ts", "tests/owner-profit.test.ts", "tests/retail-shops.test.ts", "tests/server-city-entry-flow.test.ts", "tests/server-city-entry.test.ts", "tests/server-save-browser-smoke.mjs", "scripts/ci-visual-scope.mjs", "tests/ci-visual-scope.test.mjs", ".github/workflows/citymanager.yml", ".github/workflows/entity-explanation.yml", ".github/workflows/owner-decisions.yml", ".github/workflows/player-feedback.yml", ".github/workflows/traffic-enabled.yml"]);
export function historyPathsOnly(paths){return ['src/city-history.ts','src/city-history-validation.ts','src/sim.ts','src/server-city-entry.ts','src/city-save-auth.ts','tests/city-history.test.ts','tests/history-validators.test.ts','tests/server-save-browser-smoke.mjs'].every(p=>paths.includes(p))&&paths.every(p=>historyAllowed.has(p));}
export function historyOnly(paths,evidence={}){return historyPathsOnly(paths)&&matchesReviewedSources(evidence,{historySourceDiff:"326578432215a15f27f08da7833feb888ffeb8be260dc37080a67b87347def5c"});}
// Explicitly approved lifetime cap only; exact reviewed client source, no retry-auth/backend edits.
const sessionLifetimeAllowed=new Set(['src/pages-auth.ts','tests/pages-auth.test.ts','tests/server-save-browser-smoke.mjs','scripts/ci-visual-scope.mjs','tests/ci-visual-scope.test.mjs']);
export function sessionLifetimePathsOnly(paths){return ['src/pages-auth.ts','tests/pages-auth.test.ts'].every(p=>paths.includes(p))&&paths.every(p=>sessionLifetimeAllowed.has(p));}
export function sessionLifetimeOnly(paths,evidence={}){return sessionLifetimePathsOnly(paths)&&matchesReviewedSources(evidence,{"pagesBefore": "0c95f6f29b1ba57fde0e9cb9a72ae85f588d5e9fdb271fca37ed14be2a569008", "pagesAfter": "314dfae189a4c5a0de74bd4f585dca4c5fdbf2bc184680ea67edd8fab58d7c0e"});}
// Reviewed unified commerce transition, including economic and save contracts; never a visual-only exemption.
export const commercialSources=["src/agriculture-runtime.ts", "src/agriculture-validation.ts", "src/audio-cues.ts", "src/building-card-data.ts", "src/building-issues.ts", "src/city-goals.ts", "src/city-network-view.ts", "src/city-network.ts", "src/city-questions.ts", "src/city-series.ts", "src/city-stats.ts", "src/commercial-visuals.ts", "src/context-panels.ts", "src/entity-explanation-data.ts", "src/entry-gate.ts", "src/goods-view.ts", "src/main.ts", "src/market-client.ts", "src/minimap.ts", "src/overview-data.ts", "src/overview-panels.ts", "src/owner-decision-panel.ts", "src/owner-decision-session.ts", "src/owner-decision.ts", "src/park-runtime.ts", "src/renderer.ts", "src/retail-capacity.ts", "src/save-storage.ts", "src/sim.ts", "src/traffic/snapshot.ts", "src/workforce-summary.ts"];
const commercialAllowed=new Set(["tests/commercial-screenshot-readback.mjs", "tests/commercial-screenshot-readback.test.mjs", "tests/traffic-workflow-partition.test.mjs", ".github/workflows/city-questions.yml", ".github/workflows/citymanager.yml", ".github/workflows/entity-explanation.yml", ".github/workflows/owner-decisions.yml", ".github/workflows/player-feedback.yml", ".github/workflows/signal-reading.yml", ".github/workflows/traffic-enabled.yml", "docs/commercial-ci-scope.md", "scripts/ci-visual-scope.mjs", "scripts/owner-decision-benchmark.mjs", "src/agriculture-runtime.ts", "src/agriculture-validation.ts", "src/audio-cues.ts", "src/building-card-data.ts", "src/building-issues.ts", "src/city-goals.ts", "src/city-network-view.ts", "src/city-network.ts", "src/city-questions.ts", "src/city-series.ts", "src/city-stats.ts", "src/commercial-visuals.ts", "src/context-panels.ts", "src/entity-explanation-data.ts", "src/entry-gate.ts", "src/goods-view.ts", "src/main.ts", "src/market-client.ts", "src/minimap.ts", "src/overview-data.ts", "src/overview-panels.ts", "src/owner-decision-panel.ts", "src/owner-decision-session.ts", "src/owner-decision.ts", "src/park-runtime.ts", "src/renderer.ts", "src/retail-capacity.ts", "src/save-storage.ts", "src/sim.ts", "src/traffic/snapshot.ts", "src/workforce-summary.ts", "tests/agriculture-validation.test.ts", "tests/building-card-data.test.ts", "tests/business-capacity-fixture.ts", "tests/business-capacity.test.ts", "tests/ci-visual-scope.test.mjs", "tests/city-questions-smoke.mjs", "tests/city-questions.test.ts", "tests/commercial-accounting.test.ts", "tests/commercial-display-data.test.ts", "tests/commercial-market-envelope.test.ts", "tests/commercial-migration.test.ts", "tests/commercial-panels.test.ts", "tests/commercial-preview.html", "tests/commercial-preview.ts", "tests/commercial-progression.test.ts", "tests/commercial-smoke.mjs", "tests/commercial-visuals.test.ts", "tests/education-session.test.ts", "tests/entity-explanation-data.test.ts", "tests/fixtures/business-capacity-v22.json", "tests/fixtures/business-capacity-v23.json", "tests/goods.test.ts", "tests/growth.test.ts", "tests/market-client.test.ts", "tests/market-safety.test.ts", "tests/owner-decision-client.test.ts", "tests/owner-decision-e2e.test.ts", "tests/owner-decision-fixture.ts", "tests/owner-decision-session.test.ts", "tests/owner-decision.test.ts", "tests/owner-profit.test.ts", "tests/panel-server-entry-fixture.mjs", "tests/panel-server-entry-fixture.test.mjs", "tests/save-quota-lossless.test.ts", "tests/save-recovery-info.test.ts", "tests/server-save-browser-smoke.mjs", "tests/signal-reading-smoke.mjs", "tests/untyped.ts", "tests/workforce-summary.test.ts", "vite.commercial.config.ts"]);
export function commercialPathsOnly(paths){return ['src/sim.ts','src/agriculture-validation.ts','src/main.ts','src/commercial-visuals.ts','tests/commercial-accounting.test.ts','tests/server-save-browser-smoke.mjs'].every(p=>paths.includes(p))&&paths.every(p=>commercialAllowed.has(p));}
export function commercialOnly(paths,evidence={}){return commercialPathsOnly(paths)&&matchesReviewedSources(evidence,{commercialSourceDiff:"bad0c553762b8be2383ae6faf30df0d17e59c35c4a3efce4ddc7fc675dd25af7"});}
export function visualKind(paths, evidence = {}) {
  if(commercialOnly(paths,evidence))return 'commercial';
  if(sessionLifetimeOnly(paths,evidence))return 'server-save';
  if(historyOnly(paths,evidence))return 'history';
  if(classicToolbarOnly(paths,evidence))return 'classic-toolbar';
  if(conflictFeedbackPathsOnly(paths)&&serverSaveConflictFeedbackOnly(evidence))return 'server-save';
  if(managementPathsOnly(paths)&&serverSaveManagementOnly(evidence))return 'server-save';
  if (['src/server-city-save.ts','src/server-city-entry.ts','src/city-save-auth.ts','src/main.ts','index.html'].every(p=>paths.includes(p)) && paths.every(p=>serverSaveAllowed.has(p)) && serverSaveEntryOnly(evidence)) return 'server-save';
  if (['src/apartment-visuals.ts','src/build-toolbar.ts','src/main.ts'].every(p=>paths.includes(p)) && paths.every(p=>finalAllowed.has(p)) && toolbarMainOnly(evidence.mainBefore,evidence.mainAfter)) return 'visual-final';
  if (paths.includes('src/vehicle-geometry.ts') && paths.every(p => vehicleAllowed.has(p))) return 'vehicle';
  if (paths.includes('src/factory-visuals.ts') && paths.every(p => factoryAllowed.has(p))) return 'factory';
  return towerOnly(paths) ? 'tower' : 'full';
}
export function changedRange(eventName, event, git) {
  const sha = /^[0-9a-f]{40}$/;
  let base, head;
  if (eventName === 'pull_request') {
    const pr = event.pull_request;
    if (!sha.test(pr?.base?.sha ?? '') || !sha.test(pr?.head?.sha ?? '')) throw Error('Missing PR range');
    head = pr.head.sha;
    base = git(['merge-base', pr.base.sha, head]).trim();
  } else if (eventName === 'push') {
    base = event.before; head = event.after;
  } else throw Error('Full suite for manual or unknown events');
  if (!sha.test(base ?? '') || !sha.test(head ?? '') || /^0+$/.test(base) || /^0+$/.test(head)) throw Error('Invalid comparison range');
  if (git(['rev-parse', 'HEAD']).trim() !== head) throw Error('Checked-out SHA differs from event head');
  return {base,head};
}
export function changedPaths(eventName,event,git) {
  const {base,head}=changedRange(eventName,event,git);
  // --no-renames ensures both sides of a rename participate in the allowlist.
  return git(['diff', '--name-only', '--no-renames', '-z', base, head]).split('\0').filter(Boolean);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let selected = 'full';
  try {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    const git = args => execFileSync('git', args, { encoding: 'utf8' });
    const paths = changedPaths(process.env.GITHUB_EVENT_NAME, event, git);
    const evidence = {};
    if(sessionLifetimePathsOnly(paths)){const {base,head}=changedRange(process.env.GITHUB_EVENT_NAME,event,git);evidence.pagesBefore=git(['show',`${base}:src/pages-auth.ts`]);evidence.pagesAfter=git(['show',`${head}:src/pages-auth.ts`]);}
    if(commercialPathsOnly(paths)){const {base,head}=changedRange(process.env.GITHUB_EVENT_NAME,event,git);evidence.commercialSourceDiff=git(["diff", "--no-ext-diff", "--no-renames", "--binary", "--full-index", "--no-color", "--src-prefix=a/", "--dst-prefix=b/", "--diff-algorithm=myers", "--no-indent-heuristic",base,head,'--',...commercialSources]);}
    if(historyPathsOnly(paths)){const {base,head}=changedRange(process.env.GITHUB_EVENT_NAME,event,git);evidence.historySourceDiff=git(["diff", "--no-ext-diff", "--no-renames", "--binary", "--full-index", "--no-color", "--src-prefix=a/", "--dst-prefix=b/", "--diff-algorithm=myers", "--no-indent-heuristic",base,head,'--',...historySources]);}
    if (paths.includes('src/main.ts')) {
      const {base,head}=changedRange(process.env.GITHUB_EVENT_NAME,event,git);
      evidence.mainBefore=git(['show',`${base}:src/main.ts`]); evidence.mainAfter=git(['show',`${head}:src/main.ts`]);
      // Also prove unchanged index content for reviewed UI-only main transitions.
      evidence.indexBefore=git(['show',`${base}:index.html`]); evidence.indexAfter=git(['show',`${head}:index.html`]);
    }
    selected = visualKind(paths,evidence);
    console.log(`Changed paths: ${JSON.stringify(paths)}`);
  } catch (error) { console.log(`Full-suite fallback: ${error.message}`); }
  console.log(`Visual check route: ${selected}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `kind=${selected}\ntower_only=${selected === 'tower'}\n`);
}
