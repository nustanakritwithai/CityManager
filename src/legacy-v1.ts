/** Frozen strict v1 types/reader. Preserve original validation before v2 migration. */
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
const SIZE=24, GATEWAY=12*SIZE, MONTH=30; const WAGES={I:60000,C:42000} as const;
const validIndex=(i:number)=>Number.isInteger(i)&&i>=0&&i<SIZE*SIZE;
const balance=(c:City,id:string)=>c.accounts[id]??0;
const capacity=(b:Building)=>b.zone==="I"?b.level+3:b.zone==="C"?b.level:0;
const payroll=(f:Firm)=>Object.values(f.workDays).reduce((n,days)=>n+days*WAGES[f.zone]/MONTH,0);
function building(c:City,id:number):Building{return c.buildings.find(b=>b.id===id)!;}
/** Reject incompatible or corrupt saves before replacing the running state. Never execute save content. */
export function deserializeV1(json: string): City {
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
