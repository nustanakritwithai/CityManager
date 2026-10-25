/**
 * Per-browser sound settings. Volumes are 0–1 per bus; sound is on at a low level by default and
 * only starts after the player's first tap or key press, as browsers require.
 */
export const AUDIO_KEY = 'citymanager.audio.v1';
export const AUDIO_BUSES = ['ui', 'events', 'ambience', 'music'] as const;
export type AudioBus = typeof AUDIO_BUSES[number];
export type AudioSettings = { muted: boolean; master: number } & Record<AudioBus, number>;
export const AUDIO_DEFAULTS: Readonly<AudioSettings> = Object.freeze({ muted: false, master: .55, ui: .6, events: .75, ambience: .55, music: .35 });

const level = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, Math.round(value * 100) / 100)) : fallback;

export function parseAudioSettings(raw: unknown): AudioSettings {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const out: AudioSettings = { ...AUDIO_DEFAULTS, muted: typeof source.muted === 'boolean' ? source.muted : AUDIO_DEFAULTS.muted, master: level(source.master, AUDIO_DEFAULTS.master) };
  for (const bus of AUDIO_BUSES) out[bus] = level(source[bus], AUDIO_DEFAULTS[bus]);
  return out;
}
export function loadAudioSettings(storage: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): AudioSettings {
  try { const raw = storage?.getItem(AUDIO_KEY); return parseAudioSettings(raw ? JSON.parse(raw) : null); } catch { return parseAudioSettings(null); }
}
export function saveAudioSettings(settings: AudioSettings, storage: Pick<Storage, 'setItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): void {
  try { storage?.setItem(AUDIO_KEY, JSON.stringify(parseAudioSettings(settings))); } catch { /* the settings still apply for this visit */ }
}
/** The gain a bus actually plays at. */
export const busGain = (s: AudioSettings, bus: AudioBus) => s.muted ? 0 : s.master * s[bus];
