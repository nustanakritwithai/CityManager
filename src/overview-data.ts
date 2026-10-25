/**
 * Read-only projections for the city overview dashboard. Every number is derived from
 * the money, goods and crop journals the simulator already records; nothing is mutated.
 */
import { MONTH, isMarket, type City } from './sim.ts';

export type TreasuryPoint = { tick: number; balance: number };
/** End-of-day treasury balances for the last `days` days, rebuilt backwards from today. */
export function treasuryHistory(city: City, days = MONTH): TreasuryPoint[] {
  const net = new Map<number, number>();
  for (const e of city.ledger) {
    if (e.tick <= city.tick - days) continue;
    const delta = (e.to === 'treasury' ? e.amount : 0) - (e.from === 'treasury' ? e.amount : 0);
    if (delta) net.set(e.tick, (net.get(e.tick) ?? 0) + delta);
  }
  const points: TreasuryPoint[] = [];
  let balance = city.accounts.treasury ?? 0;
  for (let tick = city.tick; tick > city.tick - days && tick >= 0; tick--) {
    points.push({ tick, balance });
    balance -= net.get(tick) ?? 0;
  }
  return points.reverse();
}

export type BudgetLine = { key: string; label: string; amount: number };
const INCOME: readonly [RegExp, string, string][] = [
  [/^Monthly household wage tax$/, 'wage-tax', 'ภาษีค่าจ้าง 10%'],
  [/firm profit tax$/i, 'profit-tax', 'ภาษีกำไรกิจการ 20%'],
  [/grant/i, 'grant', 'ทุนอุดหนุน'],
];
const EXPENSE: readonly [RegExp, string, string][] = [
  [/^Build \d+ road cells$/, 'roads', 'สร้างถนน'],
  [/^Daily road upkeep$/, 'upkeep', 'บำรุงถนน'],
  [/demolition/i, 'demolition', 'รื้อถอน'],
];
/** Treasury income and spending by kind over the inclusive 30-day window. */
export function treasuryBudget(city: City, days = MONTH): { income: BudgetLine[]; expense: BudgetLine[]; net: number } {
  const fromTick = Math.max(0, city.tick - days + 1), income = new Map<string, BudgetLine>(), expense = new Map<string, BudgetLine>();
  const add = (map: Map<string, BudgetLine>, rules: typeof INCOME, reason: string, amount: number) => {
    const rule = rules.find(([pattern]) => pattern.test(reason)), key = rule?.[1] ?? 'other', label = rule?.[2] ?? 'อื่นๆ';
    const line = map.get(key) ?? { key, label, amount: 0 }; line.amount += amount; map.set(key, line);
  };
  for (const e of city.ledger) {
    if (e.tick < fromTick || e.tick > city.tick) continue;
    if (e.to === 'treasury') add(income, INCOME, e.reason, e.amount);
    if (e.from === 'treasury') add(expense, EXPENSE, e.reason, e.amount);
  }
  const sort = (m: Map<string, BudgetLine>) => [...m.values()].sort((a, b) => b.amount - a.amount);
  const i = sort(income), x = sort(expense);
  return { income: i, expense: x, net: i.reduce((n, l) => n + l.amount, 0) - x.reduce((n, l) => n + l.amount, 0) };
}

export type ChainNode = 'farm' | 'market' | 'factory' | 'shop' | 'household' | 'outside';
export type ChainFlow = { from: ChainNode; to: ChainNode; commodity: 'crops' | 'goods'; quantity: number };
export type SupplyChain = { flows: ChainFlow[]; harvested: number; processed: number; produced: number; window: { fromTick: number; toTick: number } };
export const CHAIN_ROUTES: readonly Omit<ChainFlow, 'quantity'>[] = Object.freeze([
  { from: 'farm', to: 'market', commodity: 'crops' }, { from: 'farm', to: 'factory', commodity: 'crops' },
  { from: 'market', to: 'factory', commodity: 'crops' }, { from: 'market', to: 'household', commodity: 'crops' },
  { from: 'factory', to: 'shop', commodity: 'goods' }, { from: 'outside', to: 'shop', commodity: 'goods' },
  { from: 'shop', to: 'household', commodity: 'goods' }, { from: 'factory', to: 'outside', commodity: 'goods' },
]);

/** Crop and goods movements between kinds of establishments over the last 30 days. */
export function supplyChain(city: City, days = MONTH): SupplyChain {
  const fromTick = Math.max(0, city.tick - days + 1), inWindow = (tick: number) => tick >= fromTick && tick <= city.tick;
  const kindOf = (wallet: string): ChainNode | null => {
    if (wallet === 'outside') return 'outside';
    if (wallet.startsWith('household:')) return 'household';
    const firm = city.firms.find(f => f.wallet === wallet);
    if (!firm) return null;
    return firm.zone === 'F' ? 'farm' : firm.zone === 'I' ? 'factory' : isMarket(firm) ? 'market' : 'shop';
  };
  const totals = new Map<string, number>(), bump = (from: ChainNode | null, to: ChainNode | null, commodity: ChainFlow['commodity'], quantity: number) => {
    if (!from || !to) return; const key = `${from}>${to}>${commodity}`; totals.set(key, (totals.get(key) ?? 0) + quantity);
  };
  let harvested = 0, processed = 0, produced = 0;
  for (const e of city.cropLedger) {
    if (!inWindow(e.tick)) continue;
    if (e.kind === 'harvest') harvested += e.quantity;
    else if (e.kind === 'process') { processed += e.quantity; produced += e.outputQuantity; }
    else if (e.kind === 'trade' || e.kind === 'consumption') bump(kindOf(e.from), kindOf(e.to), 'crops', e.quantity);
  }
  for (const e of city.goodsLedger) {
    if (!inWindow(e.tick)) continue;
    if (e.reason === 'Wholesale stock delivery' || e.reason === 'Imported shop stock' || e.reason === 'Household final consumption' || e.reason === 'Exported goods') bump(kindOf(e.from), kindOf(e.to), 'goods', e.quantity);
  }
  return { flows: CHAIN_ROUTES.map(route => ({ ...route, quantity: totals.get(`${route.from}>${route.to}>${route.commodity}`) ?? 0 })), harvested, processed, produced, window: { fromTick, toTick: city.tick } };
}

/** The simulator checks industry expansion in this order; everything before the failing code passed. */
export const GROWTH_STEPS: readonly [string, string][] = Object.freeze([
  ['growth.utilities-unavailable', 'น้ำและไฟจากภายนอกพร้อม'],
  ['growth.no-industrial-parcel', 'มีแปลงโรงงานว่างที่เชื่อมถนน'],
  ['growth.vacancies-remain', 'งานว่างเดิมที่จ่ายค่าจ้างได้มีคนทำครบ'],
  ['growth.housing-unavailable', 'มีบ้านว่าง แปลงบ้าน หรือแรงงานว่างรองรับ'],
  ['growth.no-crop-buffer', 'มีพืชผลที่เข้าถึงได้อย่างน้อย 8 ล็อต'],
  ['growth.no-profitable-sponsor', 'มีโรงงานที่ทำกำไรและมีคนทำงานครบ'],
  ['growth.saving-capital', 'ผู้ลงทุนมีทุนพอหลังกันภาระ'],
]);
export type CheckState = 'pass' | 'fail' | 'pending' | 'skip';
export function growthChecklist(code: string): { label: string; state: CheckState }[] {
  if (code === 'growth.ready') return GROWTH_STEPS.map(([, label]) => ({ label, state: 'pass' }));
  // The first factory only needs utilities and a parcel; later checks do not apply to it.
  if (code === 'growth.bootstrap') return GROWTH_STEPS.map(([, label], i) => ({ label, state: i < 2 ? 'pass' : 'skip' }));
  const at = GROWTH_STEPS.findIndex(([step]) => step === code);
  return GROWTH_STEPS.map(([, label], i) => ({ label, state: at < 0 ? 'pending' : i < at ? 'pass' : i === at ? 'fail' : 'pending' }));
}
