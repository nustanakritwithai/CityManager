/**
 * On-map bus renderer.
 *
 * The engine is not created here. PR 5 owns it on `trafficLayer.bus` and ticks it. That field is
 * null/undefined unless both the traffic model and `busEnabled()` (`?bus=1`) are on. Every frame
 * this null-checks it and, when it is missing, draws nothing and does not call `drainEvents`.
 *
 * `presentBuses` is the only `drainEvents` call. Board/alight events are forwarded through
 * `subscribeBusEvents` so PR 6's UI can consume them without draining. A reloaded save makes the
 * traffic layer build a new engine, which starts buses at their depots; this view only draws the
 * snapshot it is given.
 */
import type { AppBase } from 'playcanvas';
import type { BusHost } from './lines.ts';
import { SceneBuses } from './scene-buses.ts';
import { publishBusMap } from './map-state.ts';
import { EMPTY_BUS_DRAW, busInstanceCounts } from './draw-list.ts';
import { busEventSubscriberCount, presentBuses, type BusFrame, type BusLayerLike } from './frame.ts';

export class BusPresentation {
  private readonly scene: SceneBuses;
  private last: BusFrame = { drew: false, events: [], draw: EMPTY_BUS_DRAW };
  constructor(app: AppBase) { this.scene = new SceneBuses(app); }
  /**
   * Once per frame, after `TrafficLayer.frame`. Does not advance the engine.
   * `source` is the traffic layer (or null when traffic is off).
   */
  frame(city: BusHost, source: BusLayerLike): void {
    let result: BusFrame;
    try { result = presentBuses(source, city); }
    catch (error) { console.error(error); return; }
    this.scene.sync(result.draw);
    publishBusMap(result.drew ? result.draw : null);
    this.last = result;
  }
  get diagnostics() {
    return { drew: this.last.drew, events: this.last.events.length, subscribers: busEventSubscriberCount(), ...busInstanceCounts(this.last.draw), scene: this.scene.diagnostics };
  }
  destroy(): void { this.scene.destroy(); publishBusMap(null); }
}
