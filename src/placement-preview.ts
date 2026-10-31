/**
 * Read-only preview of a build action before the player commits it. Mirrors the
 * up-front checks in buildRoad / zoneCell / bulldoze (sim.ts) without mutating City;
 * tests compare every preview against the real action on a cloned city.
 */
import { GATEWAY, ROAD_COST, SIZE, treasurySpendable, access, parkAt, plantAt, roadPath, campusSiteReason, type City, type Zone } from './sim.ts';
import { EDUCATION_COST } from './education.ts';
import { MAX_PLANTS, PLANTS, PLANT_LABELS } from './utilities.ts';
import { MAX_PARKS, PARK } from './parks.ts';
import { FERTILITY_THRESHOLD } from './agriculture.ts';
import { taxiEnabled } from './taxi/buildings.ts';
import { sharedTaxiSession, taxiPlayTraffic } from './taxi/session.ts';

export type PreviewCell = { cell: number; ok: boolean };
export type Preview = { ok: boolean; cells: PreviewCell[]; cost: number; label: string };
const ZONE_NAMES: Record<Exclude<Zone, null>, string> = { R: 'บ้าน', C: 'พาณิชย์', I: 'โรงงาน', F: 'ฟาร์ม' };
const DEMOLITION_COST = 2_000;
const credits = (satang: number) => (satang / 100).toLocaleString('th-TH', { maximumFractionDigits: 2 });
const inMap = (cell: number) => Number.isInteger(cell) && cell >= 0 && cell < SIZE * SIZE;

export function previewPlacement(city: City, tool: string, start: number | null, hover: number | null): Preview | null {
  if (hover === null || !inMap(hover)) return null;
  const treasury = treasurySpendable(city);
  const taxiHere = taxiEnabled() && sharedTaxiSession().at(hover);
  if (tool === 'taxi') {
    const why = sharedTaxiSession().reason(city, hover, taxiEnabled(), taxiPlayTraffic());
    return { ok: !why, cost: 0, label: why ?? 'อู่แท็กซี่ · 4 คัน · ไม่มีค่าก่อสร้าง · ลดรถส่วนตัวในช่วงที่ครอบคลุม', cells: [{ cell: hover, ok: !why }] };
  }
  if (tool === 'road') {
    const path = start === null ? [hover] : roadPath(start, hover);
    if (!path.length) return null;
    const taxiBlock = taxiEnabled() ? new Set(path.filter(i => sharedTaxiSession().at(i))) : new Set<number>();
    const blocked = new Set(path.filter(i => city.cells[i].building !== null || plantAt(city, i) || parkAt(city, i) || taxiBlock.has(i)));
    const added = path.filter(i => !city.cells[i].road), cost = added.length * ROAD_COST;
    const affordable = cost <= treasury, ok = !blocked.size && affordable;
    const label = taxiBlock.size ? 'มีอู่แท็กซี่ขวางทาง ต้องรื้อก่อน' : blocked.size ? 'มีอาคารขวางทาง ต้องรื้อก่อน'
      : !added.length ? 'มีถนนอยู่แล้ว ไม่เสียเงิน'
      : `ถนน ${added.length} ช่อง · ${credits(cost)} ฿${affordable ? '' : ' · เงินคลังไม่พอ'}`;
    return { ok, cost, label: start === null && added.length ? `${label} · แตะจุดจบ` : label, cells: path.map(cell => ({ cell, ok: ok && !blocked.has(cell) })) };
  }
  if (tool === 'R' || tool === 'C' || tool === 'I' || tool === 'F') {
    const cell = city.cells[hover], fertility = city.resources.fertility[hover];
    const reason = taxiHere ? 'มีอู่แท็กซี่อยู่ ต้องรื้อก่อน' : parkAt(city, hover) || plantAt(city, hover) ? 'มีสวนหรือโรงน้ำไฟอยู่ ต้องรื้อก่อน' : cell.road ? 'ถนนวางโซนไม่ได้'
      : cell.building !== null && cell.zone !== tool ? 'มีอาคารอื่นอยู่ ต้องรื้อก่อน'
      : null;
    const label = reason ?? (cell.zone === tool ? `เป็นโซน${ZONE_NAMES[tool]}อยู่แล้ว` : `วางโซน${ZONE_NAMES[tool]} · ไม่เสียเงิน${tool === 'F' ? ` · ดิน ${fertility}%` : ''}`);
    return { ok: !reason, cost: 0, label, cells: [{ cell: hover, ok: !reason }] };
  }
  if (tool === 'power' || tool === 'water') {
    const cell = city.cells[hover], plant = PLANTS[tool], name = PLANT_LABELS[tool];
    const reason = taxiHere ? 'มีอู่แท็กซี่อยู่ ต้องรื้อก่อน' : cell.road || cell.building !== null || plantAt(city, hover) || parkAt(city, hover) ? 'วางโรงได้เฉพาะแปลงว่าง'
      : !access(city, hover) ? 'ต้องมีถนนเชื่อมประตูเมืองข้างแปลง'
      : city.plants.length >= MAX_PLANTS ? `มีโรงครบ ${MAX_PLANTS} แห่งแล้ว`
      : plant.cost > treasury ? 'เงินคลังไม่พอ' : null;
    const label = reason ?? `${name} · ${credits(plant.cost)} ฿ · +${plant.capacity} หน่วย · บำรุง ${credits(plant.upkeep)} ฿/เดือน`;
    return { ok: !reason, cost: reason ? 0 : plant.cost, label, cells: [{ cell: hover, ok: !reason }] };
  }
  if (tool === 'park') {
    const cell = city.cells[hover];
    const reason = taxiHere ? 'มีอู่แท็กซี่อยู่ ต้องรื้อก่อน' : cell.road || cell.zone !== null || cell.building !== null || plantAt(city, hover) || parkAt(city, hover) ? 'สวนต้องใช้แปลงว่าง 1 ช่อง ล้างโซนหรือรื้อสิ่งเดิมก่อน'
      : city.parks.length >= MAX_PARKS || !Number.isSafeInteger(city.nextId) || city.nextId < 1 || city.nextId > Number.MAX_SAFE_INTEGER - 3 ? `สร้างสวนเพิ่มไม่ได้ (สูงสุด ${MAX_PARKS} แห่ง)`
      : treasury < PARK.cost ? 'เงินคลังไม่พอ' : null;
    return { ok: !reason, cost: reason ? 0 : PARK.cost, label: reason ?? `สวนสาธารณะ · ${credits(PARK.cost)} ฿ · 1 ช่อง · ไม่ต้องติดถนน · บำรุง ${credits(PARK.upkeep)} ฿/เดือน`, cells: [{ cell: hover, ok: !reason }] };
  }
  if (tool === 'school' || tool === 'university') {
    const reason = taxiHere ? 'มีอู่แท็กซี่อยู่ ต้องรื้อก่อน' : campusSiteReason(city, hover, tool);
    const cost = tool === 'school' ? EDUCATION_COST.school.build : EDUCATION_COST.university.build;
    const name = tool === 'school' ? 'โรงเรียน' : 'มหาวิทยาลัย';
    return { ok: !reason, cost: reason ? 0 : cost, label: reason ?? `${name} · ${credits(cost)} ฿ · 1 ช่องว่างที่ยังไม่ลงโซน · ต้องติดถนน`, cells: [{ cell: hover, ok: !reason }] };
  }
  if (tool === 'bulldoze') {
    if (taxiHere) return { ok: true, cost: 0, label: 'รื้ออู่แท็กซี่ · ไม่เสียเงิน', cells: [{ cell: hover, ok: true }] };
    const cell = city.cells[hover], target = cell.building !== null || cell.road || plantAt(city, hover) !== undefined || parkAt(city, hover) !== undefined, cost = target ? DEMOLITION_COST : 0;
    const reason = hover === GATEWAY ? 'ประตูเมืองรื้อไม่ได้' : cost > treasury ? 'เงินคลังไม่พอค่ารื้อ' : null;
    const label = reason ?? (parkAt(city, hover) ? `รื้อสวนสาธารณะ · ${credits(cost)} ฿` : cell.building !== null ? `รื้ออาคาร · ${credits(cost)} ฿` : cell.road ? `รื้อถนน · ${credits(cost)} ฿` : plantAt(city, hover) ? `รื้อ${PLANT_LABELS[plantAt(city, hover)!.kind]} · ${credits(cost)} ฿` : cell.zone ? 'ล้างโซน · ไม่เสียเงิน' : 'ไม่มีอะไรให้รื้อ');
    return { ok: !reason, cost, label, cells: [{ cell: hover, ok: !reason }] };
  }
  return null;
}
