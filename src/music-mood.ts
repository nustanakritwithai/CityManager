/**
 * Music mood, read-only: which track suits the hour, when the city is tense enough for a low undertone, and
 * which cues briefly lower the music so they can be heard. Pure choices; the audio engine applies them.
 */
export type MusicMood = { night: boolean; tense: boolean };
/** Each track's place in the day, in the order of TRACKS in the audio engine. */
export const TRACK_TIME: readonly ('day' | 'night')[] = ['day', 'night', 'day'];

/** The next track after `current`: the next one in order that suits the hour, or simply the next one when none does. */
export function nextTrackFor(current: number, night: boolean, times: readonly ('day' | 'night')[] = TRACK_TIME): number {
  const want = night ? 'night' : 'day';
  for (let step = 1; step <= times.length; step++) { const i = (current + step) % times.length; if (times[i] === want) return i; }
  return (current + 1) % times.length;
}

/** Days of treasury money left, at the current pace, below which the music turns tense (matches the insight). */
export const TENSE_RUNWAY_DAYS = 90;
/** Tense while the treasury will run dry soon, or on a day with a fire. */
export const isTense = (runwayDays: number | null, fireToday: boolean) => fireToday || (runwayDays !== null && runwayDays < TENSE_RUNWAY_DAYS);

/** Cues that lower the music for a moment so they stand out, and for how many seconds. */
export const DUCK_SECONDS: Readonly<Record<string, number>> = Object.freeze({ 'jingle-level': 3, 'jingle-win': 4, 'ev-unlock': 2, 'ev-fire': 2.2, 'ev-alarm': 1.4, 'ev-medical': 1.6 });
/** How far the music drops while ducked. */
export const DUCK_LEVEL = .35;
