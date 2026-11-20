/**
 * The city's buses running on their own, without the opt-in allocation traffic game. One `BusEngine` per city
 * drives every line's real route in real time (one bus minute per played minute, as the game's buses do) and
 * boards real people: each simulated day, the residents whose commute is by bus (see commute.ts) are put on the
 * queue at the stop nearest home, ride to the stop nearest work and get off there. Their fare was already paid
 * in the simulation, so the engine charges nothing here. Read-only over the city; nothing is saved.
 */
import { BusEngine } from './engine.ts';
import { BUS_CAPACITY, BUS_LIVE_TIMING } from './types.ts';
import type { BusHost } from './lines.ts';
import type { City } from '../sim.ts';
import { commutesToday } from '../commute.ts';

/** The bus clock starts at 07:00, as the traffic game's does. */
export const LIVE_BUS_START_MINUTE = 7 * 60;

export class LiveBusService {
  readonly engine: BusEngine;
  private minute = LIVE_BUS_START_MINUTE;
  private day = -1;
  private seq = 0;
  /** People who gave up waiting (too long at the stop, or after the service ended), for diagnostics. */
  released = 0;
  submitted = 0;
  readonly city: City;
  constructor(city: City) {
    this.city = city;
    this.engine = new BusEngine(city as unknown as BusHost, this.minute, { ...BUS_LIVE_TIMING, boardDuringDwell: true, release: (_id, persons) => { this.released += persons; } });
  }
  /** The shape `presentBuses` reads (`source.bus.engine`). */
  get bus() { return { engine: this.engine }; }

  /** Every render frame while the game runs: queue today's real riders once a day, then move the buses on. */
  tick(dt: number, running: boolean) {
    if (!running) return;
    if (this.city.tick !== this.day) { this.day = this.city.tick; this.board(); }
    this.minute += Math.min(.25, Math.max(0, dt)) / 60;
    if (this.minute > this.engine.now) this.engine.advanceTo(this.minute);
  }

  /** Today's bus commuters, one request each, at most a busload waiting at any one stop (the rest are already late). */
  private board() {
    const lines = new Map((this.city.bus?.lines ?? []).map(l => [l.id, l])), waiting = new Map<number, number>(), subs = [];
    for (const t of commutesToday(this.city)) {
      if (t.mode !== 'bus' || !t.bus || t.from === null || t.to === null) continue;
      const line = lines.get(t.bus.lineId); if (!line) continue;
      const cap = BUS_CAPACITY[line.busLevel], already = waiting.get(t.bus.fromStopId) ?? this.engine.waitingAt(t.bus.fromStopId);
      if (already >= cap) continue;
      waiting.set(t.bus.fromStopId, already + 1);
      subs.push({ requestId: `live-${++this.seq}`, purpose: 'commute' as const, from: t.from, to: t.to, persons: 1, lineId: t.bus.lineId, fromStopId: t.bus.fromStopId, toStopId: t.bus.toStopId, fareSatang: 0 });
    }
    if (subs.length) { this.engine.submit(subs, this.engine.now); this.submitted += subs.length; }
  }
}
