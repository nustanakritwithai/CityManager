import { isCanonicalResourceMap, type ResourceMap } from './agriculture.ts';
import { EXPANDED_MAP_CELLS, LEGACY_MAP_CELLS } from './expanded-map-grid.ts';

/** A separate resource version: the 576-cell fertility-1 contract stays frozen. */
export type ExpandedResourceMap = { version: 'fertility-2'; seed: number; fertility: number[] };
type LegacyCell = { road: boolean; zone: 'R' | 'C' | 'I' | 'F' | null; building: number | null };
type LegacyMap = { seed: number; cells: LegacyCell[]; resources: ResourceMap };

// Same independent per-cell hash as fertility-1, extended only to the new IDs.
// This never reads or advances the city's simulation RNG.
function newCellFertility(seed: number, cell: number): number {
  let value = (seed ^ Math.imul(cell + 1, 0x9e3779b1)) >>> 0;
  value = Math.imul(value ^ value >>> 16, 0x7feb352d) >>> 0;
  value = Math.imul(value ^ value >>> 15, 0x846ca68b) >>> 0;
  return ((value ^ value >>> 16) >>> 0) % 101;
}

export function isCanonicalExpandedResourceMap(value: unknown, seed: number): value is ExpandedResourceMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const map = value as ExpandedResourceMap;
  if (Object.keys(map).sort().join(',') !== 'fertility,seed,version' || map.version !== 'fertility-2' || map.seed !== seed || !Array.isArray(map.fertility) || map.fertility.length !== EXPANDED_MAP_CELLS) return false;
  if (!isCanonicalResourceMap({ version: 'fertility-1', seed, fertility: map.fertility.slice(0, LEGACY_MAP_CELLS) }, seed)) return false;
  for (let cell = LEGACY_MAP_CELLS; cell < EXPANDED_MAP_CELLS; cell++) if (map.fertility[cell] !== newCellFertility(seed, cell)) return false;
  return true;
}

/**
 * Append only the new cells to an already fully validated legacy city.
 * This is a migration primitive, not a save decoder: the caller must first run
 * the original version's full validation and must not publish a new envelope
 * until the expanded city validators and all consumers support it.
 */
export function appendNorthLand<T extends LegacyMap>(city: T): Omit<T, 'cells' | 'resources'> & { cells: LegacyCell[]; resources: ExpandedResourceMap } {
  if (!Array.isArray(city.cells) || city.cells.length !== LEGACY_MAP_CELLS || !isCanonicalResourceMap(city.resources, city.seed)) throw Error('Invalid legacy map');
  for (const cell of city.cells) {
    if (!cell || typeof cell.road !== 'boolean' || ![null,'R','C','I','F'].includes(cell.zone) || !(cell.building === null || Number.isSafeInteger(cell.building) && cell.building > 0) || (cell.road && (cell.zone !== null || cell.building !== null))) throw Error('Invalid legacy map cell');
  }
  return {
    ...city,
    cells: [...city.cells.map(cell => ({ ...cell })), ...Array.from({ length: EXPANDED_MAP_CELLS - LEGACY_MAP_CELLS }, () => ({ road: false, zone: null, building: null } as LegacyCell))],
    resources: { version: 'fertility-2', seed: city.seed, fertility: [...city.resources.fertility, ...Array.from({ length: EXPANDED_MAP_CELLS - LEGACY_MAP_CELLS }, (_, i) => newCellFertility(city.seed, LEGACY_MAP_CELLS + i))] },
  };
}
