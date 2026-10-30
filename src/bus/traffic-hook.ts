/**
 * Bus → traffic road-load adapter (PR B5). NO-OP until the traffic bridge supports `mode:'bus'`.
 * `src/traffic/bridge.ts` is owned by the road bot and is NOT edited here. Its own PR plugs in by
 * providing a `BusRoadSink` and calling `connectBusRoadSink(sink)`; nothing else changes.
 *
 * Contract the bridge PR must meet (see PR B5 body):
 *  1. `ModeLeaseRequest.mode` / `ModeLeaseReceipt.mode` accept `'bus'` (alongside 'taxi' | 'rail'),
 *     including snapshot import validation; bus leases count into a `busPendingPersons` /
 *     `busCompletedPersons` pair of `PassengerReceipt` and keep `conservationError === 0`.
 *  2. A sink object `{ acceptsBus: true; applyBusLoad(minute, load) }` where `load` is
 *     `ReadonlyMap<linkKey, PCU>` from `BusEngine.roadLoad(minute)` (linkKey = `${from}:${to}` from
 *     traffic/network.ts, PCU = BUS_PCU per moving bus). The map REPLACES the previous bus load (not
 *     additive); an empty map clears it. Must be idempotent for the same minute and must not throw on
 *     unknown links (ignore them).
 *  3. Bus load only consumes link capacity; it never creates/admits passenger moves (riders are
 *     owned by BusEngine and returned to cars via its `release` callback).
 */
export type BusRoadLoad = ReadonlyMap<string, number>;
export interface BusRoadSink { readonly acceptsBus: true; applyBusLoad(minute: number, load: BusRoadLoad): void }
export interface BusTrafficHook { readonly active: boolean; push(minute: number, load: () => BusRoadLoad): void }

class Hook implements BusTrafficHook {
  sink: BusRoadSink | null = null; pushes = 0;
  get active() { return !!this.sink && this.sink.acceptsBus === true; }
  /** Load is lazy: when no sink is connected `roadLoad()` is not even computed. */
  push(minute: number, load: () => BusRoadLoad): void { if (!this.active) return; this.pushes++; this.sink!.applyBusLoad(minute, load()); }
}
/** Create a hook. Without a sink (today) every push is a no-op. */
export function createBusTrafficHook(sink: BusRoadSink | null = null): BusTrafficHook & { connect(s: BusRoadSink | null): void } {
  const h = new Hook(); h.sink = sink;
  return Object.assign(h, { connect(s: BusRoadSink | null) { h.sink = s && s.acceptsBus === true ? s : null; } });
}
