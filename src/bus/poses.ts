/**
 * Drawing poses for `BusSnapshot`. Interpolation is `cell → next` by `progress` — the snapshot
 * already carries the position. Nothing here advances time or moves a bus.
 * Level 1/2/3 is capacity 40/60/80. `load` is persons/capacity (clamped) for the roof bar.
 */
import type { BusPhase, BusSnapshot, BusStopSide } from './types.ts';
import { BUS_BODY, BUS_HOME_PITCH, BUS_KERB, BUS_LANE_OFFSET, BUS_MAP_SIZE, BUS_MAP_UNIT, BUS_SIDE, busLevelForCapacity, cellCenter, writeBasisMatrix, type Basis } from './geometry.ts';

const PHASES: readonly BusPhase[] = ['toStart', 'running', 'dwelling', 'home'];

export type BusDrawPose = {
  id: string;
  x: number; y: number; z: number;
  headingX: number; headingZ: number;
  level: 1 | 2 | 3; paint: number;
  length: number; width: number; height: number;
  load: number; persons: number; capacity: number;
  phase: BusPhase; returning: boolean;
  cell: number; next: number; progress: number;
};

export type BusPoseOptions = {
  detail?: readonly { id: string; returning: boolean }[];
  stops?: readonly { cell: number; side: BusStopSide }[];
  size?: number; unit?: number;
};

export function busPoses(snapshots: readonly BusSnapshot[], opts: BusPoseOptions = {}): BusDrawPose[] {
  const size = opts.size ?? BUS_MAP_SIZE, unit = opts.unit ?? BUS_MAP_UNIT, cells = size * size, seen = new Set<string>();
  const returning = new Map((opts.detail ?? []).map(d => [d.id, d.returning]));
  const stopAt = new Map<number, BusStopSide>();
  for (const stop of opts.stops ?? []) if (!stopAt.has(stop.cell)) stopAt.set(stop.cell, stop.side);
  const poses: BusDrawPose[] = [];
  for (const s of snapshots) {
    if (typeof s.id !== 'string' || !s.id || seen.has(s.id)) throw new Error('Invalid or duplicate bus id');
    seen.add(s.id);
    if (!Number.isInteger(s.cell) || !Number.isInteger(s.next) || s.cell < 0 || s.next < 0 || s.cell >= cells || s.next >= cells) throw new Error('Invalid bus cell');
    if (!Number.isFinite(s.progress) || s.progress < -1e-3 || s.progress > 1 + 1e-3) throw new Error('Invalid bus progress');
    if (!Number.isFinite(s.persons) || s.persons < 0 || !Number.isFinite(s.capacity) || s.capacity < 0) throw new Error('Invalid bus load');
    if (!PHASES.includes(s.phase)) throw new Error('Invalid bus phase');
    const progress = Math.min(1, Math.max(0, s.progress));
    const from = cellCenter(s.cell, size, unit), to = cellCenter(s.next, size, unit);
    const dx = to.x - from.x, dz = to.z - from.z, span = Math.hypot(dx, dz);
    let x = from.x, z = from.z, hx = 1, hz = 0;
    if (span > 1e-6) {
      hx = dx / span; hz = dz / span;
      x = from.x + dx * progress; z = from.z + dz * progress;
      // Left of the heading: eastbound (+x) shifts north (−z).
      x += hz * BUS_LANE_OFFSET; z -= hx * BUS_LANE_OFFSET;
    } else if (s.phase === 'dwelling' && stopAt.has(s.cell)) {
      const side = stopAt.get(s.cell)!, kerb = BUS_SIDE[side];
      x = from.x + kerb.x * BUS_KERB; z = from.z + kerb.z * BUS_KERB;
      if (side === 'n' || side === 's') { hx = 1; hz = 0; } else { hx = 0; hz = 1; }
    }
    const level = busLevelForCapacity(s.capacity), body = BUS_BODY[level];
    const load = s.capacity > 0 ? Math.min(1, s.persons / s.capacity) : 0;
    poses.push({
      id: s.id, x, z, y: 0.18 + body.height / 2, headingX: hx, headingZ: hz,
      level, paint: body.paint, length: body.length, width: body.width, height: body.height,
      load, persons: s.persons, capacity: s.capacity, phase: s.phase, returning: returning.get(s.id) === true,
      cell: s.cell, next: s.next, progress,
    });
  }
  const parked = new Map<number, BusDrawPose[]>();
  for (const pose of poses) if (pose.phase === 'home') { const group = parked.get(pose.cell) ?? []; group.push(pose); parked.set(pose.cell, group); }
  for (const group of parked.values()) {
    group.sort((a, b) => (a.id < b.id ? -1 : 1));
    group.forEach((pose, i) => { pose.x += (i - (group.length - 1) / 2) * BUS_HOME_PITCH; });
  }
  return poses;
}

export function writeBusMatrix(target: Float32Array, offset: number, pose: BusDrawPose): void {
  writeBasisMatrix(target, offset, bodyBasis(pose));
}
/** Roof bar. Length along the bus is `load` (empty buses are not instanced). */
export function writeLoadMatrix(target: Float32Array, offset: number, pose: BusDrawPose): void {
  const body = bodyBasis(pose);
  writeBasisMatrix(target, offset, { ...body, y: pose.y + pose.height / 2 + 0.04, sx: pose.width * 0.45, sy: 0.05, sz: Math.max(0.05, pose.length * pose.load) });
}
function bodyBasis(pose: BusDrawPose): Basis {
  return { x: pose.x, y: pose.y, z: pose.z, headingX: pose.headingX, headingZ: pose.headingZ, sx: pose.width, sy: pose.height, sz: pose.length };
}
