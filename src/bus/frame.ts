/**
 * One visual frame of the on-map bus layer.
 *
 * `BusEngine.drainEvents()` removes every pending board/alight event. It is called in exactly
 * one place: `presentBuses`, and only when `source.bus.engine` exists. Call `presentBuses` once
 * per frame (from `BusPresentation.frame`, after `TrafficLayer.frame`). The drained batch is
 * forwarded to subscribers, including an empty batch when the engine had nothing new.
 *
 * PR 6's UI must use `subscribeBusEvents` and must not call `drainEvents` itself. A second drain
 * would see an empty queue and those events would never reach the UI.
 *
 * This function does not construct an engine and does not call `advanceTo`. PR 5 owns the engine
 * on `trafficLayer.bus` and ticks it. `trafficLayer.bus` is null/undefined unless both the traffic
 * model and `?bus=1` are on — then this draws nothing, does not touch the city, and does not drain.
 */
import type { BusHost } from './lines.ts';
import type { BusEvent, BusSnapshot } from './types.ts';
import { EMPTY_BUS_DRAW, busDrawList, type BusDrawList } from './draw-list.ts';

export type BusEventListener = (events: readonly BusEvent[]) => void;
export type BusViewEngine = {
  snapshot(minute?: number): readonly BusSnapshot[];
  drainEvents(): BusEvent[];
  busesDetail(): readonly { id: string; returning: boolean }[];
  waitingAt(stopId: number): number;
};
/** `bus` missing, null, or undefined → nothing to draw. Matches `trafficLayer` / `trafficLayer.bus`. */
export type BusLayerLike = { bus?: { engine?: BusViewEngine | null } | null } | null | undefined;

export class BusEventFanout {
  private readonly listeners = new Set<BusEventListener>();
  subscribe(fn: BusEventListener): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }
  get size() { return this.listeners.size; }
  /** Forwards one drained batch. A throwing subscriber does not skip the others or the draw. */
  emit(events: readonly BusEvent[]): void {
    for (const fn of [...this.listeners]) {
      try { fn(events); } catch (error) { console.error('bus event subscriber failed', error); }
    }
  }
}

const shared = new BusEventFanout();
/** Subscribe to board/alight events. The renderer is the only code that drains the engine. */
export function subscribeBusEvents(fn: BusEventListener): () => void { return shared.subscribe(fn); }
export function busEventSubscriberCount(): number { return shared.size; }

export type BusFrame = { drew: boolean; events: readonly BusEvent[]; draw: BusDrawList };

/** Engine on the traffic layer, or null when bus integration is off. Does not create one. */
export function busEngineFrom(source: BusLayerLike): BusViewEngine | null {
  if (source == null || source.bus == null || source.bus.engine == null) return null;
  return source.bus.engine;
}

/**
 * Snapshot + the single `drainEvents` for this frame. `source.bus` null/undefined → empty draw,
 * no drain, subscribers are not called. Does not advance the engine.
 */
export function presentBuses(source: BusLayerLike, city: BusHost, fanout: BusEventFanout = shared): BusFrame {
  const engine = busEngineFrom(source);
  if (!engine) return { drew: false, events: [], draw: EMPTY_BUS_DRAW };
  const snapshots = engine.snapshot();
  const detail = engine.busesDetail();
  const events = engine.drainEvents();
  fanout.emit(events);
  return { drew: true, events, draw: busDrawList(city, snapshots, detail, stopId => engine.waitingAt(stopId)) };
}
