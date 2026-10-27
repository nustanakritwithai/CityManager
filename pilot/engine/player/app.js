// map-story-motion player. Everything on screen is a pure function of one time value t,
// so window.seek(t) always produces the same frame (needed for frame-by-frame rendering).
import { panels, icons } from './kit.js';
import { createTactical } from './tactical.js';

const W = 1080;
const H = 1920;
const PAD = { top: 0, bottom: Math.round(H * 0.26), left: 0, right: 0 }; // map focus sits ~37% from top
const COLORS = { gold: '#ffd54a', red: '#ff5a4e', violet: '#b07cff', blue: '#5ab8ff', teal: '#4fe0c0', orange: '#ff9a3c', white: '#ffffff', river: '#8fd0ff' };
const col = (c) => COLORS[c] || c || COLORS.gold;

const story = await (await fetch('/story.json')).json();
const places = story.places || {};
const P = (ref) => {
  if (Array.isArray(ref)) return ref;
  const p = places[ref];
  if (!p) throw new Error(`unknown place: ${ref}`);
  return [p.lng, p.lat];
};
const placeName = (ref) => (typeof ref === 'string' && places[ref]?.name) || '';

// ---------- easing / helpers ----------
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, k) => a + (b - a) * k;
const inOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);
const outBack = (k) => { const c = 1.6; return 1 + (c + 1) * (k - 1) ** 3 + c * (k - 1) ** 2; };
const outCubic = (k) => 1 - (1 - k) ** 3;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const rich = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');

// ---------- timeline ----------
let acc = 0;
const scenes = story.scenes.map((s, i) => { const o = { ...s, i, start: acc }; acc += s.dur; o.end = acc; return o; });
const TOTAL = acc;
const sceneAt = (t) => scenes.find((s) => t < s.end) || scenes.at(-1);

// Which scenes contain an element with this key, and when did its current run start?
function runInfo(i, has) {
  if (!has(scenes[i])) return null;
  let a = i; while (a > 0 && has(scenes[a - 1])) a--;
  let b = i; while (b < scenes.length - 1 && has(scenes[b + 1])) b++;
  return { start: scenes[a].start, end: scenes[b].end };
}
// Opacity/age of a keyed element at time t: fades in when its run starts, out over the first
// 0.5s of the scene after its run ends.
function life(t, s, has, fadeIn = 0.7) {
  const r = runInfo(s.i, has);
  if (r) return { age: t - r.start, alpha: clamp((t - r.start) / fadeIn), leaving: 1 - clamp((r.end - t) / 0.35), runEnd: r.end };
  if (s.i > 0 && has(scenes[s.i - 1])) {
    const out = 1 - clamp((t - s.start) / 0.5);
    if (out > 0) { const pr = runInfo(s.i - 1, has); return { age: t - pr.start, alpha: out, out: true }; }
  }
  return null;
}

// ---------- camera ----------
const merc = (c) => maplibregl.MercatorCoordinate.fromLngLat(c);
{
  const first = scenes.find((s) => s.camera)?.camera;
  let prev = { c: P(first.center), z: first.zoom, b: first.bearing || 0, p: first.pitch || 0, f: first.focus ?? 0.37 };
  for (const s of scenes) {
    const cam = s.camera;
    s.camStart = prev;
    s.camTarget = cam ? { c: P(cam.center), z: cam.zoom, b: cam.bearing ?? 0, p: cam.pitch ?? 0, f: cam.focus ?? 0.37 } : prev;
    s.move = cam ? (cam.move || 'fly') : 'hold';
    s.moveDur = s.move === 'hold' || s.move === 'cut' ? 0 : (cam.moveDur ?? Math.min(2.4, s.dur * 0.42));
    s.drift = cam?.drift ?? 0.12;
    const a = merc(s.camStart.c); const b = merc(s.camTarget.c);
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    const zFit = Math.log2(W / (512 * Math.max(d * 1.5, 1e-9)));
    s.dip = s.move === 'fly' ? Math.max(0, Math.min(s.camStart.z, s.camTarget.z) - zFit) : 0;
    prev = { c: s.camTarget.c, z: s.camTarget.z + s.drift, b: s.camTarget.b + (cam?.orbit ?? 0), p: s.camTarget.p, f: s.camTarget.f };
  }
}
function cameraAt(t) {
  const s = sceneAt(t);
  const u = t - s.start;
  if (u < s.moveDur) {
    const k = inOut(u / s.moveDur);
    const a = merc(s.camStart.c); const b = merc(s.camTarget.c);
    const c = new maplibregl.MercatorCoordinate(lerp(a.x, b.x, k), lerp(a.y, b.y, k)).toLngLat();
    return { center: [c.lng, c.lat], zoom: lerp(s.camStart.z, s.camTarget.z, k) - s.dip * Math.sin(Math.PI * k), bearing: lerp(s.camStart.b, s.camTarget.b, k), pitch: lerp(s.camStart.p, s.camTarget.p, k), focus: lerp(s.camStart.f, s.camTarget.f, k) };
  }
  const hold = s.dur - s.moveDur;
  const h = clamp((u - s.moveDur) / hold);
  return { center: s.camTarget.c, zoom: s.camTarget.z + s.drift * h, bearing: s.camTarget.b + (s.camera?.orbit ?? 0) * h, pitch: s.camTarget.p, focus: s.camTarget.f };
}

// ---------- map ----------
const BASEMAPS = {
  bluemarble: { layer: 'bluemarble_3857', maxzoom: 8, paint: { 'raster-brightness-max': 0.9, 'raster-saturation': -0.35, 'raster-contrast': 0.15 } },
  sentinel2016: { layer: 's2cloudless_3857', maxzoom: 12, paint: { 'raster-brightness-max': 0.58, 'raster-saturation': -0.3, 'raster-contrast': 0.1 } },
};
const BASEMAP = BASEMAPS[story.meta?.basemap || 'bluemarble'];
// Close-up scenes can cross-fade to sharper imagery with `imagery: sentinel2016`.
const DETAIL = BASEMAPS.sentinel2016;
const TERRAIN = story.meta?.terrain;
const cam0 = cameraAt(0);
const map = new maplibregl.Map({
  container: 'map', interactive: false, pixelRatio: story.meta?.mapPixelRatio ?? 1, attributionControl: false, fadeDuration: 0, preserveDrawingBuffer: true,
  center: cam0.center, zoom: cam0.zoom, maxZoom: 13, maxPitch: 72,
  style: {
    version: 8,
    sources: {
      sat: { type: 'raster', tiles: [`/tiles/${BASEMAP.layer}/{z}/{y}/{x}.jpg`], tileSize: 256, maxzoom: BASEMAP.maxzoom },
      detail: { type: 'raster', tiles: [`/tiles/${DETAIL.layer}/{z}/{y}/{x}.jpg`], tileSize: 256, maxzoom: DETAIL.maxzoom },
      ...(TERRAIN ? {
        dem: { type: 'raster-dem', tiles: ['/dem/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 12, encoding: 'terrarium' },
        hs: { type: 'raster-dem', tiles: ['/dem/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 12, encoding: 'terrarium' },
      } : {}),
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#05070c' } },
      { id: 'sat', type: 'raster', source: 'sat', paint: { ...BASEMAP.paint, 'raster-fade-duration': 0 } },
      { id: 'detail', type: 'raster', source: 'detail', paint: { ...DETAIL.paint, 'raster-brightness-max': 0.8, 'raster-opacity': 0, 'raster-fade-duration': 0 } },
      ...(TERRAIN ? [{ id: 'hillshade', type: 'hillshade', source: 'hs', paint: { 'hillshade-exaggeration': TERRAIN.shade ?? 0.45, 'hillshade-shadow-color': '#000814', 'hillshade-highlight-color': '#ffffff', 'hillshade-accent-color': '#000000' } }] : []),
      // tactical tint sits right above the imagery so story layers keep their own colours
      ...(story.meta?.tint ? [{ id: 'tint', type: 'background', paint: { 'background-color': story.meta.tint.color, 'background-opacity': story.meta.tint.opacity ?? 0.3 } }] : []),
    ],
  },
});
await new Promise((ok) => map.on('load', ok));
map.setPadding(PAD);
// Terrain and hillshade are costly in software GL, so they are switched on only around tilted scenes.
const tilted = (sc) => sc.camStart.p > 0 || sc.camTarget.p > 0;
let terrainOn = null;
function setRelief(on) {
  if (!TERRAIN || terrainOn === on) return;
  terrainOn = on;
  map.setTerrain(on ? { source: 'dem', exaggeration: TERRAIN.exaggeration ?? 1.5 } : null);
  map.setLayoutProperty('hillshade', 'visibility', on ? 'visible' : 'none');
}
setRelief(false);

function hatchImage(color) {
  const c = document.createElement('canvas'); c.width = c.height = 28;
  const g = c.getContext('2d');
  g.strokeStyle = color; g.globalAlpha = 0.55; g.lineWidth = 5;
  for (let k = -28; k <= 56; k += 14) { g.beginPath(); g.moveTo(k, 28); g.lineTo(k + 28, 0); g.stroke(); }
  return g.getImageData(0, 0, 28, 28);
}

const L = story.layers || {};
for (const [id, def] of Object.entries(L)) {
  const data = def.coords ? { type: 'Feature', geometry: { type: 'LineString', coordinates: def.coords } } : `/geo/${def.src}.json`;
  map.addSource(id, { type: 'geojson', data, lineMetrics: def.type === 'river' });
  const c = col(def.color);
  if (def.type === 'river') {
    map.addLayer({ id: `${id}-glow`, type: 'line', source: id, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-width': 10, 'line-blur': 7, 'line-opacity': 0, 'line-color': c } });
    map.addLayer({ id: `${id}-line`, type: 'line', source: id, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-width': def.width || 3.2, 'line-opacity': 0, 'line-color': c } });
  } else if (def.type === 'line') {
    map.addLayer({ id: `${id}-line`, type: 'line', source: id, paint: { 'line-width': 3, 'line-opacity': 0, 'line-color': c, 'line-dasharray': [3, 2.5] } });
  } else {
    map.addLayer({ id: `${id}-fill`, type: 'fill', source: id, paint: { 'fill-color': c, 'fill-opacity': 0 } });
    if (def.style === 'hatch') {
      map.addImage(`hatch-${id}`, hatchImage(c));
      map.addLayer({ id: `${id}-hatch`, type: 'fill', source: id, paint: { 'fill-pattern': `hatch-${id}`, 'fill-opacity': 0 } });
    }
    map.addLayer({ id: `${id}-glow2`, type: 'line', source: id, layout: { 'line-join': 'round' }, paint: { 'line-width': 22, 'line-blur': 16, 'line-opacity': 0, 'line-color': c } });
    map.addLayer({ id: `${id}-glow1`, type: 'line', source: id, layout: { 'line-join': 'round' }, paint: { 'line-width': 9, 'line-blur': 5, 'line-opacity': 0, 'line-color': c } });
    map.addLayer({ id: `${id}-edge`, type: 'line', source: id, layout: { 'line-join': 'round' }, paint: { 'line-width': 3, 'line-opacity': 0, 'line-color': '#fff' } });
  }
}
await new Promise((ok) => { if (map.loaded()) ok(); else map.once('idle', ok); });

const paintCache = new Map();
function paint(layer, prop, value) {
  const k = `${layer}|${prop}`;
  const v = JSON.stringify(value);
  if (paintCache.get(k) === v) return;
  paintCache.set(k, v);
  map.setPaintProperty(layer, prop, value);
}
const gradient = (c, p) => (p >= 1 ? ['interpolate', ['linear'], ['line-progress'], 0, c, 1, c]
  : p <= 0 ? ['interpolate', ['linear'], ['line-progress'], 0, 'rgba(0,0,0,0)', 1, 'rgba(0,0,0,0)']
    : ['interpolate', ['linear'], ['line-progress'], 0, c, p, c, Math.min(1, p + 0.002), 'rgba(0,0,0,0)']);

function updateLayers(t, s, out) {
  for (const [id, def] of Object.entries(L)) {
    const lf = life(t, s, (sc) => (sc.map || []).includes(id), def.type === 'river' ? 0.3 : 0.9);
    const a = lf ? lf.alpha : 0;
    const c = col(def.color);
    if (def.type === 'river') {
      const p = lf ? clamp(lf.age / (def.draw ?? 2.2)) : 0;
      paint(`${id}-line`, 'line-opacity', a * 0.95); paint(`${id}-glow`, 'line-opacity', a * 0.55);
      paint(`${id}-line`, 'line-gradient', gradient(c, outCubic(p))); paint(`${id}-glow`, 'line-gradient', gradient(c, outCubic(p)));
    } else if (def.type === 'line') {
      paint(`${id}-line`, 'line-opacity', a * 0.8);
    } else {
      const pulse = def.pulse && lf ? 0.5 + 0.5 * Math.sin(lf.age * 3) : 1;
      paint(`${id}-fill`, 'fill-opacity', a * (def.fill ?? 0.22));
      if (def.style === 'hatch') paint(`${id}-hatch`, 'fill-opacity', a);
      paint(`${id}-glow2`, 'line-opacity', a * 0.55 * pulse); paint(`${id}-glow1`, 'line-opacity', a * 0.9);
      paint(`${id}-edge`, 'line-opacity', a * 0.85);
    }
    if (a > 0 && def.label && def.type !== 'river') out.push({ kind: 'region', def, a, id });
  }
}

// ---------- overlay geometry ----------
const proj = (ll) => { const p = map.project(ll); return [p.x, p.y]; };
function routePath(r) {
  const pts = r.path.map(P);
  let geo;
  if (pts.length === 2) {
    const a = merc(pts[0]); const b = merc(pts[1]);
    const dx = b.x - a.x; const dy = b.y - a.y; const k = r.curve ?? 0.18;
    const cx = (a.x + b.x) / 2 - dy * k; const cy = (a.y + b.y) / 2 + dx * k;
    geo = [];
    for (let i = 0; i <= 48; i++) {
      const u = i / 48;
      const x = (1 - u) ** 2 * a.x + 2 * (1 - u) * u * cx + u * u * b.x;
      const y = (1 - u) ** 2 * a.y + 2 * (1 - u) * u * cy + u * u * b.y;
      const ll = new maplibregl.MercatorCoordinate(x, y).toLngLat(); geo.push([ll.lng, ll.lat]);
    }
  } else {
    // Catmull-Rom through all points
    geo = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)]; const p1 = pts[i]; const p2 = pts[i + 1]; const p3 = pts[Math.min(pts.length - 1, i + 2)];
      for (let j = 0; j < 16; j++) {
        const u = j / 16; const u2 = u * u; const u3 = u2 * u;
        geo.push([0, 1].map((d) => 0.5 * (2 * p1[d] + (-p0[d] + p2[d]) * u + (2 * p0[d] - 5 * p1[d] + 4 * p2[d] - p3[d]) * u2 + (-p0[d] + 3 * p1[d] - 3 * p2[d] + p3[d]) * u3)));
      }
    }
    geo.push(pts.at(-1));
  }
  return geo.map(proj);
}
function cut(poly, p) {
  const seg = []; let total = 0;
  for (let i = 1; i < poly.length; i++) { const d = Math.hypot(poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1]); seg.push(d); total += d; }
  let left = total * p; const out = [poly[0]];
  for (let i = 1; i < poly.length && left > 0; i++) {
    if (seg[i - 1] <= left) { out.push(poly[i]); left -= seg[i - 1]; continue; }
    const k = left / seg[i - 1];
    out.push([lerp(poly[i - 1][0], poly[i][0], k), lerp(poly[i - 1][1], poly[i][1], k)]); left = 0;
  }
  return out;
}
const pts2d = (a) => a.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
function arrowHead(poly, size, color) {
  if (poly.length < 2) return '';
  const [x, y] = poly.at(-1); const [px, py] = poly.at(-2);
  const ang = Math.atan2(y - py, x - px);
  const pt = (a, r) => [x + Math.cos(ang + a) * r, y + Math.sin(ang + a) * r];
  const tip = pt(0, size * 0.5); const l = pt(2.5, size * 0.75); const r = pt(-2.5, size * 0.75);
  return `<polygon points="${pts2d([tip, l, r])}" fill="${color}" stroke="#0b0d14" stroke-width="3" stroke-linejoin="round"/>`;
}

const ROUTE = {
  army: { w: 15, dash: '', arrow: 46, halo: 23 },
  people: { w: 8, dash: '20 14', arrow: 32, halo: 13 },
  trade: { w: 6, dash: '14 12', arrow: 26, halo: 10 },
  faint: { w: 6, dash: '10 12', arrow: 24, halo: 0 },
};

function overlaySVG(t, s, labels) {
  const out = [tactical.zonesSVG(t, s, labels)];
  // routes
  const routeKeys = new Set(scenes.flatMap((sc) => (sc.routes || []).map((r) => r.id)));
  for (const key of routeKeys) {
    const has = (sc) => (sc.routes || []).some((r) => r.id === key);
    const lf = life(t, s, has, 0.3); if (!lf) continue;
    const r = (s.routes || []).find((x) => x.id === key) || (scenes[s.i - 1].routes || []).find((x) => x.id === key);
    const st = ROUTE[r.style || 'army']; const c = col(r.color || 'red');
    const p = clamp((lf.age - (r.at ?? 0.3)) / (r.draw ?? 1.8)); if (p <= 0) continue;
    const poly = cut(routePath(r), inOut(p));
    const op = lf.alpha * (r.opacity ?? 1);
    out.push(`<g opacity="${op.toFixed(3)}">`);
    if (st.halo) out.push(`<polyline points="${pts2d(poly)}" fill="none" stroke="#0b0d14" stroke-opacity=".55" stroke-width="${st.halo}" stroke-linecap="round" stroke-linejoin="round" ${st.dash ? `stroke-dasharray="${st.dash}"` : ''}/>`);
    out.push(`<polyline points="${pts2d(poly)}" fill="none" stroke="${c}" stroke-width="${st.w}" stroke-linecap="round" stroke-linejoin="round" ${st.dash ? `stroke-dasharray="${st.dash}"` : ''}/>`);
    if (r.arrow !== false) out.push(arrowHead(poly, st.arrow, c));
    out.push('</g>');
  }
  // dots (point clusters)
  const dotKeys = new Set(scenes.flatMap((sc) => (sc.dots || []).map((d) => d.id)));
  for (const key of dotKeys) {
    const has = (sc) => (sc.dots || []).some((d) => d.id === key);
    const lf = life(t, s, has, 0.3); if (!lf) continue;
    const d = (s.dots || []).find((x) => x.id === key) || (scenes[s.i - 1].dots || []).find((x) => x.id === key);
    d.points.forEach((pt, j) => {
      const k = clamp((lf.age - (d.at ?? 0.4) - j * 0.07) / 0.35); if (k <= 0) return;
      const [x, y] = proj(P(pt));
      const rr = (d.r ?? 13) * outBack(k);
      out.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${rr.toFixed(1)}" fill="${col(d.color)}" stroke="#fff" stroke-width="3.5" opacity="${lf.alpha.toFixed(3)}"/>`);
    });
    if (d.label && lf.age > (d.at ?? 0.4) + 0.4) labels.push({ kind: 'text', at: d.labelAt, text: d.label, color: col(d.color), a: lf.alpha * clamp((lf.age - (d.at ?? 0.4) - 0.4) / 0.4), cls: 'small' });
  }
  out.push(tactical.unitsSVG(t, s));
  out.push(tactical.volleysSVG(t, s));
  // pins
  const pinKeys = new Set(scenes.flatMap((sc) => (sc.pins || []).map((p) => p.id || p.place)));
  for (const key of pinKeys) {
    const has = (sc) => (sc.pins || []).some((p) => (p.id || p.place) === key);
    const lf = life(t, s, has, 0.25); if (!lf) continue;
    const pin = (s.pins || []).find((x) => (x.id || x.place) === key) || (scenes[s.i - 1].pins || []).find((x) => (x.id || x.place) === key);
    const k = clamp((lf.age - (pin.at ?? 0.3)) / 0.45); if (k <= 0) continue;
    const [x, y] = proj(P(pin.place));
    const c = col(pin.color || 'gold'); const sc = outBack(k); const a = lf.alpha;
    const st = pin.style || 'dot';
    out.push(`<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)})" opacity="${a.toFixed(3)}">`);
    if (st === 'ripple' || st === 'flash') {
      for (let j = 0; j < 2; j++) {
        const ph = ((lf.age * 0.7 + j * 0.5) % 1);
        out.push(`<circle r="${(18 + ph * 70).toFixed(1)}" fill="none" stroke="${c}" stroke-width="${(5 * (1 - ph)).toFixed(2)}" opacity="${(1 - ph).toFixed(3)}"/>`);
      }
      if (st === 'flash') out.push(`<circle r="${(26 + 8 * Math.sin(lf.age * 9)).toFixed(1)}" fill="${c}" opacity=".35"/>`);
    }
    if (st === 'siege') {
      const rot = (lf.age * 40) % 360;
      out.push(`<g transform="rotate(${rot.toFixed(1)})">`);
      for (let j = 0; j < 10; j++) { const an = (j / 10) * Math.PI * 2; out.push(`<rect x="-8" y="-8" width="16" height="16" transform="translate(${(Math.cos(an) * 62).toFixed(1)} ${(Math.sin(an) * 62).toFixed(1)}) rotate(45)" fill="${c}" stroke="#fff" stroke-width="2"/>`); }
      out.push(`<circle r="62" fill="none" stroke="${c}" stroke-width="3" stroke-dasharray="8 10"/></g>`);
    }
    out.push(`<circle r="${(14 * sc).toFixed(1)}" fill="${c}" stroke="#fff" stroke-width="5"/>`);
    out.push('</g>');
    const name = pin.label ?? placeName(pin.place);
    if (name) labels.push({ kind: 'pin', xy: [x, y - 24 * sc], text: name, a: a * clamp(k * 1.5), sub: pin.sub, cls: pin.small ? 'small' : '' });
  }
  return out.join('');
}

// ---------- cards ----------
const cardsEl = document.getElementById('cards');
const zones = new Map();
function cardHTML(c) {
  const accent = c.color ? ` style="--accent:${col(c.color)}"` : '';
  switch (c.type) {
    case 'panel': return `<div class="card panel"${accent}><svg viewBox="0 0 940 340" preserveAspectRatio="xMidYMid slice"></svg></div>`;
    case 'polaroid': return `<div class="card polaroid"><div class="ph"><svg viewBox="0 0 264 230"></svg></div><div class="cap">${esc(c.caption || '')}</div></div>`;
    case 'stat': return `<div class="card stat"${accent}><div class="v" data-v="${esc(c.value)}">${esc(c.value)}</div><div class="lb">${rich(c.label || '')}</div></div>`;
    case 'badge': return `<div class="card badge"${accent}>${rich(c.text)}</div>`;
    case 'quote': return `<div class="card quote"><div class="q">${rich(c.text)}</div>${c.by ? `<div class="by">— ${esc(c.by)}</div>` : ''}</div>`;
    case 'words': return `<div class="card words">${c.items.map((it, j) => `<div class="word${j === 0 && c.lead ? ' big' : ''}"><div class="w">${esc(it.w ?? it)}</div>${it.n ? `<div class="n">${esc(it.n)}</div>` : ''}</div>`).join('')}</div>`;
    case 'image': return `<div class="card image"><img src="${esc(c.src)}">${c.caption ? `<div class="cap">${esc(c.caption)}</div>` : ''}</div>`;
    case 'titlecard': return `<div class="card titlecard"${accent}><div class="t">${rich(c.text)}</div>${c.sub ? `<div class="s">${rich(c.sub)}</div>` : ''}</div>`;
    case 'summary': return `<div class="card summary"><div class="h">${esc(c.title || 'สรุป')}</div>${c.items.map((it, j) => `<div class="it"><div class="n">${j + 1}</div><div>${rich(it)}</div></div>`).join('')}</div>`;
    case 'sources': return `<div class="card sources"><div class="h">${esc(c.title || 'ข้อมูลแผนที่')}</div>${c.items.map((it) => `<div>${esc(it)}</div>`).join('')}</div>`;
    default: throw new Error(`unknown card type ${c.type}`);
  }
}
function zoneFor(s) {
  if (zones.has(s.i)) return zones.get(s.i);
  const z = document.createElement('div'); z.className = 'zone';
  if (s.zoneTop) z.style.top = `${s.zoneTop}px`;
  const free = [];
  const els = (s.cards || []).map((c) => {
    const tmp = document.createElement('div'); tmp.innerHTML = cardHTML(c);
    const el = tmp.firstElementChild;
    if (c.near || c.xy) { free.push(el); el.style.position = 'absolute'; cardsEl.appendChild(el); } else z.appendChild(el);
    return el;
  });
  cardsEl.appendChild(z);
  const entry = { z, els };
  zones.set(s.i, entry);
  return entry;
}
const countUp = (v, k) => {
  const m = String(v).match(/^([^\d]*)([\d,]+)(.*)$/);
  if (!m) return v;
  const n = Number(m[2].replace(/,/g, ''));
  return m[1] + Math.round(n * k).toLocaleString('en-US') + m[3];
};

function updateCards(t, s, svgExtra) {
  for (const [i, { z, els }] of zones) if (i !== s.i) { z.style.display = 'none'; els.forEach((e) => { e.style.display = 'none'; }); }
  if (!s.cards?.length) return;
  const { z, els } = zoneFor(s);
  z.style.display = 'flex';
  const u = t - s.start;
  s.cards.forEach((c, j) => {
    const el = els[j]; el.style.display = '';
    const at = c.at ?? 0.35 + j * 0.3;
    const k = clamp((u - at) / 0.5);
    const outK = c.until != null ? clamp((u - c.until) / 0.3) : clamp((u - (s.dur - 0.35)) / 0.35);
    const vis = k * (1 - outK);
    const tilt = c.tilt ?? (c.type === 'polaroid' ? (j % 2 ? 3 : -4) : 0);
    const sc = k < 1 ? 0.6 + 0.4 * outBack(k) : 1 - 0.15 * outK;
    if (c.near || c.xy) {
      const [x, y] = c.xy || proj(P(c.near));
      const [dx, dy] = c.offset || [80, -120];
      el.style.left = `${clamp(x + dx, 30, W - 360)}px`; el.style.top = `${clamp(y + dy, 360, 1300)}px`;
    }
    el.style.opacity = vis.toFixed(3);
    el.style.transform = `translateY(${((1 - k) * 40).toFixed(1)}px) scale(${sc.toFixed(4)}) rotate(${tilt}deg)`;
    if (c.type === 'panel') el.firstElementChild.innerHTML = panels[c.scene](Math.max(0, u - at), c);
    if (c.type === 'polaroid') el.querySelector('svg').innerHTML = icons[c.icon](Math.max(0, u - at));
    if (c.type === 'stat') { const v = el.querySelector('.v'); v.textContent = countUp(v.dataset.v, outCubic(clamp((u - at) / 1.1))); }
    if (c.leader && vis > 0) {
      const [px, py] = proj(P(c.leader));
      const ex = z.offsetLeft + el.offsetLeft + el.offsetWidth / 2;
      const ey = z.offsetTop + el.offsetTop;
      svgExtra.push(`<line x1="${px.toFixed(1)}" y1="${(py + 16).toFixed(1)}" x2="${ex.toFixed(1)}" y2="${ey.toFixed(1)}" stroke="#fff" stroke-width="4" stroke-dasharray="3 10" stroke-linecap="round" opacity="${(vis * 0.9).toFixed(3)}"/>`);
    }
  });
}

// ---------- text ----------
const titleEl = document.getElementById('title');
const eraEl = document.getElementById('era');
const subEl = document.getElementById('sub');
const labelsEl = document.getElementById('labels');
const creditsEl = document.getElementById('credits');
const overlay = document.getElementById('overlay');
const nightEl = document.getElementById('night');
const shakeEl = document.getElementById('shake');
creditsEl.textContent = story.meta?.credits || '';
const tactical = createTactical({ story, scenes, P, proj, col, life, clamp, inOut, outBack, outCubic, esc, merc });
await tactical.load();

let lastTitleKey = '';
let lastSubKey = '';
function titleFor(i) { for (let j = i; j >= 0; j--) if (scenes[j].title) return { lines: scenes[j].title, from: j }; return null; }
function updateText(t, s) {
  const tt = titleFor(s.i);
  const tKey = tt ? JSON.stringify(tt.lines) : '';
  if (tKey !== lastTitleKey) {
    titleEl.innerHTML = tt ? tt.lines.map((l) => `<span class="l outline${l.startsWith('!') ? ' red' : ''}">${rich(l.replace(/^!/, ''))}</span>`).join('') : '';
    lastTitleKey = tKey;
  }
  if (tt) {
    const k = clamp((t - scenes[tt.from].start) / 0.5);
    titleEl.style.opacity = k.toFixed(3);
    titleEl.style.transform = `scale(${(0.85 + 0.15 * outBack(k)).toFixed(4)})`;
  }
  const u = t - s.start;
  if (s.era) {
    // era: "text" or { count: [from, to], prefix, suffix, dur } for a ticking year counter
    const e = s.era;
    const txt = typeof e === 'string' ? e : `${e.prefix || ''}${Math.round(lerp(e.count[0], e.count[1], inOut(clamp((u - 0.4) / (e.dur ?? Math.max(1, s.dur - 2))))))}${e.suffix || ''}`;
    if (eraEl.dataset.k !== txt) { eraEl.textContent = txt; eraEl.dataset.k = txt; }
    const k = clamp((u - 0.2) / 0.4) * (1 - clamp((u - s.dur + 0.3) / 0.3));
    eraEl.style.opacity = k.toFixed(3); eraEl.style.display = '';
    eraEl.style.top = `${s.eraTop || (tt && tt.lines.length > 1 ? 300 : 210)}px`;
  } else eraEl.style.display = 'none';
  // A scene's sub may be a list: the parts share the scene time equally.
  const parts = Array.isArray(s.sub) ? s.sub : [s.sub || ''];
  const pi = Math.min(parts.length - 1, Math.floor((u / s.dur) * parts.length));
  const pLen = s.dur / parts.length; const pu = u - pi * pLen;
  const sKey = `${s.i}:${pi}`;
  if (sKey !== lastSubKey) { subEl.innerHTML = parts[pi] ? `<span class="outline">${rich(parts[pi])}</span>` : ''; lastSubKey = sKey; }
  const single = parts.length === 1;
  const nextSame = single && scenes[s.i + 1]?.sub === s.sub;
  const prevSame = single && scenes[s.i - 1]?.sub === s.sub;
  subEl.style.opacity = ((prevSame ? 1 : clamp((pu - 0.1) / 0.25)) * (nextSame ? 1 : 1 - clamp((pu - pLen + 0.18) / 0.18))).toFixed(3);
  creditsEl.style.opacity = s.credits === false ? '0' : '1';
}

// Labels are placed in priority order (pins, then dot groups, regions, rivers). A label that would
// overlap one already placed tries the other sides of its anchor, and is dropped if none fit.
const measureCtx = document.createElement('canvas').getContext('2d');
const textW = (text, px, weight) => { measureCtx.font = `${weight} ${px}px Kanit`; return measureCtx.measureText(text).width; };
const TOP_LIMIT = 330; const BOTTOM_LIMIT = 1350;
function renderLabels(items, blocked = []) {
  const html = []; const boxes = [...blocked];
  const free = (b) => b.y0 > TOP_LIMIT && b.y1 < BOTTOM_LIMIT && b.x0 > 0 && b.x1 < W && !boxes.some((o) => b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0);
  const order = { pin: 0, text: 1, region: 2, river: 3 };
  for (const it of [...items].sort((a, b) => order[a.kind] - order[b.kind])) {
    if (it.a <= 0.01) continue;
    if (it.kind === 'region') {
      const d = it.def; const [x, y] = proj(d.labelAt);
      const px = d.labelSize || 58; const w = textW(d.label, px, 800) + 10; const h = px * 1.25 + (d.approx ? 30 : 0);
      const b = { x0: x - w / 2, x1: x + w / 2, y0: y - h / 2, y1: y + h / 2 };
      if (!free(b)) continue; boxes.push(b);
      html.push(`<div class="region-label outline" style="left:${x.toFixed(1)}px;top:${y.toFixed(1)}px;color:${col(d.color)};opacity:${it.a.toFixed(3)};font-size:${px}px">${esc(d.label)}${d.approx ? '<span class="approx outline">แนวโดยประมาณ</span>' : ''}</div>`);
    } else if (it.kind === 'river') {
      const [x, y] = proj(it.def.labelAt);
      const w = textW(it.def.label, 34, 700); const ang = ((it.def.labelAngle || 0) * Math.PI) / 180;
      const ex = Math.abs(Math.cos(ang)) * w + 20; const ey = Math.abs(Math.sin(ang)) * w + 44;
      const b = { x0: x, x1: x + ex, y0: y - 10 + Math.min(0, Math.sin(ang) * w), y1: y + ey };
      if (!free(b)) continue; boxes.push(b);
      html.push(`<div class="river-label outline" style="left:${x.toFixed(1)}px;top:${y.toFixed(1)}px;transform:rotate(${it.def.labelAngle || 0}deg);opacity:${it.a.toFixed(3)}">${esc(it.def.label)}</div>`);
    } else {
      const small = it.cls === 'small'; const px = small ? 32 : 40;
      const w = Math.max(textW(it.text, px, small ? 500 : 700), it.sub ? textW(it.sub, 26, 500) : 0) + 12;
      const h = px * 1.3 + (it.sub ? 34 : 0);
      const [ax, ay] = it.kind === 'pin' ? it.xy : proj(it.at);
      // candidate boxes: above, right, left, below the anchor (pin labels sit 24px above the dot)
      const cands = [
        { x0: ax - w / 2, y0: ay - h },
        { x0: ax + 30, y0: ay + 24 - h / 2 },
        { x0: ax - 30 - w, y0: ay + 24 - h / 2 },
        { x0: ax - w / 2, y0: ay + 48 },
      ].map((c) => ({ ...c, x1: c.x0 + w, y1: c.y0 + h }));
      const b = cands.find(free); if (!b) continue; boxes.push(b);
      const color = it.color ? `color:${it.color};` : '';
      html.push(`<div class="place-label outline ${it.cls || ''}" style="left:${b.x0.toFixed(1)}px;top:${b.y0.toFixed(1)}px;transform:none;width:${w.toFixed(0)}px;text-align:center;${color}opacity:${it.a.toFixed(3)}">${esc(it.text)}${it.sub ? `<div style="font-size:26px;font-weight:500">${esc(it.sub)}</div>` : ''}</div>`);
    }
  }
  labelsEl.innerHTML = html.join('');
}

// ---------- frame ----------
let visCache = null;
function applyFrame(t) {
  t = clamp(t, 0, TOTAL - 1e-6);
  const s = sceneAt(t);
  const c = cameraAt(t);
  const fx = s.fx || [];
  const u = t - s.start;
  shakeEl.style.transform = fx.includes('shake') && u < 0.9 ? `translate(${(Math.sin(u * 60) * 9 * (1 - u / 0.9)).toFixed(1)}px, ${(Math.cos(u * 47) * 6 * (1 - u / 0.9)).toFixed(1)}px)` : '';
  setRelief(tilted(s));
  // focus = where the camera target sits, as a fraction of frame height from the top
  map.jumpTo({ center: c.center, zoom: c.zoom, bearing: c.bearing, pitch: c.pitch || 0, padding: { top: 0, left: 0, right: 0, bottom: Math.max(0, H * (1 - 2 * c.focus)) } });
  const dl = life(t, s, (sc) => sc.imagery === 'sentinel2016', 1.0);
  paint('detail', 'raster-opacity', dl ? dl.alpha : 0);
  if (story.meta?.tint) paint('tint', 'background-opacity', (story.meta.tint.opacity ?? 0.3) * (1 - 0.85 * (dl ? dl.alpha : 0)));
  if (visCache !== !!dl) { visCache = !!dl; map.setLayoutProperty('detail', 'visibility', dl ? 'visible' : 'none'); }
  const labelItems = [];
  updateLayers(t, s, labelItems);
  for (const [id, def] of Object.entries(L)) {
    if (def.type !== 'river' || !def.label) continue;
    const lf = life(t, s, (sc) => (sc.map || []).includes(id));
    if (lf) labelItems.push({ kind: 'river', def, a: lf.alpha * clamp((lf.age - 1) / 0.6) });
  }
  const nightOn = (sc) => (sc.fx || []).includes('night');
  const nl = life(t, s, nightOn, 0.8);
  nightEl.style.opacity = ((nl ? nl.alpha : 0) * (s.night ?? scenes[s.i - 1]?.night ?? 0.55)).toFixed(3);
  const extra = [];
  updateCards(t, s, extra);
  overlay.innerHTML = overlaySVG(t, s, labelItems) + extra.join('');
  // keep map labels clear of the HUD and the era pill
  const blocked = [];
  if (s.hud) blocked.push({ x0: 30, x1: 530, y0: 365, y1: 380 + 140 * s.hud.rows.length });
  if (s.era) { const top = s.eraTop || (titleFor(s.i)?.lines.length > 1 ? 300 : 210); blocked.push({ x0: 340, x1: 740, y0: top, y1: top + 80 }); }
  renderLabels(labelItems, blocked);
  updateText(t, s);
  tactical.hud(t, s);
  tactical.callout(t, s);
}

// Wait until every source (imagery, DEM, GeoJSON) has its tiles for this camera and a frame
// has been drawn with them; 'idle' alone can fire before tiles requested by jumpTo arrive.
async function settle() {
  const frame = () => new Promise((ok) => { map.once('render', ok); map.triggerRepaint(); });
  for (let i = 0; i < 400; i++) {
    await frame();
    if (map.loaded() && map.areTilesLoaded()) { await frame(); return; }
    await new Promise((ok) => setTimeout(ok, 50));
  }
  console.error('settle timeout');
}

await document.fonts.load('800 80px Kanit', 'ไทย');
await document.fonts.load('700 50px Kanit', 'ไทย');
await document.fonts.load('500 40px Kanit', 'ไทย');
await document.fonts.load('500 20px "IBM Plex Sans Thai"', 'ไทย');
await document.fonts.load('700 20px "Noto Serif SC"', '秦漢唐宋越南儂黃趙詔');
await document.fonts.ready;

window.TOTAL = TOTAL;
window.FPS = story.meta?.fps || 30;
window.SCENES = scenes.map((s) => ({ id: s.id, start: s.start, end: s.end, sub: s.sub || '' }));
window.seek = async (t) => { applyFrame(t); await settle(); };
window.MAP = map;
window.READY = true;

// Preview: scrub bar and real-time playback (never used when rendering).
const qs = new URLSearchParams(location.search);
if (qs.has('preview')) {
  const stage = document.getElementById('stage');
  const scale = Math.min(1, (innerHeight - 50) / H);
  stage.style.transform = `scale(${scale})`; stage.style.transformOrigin = 'top left';
  document.getElementById('scrub').hidden = false;
  const r = document.getElementById('scrub-t'); const lb = document.getElementById('scrub-label');
  r.max = TOTAL;
  const show = (t) => { applyFrame(t); lb.textContent = `${t.toFixed(2)}s / ${TOTAL}s · ${sceneAt(t).id}`; };
  r.oninput = () => show(+r.value);
  let playing = false; let t0 = 0; let base = 0;
  addEventListener('keydown', (e) => {
    if (e.code !== 'Space') return;
    playing = !playing; t0 = performance.now(); base = +r.value;
    const loop = () => { if (!playing) return; const t = base + (performance.now() - t0) / 1000; r.value = t; show(t); if (t < TOTAL) requestAnimationFrame(loop); };
    loop();
  });
  show(+(qs.get('t') || 0));
} else {
  applyFrame(+(qs.get('t') || 0));
}
