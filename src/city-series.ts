/**
 * Daily time series for the dashboard charts, rebuilt from what a save already holds: the
 * retained money, goods and crop journals plus bounded daily checkpoints, household arrival
 * entries (population) and building ages (buildings standing today). Read-only.
 */
import { type City } from './sim.ts';

export type BuildingKind = 'shop' | 'I' | 'R' | 'F' | 'market';
/** Fixed entity order; chart colours follow this order so each kind keeps its colour everywhere. */
export const BUILDING_ORDER: readonly BuildingKind[] = Object.freeze(['shop', 'I', 'R', 'F']);
export type CityMarker = { tick: number; kind: 'building' | 'road' | 'arrival' | 'closure'; icon: string; text: string };
export type DailySeries = {
  ticks: number[];
  /** End-of-day treasury balance, satang. */
  treasury: number[];
  /** Treasury inflow and outflow per day, satang. */
  income: number[]; expense: number[];
  cropsHarvested: number[]; cropsProcessed: number[]; cropsConsumed: number[];
  goodsProduced: number[]; goodsConsumed: number[]; goodsExported: number[]; goodsImported: number[];
  population: number[]; households: number[];
  /** Buildings standing today, counted from the day each was built. */
  buildings: Record<BuildingKind, number[]>;
  markers: CityMarker[];
};

const KIND_NAME: Record<BuildingKind, string> = { shop: 'พาณิชย์ทุกระดับ', I: 'โรงงาน', R: 'บ้าน', F: 'ฟาร์ม', market: 'ตลาด' };
const KIND_ICON: Record<BuildingKind, string> = { shop: 'shop', I: 'I', R: 'R', F: 'F', market: 'market' };

/** Last requested days ending today; compacted cities expose at most 90 real daily bins. */
export function dailySeries(city: City, days = 30): DailySeries {
  const to = city.tick, requested = Number.isFinite(days) ? Math.max(0,to-Math.max(1,Math.floor(days))+1):0;
  const from=Math.max(requested,city.history?Math.max(0,to-89):0),n=to-from+1;
  const zeros = () => new Array<number>(n).fill(0), at = (tick: number) => tick - from;
  const inWindow = (tick: number) => tick >= from && tick <= to;
  const s: DailySeries = {
    ticks: Array.from({ length: n }, (_, i) => from + i), treasury: zeros(), income: zeros(), expense: zeros(),
    cropsHarvested: zeros(), cropsProcessed: zeros(), cropsConsumed: zeros(),
    goodsProduced: zeros(), goodsConsumed: zeros(), goodsExported: zeros(), goodsImported: zeros(),
    population: zeros(), households: zeros(), buildings: { shop: zeros(), I: zeros(), R: zeros(), F: zeros(), market: zeros() }, markers: [],
  };
  // Money: daily treasury flows; the balance walks back from today's actual account.
  const net = zeros();
  const arrival = new Map<string, number>((city.history?.structuralProofs??[]).filter(e=>e.reason==='New household arrival savings').map(e=>[e.to,e.tick]));
  for(const d of city.history?.daily??[]){if(!inWindow(d.tick))continue;const i=at(d.tick);s.income[i]+=d.income;s.expense[i]+=d.expense;net[i]+=d.income-d.expense;
    for(const key of ['cropsHarvested','cropsProcessed','cropsConsumed','goodsProduced','goodsConsumed','goodsExported','goodsImported'] as const)s[key][i]+=d[key];}

  for (const e of city.ledger) {
    if (e.reason === 'New household arrival savings' && !arrival.has(e.to)) arrival.set(e.to, e.tick);
    if (e.tick > to) continue;
    if (!inWindow(e.tick)) continue;
    const delta = (e.to === 'treasury' ? e.amount : 0) - (e.from === 'treasury' ? e.amount : 0);
    if (e.to === 'treasury') s.income[at(e.tick)] += e.amount;
    if (e.from === 'treasury') s.expense[at(e.tick)] += e.amount;
    net[at(e.tick)] += delta;
    const road = e.reason.match(/^Build (\d+) road cells$/);
    if (road) s.markers.push({ tick: e.tick, kind: 'road', icon: 'road', text: `ต่อถนน ${road[1]} ช่อง` });
    if (e.reason === 'Firm liquidation') s.markers.push({ tick: e.tick, kind: 'closure', icon: 'bulldoze', text: 'ปิดกิจการและรื้ออาคาร' });
  }
  let balance = city.accounts.treasury ?? 0;
  for (let i = n - 1; i >= 0; i--) { s.treasury[i] = balance; balance -= net[i]; }
  for (const e of city.cropLedger) {
    if (!inWindow(e.tick)) continue;
    if (e.kind === 'harvest') s.cropsHarvested[at(e.tick)] += e.quantity;
    else if (e.kind === 'process') s.cropsProcessed[at(e.tick)] += e.quantity;
    else if (e.kind === 'consumption') s.cropsConsumed[at(e.tick)] += e.quantity;
  }
  for (const e of city.goodsLedger) {
    if (!inWindow(e.tick)) continue;
    const i = at(e.tick);
    if (e.reason === 'Daily worker production' || /^Crop recipe #\d+$/.test(e.reason)) s.goodsProduced[i] += e.quantity;
    else if (e.reason === 'Household final consumption') s.goodsConsumed[i] += e.quantity;
    else if (e.reason === 'Exported goods') s.goodsExported[i] += e.quantity;
    else if (e.reason === 'Imported shop stock') s.goodsImported[i] += e.quantity;
  }
  // Population: a household counts from its arrival entry (households never leave); older ones from day 0.
  const people = zeros(), homes = zeros();
  for (const h of city.households) {
    const arrived = arrival.get(h.wallet) ?? 0, start = Math.max(0, arrived - from);
    if (arrived > to) continue;
    for (let i = start; i < n; i++) { people[i] += h.members; homes[i]++; }
    if (inWindow(arrived) && arrival.has(h.wallet)) s.markers.push({ tick: arrived, kind: 'arrival', icon: 'people', text: `ครัวเรือน #${h.id} ย้ายเข้า ${h.members} คน` });
  }
  s.population = people; s.households = homes;
  // Buildings: built on the day `age` days ago; demolished buildings are no longer in the save.
  for (const b of city.buildings) {
    // Ages establish original construction dates, not historical level transitions.
    // Count each commercial business once instead of inventing past tier changes.
    const kind: BuildingKind = b.zone === 'C' ? 'shop' : b.zone as BuildingKind;
    const built = to - b.age, start = Math.max(0, built - from);
    if (built > to) continue;
    for (let i = start; i < n; i++) s.buildings[kind][i]++;
    if (inWindow(built)) s.markers.push({ tick: built, kind: 'building', icon: KIND_ICON[kind], text: `${KIND_NAME[kind]} #${b.id} สร้างเสร็จ` });
  }
  s.markers.sort((a, b) => a.tick - b.tick || a.kind.localeCompare(b.kind));
  return s;
}

export const sum = (values: readonly number[]) => values.reduce((a, b) => a + b, 0);
export { KIND_NAME as BUILDING_NAMES };
