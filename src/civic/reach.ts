import { expandedCellCoordinate } from '../expanded-map-grid.ts';
/** Manhattan cells between two parcels: the same walking-distance proxy home amenities use. */
export const civicCellDistance = (a: number, b: number) => { const x = expandedCellCoordinate(a), y = expandedCellCoordinate(b); return Math.abs(x.x - y.x) + Math.abs(x.z - y.z); };
