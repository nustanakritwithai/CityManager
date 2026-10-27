// Render a story to MP4 (or stills) by seeking the player frame by frame in headless Chromium.
//   node scripts/render.mjs story.yaml --stills [--at 0.8]        scene PNGs and contact sheet in a new out/stills-*/ directory
//   node scripts/render.mjs story.yaml [--workers 2] [--from 0 --to 30] [--fps 24] [--out name]
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';
import { startServer } from './serve.mjs';
import { renderStills, contactSheetArgs } from './stills.mjs';
import { safeOutputName, videoOutput } from './output-files.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const args = process.argv.slice(2);
const storyPath = resolve(args[0]);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i < 0 ? def : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true); };
const stills = opt('stills', false);
const name = stills ? null : safeOutputName(opt('out', 'clip'));
const OUT = join(dirname(storyPath), 'out');
mkdirSync(OUT, { recursive: true });

const run = (cmd, a, input) => new Promise((ok, fail) => {
  const p = spawn(cmd, a, { stdio: [input ? 'pipe' : 'ignore', 'ignore', 'inherit'] });
  p.on('exit', (c) => (c === 0 ? ok() : fail(new Error(`${cmd} exited ${c}`))));
  if (input) input(p.stdin);
});

const { server, port } = await startServer(storyPath);
let browser;
try { browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] }); }
catch (error) { server.close(); throw error; }
let timer;
try {

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

if (stills) {
  const at = Number(opt('at', 0.8)); // fraction into each scene; a list `sub:` shows the part playing then
  const { dir, sheet } = await renderStills({ out: OUT, scenes: SCENES, page: first, at, stage, buildSheet: async (dir, sheet, count) => {
    await run('ffmpeg', contactSheetArgs(dir, sheet, count));
  } });
  console.log();
  console.log(`stills in ${dir}; contact sheet: ${sheet} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
} else {
  const from = Number(opt('from', 0)); const to = Math.min(TOTAL, Number(opt('to', TOTAL)));
  const workers = Number(opt('workers', 2));
  const output = videoOutput(OUT, name);
  const frames = Math.round((to - from) * FPS);
  const per = Math.ceil(frames / workers);
  const pages = [first];
  while (pages.length < workers) pages.push(await openPage());
  let done = 0;
  timer = setInterval(() => console.log(`  ${done}/${frames} frames, ${((Date.now() - t0) / 1000).toFixed(0)}s`), 30000);
  const segs = await Promise.all(pages.map(async (page, w) => {
    const a = w * per; const b = Math.min(frames, a + per);
    const file = join(output.dir, `.seg-${w}.mp4`);
    if (a >= b) return null;
    await run('ffmpeg', ['-v', 'error', '-n', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p', '-r', String(FPS), file], async (stdin) => {
      for (let f = a; f < b; f++) {
        await page.evaluate((tt) => window.seek(tt), from + f / FPS);
        // Heavy 3D frames can take a while in software GL: allow 3 minutes and retry once.
        let buf;
        for (let attempt = 0; !buf; attempt++) {
          try { buf = await page.screenshot({ type: 'jpeg', quality: 92, clip: stage, timeout: 180000 }); } catch (e) { if (attempt) throw e; console.error(`frame ${f}: ${e.name}, retrying`); }
        }
        if (!stdin.write(buf)) await new Promise((r) => stdin.once('drain', r));
        done++;
      }
      stdin.end();
    });
    return file;
  }));
  clearInterval(timer);
  const list = join(output.dir, '.segs.txt');
  writeFileSync(list, segs.filter(Boolean).map((f) => `file '${basename(f)}'`).join('\n'), { flag: 'wx' });
  const mp4 = output.mp4;
  await run('ffmpeg', ['-v', 'error', '-n', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', mp4]);

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
  writeFileSync(output.srt, cues.join('\n'), { flag: 'wx' });
  console.log(`${mp4} — ${frames} frames in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

} finally {
  if (timer) clearInterval(timer);
  try { await browser.close(); } finally { server.close(); }
}
