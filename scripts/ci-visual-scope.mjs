// A narrow visual-only route; unknown events/ranges/paths retain the full suite.
import { execFileSync } from 'node:child_process';
import { readFileSync, appendFileSync } from 'node:fs';
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
export function visualKind(paths) {
  if (paths.includes('src/vehicle-geometry.ts') && paths.every(p => vehicleAllowed.has(p))) return 'vehicle';
  if (paths.includes('src/factory-visuals.ts') && paths.every(p => factoryAllowed.has(p))) return 'factory';
  return towerOnly(paths) ? 'tower' : 'full';
}
export function changedPaths(eventName, event, git) {
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
  // --no-renames ensures both sides of a rename participate in the allowlist.
  return git(['diff', '--name-only', '--no-renames', '-z', base, head]).split('\0').filter(Boolean);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let selected = 'full';
  try {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    const paths = changedPaths(process.env.GITHUB_EVENT_NAME, event, args => execFileSync('git', args, { encoding: 'utf8' }));
    selected = visualKind(paths);
    console.log(`Changed paths: ${JSON.stringify(paths)}`);
  } catch (error) { console.log(`Full-suite fallback: ${error.message}`); }
  console.log(`Visual check route: ${selected}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `kind=${selected}\ntower_only=${selected === 'tower'}\n`);
}
