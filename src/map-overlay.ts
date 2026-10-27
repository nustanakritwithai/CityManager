/**
 * Read-only map layers and building issue markers. Every value comes from the
 * simulator's own state or explanation functions; nothing is mutated or saved.
 */
import { access, connectedRoads, economicSignals, utilities, explainCell, firmWorkerCount, homeOccupancy, housingCapacity, isRetail, type City } from './sim.ts';
import { FERTILITY_THRESHOLD } from './agriculture.ts';
import { CROP_BANDS, CROP_LABELS, cropForFertility, type CropId } from './goods.ts';

export type OverlayMode = 'fertility' | 'roads' | 'growth' | 'housing' | 'utilities';
/** Status tones, plus one per crop for the farm layer. */
export type Tone = 'good' | 'warn' | 'bad' | CropId;
export type OverlayCell = { cell: number; tone: Tone; strength: number };
export type Overlay = { mode: OverlayMode; cells: OverlayCell[]; legend: [Tone, string][] };
export type IssueKind = 'no-road' | 'no-utilities' | 'no-workers' | 'no-input' | 'stock-cap' | 'no-buyer' | 'no-stock' | 'unsuitable-fertility' | 'empty-home' | 'importing' | 'broke';
export type Issue = { cell: number; kind: IssueKind; text: string };

/** Which layer each build tool shows by default; select/pan/bulldoze show none. */
export const TOOL_OVERLAY: Readonly<Record<string, OverlayMode | undefined>> = Object.freeze({ road: 'roads', F: 'fertility', R: 'housing', C: 'growth', I: 'growth', power: 'utilities', water: 'utilities' });
export const OVERLAY_LEGENDS: Readonly<Record<OverlayMode, [Tone, string][]>> = Object.freeze({
  // The land decides the crop: a farm grows what its fertility band suits.
  fertility: [...(['rice', 'vegetables', 'sugarcane'] as const).map(k => [k, `${CROP_LABELS[k]} ${CROP_BANDS[k][0]}–${CROP_BANDS[k][1]}%`] as [Tone, string]), ['bad', `ต่ำกว่า ${FERTILITY_THRESHOLD}% ปลูกไม่ได้`]],
  roads: [['good', 'เชื่อมประตูเมือง'], ['bad', 'ไม่เชื่อม · โซน/อาคารไม่โต']],
  growth: [['good', 'พร้อมเกิดอาคาร'], ['warn', 'มีอาคารแล้ว'], ['bad', 'ติดเงื่อนไข · แตะดูเหตุผล']],
  housing: [['good', 'มีที่ว่างรับครัวเรือน'], ['warn', 'เต็มแล้ว'], ['bad', 'บ้านว่าง / แปลงบ้านติดเงื่อนไข']],
  utilities: [['good', 'มีน้ำและไฟ · โรงผลิต'], ['warn', 'ขาดน้ำหรือไฟอย่างใดอย่างหนึ่ง'], ['bad', 'ไม่มีทั้งน้ำและไฟ · สร้างโรงเพิ่ม']],
});
export const ISSUE_TEXT: Readonly<Record<IssueKind, string>> = Object.freeze({
  'no-road': 'ไม่มีถนนเชื่อมประตูเมือง', 'no-utilities': 'น้ำหรือไฟไม่พร้อม', 'no-workers': 'ไม่มีแรงงาน',
  'no-input': 'ขาดพืชผลวัตถุดิบ', 'stock-cap': 'คลังพืชผลเต็ม', 'no-buyer': 'ไม่มีผู้ซื้อ', 'no-stock': 'ไม่มีสินค้าขาย',
  'unsuitable-fertility': 'ดินไม่พอปลูก', 'empty-home': 'บ้านว่าง ยังไม่มีครัวเรือน',
  'importing': 'นำเข้าสินค้าจากนอกเมือง · โรงงานในเมืองผลิตไม่ทัน',
  'broke': 'เงินกิจการหมดและไม่มีคนงาน · รื้อแล้ววางโซนเดิมใหม่ ให้เปิดกิจการใหม่',
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
      cells.push({ cell: i, tone: cropForFertility(f) ?? 'bad', strength: .35 + f / 200 });
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

const SIGNAL_ISSUES: Readonly<Record<string, IssueKind>> = {
  'agriculture.no-road': 'no-road', 'agriculture.no-utilities': 'no-utilities', 'agriculture.no-workers': 'no-workers',
  'agriculture.no-input': 'no-input', 'agriculture.stock-cap': 'stock-cap', 'agriculture.no-buyer': 'no-buyer',
  'agriculture.no-stock': 'no-stock', 'agriculture.unsuitable-fertility': 'unsuitable-fertility',
};

/** Problems worth a marker above a building, from economicSignals() and real occupancy. */
export function buildingIssues(city: City): Issue[] {
  const issues: Issue[] = [], seen = new Set<number>();
  const add = (cell: number, kind: IssueKind) => { if (!seen.has(cell)) { seen.add(cell); issues.push({ cell, kind, text: ISSUE_TEXT[kind] }); } };
  for (const b of city.buildings) if (!access(city, b.cell)) add(b.cell, 'no-road');
  const svc = utilities(city);
  for (const b of city.buildings) if (access(city, b.cell) && !svc.ok(b.id)) add(b.cell, 'no-utilities');
  // A business with no cash and nobody working cannot buy stock or hire again: only a rebuild restarts it.
  for (const f of city.firms) { const b = city.buildings.find(v => v.id === f.building); if (b && (city.accounts[f.wallet] ?? 0) === 0 && firmWorkerCount(city, f.id) === 0) add(b.cell, 'broke'); }
  for (const s of economicSignals(city)) {
    const kind = SIGNAL_ISSUES[s.reasonId], firm = city.firms.find(f => f.id === s.firmId);
    const b = firm && city.buildings.find(v => v.id === firm.building);
    if (kind && b) add(b.cell, kind);
  }
  // Retail shops are outside economicSignals(): staffing, an empty shelf, or stock bought from
  // outside in the last three days because local factories could not cover the shop.
  const importedBy = new Set(city.goodsLedger.filter(e => e.reason === 'Imported shop stock' && e.tick > city.tick - 3).map(e => e.to));
  for (const f of city.firms.filter(isRetail)) {
    const b = city.buildings.find(v => v.id === f.building);
    if (!b || !access(city, b.cell)) continue;
    if (firmWorkerCount(city, f.id) === 0) add(b.cell, 'no-workers');
    else if (f.inventory === 0) add(b.cell, 'no-stock');
    else if (importedBy.has(f.wallet)) add(b.cell, 'importing');
  }
  // Homes wait one simulated day before admitting households, so only older empty homes are flagged.
  for (const b of city.buildings) if (b.zone === 'R' && b.age >= 2 && homeOccupancy(city, b.id).households === 0) add(b.cell, 'empty-home');
  return issues.sort((a, b) => a.cell - b.cell);
}
