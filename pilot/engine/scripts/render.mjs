// Render a story to MP4 (or stills) by seeking the player frame by frame in headless Chromium.
//   node scripts/render.mjs ../tai-kadai-war/story.yaml --stills
//   node scripts/render.mjs ../tai-kadai-war/story.yaml [--workers 4] [--from 0 --to 30] [--out name]
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { startServer } from './serve.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const args = process.argv.slice(2);
const storyPath = resolve(args.find((a) => !a.startsWith('--')) || '../tai-kadai-war/story.yaml');
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i < 0 ? def : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true); };
const OUT = join(dirname(storyPath), 'out');
mkdirSync(OUT, { recursive: true });

const run = (cmd, a, input) => new Promise((ok, fail) => {
  const p = spawn(cmd, a, { stdio: [input ? 'pipe' : 'ignore', 'ignore', 'inherit'] });
  p.on('exit', (c) => (c === 0 ? ok() : fail(new Error(`${cmd} exited ${c}`))));
  if (input) input(p.stdin);
});

const { server, port } = await startServer(storyPath);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });

async function openPage() {
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error('[page error]', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.error('[console]', m.text()); });
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.READY === true, null, { timeout: 120000 });
  return page;
}

const t0 = Date.now();
const first = await openPage();
const info = await first.evaluate(() => ({ TOTAL: window.TOTAL, FPS: window.FPS, SCENES: window.SCENES }));
const { TOTAL, SCENES } = info;
const FPS = Number(opt('fps', info.FPS));
console.log(`story: ${SCENES.length} scenes, ${TOTAL}s @ ${FPS}fps`);

const stage = { x: 0, y: 0, width: 1080, height: 1920 };

if (opt('stills', false)) {
  const dir = join(OUT, 'stills'); mkdirSync(dir, { recursive: true });
  const at = Number(opt('at', 0.8));
  for (const s of SCENES) {
    const t = s.start + (s.end - s.start) * at;
    await first.evaluate((tt) => window.seek(tt), t);
    await first.screenshot({ path: join(dir, `${s.id}.png`), clip: stage });
    process.stdout.write(`${s.id} `);
  }
  console.log();
  const cols = 7; const rows = Math.ceil(SCENES.length / cols);
  await run('ffmpeg', ['-v', 'error', '-y', '-pattern_type', 'glob', '-i', join(dir, 's*.png'), '-vf', `scale=270:480,tile=${cols}x${rows}:padding=6:color=black`, '-frames:v', '1', join(OUT, 'contact-sheet.png')]);
  console.log(`stills + contact sheet in ${OUT} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
} else {
  const from = Number(opt('from', 0)); const to = Math.min(TOTAL, Number(opt('to', TOTAL)));
  const workers = Number(opt('workers', 4));
  const name = opt('out', 'clip');
  const frames = Math.round((to - from) * FPS);
  const per = Math.ceil(frames / workers);
  const pages = [first];
  while (pages.length < workers) pages.push(await openPage());
  let done = 0;
  const timer = setInterval(() => console.log(`  ${done}/${frames} frames, ${((Date.now() - t0) / 1000).toFixed(0)}s`), 30000);
  const segs = await Promise.all(pages.map(async (page, w) => {
    const a = w * per; const b = Math.min(frames, a + per);
    const file = join(OUT, `.seg-${w}.mp4`);
    if (a >= b) return null;
    await run('ffmpeg', ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p', '-r', String(FPS), file], async (stdin) => {
      for (let f = a; f < b; f++) {
        await page.evaluate((tt) => window.seek(tt), from + f / FPS);
        const buf = await page.screenshot({ type: 'jpeg', quality: 92, clip: stage });
        if (!stdin.write(buf)) await new Promise((r) => stdin.once('drain', r));
        done++;
      }
      stdin.end();
    });
    return file;
  }));
  clearInterval(timer);
  const list = join(OUT, '.segs.txt');
  writeFileSync(list, segs.filter(Boolean).map((f) => `file '${f}'`).join('\n'));
  const mp4 = join(OUT, `${name}.mp4`);
  await run('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', mp4]);

  // Subtitles: one cue per scene (or per part when a scene has several).
  const ts = (x) => { const ms = Math.round((x - from) * 1000); const p = (n, l = 2) => String(n).padStart(l, '0'); return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`; };
  const cues = [];
  for (const s of SCENES) {
    const parts = (Array.isArray(s.sub) ? s.sub : [s.sub]).filter(Boolean);
    parts.forEach((p, j) => {
      const len = (s.end - s.start) / parts.length; const a = s.start + j * len; const b = a + len;
      if (b <= from || a >= to) return;
      cues.push(`${cues.length + 1}\n${ts(Math.max(a, from))} --> ${ts(Math.min(b, to))}\n${p.replace(/\*\*/g, '')}\n`);
    });
  }
  writeFileSync(join(OUT, `${name}.srt`), cues.join('\n'));
  console.log(`${mp4} — ${frames} frames in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

await browser.close();
server.close();
