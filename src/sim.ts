/** Pure household/establishment simulation: one tick is one day; money is integer satang. */
import { getHousingCapacity, buildOccupancyIndex, canAccommodate, type HousingType, type HousingCapacity } from './housing.ts';
import { allocateEmployment, type EmploymentAllocation, type WorkerSkills } from './labor.ts';
import { deserializeV1, type City as LegacyCityV1 } from './legacy-v1.ts';
import { deserializeV2, type CityV2 } from './legacy-v2.ts';
export type { EmploymentAllocation } from './labor.ts';
export const SIZE = 24;
export const GATEWAY = 12 * SIZE;
export const MONTH = 30;
export const ROAD_COST = 5_000;
export const WAGES = { I: 60_000, C: 42_000 } as const;
export type Zone = 'R' | 'C' | 'I' | null;
export type Cell = { road: boolean; zone: Zone; building: number | null };
export type Building = { id: number; cell: number; zone: Exclude<Zone, null>; level: number; age: number; housingType?: HousingType };
export type Household = { id: number; home: number | null; members: number; workforce: number; dependents: number; workerSkills: WorkerSkills; skillSource: 'legacy-assumed' | 'arrival-profile'; profile: 'legacy-worker' | 'single-worker' | 'family'; origin: 'legacy-v1' | 'arrival'; wallet: string; lastPurchaseTick: number; needs: number };
export type Firm = { id: number; building: number; zone: 'C' | 'I'; wallet: string; workDays: Record<string, number>; inventory: number; profit: number; lastMonthProfit: number; monthlyRevenue: number; monthlyExpense: number };
export type Entry = { tick: number; from: string; to: string; amount: number; reason: string };
export type GoodsEntry = { tick: number; from: string; to: string; quantity: number; reason: string };
export type City = {
  version: 3; rulesVersion: 'worker-1'; migration: { arrivals: number; legacyHouseholds: number }; employment: EmploymentAllocation[];
  seed: number; rng: number; tick: number; nextId: number;
  cells: Cell[]; buildings: Building[]; households: Household[]; firms: Firm[];
  accounts: Record<string, number>; ledger: Entry[]; goodsLedger: GoodsEntry[];
  goods: { produced: number; imported: number; consumed: number; exported: number };
  utilities: { power: boolean; water: boolean }; lastEvent: string;
};
export type Result = { ok: boolean; message: string };
const validIndex = (i: number) => Number.isInteger(i) && i >= 0 && i < SIZE * SIZE;
const neighbors = (i: number) => [i % SIZE ? i - 1 : -1, i % SIZE < SIZE - 1 ? i + 1 : -1, i >= SIZE ? i - SIZE : -1, i < SIZE * (SIZE - 1) ? i + SIZE : -1].filter(validIndex);
const balance = (c: City, id: string) => c.accounts[id] ?? 0;
const capacity = (b: Building) => b.zone === 'I' ? b.level + 3 : b.zone === 'C' ? b.level : 0;
const payroll = (f: Firm) => Object.values(f.workDays).reduce((n, days) => n + days * WAGES[f.zone] / MONTH, 0);
const spendable = (c: City, f: Firm) => Math.max(0, balance(c, f.wallet) - payroll(f));
// Keep the next counter saveable after every allocation, including a two-ID establishment.
const canAllocateIds = (c: City, count: number) => Number.isSafeInteger(c.nextId) && c.nextId >= 1 && c.nextId <= Number.MAX_SAFE_INTEGER - 2 - count;
function random(c: City): number { c.rng = (Math.imul(c.rng, 1664525) + 1013904223) >>> 0; return c.rng / 4294967296; }

export const employmentForHousehold = (c: City, id: number): EmploymentAllocation[] => c.employment.filter(e => e.householdId === id);
export const employmentForFirm = (c: City, id: number): EmploymentAllocation[] => c.employment.filter(e => e.firmId === id);
export const firmWorkerCount = (c: City, id: number): number => employmentForFirm(c, id).reduce((n, e) => n + e.workers, 0);
export const householdWorkerCount = (c: City, id: number): number => employmentForHousehold(c, id).reduce((n, e) => n + e.workers, 0);
export const housingCapacity = (b: Building): HousingCapacity => b.zone === 'R' ? getHousingCapacity(b.housingType!, b.level) : { households: 0, persons: 0 };
export const homeOccupancy = (c: City, id: number): HousingCapacity => buildOccupancyIndex(c.households).get(id) ?? { households: 0, persons: 0 };
const householdAccess = (c: City, h: Household) => h.home !== null && access(c, building(c, h.home).cell);

/** Every transfer has a debit and credit. Outside is the sole permitted negative source account. */
function transfer(c: City, from: string, to: string, amount: number, reason: string, operating = false): number {
  const firm = c.firms.find(f => f.wallet === from);
  const available = from === 'outside' ? amount : firm ? spendable(c, firm) : balance(c, from);
  const paid = Math.max(0, Math.min(Math.round(amount), available));
  if (!Number.isSafeInteger(paid) || paid === 0) return 0;
  c.accounts[from] = balance(c, from) - paid;
  c.accounts[to] = balance(c, to) + paid;
  c.ledger.push({ tick: c.tick, from, to, amount: paid, reason });
  if (operating) {
    const seller = c.firms.find(f => f.wallet === to), buyer = c.firms.find(f => f.wallet === from);
    if (seller) seller.monthlyRevenue += paid;
    if (buyer) buyer.monthlyExpense += paid;
  }
  return paid;
}
function goodsTransfer(c: City, from: string, to: string, quantity: number, reason: string) {
  if (quantity > 0) c.goodsLedger.push({ tick: c.tick, from, to, quantity, reason });
}

export function connectedRoads(c: City): Set<number> {
  const seen = new Set<number>();
  if (!c.cells[GATEWAY].road) return seen;
  const queue = [GATEWAY]; seen.add(GATEWAY);
  for (let q = 0; q < queue.length; q++) for (const n of neighbors(queue[q])) {
    if (c.cells[n].road && !seen.has(n)) { seen.add(n); queue.push(n); }
  }
  return seen;
}
export function access(c: City, i: number): boolean {
  if (!validIndex(i)) return false;
  const connected = connectedRoads(c);
  return connected.has(i) || neighbors(i).some(n => connected.has(n));
}
export function roadPath(a: number, b: number): number[] {
  if (!validIndex(a) || !validIndex(b)) return [];
  let x = a % SIZE, z = Math.floor(a / SIZE);
  const targetX = b % SIZE, targetZ = Math.floor(b / SIZE), path = [a];
  while (x !== targetX) { x += Math.sign(targetX - x); path.push(z * SIZE + x); }
  while (z !== targetZ) { z += Math.sign(targetZ - z); path.push(z * SIZE + x); }
  return path;
}
export function buildRoad(c: City, a: number, b: number): Result {
  const path = roadPath(a, b);
  if (!path.length) return { ok: false, message: 'Road is outside the bounded map.' };
  if (path.some(i => c.cells[i].building !== null)) return { ok: false, message: 'A building blocks this road. Bulldoze it first.' };
  const added = path.filter(i => !c.cells[i].road), cost = added.length * ROAD_COST;
  if (balance(c, 'treasury') < cost) return { ok: false, message: `Need ${(cost / 100).toFixed(0)} credits for this road.` };
  if (!added.length) return { ok: true, message: 'Road already exists; no charge.' };
  transfer(c, 'treasury', 'roadworks', cost, `Build ${added.length} road cells`);
  for (const i of added) { c.cells[i].road = true; c.cells[i].zone = null; }
  const message = access(c, b) ? `Built ${added.length} road cells.` : 'Road built, but disconnected from the west outside gateway. Adjacent zones cannot grow.';
  c.lastEvent = message;
  return { ok: true, message };
}
export function zoneCell(c: City, i: number, zone: Zone): Result {
  if (!validIndex(i) || ![null, 'R', 'C', 'I'].includes(zone)) return { ok: false, message: 'Invalid parcel or zone.' };
  const cell = c.cells[i];
  if (cell.road) return { ok: false, message: 'Road cells cannot be zoned.' };
  if (cell.building !== null && cell.zone !== zone) return { ok: false, message: 'Bulldoze the existing building before rezoning.' };
  cell.zone = zone;
  const message = !zone ? 'Zone cleared.' : access(c, i) ? `${zone} zone marked. Growth is evaluated every 3 days.` : `${zone} zone marked, but no connected road frontage. Link a neighboring road to the west gateway.`;
  c.lastEvent = message;
  return { ok: true, message };
}
export function bulldoze(c: City, i: number): Result {
  if (!validIndex(i)) return { ok: false, message: 'Outside the map.' };
  if (i === GATEWAY) return { ok: false, message: 'The outside gateway is reserved.' };
  const cell = c.cells[i], b = c.buildings.find(v => v.id === cell.building);
  const cost = b || cell.road ? 2_000 : 0;
  if (balance(c, 'treasury') < cost) return { ok: false, message: 'Need 20 credits for demolition.' };
  transfer(c, 'treasury', 'construction', cost, 'Demolition');
  if (b) {
    const displaced = c.households.filter(h => h.home === b.id), closing = c.firms.filter(f => f.building === b.id);
    for (const h of displaced) h.home = null;
    const displacedIds = new Set(displaced.map(h => h.id));
    c.employment = c.employment.filter(e => !displacedIds.has(e.householdId));
    for (const f of closing) {
      payWages(c, f);
      transfer(c, f.wallet, 'outside', balance(c, f.wallet), 'Firm liquidation');
      goodsTransfer(c, f.wallet, 'outside', f.inventory, 'Demolition stock write-off to outside'); c.goods.exported += f.inventory;
      c.employment = c.employment.filter(e => e.firmId !== f.id);
    }
    c.firms = c.firms.filter(f => f.building !== b.id);
    c.buildings = c.buildings.filter(v => v.id !== b.id);
  }
  cell.road = false; cell.zone = null; cell.building = null;
  c.lastEvent = 'Parcel cleared. Disconnected buildings stop recruiting, trading and growing.';
  return { ok: true, message: c.lastEvent };
}

export function summary(c: City) {
  const jobs = c.firms.filter(f => access(c, building(c, f.building).cell)).reduce((n, f) => n + capacity(building(c, f.building)), 0);
  const employed = c.employment.reduce((n, e) => n + e.workers, 0);
  const workforce = c.households.reduce((n, h) => n + h.workforce, 0);
  const availableWorkers = c.households.filter(h => householdAccess(c, h)).reduce((n, h) => n + h.workforce - householdWorkerCount(c, h.id), 0);
  const shops = c.firms.filter(f => f.zone === 'C').length;
  const recent = c.ledger.filter(e => e.tick > Math.max(0, c.tick - MONTH) && !e.reason.includes('grant'));
  const net = recent.reduce((n, e) => n + (e.to === 'treasury' ? e.amount : 0) - (e.from === 'treasury' ? e.amount : 0), 0);
  const homes = c.buildings.filter(b => b.zone === 'R');
  const occupied = buildOccupancyIndex(c.households), admission = admissionFacts(c);
  // Every catalog profile has at most 3 members and every slot provides 4-person capacity.
  // Count usable existing slots before commissioning more houses, including a newly built empty home.
  const vacantSlots = homes.filter(b => access(c, b.cell)).reduce((n, b) => {
    const room = housingCapacity(b), used = occupied.get(b.id) ?? { households: 0, persons: 0 };
    return n + Math.max(0, Math.min(room.households - used.households, Math.floor((room.persons - used.persons) / 3)));
  }, 0);
  const homeless = c.households.filter(h => h.home === null).length;
  const incoming = Math.min(128 - c.households.length, Math.max(0, 2 - c.migration.arrivals, Math.ceil(Math.max(0, admission.vacancies - availableWorkers) / 2)));
  return { population: c.households.reduce((n, h) => n + h.members, 0), households: c.households.length, workforce,
    dependents: c.households.reduce((n, h) => n + h.dependents, 0), jobs, employed, unemployed: workforce - employed,
    homeless, homeSlots: homes.reduce((n, b) => n + housingCapacity(b).households, 0),
    personCapacity: homes.reduce((n, b) => n + housingCapacity(b).persons, 0), treasury: balance(c, 'treasury'), net,
    demand: { R: Math.max(0, homeless + incoming - vacantSlots), C: Math.max(0, Math.floor(c.households.length / 4) - shops), I: c.firms.some(f => f.zone === 'I') ? (availableWorkers > 0 && jobs - employed < 2 ? 1 : 0) : 1 } };
}
function building(c: City, id: number): Building { return c.buildings.find(b => b.id === id)!; }
function blockers(c: City, i: number): string[] {
  const cell = c.cells[i];
  if (!cell.zone) return ['No R/C/I zoning.'];
  const reasons: string[] = [], s = summary(c);
  if (!access(c, i)) reasons.push('No connected road frontage. Connect an adjacent road to the west outside gateway.');
  if (!c.utilities.power) reasons.push('No power: prototype outside power supply is unavailable.');
  if (!c.utilities.water) reasons.push('No water: prototype outside water supply is unavailable.');
  if (!canAllocateIds(c, cell.zone === 'R' ? 1 : 2)) reasons.push('Entity ID range exhausted. No new entity or investment can be created safely.');
  if (c.buildings.length >= 192) reasons.push('Prototype building limit (192) reached.');
  if (cell.zone === 'R') {
    if (s.demand.R <= 0) reasons.push('No housing demand: usable vacant capacity already covers funded job opportunities and displaced households.');
    if (WAGES.C * .9 - 30 * 800 - 10_000 <= 0) reasons.push('Expected income cannot cover purchases and rent.');
  } else {
    if (c.firms.length >= 64) reasons.push('Firm limit (64) reached.');
    if (cell.zone === 'C') {
      const residents = c.households.filter(h => householdAccess(c, h) && balance(c, h.wallet) >= 800).length;
      const shops = c.firms.filter(f => f.zone === 'C' && access(c, building(c, f.building).cell)).length;
      const wholesale = c.firms.some(f => f.zone === 'I' && access(c, building(c, f.building).cell)) ? 300 : 450;
      const needed = Math.ceil((WAGES.C + 10_000) / ((800 - wholesale) * MONTH));
      if (residents < needed * (shops + 1)) reasons.push(`Viability: need ${needed * (shops + 1)} connected funded households for ${shops + 1} shop(s); have ${residents}. Expected margin must cover 420 credits wages + 100 rent/month.`);
    }
    if (s.demand[cell.zone] <= 0) reasons.push(cell.zone === 'I' ? 'No industry demand: another factory needs an actual connected unemployed resident and fewer than 2 existing job vacancies. Only the first factory has a workforce bootstrap exemption.' : 'No retail demand: existing shops cover the household market.');
  }
  return reasons;
}
export function explainCell(c: City, i: number): string[] {
  if (!validIndex(i)) return ['Select a parcel inside the 24 × 24 map.'];
  const cell = c.cells[i];
  if (cell.road) return [i === GATEWAY ? 'Reserved outside gateway.' : 'Grid road.', connectedRoads(c).has(i) ? 'Connected to outside market.' : 'Disconnected: no route to the west outside gateway.', 'Road construction 50 credits/cell; upkeep 0.10 credits/day/cell.'];
  if (!cell.zone) return ['Unzoned land. Choose R homes, C shops or I industry, then tap this parcel.', 'Buildings require connected road frontage, power, water, demand and viable expected rent.'];
  if (cell.building === null) {
    const stopped = blockers(c, i);
    return [`${cell.zone} zone · vacant`, ...stopped, stopped.length ? 'Growth is blocked until these conditions change.' : `Eligible; a seeded parcel is chosen every 3 days. Next review in ${3 - c.tick % 3} day(s).`, 'Bootstrap: first industry may open without workers; first 2 households may arrive without jobs. Capital and arrival savings come from the outside account.'];
  }
  const b = building(c, cell.building), f = c.firms.find(v => v.building === b.id), residents = c.households.filter(v => v.home === b.id);
  const output = [`${b.zone === 'R' ? 'Home' : b.zone === 'C' ? 'Shop' : 'Factory'} #${b.id} · level ${b.level} · age ${b.age} days`, access(c, i) ? 'Connected road frontage.' : 'Disconnected: employment, purchases, production and height growth are suspended.'];
  if (!c.utilities.power || !c.utilities.water) output.push('Outside utility supply unavailable; production and growth suspended.');
  if (b.zone === 'R') {
    const used = homeOccupancy(c, b.id), room = housingCapacity(b);
    output.push(`Actual occupancy: ${used.households}/${room.households} households, ${used.persons}/${room.persons} persons. Upgrades add capacity only.`, ...explainMigration(c, b.id));
    for (const h of residents) output.push(`Household #${h.id}: ${h.members} members, ${h.workforce} workforce, ${householdWorkerCount(c, h.id)} allocated workers; wallet ${(balance(c, h.wallet) / 100).toFixed(2)} credits.${h.origin === 'legacy-v1' ? ' Composition is an explicit minimum assumption from v1.' : ''}`);
  }
  if (f) output.push(`Firm #${f.id}: ${firmWorkerCount(c, f.id)}/${capacity(b)} workers; inventory ${f.inventory}; wallet ${(balance(c, f.wallet) / 100).toFixed(2)} credits; earned wages reserved ${(payroll(f) / 100).toFixed(2)}.`, `Last monthly operating profit ${(f.lastMonthProfit / 100).toFixed(2)} credits.`, firmWorkerCount(c, f.id) === 0 ? 'Idle: needs connected available household workforce and cash to reserve daily wages.' : f.zone === 'I' ? 'Produces 8 goods/worker/day; sells locally at 3 credits or exports at 3.50.' : 'Buys local goods at 3 credits or imports at 4.50; sells one generic basket per household/day at 8 credits.', 'Wages accrue per allocated worker-day and are paid each 30-day month. Reserved wages cannot fund stock or expansion.', 'Rent 100 credits/month; positive profit tax 20%. Height upgrade requires a profitable month, workers and construction funds.');
  return output;
}
function createBuilding(c: City, i: number) {
  if (!canAllocateIds(c, c.cells[i].zone === 'R' ? 1 : 2)) { c.lastEvent = 'Entity ID range exhausted; construction and funding were not created.'; return; }
  const zone = c.cells[i].zone!, id = c.nextId++;
  const b: Building = { id, cell: i, zone, level: 1, age: 0, ...(zone === 'R' ? { housingType: 'cottage' as const } : {}) }; c.buildings.push(b); c.cells[i].building = id;
  if (zone === 'R') {
    transfer(c, 'outside', 'construction', 40_000, 'Outside residential developer investment');
  } else {
    const fid = c.nextId++, wallet = `firm:${fid}`;
    c.firms.push({ id: fid, building: id, zone, wallet, workDays: {}, inventory: 0, profit: 0, lastMonthProfit: 0, monthlyRevenue: 0, monthlyExpense: 0 });
    transfer(c, 'outside', wallet, 300_000, 'Outside firm equity investment');
    transfer(c, wallet, 'construction', 40_000, 'Firm building investment');
  }
  c.lastEvent = `${zone} building #${id} grew: road + utilities + demand + viable expected rent. Initial investment is recorded in the ledger.`;
}
function employ(c: City) {
  c.employment = allocateEmployment(c.households.map(h => ({ id: h.id, workforce: h.workforce, workerSkills: h.workerSkills, accessible: householdAccess(c, h) })), c.firms.map(f => ({
    id: f.id, zone: f.zone, slots: access(c, building(c, f.building).cell) ? capacity(building(c, f.building)) : 0,
    budgetWorkers: Math.floor(spendable(c, f) / (WAGES[f.zone] / MONTH)),
  })), c.employment);
  for (const allocation of c.employment) {
    const h = c.households.find(h => h.id === allocation.householdId)!, f = c.firms.find(f => f.id === allocation.firmId)!;
    f.workDays[h.wallet] = (f.workDays[h.wallet] ?? 0) + allocation.workers;
  }
}
function trade(c: City) {
  const active = c.firms.filter(f => access(c, building(c, f.building).cell));
  if (c.utilities.power && c.utilities.water) for (const f of active.filter(f => f.zone === 'I')) {
    const made = firmWorkerCount(c, f.id) * 8;
    f.inventory += made; c.goods.produced += made; goodsTransfer(c, 'production', f.wallet, made, 'Daily worker production');
  }
  for (const shop of active.filter(f => f.zone === 'C' && firmWorkerCount(c, f.id) > 0)) {
    const target = Math.min(24, Math.max(4, c.households.length * 2));
    for (const producer of active.filter(f => f.zone === 'I')) {
      const qty = Math.min(producer.inventory, target - shop.inventory, Math.floor(spendable(c, shop) / 300));
      if (qty <= 0) continue;
      transfer(c, shop.wallet, producer.wallet, qty * 300, 'Local wholesale goods', true);
      shop.inventory += qty; producer.inventory -= qty; goodsTransfer(c, producer.wallet, shop.wallet, qty, 'Wholesale stock delivery');
    }
    const imported = Math.min(target - shop.inventory, Math.floor(spendable(c, shop) / 450));
    if (imported > 0) {
      transfer(c, shop.wallet, 'outside', imported * 450, 'Outside goods import', true);
      shop.inventory += imported; c.goods.imported += imported; goodsTransfer(c, 'outside', shop.wallet, imported, 'Imported shop stock');
    }
  }
  for (const h of c.households) {
    h.needs++;
    if (!householdAccess(c, h) || balance(c, h.wallet) < 800) continue;
    const shops = active.filter(f => f.zone === 'C' && firmWorkerCount(c, f.id) > 0 && f.inventory > 0);
    const shop = shops.length ? shops[Math.floor(random(c) * shops.length)] : null;
    if (shop) {
      transfer(c, h.wallet, shop.wallet, 800, `Household #${h.id} purchase`, true);
      shop.inventory--; c.goods.consumed++; h.lastPurchaseTick = c.tick; h.needs = 0;
      goodsTransfer(c, shop.wallet, h.wallet, 1, 'Household final consumption');
    }
  }
  for (const f of active.filter(f => f.zone === 'I' && firmWorkerCount(c, f.id) > 0)) {
    const exported = Math.min(f.inventory, firmWorkerCount(c, f.id) * 8);
    transfer(c, 'outside', f.wallet, exported * 350, 'Outside market goods export', true);
    f.inventory -= exported; c.goods.exported += exported; goodsTransfer(c, f.wallet, 'outside', exported, 'Exported goods');
  }
}
function payWages(c: City, f: Firm, onlyWallet?: string) {
  for (const [wallet, days] of Object.entries(f.workDays)) {
    if (onlyWallet && wallet !== onlyWallet) continue;
    const owed = days * WAGES[f.zone] / MONTH;
    // Release this claim's reserve immediately before paying it; other workers remain protected.
    delete f.workDays[wallet];
    const wage = transfer(c, f.wallet, wallet, owed, 'Monthly wages', true);
    if (wage !== owed) throw new Error('Payroll reserve invariant violated.');
    transfer(c, wallet, 'treasury', Math.floor(wage / 10), 'Monthly household wage tax');
  }
}
function settleMonth(c: City) {
  for (const f of c.firms) {
    payWages(c, f);
    transfer(c, f.wallet, 'landlord', 10_000, 'Monthly firm rent', true);
    f.lastMonthProfit = f.monthlyRevenue - f.monthlyExpense;
    f.profit += f.lastMonthProfit;
    transfer(c, f.wallet, 'treasury', Math.max(0, Math.floor(f.lastMonthProfit * .2)), 'Monthly firm profit tax');
    f.monthlyRevenue = 0; f.monthlyExpense = 0;
  }
  for (const h of c.households) if (h.home !== null) transfer(c, h.wallet, 'landlord', 10_000, 'Monthly household rent');
  c.lastEvent = 'Month settled: actual firm wages, household rent and taxes are in the money ledger.';
}

export function moveHousehold(c: City, householdId: number, destinationId: number): Result {
  const h = c.households.find(h => h.id === householdId), destination = c.buildings.find(b => b.id === destinationId && b.zone === 'R');
  if (!h || !destination) return { ok: false, message: 'Household or destination home does not exist.' };
  if (h.home === destinationId) return { ok: true, message: 'Household already lives here; no transfer or population change.' };
  if (destination.age < 1 || !access(c, destination.cell) || !c.utilities.power || !c.utilities.water) return { ok: false, message: 'Destination needs a later daily tick, connected road, power and water.' };
  if (!canAccommodate(housingCapacity(destination), homeOccupancy(c, destinationId), h.members)) return { ok: false, message: 'Destination lacks household slots or person capacity.' };
  h.home = destinationId;
  return { ok: true, message: 'Household moved with the same identity, wallet, members and earned wage claims.' };
}
function vacantHomes(c: City): Building[] {
  return c.buildings.filter(b => b.zone === 'R' && b.age >= 1 && access(c, b.cell)).sort((a, b) => a.cell - b.cell || a.id - b.id);
}
function rehouse(c: City) {
  if (!c.utilities.power || !c.utilities.water) return;
  for (const h of [...c.households].filter(h => h.home === null).sort((a, b) => a.id - b.id)) {
    for (const home of vacantHomes(c)) if (canAccommodate(housingCapacity(home), homeOccupancy(c, home.id), h.members)) { moveHousehold(c, h.id, home.id); break; }
  }
}
function admissionFacts(c: City) {
  const vacanciesByZone = { I: 0, C: 0 };
  for (const f of c.firms) if (access(c, building(c, f.building).cell)) vacanciesByZone[f.zone] += Math.min(Math.max(0, capacity(building(c, f.building)) - firmWorkerCount(c, f.id)), Math.floor(spendable(c, f) / (WAGES[f.zone] / MONTH)));
  const vacancies = vacanciesByZone.I + vacanciesByZone.C;
  const existingUnemployed = c.households.filter(h => householdAccess(c, h)).reduce((n, h) => n + h.workforce - householdWorkerCount(c, h.id), 0);
  return { vacancies, vacanciesByZone, existingUnemployed, bootstrap: c.migration.arrivals < 2 };
}
export function explainMigration(c: City, buildingId: number): string[] {
  const b = c.buildings.find(b => b.id === buildingId && b.zone === 'R');
  if (!b) return ['ไม่พบบ้านพักที่เลือก'];
  const used = homeOccupancy(c, b.id), room = housingCapacity(b), facts = admissionFacts(c), reasons = [
    `พักจริง ${used.households}/${room.households} ครัวเรือน และ ${used.persons}/${room.persons} คน ตามกฎบ้าน cottage รุ่น household-1`,
    `มีตำแหน่งว่างที่สำรองค่าจ้างได้ ${facts.vacancies} ตำแหน่ง และแรงงานเดิมที่ยังไม่ได้งาน ${facts.existingUnemployed} คน`,
  ];
  if (b.age < 1) reasons.push('บ้านใหม่ยังว่างในวันที่สร้าง ต้องรออย่างน้อยหนึ่งวันจำลอง');
  if (!access(c, b.cell)) reasons.push('ต้องมีถนนเชื่อมข้างบ้านถึงทางออกเมือง');
  if (!c.utilities.power || !c.utilities.water) reasons.push('แหล่งน้ำและไฟภายนอกต้องพร้อม');
  if (used.households >= room.households || used.persons >= room.persons) reasons.push('ความจุครัวเรือนหรือจำนวนคนเต็มแล้ว การเพิ่มระดับเพิ่มเฉพาะความจุ');
  if (c.households.some(h => h.home === null)) reasons.push('ครัวเรือนที่ไร้บ้านจะได้รับการจัดบ้านก่อนรับครัวเรือนใหม่');
  if (facts.bootstrap) reasons.push(`สิทธิเริ่มเมืองเหลือ ${2 - c.migration.arrivals} ครัวเรือน ยกเว้นเงื่อนไขงานเริ่มต้นเท่านั้น เงินติดตัว 1,500 เครดิตต้องบันทึกจากบัญชีภายนอกหนึ่งครั้งต่อครัวเรือน`);
  else reasons.push('รับใหม่เมื่อมีตำแหน่งว่างที่จ่ายค่าจ้างได้ และรายได้สุทธิคาดหมายพอค่าของใช้กับค่าเช่า โดยให้แรงงานเดิมได้งานก่อน');
  reasons.push('รับครัวเรือนใหม่ไม่เกินหนึ่งครัวเรือนต่อวัน สมาชิกเป็นจำนวนจริงของแต่ละครัวเรือน ไม่ใช่ตัวแทนประชากรแบบกลุ่มรวม');
  return reasons;
}
function admitHousehold(c: City) {
  if (!canAllocateIds(c, 1)) { c.lastEvent = 'Entity ID range exhausted; no household or arrival funding was created.'; return; }
  if (!c.utilities.power || !c.utilities.water || c.households.length >= 128 || c.households.some(h => h.home === null) || c.ledger.some(e => e.tick === c.tick && e.reason === 'New household arrival savings')) return;
  const facts = admissionFacts(c);
  if (!facts.bootstrap && (facts.vacancies < 1 || facts.existingUnemployed > 0)) return;
  const family = facts.vacancies >= 2 && facts.existingUnemployed === 0;
  const members = family ? 3 : 1, workforce = family ? 2 : 1;
  if (!facts.bootstrap && Math.floor(WAGES.C * workforce * .9) < 30 * 800 + 10_000) return;
  const home = vacantHomes(c).find(b => canAccommodate(housingCapacity(b), homeOccupancy(c, b.id), members));
  if (!home) return;
  const id = c.nextId, wallet = `household:${id}`;
  // Outside is an explicit source. No existing family wallet or earned claim is duplicated.
  if (transfer(c, 'outside', wallet, 150_000, 'New household arrival savings') !== 150_000) return;
  c.nextId++;
  // Proposed entry capability profile: one flexible worker plus one specialist
  // in a currently funded role. Counts are disjoint; no per-person agents exist.
  const workerSkills: WorkerSkills = { general: 1, manufacturing: family && facts.vacanciesByZone.I > 0 ? 1 : 0, retail: family && facts.vacanciesByZone.I === 0 ? 1 : 0 };
  c.households.push({ id, home: home.id, members, workforce, dependents: family ? 1 : 0, workerSkills, skillSource: 'arrival-profile', profile: family ? 'family' : 'single-worker', origin: 'arrival', wallet, lastPurchaseTick: -1, needs: 0 });
  c.migration.arrivals++;
  c.lastEvent = `Household #${id} arrived with ${members} members and ${workforce} workforce; outside arrival savings recorded once.${facts.bootstrap ? ' Explicit first-two-household job bootstrap.' : ''}`;
}
function grow(c: City) {
  const eligible = c.cells.map((cell, i) => cell.zone && cell.building === null && !blockers(c, i).length ? i : -1).filter(i => i >= 0);
  if (eligible.length) createBuilding(c, eligible[Math.floor(random(c) * eligible.length)]);
  if (c.tick % MONTH !== 0) return;
  for (const b of c.buildings) {
    if (b.level >= 3 || b.age < MONTH || !access(c, b.cell) || !c.utilities.power || !c.utilities.water) continue;
    const residents = c.households.filter(h => h.home === b.id), f = c.firms.find(f => f.building === b.id);
    if (b.zone === 'R' && residents.some(h => householdWorkerCount(c, h.id) > 0 && c.tick - h.lastPurchaseTick <= 3 && balance(c, h.wallet) >= 20_000)) {
      transfer(c, 'outside', 'construction', 20_000, 'Outside residential height investment'); b.level++;
    } else if (f && f.lastMonthProfit > 0 && firmWorkerCount(c, f.id) > 0 && balance(c, f.wallet) >= 20_000) {
      transfer(c, f.wallet, 'construction', 20_000, 'Profitable firm height investment'); b.level++;
    }
  }
}
export function step(c: City): void {
  c.tick++; for (const b of c.buildings) b.age++;
  rehouse(c); employ(c); admitHousehold(c); trade(c);
  transfer(c, 'treasury', 'upkeep', c.cells.filter(cell => cell.road).length * 10, 'Daily road upkeep');
  if (c.tick % MONTH === 0) settleMonth(c);
  if (c.tick % 3 === 0) grow(c);
}
export function createCity(seed = 20261023): City {
  const safeSeed = Number.isSafeInteger(seed) ? seed >>> 0 : 20261023;
  const c: City = { version: 3, rulesVersion: 'worker-1', migration: { arrivals: 0, legacyHouseholds: 0 }, employment: [], seed: safeSeed, rng: safeSeed, tick: 0, nextId: 1,
    cells: Array.from({ length: SIZE * SIZE }, () => ({ road: false, zone: null, building: null })),
    buildings: [], households: [], firms: [], accounts: { outside: 0, treasury: 0, construction: 0, roadworks: 0, upkeep: 0, landlord: 0 }, ledger: [], goodsLedger: [],
    goods: { produced: 0, imported: 0, consumed: 0, exported: 0 }, utilities: { power: true, water: true }, lastEvent: '' };
  transfer(c, 'outside', 'treasury', 3_000_000, 'Initial municipal grant');
  buildRoad(c, GATEWAY, GATEWAY + 10);
  for (const x of [2, 3, 5, 6, 8, 9]) zoneCell(c, 11 * SIZE + x, 'R');
  for (const x of [4, 7]) zoneCell(c, 13 * SIZE + x, 'C');
  for (const x of [8, 10]) zoneCell(c, 13 * SIZE + x, 'I');
  c.lastEvent = 'Starter road and zones are funded by the recorded grant. Unpause and watch one seeded development review every 3 days.';
  return c;
}
export function serialize(c: City): string {
  const json = JSON.stringify(c);
  if (json.length > 12_000_000) throw new Error('Save journal exceeds the prototype 12 MB limit. The previous local save is preserved.');
  return json;
}

/** Strict v1 validation has already completed; migration changes no economic or clock history. */
function migrateV1(old: LegacyCityV1): City {
  const { version: _version, households, firms, buildings, ...preserved } = old;
  return { ...preserved, version: 3, rulesVersion: 'worker-1',
    migration: { arrivals: Math.max(households.length, old.ledger.filter(e => e.reason === 'New household arrival savings').length), legacyHouseholds: households.length },
    employment: households.filter(h => h.employer !== null).map(h => ({ householdId: h.id, firmId: h.employer!, workers: 1, skill: 'general' as const, rank: 'entry' as const, occupation: firms.find(f => f.id === h.employer)!.zone === 'I' ? 'manufacturing' as const : 'retail' as const })),
    buildings: buildings.map(b => ({ ...b, ...(b.zone === 'R' ? { housingType: 'cottage' as const } : {}) })),
    households: households.map(({ employer: _employer, ...h }) => ({ ...h, members: 1, workforce: 1, dependents: 0, workerSkills: { general: 1, manufacturing: 0, retail: 0 }, skillSource: 'legacy-assumed', profile: 'legacy-worker', origin: 'legacy-v1' })),
    firms: firms.map(({ employees: _employees, ...f }) => f),
  };
}

/** Published v2 has no capability records; retain every job and earned claim on load. */
function migrateV2(old: CityV2): City {
  return { ...old, version: 3, rulesVersion: 'worker-1',
    households: old.households.map(h => ({ ...h, workerSkills: { general: h.workforce, manufacturing: 0, retail: 0 }, skillSource: 'legacy-assumed' })),
    employment: old.employment.map(e => ({ ...e, skill: 'general' })),
  };
}

function validateV3(c: City): City {
  const fail = (): never => { throw new Error('Unsupported or corrupt CityManager worker save (expected version 3 / worker-1).'); };
  const int = (v: unknown, min = 0): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= min;
  if (!c || c.version !== 3 || c.rulesVersion !== 'worker-1' || !int(c.seed) || c.seed > 4294967295 || !int(c.rng) || c.rng > 4294967295 || !int(c.tick) || !int(c.nextId, 1) || c.nextId > Number.MAX_SAFE_INTEGER - 2 || typeof c.lastEvent !== 'string') fail();
  if (!Array.isArray(c.cells) || c.cells.length !== SIZE * SIZE || !Array.isArray(c.buildings) || c.buildings.length > 192 || !Array.isArray(c.households) || c.households.length > 128 || !Array.isArray(c.firms) || c.firms.length > 64) fail();
  if (!c.migration || !int(c.migration.arrivals) || !int(c.migration.legacyHouseholds) || !Array.isArray(c.employment) || c.employment.length > 256) fail();
  if (!c.utilities || typeof c.utilities.power !== 'boolean' || typeof c.utilities.water !== 'boolean' || !c.goods || !['produced', 'imported', 'consumed', 'exported'].every(k => int(c.goods[k as keyof typeof c.goods]))) fail();
  if (!c.accounts || typeof c.accounts !== 'object' || Array.isArray(c.accounts) || !['outside', 'treasury', 'construction', 'roadworks', 'upkeep', 'landlord'].every(k => int(c.accounts[k], k === 'outside' ? Number.MIN_SAFE_INTEGER : 0)) || !Object.entries(c.accounts).every(([k, v]) => /^(outside|treasury|construction|roadworks|upkeep|landlord|household:\d+|firm:\d+)$/.test(k) && int(v, k === 'outside' ? Number.MIN_SAFE_INTEGER : 0)) || Object.values(c.accounts).reduce((a, b) => a + b, 0) !== 0) fail();
  for (const cell of c.cells) if (!cell || typeof cell.road !== 'boolean' || ![null, 'R', 'C', 'I'].includes(cell.zone) || !(cell.building === null || int(cell.building, 1)) || (cell.road && (cell.zone !== null || cell.building !== null))) fail();
  if (!c.cells[GATEWAY].road) fail();
  const ids = new Set<number>();
  for (const b of c.buildings) {
    if (!b || !int(b.id, 1) || ids.has(b.id) || !validIndex(b.cell) || !['R', 'C', 'I'].includes(b.zone) || !int(b.level, 1) || b.level > 3 || !int(b.age) || b.age > c.tick || c.cells[b.cell].building !== b.id || c.cells[b.cell].zone !== b.zone || (b.zone === 'R' ? b.housingType !== 'cottage' : b.housingType !== undefined)) fail();
    ids.add(b.id);
  }
  for (let i = 0; i < c.cells.length; i++) if (c.cells[i].building !== null && !c.buildings.some(b => b.id === c.cells[i].building && b.cell === i)) fail();
  for (const h of c.households) {
    if (!h || !int(h.id, 1) || ids.has(h.id) || !(h.home === null || c.buildings.some(b => b.id === h.home && b.zone === 'R')) || h.wallet !== `household:${h.id}` || !int(c.accounts[h.wallet]) || Object.hasOwn(h, 'employer') || !int(h.members, 1) || !int(h.workforce) || !int(h.dependents) || h.members !== h.workforce + h.dependents || !int(h.lastPurchaseTick, -1) || h.lastPurchaseTick > c.tick || !int(h.needs)) fail();
    if (h.origin === 'legacy-v1' ? h.profile !== 'legacy-worker' || h.members !== 1 || h.workforce !== 1 || h.dependents !== 0 : h.origin !== 'arrival' || (h.profile === 'family' ? h.members !== 3 || h.workforce !== 2 || h.dependents !== 1 : h.profile !== 'single-worker' || h.members !== 1 || h.workforce !== 1 || h.dependents !== 0)) fail();
    if (!h.workerSkills || typeof h.workerSkills !== 'object' || Array.isArray(h.workerSkills) || Object.keys(h.workerSkills).length !== 3 || !['general', 'manufacturing', 'retail'].every(k => int(h.workerSkills[k as keyof WorkerSkills])) || h.workerSkills.general + h.workerSkills.manufacturing + h.workerSkills.retail !== h.workforce) fail();
    if (h.skillSource === 'legacy-assumed' ? h.workerSkills.general !== h.workforce : h.skillSource !== 'arrival-profile' || h.origin !== 'arrival') fail();
    ids.add(h.id);
  }
  for (const f of c.firms) {
    if (!f || !int(f.id, 1) || ids.has(f.id) || !['C', 'I'].includes(f.zone) || !c.buildings.some(b => b.id === f.building && b.zone === f.zone) || f.wallet !== `firm:${f.id}` || !int(c.accounts[f.wallet]) || Object.hasOwn(f, 'employees') || !int(f.inventory) || !int(f.profit, Number.MIN_SAFE_INTEGER) || !int(f.lastMonthProfit, Number.MIN_SAFE_INTEGER) || !int(f.monthlyRevenue) || !int(f.monthlyExpense)) fail();
    if (!f.workDays || typeof f.workDays !== 'object' || Array.isArray(f.workDays) || !Object.entries(f.workDays).every(([wallet, days]) => { const h = c.households.find(h => h.wallet === wallet); return h && int(days, 1) && days <= h.workforce * (c.tick % MONTH); }) || !int(payroll(f)) || payroll(f) > balance(c, f.wallet)) fail();
    ids.add(f.id);
  }
  const retainedAccountIds = Object.keys(c.accounts).flatMap(key => {
    const match = /^(?:household|firm):(\d+)$/.exec(key);
    if (!match) return [];
    const id = Number(match[1]);
    if (!int(id, 1)) fail();
    return [id];
  });
  if (Math.max(0, ...ids, ...retainedAccountIds) >= c.nextId || new Set(c.firms.map(f => f.building)).size !== c.firms.length) fail();
  const occupied = buildOccupancyIndex(c.households);
  for (const b of c.buildings) {
    if (b.zone !== 'R') { if (!c.firms.some(f => f.building === b.id)) fail(); }
    else { const used = occupied.get(b.id) ?? { households: 0, persons: 0 }, room = housingCapacity(b); if (used.households > room.households || used.persons > room.persons) fail(); }
  }
  const pairs = new Set<string>();
  for (const e of c.employment) {
    if (!e || !int(e.householdId, 1) || !int(e.firmId, 1) || !int(e.workers, 1) || e.rank !== 'entry' || !['general', 'manufacturing', 'retail'].includes(e.skill)) fail();
    const h = c.households.find(h => h.id === e.householdId), f = c.firms.find(f => f.id === e.firmId), pair = `${e.householdId}:${e.firmId}:${e.skill}`;
    if (!h || h.home === null || !f || e.occupation !== (f.zone === 'I' ? 'manufacturing' : 'retail') || (e.skill !== 'general' && e.skill !== e.occupation) || pairs.has(pair)) fail();
    pairs.add(pair);
  }
  for (const h of c.households) {
    if (householdWorkerCount(c, h.id) > h.workforce || c.firms.reduce((n, f) => n + (f.workDays[h.wallet] ?? 0), 0) > h.workforce * (c.tick % MONTH)) fail();
    for (const skill of ['general', 'manufacturing', 'retail'] as const) if (employmentForHousehold(c, h.id).filter(e => e.skill === skill).reduce((n, e) => n + e.workers, 0) > h.workerSkills[skill]) fail();
  }
  for (const f of c.firms) if (firmWorkerCount(c, f.id) > capacity(building(c, f.building)) || Object.values(f.workDays).reduce((n, days) => n + days, 0) > capacity(building(c, f.building)) * (c.tick % MONTH)) fail();
  if (c.goods.produced + c.goods.imported - c.goods.consumed - c.goods.exported !== c.firms.reduce((n, f) => n + f.inventory, 0)) fail();
  if (!Array.isArray(c.ledger) || !Array.isArray(c.goodsLedger)) fail();
  for (const e of c.ledger) if (!e || !int(e.tick) || e.tick > c.tick || !int(e.amount, 1) || typeof e.reason !== 'string' || typeof e.from !== 'string' || typeof e.to !== 'string' || !Object.hasOwn(c.accounts, e.from) || !Object.hasOwn(c.accounts, e.to) || e.from === e.to) fail();
  const arrivals = c.households.filter(h => h.origin === 'arrival'), legacyCount = c.households.filter(h => h.origin === 'legacy-v1').length;
  const arrivalEntries = c.ledger.filter(e => e.reason === 'New household arrival savings');
  if (c.migration.legacyHouseholds !== legacyCount || c.migration.arrivals !== Math.max(legacyCount, arrivalEntries.length - arrivals.length) + arrivals.length) fail();
  const arrivalDays = new Set<number>();
  for (const h of arrivals) {
    const funding = arrivalEntries.filter(e => e.to === h.wallet);
    if (funding.length !== 1 || funding[0].from !== 'outside' || funding[0].amount !== 150_000 || arrivalDays.has(funding[0].tick)) fail();
    arrivalDays.add(funding[0].tick);
  }
  const goodsBalances: Record<string, number> = {};
  let produced = 0, imported = 0, consumed = 0, exported = 0;
  for (const e of c.goodsLedger) {
    if (!e || !int(e.tick) || e.tick > c.tick || !int(e.quantity, 1) || typeof e.reason !== 'string' || typeof e.from !== 'string' || typeof e.to !== 'string' || e.from === e.to || !/^(production|outside|firm:\d+)$/.test(e.from) || !/^(outside|firm:\d+|household:\d+)$/.test(e.to) || (e.from !== 'production' && !(e.from in c.accounts)) || !(e.to in c.accounts)) fail();
    goodsBalances[e.from] = (goodsBalances[e.from] ?? 0) - e.quantity;
    goodsBalances[e.to] = (goodsBalances[e.to] ?? 0) + e.quantity;
    if (e.from === 'production') produced += e.quantity;
    if (e.from === 'outside') imported += e.quantity;
    if (e.to.startsWith('household:')) consumed += e.quantity;
    if (e.to === 'outside') exported += e.quantity;
  }
  if (produced !== c.goods.produced || imported !== c.goods.imported || consumed !== c.goods.consumed || exported !== c.goods.exported || c.firms.some(f => (goodsBalances[f.wallet] ?? 0) !== f.inventory) || Object.entries(goodsBalances).some(([wallet, amount]) => wallet.startsWith('firm:') && !c.firms.some(f => f.wallet === wallet) && amount !== 0)) fail();
  const reconciled: Record<string, number> = Object.fromEntries(Object.keys(c.accounts).map(k => [k, 0]));
  for (const e of c.ledger) { reconciled[e.from] -= e.amount; reconciled[e.to] += e.amount; }
  if (Object.entries(c.accounts).some(([key, value]) => reconciled[key] !== value)) fail();
  return c;
}

/** Validate old saves before migration; never advance time, RNG, money or admission history on load. */
export function deserialize(json: string): City {
  if (typeof json !== 'string' || json.length > 12_000_000) throw new Error('Save is too large or invalid.');
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { throw new Error('Save is not valid JSON.'); }
  if (parsed && typeof parsed === 'object' && (parsed as { version?: unknown }).version === 1) return validateV3(migrateV1(deserializeV1(json)));
  if (parsed && typeof parsed === 'object' && (parsed as { version?: unknown }).version === 2) return validateV3(migrateV2(deserializeV2(json)));
  return validateV3(parsed as City);
}
