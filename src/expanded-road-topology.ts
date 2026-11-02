import { validateRoadTopology, type RoadMap } from './road-topology.ts';
import { expandedCellAt, expandedCellCoordinate, expandedCellNeighbors, EXPANDED_MAP_CELLS, LEGACY_MAP_CELLS, LEGACY_MAP_WIDTH } from './expanded-map-grid.ts';

/** New format uses cardinal directions because north across the seam is not -24. */
export type ExpandedRoadDirection = 'north' | 'east' | 'south' | 'west';
export type ExpandedRoadTopology = { version: 2; blocked: number[]; oneWay: Record<string, ExpandedRoadDirection> };
export type ExpandedRoadMap = { cells: readonly { road: boolean }[]; roadTopology?: ExpandedRoadTopology };
const directions: Record<ExpandedRoadDirection, readonly [number, number]> = { north: [0,-1], east: [1,0], south: [0,1], west: [-1,0] };

export function expandedEdgeKey(a: number, b: number): number {
  if (!expandedCellNeighbors(a).includes(b)) throw Error('Invalid expanded road edge');
  return Math.min(a,b) * EXPANDED_MAP_CELLS + Math.max(a,b);
}

export function expandedRoadDirection(a: number, b: number): ExpandedRoadDirection {
  if (!expandedCellNeighbors(a).includes(b)) throw Error('Invalid expanded road direction');
  const from = expandedCellCoordinate(a), to = expandedCellCoordinate(b);
  if (to.x > from.x) return 'east';
  if (to.x < from.x) return 'west';
  return to.z < from.z ? 'north' : 'south';
}

export function expandedDirectionTarget(cell: number, direction: ExpandedRoadDirection): number | null {
  const offset = directions[direction];
  if (!offset) throw Error('Invalid expanded road direction');
  const {x,z} = expandedCellCoordinate(cell);
  return expandedCellAt(x + offset[0], z + offset[1]);
}

export function expandedRoadLinked(map: ExpandedRoadMap, from: number, to: number): boolean {
  return !!map.cells[from]?.road && !!map.cells[to]?.road && expandedCellNeighbors(from).includes(to) && !map.roadTopology?.blocked.includes(expandedEdgeKey(from,to));
}

/** Match the legacy rule: neither endpoint may point against the movement. */
export function expandedRoadDriveAllowed(map: ExpandedRoadMap, from: number, to: number): boolean {
  if (!expandedRoadLinked(map,from,to)) return false;
  const reverse = expandedRoadDirection(to,from);
  return map.roadTopology?.oneWay[from] !== reverse && map.roadTopology?.oneWay[to] !== reverse;
}

/** Strict validation retains the current rule that topology only references roads. */
export function validateExpandedRoadTopology(cells: readonly { road: boolean }[], value: unknown): asserts value is ExpandedRoadTopology {
  const t = value as ExpandedRoadTopology;
  if (cells.length !== EXPANDED_MAP_CELLS || !t || typeof t !== 'object' || Array.isArray(t) || Object.keys(t).sort().join(',') !== 'blocked,oneWay,version' || t.version !== 2 || !Array.isArray(t.blocked) || t.blocked.length > 24 * 27 + 23 * 28 || !t.oneWay || typeof t.oneWay !== 'object' || Array.isArray(t.oneWay)) throw Error('Invalid expanded road topology');
  let previous = -1;
  for (const key of t.blocked) {
    const a = Math.floor(key / EXPANDED_MAP_CELLS), b = key % EXPANDED_MAP_CELLS;
    if (!Number.isSafeInteger(key) || key <= previous || a < 0 || a >= b || b >= EXPANDED_MAP_CELLS || !cells[a]?.road || !cells[b]?.road || !expandedCellNeighbors(a).includes(b)) throw Error('Invalid expanded road junction');
    previous = key;
  }
  if (Object.keys(t.oneWay).length > EXPANDED_MAP_CELLS) throw Error('Too many expanded road directions');
  for (const [key, direction] of Object.entries(t.oneWay)) if (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= EXPANDED_MAP_CELLS || !cells[Number(key)]?.road || !Object.hasOwn(directions,direction)) throw Error('Invalid expanded one-way road');
}

/** Validate the original radix-576 topology before translating it. */
export function expandLegacyRoadTopology(legacy: RoadMap): ExpandedRoadTopology | undefined {
  if (!legacy.roadTopology) return undefined;
  if (legacy.cells.length !== LEGACY_MAP_CELLS) throw Error('Invalid legacy road map');
  validateRoadTopology(legacy, legacy.roadTopology);
  const old = legacy.roadTopology;
  if (old.version !== 1) throw Error('Invalid legacy road topology');
  const blocked = old.blocked.map(key => expandedEdgeKey(Math.floor(key / LEGACY_MAP_CELLS), key % LEGACY_MAP_CELLS)).sort((a,b) => a-b);
  const oneWay: ExpandedRoadTopology['oneWay'] = {};
  for (const [cell, delta] of Object.entries(old.oneWay)) {
    oneWay[cell] = delta === -LEGACY_MAP_WIDTH ? 'north' : delta === LEGACY_MAP_WIDTH ? 'south' : delta === 1 ? 'east' : 'west';
  }
  const result: ExpandedRoadTopology = { version: 2, blocked, oneWay };
  validateExpandedRoadTopology([...legacy.cells, ...Array.from({length: EXPANDED_MAP_CELLS - LEGACY_MAP_CELLS}, () => ({road:false}))], result);
  return result;
}

/** Editing primitives for the expanded topology. They are not wired to the live city yet. */
type MutableExpandedRoadMap = { cells: { road: boolean }[]; roadTopology?: ExpandedRoadTopology };
const copyExpandedTopology = (map: MutableExpandedRoadMap): ExpandedRoadTopology => ({
  version: 2, blocked: [...(map.roadTopology?.blocked ?? [])], oneWay: { ...map.roadTopology?.oneWay },
});

export function setExpandedRoadJunction(map: MutableExpandedRoadMap, a: number, b: number, connected: boolean): boolean {
  if (!map.cells[a]?.road || !map.cells[b]?.road || !expandedCellNeighbors(a).includes(b)) return false;
  const topology = copyExpandedTopology(map), blocked = new Set(topology.blocked), key = expandedEdgeKey(a, b);
  if (connected) blocked.delete(key); else blocked.add(key);
  topology.blocked = [...blocked].sort((x, y) => x - y);
  validateExpandedRoadTopology(map.cells, topology);
  map.roadTopology = topology;
  return true;
}

/** Drawing opens selected edges but keeps other crossing connections and directions. */
export function configureExpandedRoadPath(map: MutableExpandedRoadMap, path: number[], newCells: ReadonlySet<number>, oneWay: boolean): void {
  if (!path.length || (oneWay && path.length < 2) || path.some(cell => !map.cells[cell]?.road) || path.slice(1).some((cell, i) => !expandedCellNeighbors(path[i]).includes(cell))) throw Error('Invalid expanded road path');
  const topology = copyExpandedTopology(map), blocked = new Set(topology.blocked);
  const edges = new Set(path.slice(1).map((cell, i) => expandedEdgeKey(path[i], cell)));
  if (path.length === 1 && newCells.has(path[0])) {
    const i = path[0];
    const axes: [ExpandedRoadDirection, ExpandedRoadDirection][] = [['west','east'], ['north','south']];
    const matching = axes.map(axis => axis.map(direction => expandedDirectionTarget(i, direction))).filter(pair => pair.every(cell => cell !== null && map.cells[cell]?.road));
    if (matching.length === 1) for (const cell of matching[0]) edges.add(expandedEdgeKey(i, cell!));
  }
  for (let at = 0; at < path.length; at++) {
    const i = path[at];
    for (const neighbor of expandedCellNeighbors(i)) if (map.cells[neighbor].road) {
      const key = expandedEdgeKey(i, neighbor);
      if (edges.has(key)) blocked.delete(key); else if (newCells.has(i)) blocked.add(key);
    }
    if (oneWay) topology.oneWay[i] = at < path.length - 1 ? expandedRoadDirection(i, path[at + 1]) : expandedRoadDirection(path[at - 1], i);
    else if (newCells.has(i)) delete topology.oneWay[i];
  }
  topology.blocked = [...blocked].sort((a, b) => a - b);
  validateExpandedRoadTopology(map.cells, topology);
  if (map.roadTopology || topology.blocked.length || Object.keys(topology.oneWay).length) map.roadTopology = topology;
}

export function forgetExpandedRoadTopology(map: MutableExpandedRoadMap, cell: number): void {
  if (!map.roadTopology) return;
  const topology = copyExpandedTopology(map);
  topology.blocked = topology.blocked.filter(key => Math.floor(key / EXPANDED_MAP_CELLS) !== cell && key % EXPANDED_MAP_CELLS !== cell);
  delete topology.oneWay[cell];
  map.roadTopology = topology;
}
