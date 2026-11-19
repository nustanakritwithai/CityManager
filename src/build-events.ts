/** Which parcels just gained a building or a level, or lost one, for a short visual-only animation. */
export type BuildingState = { id: number; level: number };
export type BuildEvent = { cell: number; kind: 'built' | 'upgraded' | 'removed' };

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
  for (const cell of previous.keys()) if (!next.has(cell)) events.push({ cell, kind: 'removed' });
  return { events: previous.size === 0 || events.length > burst ? [] : events.sort((a, b) => a.cell - b.cell), next };
}

/** Ids are unique per kind of place; an offset keeps a park and a home with the same id apart. */
const PLACE_OFFSET = { civic: 1_000_000, park: 2_000_000, plant: 3_000_000, campus: 4_000_000 } as const;
type PlaceCity = {
  buildings: readonly { id: number; cell: number; level: number }[]; parks: readonly { id: number; cell: number }[]; plants: readonly { id: number; cell: number; level?: number }[];
  civic?: { sites: readonly { id: number; cell: number }[] }; education?: { campuses: readonly { id: number; cell: number; level: number }[] };
};
/** Everything the player or the city builds on a parcel, each at the parcel that holds its model. */
export function placeList(c: PlaceCity): { id: number; cell: number; level: number }[] {
  return [
    ...c.buildings.map(b => ({ id: b.id, cell: b.cell, level: b.level })),
    ...(c.civic?.sites ?? []).map(s => ({ id: PLACE_OFFSET.civic + s.id, cell: s.cell, level: 1 })),
    ...c.parks.map(p => ({ id: PLACE_OFFSET.park + p.id, cell: p.cell, level: 1 })),
    ...c.plants.map(p => ({ id: PLACE_OFFSET.plant + p.id, cell: p.cell, level: p.level ?? 1 })),
    ...(c.education?.campuses ?? []).map(k => ({ id: PLACE_OFFSET.campus + k.id, cell: k.cell, level: k.level })),
  ];
}

/** Road parcels laid since the last frame. More than `burst` at once (a load) is a jump, not road work. */
export function diffRoads(previous: ReadonlySet<number> | null, cells: readonly { road: boolean }[], burst = 40): { paved: number[]; next: Set<number> } {
  const next = new Set<number>(), paved: number[] = [];
  cells.forEach((cell, i) => { if (!cell.road) return; next.add(i); if (previous && !previous.has(i)) paved.push(i); });
  return { paved: !previous || paved.length > burst ? [] : paved, next };
}

/** Dust around a parcel at `t` seconds after work: each puff drifts out and up, swells, then shrinks away by `DUST_SECONDS`. */
export const DUST_SECONDS = .9;
export function dustPuff(index: number, count: number, t: number): { x: number; y: number; z: number; size: number } {
  const u = Math.min(1, Math.max(0, t / DUST_SECONDS)), angle = index / count * Math.PI * 2 + .4, reach = .55 + .6 * (1 - Math.pow(1 - u, 2));
  return { x: Math.cos(angle) * reach, y: .25 + u * .7, z: Math.sin(angle) * reach, size: u >= 1 ? 0 : (.55 + .45 * u) * (1 - Math.pow(u, 3)) };
}

/** Scale of an animating tile at `t` seconds: grows from the ground, or a small upgrade bounce. */
export function buildScale(kind: BuildEvent['kind'], t: number): number {
  if (kind === 'built') { const u = Math.min(1, t / .7); return u >= 1 ? 1 : .05 + .95 * (1 - Math.pow(1 - u, 3)) + Math.sin(u * Math.PI) * .08; }
  const u = Math.min(1, t / .5); return 1 + Math.sin(u * Math.PI) * .12;
}
