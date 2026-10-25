// Integrity gate for public/assets/audio: a closed roster whose bytes match the manifest,
// CC0 licences beside them and a size budget. Usage: node scripts/admit-audio-assets.mjs --verify
import { readFile, readdir, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const dir = fileURLToPath(new URL('../public/assets/audio/', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
assert.equal(manifest.schemaVersion, 1); assert.equal(manifest.id, 'citymanager-audio'); assert.equal(manifest.license, 'CC0-1.0');
const expected = new Set(['manifest.json', 'licenses', ...manifest.files.map(f => f.path)]);
const entries = await readdir(dir, { withFileTypes: true });
assert.equal(entries.length, expected.size, 'Closed roster rejects missing or extra files');
for (const entry of entries) assert.ok(expected.has(entry.name) && !entry.isSymbolicLink(), `Unknown entry ${entry.name}`);
let effects = 0, music = 0;
for (const file of manifest.files) {
  assert.match(file.path, /^(ui|ev|jingle|music)-[a-z-]+\.mp3$/);
  const source = manifest.sources[file.source]; assert.ok(source, `${file.path}: unknown source`);
  assert.equal(source.license, 'CC0-1.0'); assert.match(source.url, /^https:\/\/(kenney\.nl|opengameart\.org)\//);
  const path = join(dir, file.path); assert.equal((await lstat(path)).isSymbolicLink(), false);
  const bytes = await readFile(path);
  assert.equal(bytes.length, file.bytes, `${file.path}: bytes`); assert.equal(hash(bytes), file.sha256, `${file.path}: sha256`);
  assert.ok(file.seconds > 0, `${file.path}: duration`);
  if (file.path.startsWith('music-')) music += bytes.length; else effects += bytes.length;
}
// Short effects load with the page's first sound; music streams only when it starts.
assert.ok(effects <= 300_000, `Effects ${effects} bytes exceed 300 KB`);
assert.ok(music <= 8_000_000, `Music ${music} bytes exceed 8 MB`);
for (const name of await readdir(join(dir, 'licenses'))) {
  const text = await readFile(join(dir, 'licenses', name), 'utf8');
  assert.match(text, /CC0|publicdomain\/zero/, `${name} is not a CC0 licence`);
}
const kenney = Object.entries(manifest.sources).filter(([, s]) => s.url.startsWith('https://kenney.nl/')).map(([id]) => `${id}.txt`);
for (const name of [...kenney, 'opengameart-cc0.txt']) assert.ok((await readdir(join(dir, 'licenses'))).includes(name), `Missing licence ${name}`);
console.log(`audio assets verified: ${manifest.files.length} files, effects ${effects} bytes, music ${music} bytes`);
