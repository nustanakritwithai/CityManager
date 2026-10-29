/** Screen-space only: no city, simulation, or utility scans while the camera moves. */
export type IssuePoint = { cell: number; x: number; y: number; z: number };
export function visibleIssueCells(points: readonly IssuePoint[], width: number, height: number, limit = 64): Set<number> {
  const placed: IssuePoint[] = [], cells = new Set<number>();
  for (const p of points) {
    if (p.z <= 0 || p.x < 22 || p.y < 22 || p.x > width - 22 || p.y > height - 22) continue;
    if (placed.some(other => Math.abs(other.x - p.x) < 48 && Math.abs(other.y - p.y) < 48)) continue;
    placed.push(p); cells.add(p.cell); if (placed.length >= limit) break;
  }
  return cells;
}
