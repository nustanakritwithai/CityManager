/**
 * Lane/queue geometry for representative fleet vehicles (adapted from PR #84's road queue,
 * without per-citizen journeys). All lengths are in tiles along a link from cell centre to
 * cell centre. A square of half-size JUNCTION_HALF around every cell centre is never occupied,
 * so cars cannot overlap across crossing links and never enter a junction.
 */
export type LanePosition = { cell: number; incoming: number; lane: number };
export const CAR_LENGTH = .22, CAR_WIDTH = .15, LANE_OFFSET = .12, JUNCTION_HALF = .25, QUEUE_GAP = .04;
/** Usable span of a lane between the two junction squares, for car centres. */
export const LANE_START = JUNCTION_HALF + CAR_LENGTH / 2, LANE_END = 1 - JUNCTION_HALF - CAR_LENGTH / 2;
export const SLOT_PITCH = CAR_LENGTH + QUEUE_GAP;
export const LANE_SLOTS = 1 + Math.floor((LANE_END - LANE_START) / SLOT_PITCH + 1e-9);
/** Lane 0 drives on the right of its heading; a one-way link's second lane is on the left. */
export const laneOffset = (p: LanePosition) => p.lane === 0 ? LANE_OFFSET : -LANE_OFFSET;
/**
 * Centres for `count` cars in one lane, spaced SLOT_PITCH apart. phase 0..1 slides the whole
 * platoon toward the downstream end (1 = packed queue at the stop line), keeping spacing fixed.
 */
export function laneSlotCentres(count: number, phase: number): number[] {
  if (count > LANE_SLOTS) throw new RangeError('More cars than lane slots');
  const slack = LANE_END - LANE_START - (count - 1) * SLOT_PITCH, p = Math.min(1, Math.max(0, phase));
  return Array.from({ length: count }, (_, k) => LANE_START + slack * p + k * SLOT_PITCH);
}
/** Axis-aligned world bounds of a pose (headings are axis-aligned on the grid). */
export function vehicleBounds(p: { x: number; z: number; headingX: number; headingZ: number }, unit = 2) {
  const along = CAR_LENGTH / 2 * unit, side = CAR_WIDTH / 2 * unit, ax = p.headingX !== 0;
  const hx = ax ? along : side, hz = ax ? side : along;
  return { minX: p.x - hx, maxX: p.x + hx, minZ: p.z - hz, maxZ: p.z + hz };
}
/** Pairs of overlapping vehicles (should always be empty). */
export function overlappingPairs(poses: readonly { vehicleId: string; x: number; z: number; headingX: number; headingZ: number }[], unit = 2): [string, string][] {
  const b = poses.map(p => vehicleBounds(p, unit)), out: [string, string][] = [];
  for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++)
    if (b[i].minX < b[j].maxX - 1e-9 && b[j].minX < b[i].maxX - 1e-9 && b[i].minZ < b[j].maxZ - 1e-9 && b[j].minZ < b[i].maxZ - 1e-9) out.push([poses[i].vehicleId, poses[j].vehicleId]);
  return out;
}
