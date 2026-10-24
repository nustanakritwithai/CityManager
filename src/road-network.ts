/** Deterministic, non-mutating routing over placed four-neighbor roads.
 * Uniform-cost road tiles use breadth-first search: this finds a shortest route
 * without an A* priority queue, traffic simulation or estimates of travel time.
 */
import { GATEWAY, SIZE, type City } from './sim.ts';

type RoadMap = Pick<City, 'cells'>;
const valid = (index: number) => Number.isInteger(index) && index >= 0 && index < SIZE * SIZE;
function neighbors(index: number): number[] {
  const x = index % SIZE;
  return [
    ...(x > 0 ? [index - 1] : []),
    ...(x < SIZE - 1 ? [index + 1] : []),
    ...(index >= SIZE ? [index - SIZE] : []),
    ...(index < SIZE * (SIZE - 1) ? [index + SIZE] : []),
  ];
}
function roadFrontage(city: RoadMap, cell: number): number[] {
  if (!valid(cell)) return [];
  return city.cells[cell].road ? [cell] : neighbors(cell).filter(index => city.cells[index].road);
}

/**
 * Inclusive list of ROAD cells connecting any road-facing access points of two
 * parcels (or road endpoints). An empty route means invalid or disconnected.
 * Off-road parcels are never traversed as shortcuts. Ties are reproducible.
 */
export function shortestRoadRoute(city: RoadMap, from: number, to: number): number[] {
  const sources = roadFrontage(city, from).sort((a, b) => a - b);
  const destinations = new Set(roadFrontage(city, to));
  if (!sources.length || destinations.size === 0) return [];

  const previous = new Map<number, number>();
  const queue = [...sources];
  for (const source of sources) previous.set(source, -1);
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const current = queue[cursor];
    if (destinations.has(current)) {
      const path: number[] = [];
      for (let at = current; at !== -1; at = previous.get(at) ?? -1) path.push(at);
      return path.reverse();
    }
    for (const next of neighbors(current)) {
      if (!city.cells[next].road || previous.has(next)) continue;
      previous.set(next, current);
      queue.push(next);
    }
  }
  return [];
}

/** Road-edge count plus one entrance step per parcel; null means no route. */
export function roadDistance(city: RoadMap, from: number, to: number): number | null {
  const route = shortestRoadRoute(city, from, to);
  if (!route.length) return null;
  if (from === to) return 0;
  return route.length - 1 + Number(!city.cells[from].road) + Number(!city.cells[to].road);
}

export const gatewayRoadRoute = (city: RoadMap, to: number): number[] => shortestRoadRoute(city, GATEWAY, to);
export const gatewayRoadDistance = (city: RoadMap, to: number): number | null => roadDistance(city, GATEWAY, to);
