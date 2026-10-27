// Thai voice-over from each scene's `voice:` text, via Google Translate TTS (unofficial endpoint,
// fine for previews; use a licensed TTS for commercial work).
//   node scripts/voice.mjs story.yaml                 # synthesise + report how each line fits its scene
//   node scripts/voice.mjs story.yaml --fit out.yaml  # write a copy whose scene durations fit the voice
//   node scripts/voice.mjs story.yaml --mux clip.mp4  # mix the voice track into an already rendered clip
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, '.cache/tts');
mkdirSync(CACHE, { recursive: true });
const args = process.argv.slice(2);
const storyPath = resolve(args[0]);
const opt = (n) => { const i = args.indexOf(`--${n}`); return i < 0 ? null : args[i + 1]; };
const TEMPO = Number(opt('tempo') || 1.5); // Google's Thai voice is slow; 1.5× sounded natural in review
const LEAD = 0.35; // seconds of silence before the line starts in its scene
const TAIL = 0.45; // breathing room before the next scene

const story = YAML.parse(readFileSync(storyPath, 'utf8'));
const probe = (f) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString());

// The endpoint takes up to ~200 characters, so long lines are split at spaces.
function chunks(text) {
  const out = []; let cur = '';
  for (const w of text.split(/\s+/)) {
    if ((cur + ' ' + w).trim().length > 180) { out.push(cur.trim()); cur = w; } else cur += ' ' + w;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

async function synth(text, tempo = TEMPO) {
  const key = createHash('sha1').update(`${tempo}|${text}`).digest('hex').slice(0, 16);
  const file = join(CACHE, `${key}.wav`);
  if (existsSync(file)) return file;
  const parts = [];
  for (const [i, c] of chunks(text).entries()) {
    const part = join(CACHE, `${key}-${i}.mp3`);
    if (!existsSync(part)) {
      const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=th&client=tw-ob&q=${encodeURIComponent(c)}`;
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!res.ok) throw new Error(`TTS ${res.status} for: ${c}`);
      writeFileSync(part, Buffer.from(await res.arrayBuffer()));
      await new Promise((r) => setTimeout(r, 400));
    }
    parts.push(part);
  }
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', `concat:${parts.join('|')}`,
    '-af', `atempo=${tempo},silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse`,
    '-ar', '44100', '-ac', '1', file]);
  return file;
}

let t = 0;
const rows = [];
for (const s of story.scenes) {
  const r = { id: s.id, start: t, dur: s.dur };
  if (s.voice) { r.file = await synth(s.voice, s.voiceTempo ?? TEMPO); r.len = probe(r.file); r.need = +(r.len + LEAD + TAIL).toFixed(2); }
  rows.push(r); t += s.dur;
}
console.log('scene  dur   voice  need');
for (const r of rows) console.log(`${r.id.padEnd(6)} ${String(r.dur).padEnd(5)} ${r.len ? r.len.toFixed(2).padEnd(6) : '-     '} ${r.need ? (r.need > r.dur ? `${r.need}  ← ยาวเกิน` : r.need) : ''}`);
const total = rows.reduce((a, r) => a + Math.max(r.dur, r.need || 0), 0);
console.log(`clip ${t}s · fitted ${total.toFixed(1)}s`);

if (opt('fit')) {
  story.scenes.forEach((s, i) => { if (rows[i].need > s.dur) s.dur = Math.ceil(rows[i].need * 4) / 4; });
  writeFileSync(resolve(opt('fit')), YAML.stringify(story, { lineWidth: 0 }));
  console.log('wrote', opt('fit'));
}

if (opt('mux')) {
  const clip = resolve(opt('mux'));
  // Each line starts LEAD into its scene, or just after the previous line ends, and may spill
  // into the next scene's opening as long as it never overlaps the next line.
  const voiced = rows.filter((r) => r.file);
  let prevEnd = 0;
  for (const r of voiced) {
    r.at = Math.max(r.start + LEAD, prevEnd + 0.12); prevEnd = r.at + r.len;
    const spill = prevEnd - (r.start + r.dur);
    if (spill > 0.8) console.warn(`warning: ${r.id} runs ${spill.toFixed(2)}s past its scene`);
  }
  const inputs = voiced.flatMap((r) => ['-i', r.file]);
  const filt = voiced.map((r, i) => `[${i + 1}:a]adelay=${Math.round(r.at * 1000)}:all=1[a${i}]`).join(';')
    + `;${voiced.map((_, i) => `[a${i}]`).join('')}amix=inputs=${voiced.length}:normalize=0,apad[aout]`;
  const out = clip.replace(/\.mp4$/, '-voice.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', clip, ...inputs, '-filter_complex', filt, '-map', '0:v', '-map', '[aout]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart', out]);
  console.log('wrote', out);
}
