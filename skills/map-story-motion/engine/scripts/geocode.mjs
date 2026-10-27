// Look up coordinates with OpenStreetMap Nominatim (1 request/second, results cached).
//   node scripts/geocode.mjs "Guangzhou, China" "Luang Prabang, Laos" ...
// Prints `places:` lines to paste into story.yaml. Always show uncertain matches to the user.
import { lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { safeSubdirectory } from './safe-cache.mjs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = safeSubdirectory(ROOT, ['.cache', 'geocode']);

for (const q of process.argv.slice(2)) {
  const file = join(CACHE, createHash('sha256').update(q).digest('hex') + '.json');
  const readCached = () => { const st = lstatSync(file); if (!st.isFile() || st.isSymbolicLink()) throw new Error('unsafe geocode cache entry'); return JSON.parse(readFileSync(file, 'utf8')); };
  let hits;
  try { hits = readCached(); } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=3&q=${encodeURIComponent(q)}`, { headers: { 'User-Agent': 'map-story-motion/1.0' } });
    if (!res.ok) throw new Error(`geocode HTTP ${res.status}`);
    hits = await res.json();
    try { writeFileSync(file, JSON.stringify(hits), { flag: 'wx' }); }
    catch (err) { if (err.code !== 'EEXIST') throw err; hits = readCached(); }
    await new Promise((r) => setTimeout(r, 1100));
  }

  const id = q.split(',')[0].toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'place';
  if (!hits.length) { console.log(`  # ${q}: NOT FOUND — ask the user or place it by hand`); continue; }
  const h = hits[0];
  console.log(`  ${id}: { name: "${q.split(',')[0]}", lng: ${(+h.lon).toFixed(3)}, lat: ${(+h.lat).toFixed(3)} }   # ${h.display_name.slice(0, 70)}${hits.length > 1 ? ` (+${hits.length - 1} other matches)` : ''}`);
}
