/** Inert, headless two-terminal/one-line/one-train preparation slice.
 * No main.ts hook, City mutation, storage, economy, renderer or wall-clock timer.
 * ALL capacity/timing values must be supplied; fixture numbers are not approved balance. */
import { createRailGraph, railPath, safeCount, validId, type RailGraph, type RailPath } from './graph.ts';
import type { RailServiceReceipt } from './demand-contract.ts';
import { validateRailSnapshot } from './state-validation.ts';

/** Deliberately unresolved integration choices. Nothing in this slice silently sets these rules. */
export const RAIL_INTEGRATION_DECISIONS = Object.freeze({
  trackGrade: null, constructionCosts: null, upkeep: null, fares: null, upgradeLevels: null, catchmentPolicy: null,
});

export type PassengerStation = { id: string; cell: number; queueCapacity: number; boardingPerMinute: number; alightingPerMinute: number };
export type PassengerRailConfig = {
  id: string; lineId: string; trainId: string; stations: [PassengerStation, PassengerStation]; seats: number;
  minimumDwellMinutes: number; minimumDepartureIntervalMinutes: number;
  /** Bounded preparation session: reject NEW offers at this limit; never evict demand/retry IDs. */
  maxBatches: number;
};
export type PassengerOffer = {
  id: string; requestId: string; leaseId: string; from: number; to: number;
  fromStation: string; toStation: string; persons: number;
  /** Explicit first/last mile supplied by future access planner, not Euclidean catchment magic. */
  readyAtMinute: number; egressMinutes: number;
};
export type PassengerBatch = PassengerOffer & {
  outside: number; waiting: number; onboard: number; completed: number;
  egress: { persons: number; readyAtMinute: number }[];
};
export type PassengerTrainState = {
  station: string; destination: string | null; path: number[]; remainingMinutes: number;
  dwellUntil: number; lastDepartureMinute: number | null; blockOwner: string | null;
};
export type PassengerRailSnapshot = {
  version: 1; minute: number; enabled: boolean; openStations: Record<string, boolean>;
  graphRevision: number; train: PassengerTrainState; batches: PassengerBatch[];
};
const positive = (n: unknown): n is number => safeCount(n) && n > 0;
const sum = (batches: readonly PassengerBatch[], field: 'outside' | 'waiting' | 'onboard' | 'completed') => batches.reduce((n, b) => n + b[field], 0);
function validateConfig(config: PassengerRailConfig): void {
  if (![config.id, config.lineId, config.trainId].every(validId) || config.stations.length !== 2 || config.stations[0].id === config.stations[1].id || config.stations[0].cell === config.stations[1].cell
    || ![config.seats, config.minimumDwellMinutes, config.minimumDepartureIntervalMinutes, config.maxBatches].every(positive)) throw Error('Invalid two-terminal rail config');
  if(config.seats>256||config.maxBatches>1024||config.minimumDwellMinutes>1440||config.minimumDepartureIntervalMinutes>1440)throw Error('Rail service exceeds supported bounds');
  for (const s of config.stations) if (!validId(s.id) || !safeCount(s.cell) || s.cell >= 576 || ![s.queueCapacity, s.boardingPerMinute, s.alightingPerMinute].every(positive)) throw Error('Invalid passenger station');
  for(const s of config.stations)if(s.queueCapacity>1024||s.boardingPerMinute>256||s.alightingPerMinute>256)throw Error('Rail station exceeds supported bounds');
}
function sameOffer(a: PassengerOffer, b: PassengerOffer): boolean {
  return (['id', 'requestId', 'leaseId', 'from', 'to', 'fromStation', 'toStation', 'persons', 'readyAtMinute', 'egressMinutes'] as const).every(k => a[k] === b[k]);
}

export class PassengerRail {
  private readonly config: PassengerRailConfig;
  private graph: RailGraph;
  private paths = new Map<string, RailPath | null>();
  private state: PassengerRailSnapshot;
  constructor(config: PassengerRailConfig, graph: RailGraph, absoluteMinute: number, restored?: PassengerRailSnapshot) {
    validateConfig(config);
    if (!safeCount(absoluteMinute) || !safeCount(absoluteMinute + config.minimumDwellMinutes)) throw Error('Invalid rail start minute');
    this.config = structuredClone(config); this.graph = createRailGraph(graph.revision, graph.links);
    if(restored!==undefined){
      validateRailSnapshot(this.config,this.graph,restored);
      if(restored.minute!==absoluteMinute)throw Error('Rail restore clock mismatch');
      this.state=structuredClone(restored);return;
    }
    const [a, b] = config.stations;
    if (!this.path(a.id, b.id) || !this.path(b.id, a.id)) throw Error('Initial rail line needs a legal round trip');
    this.state = { version: 1, minute: absoluteMinute, enabled: true, graphRevision: graph.revision,
      openStations: Object.fromEntries(config.stations.map(s => [s.id, true])), batches: [],
      train: { station: a.id, destination: null, path: [], remainingMinutes: 0, dwellUntil: absoluteMinute + config.minimumDwellMinutes, lastDepartureMinute: null, blockOwner: null } };
  }
  get snapshot(): PassengerRailSnapshot { return structuredClone(this.state); }
  static restore(config:PassengerRailConfig,graph:RailGraph,snapshot:PassengerRailSnapshot):PassengerRail {
    return new PassengerRail(config,graph,snapshot?.minute,snapshot);
  }
  private station(id: string): PassengerStation {
    const s = this.config.stations.find(s => s.id === id); if (!s) throw Error('Station does not belong to line'); return s;
  }
  private other(id: string): PassengerStation { return this.config.stations.find(s => s.id !== id)!; }
  private path(from: string, to: string): RailPath | null {
    const key = JSON.stringify([from, to]);
    if (!this.paths.has(key)) this.paths.set(key, railPath(this.graph, this.station(from).cell, this.station(to).cell));
    return this.paths.get(key)!;
  }
  /** Caller atomically commits a matching modal lease AND this offer. This module cannot prove
   * ownership of external demand; no production integration is installed. Identical retries are no-ops. */
  offer(offer: PassengerOffer): { accepted: boolean; reason: 'accepted' | 'retry' | 'batch-limit' } {
    if (![offer.id, offer.requestId, offer.leaseId].every(validId) || ![offer.from, offer.to, offer.readyAtMinute, offer.egressMinutes].every(safeCount) || !positive(offer.persons)
      || offer.fromStation === offer.toStation) throw Error('Invalid passenger offer');
    this.station(offer.fromStation); this.station(offer.toStation);
    const existing = this.state.batches.find(b => b.id === offer.id || b.leaseId === offer.leaseId);
    if (existing) { if (!sameOffer(existing, offer)) throw Error('Conflicting passenger retry'); return { accepted: true, reason: 'retry' }; }
    if (this.state.batches.length >= this.config.maxBatches) return { accepted: false, reason: 'batch-limit' };
    if (!safeCount(this.diagnostics().offered + offer.persons)) throw Error('Passenger total overflow');
    this.state.batches.push({ ...structuredClone(offer), outside: offer.persons, waiting: 0, onboard: 0, completed: 0, egress: [] });
    this.state.batches.sort((a, b) => a.readyAtMinute - b.readyAtMinute || a.id.localeCompare(b.id));
    return { accepted: true, reason: 'accepted' };
  }
  /** Graceful stop: no new boarding/empty dispatch; riders already boarded drain to destination. */
  setServiceEnabled(enabled: boolean): void { this.state.enabled = enabled; }
  setStationOpen(id: string, open: boolean): void { this.station(id); this.state.openStations[id] = open; }
  /** Edits while a train is moving or carries riders are rejected atomically. Disconnected docked
   * edits are allowed; waiting demand stays in this rail pool until an explicit future fallback. */
  replaceGraph(graph: RailGraph): void {
    const next = createRailGraph(graph.revision, graph.links);
    if (next.revision <= this.graph.revision) throw Error('Rail edit needs a newer revision');
    if (this.state.train.destination || sum(this.state.batches, 'onboard')) throw Error('Rail corridor is occupied');
    this.graph = next; this.paths.clear(); this.state.graphRevision = next.revision;
  }
  /** External game-clock adapter. Budget limits CPU work, never skips minutes or resets at midnight.
   * The host may call again with the same target to drain remainingMinutes. Pause advances nothing.
   * A different city/backward clock requires a new runtime, not implicit demand erasure. */
  advanceTo(absoluteMinute: number, budgetMinutes: number, paused = false): { processedMinutes: number; remainingMinutes: number } {
    if (!safeCount(absoluteMinute) || absoluteMinute < this.state.minute || !safeCount(budgetMinutes)) throw Error('Invalid external rail clock');
    const count = paused ? 0 : Math.min(absoluteMinute - this.state.minute, budgetMinutes);
    // Validate time headroom before any state mutation, including future travel/egress timestamps.
    const longest = this.graph.links.reduce((n, l) => n + l.minutes, 0);
    const padding = this.state.batches.reduce((n, b) => Math.max(n, b.egressMinutes), Math.max(longest, this.config.minimumDwellMinutes));
    if (!safeCount(absoluteMinute + padding)) throw Error('Rail clock overflow');
    for (let i = 0; i < count; i++) this.minute();
    return { processedMinutes: count, remainingMinutes: absoluteMinute - this.state.minute };
  }
  private minute(): void {
    const s = this.state, t = s.train; s.minute++;
    this.finishEgress();
    if (s.enabled) this.fillPlatforms();
    if (t.destination) {
      t.remainingMinutes--;
      if (t.remainingMinutes > 0) return;
      t.station = t.destination; t.destination = null; t.path = []; t.blockOwner = null;
      t.dwellUntil = s.minute + this.config.minimumDwellMinutes;
    }
    const station = this.station(t.station), next = this.other(t.station);
    if (!s.openStations[station.id]) return;
    let unload = station.alightingPerMinute;
    for (const b of s.batches) if (b.toStation === station.id && b.onboard && unload) {
      const n = Math.min(b.onboard, unload); b.onboard -= n; unload -= n;
      b.egress.push({ persons: n, readyAtMinute: s.minute + b.egressMinutes });
    }
    this.finishEgress();
    // Never depart with people who still need to alight at this terminal.
    if (s.batches.some(b => b.toStation === station.id && b.onboard)) return;
    if (!s.openStations[next.id]) return;
    const outward = this.path(station.id, next.id), backward = this.path(next.id, station.id);
    if (!outward || !backward) return; // No boarding onto a disconnected service.
    let board = s.enabled ? Math.min(station.boardingPerMinute, this.config.seats - sum(s.batches, 'onboard')) : 0;
    for (const b of s.batches) if (b.fromStation === station.id && b.waiting && board) {
      const n = Math.min(board, b.waiting); b.waiting -= n; b.onboard += n; board -= n;
    }
    const needed = sum(s.batches, 'onboard') > 0 || s.enabled && s.batches.some(b => b.fromStation === next.id && b.outside + b.waiting > 0);
    if (!needed || s.minute < t.dwellUntil || t.lastDepartureMinute !== null && s.minute - t.lastDepartureMinute < this.config.minimumDepartureIntervalMinutes) return;
    t.destination = next.id; t.path = [...outward.cells]; t.remainingMinutes = outward.minutes;
    t.lastDepartureMinute = s.minute; t.blockOwner = this.config.trainId; // Entire corridor exclusive; ONLY one train is supported.
  }
  private fillPlatforms(): void {
    const s = this.state;
    for (const station of this.config.stations) if (s.openStations[station.id]) {
      let room = station.queueCapacity - s.batches.filter(b => b.fromStation === station.id).reduce((n, b) => n + b.waiting, 0);
      for (const b of s.batches) if (b.fromStation === station.id && b.readyAtMinute <= s.minute && room) {
        const n = Math.min(room, b.outside); b.outside -= n; b.waiting += n; room -= n;
      }
    }
  }
  private finishEgress(): void {
    for (const b of this.state.batches) {
      const arrived = b.egress.filter(e => e.readyAtMinute <= this.state.minute);
      b.completed += arrived.reduce((n, e) => n + e.persons, 0);
      b.egress = b.egress.filter(e => e.readyAtMinute > this.state.minute);
    }
  }
  /** Cumulative, replay-safe service proofs. Boarding/alighting alone earns NO completion credit. */
  serviceReceipts(): RailServiceReceipt[] {
    return this.state.batches.filter(b => b.completed > 0).map(b => ({ requestId: b.requestId, leaseId: b.leaseId, from: b.from, to: b.to, completedPersons: b.completed }));
  }
  diagnostics() {
    const s = this.state, offered = s.batches.reduce((n, b) => n + b.persons, 0), outside = sum(s.batches, 'outside'), waiting = sum(s.batches, 'waiting'), onboard = sum(s.batches, 'onboard'), completed = sum(s.batches, 'completed');
    const egress = s.batches.reduce((n, b) => n + b.egress.reduce((a, e) => a + e.persons, 0), 0);
    const connected = this.config.stations.every(station => this.path(station.id, this.other(station.id).id) !== null);
    return { offered, outside, waiting, onboard, egress, completed, unresolved: outside + waiting + onboard + egress, connected,
      occupiedSeats: onboard, seatCapacity: this.config.seats, conservationError: offered - outside - waiting - onboard - egress - completed,
      status: !s.enabled ? 'paused-service' : !connected ? 'disconnected' : Object.values(s.openStations).some(open => !open) ? 'station-closed' : s.train.destination ? 'moving' : 'at-station' };
  }
}
