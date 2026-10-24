import { access, MONTH, summary } from './sim.ts';
import type { Building, City, Firm, Household } from './sim.ts';
import { flowRows } from './inspector-data.ts';
import type { FlowKind, FlowRow } from './inspector-data.ts';

export type ResolvedPlace = {
  cell: number;
  building: Building | null;
  households: Household[];
  firm: Firm | null;
};

export type CityOverview = {
  fromTick: number;
  toTick: number;
  treasury: number;
  income: number;
  expense: number;
  net: number;
  households: number;
  employed: number;
  jobs: number;
  firms: number;
  inventory: number;
  produced: number;
  imported: number;
  consumed: number;
  exported: number;
  warnings: string[];
  power: boolean;
  water: boolean;
};

/** Resolve only the selected parcel's real building and its actual occupants. */
export function resolvePlace(city: City, cell: number): ResolvedPlace {
  const parcel = Number.isInteger(cell) ? city.cells[cell] : undefined;
  const building = parcel?.building == null ? null : city.buildings.find(b => b.id === parcel.building && b.cell === cell) ?? null;
  return {
    cell,
    building,
    households: building ? city.households.filter(h => h.home === building.id) : [],
    firm: building ? city.firms.find(f => f.building === building.id) ?? null : null,
  };
}

/** No substring matching, inferred counterparties, reindexing or global journal leaks. */
export function relatedFlows(city: City, kind: FlowKind, wallet: string): FlowRow[] {
  return flowRows(city, kind).filter(row => row.from === wallet || row.to === wallet);
}

/** Current stocks/counts plus actual journal flows for the inclusive 30-calendar-day window. */
export function cityOverview(city: City): CityOverview {
  const fromTick = Math.max(0, city.tick - MONTH + 1), toTick = city.tick;
  const inPeriod = (tick: number) => tick >= fromTick && tick <= toTick;
  let income = 0, expense = 0, produced = 0, imported = 0, consumed = 0, exported = 0;
  for (const entry of city.ledger) {
    if (!inPeriod(entry.tick)) continue;
    if (entry.to === 'treasury') income += entry.amount;
    if (entry.from === 'treasury') expense += entry.amount;
  }
  for (const entry of city.goodsLedger) {
    if (!inPeriod(entry.tick)) continue;
    switch (entry.reason) {
      case 'Daily worker production': produced += entry.quantity; break;
      case 'Imported shop stock': imported += entry.quantity; break;
      case 'Household final consumption': consumed += entry.quantity; break;
      case 'Exported goods': exported += entry.quantity; break;
    }
  }
  const current = summary(city), warnings: string[] = [];
  if (!city.utilities.power) warnings.push('แหล่งจ่ายไฟฟ้าภายนอกไม่พร้อม การผลิตและการเติบโตถูกระงับ');
  if (!city.utilities.water) warnings.push('แหล่งจ่ายน้ำภายนอกไม่พร้อม การผลิตและการเติบโตถูกระงับ');
  const unemployed = city.households.filter(h => h.employer === null).length;
  if (unemployed) warnings.push(`มี ${unemployed} ครัวเรือนที่ยังไม่มีงาน`);
  const noPurchase = city.households.filter(h => h.lastPurchaseTick !== city.tick).length;
  if (noPurchase) warnings.push(`มี ${noPurchase} ครัวเรือนที่ยังไม่ได้ซื้อสินค้าในวันนี้`);
  const disconnected = city.buildings.filter(b => !access(city, b.cell)).length;
  if (disconnected) warnings.push(`มี ${disconnected} อาคารที่ไม่มีถนนเชื่อมถึงทางออกเมือง`);
  if (city.accounts.treasury === 0) warnings.push('เงินคลังเมืองหมด การลงทุนใหม่ต้องมีเงินเพียงพอ');
  return {
    fromTick, toTick,
    treasury: city.accounts.treasury,
    income, expense, net: income - expense,
    households: city.households.length,
    employed: current.employed,
    jobs: current.jobs,
    firms: city.firms.length,
    inventory: city.firms.reduce((total, firm) => total + firm.inventory, 0),
    produced, imported, consumed, exported,
    warnings,
    power: city.utilities.power,
    water: city.utilities.water,
  };
}
