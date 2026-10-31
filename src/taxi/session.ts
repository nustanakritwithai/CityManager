import type { City, Result } from '../sim.ts';
import { MAX_TAXI_DEPOTS } from './buildings.ts';
import { buildTaxiDepot, taxiSiteReason } from './placement.ts';
import type { TaxiDepotSite } from './sites.ts';

/**
 * Taxi depots for the traffic game, persisted in the optional `city.taxi` save section (same
 * pattern as `city.bus`). The section is created on the first placed depot, so cities without
 * taxis still save byte-identical. Ids come from the city id space (`city.nextId`).
 * Kept for older imports; session ids now live in the city id space.
 */
export const TAXI_SESSION_ID_BASE = 1_000_000;
export type TaxiSessionDepot = { id: number; cell: number; level: 1 | 2; open: boolean };

export type TaxiSession = {
  /** Point the session at the active city (after load / new game). Restores its saved depots. */
  bind(city: City): void;
  depots(): TaxiSessionDepot[];
  at(cell: number): TaxiSessionDepot | undefined;
  /** Extra in-memory sites for the traffic game. Always empty: saved depots reach it via `city.taxi`. */
  trafficSites(taxiOn: boolean, trafficOn: boolean): TaxiDepotSite[];
  reason(city: City, cell: number, taxiOn: boolean, trafficOn: boolean): string | null;
  place(city: City, cell: number, taxiOn: boolean, trafficOn: boolean): Result;
  upgrade(id: number): Result;
  toggle(id: number): Result;
  removeAt(cell: number): Result;
  /** Forget the bound city (does not edit it). */
  clear(): void;
};

let playTraffic = false;
/** Traffic-game switch, read by placement preview. The feature stays a no-op while this is false. */
export function setTaxiPlayTraffic(on: boolean): void { playTraffic = on; }
export function taxiPlayTraffic(): boolean { return playTraffic; }
let shared: TaxiSession | undefined;
export function sharedTaxiSession(): TaxiSession { return shared ??= createTaxiSession(); }
export function createTaxiSession(): TaxiSession {
  let bound: City | undefined;
  const list = () => bound?.taxi?.depots ?? [];
  const find = (cell: number) => list().find(d => d.cell === cell);
  const copy = (d: TaxiSessionDepot): TaxiSessionDepot => ({ id: d.id, cell: d.cell, level: d.level, open: d.open });
  const reason = (city: City, cell: number, taxiOn: boolean, trafficOn: boolean): string | null => {
    if (!taxiOn) return 'ระบบแท็กซี่ยังไม่เปิดใช้';
    if (!trafficOn) return 'แท็กซี่มีผลเมื่อเปิดการจราจรจำลองเท่านั้น';
    if (city.taxi?.depots.some(d => d.cell === cell)) return 'มีอู่แท็กซี่อยู่แล้ว';
    if ((city.taxi?.depots.length ?? 0) >= MAX_TAXI_DEPOTS) return `สร้างอู่แท็กซี่ได้สูงสุด ${MAX_TAXI_DEPOTS} แห่ง`;
    return taxiSiteReason(city, cell, true);
  };
  return {
    bind: city => { bound = city; },
    depots: () => list().map(copy),
    at: cell => { const d = find(cell); return d ? copy(d) : undefined; },
    trafficSites: () => [],
    reason,
    place: (city, cell, taxiOn, trafficOn) => {
      bound = city;
      const why = reason(city, cell, taxiOn, trafficOn);
      if (why) return { ok: false, message: why };
      return buildTaxiDepot(city, cell, true);
    },
    upgrade: id => {
      const d = list().find(x => x.id === id);
      if (!d) return { ok: false, message: 'ไม่พบอู่แท็กซี่' };
      if (d.level === 2) return { ok: false, message: 'อู่แท็กซี่อยู่ระดับสูงสุดแล้ว' };
      d.level = 2;
      return { ok: true, message: `ขยายอู่แท็กซี่ #${id} เป็นระดับ 2 · 8 คัน` };
    },
    toggle: id => {
      const d = list().find(x => x.id === id);
      if (!d) return { ok: false, message: 'ไม่พบอู่แท็กซี่' };
      d.open = !d.open;
      return { ok: true, message: `อู่แท็กซี่ #${id} ${d.open ? 'เปิด' : 'ปิด'}บริการ` };
    },
    removeAt: cell => {
      const d = find(cell);
      if (!d || !bound?.taxi) return { ok: false, message: 'ไม่พบอู่แท็กซี่' };
      bound.taxi = { ...bound.taxi, depots: bound.taxi.depots.filter(x => x !== d) };
      return { ok: true, message: `รื้ออู่แท็กซี่ #${d.id} แล้ว` };
    },
    clear: () => { bound = undefined; },
  };
}
