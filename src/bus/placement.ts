import { connectedRoads, SIZE, campusAt, parkAt, plantAt, type City, type Result } from '../sim.ts';
import { taxiAt } from '../taxi/buildings.ts';
import { busDepotAt, busStopAt, busStopReason, busStopSides, createBus, removeBusDepotFromState, removeStopsFromState } from './buildings.ts';
import { BUS_DEPOT_BUSES, BUS_LIMITS, busEnabled, type BusDepot, type BusStopSide } from './types.ts';
/** Placement for bus depots and stops (PR B2). Round 1: no build cost, no upkeep, no economy effect. */
const neighbours = (i: number) => [i % SIZE ? i - 1 : -1, i % SIZE < SIZE - 1 ? i + 1 : -1, i - SIZE, i + SIZE].filter(n => n >= 0 && n < SIZE * SIZE);
const canAllocateId = (c: City) => Number.isSafeInteger(c.nextId) && c.nextId >= 1 && c.nextId <= Number.MAX_SAFE_INTEGER - 3;
const OFF = 'ระบบรถเมล์ยังไม่เปิดใช้';
/** Same rule as campuses / taxi depots: empty, unzoned lot beside a road connected to the city gate. */
export function busDepotReason(c: City, i: number, enabled = busEnabled()): string | null {
  if (!enabled) return OFF;
  if (!Number.isInteger(i) || i < 0 || i >= SIZE * SIZE) return 'ตำแหน่งอยู่นอกแผนที่';
  const cell = c.cells[i];
  if (cell.road || cell.zone !== null || cell.building !== null || plantAt(c, i) || parkAt(c, i) || campusAt(c, i) || taxiAt(c, i) || busDepotAt(c, i)) return 'อู่รถเมล์ต้องใช้แปลงว่างที่ยังไม่ลงโซน';
  if (!neighbours(i).some(n => connectedRoads(c).has(n))) return 'ต้องติดถนนที่เชื่อมถึงประตูเมือง';
  if ((c.bus?.depots.length ?? 0) >= BUS_LIMITS.depots || !canAllocateId(c)) return `สร้างอู่รถเมล์ได้สูงสุด ${BUS_LIMITS.depots} แห่ง`;
  return null;
}
export function buildBusDepot(c: City, i: number, enabled = busEnabled()): Result {
  const reason = busDepotReason(c, i, enabled); if (reason) return { ok: false, message: reason };
  const bus = c.bus ?? createBus(), id = c.nextId++;
  bus.depots.push({ id, cell: i, level: 1, open: true, tick: c.tick }); c.bus = bus;
  c.lastEvent = `สร้างอู่รถเมล์ #${id} แล้ว · จุ ${BUS_DEPOT_BUSES[1]} คัน · รอบแรกไม่มีค่าใช้จ่าย`;
  return { ok: true, message: c.lastEvent };
}
const depot = (c: City, id: number): BusDepot | undefined => c.bus?.depots.find(d => d.id === id);
export function upgradeBusDepot(c: City, id: number, enabled = busEnabled()): Result {
  const d = depot(c, id); if (!enabled || !d) return { ok: false, message: 'ไม่พบอู่รถเมล์' };
  if (d.level === 3) return { ok: false, message: 'อู่รถเมล์อยู่ระดับสูงสุดแล้ว' };
  d.level = (d.level + 1) as 2 | 3; c.lastEvent = `ขยายอู่รถเมล์ #${id} เป็นระดับ ${d.level} · จุ ${BUS_DEPOT_BUSES[d.level]} คัน`; return { ok: true, message: c.lastEvent };
}
export function toggleBusDepot(c: City, id: number, enabled = busEnabled()): Result {
  const d = depot(c, id); if (!enabled || !d) return { ok: false, message: 'ไม่พบอู่รถเมล์' };
  d.open = !d.open; c.lastEvent = `อู่รถเมล์ #${id} ${d.open ? 'เปิด' : 'ปิด'}บริการ`; return { ok: true, message: c.lastEvent };
}
/** Remove a depot (lines move to the lowest-id other depot, else refused). Works with the flag off. */
export function removeBusDepot(c: City, id: number): Result {
  if (!c.bus) return { ok: false, message: 'ไม่พบอู่รถเมล์' };
  const r = removeBusDepotFromState(c.bus, id); if (r.ok) c.lastEvent = r.message; return r;
}
/** Default kerb side for a cell: first allowed of n/e/s/w (deterministic). */
export function defaultBusStopSide(c: City, i: number): BusStopSide | null { const s = busStopSides(c, i, SIZE); return 'sides' in s ? s.sides[0] : null; }
export function busStopSiteReason(c: City, i: number, side: BusStopSide | null = defaultBusStopSide(c, i), enabled = busEnabled()): string | null {
  if (!enabled) return OFF;
  if (!Number.isInteger(i) || i < 0 || i >= SIZE * SIZE) return 'ตำแหน่งอยู่นอกแผนที่';
  if ((c.bus?.stops.length ?? 0) >= BUS_LIMITS.stops || !canAllocateId(c)) return `วางป้ายรถเมล์ได้สูงสุด ${BUS_LIMITS.stops} ป้าย`;
  if (busStopAt(c, i)) return 'มีป้ายรถเมล์อยู่แล้ว';
  if (!side) { const s = busStopSides(c, i, SIZE); return 'reason' in s ? s.reason : 'ด้านของป้ายไม่ถูกต้อง'; }
  return busStopReason(c, i, side, SIZE);
}
export function buildBusStop(c: City, i: number, side: BusStopSide | null = defaultBusStopSide(c, i), enabled = busEnabled()): Result {
  const reason = busStopSiteReason(c, i, side, enabled); if (reason) return { ok: false, message: reason };
  const bus = c.bus ?? createBus(), id = c.nextId++;
  bus.stops.push({ id, cell: i, side: side!, level: 1 }); c.bus = bus;
  c.lastEvent = `วางป้ายรถเมล์ #${id} แล้ว`; return { ok: true, message: c.lastEvent };
}
export function upgradeBusStop(c: City, id: number, enabled = busEnabled()): Result {
  const s = c.bus?.stops.find(x => x.id === id); if (!enabled || !s) return { ok: false, message: 'ไม่พบป้ายรถเมล์' };
  if (s.level === 2) return { ok: false, message: 'ป้ายรถเมล์เป็นศาลาแล้ว' };
  s.level = 2; c.lastEvent = `ยกระดับป้ายรถเมล์ #${id} เป็นศาลา`; return { ok: true, message: c.lastEvent };
}
/** Remove a stop; it is also removed from every line (adjacent duplicates collapse). */
export function removeBusStop(c: City, id: number): Result {
  const b = c.bus; if (!b || !b.stops.some(s => s.id === id)) return { ok: false, message: 'ไม่พบป้ายรถเมล์' };
  const lines = b.lines.filter(l => l.stopIds.includes(id)).length;
  removeStopsFromState(b, new Set([id]));
  c.lastEvent = `ลบป้ายรถเมล์ #${id} แล้ว${lines ? ` · ออกจาก ${lines} สาย` : ''}`; return { ok: true, message: c.lastEvent };
}
