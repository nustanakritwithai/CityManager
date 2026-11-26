/**
 * The game clock: how fast a game day passes on screen. At 1× a game day lasts six real minutes, so a game hour is
 * 15 seconds; 3× makes an hour 5 seconds and 10× 1.5 seconds. The city's economy still settles once a day, at midnight;
 * a city started in the game also grows every three game hours (growthRound in sim.ts).
 */
export const DAY_SECONDS = 360;
export const MINUTES_PER_DAY = 1440;
type ClockScope = { __CITYMANAGER_DAY_SECONDS__?: unknown; location?: { search?: string } };
/**
 * Real seconds a game day lasts at 1×. Browser checks that play through many days set a shorter day before the page
 * loads (`__CITYMANAGER_DAY_SECONDS__`, or `?day-seconds=` in the address); anything else keeps the real 360.
 */
export function daySeconds(scope: ClockScope = globalThis as ClockScope): number {
  let value = scope.__CITYMANAGER_DAY_SECONDS__;
  if (value === undefined) { try { value = new URLSearchParams(scope.location?.search ?? '').get('day-seconds') ?? undefined; } catch { value = undefined; } }
  const seconds = typeof value === 'number' || (typeof value === 'string' && value.trim() !== '') ? Number(value) : NaN;
  return Number.isFinite(seconds) && seconds > 0 && seconds <= 86_400 ? seconds : DAY_SECONDS;
}
/** Game minutes one frame moves the clock. A frame longer than a quarter second counts as a quarter, so a tab coming back does not jump. */
export const frameMinutes = (dt: number, speed: number, seconds: number) => Math.min(Math.max(0, dt), .25) * speed * MINUTES_PER_DAY / seconds;
/**
 * How much faster than real time the people walking and the cars on the street move: with the game at 3× and 10×,
 * so a commute still fits its rush hour. At 1× and the slower watch-the-citizens pace they keep their real pace.
 */
export const streetRate = (speed: number) => Math.max(1, speed);
/** The speed at which one game minute passes each real second: the "watch the citizens" pace. */
export const minuteASecondSpeed = (seconds: number) => seconds / MINUTES_PER_DAY;
/** "08:00" for a minute of the day. */
export function clockLabel(minuteOfDay: number): string {
  const minute = ((Math.floor(minuteOfDay) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}
/** The sky follows the game clock once a game day lasts at least half a minute at this speed; faster days keep its own slow cycle. */
export const skyFollowsClock = (seconds: number, speed: number) => speed > 0 && seconds / speed >= 30;
const amount = (n: number) => Number.isInteger(n) ? String(n) : n.toFixed(1);
/** "15 วินาที" or "6 นาที". */
export const durationLabel = (seconds: number) => seconds >= 60 ? `${amount(seconds / 60)} นาที` : `${amount(seconds)} วินาที`;
/** The short pace note beside the date: "1 วัน = 6 นาที". */
export const paceLabel = (seconds: number) => `1 วัน = ${durationLabel(seconds)}`;
/** How long an hour and a day last at one speed: "1 ชม. = 15 วินาที · 1 วัน = 6 นาที". */
export const paceAt = (seconds: number, speed: number) => `1 ชม. = ${durationLabel(seconds / 24 / speed)} · 1 วัน = ${durationLabel(seconds / speed)}`;
/** The long form for the tooltip: an hour and a day at each speed button. */
export const paceTitle = (seconds: number) => [1, 3, 10].map(speed => `${speed}×: ${paceAt(seconds, speed)}`).join('\n');
