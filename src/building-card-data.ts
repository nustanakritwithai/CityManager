/** Read-only card projections. Wallet flows are cash movements, never a profit-and-loss claim. */
import { MONTH, housingCapacity, isMarket, type City, type Building, type Household, type Firm } from './sim.ts';

export type BuildingCardKind = 'house' | 'shop' | 'market' | 'factory' | 'farm';
export type CardKind = BuildingCardKind | 'household';
export type CardWindow = { fromTick: number; toTick: number; inclusive: true; maxDays: 30; empty: boolean };
export type CardIdentity = { buildingId: number | null; firmId: number | null; householdId: number | null; cell: number | null };
export type CardCash = { current: number | null; inflow: number | null; outflow: number | null; net: number | null; wallets: string[]; basis: 'wallet-boundary' };
export type CardStocks = { goods: number | null; crops: number | null; cropCostSatang: number | null };
export type CardQuantities = { goodsIn: number | null; goodsOut: number | null; cropsIn: number | null; cropsOut: number | null };
export type CardToday = { cropHarvested: number | null; cropProcessed: number | null; goodsProduced: number | null; cropConsumed: number | null; goodsConsumed: number | null };
export type CardWorkforce = { members: number | null; workforce: number | null; employed: number | null; employeeWorkers: number | null; ownerWorkers: number | null; dependents: number | null };
export type CardPrice = { status: 'observed' | 'missing' | 'ambiguous' | 'unsafe' | 'non-integer'; unitSatang: number | null; cashSatang: number | null; quantity: number | null; events: number; basis: 'paired-journals' };
export type CardPrices = { goodsBuy: CardPrice; goodsSell: CardPrice; cropsBuy: CardPrice; cropsSell: CardPrice };
type CommonCardData = { kind: CardKind; identity: CardIdentity; window: CardWindow; cash: CardCash; stocks: CardStocks; quantities: CardQuantities; today: CardToday; workforce: CardWorkforce; prices: CardPrices; missing: string[] };
export type HouseholdCardData = CommonCardData & { kind: 'household'; homeBuildingId: number | null };
export type HouseCardData = CommonCardData & { kind: 'house'; households: HouseholdCardData[]; occupancy: { households: number; persons: number | null; householdCapacity: number | null; personCapacity: number | null }; scope: 'current-linked-household-wallets' };
export type FirmCardData = CommonCardData & { kind: 'shop' | 'market' | 'factory' | 'farm'; scope: 'establishment-wallet' };
export type BuildingCardData = HouseCardData | FirmCardData;
const MAX = BigInt(Number.MAX_SAFE_INTEGER);
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const positive = (value: unknown): value is number => count(value) && value > 0;
const total = (values: unknown[]): number | null => {
  let result = 0n;
  for (const value of values) { if (!count(value)) return null; result += BigInt(value); if (result > MAX) return null; }
  return Number(result);
};
const currentCount = (value: unknown): number | null => count(value) ? value : null;
export function cardWindow(tick: number): CardWindow | null {
  return count(tick) ? { fromTick: Math.max(0, tick - MONTH + 1), toTick: tick, inclusive: true, maxDays: 30, empty: tick === 0 } : null;
}
const inWindow = (window: CardWindow, tick: number) => !window.empty && count(tick) && tick >= window.fromTick && tick <= window.toTick;
const key = (tick: number, from: string, to: string, reason: string) => JSON.stringify([tick, from, to, reason]);
type PriceEvent = { commodity: 'goods' | 'crops'; from: string; to: string; tick: number; quantity: number | null; cash: number | null; status: 'observed' | 'ambiguous' | 'unsafe' };
type Projection = { city: City; window: CardWindow; priceEvents: PriceEvent[] };

function projection(city: City): Projection | null {
  const window = cardWindow(city.tick); if (!window) return null;
  const cashRows = new Map<string, City['ledger']>();
  for (const entry of city.ledger) {
    const k = key(entry.tick, entry.from, entry.to, entry.reason), rows = cashRows.get(k) ?? [];
    rows.push(entry); cashRows.set(k, rows);
  }
  const goodsCounts = new Map<string, number>(), cropCounts = new Map<string, number>();
  for (const e of city.goodsLedger) { const k = key(e.tick, e.from, e.to, e.reason); goodsCounts.set(k, (goodsCounts.get(k) ?? 0) + 1); }
  for (const e of city.cropLedger) { const k = key(e.tick, e.from, e.to, e.reason); cropCounts.set(k, (cropCounts.get(k) ?? 0) + 1); }
  const priceEvents: PriceEvent[] = [];
  const pair = (commodity: PriceEvent['commodity'], e: { tick: number; from: string; to: string; quantity: number; reason: string }, moneyReason: string | null, physicalCount: number, expectedCash?: number) => {
    if (!inWindow(window, e.tick)) return;
    const matches = moneyReason === null ? [] : cashRows.get(key(e.tick, e.to, e.from, moneyReason)) ?? [];
    const quantity = positive(e.quantity) ? e.quantity : null, cash = matches.length === 1 && positive(matches[0].amount) ? matches[0].amount : null;
    const unsafe = quantity === null || matches.length === 1 && cash === null || expectedCash !== undefined && !positive(expectedCash);
    const unambiguous = !unsafe && physicalCount === 1 && matches.length === 1 && (expectedCash === undefined || expectedCash === cash);
    priceEvents.push({ commodity, from: e.from, to: e.to, tick: e.tick, quantity, cash, status: unsafe ? 'unsafe' : unambiguous ? 'observed' : 'ambiguous' });
  };
  for (const e of city.goodsLedger) {
    if (e.from === 'production' || e.reason === 'Demolition stock write-off to outside') continue;
    let reason: string | null = null;
    if (e.reason === 'Wholesale stock delivery') reason = 'Local wholesale goods';
    else if (e.reason === 'Imported shop stock') reason = 'Outside goods import';
    else if (e.reason === 'Exported goods') reason = 'Outside market goods export';
    else if (e.reason === 'Household final consumption' && /^household:[1-9][0-9]*$/.test(e.to)) reason = 'Household #' + e.to.slice(10) + ' purchase';
    pair('goods', e, reason, goodsCounts.get(key(e.tick, e.from, e.to, e.reason)) ?? 0);
  }
  for (const e of city.cropLedger) if (e.kind === 'trade' || e.kind === 'consumption') pair('crops', e, e.reason, cropCounts.get(key(e.tick, e.from, e.to, e.reason)) ?? 0, e.cash);
  return { city, window, priceEvents };
}
function price(events: PriceEvent[]): CardPrice {
  const empty = (status: CardPrice['status']): CardPrice => ({ status, unitSatang: null, cashSatang: null, quantity: null, events: events.length, basis: 'paired-journals' });
  if (!events.length) return empty('missing');
  if (events.some(e => e.status === 'unsafe')) return empty('unsafe');
  if (events.some(e => e.status !== 'observed')) return empty('ambiguous');
  const cashSatang = total(events.map(e => e.cash)), quantity = total(events.map(e => e.quantity));
  if (cashSatang === null || quantity === null || quantity === 0) return empty('unsafe');
  if (BigInt(cashSatang) % BigInt(quantity) !== 0n) return { ...empty('non-integer'), cashSatang, quantity };
  return { status: 'observed', unitSatang: Number(BigInt(cashSatang) / BigInt(quantity)), cashSatang, quantity, events: events.length, basis: 'paired-journals' };
}
function workforce(city: City, households: Household[] | null, firm: Firm | null): CardWorkforce {
  const byHouseholds = households !== null, ids = new Set(households?.map(h => h.id));
  const employee = city.employment.filter(e => byHouseholds ? ids.has(e.householdId) : firm !== null && e.firmId === firm.id);
  const owner = city.ownerLabor.filter(e => byHouseholds ? ids.has(e.householdId) : firm !== null && e.firmId === firm.id);
  const employeeWorkers = total(employee.map(e => e.workers)), ownerWorkers = total(owner.map(e => e.workers));
  const employed = employeeWorkers === null || ownerWorkers === null ? null : total([employeeWorkers, ownerWorkers]);
  return {
    members: households === null ? null : total(households.map(h => h.members)),
    workforce: households === null ? null : total(households.map(h => h.workforce)),
    dependents: households === null ? null : total(households.map(h => h.dependents)),
    employeeWorkers: firm === null && households === null ? null : employeeWorkers,
    ownerWorkers: firm === null && households === null ? null : ownerWorkers,
    employed: firm === null && households === null ? null : employed,
  };
}
function common(context: Projection, kind: CardKind, identity: CardIdentity, wallets: string[] | null, households: Household[] | null, firm: Firm | null): CommonCardData {
  const { city, window } = context, selected = new Set(wallets ?? []), missing: string[] = [];
  const boundary = (from: string, to: string) => selected.has(from) !== selected.has(to);
  const sum = <T>(entries: T[], predicate: (entry: T) => boolean, value: (entry: T) => unknown) => total(entries.filter(predicate).map(value));
  const cashRows = city.ledger.filter(e => inWindow(window, e.tick) && boundary(e.from, e.to));
  const current = wallets === null ? null : total(wallets.map(wallet => city.accounts[wallet]));
  const inflow = wallets === null ? null : sum(cashRows, e => selected.has(e.to), e => positive(e.amount) ? e.amount : null);
  const outflow = wallets === null ? null : sum(cashRows, e => selected.has(e.from), e => positive(e.amount) ? e.amount : null);
  const cash: CardCash = { current, inflow, outflow, net: inflow === null || outflow === null ? null : inflow - outflow, wallets: [...(wallets ?? [])], basis: 'wallet-boundary' };
  const goods = city.goodsLedger.filter(e => inWindow(window, e.tick) && boundary(e.from, e.to)), crops = city.cropLedger.filter(e => inWindow(window, e.tick) && boundary(e.from, e.to));
  const quantities: CardQuantities = {
    goodsIn: wallets === null ? null : sum(goods, e => selected.has(e.to), e => positive(e.quantity) ? e.quantity : null),
    goodsOut: wallets === null ? null : sum(goods, e => selected.has(e.from), e => positive(e.quantity) ? e.quantity : null),
    cropsIn: wallets === null ? null : sum(crops, e => selected.has(e.to), e => positive(e.quantity) ? e.quantity : null),
    cropsOut: wallets === null ? null : sum(crops, e => selected.has(e.from), e => positive(e.quantity) ? e.quantity : null),
  };
  const todayGoods = city.goodsLedger.filter(e => !window.empty && e.tick === city.tick), todayCrops = city.cropLedger.filter(e => !window.empty && e.tick === city.tick);
  const today: CardToday = {
    cropHarvested: wallets === null ? null : sum(todayCrops, e => e.kind === 'harvest' && selected.has(e.to), e => positive(e.quantity) ? e.quantity : null),
    cropProcessed: wallets === null ? null : sum(todayCrops, e => e.kind === 'process' && selected.has(e.from), e => positive(e.quantity) ? e.quantity : null),
    goodsProduced: wallets === null ? null : sum(todayGoods, e => e.from === 'production' && selected.has(e.to), e => positive(e.quantity) ? e.quantity : null),
    cropConsumed: wallets === null ? null : sum(todayCrops, e => e.kind === 'consumption' && selected.has(e.to), e => positive(e.quantity) ? e.quantity : null),
    goodsConsumed: wallets === null ? null : sum(todayGoods, e => e.reason === 'Household final consumption' && selected.has(e.to), e => positive(e.quantity) ? e.quantity : null),
  };
  const observed = context.priceEvents.filter(e => boundary(e.from, e.to));
  const prices: CardPrices = {
    goodsBuy: price(observed.filter(e => e.commodity === 'goods' && selected.has(e.to))),
    goodsSell: price(observed.filter(e => e.commodity === 'goods' && selected.has(e.from))),
    cropsBuy: price(observed.filter(e => e.commodity === 'crops' && selected.has(e.to))),
    cropsSell: price(observed.filter(e => e.commodity === 'crops' && selected.has(e.from))),
  };
  const stocks: CardStocks = firm ? { goods: currentCount(firm.inventory), crops: currentCount(firm.cropInventory), cropCostSatang: currentCount(firm.cropCost) } : { goods: null, crops: null, cropCostSatang: null };
  const labor = workforce(city, households, firm);
  for (const [group, data] of Object.entries({ cash, quantities, today, workforce: labor })) for (const [field, value] of Object.entries(data)) if (value === null) missing.push(group + '.' + field);
  if (firm) for (const [field, value] of Object.entries(stocks)) if (value === null) missing.push('stocks.' + field);
  return { kind, identity, window: { ...window }, cash, stocks, quantities, today, workforce: labor, prices, missing };
}
function household(context: Projection, h: Household): HouseholdCardData {
  const home = context.city.buildings.find(b => b.id === h.home && b.zone === 'R');
  return { ...common(context, 'household', { buildingId: h.home, householdId: h.id, firmId: null, cell: home?.cell ?? null }, typeof h.wallet === 'string' ? [h.wallet] : null, [h], null), kind: 'household', homeBuildingId: h.home };
}
/** A house displays its currently linked households' wallet views, not property ownership value. */
export function buildingCardData(city: City, buildingId: number): BuildingCardData | null {
  if (!positive(buildingId)) return null;
  const building = city.buildings.find(b => b.id === buildingId), context = projection(city);
  if (!building || !context) return null;
  if (building.zone === 'R') {
    const residents = city.households.filter(h => h.home === building.id), children = residents.map(h => household(context, h));
    const data = common(context, 'house', { buildingId: building.id, firmId: null, householdId: null, cell: building.cell }, residents.every(h => typeof h.wallet === 'string') ? residents.map(h => h.wallet) : null, residents, null);
    let householdCapacity: number | null = null, personCapacity: number | null = null;
    try { const capacity = housingCapacity(building); householdCapacity = currentCount(capacity.households); personCapacity = currentCount(capacity.persons); } catch { data.missing.push('occupancy.capacity'); }
    return { ...data, kind: 'house', scope: 'current-linked-household-wallets', households: children, occupancy: { households: residents.length, persons: total(residents.map(h => h.members)), householdCapacity, personCapacity } };
  }
  const firm = city.firms.find(f => f.building === building.id && f.zone === building.zone) ?? null;
  const kind = building.zone === 'C' ? firm && isMarket(firm) ? 'market' : 'shop' : building.zone === 'I' ? 'factory' : 'farm';
  const data = common(context, kind, { buildingId: building.id, firmId: firm?.id ?? null, householdId: null, cell: building.cell }, firm ? [firm.wallet] : null, null, firm);
  if (!firm) data.missing.push('firm');
  return { ...data, kind, scope: 'establishment-wallet' };
}
export function householdCardData(city: City, householdId: number): HouseholdCardData | null {
  if (!positive(householdId)) return null;
  const context = projection(city), h = city.households.find(h => h.id === householdId);
  return context && h ? household(context, h) : null;
}
