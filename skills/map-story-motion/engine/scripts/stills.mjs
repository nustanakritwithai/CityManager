import { lstatSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { newOutputDirectory } from './output-files.mjs';

// Each run owns a fresh directory. No prior still or contact sheet is replaced.
export async function renderStills({ out, scenes, page, at, stage, buildSheet }) {
  const dir = newOutputDirectory(out, 'stills-');
  const manifest = [];
  for (const [i, scene] of scenes.entries()) {
    const time = scene.start + (scene.end - scene.start) * at;
    await page.evaluate((tt) => window.seek(tt), time);
    const filename = `${String(i + 1).padStart(6, '0')}.png`;
    await page.screenshot({ path: join(dir, filename), clip: stage });
    manifest.push({ file: filename, scene: String(scene.id), time });
    process.stdout.write(`${scene.id} `);
  }
  writeFileSync(join(dir, 'scenes.json'), JSON.stringify(manifest, null, 2), { flag: 'wx' });
  const sheet = join(dir, 'contact-sheet.png');
  await buildSheet(dir, sheet, scenes.length);
  let stat;
  try { stat = lstatSync(sheet); } catch (error) { if (error.code === 'ENOENT') throw new Error('contact sheet was not created'); throw error; }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0) throw new Error('contact sheet was not created');
  return { dir, sheet };
}

export function contactSheetArgs(dir, sheet, count) {
  if (!Number.isSafeInteger(count) || count < 1) throw new Error('no scenes to render');
  const cols = Math.min(7, count), rows = Math.ceil(count / cols);
  if (resolve(dirname(sheet)) !== resolve(dir)) throw new Error('contact sheet must be in the stills directory');
  // Run FFmpeg with cwd=dir so percent characters in a parent path cannot be read as sequence tokens.
  return ['-v', 'error', '-n', '-start_number', '1', '-i', '%06d.png', '-vf', `scale=270:480,tile=${cols}x${rows}:padding=6:color=black`, '-frames:v', '1', '-update', '1', basename(sheet)];
}
