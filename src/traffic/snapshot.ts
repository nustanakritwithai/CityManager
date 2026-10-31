import { GATEWAY, connectedRoads, firmCapacity, type City } from '../sim.ts';
import { parcelTrafficZone } from './network.ts';
import { accessCell } from '../traffic-plan.ts';
import type { DemandInput, DemandSource } from './types.ts';
/** Days of goods ledger averaged into daily freight units. */
export const FREIGHT_WINDOW_DAYS = 7;
/**
 * Read-only City → DemandInput. Every source is snapped to its access road cell (parcels with no
 * connected road are skipped in the legacy adapter). stableParcelZones retains inaccessible
 * sources under stable parcel IDs for the conserved gameplay model. Never mutates the city.
 */
export function cityDemandInput(c: City, stableParcelZones = false): DemandInput {
  const roads = connectedRoads(c), byId = new Map(c.buildings.map(b => [b.id, b]));
  const add = (list: Map<number, number>, cell: number | undefined, amount: number) => {
    if (cell == null || amount <= 0) return; const a = stableParcelZones ? parcelTrafficZone(cell) : accessCell(roads, cell); if (a != null) list.set(a, (list.get(a) ?? 0) + amount);
  };
  const homes = new Map<number, number>(), jobs = new Map<number, number>(), seats = new Map<number, number>(), parks = new Map<number, number>(), freight = new Map<number, number>();
  for (const h of c.households) {
    if (h.home != null) add(homes, byId.get(h.home)?.cell, h.members);
    else if (stableParcelZones) homes.set(1152 + h.id, (homes.get(1152 + h.id) ?? 0) + h.members);
  }
  const since = c.tick - FREIGHT_WINDOW_DAYS, moved = new Map<string, number>();
  for (let i = c.goodsLedger.length - 1; i >= 0 && c.goodsLedger[i].tick > since; i--) {
    const e = c.goodsLedger[i]; for (const w of [e.from, e.to]) moved.set(w, (moved.get(w) ?? 0) + e.quantity);
  }
  for (const f of c.firms) {
    const b = byId.get(f.building); if (!b) continue;
    add(jobs, b.cell, firmCapacity(b, f));
    add(freight, b.cell, (moved.get(f.wallet) ?? 0) / FREIGHT_WINDOW_DAYS);
  }
  for (const k of c.education?.campuses ?? []) if (k.kind === 'school' && k.open) add(seats, k.cell, k.report.operatingSeats);
  for (const p of c.parks) add(parks, p.cell, 1);
  const list = (m: Map<number, number>): DemandSource[] => [...m].sort((a, b) => a[0] - b[0]).map(([cell, amount]) => ({ cell, amount }));
  return { households: list(homes), jobs: list(jobs), schoolSeats: list(seats), parks: list(parks), freight: list(freight), entrance: stableParcelZones ? parcelTrafficZone(GATEWAY) : accessCell(roads, GATEWAY) ?? GATEWAY };
}
