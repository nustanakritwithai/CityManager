// Checks a story.yaml before rendering, so mistakes cost seconds instead of an hour of render.
//   node scripts/validate.mjs path/to/story.yaml
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const storyPath = resolve(process.argv[2]);
const dir = dirname(storyPath);
let story;
try { story = YAML.parse(readFileSync(storyPath, 'utf8'), { uniqueKeys: true }); } catch (e) { console.error(`YAML error: ${e.message}`); process.exit(1); }

const errors = []; const warns = [];
const E = (m) => errors.push(m); const Wn = (m) => warns.push(m);
const places = story.places || {}; const layers = story.layers || {}; const zones = story.zones || {}; const factions = story.factions || {};
const PANELS = ['army', 'nightForest', 'refugees', 'port'];
const ICONS = ['brokenFlag', 'junk', 'surname', 'stele', 'question'];
const CARDS = ['panel', 'polaroid', 'stat', 'badge', 'quote', 'words', 'image', 'titlecard', 'summary', 'sources'];
const ROUTE_STYLES = ['army', 'people', 'trade', 'faint'];
const PIN_STYLES = ['dot', 'ripple', 'flash', 'siege'];

const place = (ref, where) => {
  if (Array.isArray(ref)) { if (ref.length !== 2 || ref.some((v) => typeof v !== 'number')) E(`${where}: coordinate must be [lng, lat]`); else if (Math.abs(ref[1]) > 85 || Math.abs(ref[0]) > 180) E(`${where}: [${ref}] looks like [lat, lng] — use [lng, lat]`); return; }
  if (typeof ref !== 'string' || !places[ref]) E(`${where}: unknown place "${ref}"`);
};

for (const [id, p] of Object.entries(places)) if (typeof p.lng !== 'number' || typeof p.lat !== 'number') E(`places.${id}: needs numeric lng and lat`);
for (const [id, l] of Object.entries(layers)) {
  if (!['river', 'area', 'line'].includes(l.type)) E(`layers.${id}: type must be river, area or line`);
  if (l.type === 'line' && !l.coords) E(`layers.${id}: line needs coords`);
  if (l.src && !existsSync(join(dir, 'geo', `${l.src}.json`)) && !existsSync(join(ROOT, 'geo', `${l.src}.json`))) E(`layers.${id}: geo/${l.src}.json missing — run build-geo.mjs${l.build ? '' : ' (and add a build: spec)'}`);
  if (l.label && !l.labelAt) E(`layers.${id}: label needs labelAt`);
}
for (const [id, z] of Object.entries(zones)) {
  if (!z.coords && !z.src) E(`zones.${id}: needs coords or src`);
  if (z.src && !existsSync(join(dir, 'geo', `${z.src}.json`))) E(`zones.${id}: geo/${z.src}.json missing`);
  if (z.from) place(z.from, `zones.${id}.from`);
  if (z.label && !z.labelAt) E(`zones.${id}: label needs labelAt`);
}

const scenes = story.scenes || [];
if (!scenes.length) E('no scenes');
if (!scenes.some((s) => s.camera)) E('at least one scene needs a camera');
else if (!scenes[0].camera) Wn('first scene has no camera; it will use the first camera found later');
const ids = new Set();
let total = 0;
for (const s of scenes) {
  const w = `scene ${s.id}`;
  if (!s.id) E('a scene has no id'); else if (ids.has(s.id)) E(`duplicate scene id ${s.id}`); ids.add(s.id);
  if (!(s.dur > 0)) E(`${w}: dur must be > 0`); total += s.dur || 0;
  if (s.camera) {
    place(s.camera.center, `${w}.camera.center`);
    if (typeof s.camera.zoom !== 'number') E(`${w}.camera: zoom required`);
    if ((s.camera.pitch || 0) > 65) Wn(`${w}: pitch ${s.camera.pitch} > 65 renders very slowly`);
  }
  for (const m of s.map || []) if (!layers[m]) E(`${w}.map: unknown layer ${m}`);
  for (const z of s.zones || []) if (!zones[z]) E(`${w}.zones: unknown zone ${z}`);
  for (const p of s.pins || []) { place(p.place, `${w}.pins`); if (p.style && !PIN_STYLES.includes(p.style)) E(`${w}.pins: style ${p.style}?`); }
  for (const r of s.routes || []) { if (!r.id) E(`${w}.routes: id required`); (r.path || []).forEach((p) => place(p, `${w}.routes.${r.id}`)); if (r.style && !ROUTE_STYLES.includes(r.style)) E(`${w}.routes.${r.id}: style ${r.style}?`); }
  for (const u of s.units || []) {
    if (!u.id) E(`${w}.units: id required`);
    if (!factions[u.f]) E(`${w}.units.${u.id}: unknown faction ${u.f}`);
    place(u.at, `${w}.units.${u.id}.at`); if (u.to) place(u.to, `${w}.units.${u.id}.to`);
  }
  for (const v of s.volleys || []) { place(v.from, `${w}.volleys`); place(v.to, `${w}.volleys`); }
  for (const d of s.dots || []) { if (!d.id) E(`${w}.dots: id required`); (d.points || []).forEach((p) => place(p, `${w}.dots.${d.id}`)); }
  for (const c of s.cards || []) {
    if (!CARDS.includes(c.type)) { E(`${w}.cards: unknown type ${c.type}`); continue; }
    if (c.type === 'panel' && !PANELS.includes(c.scene)) E(`${w}.cards.panel: scene must be one of ${PANELS.join(', ')}`);
    if (c.type === 'polaroid' && !ICONS.includes(c.icon)) E(`${w}.cards.polaroid: icon must be one of ${ICONS.join(', ')}`);
    if (c.type === 'image' && c.src?.startsWith('/media/') && !existsSync(join(dir, c.src))) E(`${w}.cards.image: ${c.src} not found next to the story`);
    if (c.leader) place(c.leader, `${w}.cards.leader`);
    if (c.near) place(c.near, `${w}.cards.near`);
  }
  if (s.hud) for (const r of s.hud.rows || []) if (!factions[r.f]) E(`${w}.hud: unknown faction ${r.f}`);
  const subs = Array.isArray(s.sub) ? s.sub : s.sub ? [s.sub] : [];
  // Thai vowel and tone marks take no width, so count base characters only
  for (const t of subs) { const len = t.replace(/\*\*/g, '').replace(/[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/g, '').length; if (len > 60) Wn(`${w}: subtitle ${len} chars may run past 2 lines — split it into a list`); }
  if (s.voice && /\d/.test(s.voice)) Wn(`${w}: voice contains digits — write numbers as Thai words so TTS reads them right`);
}

for (const m of warns) console.log(`warn  ${m}`);
for (const m of errors) console.log(`ERROR ${m}`);
const fps = story.meta?.fps || 30;
console.log(`${scenes.length} scenes · ${total.toFixed(1)}s · ${Math.round(total * fps)} frames @ ${fps}fps · ${errors.length} errors, ${warns.length} warnings`);
process.exit(errors.length ? 1 : 0);
