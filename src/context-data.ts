import { access, MONTH, summary, housingCapacity, homeOccupancy } from './sim.ts';
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
  population: number;
  households: number;
  workforce: number;
  dependents: number;
  employed: number;
  unemployed: number;
  homeless: number;
  homelessPersons: number;
  homeSlots: number;
  personCapacity: number;
  occupiedHomeSlots: number;
  occupiedPersons: number;
  housingVacancy: number;
  personVacancy: number;
  legacyHouseholds: number;
  legacyAssumedPersons: number;
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

/** Resolve only the selected parcel's real building and its actual households. */
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

/** Exact wallet endpoints only; preserve original journal indices and order. */
export function relatedFlows(city: City, kind: FlowKind, wallet: string): FlowRow[] {
  return flowRows(city, kind).filter(row => row.from === wallet || row.to === wallet);
}

/** Current people/housing stocks are separate from inclusive 30-day journal flows. */
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
  let homeSlots = 0, personCapacity = 0, occupiedHomeSlots = 0, occupiedPersons = 0;
  for (const building of city.buildings.filter(building => building.zone === 'R')) {
    const capacity = housingCapacity(building), occupied = homeOccupancy(city, building.id);
    homeSlots += capacity.households; personCapacity += capacity.persons;
    occupiedHomeSlots += occupied.households; occupiedPersons += occupied.persons;
  }
  const displaced = city.households.filter(household => household.home === null);
  const homelessPersons = displaced.reduce((total, household) => total + household.members, 0);
  const legacy = city.households.filter(household => household.origin === 'legacy-v1');
  if (!city.utilities.power) warnings.push('แหล่งจ่ายไฟฟ้าภายนอกไม่พร้อม การผลิตและการเติบโตถูกระงับ');
  if (!city.utilities.water) warnings.push('แหล่งจ่ายน้ำภายนอกไม่พร้อม การผลิตและการเติบโตถูกระงับ');
  if (current.unemployed) warnings.push(`มีแรงงาน ${current.unemployed} คนที่ยังไม่ได้รับการจัดสรรงาน`);
  if (displaced.length) warnings.push(`มี ${displaced.length} ครัวเรือน รวม ${homelessPersons} คนที่ยังไม่มีบ้านพัก`);
  const noPurchase = city.households.filter(household => household.lastPurchaseTick !== city.tick).length;
  if (noPurchase) warnings.push(`มี ${noPurchase} ครัวเรือนที่ยังไม่ได้ซื้อสินค้าในวันนี้`);
  const disconnected = city.buildings.filter(building => !access(city, building.cell)).length;
  if (disconnected) warnings.push(`มี ${disconnected} อาคารที่ไม่มีถนนเชื่อมถึงทางออกเมือง`);
  if (city.accounts.treasury === 0) warnings.push('เงินคลังเมืองหมด การลงทุนใหม่ต้องมีเงินเพียงพอ');
  return {
    fromTick, toTick,
    treasury: city.accounts.treasury,
    income, expense, net: income - expense,
    population: current.population,
    households: current.households,
    workforce: current.workforce,
    dependents: current.dependents,
    employed: current.employed,
    unemployed: current.unemployed,
    homeless: displaced.length,
    homelessPersons,
    homeSlots, personCapacity, occupiedHomeSlots, occupiedPersons,
    housingVacancy: homeSlots - occupiedHomeSlots,
    personVacancy: personCapacity - occupiedPersons,
    legacyHouseholds: legacy.length,
    legacyAssumedPersons: legacy.reduce((total, household) => total + household.members, 0),
    jobs: current.jobs,
    firms: city.firms.length,
    inventory: city.firms.reduce((total, firm) => total + firm.inventory, 0),
    produced, imported, consumed, exported,
    warnings,
    power: city.utilities.power,
    water: city.utilities.water,
  };
}
