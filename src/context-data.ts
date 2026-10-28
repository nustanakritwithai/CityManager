import { access, MONTH, summary, housingCapacity, homeOccupancy, industryGrowthStatus, utilityStatus } from './sim.ts';
import type { Building, City, Firm, Household } from './sim.ts';
import type { EmploymentAllocation, WorkerSkill } from './labor.ts';
import { flowRows } from './inspector-data.ts';
import type { FlowKind, FlowRow } from './inspector-data.ts';

export type ResolvedPlace = {
  cell: number;
  building: Building | null;
  households: Household[];
  firm: Firm | null;
};

export const WORKER_SKILL_LABELS: Readonly<Record<WorkerSkill, string>> = Object.freeze({ general: 'ทั่วไป', manufacturing: 'การผลิต', retail: 'ค้าปลีก' });
export const WORKER_SKILL_ROLES: Readonly<Record<WorkerSkill, string>> = Object.freeze({ general: 'ผลิต / เกษตร / ค้าปลีก / ทำตลาดเอง', manufacturing: 'งานผลิต / เกษตร', retail: 'งานค้าปลีก / ทำตลาดเอง' });
export type SkillWorkforce = { skill: WorkerSkill; total: number; employed: number; unemployed: number };

/** Disjoint worker pools; neither dependents nor whole-family counts are jobs. */
export function householdLabor(city: City, id: number): {
  householdId: number; workforce: number; employed: number; unemployed: number;
  employers: number; employeeWorkers: number; selfEmployedWorkers: number; skillSource: Household['skillSource'];
  skills: SkillWorkforce[]; allocations: EmploymentAllocation[]; ownerAllocations: City['ownerLabor'];
} | null {
  const household = city.households.find(value => value.id === id);
  if (!household) return null;
  const allocations = city.employment.filter(value => value.householdId === id).map(value => ({ ...value }));
  const ownerAllocations = city.ownerLabor.filter(value => value.householdId === id).map(value => ({ ...value }));
  const skills = (['general', 'manufacturing', 'retail'] as const).map(skill => {
    const total = household.workerSkills[skill], employed = [...allocations, ...ownerAllocations].filter(value => value.skill === skill).reduce((sum, value) => sum + value.workers, 0);
    return { skill, total, employed, unemployed: total - employed };
  });
  const employeeWorkers = allocations.reduce((sum, value) => sum + value.workers, 0), selfEmployedWorkers = ownerAllocations.reduce((sum, value) => sum + value.workers, 0), employed = employeeWorkers + selfEmployedWorkers;
  return { householdId: id, workforce: household.workforce, employed, unemployed: household.workforce - employed,
    employers: new Set([...allocations, ...ownerAllocations].map(value => value.firmId)).size, employeeWorkers, selfEmployedWorkers, skillSource: household.skillSource, skills, allocations, ownerAllocations };
}

/** Group this establishment's workers by their shared household account once. */
export function firmLabor(city: City, id: number): {
  firmId: number; workers: number; householdCount: number;
  employeeWorkers: number; ownerWorkers: number;
  households: { householdId: number; workers: number; allocations: EmploymentAllocation[]; ownerAllocations: City['ownerLabor'] }[];
} | null {
  if (!city.firms.some(value => value.id === id)) return null;
  const own = city.employment.filter(value => value.firmId === id), groups = new Map<number, EmploymentAllocation[]>();
  for (const allocation of own) {
    const rows = groups.get(allocation.householdId) ?? []; rows.push({ ...allocation }); groups.set(allocation.householdId, rows);
  }
  const owners = city.ownerLabor.filter(value => value.firmId === id);
  for (const owner of owners) if (!groups.has(owner.householdId)) groups.set(owner.householdId, []);
  const households = [...groups].map(([householdId, allocations]) => {
    const ownerAllocations = owners.filter(value => value.householdId === householdId).map(value => ({ ...value }));
    return { householdId, workers: [...allocations, ...ownerAllocations].reduce((sum, value) => sum + value.workers, 0), allocations, ownerAllocations };
  });
  const employeeWorkers = own.reduce((sum, value) => sum + value.workers, 0), ownerWorkers = owners.reduce((sum, value) => sum + value.workers, 0);
  return { firmId: id, workers: employeeWorkers + ownerWorkers, employeeWorkers, ownerWorkers, householdCount: households.length, households };
}

/** Same-tick pool/role edits and moves invalidate an entity view without a fake tick. */
export function contextRevision(city: City): string {
  return JSON.stringify([city.version, city.rulesVersion, city.tick, city.ledger.length, city.goodsLedger.length, city.utilities, city.migration,
    city.households.map(h => [h.id, h.home, h.members, h.workforce, h.dependents, h.profile, h.origin, h.skillSource, h.workerSkills, h.needs, h.lastPurchaseTick, city.accounts[h.wallet]]),
    city.employment.map(a => [a.householdId, a.firmId, a.occupation, a.rank, a.skill, a.workers]),
    city.ownerLabor, city.resources, city.crops, city.cropLedger.length, city.cropLedger.at(-1),
    city.buildings.map(b => [b.id, b.cell, b.zone, b.level, b.age, 'housingType' in b ? b.housingType : null]),
    city.firms.map(f => [f.id, f.building, f.zone, f.cropMode, f.cropChoices, f.crops, f.commercialKind, f.inventory, f.cropInventory, f.cropCost, f.productionTick, f.owner, f.fundedBy, f.profit, f.monthlyRevenue, f.monthlyExpense, f.lastMonthProfit, f.workDays, city.accounts[f.wallet]])]);
}

/** Read-only Thai presentation of the simulator's actual expansion decision. */
export function growthStatusText(city: City) {
  const status = industryGrowthStatus(city);
  const labels: Record<string, string> = {
    'growth.outside-investor': `ฟาร์มส่งออกพืชผลที่โรงงานในเมืองใช้ไม่ทัน ${status.exportedCrops} ล็อตใน 30 วัน ผู้ลงทุนภายนอกพร้อมเปิดโรงงานใหม่ในแปลงที่ผ่านเงื่อนไข (เดือนละไม่เกิน 1 แห่ง)`,
    'growth.bootstrap': 'โรงงานแรกเริ่มได้ด้วยทุนภายนอกที่บันทึกคู่บัญชี ก่อนรับแรงงานตามกติกาเริ่มเมือง',
    'growth.ready': `กิจการ #${status.sponsorFirmId} มีทุนที่ใช้ขยายได้ ${formatGrowthCash(status.availableCapital)} บาท พร้อมเปิดโรงงานในแปลงที่ผ่านเงื่อนไข`,
    'growth.utilities-unavailable': 'น้ำหรือไฟภายนอกยังไม่พร้อม การเปิดกิจการเพิ่มถูกระงับ',
    'growth.no-industrial-parcel': 'ยังไม่มีแปลง I ว่างที่เชื่อมถนนถึงทางออกเมือง วางโซนโรงงานข้างถนนก่อน',
    'growth.vacancies-remain': `มีงานว่างที่สำรองค่าจ้างได้ ${status.fundedVacancies} ตำแหน่ง ให้รับแรงงานในงานที่มีอยู่ก่อนเปิดโรงงานเพิ่ม`,
    'growth.housing-unavailable': 'ต้องมีบ้านที่รับครัวเรือนได้ หรือแปลงบ้านว่างที่เชื่อมเมือง ก่อนเพิ่มโอกาสงาน',
    'growth.no-crop-buffer': 'พืชผลที่เข้าถึงได้ยังไม่พอเริ่มการผลิตเพิ่ม ตรวจฟาร์ม แรงงาน และถนนก่อน ไม่สร้างวัตถุดิบขึ้นเอง',
    'growth.no-profitable-sponsor': 'ยังไม่มีโรงงานที่ทำกำไรและผ่านเงื่อนไขลงทุนเพิ่ม ตรวจการผลิต ยอดขาย แรงงาน และภาระกิจการเดิม',
    'growth.saving-capital': `โรงงานกำลังสะสมทุนขยาย: ใช้ได้ ${formatGrowthCash(status.availableCapital)} / ต้องมี ${formatGrowthCash(status.requiredCapital)} บาท หลังกันภาระและเงินหมุนเวียน`,
  };
  return { status, message: labels[status.code] ?? 'ยังไม่ผ่านเงื่อนไขขยายโรงงาน ตรวจข้อมูลจริงในรายละเอียดเงินทุน' };
}
const formatGrowthCash = (amount: number) => (amount / 100).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Latest recorded basket, not a guessed commodity from a household timestamp. */
export function householdConsumption(city: City, id: number): { commodity: 'goods' | 'crops'; tick: number; quantity: number } | null {
  const household = city.households.find(value => value.id === id); if (!household) return null;
  let latest: { commodity: 'goods' | 'crops'; tick: number; quantity: number } | null = null;
  for (const entry of city.goodsLedger) if (entry.to === household.wallet && entry.reason === 'Household final consumption' && (!latest || entry.tick > latest.tick)) latest = { commodity: 'goods', tick: entry.tick, quantity: entry.quantity };
  for (const entry of city.cropLedger) if (entry.to === household.wallet && entry.kind === 'consumption' && (!latest || entry.tick > latest.tick)) latest = { commodity: 'crops', tick: entry.tick, quantity: entry.quantity };
  return latest;
}

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
  cropInventory: number;
  cropCost: number;
  cropHarvested: number;
  cropProcessed: number;
  cropConsumed: number;
  cropWrittenOff: number;
  employeeWorkers: number;
  selfEmployedWorkers: number;
  produced: number;
  imported: number;
  consumed: number;
  exported: number;
  warnings: string[];
  power: boolean;
  utility: { powerUsed: number; powerCapacity: number; waterUsed: number; waterCapacity: number; plants: number };
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
      default: if (/^Crop recipe #\d+$/.test(entry.reason)) produced += entry.quantity;
    }
  }
  const current = summary(city), warnings: string[] = [];
  let cropHarvested = 0, cropProcessed = 0, cropConsumed = 0, cropWrittenOff = 0;
  for (const entry of city.cropLedger) {
    if (!inPeriod(entry.tick)) continue;
    if (entry.kind === 'harvest') cropHarvested += entry.quantity;
    else if (entry.kind === 'process') cropProcessed += entry.quantity;
    else if (entry.kind === 'consumption') cropConsumed += entry.quantity;
    else if (entry.kind === 'writeoff') cropWrittenOff += entry.quantity;
  }
  let homeSlots = 0, personCapacity = 0, occupiedHomeSlots = 0, occupiedPersons = 0;
  for (const building of city.buildings.filter(building => building.zone === 'R')) {
    const capacity = housingCapacity(building), occupied = homeOccupancy(city, building.id);
    homeSlots += capacity.households; personCapacity += capacity.persons;
    occupiedHomeSlots += occupied.households; occupiedPersons += occupied.persons;
  }
  const displaced = city.households.filter(household => household.home === null);
  const homelessPersons = displaced.reduce((total, household) => total + household.members, 0);
  const legacy = city.households.filter(household => household.origin === 'legacy-v1');
  const utility = utilityStatus(city);
  if (!utility.power) warnings.push(`ไฟฟ้าไม่พอ อาคาร ${utility.unserved.power} แห่งที่ไกลสุดไม่มีไฟ งาน การผลิต และการเติบโตของอาคารเหล่านั้นหยุด สร้างโรงไฟฟ้าริมถนน`);
  if (!utility.water) warnings.push(`น้ำไม่พอ อาคาร ${utility.unserved.water} แห่งที่ไกลสุดไม่มีน้ำ งาน การผลิต และการเติบโตของอาคารเหล่านั้นหยุด สร้างโรงสูบน้ำริมถนน`);
  if (current.unemployed) warnings.push(`มีแรงงาน ${current.unemployed} คนที่ยังไม่ได้รับการจัดสรรงาน`);
  if (displaced.length) warnings.push(`มี ${displaced.length} ครัวเรือน รวม ${homelessPersons} คนที่ยังไม่มีบ้านพัก`);
  const foodByHousehold = new Map<string, number>();
  for (const e of city.goodsLedger) if (e.tick === city.tick && e.reason === 'Household final consumption') foodByHousehold.set(e.to, (foodByHousehold.get(e.to) ?? 0) + e.quantity);
  for (const e of city.cropLedger) if (e.tick === city.tick && e.kind === 'consumption') foodByHousehold.set(e.to, (foodByHousehold.get(e.to) ?? 0) + e.quantity);
  const missingFood = city.households.reduce((sum, h) => sum + Math.max(0, h.members - (foodByHousehold.get(h.wallet) ?? 0)), 0);
  if (city.tick > 0 && missingFood) warnings.push(`วันนี้ยังขาดอาหาร ${missingFood} หน่วยสำหรับสมาชิกครัวเรือน`);
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
    cropInventory: city.firms.reduce((total, firm) => total + firm.cropInventory, 0),
    cropCost: city.firms.reduce((total, firm) => total + firm.cropCost, 0),
    cropHarvested, cropProcessed, cropConsumed, cropWrittenOff,
    employeeWorkers: city.employment.reduce((sum, allocation) => sum + allocation.workers, 0),
    selfEmployedWorkers: city.ownerLabor.reduce((sum, allocation) => sum + allocation.workers, 0),
    produced, imported, consumed, exported,
    warnings,
    power: utility.power,
    water: utility.water,
    utility: { powerUsed: utility.used.power, powerCapacity: utility.capacity.power, waterUsed: utility.used.water, waterCapacity: utility.capacity.water, plants: utility.plants },
  };
}
