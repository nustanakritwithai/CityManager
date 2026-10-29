import { roadLinked } from './road-topology.ts';
/** Read-only shortest paths over four-neighbor road cells. */
import { GATEWAY, SIZE, type City } from './sim.ts';

type RoadMap = Pick<City, 'cells' | 'roadTopology'>;
const valid = (city: RoadMap, index: number) => Number.isInteger(index) && index >= 0 && index < SIZE * SIZE && index < city.cells.length;

function neighbors(index: number): number[] {
  const x = index % SIZE;
  return [
    ...(x > 0 ? [index - 1] : []),
    ...(x < SIZE - 1 ? [index + 1] : []),
    ...(index >= SIZE ? [index - SIZE] : []),
    ...(index < SIZE * (SIZE - 1) ? [index + SIZE] : []),
  ];
}

function frontage(city: RoadMap, index: number): number[] {
  if (!valid(city, index)) return [];
  return city.cells[index].road ? [index] : neighbors(index).filter(next => city.cells[next]?.road);
}

/** Inclusive road cells; endpoints may be road-fronted parcels. Empty means no route. */
export function shortestRoadRoute(city: RoadMap, from: number, to: number): number[] {
  const sources = frontage(city, from).sort((a, b) => a - b);
  const destinations = new Set(frontage(city, to));
  const previous = new Map<number, number>();
  const queue = [...sources];
  for (const source of sources) previous.set(source, -1);
  for (let cursor = 0; cursor < queue.length && destinations.size; cursor++) {
    const current = queue[cursor];
    if (destinations.has(current)) {
      const path: number[] = [];
      for (let at = current; at !== -1; at = previous.get(at)!) path.push(at);
      return path.reverse();
    }
    for (const next of neighbors(current)) {
      if (!roadLinked(city,current,next) || previous.has(next)) continue;
      previous.set(next, current);
      queue.push(next);
    }
  }
  return [];
}

/** Road edges plus one entrance step for each off-road endpoint. */
export function roadDistance(city: RoadMap, from: number, to: number): number | null {
  const route = shortestRoadRoute(city, from, to);
  if (!route.length) return null;
  if (from === to) return 0;
  return route.length - 1 + Number(!city.cells[from].road) + Number(!city.cells[to].road);
}

export const gatewayRoadRoute = (city: RoadMap, to: number): number[] => shortestRoadRoute(city, GATEWAY, to);
export const gatewayRoadDistance = (city: RoadMap, to: number): number | null => roadDistance(city, GATEWAY, to);
