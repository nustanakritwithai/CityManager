/**
 * Visual-only time of day, season and weather. Nothing here reads or advances the
 * simulation RNG, changes City state or enters a save; one sim tick stays one day.
 */
export type TimeMode = 'auto' | 'morning' | 'noon' | 'evening' | 'night' | 'local';
export type Quality = 'low' | 'medium' | 'high';
export type Rgb = readonly [number, number, number];
export type SeasonWeights = { hot: number; rainy: number; cool: number };
export type Phase = 'night' | 'dawn' | 'day' | 'dusk';
export type Atmosphere = {
  hour: number; phase: Phase;
  /** Unit vector from the sky towards the ground for the one directional light. */
  lightDirection: [number, number, number];
  lightColor: Rgb; lightIntensity: number; sunUp: boolean;
  ambient: Rgb; skyZenith: Rgb; skyHorizon: Rgb; sunGlow: Rgb; fogColor: Rgb;
  /** Multiplier on the camera-relative fog distance; larger means denser haze. */
  haze: number;
  /** 0 by day, 1 at full night: lit windows, street lamps and bloom. */
  night: number;
  overcast: number; saturation: number; contrast: number; brightness: number; tint: Rgb;
};

/** Real seconds for one full visual day at 1× speed. */
export const DAY_CYCLE_SECONDS = 300;
export const START_HOUR = 7.5;
export const LOCKED_HOURS: Readonly<Record<Exclude<TimeMode, 'auto' | 'local'>, number>> = Object.freeze({ morning: 8, noon: 12.5, evening: 17.4, night: 21.5 });
export const TIME_MODES: readonly TimeMode[] = Object.freeze(['auto', 'morning', 'noon', 'evening', 'night', 'local']);
export const QUALITIES: readonly Quality[] = Object.freeze(['low', 'medium', 'high']);
/** Visual weather is rolled per real-time window so 10× speed cannot strobe the sky. */
export const WEATHER_PERIOD_SECONDS = 75;

const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const smooth = (a: number, b: number, v: number) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const mixRgb = (a: Rgb, b: Rgb, t: number): Rgb => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
const scaleRgb = (a: Rgb, s: number): Rgb => [a[0] * s, a[1] * s, a[2] * s];
const hex = (value: string): Rgb => [parseInt(value.slice(1, 3), 16) / 255, parseInt(value.slice(3, 5), 16) / 255, parseInt(value.slice(5, 7), 16) / 255];
export const wrapHour = (hour: number) => ((hour % 24) + 24) % 24;

/** Faster game speeds move the sky a little faster, capped at 2× so it never flickers. */
export function cycleRate(speed: number): number { return speed > 0 ? Math.min(2, Math.sqrt(speed)) : 0; }
export function advanceHour(hour: number, seconds: number, speed: number): number {
  return wrapHour(hour + Math.max(0, seconds) * cycleRate(speed) * 24 / DAY_CYCLE_SECONDS);
}
export function resolveHour(mode: TimeMode, autoHour: number, now: Date = new Date()): number {
  if (mode === 'auto') return wrapHour(autoHour);
  if (mode === 'local') return now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
  return LOCKED_HOURS[mode];
}
export function formatClock(hour: number): string {
  const minutes = Math.floor(wrapHour(hour) * 60 + 1e-6) % 1440;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}
export function phaseOf(hour: number): Phase {
  const h = wrapHour(hour);
  return h >= 5 && h < 7.5 ? 'dawn' : h >= 7.5 && h < 17.2 ? 'day' : h >= 17.2 && h < 19.6 ? 'dusk' : 'night';
}
export const PHASE_LABELS: Readonly<Record<Phase, string>> = Object.freeze({ night: 'กลางคืน', dawn: 'เช้าตรู่', day: 'กลางวัน', dusk: 'เย็น' });

/**
 * Game month 1 is January; Thai seasons blend over a continuous month position:
 * hot (Mar–May), rainy (Jun–Oct) and cool (Nov–Feb).
 */
export function seasonWeights(tick: number): SeasonWeights {
  const month = ((tick / 30) % 12 + 12) % 12; // 0 = start of January
  const bump = (centre: number, width: number) => { const d = Math.abs(((month - centre + 18) % 12 + 12) % 12 - 6); return clamp(1 - d / width); };
  const hot = bump(3.5, 2.6), rainy = bump(8, 3.4), cool = bump(12.5 % 12, 2.9), sum = hot + rainy + cool || 1;
  return { hot: hot / sum, rainy: rainy / sum, cool: cool / sum };
}
export const SEASON_LABELS = Object.freeze({ hot: 'ฤดูร้อน', rainy: 'ฤดูฝน', cool: 'ฤดูหนาว' } as const);
export function dominantSeason(weights: SeasonWeights): keyof SeasonWeights {
  return weights.rainy >= weights.hot && weights.rainy >= weights.cool ? 'rainy' : weights.hot >= weights.cool ? 'hot' : 'cool';
}

function visualHash(a: number, b: number): number {
  let n = Math.imul(a ^ 0x5bd1e995, 0x27d4eb2d) ^ Math.imul(b + 0x165667b1, 0x85ebca6b);
  n = Math.imul(n ^ (n >>> 15), 0xc2b2ae35);
  return ((n ^ (n >>> 13)) >>> 0) / 4294967296;
}
/** Whether a real-time weather window rains; mostly in the rainy season. */
export function isRaining(seed: number, period: number, weights: SeasonWeights): boolean {
  return visualHash(seed >>> 0, Math.floor(period)) < weights.rainy * .55 + weights.hot * .07 + weights.cool * .02;
}

// Sky keyframes by hour: zenith, horizon, ambient. Night ambient stays readable.
const KEYS: readonly [number, string, string, string][] = [
  [0, '#0d1838', '#22305a', '#6c7aa6'],
  [4.8, '#141f45', '#3a3f68', '#707ca4'],
  [6, '#3b5b92', '#f2a57a', '#8a8098'],
  [7.5, '#6aa2da', '#f5d3a4', '#adb0b6'],
  [10, '#4b93e2', '#c3e2f6', '#bcc8d0'],
  [13, '#3f8ee8', '#cbe7f8', '#c2ccd3'],
  [16, '#4d90dc', '#e8ddc2', '#bdbeb8'],
  [17.4, '#5878b6', '#f6ac6c', '#c3b1a8'],
  [18.5, '#323f70', '#ec7c5c', '#a08a98'],
  [19.6, '#18224a', '#5d4a6e', '#7a7fa6'],
  [21, '#0e1938', '#243258', '#6c7aa6'],
  [24, '#0d1838', '#22305a', '#6c7aa6'],
];
function keyframe(hour: number): { zenith: Rgb; horizon: Rgb; ambient: Rgb } {
  const h = wrapHour(hour);
  let i = 0; while (i < KEYS.length - 2 && KEYS[i + 1][0] <= h) i++;
  const [h0, z0, o0, a0] = KEYS[i], [h1, z1, o1, a1] = KEYS[i + 1], t = smooth(0, 1, (h - h0) / (h1 - h0));
  return { zenith: mixRgb(hex(z0), hex(z1), t), horizon: mixRgb(hex(o0), hex(o1), t), ambient: mixRgb(hex(a0), hex(a1), t) };
}

/** Sun rises in the east (+x), passes slightly south (+z) and sets in the west. */
export function sunPosition(hour: number): [number, number, number] {
  const h = wrapHour(hour), arc = Math.PI * (h - 6) / 12, elevation = Math.sin(arc) * 1.08;
  const azimuth = Math.PI * (h - 6) / 12;
  return [Math.cos(azimuth) * Math.cos(elevation), Math.sin(elevation), .45 * Math.sin(azimuth) * Math.cos(elevation) + .25];
}
const normalise = (v: [number, number, number]): [number, number, number] => { const l = Math.hypot(...v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

export function atmosphereAt(hour: number, weights: SeasonWeights = { hot: 0, rainy: 0, cool: 1 }, overcastTarget = 0): Atmosphere {
  const h = wrapHour(hour), sky = keyframe(h), sun = normalise(sunPosition(h)), height = sun[1];
  const moon = normalise([-.45, .72, -.35]);
  // A dark gap between sun and moon keeps the shadow direction from jumping while bright.
  const sunStrength = smooth(-.08, .16, height), moonStrength = 1 - smooth(-.3, -.08, height);
  const night = 1 - smooth(-.16, .14, height);
  const overcast = clamp(overcastTarget + weights.rainy * .14);
  const low = 1 - smooth(.05, .55, height);
  let lightColor = sunStrength >= moonStrength ? mixRgb(hex('#fff3dc'), hex('#ffad6a'), low) : hex('#b8c8ff');
  let lightIntensity = sunStrength >= moonStrength ? (1.15 + .2 * low) * sunStrength : .6 * moonStrength;
  const sunUp = sunStrength >= moonStrength;
  // Near the horizon the light never comes from below the ground.
  const direction = sunUp ? normalise([sun[0], Math.max(sun[1], .06), sun[2]]) : moon;
  // Seasons: hot = warm haze, rainy = cooler and greyer, cool = crisp and clear.
  const warm = weights.hot, grey: Rgb = hex('#8e99a6');
  let zenith = mixRgb(sky.zenith, mixRgb(sky.zenith, hex('#7fa6cf'), .35), warm);
  let horizon = mixRgb(sky.horizon, mixRgb(sky.horizon, hex('#ecdcc0'), .4), warm * (1 - night));
  zenith = mixRgb(zenith, mixRgb(zenith, hex('#2f6fd0'), .25), weights.cool * (1 - night));
  const daylight = 1 - night * .75;
  zenith = mixRgb(zenith, scaleRgb(grey, daylight * .95), overcast * .75);
  horizon = mixRgb(horizon, scaleRgb(grey, daylight * 1.05), overcast * .7);
  let ambient = mixRgb(sky.ambient, mixRgb(sky.ambient, hex('#b9c1c9'), .5), overcast * (1 - night));
  lightIntensity *= 1 - overcast * .62;
  lightColor = mixRgb(lightColor, hex('#dfe6ee'), overcast * .5 * (sunUp ? 1 : 0));
  ambient = mixRgb(ambient, hex('#d9c3a4'), warm * .12 * (1 - night));
  const sunGlow = sunUp ? scaleRgb(lightColor, (1 - overcast) * (.25 + low * .6)) : [0, 0, 0] as Rgb;
  const golden = smooth(0, 1, low) * (sunUp ? 1 : 0) * (1 - overcast);
  return {
    hour: h, phase: phaseOf(h), lightDirection: [-direction[0], -direction[1], -direction[2]],
    lightColor, lightIntensity, sunUp, ambient, skyZenith: zenith, skyHorizon: horizon, sunGlow,
    fogColor: mixRgb(mixRgb(horizon, ambient, .4), zenith, .12),
    haze: 1 + warm * .35 + overcast * 1.4 - weights.cool * .15 + night * .2,
    night, overcast,
    saturation: 1.06 + weights.cool * .05 - warm * .04 - overcast * .2 - night * .2,
    contrast: 1.04 + golden * .05 - overcast * .06,
    brightness: night * .02,
    tint: mixRgb(mixRgb([1, 1, 1], [1.04, .995, .94], golden * .5 + warm * .25), [.95, .97, 1.04], night * .8),
  };
}
