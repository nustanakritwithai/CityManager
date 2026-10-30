/**
 * Read-only door for a BusEngine owned somewhere else (PR B4 / #131).
 * This module never constructs an engine and never calls drainEvents().
 * PR 7 drains board/alight events and may forward them here.
 */
import type { BusEvent, BusSnapshot } from './types.ts';

/** The four read APIs the line panel is allowed to touch. */
export type BusLiveRead = {
  snapshot(minute?: number): readonly BusSnapshot[];
  busesDetail(): readonly { id: string; lineId: number; phase: string; returning: boolean; retired: boolean; until: number }[];
  waitingAt(stopId: number): number;
  readonly totals: { readonly accepted: number; readonly boarded: number; readonly completed: number; readonly released: number };
};

let source: BusLiveRead | null = null;
let notes: readonly BusEvent[] = [];
const listeners = new Set<() => void>();
const notify = () => { for (const listener of listeners) listener(); };

/** Host (not this PR) publishes the engine it already advances. Pass null to detach. */
export function setBusLiveSource(next: BusLiveRead | null) { source = next; notify(); }
export function getBusLiveSource(): BusLiveRead | null { return source; }
/**
 * Board/alight events already taken by the renderer. Copy the list for the panel.
 * Do not pass a live buffer that a later drainEvents() would empty; pass the drained array.
 */
export function forwardBusBoardEvents(events: readonly BusEvent[]) { notes = [...events]; notify(); }
export function lastBusBoardNotes(): readonly BusEvent[] { return notes; }
export function subscribeBusLive(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
