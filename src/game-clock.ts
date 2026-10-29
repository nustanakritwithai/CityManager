/**
 * The single source of the game's playback rate. One economic day is still
 * 1440 game minutes; only how many real seconds a day takes lives here.
 * There is no speed multiplier: normal play is fixed, citizen watch is a
 * slower viewing mode, and pause advances nothing.
 */
export const GAME_MINUTES_PER_DAY = 1440;
export const REAL_SECONDS_PER_DAY = 6;
/** 1440 / 6 = 240 game minutes per real second. */
export const NORMAL_GAME_MINUTES_PER_SECOND = GAME_MINUTES_PER_DAY / REAL_SECONDS_PER_DAY;
/** Citizen watch: one game minute per real second (a day takes 24 real minutes). */
export const CITIZEN_WATCH_GAME_MINUTES_PER_SECOND = 1;
/** Existing per-frame catch-up clamp: a long or background frame never counts more than this. */
export const MAX_FRAME_SECONDS = 0.25;

export type ClockMode = 'normal' | 'citizen-watch';
export const gameMinutesPerSecond = (mode: ClockMode) => mode === 'citizen-watch' ? CITIZEN_WATCH_GAME_MINUTES_PER_SECOND : NORMAL_GAME_MINUTES_PER_SECOND;

/** Game minutes one rendered frame advances. Paused or hidden frames advance zero. */
export function frameGameMinutes(dtSeconds: number, mode: ClockMode, paused: boolean, hidden = false): number {
  if (paused || hidden || !(dtSeconds > 0)) return 0;
  return Math.min(dtSeconds, MAX_FRAME_SECONDS) * gameMinutesPerSecond(mode);
}
