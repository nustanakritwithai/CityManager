/**
 * Web Audio for the game: four buses (ui, events, ambience, music) under one master, short
 * CC0 effects decoded once, three CC0 music tracks streamed in turn, and a procedural ambience
 * (rain, wind, city, factory, birds, crickets) shaped by what the city shows. A few short cues
 * (sirens, a coin, an unlock chime, a brush) are synthesised on the spot, so they need no file. Presentation only:
 * it reads state and never touches the simulation, its RNG or the save.
 */
import { DUCK_LEVEL, DUCK_SECONDS, TRACK_TIME, nextTrackFor, type MusicMood } from './music-mood.ts';
import { AUDIO_BUSES, busGain, loadAudioSettings, saveAudioSettings, type AudioBus, type AudioSettings } from './audio-settings.ts';

export type EffectName = 'ui-click' | 'ui-select' | 'ui-place' | 'ui-road' | 'ui-bulldoze' | 'ui-error' | 'ui-save' | 'ui-open' | 'ui-close' | 'ui-toggle'
  | 'ev-build-home' | 'ev-build-business' | 'ev-build-farm' | 'ev-arrival' | 'ev-month' | 'ev-shop' | 'ev-issue' | 'ev-broke' | 'jingle-level' | 'jingle-win';
export const EFFECTS: readonly EffectName[] = ['ui-click', 'ui-select', 'ui-place', 'ui-road', 'ui-bulldoze', 'ui-error', 'ui-save', 'ui-open', 'ui-close', 'ui-toggle',
  'ev-build-home', 'ev-build-business', 'ev-build-farm', 'ev-arrival', 'ev-month', 'ev-shop', 'ev-issue', 'ev-broke', 'jingle-level', 'jingle-win'];
/** Cues built from oscillators and noise when played; listed apart because they have no file to fetch. */
export type SynthName = 'ev-fire' | 'ev-alarm' | 'ev-medical' | 'ev-unlock' | 'ev-coin' | 'ui-brush';
export const SYNTHS: readonly SynthName[] = ['ev-fire', 'ev-alarm', 'ev-medical', 'ev-unlock', 'ev-coin', 'ui-brush'];
export type SoundName = EffectName | SynthName;
const isSynth = (name: string): name is SynthName => (SYNTHS as readonly string[]).includes(name);
export const TRACKS = [
  { file: 'music-another-august.mp3', title: 'Another August', artist: 'The Cynic Project' },
  { file: 'music-vaporware.mp3', title: 'Vaporware', artist: 'The Cynic Project' },
  { file: 'music-apple-cider.mp3', title: 'Apple Cider', artist: 'Zane Little Music' },
] as const;
/** What the ambience follows, each 0–1 except the phase. */
/** Venue layers near the camera (see venue-life.ts), each 0–1; absent means none. */
export type VenueAmbience = { crowd: number; chatter: number; temple: number; airport: number };
export type AmbienceState = { phase: 'night' | 'dawn' | 'day' | 'dusk'; rain: number; traffic: number; factories: number; closeness: number; venues?: VenueAmbience };

const busOf = (name: SoundName): AudioBus => name.startsWith('ui-') ? 'ui' : 'events';

export class AudioEngine {
  readonly settings: AudioSettings = loadAudioSettings();
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly buses = new Map<AudioBus, GainNode>();
  private readonly buffers = new Map<EffectName, AudioBuffer>();
  private music: HTMLAudioElement | null = null;
  private track = Math.floor(Math.random() * TRACKS.length);
  private ambience: { rain: GainNode; wind: GainNode; city: GainNode; factory: GainNode; birds: GainNode; crickets: GainNode; crowd: GainNode; chatter: GainNode; venue: GainNode } | null = null;
  private nextBell = 0;
  /** Hour and tension the music follows; set every frame, acted on only when it changes. */
  private mood: MusicMood = { night: false, tense: false };
  private duck: GainNode | null = null;
  private tension: GainNode | null = null;
  private readonly venueLayers = new Set<'crowd' | 'chatter'>();
  private nextPlane = 0;
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

  play(name: SoundName, options: { gain?: number; rate?: number } = {}): void {
    const ctx = this.ctx, bus = this.buses.get(busOf(name));
    this.remember(name);
    if (!ctx || !bus || this.settings.muted || ctx.state !== 'running') return;
    const duck = DUCK_SECONDS[name]; if (duck) this.duckMusic(ctx, duck);
    if (isSynth(name)) { this.synth(ctx, name, bus, options.gain ?? 1); return; }
    const buffer = this.buffers.get(name); if (!buffer) return;
    const source = ctx.createBufferSource(), gain = ctx.createGain();
    source.buffer = buffer; source.playbackRate.value = options.rate ?? 1; gain.gain.value = options.gain ?? 1;
    source.connect(gain).connect(bus); source.start();
  }

  nextTrack(): void { this.playTrack((this.track + 1) % TRACKS.length); }

  /** Follow the hour and the city's tension: the next track suits the hour, and a low undertone plays while tense. */
  setMood(mood: MusicMood): void {
    if (mood.night === this.mood.night && mood.tense === this.mood.tense) return;
    this.mood = { ...mood };
    // Before the music starts, begin on a track that suits the hour; once playing, the change waits for the track to end.
    if (!this.music && TRACK_TIME[this.track] !== (mood.night ? 'night' : 'day')) this.track = nextTrackFor(this.track, mood.night);
    const ctx = this.ctx; if (!ctx) return;
    if (mood.tense) this.startTension(ctx);
    this.tension?.gain.setTargetAtTime(mood.tense ? .05 : 0, ctx.currentTime, 1.5);
  }

  /** The tense undertone: two slightly detuned low saws under a slowly breathing low-pass. Built the first time the city turns tense, never before. */
  private startTension(ctx: AudioContext) {
    if (this.tension || !this.buses.get('music')) return;
    const tension = ctx.createGain(), low = ctx.createBiquadFilter(), breath = ctx.createOscillator(), depth = ctx.createGain();
    tension.gain.value = 0; low.type = 'lowpass'; low.frequency.value = 240; breath.frequency.value = .08; depth.gain.value = 90;
    breath.connect(depth).connect(low.frequency); breath.start();
    for (const f of [55, 55.6]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(low); o.start(); }
    low.connect(tension).connect(this.buses.get('music')!); this.tension = tension;
  }

  private playTrack(index: number) { this.track = index; if (this.music) { this.music.src = this.base + TRACKS[this.track].file; this.syncMusic(); } }

  /** Lower the music for a moment under an important cue, then let it come back. */
  private duckMusic(ctx: AudioContext, seconds: number) {
    if (!this.duck) return;
    const g = this.duck.gain, t = ctx.currentTime;
    g.cancelScheduledValues(t); g.setTargetAtTime(DUCK_LEVEL, t, .08); g.setTargetAtTime(1, t + seconds, .5);
  }

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
    // Venues near the camera: a crowd swelling at a stadium or concert, chatter at a market, a temple bell, a passing plane.
    const v = state.venues ?? { crowd: 0, chatter: 0, temple: 0, airport: 0 }, dry = 1 - state.rain * .5;
    if (v.crowd > 0) this.startVenueLayer(ctx, 'crowd', a.crowd);
    if (v.chatter > 0) this.startVenueLayer(ctx, 'chatter', a.chatter);
    glide(a.crowd, v.crowd * .22 * dry); glide(a.chatter, v.chatter * .12 * dry);
    if (v.temple > .05 && t >= this.nextBell) { this.bell(ctx, a.venue, t, v.temple); this.nextBell = t + 9 + Math.random() * 7; }
    if (v.airport > .05 && t >= this.nextPlane) { this.plane(ctx, a.venue, t, v.airport); this.nextPlane = t + 25 + Math.random() * 20; }
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
      el.addEventListener('ended', () => { setTimeout(() => this.playTrack(nextTrackFor(this.track, this.mood.night)), 6000); });
      const duck = ctx.createGain(); duck.connect(this.buses.get('music')!); this.duck = duck;
      try { ctx.createMediaElementSource(el).connect(duck); } catch { /* falls back to the element's own output */ }
      this.music = el;
      if (this.mood.tense) this.startTension(ctx);
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
    // Venue layers get their sound sources only when a venue is first heard (see startVenueLayer), so a city
    // without venues never runs them.
    const crowd = layer(), chatter = layer(), venue = ctx.createGain(); venue.connect(out);
    this.ambience = { rain, wind, city, factory, birds, crickets, crowd, chatter, venue };
  }

  /** Crowd: brown noise around 700 Hz swelling slowly. Chatter: a fast-pulsed 1.4 kHz band. Built once, on first need. */
  private startVenueLayer(ctx: AudioContext, kind: 'crowd' | 'chatter', out: GainNode) {
    if (this.venueLayers.has(kind)) return;
    this.venueLayers.add(kind);
    const band = ctx.createBiquadFilter(), shape = ctx.createGain(), lfo = ctx.createOscillator(), depth = ctx.createGain();
    band.type = 'bandpass';
    if (kind === 'crowd') { band.frequency.value = 700; band.Q.value = .8; shape.gain.value = .75; lfo.frequency.value = .23; depth.gain.value = .25; }
    else { band.frequency.value = 1400; band.Q.value = 1.5; shape.gain.value = .6; lfo.type = 'triangle'; lfo.frequency.value = 6.5; depth.gain.value = .4; }
    lfo.connect(depth).connect(shape.gain); lfo.start();
    this.noise(ctx, kind === 'crowd').connect(band).connect(shape).connect(out);
  }

  /** One synthesised cue, at most about 1.5 s, through its bus. */
  private synth(ctx: AudioContext, name: SynthName, bus: GainNode, level: number) {
    const t = ctx.currentTime + .01, out = ctx.createGain(); out.gain.value = level; out.connect(bus);
    const tone = (type: OscillatorType, freq: number, start: number, length: number, peak: number, glideTo?: number) => {
      const osc = ctx.createOscillator(), env = ctx.createGain(); osc.type = type; osc.frequency.setValueAtTime(freq, start);
      if (glideTo) osc.frequency.linearRampToValueAtTime(glideTo, start + length);
      env.gain.setValueAtTime(0, start); env.gain.linearRampToValueAtTime(peak, start + .012); env.gain.setValueAtTime(peak, start + Math.max(.012, length - .06)); env.gain.exponentialRampToValueAtTime(.0001, start + length);
      osc.connect(env).connect(out); osc.start(start); osc.stop(start + length + .02);
    };
    const soften = (cutoff: number) => { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff; out.disconnect(); out.connect(f).connect(bus); };
    if (name === 'ev-coin') { tone('sine', 1320, t, .09, .22); tone('sine', 1760, t + .07, .28, .2); tone('triangle', 2640, t + .07, .18, .05); }
    else if (name === 'ev-unlock') [1047, 1319, 1568, 2093].forEach((f, i) => { tone('triangle', f, t + i * .09, .5 - i * .05, .16); tone('sine', f * 2, t + i * .09, .2, .03); });
    else if (name === 'ev-fire') { soften(1800); tone('triangle', 650, t, .7, .13, 960); tone('triangle', 960, t + .7, .7, .13, 650); }
    else if (name === 'ev-alarm') { soften(2200); [960, 770, 960, 770].forEach((f, i) => tone('square', f, t + i * .16, .15, .05)); }
    else if (name === 'ev-medical') { soften(2400); [880, 660, 880, 660].forEach((f, i) => tone('sine', f, t + i * .24, .23, .12)); }
    else {
      const length = .2, buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * length), ctx.sampleRate), data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      const src = ctx.createBufferSource(), band = ctx.createBiquadFilter(), env = ctx.createGain(); src.buffer = buffer;
      band.type = 'bandpass'; band.Q.value = 1.2; band.frequency.setValueAtTime(1400, t); band.frequency.exponentialRampToValueAtTime(3600, t + length);
      env.gain.setValueAtTime(0, t); env.gain.linearRampToValueAtTime(.18, t + .03); env.gain.exponentialRampToValueAtTime(.0001, t + length);
      src.connect(band).connect(env).connect(out); src.start(t); src.stop(t + length);
    }
  }

  /** One temple bell strike: three inharmonic sine partials ringing out over about four seconds. */
  private bell(ctx: AudioContext, out: GainNode, at: number, level: number) {
    for (const [ratio, peak, length] of [[1, .12, 4], [2.4, .05, 2.6], [4.1, .025, 1.6]] as const) {
      const osc = ctx.createOscillator(), env = ctx.createGain(); osc.frequency.value = 392 * ratio;
      env.gain.setValueAtTime(0, at); env.gain.linearRampToValueAtTime(peak * level, at + .01); env.gain.exponentialRampToValueAtTime(.0001, at + length);
      osc.connect(env).connect(out); osc.start(at); osc.stop(at + length + .05);
    }
  }
  /** A plane passing over: a band of low noise rising and falling in pitch and loudness over five seconds. */
  private plane(ctx: AudioContext, out: GainNode, at: number, level: number) {
    const length = 5, buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * length), ctx.sampleRate), data = buffer.getChannelData(0);
    let last = 0; for (let i = 0; i < data.length; i++) { last = (last + .02 * (Math.random() * 2 - 1)) / 1.02; data[i] = last * 3.5; }
    const src = ctx.createBufferSource(), band = ctx.createBiquadFilter(), env = ctx.createGain(); src.buffer = buffer;
    band.type = 'bandpass'; band.Q.value = .9; band.frequency.setValueAtTime(260, at); band.frequency.linearRampToValueAtTime(820, at + length * .5); band.frequency.linearRampToValueAtTime(320, at + length);
    env.gain.setValueAtTime(0, at); env.gain.linearRampToValueAtTime(.3 * level, at + length * .5); env.gain.linearRampToValueAtTime(0, at + length);
    src.connect(band).connect(env).connect(out); src.start(at); src.stop(at + length);
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
