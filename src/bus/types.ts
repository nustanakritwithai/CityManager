/**
 * Public bus — shared types and constants (PR B1, design: bus-design.th.md). Other PRs (depots/stops,
 * lines, BusEngine, UI, visuals) build on these shapes. Pure: no City, save, economy or renderer import.
 * All numbers are PLACEHOLDERS pending owner balance. Round 1 is economy-neutral.
 */
import type { TripPurpose } from '../traffic/types.ts';

/** Feature flag — the single source of truth for bus. OFF: no bus demand is split, nothing changes. */
export const BUS_ENABLED = false;
export const BUS_STORAGE_KEY = 'citymanager.bus';
type FlagStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
/** Flag with a dev override: `?bus=1` (remembered) / `?bus=0` (forgotten). Never throws. */
export function busEnabled(search = globalThis.location?.search ?? '', storage?: FlagStorage): boolean {
  let q: string | null = null; try { q = new URLSearchParams(search).get('bus'); } catch { q = null; }
  try { storage ??= globalThis.localStorage; } catch { /* storage getter can be denied */ }
  try { if (q === '1') storage?.setItem(BUS_STORAGE_KEY, '1'); if (q === '0') storage?.removeItem(BUS_STORAGE_KEY); } catch { /* private mode */ }
  if (q === '1') return true; if (q === '0') return false;
  try { if (storage?.getItem(BUS_STORAGE_KEY) === '1') return true; } catch { /* ignore */ }
  return BUS_ENABLED;
}

/** Walk access: stop must be within this many grid cells (Manhattan) of the trip end. */
export const BUS_WALK_RADIUS = 4, BUS_WALK_MIN_PER_CELL = 1.25;
/** Minimum kerb dwell per stop call, game minutes. */
export const BUS_DWELL_MIN = 1;
/** Service window, minute of day [from, to). Outside it buses return to their depot. */
export const BUS_SERVICE = Object.freeze({ from: 5 * 60, to: 23 * 60 });
export type BusLevel = 1 | 2 | 3;
export type BusDepotLevel = 1 | 2 | 3;
export type BusStopLevel = 1 | 2;
/** Seats per bus by level (placeholder). */
export const BUS_CAPACITY: Readonly<Record<BusLevel, number>> = Object.freeze({ 1: 40, 2: 60, 3: 80 });
/** Buses a depot can house by level (placeholder). */
export const BUS_DEPOT_BUSES: Readonly<Record<BusDepotLevel, number>> = Object.freeze({ 1: 6, 2: 12, 3: 20 });
export const BUS_LIMITS = Object.freeze({ depots: 4, stops: 40, lines: 8 });
/** Road load of one bus in passenger-car units (representative road vehicles). */
export const BUS_PCU = 2;
/** Shadow flat fare per person, satang (same economy scale as TAXI_FARE; placeholder). */
export const BUS_FARE_SATANG = 30;
/** Bus never takes more than this share of an OD before the seat cap. */
export const BUS_AVAILABILITY_CAP = .5;
/** Extra perceived minutes for riding a bus (crowding/comfort; upgrades may lower it later). */
export const BUS_RIDE_PENALTY_MIN = 2;
/** Purposes that may use buses. Freight never does. */
export const BUS_PURPOSES: ReadonlySet<TripPurpose> = new Set<TripPurpose>(['commute', 'school', 'park']);

/** Kerb side of a road cell the stop serves. */
export type BusStopSide = 'n' | 'e' | 's' | 'w';
export type BusDepot = { id: number; cell: number; level: BusDepotLevel; open: boolean; tick: number };
export type BusStop = { id: number; cell: number; side: BusStopSide; level: BusStopLevel };
/** Ordered stops; the line runs there and back along legal road links. */
export type BusLine = { id: number; depotId: number; stopIds: number[]; busCount: number; busLevel: BusLevel };
/** Optional `city.bus` save section (schema reserved; validation lands in B2). */
export type BusState = { version: 1; rules: 'bus-1'; depots: BusDepot[]; stops: BusStop[]; lines: BusLine[] };

/** Renderer-facing phase: leaving depot to first stop / between stops / at a kerb / back at depot. */
export type BusPhase = 'toStart' | 'running' | 'dwelling' | 'home';
/** Read-only per-bus view at a game minute: `cell` → `next` with `progress` ∈ [0,1). */
export type BusSnapshot = Readonly<{ id: string; lineId: number; phase: BusPhase; cell: number; next: number; progress: number; persons: number; capacity: number }>;
export type BusEvent = Readonly<{ kind: 'board' | 'alight'; busId: string; lineId: number; stopId: number; cell: number; minute: number; persons: number }>;

/** Bus costs of one OD for the mode choice. Null from the cost callback = no bus offered. */
export type BusOdCost = {
  lineId: number; fromStopId: number; toStopId: number;
  /** Walk to + from the stops, average wait (≈ headway/2) and in-vehicle minutes. */
  walkMinutes: number; waitMinutes: number; rideMinutes: number;
  /** Whole people the line can still seat for this OD this period (seat cap). */
  seats: number; fareSatang?: number;
};
export type BusRequestMass = { purpose: TripPurpose; from: number; to: number; persons: number; lineId: number; fromStopId: number; toStopId: number; fareSatang: number };
