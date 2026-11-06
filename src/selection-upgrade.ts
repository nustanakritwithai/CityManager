import { campusAt, plantAt, plantUpgradeStatus, treasurySpendable, upgradeCampus, upgradePlant, type City, type Result } from './sim.ts';
import { EDUCATION_COST } from './education.ts';
import type { TaxiSession } from './taxi/session.ts';
import { busDepotAt, busStopAt } from './bus/buildings.ts';
import { upgradeBusDepot, upgradeBusStop } from './bus/placement.ts';

export type UpgradeQuote = { key: string; name: string; level: number; cost: number; maximum?: boolean; reason: string; run: () => Result };
const max = 'ถึงระดับสูงสุดแล้ว';
/** Quotes are read-only. Commands retain their original spending and feature contracts. */
export function selectionUpgrade(city: City, cell: number, taxi: TaxiSession | null, bus: boolean): UpgradeQuote | null {
  const plant = plantAt(city, cell);
  if (plant) {
    const quote = plantUpgradeStatus(city, plant.id)!;
    return { key: `plant:${plant.id}`, name: plant.kind === 'power' ? 'โรงไฟฟ้า' : 'โรงสูบน้ำ', level: quote.level, cost: quote.next?.upgradeCost ?? 0, maximum: !quote.next, reason: quote.reasons.join(' · '), run: () => upgradePlant(city, plant.id, quote.level) };
  }
  const campus = campusAt(city, cell);
  if (campus) {
    const cost = EDUCATION_COST[campus.kind].upgrade;
    const reason = campus.level >= 2 ? max : campus.kind === 'university' && (city.education?.residentHigher ?? 0) < 1 ? 'ต้องมีผู้ถือวุฒิขั้นสูงในเมือง' : treasurySpendable(city) < cost ? 'เงินคลังไม่พอ' : '';
    return { key: `campus:${campus.id}`, name: campus.kind === 'school' ? 'โรงเรียน' : 'มหาวิทยาลัย', level: campus.level, cost, reason, run: () => upgradeCampus(city, campus.id) };
  }
  const depot = taxi?.at(cell);
  if (depot) return { key: `taxi:${depot.id}`, name: 'อู่แท็กซี่', level: depot.level, cost: 0, reason: depot.level >= 2 ? max : '', run: () => taxi!.upgrade(depot.id) };
  const busDepot = bus ? busDepotAt(city, cell) : undefined;
  if (busDepot) return { key: `bus-depot:${busDepot.id}`, name: 'อู่รถเมล์', level: busDepot.level, cost: 0, reason: busDepot.level >= 3 ? max : '', run: () => upgradeBusDepot(city, busDepot.id, bus) };
  const stop = bus ? busStopAt(city, cell) : undefined;
  if (stop) return { key: `bus-stop:${stop.id}`, name: 'ป้ายรถเมล์', level: stop.level, cost: 0, reason: stop.level >= 2 ? max : '', run: () => upgradeBusStop(city, stop.id, bus) };
  // Private housing/business and parks grow automatically; rail has no manual upgrade.
  return null;
}
