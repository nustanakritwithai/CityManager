/**
 * One frame of bus drawing: poses from snapshots, ribbons/stops/depots from the city, crowd pips
 * from `waitingAt`. Each entry is one GPU instance. An empty list draws nothing.
 */
import type { BusHost } from './lines.ts';
import type { BusSnapshot } from './types.ts';
import { BUS_CROWD_CAP, BUS_SIDE } from './geometry.ts';
import { busOverlay, type BusDepotVisual, type BusRibbon, type BusStopVisual } from './overlay.ts';
import { busPoses, type BusDrawPose } from './poses.ts';

export type BusCrowdMark = { stopId: number; x: number; z: number; y: number };
export type BusCaption = { lineId: number; text: string; cell: number; color: string; paused: boolean };
export type BusStopMark = BusStopVisual & { waiting: number };
export type BusDrawList = {
  buses: BusDrawPose[];
  /** Buses with passengers — one roof-bar instance each. */
  loads: BusDrawPose[];
  /** `phase === 'dwelling'` (stopped at a kerb for the engine's 1-minute dwell). */
  dwelling: BusDrawPose[];
  lines: BusRibbon[];
  stops: BusStopMark[];
  depots: BusDepotVisual[];
  crowds: BusCrowdMark[];
  captions: BusCaption[];
};

export const EMPTY_BUS_DRAW: BusDrawList = {
  buses: [], loads: [], dwelling: [], lines: [], stops: [], depots: [], crowds: [], captions: [],
};

export function busDrawList(
  city: BusHost,
  snapshots: readonly BusSnapshot[],
  detail: readonly { id: string; returning: boolean }[],
  waitingAt: (stopId: number) => number,
): BusDrawList {
  const overlay = busOverlay(city);
  const buses = busPoses(snapshots, { detail, stops: city.bus?.stops ?? [] });
  const stops: BusStopMark[] = overlay.stops.map(stop => ({ ...stop, waiting: Math.max(0, waitingAt(stop.id) || 0) }));
  const captions: BusCaption[] = [];
  for (const line of overlay.lines) if (line.labelCell != null) captions.push({ lineId: line.lineId, text: line.caption, cell: line.labelCell, color: line.color, paused: line.paused });
  return {
    buses, loads: buses.filter(bus => bus.load > 0), dwelling: buses.filter(bus => bus.phase === 'dwelling'),
    lines: overlay.lines.flatMap(line => line.segments), stops, depots: overlay.depots, crowds: busCrowds(stops), captions,
  };
}

export function busCrowds(stops: readonly BusStopMark[]): BusCrowdMark[] {
  const out: BusCrowdMark[] = [];
  for (const stop of stops) {
    const count = Math.min(BUS_CROWD_CAP, Math.floor(stop.waiting));
    if (count <= 0) continue;
    const side = BUS_SIDE[stop.side], tx = side.z !== 0 ? 1 : 0, tz = side.x !== 0 ? 1 : 0;
    for (let i = 0; i < count; i++) {
      const along = (i - (count - 1) / 2) * 0.22;
      out.push({ stopId: stop.id, x: stop.x + side.x * 0.34 + tx * along, z: stop.z + side.z * 0.34 + tz * along, y: 0.36 });
    }
  }
  return out;
}

export type BusInstanceCounts = {
  buses: number; byLevel: { 1: number; 2: number; 3: number };
  loads: number; dwelling: number; lineSegments: number; poles: number; shelters: number;
  depots: number; crowds: number; total: number;
};
/** Instance counts the scene uploads. One entry in each list is one instanced draw. */
export function busInstanceCounts(draw: BusDrawList): BusInstanceCounts {
  const byLevel = { 1: 0, 2: 0, 3: 0 };
  for (const bus of draw.buses) byLevel[bus.level]++;
  const poles = draw.stops.filter(stop => stop.kind === 'pole').length;
  const shelters = draw.stops.length - poles;
  const counts = {
    buses: draw.buses.length, byLevel, loads: draw.loads.length, dwelling: draw.dwelling.length,
    lineSegments: draw.lines.length, poles, shelters, depots: draw.depots.length, crowds: draw.crowds.length, total: 0,
  };
  counts.total = counts.buses + counts.loads + counts.dwelling + counts.lineSegments + counts.poles + counts.shelters + counts.depots + counts.crowds;
  return counts;
}
