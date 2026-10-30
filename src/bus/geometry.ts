/**
 * Grid geometry for bus drawing. World axes match `renderer.position`: +x east, +z south,
 * 2 world units per cell, origin at the map centre. Pure: no scene graph.
 */
import { BUS_CAPACITY, type BusLevel, type BusStopSide } from './types.ts';

export const BUS_MAP_SIZE = 24, BUS_MAP_UNIT = 2;
/** Left-hand lane nudge (world units). Eastbound traffic sits north (−z), matching kerb side `n`. */
export const BUS_LANE_OFFSET = 0.28;
/** How far a stop (and a dwelling bus) sits from the cell centre toward its kerb. */
export const BUS_KERB = 0.62;
export const BUS_HOME_PITCH = 0.48;
/** Waiting figures drawn per stop. The real queue count stays on the stop mark. */
export const BUS_CROWD_CAP = 8;

export function cellCenter(cell: number, size = BUS_MAP_SIZE, unit = BUS_MAP_UNIT) {
  return { x: ((cell % size) - (size - 1) / 2) * unit, z: (Math.floor(cell / size) - (size - 1) / 2) * unit };
}
/** Canvas pixel for a world point. Cell centres land in the middle of the minimap square. */
export function worldToCanvas(x: number, z: number, cellPx: number, size = BUS_MAP_SIZE, unit = BUS_MAP_UNIT) {
  return { x: (x / unit + (size - 1) / 2 + 0.5) * cellPx, y: (z / unit + (size - 1) / 2 + 0.5) * cellPx };
}

/** Kerb offset from the cell centre, and the direction a shelter faces back toward the road. */
export const BUS_SIDE: Record<BusStopSide, { x: number; z: number; facingX: number; facingZ: number }> = {
  n: { x: 0, z: -1, facingX: 0, facingZ: 1 },
  e: { x: 1, z: 0, facingX: -1, facingZ: 0 },
  s: { x: 0, z: 1, facingX: 0, facingZ: -1 },
  w: { x: -1, z: 0, facingX: 1, facingZ: 0 },
};

/** Body size by upgrade. Capacity 40 / 60 / 80 is level 1 / 2 / 3 (longer and taller). */
export const BUS_BODY: Record<BusLevel, { length: number; width: number; height: number; paint: number; color: string }> = {
  1: { length: 0.78, width: 0.32, height: 0.30, paint: 0, color: '#1f6feb' },
  2: { length: 1.02, width: 0.36, height: 0.34, paint: 1, color: '#148f62' },
  3: { length: 1.32, width: 0.38, height: 0.36, paint: 2, color: '#e3941a' },
};

export const BUS_LINE_COLORS = ['#e23d4a', '#2f6feb', '#1aa36a', '#e3941a', '#8e5ea2', '#13a3b5', '#d96b2b', '#5c6b7a'] as const;
export const busLineColor = (lineId: number) => BUS_LINE_COLORS[((lineId % BUS_LINE_COLORS.length) + BUS_LINE_COLORS.length) % BUS_LINE_COLORS.length];

/** Exact 40/60/80 map to levels 1/2/3. Any other capacity picks the nearest band so a bus still draws. */
export function busLevelForCapacity(capacity: number): BusLevel {
  if (capacity === BUS_CAPACITY[3]) return 3;
  if (capacity === BUS_CAPACITY[2]) return 2;
  if (capacity === BUS_CAPACITY[1]) return 1;
  if (capacity >= (BUS_CAPACITY[2] + BUS_CAPACITY[3]) / 2) return 3;
  if (capacity >= (BUS_CAPACITY[1] + BUS_CAPACITY[2]) / 2) return 2;
  return 1;
}

export type Basis = { x: number; y: number; z: number; headingX: number; headingZ: number; sx: number; sy: number; sz: number };
/** Column-major matrix. Local +Z follows the heading (the long axis of a bus or a line ribbon). */
export function writeBasisMatrix(target: Float32Array, offset: number, p: Basis): void {
  const hx = p.headingX, hz = p.headingZ;
  target.set([
    hz * p.sx, 0, -hx * p.sx, 0,
    0, p.sy, 0, 0,
    hx * p.sz, 0, hz * p.sz, 0,
    p.x, p.y, p.z, 1,
  ], offset);
}
