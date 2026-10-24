/** Frozen reader for published schema 2 / household-1 at 1ed7f8fac1e3d246dcdd883837d6f855c1d9d24a.
 * No labor allocation, migration, tick or writes occur here. Keep this independent
 * of current simulation/skill rules so old input is validated before conversion. */
type HousingType = 'cottage';
type HousingCapacity = { households: number; persons: number };
type EmploymentAllocation = { householdId: number; firmId: number; occupation: 'manufacturing' | 'retail'; rank: 'entry'; workers: number };
const SIZE = 24, GATEWAY = 12 * SIZE, MONTH = 30;
const WAGES = { I: 60_000, C: 42_000 } as const;
type Zone = 'R' | 'C' | 'I' | null;
type Cell = { road: boolean; zone: Zone; building: number | null };
type Building = { id: number; cell: number; zone: Exclude<Zone, null>; level: number; age: number; housingType?: HousingType };
type Household = { id: number; home: number | null; members: number; workforce: number; dependents: number; profile: 'legacy-worker' | 'single-worker' | 'family'; origin: 'legacy-v1' | 'arrival'; wallet: string; lastPurchaseTick: number; needs: number };
type Firm = { id: number; building: number; zone: 'C' | 'I'; wallet: string; workDays: Record<string, number>; inventory: number; profit: number; lastMonthProfit: number; monthlyRevenue: number; monthlyExpense: number };
type Entry = { tick: number; from: string; to: string; amount: number; reason: string };
type GoodsEntry = { tick: number; from: string; to: string; quantity: number; reason: string };
export type CityV2 = {
  version: 2; rulesVersion: 'household-1'; migration: { arrivals: number; legacyHouseholds: number }; employment: EmploymentAllocation[];
  seed: number; rng: number; tick: number; nextId: number;
  cells: Cell[]; buildings: Building[]; households: Household[]; firms: Firm[];
  accounts: Record<string, number>; ledger: Entry[]; goodsLedger: GoodsEntry[];
  goods: { produced: number; imported: number; consumed: number; exported: number };
  utilities: { power: boolean; water: boolean }; lastEvent: string;
};

const validIndex = (i: number) => Number.isInteger(i) && i >= 0 && i < SIZE * SIZE;
const balance = (c: CityV2, id: string) => c.accounts[id] ?? 0;
const capacity = (b: Building) => b.zone === 'I' ? b.level + 3 : b.zone === 'C' ? b.level : 0;
const payroll = (f: Firm) => Object.values(f.workDays).reduce((n, days) => n + days * WAGES[f.zone] / MONTH, 0);
const householdWorkerCount = (c: CityV2, id: number) => c.employment.filter(e => e.householdId === id).reduce((n, e) => n + e.workers, 0);
const firmWorkerCount = (c: CityV2, id: number) => c.employment.filter(e => e.firmId === id).reduce((n, e) => n + e.workers, 0);
const housingCapacity = (b: Building): HousingCapacity => b.zone === 'R' ? { households: b.level, persons: b.level * 4 } : { households: 0, persons: 0 };
function building(c: CityV2, id: number): Building { return c.buildings.find(b => b.id === id)!; }
function buildOccupancyIndex(households: readonly Household[]): Map<number, HousingCapacity> {
  const index = new Map<number, HousingCapacity>();
  for (const h of households) if (h.home !== null) { const prior = index.get(h.home) ?? { households: 0, persons: 0 }; index.set(h.home, { households: prior.households + 1, persons: prior.persons + h.members }); }
  return index;
}
function validateV2(c: CityV2): CityV2 {
  const fail = (): never => { throw new Error('Unsupported or corrupt CityManager household save (expected version 2 / household-1).'); };
  const int = (v: unknown, min = 0): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= min;
  if (!c || c.version !== 2 || c.rulesVersion !== 'household-1' || !int(c.seed) || c.seed > 4294967295 || !int(c.rng) || c.rng > 4294967295 || !int(c.tick) || !int(c.nextId, 1) || c.nextId > Number.MAX_SAFE_INTEGER - 2 || typeof c.lastEvent !== 'string') fail();
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
    if (!e || !int(e.householdId, 1) || !int(e.firmId, 1) || !int(e.workers, 1) || e.rank !== 'entry') fail();
    const h = c.households.find(h => h.id === e.householdId), f = c.firms.find(f => f.id === e.firmId), pair = `${e.householdId}:${e.firmId}`;
    if (!h || h.home === null || !f || e.occupation !== (f.zone === 'I' ? 'manufacturing' : 'retail') || pairs.has(pair)) fail();
    pairs.add(pair);
  }
  for (const h of c.households) if (householdWorkerCount(c, h.id) > h.workforce || c.firms.reduce((n, f) => n + (f.workDays[h.wallet] ?? 0), 0) > h.workforce * (c.tick % MONTH)) fail();
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


/** Strict legacy validation only; returning data does not repair or advance it. */
export function deserializeV2(json: string): CityV2 {
  if (typeof json !== 'string' || json.length > 12_000_000) throw new Error('Save is too large or invalid.');
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { throw new Error('Save is not valid JSON.'); }
  return validateV2(parsed as CityV2);
}
