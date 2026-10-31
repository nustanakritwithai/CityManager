/**
 * Bus ↔ #126 traffic allocation game: pure, worker-safe shapes and the mode-share step.
 * Main thread compiles `GameBusInput` from `city.bus` + BusEngine routes; the worker game
 * applies `busShare` (mode-share.ts, same logit as B1) per representative OD, removes the bus
 * part from road demand and accumulates it per OD. The host turns accumulated totals into whole
 * riders for `BusEngine.submit`. Absent `bus` input = game unchanged.
 *
 * Game assumption (NOT real transport): one demand rate unit per game step = GAME_BUS_PERSONS_PER_RATE
 * persons; a released rider re-enters the game as 1 / GAME_BUS_PERSONS_PER_RATE car units.
 */
import { busAccess, busShare } from './mode-share.ts';
import type { BusLine, BusOdCost, BusStop } from './types.ts';

export const GAME_BUS_PERSONS_PER_RATE = 1;
export type GameBusLine = { line: BusLine; waitMinutes: number; ride: Record<string, number> };
/** Sent with every traffic-game input while bus is on. All fields plain data (structured-clone safe). */
export type GameBusInput = {
  stops: BusStop[]; lines: GameBusLine[];
  /** linkKey → PCU of buses on that link now (BUS_PCU = 2 each). Replaces the previous load. */
  load: Record<string, number>;
  /** Cumulative released riders per `from:to` (car units). The game injects only the not-yet-applied delta. */
  returns: Record<string, number>;
};
export type GameBusShare = { share: number; lineId: number; fromStopId: number; toStopId: number };
/** Per-OD bus record the game reports (cumulative, committed with the game state). */
export type GameBusTotal = { from: number; to: number; lineId: number; fromStopId: number; toStopId: number; total: number };
export type GameBusFrame = { totals: GameBusTotal[]; injected: Record<string, number>; diverted: number; returned: number };

const W = 24;
const carMinutes = (a: number, b: number) => (Math.abs(a % W - b % W) + Math.abs(Math.floor(a / W) - Math.floor(b / W))) * .5;
/** Bus offer + logit share for one OD (null = no bus). Pure; deterministic. */
export function gameBusShare(input: GameBusInput, from: number, to: number): GameBusShare | null {
  if (from === to) return null;
  const a = busAccess(from, to, input.stops, input.lines.map(l => l.line), W); if (!a) return null;
  const l = input.lines.find(x => x.line.id === a.lineId), ride = l?.ride[`${a.fromStopId}:${a.toStopId}`];
  if (!l || ride === undefined || !Number.isFinite(l.waitMinutes)) return null;
  const cost: BusOdCost = { lineId: a.lineId, fromStopId: a.fromStopId, toStopId: a.toStopId, walkMinutes: a.walkMinutes, waitMinutes: l.waitMinutes, rideMinutes: ride, seats: Number.MAX_SAFE_INTEGER };
  const share = busShare(carMinutes(from, to), cost);
  return share > 0 ? { share, lineId: a.lineId, fromStopId: a.fromStopId, toStopId: a.toStopId } : null;
}
export function validGameBusInput(v: unknown): v is GameBusInput {
  const b = v as GameBusInput;
  return !!b && Array.isArray(b.stops) && b.stops.length <= 40 && Array.isArray(b.lines) && b.lines.length <= 8 && !!b.load && typeof b.load === 'object' && !!b.returns && typeof b.returns === 'object'
    && Object.values(b.load).every(x => typeof x === 'number' && Number.isFinite(x) && x >= 0) && Object.values(b.returns).every(x => typeof x === 'number' && Number.isFinite(x) && x >= 0);
}
