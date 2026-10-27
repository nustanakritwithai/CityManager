import { mkdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';

// Each run owns a fresh directory. No prior still or contact sheet is replaced.
export async function renderStills({ out, scenes, page, at, stage, buildSheet }) {
  mkdirSync(out, { recursive: true });
  const dir = mkdtempSync(join(out, 'stills-'));
  for (const [i, scene] of scenes.entries()) {
    const time = scene.start + (scene.end - scene.start) * at;
    await page.evaluate((tt) => window.seek(tt), time);
    const id = String(scene.id).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80) || 'scene';
    await page.screenshot({ path: join(dir, `${String(i + 1).padStart(2, '0')}-${id}.png`), clip: stage });
    process.stdout.write(`${scene.id} `);
  }
  const sheet = join(dir, 'contact-sheet.png');
  await buildSheet(dir, sheet, scenes.length);
  return { dir, sheet };
}
