/**
 * Bus depots and stops (PR B2, bus-design.th.md). Pure data, rules and validation; no sim.ts import
 * so sim.ts can depend on it without a cycle. Stored only in the optional `city.bus` save section
 * (City.version stays 9). Round 1 is economy-neutral: nothing here charges money.
 */
import { roadLinked, roadNeighbors, type RoadMap } from '../road-topology.ts';
import { BUS_LIMITS, type BusDepot, type BusLine, type BusState, type BusStop, type BusStopSide } from './types.ts';
export const createBus = (): BusState => ({ version: 1, rules: 'bus-1', depots: [], stops: [], lines: [] });
type Host = { bus?: BusState };
export const busDepotAt = (c: Host, i: number): BusDepot | undefined => c.bus?.depots.find(d => d.cell === i);
export const busStopAt = (c: Host, i: number): BusStop | undefined => c.bus?.stops.find(s => s.cell === i);
/** Minimum Manhattan distance between two stops (no adjacent or shared cells). */
export const BUS_STOP_SPACING = 2;
const SIDES: readonly BusStopSide[] = ['n', 'e', 's', 'w'];

/**
 * Kerb sides a stop may use on road cell `i`, or a reason it cannot hold a stop. A stop needs a
 * straight road piece (1–2 linked neighbours, collinear) — never a junction or a corner. Horizontal
 * roads serve n/s, vertical e/w. On a one-way cell only the kerb on the left of travel is allowed
 * (Thai left-hand traffic): east→n, west→s, south→e, north→w.
 */
export function busStopSides(c: RoadMap, i: number, width: number): { sides: BusStopSide[] } | { reason: string } {
  if (!c.cells[i]?.road) return { reason: 'ป้ายรถเมล์ต้องอยู่บนถนน' };
  const linked = roadNeighbors(i).filter(n => roadLinked(c, i, n));
  if (linked.length === 0) return { reason: 'ถนนช่วงนี้ไม่เชื่อมกับถนนอื่น' };
  if (linked.length > 2) return { reason: 'ห้ามวางป้ายรถเมล์ที่ทางแยก' };
  const horizontal = linked.every(n => Math.abs(n - i) === 1), vertical = linked.every(n => Math.abs(n - i) === width);
  if (!horizontal && !vertical) return { reason: 'ห้ามวางป้ายรถเมล์ที่หัวมุมถนน' };
  const dir = c.roadTopology?.oneWay[i];
  if (dir === 1) return { sides: ['n'] }; if (dir === -1) return { sides: ['s'] };
  if (dir === width) return { sides: ['e'] }; if (dir === -width) return { sides: ['w'] };
  return { sides: horizontal ? ['n', 's'] : ['e', 'w'] };
}
const manhattan = (a: number, b: number, w: number) => Math.abs((a % w) - (b % w)) + Math.abs(Math.floor(a / w) - Math.floor(b / w));
/** Stop placement reason (null = ok) for a specific side, ignoring the stop `except` (for re-checks). */
export function busStopReason(c: RoadMap & Host, i: number, side: BusStopSide, width: number, except?: number): string | null {
  const s = busStopSides(c, i, width);
  if ('reason' in s) return s.reason;
  if (!s.sides.includes(side)) return 'ด้านของป้ายต้องตรงกับทิศทางการขับ (ชิดซ้าย)';
  if ((c.bus?.stops ?? []).some(o => o.id !== except && manhattan(o.cell, i, width) < BUS_STOP_SPACING)) return `ป้ายรถเมล์ต้องห่างกันอย่างน้อย ${BUS_STOP_SPACING} ช่อง`;
  return null;
}
/**
 * Re-check every stop after a road edit. Stops whose road is gone, turned into a junction/corner, or
 * whose side no longer matches the driving direction are removed, and removed from every line.
 * Returns removed stop ids (ascending). Deterministic; no-op (and no key added) without `bus`.
 */
export function reconcileBusStops(c: RoadMap & Host, width: number): number[] {
  const b = c.bus; if (!b) return [];
  const gone = b.stops.filter(s => { const r = busStopSides(c, s.cell, width); return 'reason' in r || !r.sides.includes(s.side); }).map(s => s.id).sort((x, y) => x - y);
  if (gone.length) removeStopsFromState(b, new Set(gone));
  return gone;
}
export function removeStopsFromState(b: BusState, ids: ReadonlySet<number>): void {
  b.stops = b.stops.filter(s => !ids.has(s.id));
  for (const l of b.lines) l.stopIds = l.stopIds.filter(id => !ids.has(id)).filter((id, k, a) => k === 0 || a[k - 1] !== id);
}

/**
 * Remove depot `id` from bus state. Lines it serves move to the lowest-id remaining depot; with no
 * other depot the removal is refused (lines are never orphaned or silently deleted).
 */
export function removeBusDepotFromState(b: BusState, id: number): { ok: boolean; message: string } {
  const d = b.depots.find(x => x.id === id); if (!d) return { ok: false, message: 'ไม่พบอู่รถเมล์' };
  const served = b.lines.filter(l => l.depotId === id), heir = b.depots.filter(x => x.id !== id).sort((x, y) => x.id - y.id)[0];
  if (served.length && !heir) return { ok: false, message: `อู่รถเมล์ #${id} ยังมีสายรถเมล์ ${served.length} สาย ต้องลบสายหรือสร้างอู่อื่นก่อน` };
  for (const l of served) l.depotId = heir.id;
  b.depots = b.depots.filter(x => x !== d);
  return { ok: true, message: `รื้ออู่รถเมล์ #${id} แล้ว${served.length ? ` · ย้าย ${served.length} สายไปอู่ #${heir.id}` : ''}` };
}

/** Facts the validator needs from the city, supplied by sim.ts (keeps this module City-free). */
export type BusValidationView = RoadMap & {
  cells: readonly { road: boolean; zone: unknown; building: number | null }[];
  width: number; tick: number; nextId: number;
  /** Cells and ids held by parks, plants, campuses and taxi depots. */
  otherCells: ReadonlySet<number>; otherIds: ReadonlySet<number>;
};
/** Throws on malformed or conflicting bus data. Runs only when `bus` is present. */
export function validateBus(value: unknown, view: BusValidationView): asserts value is BusState {
  const fail = (why: string): never => { throw new Error(`Invalid bus save: ${why}`); };
  const b = value as BusState;
  if (!b || typeof b !== 'object' || Array.isArray(b) || Object.keys(b).sort().join(',') !== 'depots,lines,rules,stops,version' || b.version !== 1 || b.rules !== 'bus-1'
    || !Array.isArray(b.depots) || !Array.isArray(b.stops) || !Array.isArray(b.lines)) fail('envelope');
  if (b.depots.length > BUS_LIMITS.depots) fail('too many depots');
  if (b.stops.length > BUS_LIMITS.stops) fail('too many stops');
  if (b.lines.length > BUS_LIMITS.lines) fail('too many lines');
  const ids = new Set<number>(), int = (n: unknown): n is number => Number.isSafeInteger(n);
  const id = (x: { id: number }) => { if (!int(x.id) || x.id < 1 || x.id >= view.nextId || ids.has(x.id) || view.otherIds.has(x.id)) fail('id'); ids.add(x.id); };
  const keys = (x: object, k: string) => { if (!x || typeof x !== 'object' || Array.isArray(x) || Object.keys(x).sort().join(',') !== k) fail('fields'); };
  const depotCells = new Set<number>(), stopCells = new Set<number>(), cellOk = (i: unknown): i is number => int(i) && i >= 0 && i < view.cells.length;
  for (const d of b.depots) {
    keys(d, 'cell,id,level,open,tick'); id(d);
    if (!cellOk(d.cell) || depotCells.has(d.cell) || view.otherCells.has(d.cell)) fail('depot cell');
    const cell = view.cells[d.cell]; if (cell.road || cell.zone !== null || cell.building !== null) fail('depot overlaps road, zone or building');
    if (![1, 2, 3].includes(d.level) || typeof d.open !== 'boolean' || !int(d.tick) || d.tick < 0 || d.tick > view.tick) fail('depot state');
    depotCells.add(d.cell);
  }
  for (const s of b.stops) {
    keys(s, 'cell,id,level,side'); id(s);
    if (!cellOk(s.cell) || stopCells.has(s.cell) || !view.cells[s.cell].road) fail('stop must sit on a road cell');
    if (!SIDES.includes(s.side) || (s.level !== 1 && s.level !== 2)) fail('stop state');
    stopCells.add(s.cell);
  }
  const stopIds = new Set(b.stops.map(s => s.id)), depotIds = new Set(b.depots.map(d => d.id));
  for (const l of b.lines) {
    keys(l, 'busCount,busLevel,depotId,id,stopIds'); id(l);
    if (!depotIds.has(l.depotId)) fail('line depot');
    if (!Array.isArray(l.stopIds) || l.stopIds.some((s, k) => !stopIds.has(s) || (k > 0 && l.stopIds[k - 1] === s))) fail('line stops');
    if (!int(l.busCount) || l.busCount < 0 || ![1, 2, 3].includes(l.busLevel)) fail('line buses');
  }
}
export type { BusDepot, BusLine, BusState, BusStop };
