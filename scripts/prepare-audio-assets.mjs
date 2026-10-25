// Builds public/assets/audio from official CC0 downloads: Kenney sound packs and three
// OpenGameArt CC0 music tracks. Usage: node scripts/prepare-audio-assets.mjs <stage-dir>
// The stage dir holds the downloaded zips (unpacked next to them) and a music/ folder.
import { readFile, writeFile, mkdir, rm, copyFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const out = join(root, 'public/assets/audio');
const stage = resolve(process.argv[2] ?? '');
assert.ok(process.argv[2], 'Pass the stage directory with the downloaded packs');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

export const PACKS = {
  interface: { name: 'Interface Sounds', author: 'Kenney', url: 'https://kenney.nl/assets/interface-sounds', download: 'https://kenney.nl/media/pages/assets/interface-sounds/fa43c1dd4d-1677589452/kenney_interface-sounds.zip', archive: 'kenney_interface-sounds.zip' },
  impact: { name: 'Impact Sounds', author: 'Kenney', url: 'https://kenney.nl/assets/impact-sounds', download: 'https://kenney.nl/media/pages/assets/impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds.zip', archive: 'kenney_impact-sounds.zip' },
  rpg: { name: 'RPG Audio', author: 'Kenney', url: 'https://kenney.nl/assets/rpg-audio', download: 'https://kenney.nl/media/pages/assets/rpg-audio/8e99002d76-1677590336/kenney_rpg-audio.zip', archive: 'kenney_rpg-audio.zip' },
  jingles: { name: 'Music Jingles', author: 'Kenney', url: 'https://kenney.nl/assets/music-jingles', download: 'https://kenney.nl/media/pages/assets/music-jingles/f37e530b9e-1677590399/kenney_music-jingles.zip', archive: 'kenney_music-jingles.zip' },
  'another-august': { name: 'Another August', author: 'The Cynic Project (cynicmusic.com)', url: 'https://opengameart.org/content/another-august', download: 'https://opengameart.org/sites/default/files/013_Another_August_0.mp3', file: 'music/another-august.mp3' },
  vaporware: { name: 'Calm Piano 1 (Vaporware)', author: 'The Cynic Project (cynicmusic.com)', url: 'https://opengameart.org/content/calm-piano-1-vaporware', download: 'https://opengameart.org/sites/default/files/003_Vaporware_2.mp3', file: 'music/calm-piano-1-vaporware.mp3' },
  'apple-cider': { name: 'Apple Cider', author: 'Zane Little Music', url: 'https://opengameart.org/content/apple-cider', download: 'https://opengameart.org/sites/default/files/apple_cider.ogg', file: 'music/apple-cider.ogg' },
};

/** Runtime name → source pack and original path. Short effects are mono, music stays stereo. */
export const ROSTER = [
  ['ui-click', 'interface', 'Audio/click_002.ogg'], ['ui-select', 'interface', 'Audio/select_002.ogg'],
  ['ui-place', 'interface', 'Audio/drop_002.ogg'], ['ui-road', 'impact', 'Audio/impactPlate_light_000.ogg'],
  ['ui-bulldoze', 'impact', 'Audio/impactWood_heavy_000.ogg'], ['ui-error', 'interface', 'Audio/error_004.ogg'],
  ['ui-save', 'interface', 'Audio/confirmation_002.ogg'], ['ui-open', 'interface', 'Audio/open_002.ogg'],
  ['ui-close', 'interface', 'Audio/close_002.ogg'], ['ui-toggle', 'interface', 'Audio/toggle_002.ogg'],
  ['ev-build-home', 'impact', 'Audio/impactWood_medium_000.ogg'], ['ev-build-business', 'impact', 'Audio/impactMetal_light_000.ogg'],
  ['ev-build-farm', 'impact', 'Audio/impactSoft_medium_000.ogg'], ['ev-arrival', 'rpg', 'Audio/doorOpen_1.ogg'],
  ['ev-month', 'rpg', 'Audio/handleCoins.ogg'], ['ev-shop', 'interface', 'Audio/bong_001.ogg'],
  ['ev-issue', 'interface', 'Audio/question_001.ogg'], ['ev-broke', 'interface', 'Audio/error_007.ogg'],
  ['jingle-level', 'jingles', 'Audio/Steel jingles/jingles_STEEL07.ogg'], ['jingle-win', 'jingles', 'Audio/Sax jingles/jingles_SAX07.ogg'],
  ['music-another-august', 'another-august', null], ['music-vaporware', 'vaporware', null], ['music-apple-cider', 'apple-cider', null],
];

const isMusic = name => name.startsWith('music-');
await rm(out, { recursive: true, force: true }); await mkdir(join(out, 'licenses'), { recursive: true });
const sources = {}, files = [];
for (const [id, pack] of Object.entries(PACKS)) {
  const path = join(stage, pack.archive ?? pack.file), bytes = await readFile(path);
  sources[id] = { ...pack, bytes: bytes.length, sha256: hash(bytes), license: 'CC0-1.0' };
  if (pack.archive) await copyFile(join(stage, pack.archive.replace(/\.zip$/, ''), 'License.txt'), join(out, 'licenses', `${id}.txt`));
}
for (const [name, pack, original] of ROSTER) {
  const input = original ? join(stage, PACKS[pack].archive.replace(/\.zip$/, ''), original) : join(stage, PACKS[pack].file);
  const target = join(out, `${name}.mp3`);
  // No metadata, fixed rate and bitrate: the same input gives the same kind of file on every run.
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', input, '-map_metadata', '-1', '-vn', '-ar', '44100', '-ac', isMusic(name) ? '2' : '1',
    '-b:a', isMusic(name) ? '96k' : '80k', '-id3v2_version', '0', '-write_xing', '0', target]);
  const bytes = await readFile(target), originalBytes = await readFile(input);
  const seconds = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', target]).toString().trim());
  files.push({ path: `${name}.mp3`, source: pack, original: original ?? PACKS[pack].file.replace('music/', ''), originalSha256: hash(originalBytes), bytes: bytes.length, sha256: hash(bytes), seconds: Math.round(seconds * 100) / 100 });
}
await writeFile(join(out, 'licenses', 'opengameart-cc0.txt'), 'The three music tracks (another-august, vaporware, apple-cider) are published on OpenGameArt.org under\nCC0 1.0 Universal (https://creativecommons.org/publicdomain/zero/1.0/). Credit, though not required:\n"Another August" and "Vaporware" by The Cynic Project (cynicmusic.com), "Apple Cider" by Zane Little Music.\n');
const manifest = { schemaVersion: 1, id: 'citymanager-audio', license: 'CC0-1.0', sources, files: files.sort((a, b) => a.path.localeCompare(b.path)) };
await writeFile(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`${files.length} files, ${files.reduce((n, f) => n + f.bytes, 0)} bytes`, (await readdir(out)).length, 'entries');
