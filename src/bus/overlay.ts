/**
 * Map overlay for bus lines, stops and depots. Reads `busLineRoutes` (polyline, legs, stops,
 * running/suspended, reason, headway). Suspended lines are dashed and captioned with the reason.
 * Does not move buses or touch the engine.
 */
import { BusRouteCache, type BusHost, type BusLineRoute, type BusSuspendReason } from './lines.ts';
import type { BusStopSide } from './types.ts';
import { BUS_KERB, BUS_SIDE, busLineColor, cellCenter } from './geometry.ts';

const cache = new BusRouteCache();
const SUSPEND_LABEL: Record<BusSuspendReason, string> = {
  tooFewStops: 'ป้ายไม่พอ', noDepot: 'ไม่มีอู่', depotClosed: 'อู่ปิด', noBuses: 'ไม่มีรถ', unreachable: 'เส้นทางขาด', depotFull: 'อู่เต็ม',
};

export type BusRibbon = {
  lineId: number; from: number; to: number; spur: boolean; paused: boolean; color: string;
  x: number; z: number; y: number; headingX: number; headingZ: number; length: number; width: number;
};
export type BusLineVisual = {
  lineId: number; status: 'running' | 'suspended'; paused: boolean; reason?: BusSuspendReason;
  headwayMinutes: number | null; buses: number; color: string; caption: string;
  polyline: readonly number[]; labelCell: number | null; segments: BusRibbon[];
};
export type BusStopVisual = {
  id: number; cell: number; side: BusStopSide; level: 1 | 2; kind: 'pole' | 'shelter';
  x: number; z: number; y: number; headingX: number; headingZ: number; sx: number; sy: number; sz: number;
};
export type BusDepotVisual = {
  id: number; cell: number; level: 1 | 2 | 3; open: boolean;
  x: number; z: number; y: number; headingX: number; headingZ: number; sx: number; sy: number; sz: number;
};
export type BusOverlay = { lines: BusLineVisual[]; stops: BusStopVisual[]; depots: BusDepotVisual[] };

export function busLineCaption(route: Pick<BusLineRoute, 'status' | 'reason' | 'headwayMinutes' | 'buses'>): string {
  if (route.status !== 'running') {
    const why = route.reason ? SUSPEND_LABEL[route.reason] : '';
    return why ? `หยุดวิ่ง · ${why}` : 'หยุดวิ่ง';
  }
  if (route.headwayMinutes == null) return 'วิ่ง';
  const rounded = Math.round(route.headwayMinutes * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `ทุก ${text} นาที · ${route.buses} คัน`;
}

const EMPTY: BusOverlay = { lines: [], stops: [], depots: [] };
export function busOverlay(city: BusHost): BusOverlay {
  const bus = city.bus; if (!bus) return EMPTY;
  const routes = cache.get(city);
  return {
    lines: routes.map((route, index) => lineVisual(route, index, routes.length)),
    stops: [...bus.stops].sort((a, b) => a.id - b.id).flatMap(stop => stopVisual(stop)),
    depots: [...bus.depots].sort((a, b) => a.id - b.id).map(depot => depotVisual(depot)),
  };
}

function lineVisual(route: BusLineRoute, index: number, count: number): BusLineVisual {
  const paused = route.status !== 'running';
  return {
    lineId: route.lineId, status: route.status, paused, ...(route.reason ? { reason: route.reason } : {}),
    headwayMinutes: route.headwayMinutes, buses: route.buses, color: busLineColor(route.lineId), caption: busLineCaption(route),
    polyline: route.polyline, labelCell: route.polyline[0] ?? route.stops[0]?.cell ?? null, segments: ribbons(route, index, count, paused),
  };
}
function ribbons(route: BusLineRoute, index: number, count: number, paused: boolean): BusRibbon[] {
  const hops: { from: number; to: number; spur: boolean }[] = [];
  for (const leg of route.legs) pushHops(hops, leg.path, false);
  pushHops(hops, route.fromDepot, true);
  const offset = (index - (count - 1) / 2) * 0.18, y = 0.22 + index * 0.012, width = paused ? 0.12 : 0.16, color = busLineColor(route.lineId);
  const out: BusRibbon[] = [];
  for (const hop of hops) {
    const a = cellCenter(hop.from), b = cellCenter(hop.to), dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
    if (!(len > 0)) continue;
    const hx = dx / len, hz = dz / len, ox = hz * offset, oz = -hx * offset;
    for (const span of spans(len, paused)) {
      const mid = (span.t0 + span.t1) / 2;
      out.push({ lineId: route.lineId, from: hop.from, to: hop.to, spur: hop.spur, paused, color, x: a.x + hx * mid + ox, z: a.z + hz * mid + oz, y, headingX: hx, headingZ: hz, length: span.t1 - span.t0, width });
    }
  }
  return out;
}
function pushHops(out: { from: number; to: number; spur: boolean }[], cells: readonly number[] | null, spur: boolean) {
  if (!cells) return;
  for (let i = 1; i < cells.length; i++) if (cells[i] !== cells[i - 1]) out.push({ from: cells[i - 1]!, to: cells[i]!, spur });
}
function spans(length: number, dashed: boolean): { t0: number; t1: number }[] {
  if (!dashed) return [{ t0: 0, t1: length }];
  const dash = 0.62, gap = 0.38, out: { t0: number; t1: number }[] = [];
  for (let t = 0; t < length - 1e-4; t += dash + gap) out.push({ t0: t, t1: Math.min(length, t + dash) });
  return out.length ? out : [{ t0: 0, t1: length }];
}
function stopVisual(stop: { id: number; cell: number; side: BusStopSide; level: 1 | 2 }): BusStopVisual[] {
  const kerb = BUS_SIDE[stop.side]; if (!kerb || !Number.isInteger(stop.cell)) return [];
  const centre = cellCenter(stop.cell), shelter = stop.level !== 1;
  const sx = shelter ? 0.9 : 0.34, sy = shelter ? 0.64 : 0.78, sz = shelter ? 0.5 : 0.22;
  return [{
    id: stop.id, cell: stop.cell, side: stop.side, level: stop.level, kind: shelter ? 'shelter' : 'pole',
    x: centre.x + kerb.x * BUS_KERB, z: centre.z + kerb.z * BUS_KERB, y: 0.16 + sy / 2,
    headingX: kerb.facingX, headingZ: kerb.facingZ, sx, sy, sz,
  }];
}
function depotVisual(depot: { id: number; cell: number; level: 1 | 2 | 3; open: boolean }): BusDepotVisual {
  const centre = cellCenter(depot.cell), sy = (0.42 + (depot.level - 1) * 0.28) * (depot.open ? 1 : 0.72);
  return { id: depot.id, cell: depot.cell, level: depot.level, open: depot.open, x: centre.x, z: centre.z, y: 0.12 + sy / 2, headingX: 1, headingZ: 0, sx: 1.45, sy, sz: 1.2 };
}
