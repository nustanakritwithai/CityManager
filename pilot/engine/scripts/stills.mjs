import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Each run owns a fresh directory. No prior still or contact sheet is replaced.
export async function renderStills({ out, scenes, page, at, stage, buildSheet }) {
  mkdirSync(out, { recursive: true });
  const dir = mkdtempSync(join(out, 'stills-'));
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
  return { dir, sheet };
}

export function contactSheetArgs(dir, sheet, count) {
  if (!Number.isSafeInteger(count) || count < 1) throw new Error('no scenes to render');
  const cols = Math.min(7, count), rows = Math.ceil(count / cols);
  const pattern = join(dir.replaceAll('%', '%%'), '%06d.png');
  return ['-v', 'error', '-y', '-start_number', '1', '-i', pattern, '-vf', `scale=270:480,tile=${cols}x${rows}:padding=6:color=black`, '-frames:v', '1', sheet];
}
