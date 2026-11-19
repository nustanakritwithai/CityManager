/**
 * Thai festivals by game date, decoration only: Songkran (13–15 April), Loy Krathong (the full moon of the
 * twelfth month, kept here as 15 November) and New Year (31 December – 1 January). A game month is 30 days and
 * game month 1 is January, as in the seasons. Nothing here changes the simulation.
 */
import { MONTH } from './sim.ts';

export type FestivalKind = 'songkran' | 'loykrathong' | 'newyear';
export const FESTIVAL_LABELS: Record<FestivalKind, string> = { songkran: 'สงกรานต์', loykrathong: 'ลอยกระทง', newyear: 'ปีใหม่' };
/** [month 1–12, first day 1–30, last day] of each festival. */
const DATES: readonly (readonly [FestivalKind, number, number, number])[] = [
  ['songkran', 4, 13, 15], ['loykrathong', 11, 15, 15], ['newyear', 12, 30, 30], ['newyear', 1, 1, 1],
];
/** The game's calendar date for a tick: month 1–12 and day 1–30. */
export const gameDate = (tick: number) => { const day = Math.max(0, Math.floor(tick)); return { month: Math.floor(day / MONTH) % 12 + 1, day: day % MONTH + 1 }; };
/** The festival on this game day, or null. */
export function festivalAt(tick: number): FestivalKind | null {
  const { month, day } = gameDate(tick);
  return DATES.find(([, m, from, to]) => m === month && day >= from && day <= to)?.[0] ?? null;
}
