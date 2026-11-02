/**
 * Proposed additive grid coordinates. This module does not activate expansion.
 * Legacy cell IDs and their world coordinates are unchanged. New rows are stored
 * after the legacy cells, with the highest new row adjoining legacy row zero.
 */
export const LEGACY_MAP_WIDTH = 24;
export const LEGACY_MAP_HEIGHT = 24;
export const NORTH_EXTENSION_ROWS = 4;
export const LEGACY_MAP_CELLS = LEGACY_MAP_WIDTH * LEGACY_MAP_HEIGHT;
export const EXPANDED_MAP_CELLS = LEGACY_MAP_WIDTH * (LEGACY_MAP_HEIGHT + NORTH_EXTENSION_ROWS);

/** x and z use the legacy grid's coordinate system; north has negative z. */
export type MapCoordinate = { x: number; z: number };
export function expandedCellCoordinate(cell: number): MapCoordinate {
  if (!Number.isSafeInteger(cell) || cell < 0 || cell >= EXPANDED_MAP_CELLS) throw new RangeError('Invalid expanded map cell');
  const row = Math.floor(cell / LEGACY_MAP_WIDTH);
  return { x: cell % LEGACY_MAP_WIDTH, z: row < LEGACY_MAP_HEIGHT ? row : row - LEGACY_MAP_HEIGHT - NORTH_EXTENSION_ROWS };
}

export function expandedCellAt(x: number, z: number): number | null {
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(z) || x < 0 || x >= LEGACY_MAP_WIDTH || z < -NORTH_EXTENSION_ROWS || z >= LEGACY_MAP_HEIGHT) return null;
  const row = z < 0 ? z + LEGACY_MAP_HEIGHT + NORTH_EXTENSION_ROWS : z;
  return row * LEGACY_MAP_WIDTH + x;
}

/** Cardinal neighbors in stable west, east, north, south order. */
export function expandedCellNeighbors(cell: number): number[] {
  const { x, z } = expandedCellCoordinate(cell);
  return [[x - 1, z], [x + 1, z], [x, z - 1], [x, z + 1]]
    .map(([nx, nz]) => expandedCellAt(nx, nz)).filter((next): next is number => next !== null);
}

/** Axis-aligned player road stroke, with horizontal movement before vertical. */
export function expandedCellPath(from: number, to: number): number[] {
  const start = expandedCellCoordinate(from), end = expandedCellCoordinate(to);
  let { x, z } = start;
  const path = [from];
  while (x !== end.x) { x += Math.sign(end.x - x); path.push(expandedCellAt(x, z)!); }
  while (z !== end.z) { z += Math.sign(end.z - z); path.push(expandedCellAt(x, z)!); }
  return path;
}
