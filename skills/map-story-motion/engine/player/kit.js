// Flat-vector illustration kit. Every function returns an SVG string drawn for time t (seconds
// since the card appeared), so figures can walk, flags wave and boats bob deterministically.

const SKIN = '#e9b98c';
const fmt = (n) => +n.toFixed(2);

function sky(id, top, bottom) {
  return `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient></defs><rect width="940" height="340" fill="url(#${id})"/>`;
}

function hills(color, base, amp, seed, w = 940) {
  let d = `M0 340 L0 ${base}`;
  for (let x = 0; x <= w; x += 47) {
    const y = base - amp * (0.5 + 0.5 * Math.sin(x * 0.011 + seed) * Math.cos(x * 0.004 + seed * 2));
    d += ` L${x} ${fmt(y)}`;
  }
  return `<path d="${d} L${w} 340 Z" fill="${color}"/>`;
}

// A marching foot soldier facing right. `phase` drives the walk cycle.
function soldier(x, y, s, { tunic, trim = '#2b2b2b', helmet = '#c9a227', flag = null, phase = 0, spear = true }) {
  const sw = Math.sin(phase) * 10;
  const bob = Math.abs(Math.cos(phase)) * 2;
  const g = [];
  g.push(`<g transform="translate(${fmt(x)} ${fmt(y - bob)}) scale(${s})">`);
  g.push(`<ellipse cx="0" cy="96" rx="24" ry="5" fill="rgb(0 0 0 / .25)"/>`);
  g.push(`<g stroke="#3a2a1a" stroke-width="7" stroke-linecap="round"><line x1="-5" y1="58" x2="${fmt(-5 - sw * 0.6)}" y2="92"/><line x1="5" y1="58" x2="${fmt(5 + sw * 0.6)}" y2="92"/></g>`);
  g.push(`<path d="M-17 22 Q0 14 17 22 L20 64 L-20 64 Z" fill="${tunic}"/>`);
  g.push(`<rect x="-20" y="44" width="40" height="7" fill="${trim}"/>`);
  g.push(`<circle cx="0" cy="6" r="13" fill="${SKIN}"/>`);
  g.push(`<path d="M-15 4 Q0 -22 15 4 Z" fill="${helmet}"/><line x1="0" y1="-12" x2="0" y2="-22" stroke="${helmet}" stroke-width="3"/>`);
  if (spear) g.push(`<line x1="18" y1="${fmt(60 - sw * 0.3)}" x2="26" y2="-46" stroke="#5a3d22" stroke-width="4"/><path d="M26 -46 l-5 12 h10 Z" fill="#cfd4da"/>`);
  if (flag) {
    const wv = Math.sin(phase * 1.3) * 6;
    g.push(`<line x1="-16" y1="62" x2="-16" y2="-62" stroke="#5a3d22" stroke-width="4"/>`);
    g.push(`<path d="M-16 -62 Q8 ${fmt(-70 + wv)} 34 -62 L34 -28 Q8 ${fmt(-36 + wv)} -16 -28 Z" fill="${flag}"/>`);
  }
  g.push(`<path d="M17 26 L${fmt(22 + sw * 0.2)} 52" stroke="${SKIN}" stroke-width="7" stroke-linecap="round"/>`);
  g.push('</g>');
  return g.join('');
}

function walker(x, y, s, phase, { cloth = '#8a6d4a', bundle = true, child = false }) {
  const sw = Math.sin(phase) * 8;
  const k = child ? 0.7 : 1;
  return `<g transform="translate(${fmt(x)} ${fmt(y)}) scale(${s * k})">
    <ellipse cx="0" cy="96" rx="22" ry="5" fill="rgb(0 0 0 / .25)"/>
    <g stroke="#3a2a1a" stroke-width="7" stroke-linecap="round"><line x1="-4" y1="58" x2="${fmt(-4 - sw * .6)}" y2="92"/><line x1="4" y1="58" x2="${fmt(4 + sw * .6)}" y2="92"/></g>
    <path d="M-15 24 Q0 16 15 24 L18 66 L-18 66 Z" fill="${cloth}"/>
    <circle cx="2" cy="8" r="12" fill="${SKIN}"/>
    <path d="M-14 4 Q2 -12 18 4 Z" fill="#2a2018"/>
    ${bundle ? '<line x1="-20" y1="10" x2="18" y2="40" stroke="#5a3d22" stroke-width="4"/><circle cx="-22" cy="10" r="15" fill="#c9a66b"/>' : ''}
  </g>`;
}

function pagoda(x, y, s, color) {
  return `<g transform="translate(${x} ${y}) scale(${s})" fill="${color}">
    <rect x="-34" y="-40" width="68" height="40"/><path d="M-56 -40 L0 -66 L56 -40 Z"/>
    <rect x="-24" y="-86" width="48" height="22"/><path d="M-42 -86 L0 -106 L42 -86 Z"/>
    <rect x="-3" y="-128" width="6" height="24"/></g>`;
}

function tree(x, y, s, color) {
  return `<g transform="translate(${x} ${y}) scale(${s})" fill="${color}"><rect x="-5" y="-20" width="10" height="24" fill="#1a1410"/>
    <path d="M0 -120 L-38 -50 L-20 -50 L-46 -10 L46 -10 L20 -50 L38 -50 Z"/></g>`;
}

function junk(x, y, s, t, sail = '#c0472f') {
  const r = Math.sin(t * 1.7 + x) * 3;
  return `<g transform="translate(${x} ${fmt(y + Math.sin(t * 2 + x) * 3)}) rotate(${fmt(r)}) scale(${s})">
    <path d="M-80 0 Q0 30 90 -6 L76 -22 L-70 -22 Z" fill="#5a3a22"/>
    <path d="M-20 -24 L-20 -120 Q10 -110 30 -118 L36 -30 Z" fill="${sail}"/>
    <path d="M40 -24 L40 -86 Q60 -80 72 -86 L74 -30 Z" fill="${sail}" opacity=".85"/>
    <g stroke="rgb(0 0 0 / .25)" stroke-width="2"><line x1="-20" y1="-96" x2="32" y2="-96"/><line x1="-20" y1="-72" x2="34" y2="-72"/><line x1="-20" y1="-48" x2="35" y2="-48"/></g></g>`;
}

export const panels = {
  // opts: tunic, flag, helmet, count, sky: 'dusk'|'day', buildings
  army(t, o = {}) {
    const n = o.count ?? 6;
    const skyTop = o.sky === 'day' ? '#9fc6e8' : '#f0a25c';
    const skyBot = o.sky === 'day' ? '#e9f1f4' : '#f3d39a';
    const out = [sky('sa', skyTop, skyBot), hills('#7f9a7a', 210, 70, 1.3), hills('#5f8063', 250, 50, 4.1)];
    if (o.buildings) { out.push(pagoda(80, 250, 0.9, 'rgb(90 50 40 / .75)')); out.push(pagoda(860, 255, 0.8, 'rgb(90 50 40 / .7)')); }
    out.push('<rect y="300" width="940" height="40" fill="#b79a6b"/>');
    const shift = ((t * 36) % 140);
    for (let i = -1; i < n + 1; i++) {
      const x = 60 + i * 140 + shift;
      if (x < -40 || x > 980) continue;
      out.push(soldier(x, 200, 1, { tunic: o.tunic || '#b8322a', helmet: o.helmet || '#c9a227', flag: i % 3 === 0 ? (o.flag || '#d23a2c') : null, phase: t * 6 + i * 1.7 }));
    }
    return out.join('');
  },

  nightForest(t) {
    const out = [sky('sn', '#0b1638', '#24305a'), `<circle cx="790" cy="70" r="38" fill="#f3efd2"/><circle cx="805" cy="62" r="34" fill="#0f1b40" opacity=".35"/>`];
    for (let i = 0; i < 40; i++) out.push(`<circle cx="${(i * 97) % 940}" cy="${(i * 53) % 120 + 10}" r="${i % 3 ? 1.5 : 2.5}" fill="#fff" opacity="${0.4 + 0.4 * Math.sin(t * 2 + i)}"/>`);
    out.push(hills('#17233f', 200, 40, 2.2));
    for (let i = 0; i < 11; i++) out.push(tree(40 + i * 88, 330, 1.1 + (i % 3) * 0.2, i % 2 ? '#0e1a2c' : '#122238'));
    const creep = Math.min(1, t / 3);
    for (let i = 0; i < 4; i++) {
      const x = 150 + i * 190 + creep * 40;
      out.push(`<g opacity=".92">${soldier(x, 236, 0.85, { tunic: '#3d5a3a', helmet: '#2a2a2a', phase: t * 3 + i, spear: true })}</g>`);
    }
    out.push('<rect width="940" height="340" fill="rgb(10 20 60 / .25)"/>');
    return out.join('');
  },

  refugees(t) {
    const out = [sky('sr', '#7d8aa6', '#c9b79a'), hills('#6b6f78', 160, 120, 0.7), hills('#4e5560', 230, 70, 2.9)];
    out.push('<path d="M700 340 L700 210 Q760 150 830 210 L830 340 Z" fill="#1c1a1a"/>');
    out.push('<rect y="300" width="940" height="40" fill="#8b7a5c"/>');
    const shift = (t * 30) % 120;
    for (let i = 0; i < 7; i++) {
      const x = -40 + i * 110 + shift;
      if (x > 720) continue;
      out.push(walker(x, 204, 1, t * 5 + i * 2, { cloth: ['#8a6d4a', '#6d7d5a', '#9a5a3a'][i % 3], bundle: i % 2 === 0, child: i % 4 === 3 }));
    }
    return out.join('');
  },

  port(t) {
    const out = [sky('sp', '#f2b46b', '#f7e0b0'), hills('#8aa07c', 170, 50, 1.9)];
    for (let i = 0; i < 6; i++) out.push(`<g transform="translate(${80 + i * 70} 190)"><rect x="-24" y="-30" width="48" height="30" fill="#e8d9bd"/><path d="M-34 -30 Q0 -52 34 -30 Z" fill="#7a3a2a"/></g>`);
    out.push(pagoda(560, 196, 0.8, '#7a3a2a'));
    out.push('<rect y="196" width="940" height="144" fill="#4f86a8"/>');
    for (let i = 0; i < 8; i++) out.push(`<path d="M${(i * 131 + t * 20) % 980 - 20} ${230 + (i % 3) * 30} q15 -6 30 0" stroke="#d8ecf5" stroke-width="3" fill="none" opacity=".6"/>`);
    out.push(junk(250, 300, 1, t), junk(640, 290, 0.8, t, '#d58b2c'));
    return out.join('');
  },
};

export const icons = {
  brokenFlag() {
    return `<rect width="264" height="230" fill="#e3d6bd"/><ellipse cx="132" cy="200" rx="90" ry="12" fill="rgb(0 0 0 / .15)"/>
      <line x1="90" y1="200" x2="120" y2="110" stroke="#5a3d22" stroke-width="9"/><line x1="128" y1="96" x2="170" y2="40" stroke="#5a3d22" stroke-width="9"/>
      <path d="M170 40 Q200 46 222 40 L214 86 Q194 92 166 84 Z" fill="#b8322a"/><path d="M112 120 l20 -30" stroke="#e3d6bd" stroke-width="6"/>`;
  },
  junk(t) {
    return `<rect width="264" height="230" fill="#e3d6bd"/><rect y="150" width="264" height="80" fill="#9cc1d4"/>
      <g transform="translate(-338 -100) scale(1.0)">${junk(470, 260, 1, t)}</g>`;
  },
  surname() {
    return `<rect width="264" height="230" fill="#e3d6bd"/>
      <text x="62" y="150" font-size="104" text-anchor="middle" fill="#5a3d22" font-family="Noto Serif SC">儂</text>
      <path d="M112 112 h40 m-14 -14 l14 14 l-14 14" stroke="#b0412e" stroke-width="8" fill="none" stroke-linecap="round"/>
      <text x="204" y="150" font-size="104" text-anchor="middle" fill="#5a3d22" font-family="Noto Serif SC">趙</text>
      <text x="62" y="200" font-size="30" text-anchor="middle" fill="#5a3d22" font-family="Kanit" font-weight="700">หนง</text>
      <text x="204" y="200" font-size="30" text-anchor="middle" fill="#5a3d22" font-family="Kanit" font-weight="700">จ้าว</text>`;
  },
  stele() {
    let lines = '';
    for (let i = 0; i < 7; i++) lines += `<line x1="92" y1="${78 + i * 17}" x2="${172 - (i % 3) * 8}" y2="${78 + i * 17}" stroke="#4a463f" stroke-width="5" stroke-linecap="round"/>`;
    return `<rect width="264" height="230" fill="#e3d6bd"/><ellipse cx="132" cy="212" rx="90" ry="10" fill="rgb(0 0 0 / .15)"/>
      <path d="M78 210 L78 60 Q132 20 186 60 L186 210 Z" fill="#8c877c"/>${lines}`;
  },
  question() {
    return `<rect width="264" height="230" fill="#e3d6bd"/><circle cx="132" cy="108" r="66" fill="#fff" stroke="#3a2c1c" stroke-width="6"/>
      <text x="132" y="140" text-anchor="middle" font-size="96" font-weight="800" fill="#9b3a2a" font-family="serif">?</text>`;
  },
};
