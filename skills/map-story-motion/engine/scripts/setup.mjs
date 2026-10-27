// One-time setup check: tools on the machine, npm packages, and Natural Earth data.
//   node scripts/setup.mjs
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NE = join(ROOT, '.cache/ne');
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => { console.log(`  ✗ ${m}`); process.exitCode = 1; };

console.log('tools');
for (const [cmd, arg] of [['node', '-v'], ['ffmpeg', '-version'], ['ffprobe', '-version']]) {
  const r = spawnSync(cmd, [arg], { encoding: 'utf8' });
  if (r.status === 0) ok(`${cmd} ${r.stdout.split('\n')[0].slice(0, 60)}`); else bad(`${cmd} not found`);
}

console.log('npm packages');
if (!existsSync(join(ROOT, 'node_modules/maplibre-gl'))) {
  console.log('  installing…');
  execFileSync('npm', ['install', '--silent'], { cwd: ROOT, stdio: 'inherit' });
}
ok('engine dependencies installed');
try {
  const require = createRequire(join(ROOT, 'package.json'));
  require('playwright');
  ok('playwright');
} catch {
  bad('playwright not found — install it (npm i -g playwright && npx playwright install chromium) or use a machine that has it');
}

console.log('Natural Earth 10m (public domain)');
const sets = ['cultural/ne_10m_admin_0_countries', 'cultural/ne_10m_admin_1_states_provinces', 'physical/ne_10m_rivers_lake_centerlines'];
mkdirSync(NE, { recursive: true });
for (const s of sets) {
  const name = s.split('/')[1];
  const shp = join(NE, name, `${name}.shp`);
  if (existsSync(shp)) { ok(name); continue; }
  console.log(`  downloading ${name}…`);
  const res = await fetch(`https://naciscdn.org/naturalearth/10m/${s}.zip`);
  if (!res.ok) { bad(`${name}: HTTP ${res.status}`); continue; }
  const zip = join(NE, `${name}.zip`);
  writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
  execFileSync('unzip', ['-oq', zip, '-d', join(NE, name)]);
  ok(name);
}
console.log(process.exitCode ? '\nsetup incomplete' : '\nready');
