import { expandedCellAt, expandedCellCoordinate } from './expanded-map-grid.ts';
/** Pure, visual-only choices for scene decoration; never mutates the city or reads the sim RNG. */
import { SIZE, type City } from './sim.ts';

/** Unzoned land that zones or buildings surround on three or more sides shows a small park (decoration only). */
export function pocketPark(city: City, i: number): boolean {
  const cell = city.cells[i]; if (cell.road || cell.zone || cell.building !== null || city.plants.some(p => p.cell === i) || city.parks.some(p => p.cell === i) || city.education?.campuses.some(p => p.cell === i)) return false;
  const {x,z:y}=expandedCellCoordinate(i); let around = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue; const nx = x + dx, ny = y + dy; const at=expandedCellAt(nx,ny); if(at===null || at>=city.cells.length)continue;
    const n = city.cells[at]; if (n.zone || n.building !== null) around++;
  }
  return around >= 3;
}
