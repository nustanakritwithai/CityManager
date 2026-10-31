/**
 * Bus lines and road routes (PR B3, bus-design.th.md). Logic only (no UI). Pure: works on any
 * host with road cells + optional `bus` section; ids come from the host's `nextId` like other sites.
 *
 * Service shape: stops [s0..sn] run outbound s0→…→sn then return sn→…→s0 (each leg routed on its
 * own, so one-way streets give different return paths). If the first stop id equals the last, the
 * line is a loop and runs only forward. Routes use the existing traffic network (legal, one-way and
 * junction aware) and deterministic Dijkstra (`shortestPath`). Round 1 is economy-neutral.
 */
import { buildNetwork, linkKey, type LinkNetwork } from '../traffic/network.ts';
import { linkTimes, shortestPath } from '../traffic/routing.ts';
import { roadNeighbors, type RoadMap } from '../road-topology.ts';
import { createBus } from './buildings.ts';
import { BUS_DEPOT_BUSES, BUS_DWELL_MIN, BUS_LIMITS, type BusLevel, type BusLine, type BusState } from './types.ts';

export type BusHost = RoadMap & { bus?: BusState; nextId: number; lastEvent?: string };
export type BusResult = { ok: boolean; message: string; id?: number };
export type BusLineSpec = { depotId: number; stopIds: readonly number[]; busCount: number; busLevel: BusLevel };

const distinctStops = (ids: readonly number[]) => new Set(ids).size;
const isLoop = (ids: readonly number[]) => ids.length > 2 && ids[0] === ids[ids.length - 1];
/** Buses assigned to each depot (sum of its lines' busCount) vs. capacity. */
export function busDepotLoad(c: BusHost) {
  return (c.bus?.depots ?? []).map(d => {
    const lines = (c.bus?.lines ?? []).filter(l => l.depotId === d.id), assigned = lines.reduce((n, l) => n + l.busCount, 0), capacity = BUS_DEPOT_BUSES[d.level];
    return { depotId: d.id, level: d.level, open: d.open, capacity, assigned, free: Math.max(0, capacity - assigned), over: Math.max(0, assigned - capacity) };
  });
}
function specReason(c: BusHost, spec: BusLineSpec, except?: number): string | null {
  const b = c.bus;
  if (!b) return 'ยังไม่มีอู่รถเมล์';
  const depot = b.depots.find(d => d.id === spec.depotId); if (!depot) return 'ไม่พบอู่รถเมล์ของสาย';
  if (!Array.isArray(spec.stopIds) || spec.stopIds.some(id => !b.stops.some(s => s.id === id))) return 'มีป้ายที่ไม่มีอยู่จริง';
  if (spec.stopIds.some((id, k) => k > 0 && spec.stopIds[k - 1] === id)) return 'ห้ามใส่ป้ายเดียวกันติดกัน';
  if (distinctStops(spec.stopIds) < 2) return 'สายรถเมล์ต้องมีอย่างน้อย 2 ป้าย';
  if (!Number.isSafeInteger(spec.busCount) || spec.busCount < 0) return 'จำนวนรถไม่ถูกต้อง';
  if (![1, 2, 3].includes(spec.busLevel)) return 'ระดับรถไม่ถูกต้อง';
  const used = b.lines.filter(l => l.depotId === depot.id && l.id !== except).reduce((n, l) => n + l.busCount, 0), cap = BUS_DEPOT_BUSES[depot.level];
  if (used + spec.busCount > cap) return `อู่รถเมล์ #${depot.id} จุได้ ${cap} คัน (ใช้แล้ว ${used}) — ลดจำนวนรถหรือขยายอู่`;
  return null;
}
export function createBusLine(c: BusHost, spec: BusLineSpec): BusResult {
  if ((c.bus?.lines.length ?? 0) >= BUS_LIMITS.lines) return { ok: false, message: `สร้างสายรถเมล์ได้สูงสุด ${BUS_LIMITS.lines} สาย` };
  if (!Number.isSafeInteger(c.nextId) || c.nextId < 1 || c.nextId > Number.MAX_SAFE_INTEGER - 3) return { ok: false, message: 'ไม่สามารถสร้างรหัสใหม่ได้' };
  const reason = specReason(c, spec); if (reason) return { ok: false, message: reason };
  const b = c.bus ?? createBus(), id = c.nextId++;
  b.lines.push({ id, depotId: spec.depotId, stopIds: [...spec.stopIds], busCount: spec.busCount, busLevel: spec.busLevel }); c.bus = b;
  c.lastEvent = `สร้างสายรถเมล์ #${id} แล้ว · ${distinctStops(spec.stopIds)} ป้าย · ${spec.busCount} คัน`;
  return { ok: true, message: c.lastEvent, id };
}
/** Patch a line (any subset of fields). Same rules as create; capacity excludes the line itself. */
export function editBusLine(c: BusHost, id: number, patch: Partial<BusLineSpec>): BusResult {
  const l = c.bus?.lines.find(x => x.id === id); if (!l) return { ok: false, message: 'ไม่พบสายรถเมล์' };
  const spec: BusLineSpec = { depotId: patch.depotId ?? l.depotId, stopIds: patch.stopIds ?? l.stopIds, busCount: patch.busCount ?? l.busCount, busLevel: patch.busLevel ?? l.busLevel };
  const reason = specReason(c, spec, id); if (reason) return { ok: false, message: reason };
  Object.assign(l, { depotId: spec.depotId, stopIds: [...spec.stopIds], busCount: spec.busCount, busLevel: spec.busLevel });
  c.lastEvent = `แก้สายรถเมล์ #${id} แล้ว`; return { ok: true, message: c.lastEvent, id };
}
export function deleteBusLine(c: BusHost, id: number): BusResult {
  const b = c.bus; if (!b || !b.lines.some(l => l.id === id)) return { ok: false, message: 'ไม่พบสายรถเมล์' };
  b.lines = b.lines.filter(l => l.id !== id); c.lastEvent = `ลบสายรถเมล์ #${id} แล้ว`; return { ok: true, message: c.lastEvent, id };
}

export type BusLeg = Readonly<{ fromStopId: number; toStopId: number; path: readonly number[]; seconds: number }>;
export type BusSuspendReason = 'tooFewStops' | 'noDepot' | 'depotClosed' | 'noBuses' | 'unreachable' | 'depotFull';
export type BusLineRoute = Readonly<{
  lineId: number; depotId: number; loop: boolean;
  /** 'running' lines can be served by BusEngine (B4); 'suspended' carry the first reason. */
  status: 'running' | 'suspended'; reason?: BusSuspendReason;
  /** Outbound legs then return legs (loops: forward legs only). Empty when unroutable. */
  legs: readonly BusLeg[];
  /** Depot exit → first stop (road path). Null if the depot has no road frontage reaching it. */
  fromDepot: readonly number[] | null;
  /** Stop calls per cycle, drive + dwell minutes for one full cycle. */
  stopCalls: number; cycleMinutes: number;
  /** Buses actually runnable (capacity granted in line-id order) and resulting headway (minutes). */
  buses: number; headwayMinutes: number | null;
  stops: readonly Readonly<{ stopId: number; cell: number; side: string }>[];
  /** Full cell polyline for overlays (legs concatenated, shared joints not repeated). */
  polyline: readonly number[];
}>;
export type BusRouteOptions = { net?: LinkNetwork; times?: ReadonlyMap<string, number> };

/** Stop call sequence for one cycle. */
export function busServiceOrder(stopIds: readonly number[]): number[] {
  if (isLoop(stopIds)) return [...stopIds];
  return stopIds.length < 2 ? [...stopIds] : [...stopIds, ...[...stopIds].reverse().slice(1)];
}
/**
 * Routes for every line (line-id order), recomputed from the current roads. Deterministic. Depot
 * capacity is granted to lines in id order; lines that get zero buses are suspended as 'depotFull'.
 */
export function busLineRoutes(c: BusHost, o: BusRouteOptions = {}): readonly BusLineRoute[] {
  const b = c.bus; if (!b) return Object.freeze([]);
  const net = o.net ?? buildNetwork(c), times = o.times ?? linkTimes(net, new Map());
  const stopById = new Map(b.stops.map(s => [s.id, s])), left = new Map(b.depots.map(d => [d.id, BUS_DEPOT_BUSES[d.level]]));
  const legSeconds = (p: number[]) => p.slice(1).reduce((s, x, i) => s + (times.get(linkKey(p[i], x)) ?? Infinity), 0);
  const cache = new Map<string, number[] | null>(), route = (a: number, z: number) => { const k = `${a}>${z}`; if (!cache.has(k)) cache.set(k, a === z ? [a] : shortestPath(net, times, a, z)); return cache.get(k)!; };
  const out: BusLineRoute[] = [];
  for (const l of [...b.lines].sort((x, y) => x.id - y.id)) {
    const depot = b.depots.find(d => d.id === l.depotId), ids = l.stopIds.filter(id => stopById.has(id)), loop = isLoop(ids);
    const order = busServiceOrder(ids), stops = ids.map(id => { const s = stopById.get(id)!; return Object.freeze({ stopId: id, cell: s.cell, side: s.side }); });
    const legs: BusLeg[] = []; let reason: BusSuspendReason | undefined;
    if (distinctStops(ids) < 2) reason = 'tooFewStops';
    else if (!depot) reason = 'noDepot';
    else {
      for (let k = 0; k + 1 < order.length; k++) {
        const a = stopById.get(order[k])!, z = stopById.get(order[k + 1])!, p = route(a.cell, z.cell);
        if (!p) { reason = 'unreachable'; legs.length = 0; break; }
        legs.push(Object.freeze({ fromStopId: a.id, toStopId: z.id, path: Object.freeze(p), seconds: legSeconds(p) }));
      }
      if (!reason && !depot.open) reason = 'depotClosed';
    }
    let fromDepot: number[] | null = null;
    if (depot && ids.length) {
      const first = stopById.get(order[0])!.cell;
      for (const n of roadNeighbors(depot.cell).filter(n => c.cells[n]?.road).sort((x, y) => x - y)) { const p = route(n, first); if (p && (!fromDepot || legSeconds(p) < legSeconds(fromDepot))) fromDepot = p; }
    }
    if (!reason && !fromDepot) reason = 'unreachable';
    let buses = 0;
    if (!reason) { const free = left.get(depot!.id) ?? 0; buses = Math.min(l.busCount, free); left.set(depot!.id, free - buses); if (l.busCount === 0) reason = 'noBuses'; else if (buses === 0) reason = 'depotFull'; }
    const stopCalls = Math.max(0, order.length - 1), drive = legs.reduce((s, g) => s + g.seconds, 0) / 60, cycleMinutes = legs.length ? drive + stopCalls * BUS_DWELL_MIN : 0;
    const polyline: number[] = []; for (const g of legs) for (const x of g.path) if (polyline.at(-1) !== x) polyline.push(x);
    out.push(Object.freeze({ lineId: l.id, depotId: l.depotId, loop, status: reason ? 'suspended' : 'running', ...(reason ? { reason } : {}), legs: Object.freeze(legs), fromDepot: fromDepot && Object.freeze(fromDepot),
      stopCalls, cycleMinutes, buses: reason ? 0 : buses, headwayMinutes: reason || !buses ? null : cycleMinutes / buses, stops: Object.freeze(stops), polyline: Object.freeze(polyline) }));
  }
  return Object.freeze(out);
}
/** Headway (minutes) for a cycle time and fleet: cycle / buses; null without buses. */
export const busHeadway = (cycleMinutes: number, buses: number): number | null => (buses > 0 && Number.isFinite(cycleMinutes) ? cycleMinutes / buses : null);

/**
 * Memoised routes: recomputed only when roads/topology or the bus section change (call freely each
 * frame/tick; road edits and stop removal are picked up automatically on the next call).
 */
export class BusRouteCache {
  private key = ''; private value: readonly BusLineRoute[] = Object.freeze([]);
  get(c: BusHost, o: BusRouteOptions = {}): readonly BusLineRoute[] {
    const roads = c.cells.reduce((s, x, i) => (x.road ? s + i + ',' : s), '');
    const key = `${roads}|${JSON.stringify(c.roadTopology ?? null)}|${JSON.stringify(c.bus ?? null)}|${o.times ? 'T' : ''}`;
    if (o.times || key !== this.key) { this.value = busLineRoutes(c, o); this.key = o.times ? '' : key; }
    return this.value;
  }
}
export type { BusLine };
