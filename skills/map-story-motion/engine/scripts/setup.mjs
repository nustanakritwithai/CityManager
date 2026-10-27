// One-time setup check: tools on the machine, npm packages, and Natural Earth data.
//   node scripts/setup.mjs
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, writeFileSync } from 'node:fs';
import { safeSubdirectory } from './safe-cache.mjs';
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
safeSubdirectory(ROOT, ['.cache', 'ne']);
for (const s of sets) {
  const name = s.split('/')[1];
  const target = join(NE, name);
  if (existsSync(target)) {
    safeSubdirectory(ROOT, ['.cache', 'ne', name]);
    const shp = join(target, `${name}.shp`);
    try { const st = lstatSync(shp); if (!st.isFile() || st.isSymbolicLink()) throw new Error('unsafe shapefile'); }
    catch { bad(`${name}: existing incomplete or unsafe directory; preserve it and resolve manually`); continue; }
    ok(name); continue;
  }
  console.log(`  downloading ${name}...`);
  const res = await fetch(`https://naciscdn.org/naturalearth/10m/${s}.zip`);
  if (!res.ok) { bad(`${name}: HTTP ${res.status}`); continue; }
  const dir = safeSubdirectory(ROOT, ['.cache', 'ne', name]);
  if (readdirSync(dir).length) { bad(`${name}: destination is not empty`); continue; }
  const zip = join(dir, 'download.zip');
  writeFileSync(zip, Buffer.from(await res.arrayBuffer()), { flag: 'wx' });
  const entries = execFileSync('unzip', ['-Z', '-1', zip], { encoding: 'utf8' }).trim().split(/\r?\n/);
  if (!entries.length || new Set(entries.map(entry => entry.toLowerCase())).size !== entries.length || entries.some(entry => !/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(entry) || entry.toLowerCase() === 'download.zip')) throw new Error(`${name}: unsafe archive entry`);
  execFileSync('unzip', ['-q', zip, '-d', dir]);
  for (const entry of entries) { const st = lstatSync(join(dir, entry)); if (!st.isFile() || st.isSymbolicLink()) throw new Error(`${name}: unsafe archive file`); }

  ok(name);
}
console.log(process.exitCode ? '\nsetup incomplete' : '\nready');
