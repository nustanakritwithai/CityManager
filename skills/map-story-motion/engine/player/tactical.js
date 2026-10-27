// Tactical-map layer: faction unit tokens that move, territory zones that spread from a point,
// and a casualty HUD. Same rule as the rest of the player: everything is a function of t.

export function createTactical({ story, scenes, P, proj, col, life, clamp, inOut, outBack, outCubic, esc, merc }) {
  const factions = story.factions || {};
  const zoneDefs = story.zones || {};
  const rings = {};

  async function load() {
    for (const [id, z] of Object.entries(zoneDefs)) {
      if (z.coords) { rings[id] = [z.coords]; continue; }
      const g = await (await fetch(`/geo/${z.src}.json`)).json();
      const geoms = g.type === 'GeometryCollection' ? g.geometries : g.type === 'FeatureCollection' ? g.features.map((f) => f.geometry) : [g.geometry || g];
      rings[id] = geoms.flatMap((gm) => (gm.type === 'Polygon' ? [gm.coordinates[0]] : gm.type === 'MultiPolygon' ? gm.coordinates.map((p) => p[0]) : [])).filter((r) => r.length > 4);
    }
  }

  const fac = (f) => factions[f] || { color: 'white', glyph: '' };

  function token(f, x, y, s, a, kind) {
    const F = fac(f); const c = col(F.color);
    if (kind === 'ship') {
      return `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${s.toFixed(3)})" opacity="${a.toFixed(3)}">
        <path d="M-34 6 Q0 20 38 2 L32 -6 L-30 -6 Z" fill="#4a3220" stroke="#0b0d14" stroke-width="2"/>
        <path d="M-10 -7 L-10 -46 Q4 -42 14 -45 L16 -10 Z" fill="${c}" stroke="#fff" stroke-width="2"/>
        <path d="M18 -7 L18 -32 Q26 -30 32 -32 L32 -10 Z" fill="${c}" stroke="#fff" stroke-width="2"/></g>`;
    }
    return `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${s.toFixed(3)})" opacity="${a.toFixed(3)}">
      <rect x="-25" y="-15" width="54" height="38" rx="3" fill="rgb(0 0 0 / .35)"/>
      <rect x="-27" y="-19" width="54" height="38" rx="3" fill="${c}" stroke="#fff" stroke-width="3"/>
      <circle cx="0" cy="0" r="12.5" fill="rgb(0 0 0 / .28)" stroke="rgb(255 255 255 / .85)" stroke-width="2"/>
      ${F.glyph ? `<text x="0" y="7" text-anchor="middle" font-size="19" font-weight="700" fill="#fff" font-family="'Noto Serif SC',serif">${esc(F.glyph)}</text>` : '<circle r="4.5" fill="#fff"/>'}</g>`;
  }

  // Unit groups keyed by id across scenes, like pins. A group may march from `at` to `to`.
  function unitsSVG(t, s) {
    const out = [];
    const keys = new Set(scenes.flatMap((sc) => (sc.units || []).map((u) => u.id)));
    for (const key of keys) {
      const has = (sc) => (sc.units || []).some((u) => u.id === key);
      const lf = life(t, s, has, 0.3); if (!lf) continue;
      const own = (s.units || []).find((u) => u.id === key);
      const spec = own || (scenes[s.i - 1].units || []).find((u) => u.id === key);
      const host = own ? s : scenes[s.i - 1];
      const u = t - host.start;
      let pos = P(spec.at);
      if (spec.to) {
        const [t0, d] = spec.move || [0.6, Math.max(1, host.dur - 1.4)];
        const k = own ? inOut(clamp((u - t0) / d)) : 1;
        const a = merc(pos); const b = merc(P(spec.to));
        const ll = new maplibregl.MercatorCoordinate(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k).toLngLat();
        pos = [ll.lng, ll.lat];
      }
      if (spec.kind === 'formation') {
        const heading = spec.heading ?? (spec.to ? bearingDeg(P(spec.at), P(spec.to)) : 0);
        out.push(formation(spec, pos, heading, lf));
        continue;
      }
      const [cx, cy] = proj(pos);
      const n = spec.n || 1; const r = spec.r ?? 26 * Math.sqrt(n);
      for (let i = 0; i < n; i++) {
        const k = clamp((lf.age - (spec.appear ?? 0.3) - i * 0.06) / 0.35); if (k <= 0) continue;
        const rr = n === 1 ? 0 : r * Math.sqrt((i + 0.5) / n);
        const ang = i * 2.39996;
        const bob = spec.to ? Math.sin(lf.age * 7 + i) * 2 : 0;
        out.push(token(spec.f, cx + Math.cos(ang) * rr * 1.3, cy + Math.sin(ang) * rr + bob, (spec.scale ?? 1) * outBack(k), lf.alpha, spec.kind));
      }
    }
    return out.join('');
  }

  const bearingDeg = (a, b) => {
    const y = Math.sin(((b[0] - a[0]) * Math.PI) / 180) * Math.cos((b[1] * Math.PI) / 180);
    const x = Math.cos((a[1] * Math.PI) / 180) * Math.sin((b[1] * Math.PI) / 180) - Math.sin((a[1] * Math.PI) / 180) * Math.cos((b[1] * Math.PI) / 180) * Math.cos(((b[0] - a[0]) * Math.PI) / 180);
    return (Math.atan2(y, x) * 180) / Math.PI;
  };
  // metres east/north of a point → lng/lat
  const offset = (c, e, n) => [c[0] + e / (111320 * Math.cos((c[1] * Math.PI) / 180)), c[1] + n / 110540];

  const ICON = {
    spear: (x, y, k) => [-1, 0, 1].map((d) => `<line x1="${(x + d * k * 0.32).toFixed(1)}" y1="${(y + k * 0.42).toFixed(1)}" x2="${(x + d * k * 0.32).toFixed(1)}" y2="${(y - k * 0.42).toFixed(1)}" stroke="#fff" stroke-width="${Math.max(1.2, k * 0.12).toFixed(1)}" stroke-linecap="round"/>`).join(''),
    horse: (x, y, k) => `<path transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${(k / 24).toFixed(3)})" d="M-10 6 L-8 -2 Q-4 -6 4 -5 L8 -10 L11 -9 L10 -3 Q11 2 8 4 L8 9 M-8 -2 L-9 9 M4 -1 L4 9" stroke="#fff" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
    bow: (x, y, k) => `<path transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${(k / 24).toFixed(3)})" d="M-4 -10 Q8 0 -4 10 M-4 -10 L-4 10 M-10 0 L8 0 M5 -3 L8 0 L5 3" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="round"/>`,
  };

  // A block of rows×cols tiles lying flat on the ground (projected corners, so it tilts with the camera).
  function formation(spec, pos, heading, lf) {
    const F = fac(spec.f); const c = col(F.color);
    const rows = spec.rows ?? 2; const cols = spec.cols ?? 6;
    const tile = spec.tile ?? 1400; const gap = spec.gap ?? 350; const step = tile + gap;
    const h = (heading * Math.PI) / 180;
    const fw = [Math.sin(h), Math.cos(h)]; const rt = [Math.cos(h), -Math.sin(h)];
    const at = (x, y) => offset(pos, rt[0] * x + fw[0] * y, rt[1] * x + fw[1] * y);
    const g = [];
    let i = 0;
    for (let r = 0; r < rows; r++) {
      for (let q = 0; q < cols; q++, i++) {
        const k = clamp((lf.age - (spec.appear ?? 0.3) - i * 0.025) / 0.3); if (k <= 0) continue;
        const x = (q - (cols - 1) / 2) * step; const y = -(r - (rows - 1) / 2) * step;
        const hw = (tile / 2) * (0.6 + 0.4 * outBack(k));
        const quad = [at(x - hw, y + hw), at(x + hw, y + hw), at(x + hw, y - hw), at(x - hw, y - hw)].map(proj);
        const pts = quad.map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' ');
        const sh = quad.map((p) => `${p[0].toFixed(1)},${(p[1] + 3).toFixed(1)}`).join(' ');
        g.push(`<polygon points="${sh}" fill="rgb(0 0 0 / .45)"/><polygon points="${pts}" fill="${c}" stroke="rgb(255 255 255 / .9)" stroke-width="1.6" stroke-linejoin="round"/>`);
        const cx = quad.reduce((a, p) => a + p[0], 0) / 4; const cy = quad.reduce((a, p) => a + p[1], 0) / 4;
        const size = Math.min(Math.hypot(quad[1][0] - quad[0][0], quad[1][1] - quad[0][1]), Math.hypot(quad[3][0] - quad[0][0], quad[3][1] - quad[0][1]) * 1.6);
        g.push((ICON[spec.icon || 'spear'] || ICON.spear)(cx, cy, size * 0.8));
      }
    }
    if (spec.flag !== false) {
      const [fx, fy] = proj(at(0, ((rows - 1) / 2) * step + tile * 1.1));
      g.push(token(spec.f, fx, fy - 18, 0.62, 1));
    }
    return `<g opacity="${lf.alpha.toFixed(3)}">${g.join('')}</g>`;
  }

  // Arrow volleys: arcs that rise in screen space between two ground points, with a moving streak.
  function volleysSVG(t, s) {
    if (!s.volleys) return '';
    const u = t - s.start; const out = [];
    for (const v of s.volleys) {
      const n = v.n ?? 14; const dur = v.dur ?? 3; const flight = v.flight ?? 1.1;
      const A = P(v.from); const B = P(v.to); const sp = v.spread ?? 1500;
      for (let i = 0; i < n; i++) {
        const r1 = Math.sin(i * 12.9898) * 43758.5453 % 1; const r2 = Math.sin(i * 78.233) * 12345.678 % 1;
        const t0 = (v.at ?? 0.5) + (i / n) * dur;
        const p = (u - t0) / flight; if (p <= 0 || p > 1.35) continue;
        const a = proj(offset(A, r1 * sp, r2 * sp)); const b = proj(offset(B, r2 * sp * 1.4, r1 * sp));
        const lift = Math.hypot(b[0] - a[0], b[1] - a[1]) * (v.lift ?? 0.5);
        const cx = (a[0] + b[0]) / 2; const cy = (a[1] + b[1]) / 2 - lift;
        const pt = (q) => [(1 - q) ** 2 * a[0] + 2 * (1 - q) * q * cx + q * q * b[0], (1 - q) ** 2 * a[1] + 2 * (1 - q) * q * cy + q * q * b[1]];
        const head = Math.min(1, p); const tail = Math.max(0, p - 0.35);
        const seg = []; for (let j = 0; j <= 12; j++) seg.push(pt(tail + ((head - tail) * j) / 12));
        const fade = p > 1 ? 1 - (p - 1) / 0.35 : 1;
        out.push(`<polyline points="${seg.map((q) => q.map((x) => x.toFixed(1)).join(',')).join(' ')}" fill="none" stroke="${col(v.color || '#cfe6ff')}" stroke-width="3" stroke-linecap="round" opacity="${(0.85 * fade).toFixed(3)}"/>`);
      }
    }
    return out.join('');
  }

  // Territory zones revealed by a circle growing from `from` (a place), like a front line spreading.
  function zonesSVG(t, s, labels) {
    const out = [];
    for (const [id, z] of Object.entries(zoneDefs)) {
      const has = (sc) => (sc.zones || []).includes(id);
      const lf = life(t, s, has, 0.4); if (!lf) continue;
      const c = col(z.color);
      const paths = rings[id].map((ring) => `M${ring.map((p) => proj(p).map((v) => v.toFixed(1)).join(' ')).join('L')}Z`).join('');
      const [ox, oy] = proj(P(z.from || z.labelAt));
      let maxD = 0;
      for (const ring of rings[id]) for (const p of ring) { const [x, y] = proj(p); maxD = Math.max(maxD, Math.hypot(x - ox, y - oy)); }
      const k = outCubic(clamp((lf.age - (z.at ?? 0.4)) / (z.grow ?? 2.5)));
      if (k <= 0) continue;
      out.push(`<clipPath id="zc-${id}"><circle cx="${ox.toFixed(1)}" cy="${oy.toFixed(1)}" r="${(maxD * k + 1).toFixed(1)}"/></clipPath>`);
      out.push(`<g clip-path="url(#zc-${id})" opacity="${lf.alpha.toFixed(3)}"><path d="${paths}" fill="${c}" fill-opacity="${z.fill ?? 0.5}" stroke="${c}" stroke-width="4" stroke-linejoin="round" fill-rule="evenodd"/></g>`);
      if (z.label && k > 0.6) labels.push({ kind: 'region', def: { ...z, color: z.labelColor || 'white' }, a: lf.alpha * clamp((k - 0.6) / 0.4) });
    }
    return out.join('');
  }

  const hudEl = document.getElementById('hud');
  let hudKey = '';
  const countUp = (v, k) => { const n = Number(String(v).replace(/,/g, '')); return Number.isFinite(n) ? Math.round(n * k).toLocaleString('en-US') : v; };
  function hud(t, s) {
    if (!s.hud) { hudEl.style.display = 'none'; return; }
    const key = `${s.i}`;
    if (key !== hudKey) {
      hudEl.innerHTML = `<div class="hh">${esc(s.hud.title || 'ความสูญเสีย')}</div>${s.hud.rows.map((r) => {
        const F = fac(r.f);
        return `<div class="hr"><svg viewBox="-30 -22 60 44" width="66" height="48">${token(r.f, 0, 0, 1, 1)}</svg><div class="hv" style="color:${col(r.color || F.color)}" data-v="${esc(r.value)}"></div><div class="hn">${esc(r.note || '')}</div></div>`;
      }).join('')}`;
      hudKey = key;
    }
    const u = t - s.start;
    hudEl.style.display = '';
    hudEl.style.opacity = (clamp((u - 0.3) / 0.4) * (1 - clamp((u - s.dur + 0.3) / 0.3))).toFixed(3);
    const at = s.hud.at ?? 1.2;
    hudEl.querySelectorAll('.hv').forEach((el) => { el.textContent = countUp(el.dataset.v, outCubic(clamp((u - at) / 1.6))); });
  }

  const calloutEl = document.getElementById('callout');
  let calloutKey = '';
  function callout(t, s) {
    if (!s.callout) { calloutEl.style.opacity = '0'; return; }
    if (calloutKey !== s.callout) { calloutEl.textContent = s.callout; calloutKey = s.callout; }
    const u = t - s.start; const k = clamp((u - 0.6) / 0.35);
    calloutEl.style.opacity = (k * (1 - clamp((u - s.dur + 0.4) / 0.3))).toFixed(3);
    calloutEl.style.transform = `translateX(-50%) skewX(-10deg) scale(${(0.7 + 0.3 * outBack(k)).toFixed(3)})`;
  }

  return { load, unitsSVG, zonesSVG, volleysSVG, hud, callout };
}
