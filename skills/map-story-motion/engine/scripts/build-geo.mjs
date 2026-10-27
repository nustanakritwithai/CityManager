// Builds the GeoJSON a story needs from Natural Earth, driven by `build:` specs on its layers and
// zones. Output goes to <story folder>/geo/<src>.json, which the player loads as /geo/<src>.json.
//   node scripts/build-geo.mjs path/to/story.yaml
//
// build specs (see references/story-schema.md):
//   rivers:   { rivers: [Mekong, "Nam Ou"], upstream: [lng, lat], clip: [w, s, e, n] }
//   countries:{ countries: [Thailand, Laos] }
//   provinces:{ provinces: [{ country: China, names: [Yunnan] }, { country: Vietnam, minLat: 19.9 }], clip: [...] }
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { buildGeoFile } from './geo-output.mjs';
import { safeOutputName } from './output-files.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MS = join(ROOT, 'node_modules/mapshaper/bin/mapshaper');
const NE = join(ROOT, '.cache/ne');
const RIVERS = join(NE, 'ne_10m_rivers_lake_centerlines/ne_10m_rivers_lake_centerlines.shp');
const ADM0 = join(NE, 'ne_10m_admin_0_countries/ne_10m_admin_0_countries.shp');
const ADM1 = join(NE, 'ne_10m_admin_1_states_provinces/ne_10m_admin_1_states_provinces.shp');

// --list-rivers w,s,e,n prints the Natural Earth river names inside a box (upper reaches often
// have their own names, e.g. the Mekong's headwater is "Za").
if (process.argv.includes('--force')) { console.error('--force is unsupported; choose a new src to preserve existing output'); process.exit(1); }
const li = process.argv.indexOf('--list-rivers');
if (li > 0) {
  const tempDir = mkdtempSync(join(tmpdir(), 'map-rivers-'));
  const tmp = join(tempDir, 'rivers.json');
  try {
  execFileSync(process.execPath, [MS, RIVERS, '-clip', `bbox=${process.argv[li + 1]}`, '-o', tmp, 'format=geojson'], { stdio: 'ignore' });
  const names = {};
  for (const f of JSON.parse(readFileSync(tmp, 'utf8')).features) { const n = f.properties.name_en || f.properties.name; if (n) names[n] = (names[n] || 0) + 1; }
  console.log(Object.keys(names).sort().join(' · '));
  } finally { try { unlinkSync(tmp); } catch (e) { if (e.code !== 'ENOENT') throw e; } rmdirSync(tempDir); }
  process.exit(0);
}
const storyPath = resolve(process.argv[2]);
const story = YAML.parse(readFileSync(storyPath, 'utf8'));
const jobs = [...Object.entries(story.layers || {}), ...Object.entries(story.zones || {})].filter(([, d]) => d.build && d.src);
try { for (const [, def] of jobs) safeOutputName(def.src); }
catch (e) { console.error(`Invalid geo src: ${e.message}`); process.exit(1); }
if (!existsSync(RIVERS)) { console.error('Natural Earth data missing: run node scripts/setup.mjs first'); process.exit(1); }

const ms = (...args) => execFileSync(process.execPath, [MS, ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
const J = JSON.stringify;
const clipArgs = (b) => (b.clip ? ['-clip', `bbox=${b.clip.join(',')}`] : []);

// Rivers arrive as unordered fragments; chain them into one line from the upstream hint to the
// mouth so the player can draw the river from source to sea.
function chainRiver(file, hint) {
  const g = JSON.parse(readFileSync(file, 'utf8'));
  const geom = g.geometries ? g.geometries[0] : g.features ? g.features[0].geometry : g.geometry;
  if (!geom) throw new Error(`${file}: no river geometry — check the river names`);
  const parts = geom.type === 'LineString' ? [geom.coordinates] : geom.coordinates.map((p) => p.slice());
  parts.sort((a, b) => b.length - a.length);
  const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.02;
  let chain = parts.shift();
  for (let grew = true; grew && parts.length;) {
    grew = false;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (near(chain.at(-1), p[0])) chain = chain.concat(p.slice(1));
      else if (near(chain.at(-1), p.at(-1))) chain = chain.concat(p.slice(0, -1).reverse());
      else if (near(chain[0], p.at(-1))) chain = p.slice(0, -1).concat(chain);
      else if (near(chain[0], p[0])) chain = p.slice(1).reverse().concat(chain);
      else continue;
      parts.splice(i, 1); grew = true; break;
    }
  }
  if (hint) { const d = (c) => Math.hypot(c[0] - hint[0], c[1] - hint[1]); if (d(chain.at(-1)) < d(chain[0])) chain.reverse(); }
  writeFileSync(file, J({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: chain } }));
  const f = (c) => `[${c.map((v) => v.toFixed(2)).join(', ')}]`;
  return `${chain.length} pts from ${f(chain[0])} to ${f(chain.at(-1))}${parts.length ? `, ${parts.length} side branches dropped` : ''}`;
}

function provinceExpr(list) {
  return list.map((p) => {
    const c = [`admin===${J(p.country)}`];
    if (p.names) c.push(`${J(p.names)}.includes(name_en)`);
    if (p.minLat != null) c.push(`latitude>${p.minLat}`);
    if (p.maxLat != null) c.push(`latitude<${p.maxLat}`);
    if (p.minLng != null) c.push(`longitude>${p.minLng}`);
    if (p.maxLng != null) c.push(`longitude<${p.maxLng}`);
    return `(${c.join(' && ')})`;
  }).join(' || ');
}

if (!jobs.length) console.log('no layers with build: specs');
const completed = new Map();
for (const [id, def] of jobs) {
  const b = def.build;
  if (completed.has(def.src)) {
    if (completed.get(def.src) !== J(b)) { console.error(`${id}: conflicting build spec for ${def.src}`); process.exitCode = 1; }
    else console.log(`${id}: reusing geo/${def.src}.json generated in this run`);
    continue;
  }
  try {
    const file = buildGeoFile(dirname(storyPath), def.src, (file) => {
    if (b.rivers) {
      ms(RIVERS, '-filter', `${J(b.rivers)}.includes(name_en) || ${J(b.rivers)}.includes(name)`, ...clipArgs(b), '-dissolve', '-simplify', b.simplify || '20%', 'keep-shapes', '-o', file, 'format=geojson', 'precision=0.001');
      console.log(`${id}: river ${chainRiver(file, b.upstream)}`);
    } else if (b.countries) {
      ms(ADM0, '-filter', `${J(b.countries)}.includes(ADMIN) || ${J(b.countries)}.includes(NAME_EN) || ${J(b.countries)}.includes(ISO_A3)`, ...clipArgs(b), '-dissolve', '-simplify', b.simplify || '8%', 'keep-shapes', '-filter-slivers', '-o', file, 'format=geojson', 'precision=0.001');
      console.log(`${id}: countries ${b.countries.join(', ')}`);
    } else if (b.provinces) {
      ms(ADM1, '-filter', provinceExpr(b.provinces), ...clipArgs(b), '-dissolve', '-simplify', b.simplify || '8%', 'keep-shapes', '-filter-slivers', '-o', file, 'format=geojson', 'precision=0.001');
      console.log(`${id}: provinces ${b.provinces.map((p) => `${p.country}${p.names ? `(${p.names.join(', ')})` : ''}`).join(' + ')}`);
    } else throw new Error(`unknown build spec ${J(b)}`);
    });
    completed.set(def.src, J(b));
    const size = readFileSync(file).length;
    if (size < 200) console.log(`  ⚠ ${def.src}.json is nearly empty — names may not match Natural Earth spelling (name_en)`);
  } catch (e) {
    console.log(`${id}: failed — ${String(e.stderr || e.message).split('\n')[0]}`);
    process.exitCode = 1;
  }
}
