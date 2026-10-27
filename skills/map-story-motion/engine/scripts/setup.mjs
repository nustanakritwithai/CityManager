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
const require = createRequire(join(ROOT, 'package.json'));
const required = ['maplibre-gl', 'mapshaper', 'yaml', 'playwright'];
const missing = required.filter(name => { try { require.resolve(name); return false; } catch { return true; } });
if (missing.length) {
  console.log('  installing…');
  // npm is a cmd shim on Windows. The command is constant: no story or user input is interpolated.
  if (process.platform === 'win32') execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm.cmd install --silent'], { cwd: ROOT, stdio: 'inherit' });
  else execFileSync('npm', ['install', '--silent'], { cwd: ROOT, stdio: 'inherit' });
}
const unresolved = required.filter(name => { try { require.resolve(name); return false; } catch { return true; } });
if (unresolved.length) bad(`missing local dependencies: ${unresolved.join(', ')}`);
else ok('engine dependencies installed');
try {
  const { chromium } = require('playwright');
  ok('playwright');
  if (!existsSync(chromium.executablePath())) bad('Playwright Chromium is missing; run npx playwright install chromium from engine/');
  else ok(`Chromium ${chromium.executablePath()}`);
} catch {
  bad('local Playwright is missing — run npm install from engine/');
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
  // Windows includes bsdtar, while unzip is not guaranteed to be installed.
  const archiveTool = process.platform === 'win32' ? 'tar' : 'unzip';
  const listArgs = process.platform === 'win32' ? ['-tf', zip] : ['-Z', '-1', zip];
  const entries = execFileSync(archiveTool, listArgs, { encoding: 'utf8' }).trim().split(/\r?\n/);
  if (!entries.length || new Set(entries.map(entry => entry.toLowerCase())).size !== entries.length || entries.some(entry => !/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(entry) || entry.toLowerCase() === 'download.zip')) throw new Error(`${name}: unsafe archive entry`);
  if (process.platform === 'win32') execFileSync(archiveTool, ['-xkf', zip, '-C', dir]);
  else execFileSync(archiveTool, ['-q', zip, '-d', dir]);
  for (const entry of entries) { const st = lstatSync(join(dir, entry)); if (!st.isFile() || st.isSymbolicLink()) throw new Error(`${name}: unsafe archive file`); }

  ok(name);
}
console.log(process.exitCode ? '\nsetup incomplete' : '\nready');
