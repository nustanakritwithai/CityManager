/** Pure simulation: one deterministic tick is one day; all money is integer satang. */
export const SIZE = 24;
export const GATEWAY = 12 * SIZE;
export const MONTH = 30;
export const ROAD_COST = 5_000;
export const WAGES = { I: 60_000, C: 42_000 } as const;
export type Zone = 'R' | 'C' | 'I' | null;
export type Cell = { road: boolean; zone: Zone; building: number | null };
export type Building = { id: number; cell: number; zone: Exclude<Zone, null>; level: number; age: number };
export type Household = { id: number; home: number; employer: number | null; wallet: string; lastPurchaseTick: number; needs: number };
export type Firm = { id: number; building: number; zone: 'C' | 'I'; wallet: string; employees: number[]; workDays: Record<string, number>; inventory: number; profit: number; lastMonthProfit: number; monthlyRevenue: number; monthlyExpense: number };
export type Entry = { tick: number; from: string; to: string; amount: number; reason: string };
export type GoodsEntry = { tick: number; from: string; to: string; quantity: number; reason: string };
export type City = {
  version: 1; seed: number; rng: number; tick: number; nextId: number;
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
function random(c: City): number { c.rng = (Math.imul(c.rng, 1664525) + 1013904223) >>> 0; return c.rng / 4294967296; }

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
    const leaving = c.households.filter(h => h.home === b.id), closing = c.firms.filter(f => f.building === b.id);
    for (const h of leaving) {
      for (const f of c.firms) if (f.workDays[h.wallet]) payWages(c, f, h.wallet);
      transfer(c, h.wallet, 'outside', balance(c, h.wallet), 'Emigration savings');
    }
    for (const f of closing) {
      payWages(c, f);
      transfer(c, f.wallet, 'outside', balance(c, f.wallet), 'Firm liquidation');
      goodsTransfer(c, f.wallet, 'outside', f.inventory, 'Demolition stock write-off to outside'); c.goods.exported += f.inventory;
      for (const h of c.households) if (h.employer === f.id) h.employer = null;
    }
    c.households = c.households.filter(h => h.home !== b.id); c.firms = c.firms.filter(f => f.building !== b.id);
    c.buildings = c.buildings.filter(v => v.id !== b.id);
    for (const f of c.firms) f.employees = f.employees.filter(id => c.households.some(h => h.id === id));
  }
  cell.road = false; cell.zone = null; cell.building = null;
  c.lastEvent = 'Parcel cleared. Disconnected buildings stop recruiting, trading and growing.';
  return { ok: true, message: c.lastEvent };
}

export function summary(c: City) {
  const jobs = c.firms.filter(f => access(c, building(c, f.building).cell)).reduce((n, f) => n + capacity(building(c, f.building)), 0);
  const employed = c.households.filter(h => h.employer !== null).length;
  const availableWorkers = c.households.filter(h => h.employer === null && access(c, building(c, h.home).cell)).length;
  const shops = c.firms.filter(f => f.zone === 'C').length;
  const recent = c.ledger.filter(e => e.tick > Math.max(0, c.tick - MONTH) && !e.reason.includes('grant'));
  const net = recent.reduce((n, e) => n + (e.to === 'treasury' ? e.amount : 0) - (e.from === 'treasury' ? e.amount : 0), 0);
  return { population: c.households.length, jobs, employed, treasury: balance(c, 'treasury'), net,
    demand: { R: Math.max(0, jobs - employed, 2 - c.households.length), C: Math.max(0, Math.floor(c.households.length / 4) - shops), I: c.firms.some(f => f.zone === 'I') ? (availableWorkers > 0 && jobs - employed < 2 ? 1 : 0) : 1 } };
}
function building(c: City, id: number): Building { return c.buildings.find(b => b.id === id)!; }
function blockers(c: City, i: number): string[] {
  const cell = c.cells[i];
  if (!cell.zone) return ['No R/C/I zoning.'];
  const reasons: string[] = [], s = summary(c);
  if (!access(c, i)) reasons.push('No connected road frontage. Connect an adjacent road to the west outside gateway.');
  if (!c.utilities.power) reasons.push('No power: prototype outside power supply is unavailable.');
  if (!c.utilities.water) reasons.push('No water: prototype outside water supply is unavailable.');
  if (c.buildings.length >= 192) reasons.push('Prototype building limit (192) reached.');
  if (cell.zone === 'R') {
    if (c.households.length >= 128) reasons.push('Household limit (128) reached.');
    if (s.demand.R <= 0) reasons.push('No housing demand: all jobs are filled. Add viable employment.');
    if (WAGES.C * .9 - 30 * 800 - 10_000 <= 0) reasons.push('Expected income cannot cover purchases and rent.');
  } else {
    if (c.firms.length >= 64) reasons.push('Firm limit (64) reached.');
    if (cell.zone === 'C') {
      const residents = c.households.filter(h => access(c, building(c, h.home).cell) && balance(c, h.wallet) >= 800).length;
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
  const b = building(c, cell.building), f = c.firms.find(v => v.building === b.id), h = c.households.find(v => v.home === b.id);
  const output = [`${b.zone === 'R' ? 'Home' : b.zone === 'C' ? 'Shop' : 'Factory'} #${b.id} · level ${b.level} · age ${b.age} days`, access(c, i) ? 'Connected road frontage.' : 'Disconnected: employment, purchases, production and height growth are suspended.'];
  if (!c.utilities.power || !c.utilities.water) output.push('Outside utility supply unavailable; production and growth suspended.');
  if (h) output.push(`Household #${h.id}: wallet ${(balance(c, h.wallet) / 100).toFixed(2)} credits; ${h.employer === null ? 'unemployed' : `employed by firm #${h.employer}`}.`, h.lastPurchaseTick === c.tick ? 'Purchased 1 good today from a reachable stocked shop.' : `No purchase today: needs ${h.needs}; requires funds and a connected stocked shop.`, 'Rent 100 credits/month. Height upgrade requires employment, a recent purchase, age ≥30 days and ≥200 credits savings.');
  if (f) output.push(`Firm #${f.id}: ${f.employees.length}/${capacity(b)} workers; inventory ${f.inventory}; wallet ${(balance(c, f.wallet) / 100).toFixed(2)} credits; earned wages reserved ${(payroll(f) / 100).toFixed(2)}.`, `Last monthly operating profit ${(f.lastMonthProfit / 100).toFixed(2)} credits.`, f.employees.length === 0 ? 'Idle: needs a connected available worker and cash to reserve daily wages. Zone connected homes or restore cash flow.' : f.zone === 'I' ? 'Produces 8 goods/worker/day; sells locally at 3 credits or exports at 3.50.' : 'Buys local goods at 3 credits or imports at 4.50; sells to individual households at 8 credits.', 'Wages accrue per day worked and are paid each 30-day month. Reserved wages cannot fund stock or expansion.', 'Rent 100 credits/month; positive profit tax 20%. Height upgrade requires a profitable month, workers and construction funds.');
  return output;
}
function createBuilding(c: City, i: number) {
  const zone = c.cells[i].zone!, id = c.nextId++;
  const b: Building = { id, cell: i, zone, level: 1, age: 0 }; c.buildings.push(b); c.cells[i].building = id;
  if (zone === 'R') {
    transfer(c, 'outside', 'construction', 40_000, 'Outside residential developer investment');
    const hid = c.nextId++, wallet = `household:${hid}`;
    c.households.push({ id: hid, home: id, employer: null, wallet, lastPurchaseTick: -1, needs: 0 });
    transfer(c, 'outside', wallet, 150_000, 'New household arrival savings');
  } else {
    const fid = c.nextId++, wallet = `firm:${fid}`;
    c.firms.push({ id: fid, building: id, zone, wallet, employees: [], workDays: {}, inventory: 0, profit: 0, lastMonthProfit: 0, monthlyRevenue: 0, monthlyExpense: 0 });
    transfer(c, 'outside', wallet, 300_000, 'Outside firm equity investment');
    transfer(c, wallet, 'construction', 40_000, 'Firm building investment');
  }
  c.lastEvent = `${zone} building #${id} grew: road + utilities + demand + viable expected rent. Initial investment is recorded in the ledger.`;
}
function employ(c: City) {
  for (const f of c.firms) f.employees = [];
  for (const h of c.households) {
    const home = building(c, h.home), prior = c.firms.find(f => f.id === h.employer);
    h.employer = null;
    if (!access(c, home.cell)) continue;
    const available = c.firms.filter(f => access(c, building(c, f.building).cell) && f.employees.length < capacity(building(c, f.building)) && spendable(c, f) >= WAGES[f.zone] / MONTH);
    const f = available.find(f => f === prior) ?? available.sort((a, b) => b.employees.length / capacity(building(c, b.building)) - a.employees.length / capacity(building(c, a.building)) || a.id - b.id)[0];
    if (f) { h.employer = f.id; f.employees.push(h.id); f.workDays[h.wallet] = (f.workDays[h.wallet] ?? 0) + 1; }
  }
}
function trade(c: City) {
  const active = c.firms.filter(f => access(c, building(c, f.building).cell));
  if (c.utilities.power && c.utilities.water) for (const f of active.filter(f => f.zone === 'I')) {
    const made = f.employees.length * 8;
    f.inventory += made; c.goods.produced += made; goodsTransfer(c, 'production', f.wallet, made, 'Daily worker production');
  }
  for (const shop of active.filter(f => f.zone === 'C' && f.employees.length > 0)) {
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
    if (!access(c, building(c, h.home).cell) || balance(c, h.wallet) < 800) continue;
    const shops = active.filter(f => f.zone === 'C' && f.employees.length > 0 && f.inventory > 0);
    const shop = shops.length ? shops[Math.floor(random(c) * shops.length)] : null;
    if (shop) {
      transfer(c, h.wallet, shop.wallet, 800, `Household #${h.id} purchase`, true);
      shop.inventory--; c.goods.consumed++; h.lastPurchaseTick = c.tick; h.needs = 0;
      goodsTransfer(c, shop.wallet, h.wallet, 1, 'Household final consumption');
    }
  }
  for (const f of active.filter(f => f.zone === 'I' && f.employees.length > 0)) {
    const exported = Math.min(f.inventory, f.employees.length * 8);
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
  for (const h of c.households) transfer(c, h.wallet, 'landlord', 10_000, 'Monthly household rent');
  c.lastEvent = 'Month settled: actual firm wages, household rent and taxes are in the money ledger.';
}
function grow(c: City) {
  const eligible = c.cells.map((cell, i) => cell.zone && cell.building === null && !blockers(c, i).length ? i : -1).filter(i => i >= 0);
  if (eligible.length) createBuilding(c, eligible[Math.floor(random(c) * eligible.length)]);
  if (c.tick % MONTH !== 0) return;
  for (const b of c.buildings) {
    if (b.level >= 3 || b.age < MONTH || !access(c, b.cell) || !c.utilities.power || !c.utilities.water) continue;
    const h = c.households.find(h => h.home === b.id), f = c.firms.find(f => f.building === b.id);
    if (h && h.employer !== null && c.tick - h.lastPurchaseTick <= 3 && balance(c, h.wallet) >= 20_000) {
      transfer(c, 'outside', 'construction', 20_000, 'Outside residential height investment'); b.level++;
    } else if (f && f.lastMonthProfit > 0 && f.employees.length > 0 && balance(c, f.wallet) >= 20_000) {
      transfer(c, f.wallet, 'construction', 20_000, 'Profitable firm height investment'); b.level++;
    }
  }
}
export function step(c: City): void {
  c.tick++; for (const b of c.buildings) b.age++;
  employ(c); trade(c);
  transfer(c, 'treasury', 'upkeep', c.cells.filter(cell => cell.road).length * 10, 'Daily road upkeep');
  if (c.tick % MONTH === 0) settleMonth(c);
  if (c.tick % 3 === 0) grow(c);
}
export function createCity(seed = 20261023): City {
  const safeSeed = Number.isSafeInteger(seed) ? seed >>> 0 : 20261023;
  const c: City = { version: 1, seed: safeSeed, rng: safeSeed, tick: 0, nextId: 1,
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

/** Reject incompatible or corrupt saves before replacing the running state. Never execute save content. */
export function deserialize(json: string): City {
  if (typeof json !== 'string' || json.length > 12_000_000) throw new Error('Save is too large or invalid.');
  let c: City;
  try { c = JSON.parse(json); } catch { throw new Error('Save is not valid JSON.'); }
  const fail = () => { throw new Error('Unsupported or corrupt CityManager save (expected version 1).'); };
  const int = (v: unknown, min = 0) => typeof v === 'number' && Number.isSafeInteger(v) && v >= min;
  if (!c || c.version !== 1 || !int(c.seed) || c.seed > 4294967295 || !int(c.rng) || c.rng > 4294967295 || !int(c.tick) || !int(c.nextId, 1) || typeof c.lastEvent !== 'string') fail();
  if (!Array.isArray(c.cells) || c.cells.length !== SIZE * SIZE || !Array.isArray(c.buildings) || c.buildings.length > 192 || !Array.isArray(c.households) || c.households.length > 128 || !Array.isArray(c.firms) || c.firms.length > 64) fail();
  if (!c.utilities || typeof c.utilities.power !== 'boolean' || typeof c.utilities.water !== 'boolean' || !c.goods || !['produced', 'imported', 'consumed', 'exported'].every(k => int(c.goods[k as keyof typeof c.goods]))) fail();
  if (!c.accounts || typeof c.accounts !== 'object' || Array.isArray(c.accounts) || !['outside', 'treasury', 'construction', 'roadworks', 'upkeep', 'landlord'].every(k => int(c.accounts[k], k === 'outside' ? Number.MIN_SAFE_INTEGER : 0)) || !Object.entries(c.accounts).every(([k, v]) => /^(outside|treasury|construction|roadworks|upkeep|landlord|household:\d+|firm:\d+)$/.test(k) && int(v, k === 'outside' ? Number.MIN_SAFE_INTEGER : 0)) || Object.values(c.accounts).reduce((a, b) => a + b, 0) !== 0) fail();
  for (const cell of c.cells) if (!cell || typeof cell.road !== 'boolean' || ![null, 'R', 'C', 'I'].includes(cell.zone) || !(cell.building === null || int(cell.building, 1)) || (cell.road && (cell.zone !== null || cell.building !== null))) fail();
  if (!c.cells[GATEWAY].road) fail();
  const ids = new Set<number>();
  for (const b of c.buildings) {
    if (!b || !int(b.id, 1) || ids.has(b.id) || !validIndex(b.cell) || !['R', 'C', 'I'].includes(b.zone) || !int(b.level, 1) || b.level > 3 || !int(b.age) || c.cells[b.cell].building !== b.id || c.cells[b.cell].zone !== b.zone) fail();
    ids.add(b.id);
  }
  for (let i = 0; i < c.cells.length; i++) if (c.cells[i].building !== null && !c.buildings.some(b => b.id === c.cells[i].building && b.cell === i)) fail();
  for (const h of c.households) {
    if (!h || !int(h.id, 1) || ids.has(h.id) || !c.buildings.some(b => b.id === h.home && b.zone === 'R') || h.wallet !== `household:${h.id}` || !int(c.accounts[h.wallet]) || !(h.employer === null || int(h.employer, 1)) || !int(h.lastPurchaseTick, -1) || h.lastPurchaseTick > c.tick || !int(h.needs)) fail();
    ids.add(h.id);
  }
  for (const f of c.firms) {
    if (!f || !int(f.id, 1) || ids.has(f.id) || !['C', 'I'].includes(f.zone) || !c.buildings.some(b => b.id === f.building && b.zone === f.zone) || f.wallet !== `firm:${f.id}` || !int(c.accounts[f.wallet]) || !Array.isArray(f.employees) || new Set(f.employees).size !== f.employees.length || !int(f.inventory) || !int(f.profit, Number.MIN_SAFE_INTEGER) || !int(f.lastMonthProfit, Number.MIN_SAFE_INTEGER) || !int(f.monthlyRevenue) || !int(f.monthlyExpense)) fail();
    if (!f.workDays || typeof f.workDays !== 'object' || Array.isArray(f.workDays) || !Object.entries(f.workDays).every(([wallet, days]) => c.households.some(h => h.wallet === wallet) && int(days, 1) && days <= c.tick % MONTH) || !int(payroll(f)) || payroll(f) > balance(c, f.wallet)) fail();
    ids.add(f.id);
  }
  if (Math.max(0, ...ids) >= c.nextId || new Set(c.households.map(h => h.home)).size !== c.households.length || new Set(c.firms.map(f => f.building)).size !== c.firms.length) fail();
  for (const b of c.buildings) if (b.zone === 'R' ? !c.households.some(h => h.home === b.id) : !c.firms.some(f => f.building === b.id)) fail();
  for (const h of c.households) if (h.employer !== null && !c.firms.some(f => f.id === h.employer && f.employees.includes(h.id))) fail();
  for (const f of c.firms) if (f.employees.length > capacity(building(c, f.building)) || f.employees.some(id => !c.households.some(h => h.id === id && h.employer === f.id))) fail();
  if (c.goods.produced + c.goods.imported - c.goods.consumed - c.goods.exported !== c.firms.reduce((n, f) => n + f.inventory, 0)) fail();
  if (!Array.isArray(c.ledger) || !Array.isArray(c.goodsLedger)) fail();
  for (const e of c.ledger) if (!e || !int(e.tick) || e.tick > c.tick || !int(e.amount, 1) || typeof e.reason !== 'string' || typeof e.from !== 'string' || typeof e.to !== 'string' || !(e.from in c.accounts) || !(e.to in c.accounts) || e.from === e.to) fail();
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
