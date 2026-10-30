import { connectedRoads, SIZE, campusAt, parkAt, plantAt, type City, type Result } from '../sim.ts';
import { createTaxi, taxiAt, taxiEnabled, MAX_TAXI_DEPOTS, MAX_TAXI_STANDS, type TaxiDepot } from './buildings.ts';
/** Placement for taxi depots and stands. Round 1: no build cost, no upkeep, no economy effect. */
const neighbours = (i: number) => [i % SIZE ? i - 1 : -1, i % SIZE < SIZE - 1 ? i + 1 : -1, i - SIZE, i + SIZE].filter(n => n >= 0 && n < SIZE * SIZE);
const canAllocateId = (c: City) => Number.isSafeInteger(c.nextId) && c.nextId >= 1 && c.nextId <= Number.MAX_SAFE_INTEGER - 3;
/** Same rule as campuses: empty, unzoned lot beside a road connected to the city gate. */
export function taxiSiteReason(c: City, i: number, kind: 'depot' | 'stand', enabled = taxiEnabled()): string | null {
  if (!enabled) return 'ระบบแท็กซี่ยังไม่เปิดใช้';
  if (!Number.isInteger(i) || i < 0 || i >= SIZE * SIZE) return 'ตำแหน่งอยู่นอกแผนที่';
  const cell = c.cells[i];
  if (cell.road || cell.zone !== null || cell.building !== null || plantAt(c, i) || parkAt(c, i) || campusAt(c, i) || taxiAt(c, i)) return 'จุดบริการแท็กซี่ต้องใช้แปลงว่างที่ยังไม่ลงโซน';
  if (!neighbours(i).some(n => connectedRoads(c).has(n))) return 'ต้องติดถนนที่เชื่อมถึงประตูเมือง';
  const have = kind === 'depot' ? c.taxi?.depots.length ?? 0 : c.taxi?.stands.length ?? 0;
  if (have >= (kind === 'depot' ? MAX_TAXI_DEPOTS : MAX_TAXI_STANDS) || !canAllocateId(c)) return kind === 'depot' ? `สร้างอู่แท็กซี่ได้สูงสุด ${MAX_TAXI_DEPOTS} แห่ง` : `สร้างจุดจอดแท็กซี่ได้สูงสุด ${MAX_TAXI_STANDS} แห่ง`;
  return null;
}
function place(c: City, i: number, kind: 'depot' | 'stand', enabled: boolean): Result {
  const reason = taxiSiteReason(c, i, kind, enabled);
  if (reason) return { ok: false, message: reason };
  const taxi = c.taxi ?? createTaxi(), id = c.nextId++;
  if (kind === 'depot') taxi.depots.push({ id, cell: i, tick: c.tick, level: 1, open: true });
  else taxi.stands.push({ id, cell: i, tick: c.tick, open: true });
  c.taxi = taxi;
  c.lastEvent = kind === 'depot' ? `สร้างอู่แท็กซี่ #${id} แล้ว · 4 คัน · รอบแรกไม่มีค่าใช้จ่าย` : `สร้างจุดจอดแท็กซี่ #${id} แล้ว · 2 ช่องจอด`;
  return { ok: true, message: c.lastEvent };
}
export const buildTaxiDepot = (c: City, i: number, enabled = taxiEnabled()) => place(c, i, 'depot', enabled);
export const buildTaxiStand = (c: City, i: number, enabled = taxiEnabled()) => place(c, i, 'stand', enabled);
const depot = (c: City, id: number): TaxiDepot | undefined => c.taxi?.depots.find(d => d.id === id);
export function upgradeTaxiDepot(c: City, id: number, enabled = taxiEnabled()): Result {
  const d = depot(c, id);
  if (!enabled || !d) return { ok: false, message: 'ไม่พบอู่แท็กซี่' };
  if (d.level === 2) return { ok: false, message: 'อู่แท็กซี่อยู่ระดับสูงสุดแล้ว' };
  d.level = 2; c.lastEvent = `ขยายอู่แท็กซี่ #${id} เป็นระดับ 2 · 8 คัน`; return { ok: true, message: c.lastEvent };
}
export function toggleTaxiDepot(c: City, id: number, enabled = taxiEnabled()): Result {
  const d = depot(c, id);
  if (!enabled || !d) return { ok: false, message: 'ไม่พบอู่แท็กซี่' };
  d.open = !d.open; c.lastEvent = `อู่แท็กซี่ #${id} ${d.open ? 'เปิด' : 'ปิด'}บริการ`; return { ok: true, message: c.lastEvent };
}
