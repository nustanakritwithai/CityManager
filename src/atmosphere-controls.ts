import {
  START_HOUR, WEATHER_PERIOD_SECONDS, TIME_MODES, QUALITIES, PHASE_LABELS, SEASON_LABELS,
  advanceHour, resolveHour, atmosphereAt, seasonWeights, dominantSeason, isRaining, formatClock, phaseOf,
  type TimeMode, type Quality, type SeasonWeights
} from './atmosphere.ts';
import { WeatherOverlay } from './weather-overlay.ts';
import type { CityView } from './renderer.ts';
import type { City } from './sim.ts';

export type VisualSettings = { timeMode: TimeMode; quality: Quality | 'auto'; rain: boolean; seasons: boolean };
const STORAGE_KEY = 'citymanager.visual.v1';
const DEFAULTS: VisualSettings = Object.freeze({ timeMode: 'auto', quality: 'auto', rain: true, seasons: true });
const TIME_LABELS: Record<TimeMode, string> = { auto: 'อัตโนมัติ · รอบละ 5 นาที', morning: 'เช้า', noon: 'กลางวัน', evening: 'เย็น', night: 'กลางคืน', local: 'ตามเวลาเครื่อง' };
const QUALITY_LABELS: Record<Quality | 'auto', string> = { auto: 'อัตโนมัติ', low: 'ต่ำ', medium: 'กลาง', high: 'สูง' };
const PHASE_ICONS = { night: '☾', dawn: '◒', day: '☀', dusk: '◓' } as const;
const NO_SEASON: SeasonWeights = { hot: 0, rainy: 0, cool: 0 };

/** Per-viewer convenience only; an unreadable store falls back to defaults. */
export function loadVisualSettings(): VisualSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    return {
      timeMode: TIME_MODES.includes(raw.timeMode) ? raw.timeMode : DEFAULTS.timeMode,
      quality: raw.quality === 'auto' || QUALITIES.includes(raw.quality) ? raw.quality : DEFAULTS.quality,
      rain: typeof raw.rain === 'boolean' ? raw.rain : DEFAULTS.rain,
      seasons: typeof raw.seasons === 'boolean' ? raw.seasons : DEFAULTS.seasons,
    };
  } catch { return { ...DEFAULTS }; }
}
function saveVisualSettings(settings: VisualSettings) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch { /* private mode: keep in memory */ }
}
const autoQuality = (): Quality => matchMedia('(pointer: coarse)').matches || Math.min(innerWidth, innerHeight) < 600 ? 'medium' : 'high';

type Host = { view: CityView; getCity: () => City; isPaused: () => boolean; getSpeed: () => number; tickFraction: () => number };

/** Drives the visual-only sky clock, season tint, decorative rain and render quality. */
export class AtmosphereController {
  readonly settings = loadVisualSettings();
  private autoHour = START_HOUR;
  private weatherClock = 0;
  private overcast = 0;
  private applied = { hour: -1, overcast: -1, season: '', force: true };
  private quality: Quality = 'high';
  private slowFrames: number[] = [];
  private rendered = false;
  private readonly weather: WeatherOverlay;
  private readonly button = document.querySelector<HTMLButtonElement>('#atmosphere-toggle')!;
  private readonly menu = document.querySelector<HTMLElement>('#atmosphere-menu')!;
  private readonly status = document.createElement('p');
  private readonly qualityNote = document.createElement('small');

  constructor(private readonly host: Host) {
    this.weather = new WeatherOverlay(document.querySelector('#city-canvas')!);
    this.buildMenu();
    this.setQuality(this.settings.quality === 'auto' ? autoQuality() : this.settings.quality);
    host.view.app.on('postrender', () => { this.rendered = true; });
    this.button.addEventListener('click', () => this.open(this.menu.hidden));
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !this.menu.hidden) { event.preventDefault(); event.stopPropagation(); this.open(false); this.button.focus(); }
    }, true);
    document.addEventListener('pointerdown', event => {
      if (!this.menu.hidden && !this.menu.contains(event.target as Node) && !this.button.contains(event.target as Node)) this.open(false);
    });
  }

  private open(open: boolean) {
    this.menu.hidden = !open; this.button.setAttribute('aria-expanded', String(open));
    if (open) this.menu.querySelector<HTMLInputElement>('input:checked')?.focus();
  }

  private buildMenu() {
    const heading = document.createElement('h3'); heading.textContent = 'บรรยากาศเมือง';
    this.status.className = 'atmosphere-status';
    const group = <T extends string>(legend: string, name: string, values: readonly T[], labels: Record<T, string>, current: T, onChange: (value: T) => void) => {
      const fieldset = document.createElement('fieldset'), title = document.createElement('legend'); title.textContent = legend; fieldset.append(title);
      for (const value of values) {
        const label = document.createElement('label'), input = document.createElement('input');
        input.type = 'radio'; input.name = name; input.value = value; input.checked = value === current;
        input.addEventListener('change', () => { if (input.checked) onChange(value); });
        label.append(input, document.createTextNode(labels[value])); fieldset.append(label);
      }
      return fieldset;
    };
    const toggle = (text: string, current: boolean, onChange: (value: boolean) => void) => {
      const label = document.createElement('label'), input = document.createElement('input');
      label.className = 'atmosphere-check'; input.type = 'checkbox'; input.checked = current;
      input.addEventListener('change', () => onChange(input.checked));
      label.append(input, document.createTextNode(text)); return label;
    };
    const time = group('เวลาในวัน', 'atmosphere-time', TIME_MODES, TIME_LABELS, this.settings.timeMode, value => this.change({ timeMode: value }));
    const quality = group('คุณภาพภาพ', 'atmosphere-quality', ['auto', ...QUALITIES] as const, QUALITY_LABELS, this.settings.quality, value => {
      this.change({ quality: value }); this.slowFrames = []; this.setQuality(value === 'auto' ? autoQuality() : value);
    });
    this.qualityNote.className = 'atmosphere-note'; quality.append(this.qualityNote);
    const note = document.createElement('p'); note.className = 'atmosphere-note';
    note.textContent = 'เวลาในวัน ฤดูกาล และฝนเป็นภาพบรรยากาศเท่านั้น ไม่มีผลต่อการจำลองหรือเซฟ · 1 tick ยังเท่ากับ 1 วัน';
    this.menu.replaceChildren(heading, this.status, time, quality,
      toggle('ฤดูกาลตามเดือนในเกม', this.settings.seasons, value => this.change({ seasons: value })),
      toggle('ฝนตามฤดู (ภาพตกแต่ง)', this.settings.rain, value => this.change({ rain: value })), note);
  }

  private change(patch: Partial<VisualSettings>) {
    Object.assign(this.settings, patch); saveVisualSettings(this.settings); this.applied.force = true;
  }

  private setQuality(quality: Quality) {
    this.quality = quality; this.host.view.setQuality(quality);
    this.qualityNote.textContent = `ใช้อยู่: ${QUALITY_LABELS[quality]}${this.settings.quality === 'auto' ? ' (เลือกตามอุปกรณ์)' : ''}`;
    document.documentElement.dataset.visualQuality = quality;
  }

  /** Auto quality steps down when frames right after a render stay slow. */
  private watchFrameRate(dt: number) {
    if (this.settings.quality !== 'auto' || this.quality === 'low') { this.rendered = false; return; }
    if (this.rendered) { this.slowFrames.push(dt); this.rendered = false; }
    if (this.slowFrames.length < 24) return;
    const sorted = [...this.slowFrames].sort((a, b) => a - b), median = sorted[sorted.length >> 1];
    this.slowFrames = [];
    if (median > 1 / 22) this.setQuality(this.quality === 'high' ? 'medium' : 'low');
  }

  update(dt: number) {
    const running = !this.host.isPaused() && !document.hidden;
    this.watchFrameRate(dt);
    if (running) { this.autoHour = advanceHour(this.autoHour, dt, this.host.getSpeed()); this.weatherClock += Math.min(dt, .25); }
    const city = this.host.getCity();
    const weights = this.settings.seasons ? seasonWeights(city.tick + this.host.tickFraction()) : NO_SEASON;
    const raining = this.settings.rain && isRaining(city.seed, this.weatherClock / WEATHER_PERIOD_SECONDS, this.settings.seasons ? weights : { hot: 0, rainy: .4, cool: 0 });
    if (running || this.applied.force) this.overcast += ((raining ? .82 : 0) - this.overcast) * Math.min(1, dt / 5);
    const hour = resolveHour(this.settings.timeMode, this.autoHour), season = this.settings.seasons ? dominantSeason(weights) : '';
    this.weather.set(raining && this.overcast > .35 ? this.overcast : 0);
    const a = this.applied, hourDelta = Math.abs(hour - a.hour);
    if (!a.force && Math.min(hourDelta, 24 - hourDelta) < .04 && Math.abs(this.overcast - a.overcast) < .015 && season === a.season) return;
    const atmosphere = atmosphereAt(hour, weights, this.overcast);
    this.host.view.setAtmosphere(atmosphere);
    Object.assign(this.applied, { hour, overcast: this.overcast, season, force: false });
    const phase = phaseOf(hour), clock = formatClock(hour), rainText = this.weather.raining ? ' · ฝนตก' : '';
    const seasonText = season ? `${SEASON_LABELS[season]} · ` : '';
    this.button.querySelector('.sky-icon')!.textContent = this.weather.raining ? '☂' : PHASE_ICONS[phase];
    this.button.querySelector('.sky-clock')!.textContent = clock;
    this.button.setAttribute('aria-label', `บรรยากาศเมือง: ${PHASE_LABELS[phase]} ${clock}${seasonText ? ' · ' + seasonText.slice(0, -3) : ''}${rainText}`);
    this.status.textContent = `${seasonText}${PHASE_LABELS[phase]} ${clock}${rainText}`;
    document.documentElement.dataset.phase = phase;
  }

  get diagnostics() {
    return { ...this.host.view.atmosphere.diagnostics, settings: { ...this.settings }, overcast: this.overcast, raining: this.weather.raining };
  }
}
