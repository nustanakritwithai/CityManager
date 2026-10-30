/**
 * Read-only door onto the engine PR #132 keeps on `trafficLayer.bus`.
 * That object is missing unless the traffic model and `?bus=1` are both on.
 * Board/alight batches come from `subscribeBusEvents` in src/bus/frame.ts (PR #134).
 * `presentBuses` is the only `drainEvents` caller. This module never drains.
 */
import type { BusEvent, BusSnapshot } from './types.ts';

/** The four read APIs the line panel may touch. `drainEvents` is not one of them. */
export type BusLiveRead = {
  snapshot(minute?: number): readonly BusSnapshot[];
  busesDetail(): readonly { id: string; lineId: number; phase: string; returning: boolean; retired: boolean; until: number }[];
  waitingAt(stopId: number): number;
  readonly totals: { readonly accepted: number; readonly boarded: number; readonly completed: number; readonly released: number };
};

let readLive: () => BusLiveRead | null = () => null;
let notes: readonly BusEvent[] = [];
const listeners = new Set<() => void>();
const notify = () => { for (const listener of listeners) listener(); };

/** Called on each panel refresh. Return null when `trafficLayer` or `trafficLayer.bus` is absent. */
export function setBusLiveReader(reader: () => BusLiveRead | null) { readLive = reader; notify(); }
export function getBusLiveSource(): BusLiveRead | null {
  try { return readLive() ?? null; } catch { return null; }
}
export function lastBusBoardNotes(): readonly BusEvent[] { return notes; }
export function subscribeBusLive(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }

/**
 * Subscribe to the batches `presentBuses` already drained and forwarded.
 * The import is indirect so this branch (based on #132) still builds before #134
 * adds `src/bus/frame.ts`. A missing module leaves the panel on route data only.
 */
export async function connectPresentedBusEvents(): Promise<(() => void) | null> {
  try {
    const specifier = './frame.ts';
    const frame = await import(specifier) as { subscribeBusEvents?: (fn: (events: readonly BusEvent[]) => void) => () => void };
    if (typeof frame.subscribeBusEvents !== 'function') return null;
    return frame.subscribeBusEvents(events => { notes = [...events]; notify(); });
  } catch {
    return null;
  }
}
