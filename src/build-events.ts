/** Which parcels just gained a building or a level, for a short visual-only animation. */
export type BuildingState = { id: number; level: number };
export type BuildEvent = { cell: number; kind: 'built' | 'upgraded' };

/**
 * Compares the buildings now standing with the previous render. A burst larger than
 * `burst` (loading a save, the first frame) is treated as a jump, not as construction.
 */
export function diffBuildings(previous: ReadonlyMap<number, BuildingState>, buildings: readonly { id: number; cell: number; level: number }[], burst = 6): { events: BuildEvent[]; next: Map<number, BuildingState> } {
  const next = new Map<number, BuildingState>(), events: BuildEvent[] = [];
  for (const b of buildings) {
    next.set(b.cell, { id: b.id, level: b.level });
    const before = previous.get(b.cell);
    if (!before || before.id !== b.id) events.push({ cell: b.cell, kind: 'built' });
    else if (b.level > before.level) events.push({ cell: b.cell, kind: 'upgraded' });
  }
  return { events: previous.size === 0 || events.length > burst ? [] : events.sort((a, b) => a.cell - b.cell), next };
}

/** Scale of an animating tile at `t` seconds: grows from the ground, or a small upgrade bounce. */
export function buildScale(kind: BuildEvent['kind'], t: number): number {
  if (kind === 'built') { const u = Math.min(1, t / .7); return u >= 1 ? 1 : .05 + .95 * (1 - Math.pow(1 - u, 3)) + Math.sin(u * Math.PI) * .08; }
  const u = Math.min(1, t / .5); return 1 + Math.sin(u * Math.PI) * .12;
}
