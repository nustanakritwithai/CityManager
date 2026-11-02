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
// Exact reviewed rail activation, with runtime/save coverage; no road allocation or auth changes.
export const railSources=["src/bus/placement.ts", "src/main.ts", "src/park-runtime.ts", "src/rail/demand-contract.ts", "src/rail/durable-city.ts", "src/rail/management.css", "src/rail/management.ts", "src/rail/network-runtime.ts", "src/rail/offer-adapter.ts", "src/rail/passenger.ts", "src/rail/presentation.ts", "src/rail/reserved-parcels.ts", "src/rail/scene.ts", "src/rail/snapshot-digest.ts", "src/rail/state-validation.ts", "src/rail/track-geometry.ts", "src/sim.ts", "src/taxi/placement.ts"];
const railAllowed=new Set([".github/workflows/citymanager.yml", ".github/workflows/entity-explanation.yml", ".github/workflows/owner-decisions.yml", ".github/workflows/player-feedback.yml", ".github/workflows/traffic-enabled.yml", "docs/RAIL-ACTIVATION-V1.md", "docs/rail-ci-scope.md", "scripts/ci-visual-scope.mjs", "src/bus/placement.ts", "src/main.ts", "src/park-runtime.ts", "src/rail/demand-contract.ts", "src/rail/durable-city.ts", "src/rail/management.css", "src/rail/management.ts", "src/rail/network-runtime.ts", "src/rail/offer-adapter.ts", "src/rail/passenger.ts", "src/rail/presentation.ts", "src/rail/reserved-parcels.ts", "src/rail/scene.ts", "src/rail/snapshot-digest.ts", "src/rail/state-validation.ts", "src/rail/track-geometry.ts", "src/sim.ts", "src/taxi/placement.ts", "tests/ci-visual-scope.test.mjs", "tests/rail-activation.test.ts", "tests/rail-browser-checks.mjs", "tests/rail-digest.test.ts", "tests/rail-durable-city.test.ts", "tests/rail-management.test.ts", "tests/rail-network-session.test.ts", "tests/rail-passenger.test.ts", "tests/rail-taxi-parcels.test.ts", "tests/rail-track-geometry.test.ts", "tests/server-save-browser-smoke.mjs", "tests/traffic-workflow-partition.test.mjs"]);
export function railPathsOnly(paths){return ['src/sim.ts','src/park-runtime.ts','src/main.ts','src/rail/network-runtime.ts','tests/rail-activation.test.ts','tests/rail-browser-checks.mjs'].every(p=>paths.includes(p))&&paths.every(p=>railAllowed.has(p));}
export function railOnly(paths,evidence={}){return railPathsOnly(paths)&&matchesReviewedSources(evidence,{railSourceDiff:"0a14c5e6aa061bd84b8c87ccdebc4a2755eb8f40ebf141194722dab7e9744bae"});}
// Reviewed bumper-gap physics only; any source drift or mixed feature retains full CI.
export const trafficGapSources=["src/traffic/game-worker-client.ts", "src/citizen-road-queue.ts", "src/citizen-vehicle-poses.ts", "src/scene-traffic.ts", "src/traffic/fleet.ts", "src/traffic/game-poses.ts", "src/traffic/game.ts", "src/traffic/layer.ts", "src/traffic/spacing.ts", "src/traffic/presentation.ts"];
const trafficGapAllowed=new Set(["src/traffic/game-worker-client.ts", "tests/traffic-game-worker-client.test.ts", "tests/traffic-gap-fixture.ts", "docs/TRAFFIC-GAP-PHYSICS.md", "tests/traffic-game-smoke.mjs", "src/traffic/presentation.ts", "tests/traffic-presentation.test.ts", "tests/traffic-gap-browser-checks.test.mjs", "src/citizen-road-queue.ts", "src/citizen-vehicle-poses.ts", "src/scene-traffic.ts", "src/traffic/fleet.ts", "src/traffic/game-poses.ts", "src/traffic/game.ts", "src/traffic/layer.ts", "src/traffic/spacing.ts", "tests/traffic-spacing.test.ts", "tests/traffic-fleet.test.ts", "tests/traffic-game-poses.test.ts", "tests/traffic-game.test.ts", "tests/citizen-vehicle-poses.test.ts", "tests/traffic-autosave-boundary.test.ts", "tests/traffic-gap-browser-checks.mjs", "tests/server-save-browser-smoke.mjs", "tests/traffic-workflow-partition.test.mjs", "scripts/ci-visual-scope.mjs", "tests/ci-visual-scope.test.mjs", "docs/traffic-gap-ci-scope.md", ".github/workflows/citymanager.yml", ".github/workflows/traffic-enabled.yml", ".github/workflows/player-feedback.yml", ".github/workflows/entity-explanation.yml", ".github/workflows/owner-decisions.yml"]);
export function trafficGapPathsOnly(paths){return ['src/traffic/spacing.ts','src/traffic/game.ts','src/traffic/game-poses.ts','tests/traffic-spacing.test.ts','tests/traffic-gap-browser-checks.mjs'].every(p=>paths.includes(p))&&paths.every(p=>trafficGapAllowed.has(p));}
export function trafficGapOnly(paths,evidence={}){return trafficGapPathsOnly(paths)&&matchesReviewedSources(evidence,{trafficGapSourceDiff:'23263d7d16fbf2dd79640c11c207414e59ef0a6e90acb194088d4374c0298e7f'});}
// Exact bus movement authority/junction fairness transition; no general bus path exemption.
export const adaptiveSignalSources=["src/main.ts", "src/scene-traffic-signals.ts", "src/traffic/adaptive-signals.ts", "src/traffic/game.ts", "src/traffic/layer.ts", "src/traffic/signal-coordination.ts", "src/traffic/signal-display.ts", "src/traffic/signal-peers.ts"];
const adaptiveSignalAllowed=new Set(["docs/TRAFFIC-WORKER-CYCLE-PREVENTION.md", "tests/traffic-worker-cycle.test.ts", "tests/traffic-worker-cycle-presentation.test.ts", ".github/workflows/citymanager.yml", ".github/workflows/traffic-enabled.yml", "docs/ADAPTIVE-TRAFFIC-SIGNALS.md", "scripts/ci-visual-scope.mjs", "scripts/traffic-adaptive-calibration.mjs", "scripts/traffic-signal-coordination-calibration.mjs", "src/main.ts", "src/scene-traffic-signals.ts", "src/traffic/adaptive-signals.ts", "src/traffic/game.ts", "src/traffic/layer.ts", "src/traffic/signal-coordination.ts", "src/traffic/signal-display.ts", "src/traffic/signal-peers.ts", "tests/ci-visual-scope.test.mjs", "tests/server-save-browser-smoke.mjs", "tests/traffic-adaptive-signals.test.ts", "tests/traffic-game.test.ts", "tests/traffic-gap-browser-checks.mjs", "tests/traffic-signal-browser-checks.mjs", "tests/traffic-signal-browser-checks.test.mjs", "tests/traffic-signal-coordination.test.ts", "tests/traffic-signal-display.test.ts", "tests/traffic-signal-lifecycle.test.ts", "tests/traffic-signal-peers.test.ts", "tests/traffic-workflow-partition.test.mjs"]);
export function adaptiveSignalPathsOnly(paths){return adaptiveSignalSources.concat(['tests/traffic-adaptive-signals.test.ts','tests/traffic-signal-browser-checks.mjs','tests/traffic-worker-cycle.test.ts','tests/traffic-worker-cycle-presentation.test.ts']).every(p=>paths.includes(p))&&paths.every(p=>adaptiveSignalAllowed.has(p));}
export function adaptiveSignalOnly(paths,evidence={}){return adaptiveSignalPathsOnly(paths)&&matchesReviewedSources(evidence,{adaptiveSignalSourceDiff:'f3af4d995db4417c3c78be851a3051efbe169b0585626cdcc6551e6bc6248a9c'});}

export const trafficRrtSources=["src/traffic/game.ts", "src/traffic/rrt-navigation.ts"];
const trafficRrtAllowed=new Set(["docs/TRAFFIC-RRT-NAVIGATION.md", "scripts/traffic-rrt-benchmark.mjs", "src/traffic/game.ts", "src/traffic/rrt-navigation.ts", "tests/traffic-rrt-navigation.test.ts", "scripts/ci-visual-scope.mjs", "tests/ci-visual-scope.test.mjs", "tests/traffic-workflow-partition.test.mjs", ".github/workflows/citymanager.yml", ".github/workflows/traffic-enabled.yml", "tests/traffic-gap-browser-checks.mjs", "tests/traffic-gap-browser-checks.test.mjs"]);
export function trafficRrtPathsOnly(paths){return trafficRrtSources.concat(['tests/traffic-rrt-navigation.test.ts']).every(p=>paths.includes(p))&&paths.every(p=>trafficRrtAllowed.has(p));}
export function trafficRrtOnly(paths,evidence={}){return trafficRrtPathsOnly(paths)&&matchesReviewedSources(evidence,{trafficRrtSourceDiff:"98d968eebc371e0611d4af2c2497eec65965ddb63c01e3d31beb963176842d50"});}

export const rightOfWaySources=["src/bus/draw-list.ts", "src/bus/engine.ts", "src/bus/game-bridge.ts", "src/bus/live.ts", "src/bus/player.ts", "src/citizen-vehicle-poses.ts", "src/traffic/game-poses.ts", "src/traffic/game.ts", "src/traffic/layer.ts", "src/traffic/presentation.ts"];
const rightOfWayAllowed=new Set([".github/workflows/citymanager.yml", ".github/workflows/traffic-enabled.yml", "docs/TRAFFIC-SHARED-RIGHT-OF-WAY.md", "docs/traffic-gap-ci-scope.md", "scripts/ci-visual-scope.mjs", "src/bus/draw-list.ts", "src/bus/engine.ts", "src/bus/game-bridge.ts", "src/bus/live.ts", "src/bus/player.ts", "src/citizen-vehicle-poses.ts", "src/traffic/game-poses.ts", "src/traffic/game.ts", "src/traffic/layer.ts", "src/traffic/presentation.ts", "tests/bus-movement-gate.test.ts", "tests/bus-player.test.ts", "tests/bus-render.test.ts", "tests/ci-visual-scope.test.mjs", "tests/traffic-game-layer.test.ts", "tests/traffic-game-poses.test.ts", "tests/traffic-gap-browser-checks.mjs", "tests/traffic-gap-browser-checks.test.mjs", "tests/traffic-gap-fixture.ts", "tests/traffic-junction-fairness.test.ts", "tests/traffic-presentation.test.ts", "tests/traffic-right-of-way-fixture.ts", "tests/traffic-workflow-partition.test.mjs"]);
export function rightOfWayPathsOnly(paths){return ['src/bus/engine.ts','src/bus/game-bridge.ts','src/traffic/game.ts','src/traffic/presentation.ts','tests/bus-movement-gate.test.ts','tests/traffic-junction-fairness.test.ts','tests/traffic-gap-browser-checks.mjs'].every(p=>paths.includes(p))&&paths.every(p=>rightOfWayAllowed.has(p));}
export function rightOfWayOnly(paths,evidence={}){return rightOfWayPathsOnly(paths)&&matchesReviewedSources(evidence,{rightOfWaySourceDiff:'7ef3d62403caab672b43f02bcfb847f211a2aa7c496a114a4596701662a0c98f'});}
export const hudPolishSources=["src/grouped-tool-menu.css", "src/grouped-tool-menu.ts", "src/hud-icons.ts", "src/hud-row.ts", "src/main.ts", "src/rail/management.ts", "src/tool-menu.css", "src/tool-menu.ts", "src/ui-icons.ts"];
const hudPolishAllowed=new Set([...hudPolishSources, ".github/workflows/citymanager.yml", ".github/workflows/entity-explanation.yml", ".github/workflows/owner-decisions.yml", ".github/workflows/player-feedback.yml", ".github/workflows/traffic-enabled.yml", "docs/hud-polish-ci-scope.md", "scripts/ci-visual-scope.mjs", "tests/ci-visual-scope.test.mjs", "tests/grouped-tool-menu.test.ts", "tests/traffic-workflow-partition.test.mjs"]);
/** Top HUD and build-dock presentation only: no simulation, save, auth or index.html change. */
export function hudPolishPathsOnly(paths){return ['src/main.ts','src/tool-menu.ts','src/grouped-tool-menu.ts','tests/grouped-tool-menu.test.ts'].every(p=>paths.includes(p))&&paths.every(p=>hudPolishAllowed.has(p));}
export function hudPolishOnly(paths,evidence={}){return hudPolishPathsOnly(paths)&&matchesReviewedSources(evidence,{hudPolishSourceDiff:"76c952c53b596155fcf522e9ba3c408dbc08cd3075aa94c87fc38e8a4ff007a2"});}
// PR182: exact reviewed panel/entry transition. Source drift or unrelated paths fall back to full CI.
export const panelPolishSources=['index.html','src/entry-gate.ts','src/main.ts','src/owner-decision-panel.ts','src/panel-polish.css','src/panel-time-controls.ts','src/panels.css','src/rail/management.css','src/save-feedback-panel.ts','src/server-city-entry.ts','src/startup-recovery-chooser.ts','src/style.css'];
const panelPolishAllowed=new Set([...panelPolishSources,'README.md','tests/commercial-market-envelope.test.ts','tests/entry-gate.test.ts','tests/market-session.test.ts','tests/player-feedback-smoke.mjs','tests/owner-decision-smoke.mjs','tests/owner-no-export-contract.test.mjs','tests/server-save-browser-smoke.mjs','tests/pr182-visual-checks.mjs','tests/traffic-workflow-partition.test.mjs','scripts/ci-visual-scope.mjs','tests/ci-visual-scope.test.mjs','.github/workflows/citymanager.yml','.github/workflows/entity-explanation.yml','.github/workflows/owner-decisions.yml','.github/workflows/player-feedback.yml','.github/workflows/traffic-enabled.yml']);
export function panelPolishPathsOnly(paths){return panelPolishSources.every(p=>paths.includes(p))&&paths.every(p=>panelPolishAllowed.has(p));}
// Bind the accepted tests and workflows too; changing an allowlisted assertion cannot silently inherit this exemption.
export const panelGateFiles=['.github/workflows/citymanager.yml','.github/workflows/entity-explanation.yml','.github/workflows/owner-decisions.yml','.github/workflows/player-feedback.yml','.github/workflows/traffic-enabled.yml','tests/commercial-market-envelope.test.ts','tests/entry-gate.test.ts','tests/market-session.test.ts','tests/owner-decision-smoke.mjs','tests/owner-no-export-contract.test.mjs','tests/player-feedback-smoke.mjs','tests/pr182-visual-checks.mjs','tests/server-save-browser-smoke.mjs','tests/traffic-workflow-partition.test.mjs'];
export function panelGateEvidence(read){return JSON.stringify(panelGateFiles.map(p=>{const value=read(p);return [p,typeof value==='string'?value.replace(/\r\n/g,'\n'):value];}));}
const panelPolishHashes={panelPolishSourceDiff:'617bc876aa34341f455a8fd4a6e677b95db7e82bda9767fa5e317670f08f9070',panelGateEvidence:'984222a38b64d059a97a32805bfe45b756d37b07789e2c2a3e7cb68949e917fc'};
export function panelPolishOnly(paths,evidence={}){return panelPolishPathsOnly(paths)&&matchesReviewedSources(evidence,panelPolishHashes);}
// Rail R1: rail manager, confirmation and dock-menu presentation only. No rail runtime, simulation, save or auth change.
export const railPolishSources=['src/main.ts','src/rail/management.css','src/rail/management.ts','src/tool-menu.ts','src/ui-icons.ts'];
const railPolishAllowed=new Set([...railPolishSources,'.github/workflows/citymanager.yml','.github/workflows/entity-explanation.yml','.github/workflows/owner-decisions.yml','.github/workflows/player-feedback.yml','.github/workflows/traffic-enabled.yml','docs/rail-polish-ci-scope.md','scripts/ci-visual-scope.mjs','tests/ci-visual-scope.test.mjs','tests/rail-management.test.ts','tests/traffic-workflow-partition.test.mjs']);
export function railPolishPathsOnly(paths){return ['src/rail/management.ts','src/rail/management.css','tests/rail-management.test.ts'].every(p=>paths.includes(p))&&paths.every(p=>railPolishAllowed.has(p));}
export function railPolishOnly(paths,evidence={}){return railPolishPathsOnly(paths)&&matchesReviewedSources(evidence,{railPolishSourceDiff:'0770e688a56be402aded8a3b8b4fca803da1fc5b762be196f7fba1e7e4590b3b'});}
// Rail R2: station, train and track 3D presentation only. Same three batched track meshes; no runtime, save or UI change.
export const railSceneSources=['src/rail/scene.ts','src/rail/track-geometry.ts'];
const railSceneAllowed=new Set([...railSceneSources,'.github/workflows/citymanager.yml','.github/workflows/entity-explanation.yml','.github/workflows/owner-decisions.yml','.github/workflows/player-feedback.yml','.github/workflows/traffic-enabled.yml','docs/rail-scene-ci-scope.md','scripts/ci-visual-scope.mjs','tests/ci-visual-scope.test.mjs','tests/rail-track-geometry.test.ts','tests/traffic-workflow-partition.test.mjs']);
export function railScenePathsOnly(paths){return [...railSceneSources,'tests/rail-track-geometry.test.ts'].every(p=>paths.includes(p))&&paths.every(p=>railSceneAllowed.has(p));}
export function railSceneOnly(paths,evidence={}){return railScenePathsOnly(paths)&&matchesReviewedSources(evidence,{railSceneSourceDiff:'ecf0a95a4f84b16e26f7a5ee98a18be737fa96a84dcb3055b8b5dc7ffbf2aecf'});}
// Rail R3: railway on the minimap and the city map (published by the rail manager). No runtime, save or 3D change.
export const railMapSources=['src/minimap.css','src/minimap.ts','src/rail/management.ts','src/rail/map-paint.ts','src/rail/map-state.ts'];
const railMapAllowed=new Set([...railMapSources,'.github/workflows/citymanager.yml','.github/workflows/entity-explanation.yml','.github/workflows/owner-decisions.yml','.github/workflows/player-feedback.yml','.github/workflows/traffic-enabled.yml','docs/rail-map-ci-scope.md','scripts/ci-visual-scope.mjs','tests/ci-visual-scope.test.mjs','tests/rail-map.test.ts','tests/traffic-workflow-partition.test.mjs']);
export function railMapPathsOnly(paths){return ['src/rail/map-paint.ts','src/rail/map-state.ts','tests/rail-map.test.ts'].every(p=>paths.includes(p))&&paths.every(p=>railMapAllowed.has(p));}
export function railMapOnly(paths,evidence={}){return railMapPathsOnly(paths)&&matchesReviewedSources(evidence,{railMapSourceDiff:'809a0d811e1b824d245adceecf80aa27f9d34c1be69c5eea2897ac759a4ee9d8'});}
// Bus B1: bus dock menu, line panel, composer and place card presentation only. No bus engine, save or auth change.
export const busPolishSources=['src/bus/menu.ts','src/bus/mount.ts','src/bus/panel.ts','src/bus/player.css','src/main.ts','src/ui-icons.ts'];
const busPolishAllowed=new Set([...busPolishSources,'.github/workflows/citymanager.yml','.github/workflows/entity-explanation.yml','.github/workflows/owner-decisions.yml','.github/workflows/player-feedback.yml','.github/workflows/traffic-enabled.yml','docs/bus-polish-ci-scope.md','scripts/ci-visual-scope.mjs','tests/ci-visual-scope.test.mjs','tests/traffic-workflow-partition.test.mjs']);
export function busPolishPathsOnly(paths){return ['src/bus/menu.ts','src/bus/panel.ts','src/bus/player.css'].every(p=>paths.includes(p))&&paths.every(p=>busPolishAllowed.has(p));}
export function busPolishOnly(paths,evidence={}){return busPolishPathsOnly(paths)&&matchesReviewedSources(evidence,{busPolishSourceDiff:'fd7f82c17f3e036410e7f0f4128e4536d07c2174abdc089eee0668673f2962dd'});}
// Bus B2: bus, stop, shelter and depot meshes plus the route ribbon look. No engine, route, save or UI change.
export const busSceneSources=['src/bus/geometry.ts','src/bus/overlay.ts','src/bus/scene-buses.ts'];
const busSceneAllowed=new Set([...busSceneSources,'.github/workflows/citymanager.yml','.github/workflows/entity-explanation.yml','.github/workflows/owner-decisions.yml','.github/workflows/player-feedback.yml','.github/workflows/traffic-enabled.yml','docs/bus-scene-ci-scope.md','scripts/ci-visual-scope.mjs','tests/bus-scene.test.ts','tests/ci-visual-scope.test.mjs','tests/traffic-workflow-partition.test.mjs']);
export function busScenePathsOnly(paths){return [...busSceneSources,'tests/bus-scene.test.ts'].every(p=>paths.includes(p))&&paths.every(p=>busSceneAllowed.has(p));}
export function busSceneOnly(paths,evidence={}){return busScenePathsOnly(paths)&&matchesReviewedSources(evidence,{busSceneSourceDiff:'1fc0b035f673c4f433db1a3661e264995e8c88c591b05399a6c5418a1454146c'});}
// Bus B3: bus overlay on the minimap and the city map. No engine, route, 3D, save or UI change.
export const busMapSources=['src/bus/map-paint.ts','src/minimap.css','src/minimap.ts'];
const busMapAllowed=new Set([...busMapSources,'.github/workflows/citymanager.yml','.github/workflows/entity-explanation.yml','.github/workflows/owner-decisions.yml','.github/workflows/player-feedback.yml','.github/workflows/traffic-enabled.yml','docs/bus-map-ci-scope.md','scripts/ci-visual-scope.mjs','tests/bus-map.test.ts','tests/ci-visual-scope.test.mjs','tests/traffic-workflow-partition.test.mjs']);
export function busMapPathsOnly(paths){return ['src/bus/map-paint.ts','tests/bus-map.test.ts'].every(p=>paths.includes(p))&&paths.every(p=>busMapAllowed.has(p));}
export function busMapOnly(paths,evidence={}){return busMapPathsOnly(paths)&&matchesReviewedSources(evidence,{busMapSourceDiff:'e62d7ca651b79492a26b33e61eee73fc093e25115430ac7dea326f383a08f96a'});}
// D1: delete browser-save modules the online-only game no longer imports, their dedicated tests, and move four
// feature tests onto the server load path. Every deleted module must be in the change; no live source may change.
export const saveCleanupDeletedSources=['src/active-local-save.ts', 'src/auto-cleanup.ts', 'src/city-migration-inventory.ts', 'src/delete-old-saves.ts', 'src/local-city-save.ts', 'src/recovery-idb.ts', 'src/save-choice.ts', 'src/save-equivalence.ts', 'src/save-guard.ts', 'src/save-promotion.ts', 'src/save-recovery-info.ts', 'src/startup-save-feedback.ts', 'src/startup-save.ts'];
export const saveCleanupSources=[...saveCleanupDeletedSources,...['tests/business-capacity.test.ts', 'tests/education-capacity.test.ts', 'tests/education-labor.test.ts', 'tests/rail-taxi-parcels.test.ts']];
const saveCleanupDeletedTests=['tests/active-local-save-browser.mjs', 'tests/active-local-save-harness.html', 'tests/active-local-save.test.ts', 'tests/auto-cleanup.test.ts', 'tests/city-migration-inventory.test.ts', 'tests/delete-old-saves.test.ts', 'tests/load-authority.test.ts', 'tests/recovery-idb-browser.mjs', 'tests/recovery-idb-harness.html', 'tests/recovery-unavailable-browser.mjs', 'tests/save-equivalence.test.ts', 'tests/save-promotion.test.ts', 'tests/save-quota-hotfix.test.ts', 'tests/save-quota-lossless.test.ts', 'tests/save-recovery-info.test.ts', 'tests/save-safety-smoke.mjs', 'tests/save-safety.test.ts', 'tests/save-startup-diagnosis.test.ts', 'tests/save-startup-feedback.test.ts', 'tests/traffic-autosave-boundary.test.ts'];
const saveCleanupAllowed=new Set([...saveCleanupSources,...saveCleanupDeletedTests,'.github/workflows/citymanager.yml','.github/workflows/entity-explanation.yml','.github/workflows/owner-decisions.yml','.github/workflows/player-feedback.yml','.github/workflows/save-safety.yml','.github/workflows/traffic-enabled.yml','docs/save-cleanup-ci-scope.md','scripts/ci-visual-scope.mjs','tests/ci-visual-scope.test.mjs','tests/traffic-workflow-partition.test.mjs']);
export function saveCleanupPathsOnly(paths){return saveCleanupDeletedSources.every(p=>paths.includes(p))&&paths.every(p=>saveCleanupAllowed.has(p));}
export function saveCleanupOnly(paths,evidence={}){return saveCleanupPathsOnly(paths)&&matchesReviewedSources(evidence,{saveCleanupSourceDiff:'ce75e15c81704810c6636f17c76ff2e5f905236d0beb52c5cefcd72b939f5c3c'});}
// D2: the game keeps nothing in the browser. No stored Guest pin at entry; market journal, settings and feature
// switches live in page memory. Exactly these sources and their tests; no save format, server or simulation change.
export const browserStorageSources=['src/advanced.ts', 'src/atmosphere-controls.ts', 'src/audio-settings.ts', 'src/bus/types.ts', 'src/city-save-auth.ts', 'src/guide.ts', 'src/market-client.ts', 'src/server-city-entry.ts', 'src/session-memory.ts', 'src/taxi/buildings.ts', 'src/traffic/flag.ts', 'tests/commercial-market-envelope.test.ts', 'tests/market-client.test.ts', 'tests/market-safety.test.ts', 'tests/pages-auth.test.ts', 'tests/server-city-entry-flow.test.ts', 'tests/server-city-entry.test.ts', 'tests/trade-rejections.client.test.ts'];
const browserStorageAllowed=new Set([...browserStorageSources,'.github/workflows/citymanager.yml','.github/workflows/entity-explanation.yml','.github/workflows/owner-decisions.yml','.github/workflows/player-feedback.yml','.github/workflows/traffic-enabled.yml','docs/browser-storage-ci-scope.md','scripts/ci-visual-scope.mjs','tests/ci-visual-scope.test.mjs','tests/traffic-workflow-partition.test.mjs']);
export function browserStoragePathsOnly(paths){return ['src/session-memory.ts','src/market-client.ts','src/server-city-entry.ts','src/city-save-auth.ts'].every(p=>paths.includes(p))&&paths.every(p=>browserStorageAllowed.has(p));}
export function browserStorageOnly(paths,evidence={}){return browserStoragePathsOnly(paths)&&matchesReviewedSources(evidence,{browserStorageSourceDiff:'0e6a2af384b0ca3bcbd8411f1fee28212ce3d8b9574cdd9dd6e8b67242d2ba61'});}
// Save smoke hardening: the lost-ACK retry press waits for a settled layout and confirms the click lands.
// Test harness only; no game, save client, server or workflow behaviour beyond routing changes.
export const smokeRetrySources=['tests/server-save-browser-smoke.mjs'];
const smokeRetryAllowed=new Set([...smokeRetrySources,'.github/workflows/citymanager.yml','.github/workflows/entity-explanation.yml','.github/workflows/owner-decisions.yml','.github/workflows/player-feedback.yml','.github/workflows/traffic-enabled.yml','docs/smoke-retry-ci-scope.md','scripts/ci-visual-scope.mjs','tests/ci-visual-scope.test.mjs','tests/traffic-workflow-partition.test.mjs']);
export function smokeRetryPathsOnly(paths){return smokeRetrySources.every(p=>paths.includes(p))&&paths.every(p=>smokeRetryAllowed.has(p));}
export function smokeRetryOnly(paths,evidence={}){return smokeRetryPathsOnly(paths)&&matchesReviewedSources(evidence,{smokeRetrySourceDiff:'d6c198c3e42fc58ef239863b4543161a5ff5e3e3a557c83c814dae069bf2fd99'});}
// Map declutter: building issues tiered by urgency (alert / nearby / panel) for badges, minimap, HUD and chime.
// Presentation only: issue detection, simulation, save and server are unchanged.
export const mapDeclutterSources=['src/audio-cues.ts','src/building-issue-layout.ts','src/building-issues.css','src/building-issues.ts','src/city-hud.ts','src/map-markers.ts','src/minimap.ts','tests/building-issues.test.ts'];
const mapDeclutterAllowed=new Set([...mapDeclutterSources,'.github/workflows/citymanager.yml','.github/workflows/entity-explanation.yml','.github/workflows/owner-decisions.yml','.github/workflows/player-feedback.yml','.github/workflows/traffic-enabled.yml','docs/map-declutter-ci-scope.md','scripts/ci-visual-scope.mjs','tests/ci-visual-scope.test.mjs','tests/traffic-workflow-partition.test.mjs']);
export function mapDeclutterPathsOnly(paths){return ['src/building-issues.ts','src/map-markers.ts','tests/building-issues.test.ts'].every(p=>paths.includes(p))&&paths.every(p=>mapDeclutterAllowed.has(p));}
export function mapDeclutterOnly(paths,evidence={}){return mapDeclutterPathsOnly(paths)&&matchesReviewedSources(evidence,{mapDeclutterSourceDiff:'REVIEWED_HASH'});}
export const trafficPresenterSources=["src/traffic/presentation.ts"];
const trafficPresenterAllowed=new Set(["docs/TRAFFIC-PRESENTER-PERFORMANCE.md", "tests/traffic-game-cases.test.ts", "src/traffic/presentation.ts", ".github/workflows/citymanager.yml", ".github/workflows/traffic-enabled.yml", "scripts/ci-visual-scope.mjs", "tests/ci-visual-scope.test.mjs", "tests/traffic-workflow-partition.test.mjs", "tests/traffic-lane-order.test.ts", "tests/traffic-default-fault-smoke.mjs", "tests/traffic-game-smoke.mjs", "tests/traffic-game-cases.mjs", "tests/traffic-server-entry-fixture.mjs", "tests/traffic-server-entry-fixture.test.mjs", "docs/server-save-ci-migration.md"]);
export function trafficPresenterPathsOnly(paths){return ["src/traffic/presentation.ts", "tests/traffic-lane-order.test.ts", "tests/traffic-default-fault-smoke.mjs", "tests/traffic-game-smoke.mjs", "tests/traffic-server-entry-fixture.mjs", "tests/traffic-server-entry-fixture.test.mjs"].every(p=>paths.includes(p))&&paths.every(p=>trafficPresenterAllowed.has(p));}
export function trafficPresenterOnly(paths,evidence={}){return trafficPresenterPathsOnly(paths)&&matchesReviewedSources(evidence,{trafficPresenterSourceDiff:'8b74a11b65776e16e5fd8cbd0e6acdee349da26e1f75496c52a5e0adee0c89ee'});}
export function visualKind(paths, evidence = {}) {
  if(trafficPresenterOnly(paths,evidence))return 'traffic-presenter';
  if(adaptiveSignalOnly(paths,evidence))return 'traffic-gap';
  if(trafficRrtOnly(paths,evidence))return 'traffic-gap';
  if(rightOfWayOnly(paths,evidence))return 'traffic-gap';
  if(trafficGapOnly(paths,evidence))return 'traffic-gap';
  if(railOnly(paths,evidence))return 'rail';
  if(commercialOnly(paths,evidence))return 'commercial';
  if(sessionLifetimeOnly(paths,evidence))return 'server-save';
  if(historyOnly(paths,evidence))return 'history';
  if(classicToolbarOnly(paths,evidence))return 'classic-toolbar';
  if(railPolishOnly(paths,evidence))return 'rail-polish';
  if(railSceneOnly(paths,evidence))return 'rail-scene';
  if(railMapOnly(paths,evidence))return 'rail-map';
  if(busPolishOnly(paths,evidence))return 'bus-polish';
  if(busSceneOnly(paths,evidence))return 'bus-scene';
  if(busMapOnly(paths,evidence))return 'bus-map';
  if(saveCleanupOnly(paths,evidence))return 'save-cleanup';
  if(browserStorageOnly(paths,evidence))return 'browser-storage';
  if(smokeRetryOnly(paths,evidence))return 'smoke-retry';
  if(mapDeclutterOnly(paths,evidence))return 'map-declutter';
  if(hudPolishOnly(paths,evidence))return 'hud-polish';
  if(panelPolishOnly(paths,evidence))return 'panel-polish';
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
    if(trafficPresenterPathsOnly(paths)){const {base,head}=changedRange(process.env.GITHUB_EVENT_NAME,event,git);evidence.trafficPresenterSourceDiff=git(["diff","--no-ext-diff","--no-renames","--binary","--full-index","--no-color","--src-prefix=a/","--dst-prefix=b/","--diff-algorithm=myers","--no-indent-heuristic",base,head,"--",...trafficPresenterSources]);}
    if(adaptiveSignalPathsOnly(paths)){const {base,head}=changedRange(process.env.GITHUB_EVENT_NAME,event,git);evidence.adaptiveSignalSourceDiff=git(["diff","--no-ext-diff","--no-renames","--binary","--full-index","--no-color","--src-prefix=a/","--dst-prefix=b/","--diff-algorithm=myers","--no-indent-heuristic",base,head,"--",...adaptiveSignalSources]);}
    if(trafficRrtPathsOnly(paths)){const {base,head}=changedRange(process.env.GITHUB_EVENT_NAME,event,git);evidence.trafficRrtSourceDiff=git(["diff","--no-ext-diff","--no-renames","--binary","--full-index","--no-color","--src-prefix=a/","--dst-prefix=b/","--diff-algorithm=myers","--no-indent-heuristic",base,head,"--",...trafficRrtSources]);}
    if(rightOfWayPathsOnly(paths)){const {base,head}=changedRange(process.env.GITHUB_EVENT_NAME,event,git);evidence.rightOfWaySourceDiff=git(["diff", "--no-ext-diff", "--no-renames", "--binary", "--full-index", "--no-color", "--src-prefix=a/", "--dst-prefix=b/", "--diff-algorithm=myers", "--no-indent-heuristic",base,head,'--',...rightOfWaySources]);}
    if(trafficGapPathsOnly(paths)){const {base,head}=changedRange(process.env.GITHUB_EVENT_NAME,event,git);evidence.trafficGapSourceDiff=git(["diff", "--no-ext-diff", "--no-renames", "--binary", "--full-index", "--no-color", "--src-prefix=a/", "--dst-prefix=b/", "--diff-algorithm=myers", "--no-indent-heuristic",base,head,'--',...trafficGapSources]);}
    if(railPathsOnly(paths)){const {base,head}=changedRange(process.env.GITHUB_EVENT_NAME,event,git);evidence.railSourceDiff=git(["diff", "--no-ext-diff", "--no-renames", "--binary", "--full-index", "--no-color", "--src-prefix=a/", "--dst-prefix=b/", "--diff-algorithm=myers", "--no-indent-heuristic",base,head,'--',...railSources]);}
    if(panelPolishPathsOnly(paths)){
      const {base,head}=changedRange(process.env.GITHUB_EVENT_NAME,event,git);
      evidence.panelPolishSourceDiff=git(["diff", "--no-ext-diff", "--no-renames", "--binary", "--full-index", "--no-color", "--src-prefix=a/", "--dst-prefix=b/", "--diff-algorithm=myers", "--no-indent-heuristic",base,head,'--',...panelPolishSources]);
      evidence.panelGateEvidence=panelGateEvidence(p=>{
        if(p==='tests/entry-gate.test.ts' && !git(['ls-tree','--name-only',head,'--',p]).trim()) return null;
        return git(['show',`${head}:${p}`]);
      });
    }
    if(mapDeclutterPathsOnly(paths)){const {base,head}=changedRange(process.env.GITHUB_EVENT_NAME,event,git);evidence.mapDeclutterSourceDiff=git(["diff", "--no-ext-diff", "--no-renames", "--binary", "--full-index", "--no-color", "--src-prefix=a/", "--dst-prefix=b/", "--diff-algorithm=myers", "--no-indent-heuristic",base,head,'--',...mapDeclutterSources]);}
    if(smokeRetryPathsOnly(paths)){const {base,head}=changedRange(process.env.GITHUB_EVENT_NAME,event,git);evidence.smokeRetrySourceDiff=git(["diff", "--no-ext-diff", "--no-renames", "--binary", "--full-index", "--no-color", "--src-prefix=a/", "--dst-prefix=b/", "--diff-algorithm=myers", "--no-indent-heuristic",base,head,'--',...smokeRetrySources]);}
    if(browserStoragePathsOnly(paths)){const {base,head}=changedRange(process.env.GITHUB_EVENT_NAME,event,git);evidence.browserStorageSourceDiff=git(["diff", "--no-ext-diff", "--no-renames", "--binary", "--full-index", "--no-color", "--src-prefix=a/", "--dst-prefix=b/", "--diff-algorithm=myers", "--no-indent-heuristic",base,head,'--',...browserStorageSources]);}
    if(saveCleanupPathsOnly(paths)){const {base,head}=changedRange(process.env.GITHUB_EVENT_NAME,event,git);evidence.saveCleanupSourceDiff=git(["diff", "--no-ext-diff", "--no-renames", "--binary", "--full-index", "--no-color", "--src-prefix=a/", "--dst-prefix=b/", "--diff-algorithm=myers", "--no-indent-heuristic",base,head,'--',...saveCleanupSources]);}
    if(busMapPathsOnly(paths)){const {base,head}=changedRange(process.env.GITHUB_EVENT_NAME,event,git);evidence.busMapSourceDiff=git(["diff", "--no-ext-diff", "--no-renames", "--binary", "--full-index", "--no-color", "--src-prefix=a/", "--dst-prefix=b/", "--diff-algorithm=myers", "--no-indent-heuristic",base,head,'--',...busMapSources]);}
    if(busScenePathsOnly(paths)){const {base,head}=changedRange(process.env.GITHUB_EVENT_NAME,event,git);evidence.busSceneSourceDiff=git(["diff", "--no-ext-diff", "--no-renames", "--binary", "--full-index", "--no-color", "--src-prefix=a/", "--dst-prefix=b/", "--diff-algorithm=myers", "--no-indent-heuristic",base,head,'--',...busSceneSources]);}
    if(busPolishPathsOnly(paths)){const {base,head}=changedRange(process.env.GITHUB_EVENT_NAME,event,git);evidence.busPolishSourceDiff=git(["diff", "--no-ext-diff", "--no-renames", "--binary", "--full-index", "--no-color", "--src-prefix=a/", "--dst-prefix=b/", "--diff-algorithm=myers", "--no-indent-heuristic",base,head,'--',...busPolishSources]);}
    if(railMapPathsOnly(paths)){const {base,head}=changedRange(process.env.GITHUB_EVENT_NAME,event,git);evidence.railMapSourceDiff=git(["diff", "--no-ext-diff", "--no-renames", "--binary", "--full-index", "--no-color", "--src-prefix=a/", "--dst-prefix=b/", "--diff-algorithm=myers", "--no-indent-heuristic",base,head,'--',...railMapSources]);}
    if(railScenePathsOnly(paths)){const {base,head}=changedRange(process.env.GITHUB_EVENT_NAME,event,git);evidence.railSceneSourceDiff=git(["diff", "--no-ext-diff", "--no-renames", "--binary", "--full-index", "--no-color", "--src-prefix=a/", "--dst-prefix=b/", "--diff-algorithm=myers", "--no-indent-heuristic",base,head,'--',...railSceneSources]);}
    if(railPolishPathsOnly(paths)){const {base,head}=changedRange(process.env.GITHUB_EVENT_NAME,event,git);evidence.railPolishSourceDiff=git(["diff", "--no-ext-diff", "--no-renames", "--binary", "--full-index", "--no-color", "--src-prefix=a/", "--dst-prefix=b/", "--diff-algorithm=myers", "--no-indent-heuristic",base,head,'--',...railPolishSources]);}
    if(hudPolishPathsOnly(paths)){const {base,head}=changedRange(process.env.GITHUB_EVENT_NAME,event,git);evidence.hudPolishSourceDiff=git(["diff", "--no-ext-diff", "--no-renames", "--binary", "--full-index", "--no-color", "--src-prefix=a/", "--dst-prefix=b/", "--diff-algorithm=myers", "--no-indent-heuristic",base,head,'--',...hudPolishSources]);}
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
