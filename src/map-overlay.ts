/**
 * Read-only map layers and building issue markers. Every value comes from the
 * simulator's own state or explanation functions; nothing is mutated or saved.
 */
import { access, connectedRoads, utilities, explainCell, homeOccupancy, housingCapacity, type City } from './sim.ts';
import { FERTILITY_THRESHOLD } from './agriculture.ts';
import { CROP_BANDS, CROP_LABELS, cropForFertility, type CropId } from './goods.ts';

export type OverlayMode = 'fertility' | 'roads' | 'growth' | 'housing' | 'utilities';
/** Status tones, plus one per crop for the farm layer. */
export type Tone = 'good' | 'warn' | 'bad' | CropId;
export type OverlayCell = { cell: number; tone: Tone; strength: number };
export type Overlay = { mode: OverlayMode; cells: OverlayCell[]; legend: [Tone, string][] };
export { buildingIssues, ISSUE_TEXT } from './building-issues.ts';
export type { Issue, IssueKind } from './building-issues.ts';

/** Which layer each build tool shows by default; select/pan/bulldoze show none. */
export const TOOL_OVERLAY: Readonly<Record<string, OverlayMode | undefined>> = Object.freeze({ road: 'roads', F: 'fertility', R: 'housing', C: 'growth', I: 'growth', power: 'utilities', water: 'utilities' });
export const OVERLAY_LEGENDS: Readonly<Record<OverlayMode, [Tone, string][]>> = Object.freeze({
  // The land decides the crop: a farm grows what its fertility band suits.
  fertility: [['good', 'ดินอุดมสมบูรณ์สูง'], ['warn', 'ดินอุดมสมบูรณ์ปานกลาง'], ['bad', 'ดินอุดมสมบูรณ์ต่ำ · ปลูกได้']],
  roads: [['good', 'เชื่อมประตูเมือง'], ['bad', 'ไม่เชื่อม · โซน/อาคารไม่โต']],
  growth: [['good', 'พร้อมเกิดอาคาร'], ['warn', 'มีอาคารแล้ว'], ['bad', 'ติดเงื่อนไข · แตะดูเหตุผล']],
  housing: [['good', 'มีที่ว่างรับครัวเรือน'], ['warn', 'เต็มแล้ว'], ['bad', 'บ้านว่าง / แปลงบ้านติดเงื่อนไข']],
  utilities: [['good', 'มีน้ำและไฟ · โรงผลิต'], ['warn', 'ขาดน้ำหรือไฟอย่างใดอย่างหนึ่ง'], ['bad', 'ไม่มีทั้งน้ำและไฟ · สร้างโรงเพิ่ม']],
});
export function mapOverlay(city: City, mode: OverlayMode): Overlay {
  const cells: OverlayCell[] = [], roads = connectedRoads(city), svc = mode === 'utilities' ? utilities(city) : null;
  for (let i = 0; i < city.cells.length; i++) {
    const cell = city.cells[i];
    if (svc) {
      const plant = city.plants.find(p => p.cell === i);
      if (plant) { cells.push({ cell: i, tone: svc.online.has(plant.id) ? 'good' : 'bad', strength: .9 }); continue; }
      const b = cell.building === null ? null : city.buildings.find(v => v.id === cell.building);
      if (!b) { if (cell.road && roads.has(i)) cells.push({ cell: i, tone: 'good', strength: .25 }); continue; }
      const s = svc.served.get(b.id)!;
      cells.push({ cell: i, tone: s.power && s.water ? 'good' : s.power || s.water ? 'warn' : 'bad', strength: .6 });
      continue;
    }
    if (mode === 'fertility') {
      if (cell.road || cell.building !== null && cell.zone !== 'F') continue;
      const f = city.resources.fertility[i];
      cells.push({ cell: i, tone: f >= 84 ? 'good' : f >= 50 ? 'warn' : 'bad', strength: .35 + f / 200 });
    } else if (mode === 'roads') {
      if (cell.road) cells.push({ cell: i, tone: roads.has(i) ? 'good' : 'bad', strength: .7 });
      else if (cell.zone || cell.building !== null) cells.push({ cell: i, tone: access(city, i) ? 'good' : 'bad', strength: .45 });
    } else if (mode === 'growth') {
      if (!cell.zone || cell.road) continue;
      if (cell.building !== null) { cells.push({ cell: i, tone: 'warn', strength: .3 }); continue; }
      cells.push({ cell: i, tone: eligible(city, i) ? 'good' : 'bad', strength: .6 });
    } else {
      if (cell.zone !== 'R') continue;
      const b = cell.building === null ? null : city.buildings.find(v => v.id === cell.building);
      if (!b) { cells.push({ cell: i, tone: eligible(city, i) ? 'good' : 'bad', strength: .45 }); continue; }
      const used = homeOccupancy(city, b.id), room = housingCapacity(b);
      cells.push({ cell: i, tone: used.households === 0 ? 'bad' : used.households >= room.households || used.persons >= room.persons ? 'warn' : 'good', strength: .65 });
    }
  }
  return { mode, cells, legend: OVERLAY_LEGENDS[mode] };
}

/** A vacant zoned parcel is ready when the simulator's own explanation has no blockers. */
function eligible(city: City, cell: number): boolean {
  return explainCell(city, cell).some(line => (line.startsWith('Eligible;') || line.startsWith('Shop site:')));
}
