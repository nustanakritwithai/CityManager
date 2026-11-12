import { GATEWAY, ROAD_COST, type City, type Entry } from './sim.ts';
import { auditMoney } from './city-history.ts';
import { PARK } from './parks.ts';
import { EDUCATION_COST } from './education.ts';
import { PLANTS, PLANT_NAMES, plantLevelSpec, type PlantLevel } from './utilities.ts';

export type DemolitionQuote = { paid: number; refund: number; fee: number; net: number; unknown: boolean };
export const roadReceiptCell = (e: Entry): number | null => {
  const m = /^(?:Build|Demolition refund) road cell @(0|[1-9]\d*)$/.exec(e.reason);
  return m ? Number(m[1]) : null;
};
const municipalPattern = /^(Build|Upgrade|Demolition refund|Demolish) (park|power plant|water pump|school|university) #([1-9]\d*)(?: to level ([23]))?$/;
export const municipalRefundReason = (name: string, id: number) => `Demolition refund ${name} #${id}`;
const refundAmount = (paid: number) => Math.floor(paid / 5) * 4 + Math.floor(paid % 5 * 4 / 5);
function receiptCost(action: string, name: string, level?: string): number | null {
  if (action !== 'Build' && action !== 'Upgrade') return null;
  if (name === 'park') return action === 'Build' && !level ? PARK.cost : null;
  if (name === 'school' || name === 'university') return !level ? EDUCATION_COST[name][action === 'Build' ? 'build' : 'upgrade'] : null;
  const kind = name === 'power plant' ? 'power' : 'water';
  return action === 'Build' ? !level ? PLANTS[kind].cost : null : level ? plantLevelSpec(kind, Number(level) as PlantLevel).upgradeCost : null;
}
export function municipalAsset(c: City, cell: number): { name: string; id: number; expected: number } | null {
  const p = c.plants.find(p => p.cell === cell);
  if (p) return { name: PLANT_NAMES[p.kind], id: p.id, expected: PLANTS[p.kind].cost + (p.level && p.level >= 2 ? plantLevelSpec(p.kind, 2).upgradeCost : 0) + (p.level === 3 ? plantLevelSpec(p.kind, 3).upgradeCost : 0) };
  const park = c.parks.find(p => p.cell === cell);
  if (park) return { name: 'park', id: park.id, expected: PARK.cost };
  const campus = c.education?.campuses.find(p => p.cell === cell);
  return campus ? { name: campus.kind, id: campus.id, expected: EDUCATION_COST[campus.kind].build + (campus.level === 2 ? EDUCATION_COST[campus.kind].upgrade : 0) } : null;
}
/** Only actual, attributable treasury payments count. Never infer legacy road payments. */
export function demolitionQuote(c: City, cell: number): DemolitionQuote {
  if (cell === GATEWAY) return { paid: 0, refund: 0, fee: 0, net: 0, unknown: false }; // Reserved gateway.
  const asset = municipalAsset(c, cell), road = c.cells[cell]?.road;
  let paid = 0, unknown = false;
  if (asset) {
    for (const e of auditMoney(c)) {
      const m = municipalPattern.exec(e.reason);
      if (!m || m[2] !== asset.name || Number(m[3]) !== asset.id) continue;
      if (m[1] === 'Demolition refund' || m[1] === 'Demolish') { paid = 0; break; }
      if (e.from === 'treasury' && e.to === 'construction' && e.amount === receiptCost(m[1], m[2], m[4])) paid += e.amount;
    }
    unknown = paid < asset.expected;
  } else if (road) {
    for (const e of auditMoney(c)) if (roadReceiptCell(e) === cell) paid = e.reason.startsWith('Build ') && e.from === 'treasury' && e.to === 'roadworks' && e.amount === ROAD_COST ? e.amount : 0;
    unknown = paid === 0;
  }
  const refund = refundAmount(paid), fee = !asset && !road && c.cells[cell]?.building !== null && c.buildings.some(b => b.id === c.cells[cell]?.building) ? 2_000 : 0;
  return { paid, refund, fee, net: refund - fee, unknown };
}

/** Replay sparse receipts: every refund consumes one paid lifecycle, including after compaction. */
export function validateMunicipalRefunds(c: City): void {
  const fail = (): never => { throw Error('Invalid municipal construction refund evidence'); };
  const roads = new Map<number, Entry>();
  const roadTicks = new Map<number, number>();
  const assets = new Map<number, { name: string; paid: number; closed: boolean; reasons: Set<string>; level: number; lastTick: number }>();
  for (const e of auditMoney(c)) {
    const cell = roadReceiptCell(e);
    if (cell !== null) {
      if (!Number.isSafeInteger(cell) || cell < 0 || cell >= c.cells.length || e.tick < (roadTicks.get(cell) ?? 0)) fail();
      roadTicks.set(cell, e.tick);
      if (e.reason.startsWith('Build ')) {
        if (roads.has(cell) || e.from !== 'treasury' || e.to !== 'roadworks' || e.amount !== ROAD_COST) fail();
        roads.set(cell, e);
      } else {
        if (cell === GATEWAY || !roads.has(cell) || e.from !== 'roadworks' || e.to !== 'treasury' || e.amount !== refundAmount(ROAD_COST) || e.tick < roads.get(cell)!.tick) fail();
        roads.delete(cell);
      }
      continue;
    }
    if (/^(?:Build|Demolition refund) road cell /.test(e.reason)) fail();
    const m = municipalPattern.exec(e.reason);
    if (!m) { if (e.reason.startsWith('Demolition refund ')) fail(); continue; }
    const [,action,name,rawId,level] = m, id = Number(rawId);
    if (!Number.isSafeInteger(id) || id >= c.nextId) fail();
    let a = assets.get(id);
    if (!a) { a = { name, paid: 0, closed: false, reasons: new Set(), level: 0, lastTick: e.tick }; assets.set(id, a); }
    if (a.name !== name || a.closed || a.reasons.has(e.reason) || e.tick < a.lastTick) fail();
    a.lastTick = e.tick;
    a.reasons.add(e.reason);
    const cost = receiptCost(action, name, level);
    if (action === 'Build' || action === 'Upgrade') {
      if (action === 'Build' && a.reasons.size !== 1) fail();
      if (cost === null || e.from !== 'treasury' || e.to !== 'construction' || e.amount !== cost) fail();
      if (name === 'power plant' || name === 'water pump') {
        if (action === 'Build' ? a.level !== 0 : Number(level) !== a.level + 1) fail();
        a.level = action === 'Build' ? 1 : Number(level);
      }
      a.paid += e.amount;
      if (!Number.isSafeInteger(a.paid)) fail();
    } else {
      if (level) fail();
      if (action === 'Demolition refund' && (a.paid <= 0 || e.from !== 'construction' || e.to !== 'treasury' || e.amount !== refundAmount(a.paid))) fail();
      if (action === 'Demolish' && (e.from !== 'treasury' || e.to !== 'construction' || e.amount !== 2_000)) fail();
      a.closed = true;
      if (c.plants.some(p => p.id === id) || c.parks.some(p => p.id === id) || c.education?.campuses.some(p => p.id === id)) fail();
    }
  }
  for (const cell of roads.keys()) if (!c.cells[cell].road) fail();
}
