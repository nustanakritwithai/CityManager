/**
 * Web Audio for the game: four buses (ui, events, ambience, music) under one master, short
 * CC0 effects decoded once, three CC0 music tracks streamed in turn, and a procedural ambience
 * (rain, wind, city, factory, birds, crickets) shaped by what the city shows. Presentation only:
 * it reads state and never touches the simulation, its RNG or the save.
 */
import { AUDIO_BUSES, busGain, loadAudioSettings, saveAudioSettings, type AudioBus, type AudioSettings } from './audio-settings.ts';

export type EffectName = 'ui-click' | 'ui-select' | 'ui-place' | 'ui-road' | 'ui-bulldoze' | 'ui-error' | 'ui-save' | 'ui-open' | 'ui-close' | 'ui-toggle'
  | 'ev-build-home' | 'ev-build-business' | 'ev-build-farm' | 'ev-arrival' | 'ev-month' | 'ev-shop' | 'ev-issue' | 'ev-broke' | 'jingle-level' | 'jingle-win';
export const EFFECTS: readonly EffectName[] = ['ui-click', 'ui-select', 'ui-place', 'ui-road', 'ui-bulldoze', 'ui-error', 'ui-save', 'ui-open', 'ui-close', 'ui-toggle',
  'ev-build-home', 'ev-build-business', 'ev-build-farm', 'ev-arrival', 'ev-month', 'ev-shop', 'ev-issue', 'ev-broke', 'jingle-level', 'jingle-win'];
export const TRACKS = [
  { file: 'music-another-august.mp3', title: 'Another August', artist: 'The Cynic Project' },
  { file: 'music-vaporware.mp3', title: 'Vaporware', artist: 'The Cynic Project' },
  { file: 'music-apple-cider.mp3', title: 'Apple Cider', artist: 'Zane Little Music' },
] as const;
/** What the ambience follows, each 0–1 except the phase. */
export type AmbienceState = { phase: 'night' | 'dawn' | 'day' | 'dusk'; rain: number; traffic: number; factories: number; closeness: number };

const busOf = (name: EffectName): AudioBus => name.startsWith('ui-') ? 'ui' : 'events';

export class AudioEngine {
  readonly settings: AudioSettings = loadAudioSettings();
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly buses = new Map<AudioBus, GainNode>();
  private readonly buffers = new Map<EffectName, AudioBuffer>();
  private music: HTMLAudioElement | null = null;
  private track = Math.floor(Math.random() * TRACKS.length);
  private ambience: { rain: GainNode; wind: GainNode; city: GainNode; factory: GainNode; birds: GainNode; crickets: GainNode } | null = null;
  private nextChirp = 0;
  private readonly played: { name: string; at: number }[] = [];
  private failed = '';

  private readonly base: string;
  constructor(base: string) {
    this.base = base;
    const unlock = () => { this.unlock(); };
    for (const type of ['pointerdown', 'keydown', 'touchend'] as const) addEventListener(type, unlock, { capture: true, passive: true });
    document.addEventListener('visibilitychange', () => { if (!this.ctx) return; if (document.hidden) void this.ctx.suspend(); else void this.ctx.resume(); this.syncMusic(); });
  }

  get unlocked() { return !!this.ctx; }
  get nowPlaying() { return TRACKS[this.track]; }

  /** Browsers only allow audio after a gesture: the first tap or key press builds the graph. */
  unlock(): void {
    if (this.ctx) { if (this.ctx.state === 'suspended' && !document.hidden) void this.ctx.resume(); return; }
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) { this.failed = 'no-web-audio'; return; }
      const ctx = new Ctor(), compressor = ctx.createDynamicsCompressor(), master = ctx.createGain();
      compressor.threshold.value = -14; compressor.ratio.value = 4; master.connect(compressor).connect(ctx.destination);
      this.ctx = ctx; this.master = master;
      for (const bus of AUDIO_BUSES) { const gain = ctx.createGain(); gain.connect(master); this.buses.set(bus, gain); }
      this.applyGains(true); this.buildAmbience(ctx); void this.loadEffects(ctx); this.syncMusic();
    } catch (error) { this.failed = error instanceof Error ? error.message : 'audio-failed'; this.ctx = null; }
  }

  change(patch: Partial<AudioSettings>): void {
    Object.assign(this.settings, patch); saveAudioSettings(this.settings); this.applyGains(); this.syncMusic();
  }

  play(name: EffectName, options: { gain?: number; rate?: number } = {}): void {
    const ctx = this.ctx, buffer = this.buffers.get(name), bus = this.buses.get(busOf(name));
    this.remember(name);
    if (!ctx || !buffer || !bus || this.settings.muted || ctx.state !== 'running') return;
    const source = ctx.createBufferSource(), gain = ctx.createGain();
    source.buffer = buffer; source.playbackRate.value = options.rate ?? 1; gain.gain.value = options.gain ?? 1;
    source.connect(gain).connect(bus); source.start();
  }

  nextTrack(): void { this.track = (this.track + 1) % TRACKS.length; if (this.music) { this.music.src = this.base + TRACKS[this.track].file; this.syncMusic(); } }

  /** Called every frame with what the screen shows; gains glide, chirps are scheduled ahead. */
  updateAmbience(state: AmbienceState): void {
    const ctx = this.ctx, a = this.ambience; if (!ctx || !a || ctx.state !== 'running') return;
    const t = ctx.currentTime, glide = (g: GainNode, v: number) => g.gain.setTargetAtTime(Math.max(0, v), t, .6);
    const day = state.phase === 'day' ? 1 : state.phase === 'dawn' || state.phase === 'dusk' ? .5 : 0;
    glide(a.rain, state.rain * .5);
    glide(a.wind, .05 + (1 - state.closeness) * .12 + state.rain * .05);
    glide(a.city, state.traffic * (.12 + state.closeness * .2));
    glide(a.factory, state.factories * state.closeness * .1);
    glide(a.crickets, (1 - day) * (1 - state.rain) * .05);
    a.birds.gain.value = day * (1 - state.rain) * (.25 + state.closeness * .35);
    if (day > 0 && state.rain < .5 && t >= this.nextChirp) { this.chirp(ctx, a.birds, t); this.nextChirp = t + 1.5 + Math.random() * 5; }
  }

  diagnostics() {
    return { unlocked: this.unlocked, state: this.ctx?.state ?? 'locked', failed: this.failed, effects: this.buffers.size, settings: { ...this.settings },
      track: this.nowPlaying.title, musicPlaying: !!this.music && !this.music.paused, played: this.played.slice(-20) };
  }

  private remember(name: string) { this.played.push({ name, at: Math.round(performance.now()) }); if (this.played.length > 40) this.played.shift(); }

  private applyGains(now = false) {
    const ctx = this.ctx; if (!ctx || !this.master) return;
    for (const bus of AUDIO_BUSES) { const g = this.buses.get(bus)!.gain, v = this.settings.muted ? 0 : this.settings[bus]; if (now) g.value = v; else g.setTargetAtTime(v, ctx.currentTime, .05); }
    const m = this.settings.muted ? 0 : this.settings.master; if (now) this.master.gain.value = m; else this.master.gain.setTargetAtTime(m, ctx.currentTime, .05);
  }

  private async loadEffects(ctx: AudioContext) {
    await Promise.all(EFFECTS.map(async name => {
      try { const res = await fetch(`${this.base}${name}.mp3`); if (res.ok) this.buffers.set(name, await ctx.decodeAudioData(await res.arrayBuffer())); } catch { /* a missing effect stays silent */ }
    }));
  }

  /** Music streams through an <audio> element; it only plays while the music bus is audible. */
  private syncMusic() {
    const ctx = this.ctx; if (!ctx) return;
    if (!this.music) {
      const el = new Audio(); el.preload = 'none'; el.crossOrigin = 'anonymous'; el.src = this.base + TRACKS[this.track].file;
      el.addEventListener('ended', () => { setTimeout(() => this.nextTrack(), 6000); });
      try { ctx.createMediaElementSource(el).connect(this.buses.get('music')!); } catch { /* falls back to the element's own output */ }
      this.music = el;
    }
    const audible = busGain(this.settings, 'music') > 0 && !document.hidden;
    if (audible && this.music.paused) void this.music.play().catch(() => undefined);
    else if (!audible && !this.music.paused) this.music.pause();
  }

  private noise(ctx: AudioContext, brown: boolean): AudioBufferSourceNode {
    const length = ctx.sampleRate * 3, buffer = ctx.createBuffer(1, length, ctx.sampleRate), data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i++) { const white = Math.random() * 2 - 1; if (brown) { last = (last + .02 * white) / 1.02; data[i] = last * 3.5; } else data[i] = white; }
    const source = ctx.createBufferSource(); source.buffer = buffer; source.loop = true; source.start(); return source;
  }

  private buildAmbience(ctx: AudioContext) {
    const out = this.buses.get('ambience')!, layer = () => { const g = ctx.createGain(); g.gain.value = 0; g.connect(out); return g; };
    const filter = (type: BiquadFilterType, frequency: number, q = .7) => { const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = frequency; f.Q.value = q; return f; };
    const rain = layer(), wind = layer(), city = layer(), factory = layer(), birds = layer(), crickets = layer();
    this.noise(ctx, false).connect(filter('highpass', 900)).connect(filter('lowpass', 7000)).connect(rain);
    const windFilter = filter('lowpass', 420); this.noise(ctx, true).connect(windFilter).connect(wind);
    const lfo = ctx.createOscillator(), depth = ctx.createGain(); lfo.frequency.value = .07; depth.gain.value = 220; lfo.connect(depth).connect(windFilter.frequency); lfo.start();
    this.noise(ctx, true).connect(filter('lowpass', 240)).connect(city);
    this.noise(ctx, false).connect(filter('bandpass', 1100, 1.4)).connect(ctx.createGain()).connect(city);
    const hum = ctx.createOscillator(); hum.type = 'sawtooth'; hum.frequency.value = 55; hum.connect(filter('lowpass', 170)).connect(factory); hum.start();
    const chirpTone = ctx.createOscillator(), am = ctx.createGain(), pulse = ctx.createOscillator(), pulseDepth = ctx.createGain();
    chirpTone.frequency.value = 4700; pulse.type = 'square'; pulse.frequency.value = 26; pulseDepth.gain.value = .5; am.gain.value = .5;
    pulse.connect(pulseDepth).connect(am.gain); chirpTone.connect(am).connect(crickets); chirpTone.start(); pulse.start();
    this.ambience = { rain, wind, city, factory, birds, crickets };
  }

  /** A short bird phrase: two to four rising sine chirps. */
  private chirp(ctx: AudioContext, out: GainNode, at: number) {
    const notes = 2 + Math.floor(Math.random() * 3), base = 2800 + Math.random() * 1600;
    for (let i = 0; i < notes; i++) {
      const start = at + i * (.11 + Math.random() * .05), osc = ctx.createOscillator(), env = ctx.createGain();
      osc.frequency.setValueAtTime(base, start); osc.frequency.exponentialRampToValueAtTime(base * 1.35, start + .07);
      env.gain.setValueAtTime(0, start); env.gain.linearRampToValueAtTime(.08, start + .01); env.gain.exponentialRampToValueAtTime(.0001, start + .09);
      osc.connect(env).connect(out); osc.start(start); osc.stop(start + .1);
    }
  }
}
