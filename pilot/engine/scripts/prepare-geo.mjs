// Builds the small GeoJSON files the player loads, from Natural Earth 10m (public domain).
// Run once: node scripts/prepare-geo.mjs  (expects .cache/ne/* from the download step)
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { newOutputDirectory } from './output-files.mjs';

const MS = 'node_modules/mapshaper/bin/mapshaper';
const NE = '.cache/ne';
const OUT = newOutputDirectory('.', 'geo-build-');
console.log(`Geo output: ${OUT}`);

const ms = (...args) => execFileSync(process.execPath, [MS, ...args], { stdio: ['ignore', 'ignore', 'inherit'] });

// Rivers: keep the ones the story names, dissolve each into one feature, light simplify.
const rivers = { yangtze: ['Yangtze'], huai: ['Huai'], red: ['Red'], mekong: ['Mekong'], ou: ['Ou', 'Nam Ou'], xi: ['Xi', 'Xunjiang', 'Xun'], black: ['Black'] };
for (const [id, names] of Object.entries(rivers)) {
  ms(`${NE}/ne_10m_rivers_lake_centerlines/ne_10m_rivers_lake_centerlines.shp`,
    '-filter', `${JSON.stringify(names)}.includes(name_en) || ${JSON.stringify(names)}.includes(name)`,
    '-clip', 'bbox=88,8,125,36', '-dissolve', '-simplify', '20%', 'keep-shapes',
    '-o', `${OUT}/river-${id}.json`, 'format=geojson', 'precision=0.001');
}

// Historical regions, approximated from modern provinces (always labelled "แนวโดยประมาณ" in the clip).
const ADM1 = `${NE}/ne_10m_admin_1_states_provinces/ne_10m_admin_1_states_provinces.shp`;
const cn = (...names) => `(admin==="China" && ${JSON.stringify(names)}.includes(name_en))`;
const vnNorth = '(admin==="Vietnam" && latitude > 19.9)';
const regions = {
  baiyue: `${cn('Zhejiang', 'Fujian', 'Jiangxi', 'Hunan', 'Guangdong', 'Guangxi')} || ${vnNorth}`,
  minyue: cn('Fujian'),
  nanyue: `${cn('Guangdong', 'Guangxi')} || ${vnNorth}`,
  nanzhao: cn('Yunnan'),
  guangxi: cn('Guangxi'),
};
for (const [id, expr] of Object.entries(regions)) {
  ms(ADM1, '-filter', expr, '-dissolve', '-simplify', '8%', 'keep-shapes', '-filter-slivers',
    '-o', `${OUT}/region-${id}.json`, 'format=geojson', 'precision=0.001');
}
ms(ADM1, '-filter', cn('Guangxi'), '-clip', 'bbox=104,20,108.6,27', '-dissolve', '-simplify', '8%',
  '-o', `${OUT}/region-guangxi-west.json`, 'format=geojson', 'precision=0.001');

// Region between the Huai and the Yangtze: Anhui + Jiangsu clipped to that band.
ms(ADM1, '-filter', cn('Anhui', 'Jiangsu'), '-clip', 'bbox=114.5,30.8,121.5,33.6', '-dissolve', '-simplify', '8%',
  '-o', `${OUT}/region-huai-yangtze.json`, 'format=geojson', 'precision=0.001');

for (const f of ['region-baiyue', 'region-nanyue', 'river-yangtze', 'river-red']) {
  const g = JSON.parse(readFileSync(`${OUT}/${f}.json`, 'utf8'));
  console.log(f, g.type, (JSON.stringify(g).length / 1024).toFixed(0) + ' KB');
}
writeFileSync(`${OUT}/README.txt`, 'Derived from Natural Earth 10m (public domain) by scripts/prepare-geo.mjs\n');

// Rivers come out as unordered fragments. Chain them into one LineString running from the
// upstream hint toward the mouth, so the player can "draw" a river from source to sea.
const upstream = { yangtze: [100, 28], huai: [113, 32.4], red: [100, 25.5], mekong: [97, 32], ou: [102, 22.5], xi: [104, 25], black: [100.5, 24] };
const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.02;
for (const [id, hint] of Object.entries(upstream)) {
  const file = `${OUT}/river-${id}.json`;
  const g = JSON.parse(readFileSync(file, 'utf8'));
  const geom = g.geometries ? g.geometries[0] : g.features[0].geometry;
  let parts = geom.type === 'LineString' ? [geom.coordinates] : geom.coordinates.map((p) => p.slice());
  parts.sort((a, b) => b.length - a.length);
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
  const d = (c) => Math.hypot(c[0] - hint[0], c[1] - hint[1]);
  if (d(chain.at(-1)) < d(chain[0])) chain.reverse();
  writeFileSync(file, JSON.stringify({ type: 'Feature', properties: { id }, geometry: { type: 'LineString', coordinates: chain } }));
  console.log(`river-${id}`, chain.length, 'pts', chain[0].map((v) => v.toFixed(1)).join(','), '→', chain.at(-1).map((v) => v.toFixed(1)).join(','), parts.length ? `(dropped ${parts.length} parts)` : '');
}
