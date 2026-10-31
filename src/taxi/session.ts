import type { City, Result } from '../sim.ts';
import { MAX_TAXI_DEPOTS } from './buildings.ts';
import { taxiSiteReason } from './placement.ts';
import type { TaxiDepotSite } from './sites.ts';

/**
 * Live taxi depots for the traffic game. Kept off City on purpose: the next save must stay
 * byte-identical. Ids sit above the city id space so they cannot collide with saved depots.
 */
export const TAXI_SESSION_ID_BASE = 1_000_000;
export type TaxiSessionDepot = { id: number; cell: number; level: 1 | 2; open: boolean };

export type TaxiSession = {
  depots(): TaxiSessionDepot[];
  at(cell: number): TaxiSessionDepot | undefined;
  /** Sites the traffic game should read. Empty unless both the taxi flag and traffic are on. */
  trafficSites(taxiOn: boolean, trafficOn: boolean): TaxiDepotSite[];
  reason(city: City, cell: number, taxiOn: boolean, trafficOn: boolean): string | null;
  place(city: City, cell: number, taxiOn: boolean, trafficOn: boolean): Result;
  upgrade(id: number): Result;
  toggle(id: number): Result;
  removeAt(cell: number): Result;
  clear(): void;
};

let playTraffic = false;
/** Traffic-game switch, read by placement preview. The feature stays a no-op while this is false. */
export function setTaxiPlayTraffic(on: boolean): void { playTraffic = on; }
export function taxiPlayTraffic(): boolean { return playTraffic; }
let shared: TaxiSession | undefined;
export function sharedTaxiSession(): TaxiSession { return shared ??= createTaxiSession(); }
export function createTaxiSession(): TaxiSession {
  const depots: TaxiSessionDepot[] = [];
  let next = TAXI_SESSION_ID_BASE + 1;
  const find = (cell: number) => depots.find(d => d.cell === cell);
  const copy = (d: TaxiSessionDepot): TaxiSessionDepot => ({ id: d.id, cell: d.cell, level: d.level, open: d.open });
  const reason = (city: City, cell: number, taxiOn: boolean, trafficOn: boolean): string | null => {
    if (!taxiOn) return 'ระบบแท็กซี่ยังไม่เปิดใช้';
    if (!trafficOn) return 'แท็กซี่มีผลเมื่อเปิดการจราจรจำลองเท่านั้น';
    if (find(cell)) return 'มีอู่แท็กซี่อยู่แล้ว';
    if ((city.taxi?.depots.length ?? 0) + depots.length >= MAX_TAXI_DEPOTS) return `สร้างอู่แท็กซี่ได้สูงสุด ${MAX_TAXI_DEPOTS} แห่ง`;
    return taxiSiteReason(city, cell, true);
  };
  return {
    depots: () => depots.map(copy),
    at: cell => { const d = find(cell); return d ? copy(d) : undefined; },
    trafficSites: (taxiOn, trafficOn) => taxiOn && trafficOn ? depots.map(({ id, cell, level, open }) => ({ id, cell, level, open })) : [],
    reason,
    place: (city, cell, taxiOn, trafficOn) => {
      const why = reason(city, cell, taxiOn, trafficOn);
      if (why) return { ok: false, message: why };
      const id = next++;
      depots.push({ id, cell, level: 1, open: true });
      return { ok: true, message: `สร้างอู่แท็กซี่ #${id} แล้ว · 4 คัน · รอบนี้ยังไม่ลงเซฟ` };
    },
    upgrade: id => {
      const d = depots.find(x => x.id === id);
      if (!d) return { ok: false, message: 'ไม่พบอู่แท็กซี่' };
      if (d.level === 2) return { ok: false, message: 'อู่แท็กซี่อยู่ระดับสูงสุดแล้ว' };
      d.level = 2;
      return { ok: true, message: `ขยายอู่แท็กซี่ #${id} เป็นระดับ 2 · 8 คัน` };
    },
    toggle: id => {
      const d = depots.find(x => x.id === id);
      if (!d) return { ok: false, message: 'ไม่พบอู่แท็กซี่' };
      d.open = !d.open;
      return { ok: true, message: `อู่แท็กซี่ #${id} ${d.open ? 'เปิด' : 'ปิด'}บริการ` };
    },
    removeAt: cell => {
      const i = depots.findIndex(d => d.cell === cell);
      if (i < 0) return { ok: false, message: 'ไม่พบอู่แท็กซี่' };
      const [d] = depots.splice(i, 1);
      return { ok: true, message: `รื้ออู่แท็กซี่ #${d.id} แล้ว` };
    },
    clear: () => { depots.length = 0; },
  };
}
