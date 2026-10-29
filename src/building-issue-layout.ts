/** Screen-space only: no city, simulation, or utility scans while the camera moves. */
export type IssuePoint = { cell: number; x: number; y: number; z: number };
export function visibleIssueCells(points: readonly IssuePoint[], width: number, height: number, limit = 64, selectionPoints: readonly IssuePoint[] = []): Set<number> {
  const placed: IssuePoint[] = [], cells = new Set<number>();
  for (const p of points) {
    if (p.z <= 0 || p.x < 22 || p.y < 22 || p.x > width - 22 || p.y > height - 22) continue;
    // A raised badge can project over a different parcel at narrow zoom. Keep
    // building/service centres available for normal selection, with a 4px gap.
    if (selectionPoints.some(target => target.z > 0 && Math.abs(target.x - p.x) < 26 && Math.abs(target.y - p.y) < 26)) continue;
    if (placed.some(other => Math.abs(other.x - p.x) < 48 && Math.abs(other.y - p.y) < 48)) continue;
    placed.push(p); cells.add(p.cell); if (placed.length >= limit) break;
  }
  return cells;
}
