/**
 * Read-only preview of a build action before the player commits it. Mirrors the
 * up-front checks in buildRoad / zoneCell / bulldoze (sim.ts) without mutating City;
 * tests compare every preview against the real action on a cloned city.
 */
import { GATEWAY, ROAD_COST, SIZE, access, plantAt, roadPath, type City, type Zone } from './sim.ts';
import { MAX_PLANTS, PLANTS, PLANT_LABELS } from './utilities.ts';
import { FERTILITY_THRESHOLD } from './agriculture.ts';

export type PreviewCell = { cell: number; ok: boolean };
export type Preview = { ok: boolean; cells: PreviewCell[]; cost: number; label: string };
const ZONE_NAMES: Record<Exclude<Zone, null>, string> = { R: 'บ้าน', C: 'พาณิชย์', I: 'โรงงาน', F: 'ฟาร์ม' };
const DEMOLITION_COST = 2_000;
const credits = (satang: number) => (satang / 100).toLocaleString('th-TH', { maximumFractionDigits: 2 });
const inMap = (cell: number) => Number.isInteger(cell) && cell >= 0 && cell < SIZE * SIZE;

export function previewPlacement(city: City, tool: string, start: number | null, hover: number | null): Preview | null {
  if (hover === null || !inMap(hover)) return null;
  const treasury = city.accounts.treasury ?? 0;
  if (tool === 'road') {
    const path = start === null ? [hover] : roadPath(start, hover);
    if (!path.length) return null;
    const blocked = new Set(path.filter(i => city.cells[i].building !== null));
    const added = path.filter(i => !city.cells[i].road), cost = added.length * ROAD_COST;
    const affordable = cost <= treasury, ok = !blocked.size && affordable;
    const label = blocked.size ? 'มีอาคารขวางทาง ต้องรื้อก่อน'
      : !added.length ? 'มีถนนอยู่แล้ว ไม่เสียเงิน'
      : `ถนน ${added.length} ช่อง · ${credits(cost)} ฿${affordable ? '' : ' · เงินคลังไม่พอ'}`;
    return { ok, cost, label: start === null && added.length ? `${label} · แตะจุดจบ` : label, cells: path.map(cell => ({ cell, ok: ok && !blocked.has(cell) })) };
  }
  if (tool === 'R' || tool === 'C' || tool === 'I' || tool === 'F') {
    const cell = city.cells[hover], fertility = city.resources.fertility[hover];
    const reason = cell.road ? 'ถนนวางโซนไม่ได้'
      : cell.building !== null && cell.zone !== tool ? 'มีอาคารอื่นอยู่ ต้องรื้อก่อน'
      : tool === 'F' && fertility < FERTILITY_THRESHOLD ? `ความอุดมสมบูรณ์ ${fertility}% ต่ำกว่า ${FERTILITY_THRESHOLD}%`
      : null;
    const label = reason ?? (cell.zone === tool ? `เป็นโซน${ZONE_NAMES[tool]}อยู่แล้ว` : `วางโซน${ZONE_NAMES[tool]} · ไม่เสียเงิน${tool === 'F' ? ` · ดิน ${fertility}%` : ''}`);
    return { ok: !reason, cost: 0, label, cells: [{ cell: hover, ok: !reason }] };
  }
  if (tool === 'power' || tool === 'water') {
    const cell = city.cells[hover], plant = PLANTS[tool], name = PLANT_LABELS[tool];
    const reason = cell.road || cell.building !== null || plantAt(city, hover) ? 'วางโรงได้เฉพาะแปลงว่าง'
      : !access(city, hover) ? 'ต้องมีถนนเชื่อมประตูเมืองข้างแปลง'
      : city.plants.length >= MAX_PLANTS ? `มีโรงครบ ${MAX_PLANTS} แห่งแล้ว`
      : plant.cost > treasury ? 'เงินคลังไม่พอ' : null;
    const label = reason ?? `${name} · ${credits(plant.cost)} ฿ · +${plant.capacity} หน่วย · บำรุง ${credits(plant.upkeep)} ฿/เดือน`;
    return { ok: !reason, cost: reason ? 0 : plant.cost, label, cells: [{ cell: hover, ok: !reason }] };
  }
  if (tool === 'bulldoze') {
    const cell = city.cells[hover], target = cell.building !== null || cell.road || plantAt(city, hover) !== undefined, cost = target ? DEMOLITION_COST : 0;
    const reason = hover === GATEWAY ? 'ประตูเมืองรื้อไม่ได้' : cost > treasury ? 'เงินคลังไม่พอค่ารื้อ' : null;
    const label = reason ?? (cell.building !== null ? `รื้ออาคาร · ${credits(cost)} ฿` : cell.road ? `รื้อถนน · ${credits(cost)} ฿` : cell.zone ? 'ล้างโซน · ไม่เสียเงิน' : 'ไม่มีอะไรให้รื้อ');
    return { ok: !reason, cost, label, cells: [{ cell: hover, ok: !reason }] };
  }
  return null;
}
