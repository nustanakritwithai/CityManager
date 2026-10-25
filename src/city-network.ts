/**
 * The city as a network of linked variables. Nodes read live values from the city; edges state
 * how one rule of the simulator feeds another, with a sign (+ moves the same way, − the
 * opposite way). Day-to-day differences and ledger events say which links just carried a change,
 * so the view can light up the chain an action set off. Read-only; nothing here mutates the city.
 */
import { MONTH, ROAD_COST, access, isMarket, summary, type City } from './sim.ts';
import { cityOverview } from './context-data.ts';

export type NetGroup = 'city' | 'people' | 'production' | 'money';
/** count: whole things · stock: a level that drifts daily · money: satang · flow: 30-day total · flag: on/off. */
export type NetKind = 'count' | 'stock' | 'money' | 'flow' | 'flag';
export type NetNode = { id: string; label: string; group: NetGroup; icon: string; unit: string; kind: NetKind };
/** `stream` names the flow node whose 30-day volume sets how busy the link looks. */
export type NetEdge = { from: string; to: string; sign: 1 | -1; why: string; stream?: string };

export const GROUP_ORDER: readonly NetGroup[] = Object.freeze(['money', 'city', 'people', 'production']);
/** Four groups whose colours stay apart for every pair, colour-blind included (validated all-pairs on the navy well #151c3a). */
export const GROUPS: Record<NetGroup, { label: string; color: string }> = {
  money: { label: 'เงิน', color: '#c98500' }, city: { label: 'เมืองและที่อยู่', color: '#17a2b8' }, people: { label: 'คนและงาน', color: '#e0607e' }, production: { label: 'การผลิต', color: '#8a7cf0' },
};

export const NODES: readonly NetNode[] = Object.freeze([
  { id: 'roads', label: 'ถนน', group: 'city', icon: 'road', unit: 'ช่อง', kind: 'count' },
  { id: 'access', label: 'อาคารติดถนน', group: 'city', icon: 'link', unit: 'หลัง', kind: 'count' },
  { id: 'utilities', label: 'น้ำ·ไฟ', group: 'city', icon: 'power', unit: '', kind: 'flag' },
  { id: 'demandR', label: 'ความต้องการบ้าน', group: 'city', icon: 'R', unit: 'หลัง', kind: 'count' },
  { id: 'homes', label: 'บ้าน', group: 'city', icon: 'household', unit: 'หลัง', kind: 'count' },
  { id: 'capacity', label: 'ที่ว่างรับคน', group: 'city', icon: 'household', unit: 'คน', kind: 'count' },
  { id: 'households', label: 'ครัวเรือน', group: 'people', icon: 'people', unit: 'ครัวเรือน', kind: 'count' },
  { id: 'population', label: 'ประชากร', group: 'people', icon: 'people', unit: 'คน', kind: 'count' },
  { id: 'workforce', label: 'กำลังแรงงาน', group: 'people', icon: 'worker', unit: 'คน', kind: 'count' },
  { id: 'jobs', label: 'ตำแหน่งงาน', group: 'people', icon: 'worker', unit: 'ตำแหน่ง', kind: 'count' },
  { id: 'employed', label: 'คนมีงาน', group: 'people', icon: 'worker', unit: 'คน', kind: 'count' },
  { id: 'unemployed', label: 'ว่างงาน', group: 'people', icon: 'idle', unit: 'คน', kind: 'count' },
  { id: 'farms', label: 'ฟาร์ม', group: 'production', icon: 'F', unit: 'แห่ง', kind: 'count' },
  { id: 'harvest', label: 'เก็บเกี่ยว', group: 'production', icon: 'crop', unit: 'ล็อต', kind: 'flow' },
  { id: 'cropStock', label: 'พืชผลในคลัง', group: 'production', icon: 'box', unit: 'ล็อต', kind: 'stock' },
  { id: 'markets', label: 'ตลาด', group: 'production', icon: 'market', unit: 'แห่ง', kind: 'count' },
  { id: 'eaten', label: 'ครัวเรือนกินพืชผล', group: 'production', icon: 'consume', unit: 'ล็อต', kind: 'flow' },
  { id: 'factories', label: 'โรงงาน', group: 'production', icon: 'I', unit: 'แห่ง', kind: 'count' },
  { id: 'produced', label: 'ผลิตสินค้า', group: 'production', icon: 'gear', unit: 'หน่วย', kind: 'flow' },
  { id: 'exported', label: 'ส่งออก', group: 'production', icon: 'export', unit: 'หน่วย', kind: 'flow' },
  { id: 'shops', label: 'ร้านค้า', group: 'production', icon: 'shop', unit: 'แห่ง', kind: 'count' },
  { id: 'consumed', label: 'ครัวเรือนซื้อของ', group: 'production', icon: 'retail', unit: 'หน่วย', kind: 'flow' },
  { id: 'householdCash', label: 'เงินครัวเรือน', group: 'money', icon: 'coin', unit: '฿', kind: 'money' },
  { id: 'firmCash', label: 'เงินกิจการ', group: 'money', icon: 'coin', unit: '฿', kind: 'money' },
  { id: 'taxes', label: 'ภาษี', group: 'money', icon: 'tax', unit: '฿', kind: 'flow' },
  { id: 'upkeep', label: 'ค่าบำรุงถนน', group: 'money', icon: 'road', unit: '฿', kind: 'flow' },
  { id: 'treasury', label: 'เงินคลัง', group: 'money', icon: 'coin', unit: '฿', kind: 'money' },
]);
export const NODE_BY_ID: ReadonlyMap<string, NetNode> = new Map(NODES.map(n => [n.id, n]));

/** How the simulator's rules feed each other; each line restates a rule in sim.ts. */
export const EDGES: readonly NetEdge[] = Object.freeze([
  { from: 'treasury', to: 'roads', sign: 1, why: `ถนนช่องละ ${ROAD_COST / 100} ฿ จ่ายจากเงินคลัง ถ้าเงินไม่พอจะสร้างไม่ได้` },
  { from: 'roads', to: 'treasury', sign: -1, why: 'ค่าสร้างถนนหักจากเงินคลังทันที' },
  { from: 'roads', to: 'access', sign: 1, why: 'แปลงที่ติดถนนซึ่งต่อถึงประตูเมืองจึงเข้าถึงได้' },
  { from: 'roads', to: 'upkeep', sign: 1, why: 'ถนนทุกช่องมีค่าบำรุงทุกวัน' },
  { from: 'upkeep', to: 'treasury', sign: -1, why: 'ค่าบำรุงถนนหักจากเงินคลังทุกวัน', stream: 'upkeep' },
  { from: 'access', to: 'homes', sign: 1, why: 'บ้านเกิดได้เฉพาะแปลงที่เข้าถึงได้' },
  { from: 'access', to: 'farms', sign: 1, why: 'ฟาร์มเกิดได้เฉพาะแปลงที่เข้าถึงได้' },
  { from: 'access', to: 'factories', sign: 1, why: 'โรงงานเกิดได้เฉพาะแปลงที่เข้าถึงได้' },
  { from: 'access', to: 'markets', sign: 1, why: 'ตลาดเกิดได้เฉพาะแปลงที่เข้าถึงได้' },
  { from: 'access', to: 'jobs', sign: 1, why: 'นับตำแหน่งงานเฉพาะกิจการที่เข้าถึงได้' },
  { from: 'utilities', to: 'homes', sign: 1, why: 'อาคารใหม่ทุกโซนต้องมีน้ำและไฟจากภายนอก' },
  { from: 'utilities', to: 'factories', sign: 1, why: 'โรงงานใหม่ต้องมีน้ำและไฟจากภายนอก' },
  { from: 'utilities', to: 'households', sign: 1, why: 'ไม่มีน้ำหรือไฟ เมืองไม่รับครัวเรือนใหม่' },
  { from: 'demandR', to: 'homes', sign: 1, why: 'บ้านใหม่เกิดเมื่อความต้องการบ้านมากกว่า 0' },
  { from: 'homes', to: 'capacity', sign: 1, why: 'บ้านแต่ละหลังเพิ่มที่ว่างรับครัวเรือน' },
  { from: 'capacity', to: 'demandR', sign: -1, why: 'ที่ว่างในบ้านเดิมลดความต้องการบ้านใหม่' },
  { from: 'capacity', to: 'households', sign: 1, why: 'ครัวเรือนใหม่ย้ายเข้าได้เมื่อมีบ้านที่ยังรับคนได้' },
  { from: 'households', to: 'capacity', sign: -1, why: 'ครัวเรือนที่ย้ายเข้าใช้ที่ว่างในบ้าน' },
  { from: 'jobs', to: 'households', sign: 1, why: 'ตำแหน่งว่างที่จ่ายค่าจ้างได้ ดึงครัวเรือนใหม่เข้าเมือง' },
  { from: 'jobs', to: 'demandR', sign: 1, why: 'ตำแหน่งว่างที่จ่ายค่าจ้างได้ เพิ่มความต้องการบ้าน' },
  { from: 'unemployed', to: 'households', sign: -1, why: 'ยังมีคนว่างงาน เมืองจะยังไม่รับครัวเรือนใหม่' },
  { from: 'households', to: 'population', sign: 1, why: 'สมาชิกทุกคนของครัวเรือนนับเป็นประชากร' },
  { from: 'households', to: 'workforce', sign: 1, why: 'สมาชิกวัยทำงานเป็นกำลังแรงงาน' },
  { from: 'households', to: 'householdCash', sign: 1, why: 'ครัวเรือนใหม่นำเงินติดตัวเข้ามา' },
  { from: 'workforce', to: 'employed', sign: 1, why: 'แรงงานได้งานตามตำแหน่งที่มี' },
  { from: 'jobs', to: 'employed', sign: 1, why: 'ตำแหน่งงานรับแรงงานเข้าทำงาน' },
  { from: 'firmCash', to: 'employed', sign: 1, why: 'กิจการจ้างได้เท่าที่สำรองค่าจ้างได้' },
  { from: 'markets', to: 'employed', sign: 1, why: 'เจ้าของตลาดทำงานในตลาดของตัวเอง' },
  { from: 'workforce', to: 'unemployed', sign: 1, why: 'แรงงานที่ยังไม่มีงานคือคนว่างงาน' },
  { from: 'employed', to: 'unemployed', sign: -1, why: 'คนมีงานมากขึ้น คนว่างงานจึงลดลง' },
  { from: 'farms', to: 'jobs', sign: 1, why: 'ฟาร์มมีตำแหน่งงานตามขนาดอาคาร' },
  { from: 'factories', to: 'jobs', sign: 1, why: 'โรงงานมีตำแหน่งงานตามขนาดอาคาร' },
  { from: 'shops', to: 'jobs', sign: 1, why: 'ร้านค้ามีตำแหน่งงานตามขนาดอาคาร' },
  { from: 'farms', to: 'harvest', sign: 1, why: 'ฟาร์มที่มีคนทำงานเก็บเกี่ยวพืชผล', stream: 'harvest' },
  { from: 'harvest', to: 'cropStock', sign: 1, why: 'ผลผลิตเข้าคลังพืชผล', stream: 'harvest' },
  { from: 'farms', to: 'markets', sign: 1, why: 'ตลาดเปิดได้เมื่อเมืองมีฟาร์มจริง' },
  { from: 'cropStock', to: 'produced', sign: 1, why: 'โรงงานแปรรูปพืชผลเป็นสินค้า', stream: 'produced' },
  { from: 'cropStock', to: 'eaten', sign: 1, why: 'ตลาดขายพืชผลให้ครัวเรือน', stream: 'eaten' },
  { from: 'markets', to: 'eaten', sign: 1, why: 'ครัวเรือนซื้อพืชผลที่ตลาด', stream: 'eaten' },
  { from: 'factories', to: 'produced', sign: 1, why: 'โรงงานผลิตสินค้าทุกวัน', stream: 'produced' },
  { from: 'employed', to: 'produced', sign: 1, why: 'คนทำงานในโรงงานผลิตสินค้า' },
  { from: 'produced', to: 'exported', sign: 1, why: 'โรงงานส่งสินค้าในคลังออกนอกเมืองทุกวัน', stream: 'exported' },
  { from: 'produced', to: 'consumed', sign: 1, why: 'ร้านค้าซื้อส่งสินค้าจากโรงงานในเมือง', stream: 'consumed' },
  { from: 'shops', to: 'consumed', sign: 1, why: 'ครัวเรือนซื้อสินค้าที่ร้านค้า', stream: 'consumed' },
  { from: 'householdCash', to: 'consumed', sign: 1, why: 'ครัวเรือนที่มีเงินพอซื้อของได้วันละครั้ง' },
  { from: 'householdCash', to: 'eaten', sign: 1, why: 'ครัวเรือนที่มีเงินพอซื้ออาหารที่ตลาด' },
  { from: 'employed', to: 'householdCash', sign: 1, why: 'ค่าจ้างเข้าบัญชีครัวเรือนทุกสิ้นเดือน' },
  { from: 'employed', to: 'firmCash', sign: -1, why: 'ค่าจ้างจ่ายจากเงินกิจการ' },
  { from: 'consumed', to: 'firmCash', sign: 1, why: 'ยอดขายของร้านค้าเป็นรายได้กิจการ', stream: 'consumed' },
  { from: 'eaten', to: 'firmCash', sign: 1, why: 'ยอดขายพืชผลเป็นรายได้ของตลาด', stream: 'eaten' },
  { from: 'exported', to: 'firmCash', sign: 1, why: 'ขายสินค้าออกนอกเมืองได้เงินเข้ากิจการ', stream: 'exported' },
  { from: 'firmCash', to: 'factories', sign: 1, why: 'โรงงานที่มีทุนพอออกทุนเปิดโรงงานใหม่' },
  { from: 'employed', to: 'taxes', sign: 1, why: 'ค่าจ้างเสียภาษี 10% ทุกสิ้นเดือน' },
  { from: 'firmCash', to: 'taxes', sign: 1, why: 'กิจการที่มีกำไรเสียภาษี 20% ของกำไรเดือนก่อน' },
  { from: 'taxes', to: 'treasury', sign: 1, why: 'ภาษีเข้าคลังเมืองทุกสิ้นเดือน', stream: 'taxes' },
]);

export type NetValues = Record<string, number>;
/** Live value of every node; flows are 30-day totals so a quiet day does not read as zero. */
export function networkValues(city: City): NetValues {
  const s = summary(city), o = cityOverview(city), from = Math.max(0, city.tick - MONTH + 1);
  let taxes = 0, upkeep = 0;
  for (const e of city.ledger) {
    if (e.tick < from) continue;
    if (e.to === 'treasury' && /tax/i.test(e.reason)) taxes += e.amount;
    else if (e.from === 'treasury' && e.reason === 'Daily road upkeep') upkeep += e.amount;
  }
  const firmWallets = new Set(city.firms.map(f => f.wallet));
  let householdCash = 0, firmCash = 0;
  for (const [id, v] of Object.entries(city.accounts)) { if (id.startsWith('household:')) householdCash += v; else if (firmWallets.has(id)) firmCash += v; }
  return {
    roads: city.cells.filter(c => c.road).length, access: city.buildings.filter(b => access(city, b.cell)).length,
    utilities: city.utilities.power && city.utilities.water ? 1 : 0,
    demandR: s.demand.R, homes: city.buildings.filter(b => b.zone === 'R').length, capacity: Math.max(0, o.personVacancy),
    households: s.households, population: s.population, workforce: s.workforce, jobs: s.jobs, employed: s.employed, unemployed: s.unemployed,
    farms: city.firms.filter(f => f.zone === 'F').length, harvest: o.cropHarvested, cropStock: o.cropInventory, markets: city.firms.filter(isMarket).length,
    eaten: o.cropConsumed, factories: city.firms.filter(f => f.zone === 'I').length, produced: o.produced, exported: o.exported,
    shops: city.firms.filter(f => f.zone === 'C' && !isMarket(f)).length, consumed: o.consumed,
    householdCash, firmCash, taxes, upkeep, treasury: city.accounts.treasury ?? 0,
  };
}

/** A change big enough to show: any whole-number change, or a real move in a drifting level. */
function noticeable(node: NetNode, before: number, after: number) {
  const delta = after - before;
  if (!delta || node.kind === 'flow') return false;
  if (node.kind === 'money') return Math.abs(delta) >= Math.max(50_000, Math.abs(before) * 0.02);
  if (node.kind === 'stock') return Math.abs(delta) >= Math.max(4, Math.abs(before) * 0.1);
  return true;
}
/** `exact` lists variables right after an action, where any move is that action's doing and counts. */
export function networkChanges(before: NetValues, after: NetValues, exact: ReadonlySet<string> = new Set()): Map<string, number> {
  const out = new Map<string, number>();
  for (const n of NODES) {
    const a = before[n.id] ?? 0, b = after[n.id] ?? 0;
    if (noticeable(n, a, b) || exact.has(n.id) && a !== b && n.kind !== 'flow') out.set(n.id, b - a);
  }
  return out;
}

export type NetEvent = { node: string; icon: string; text: string; tick: number };
export type NetSnapshot = { tick: number; ledger: number; buildings: Map<number, string>; utilities: number };
const kindOf = (city: City, buildingId: number, zone: string) => {
  if (zone !== 'C') return zone;
  const firm = city.firms.find(f => f.building === buildingId); return firm && !isMarket(firm) ? 'shop' : 'market';
};
export function networkSnapshot(city: City): NetSnapshot {
  return { tick: city.tick, ledger: city.ledger.length, buildings: new Map(city.buildings.map(b => [b.id, kindOf(city, b.id, b.zone)])), utilities: city.utilities.power && city.utilities.water ? 1 : 0 };
}
const BUILT: Record<string, [node: string, icon: string, name: string]> = {
  R: ['homes', 'R', 'บ้าน'], I: ['factories', 'I', 'โรงงาน'], F: ['farms', 'F', 'ฟาร์ม'], market: ['markets', 'market', 'ตลาด'], shop: ['shops', 'shop', 'ร้านค้า'],
};
const baht = (satang: number) => `${Math.round(satang / 100).toLocaleString('th-TH')} ฿`;
/** What happened since the snapshot, in the words a player would use, oldest first. */
export function networkEvents(before: NetSnapshot, city: City): NetEvent[] {
  if (city.ledger.length < before.ledger || city.tick < before.tick) return [];
  const out: NetEvent[] = [], wages = new Map<number, number>(), taxes = new Map<number, number>();
  const add = (map: Map<number, number>, tick: number, amount: number) => map.set(tick, (map.get(tick) ?? 0) + amount);
  for (let i = before.ledger; i < city.ledger.length; i++) {
    const e = city.ledger[i], road = /^Build (\d+) road cells$/.exec(e.reason);
    if (road) out.push({ node: 'roads', icon: 'road', text: `สร้างถนน ${road[1]} ช่อง · ${baht(e.amount)}`, tick: e.tick });
    else if (e.reason === 'New household arrival savings') out.push({ node: 'households', icon: 'people', text: 'ครัวเรือนใหม่ย้ายเข้า', tick: e.tick });
    else if (e.reason === 'Monthly wages') add(wages, e.tick, e.amount);
    else if (e.to === 'treasury' && /tax/i.test(e.reason)) add(taxes, e.tick, e.amount);
    else if (e.reason === 'Outside residential height investment') out.push({ node: 'capacity', icon: 'level', text: 'บ้านเพิ่มชั้น รับคนได้มากขึ้น', tick: e.tick });
    else if (e.reason === 'Market to shop conversion') out.push({ node: 'shops', icon: 'shop', text: `ตลาดยกระดับเป็นร้านค้า · ${baht(e.amount)}`, tick: e.tick });
    else if (e.reason === 'Profitable firm height investment') out.push({ node: 'jobs', icon: 'level', text: 'กิจการขยายอาคาร ตำแหน่งงานเพิ่ม', tick: e.tick });
  }
  for (const [tick, amount] of wages) out.push({ node: 'employed', icon: 'worker', text: `จ่ายค่าจ้างสิ้นเดือน ${baht(amount)}`, tick });
  for (const [tick, amount] of taxes) out.push({ node: 'taxes', icon: 'tax', text: `ภาษีเข้าคลัง ${baht(amount)}`, tick });
  for (const [id, kind] of before.buildings) if (!city.buildings.some(b => b.id === id)) { const [node, icon, name] = BUILT[kind] ?? BUILT.R; out.push({ node, icon, text: `${name} #${id} ถูกรื้อหรือปิด`, tick: city.tick }); }
  for (const b of city.buildings) if (!before.buildings.has(b.id)) { const [node, icon, name] = BUILT[kindOf(city, b.id, b.zone)] ?? BUILT.R; out.push({ node, icon, text: `${name}ใหม่ #${b.id}`, tick: city.tick - b.age }); }
  // Shops buying from outside mean local factories fell short: worth a line in the feed.
  const imports = new Map<number, number>(), goods = city.goodsLedger;
  for (let i = goods.length - 1; i >= 0 && goods[i].tick > before.tick; i--) if (goods[i].reason === 'Imported shop stock') add(imports, goods[i].tick, goods[i].quantity);
  for (const [tick, units] of imports) out.push({ node: 'shops', icon: 'import', text: `ร้านนำเข้าสินค้า ${units.toLocaleString('th-TH')} หน่วย · โรงงานในเมืองผลิตไม่ทัน`, tick });
  const utilities = city.utilities.power && city.utilities.water ? 1 : 0;
  if (utilities !== before.utilities) out.push({ node: 'utilities', icon: 'power', text: utilities ? 'น้ำและไฟพร้อมแล้ว' : 'น้ำหรือไฟขาด', tick: city.tick });
  return out.sort((a, b) => a.tick - b.tick);
}
/** A snapshot as the city stood `days` ago, as far as the ledger and building ages can tell. */
export function pastSnapshot(city: City, days: number): NetSnapshot {
  const from = Math.max(0, city.tick - days + 1), ledger = city.ledger.findIndex(e => e.tick >= from);
  return { tick: from - 1, ledger: ledger < 0 ? city.ledger.length : ledger, utilities: city.utilities.power && city.utilities.water ? 1 : 0,
    buildings: new Map(city.buildings.filter(b => city.tick - b.age < from).map(b => [b.id, kindOf(city, b.id, b.zone)])) };
}

export type NetPulse = { edge: NetEdge; hop: number; effect: 1 | -1 };
/** Follow links out of the seeds, but only into nodes that actually moved this time. */
export function cascade(seeds: readonly string[], changed: ReadonlyMap<string, number>, depth = 3): NetPulse[] {
  const out: NetPulse[] = [], used = new Set<NetEdge>(), seen = new Set(seeds);
  let frontier = [...new Set(seeds)];
  for (let hop = 0; hop < depth && frontier.length; hop++) {
    const next: string[] = [];
    for (const e of EDGES) {
      if (used.has(e) || !frontier.includes(e.from) || !changed.has(e.to)) continue;
      used.add(e); out.push({ edge: e, hop, effect: changed.get(e.to)! > 0 ? 1 : -1 });
      if (!seen.has(e.to)) { seen.add(e.to); next.push(e.to); }
    }
    frontier = next;
  }
  return out;
}
/** Nodes that moved without a moved node upstream of them: where a chain starts. */
export function cascadeRoots(changed: ReadonlyMap<string, number>): string[] {
  return [...changed.keys()].filter(id => !EDGES.some(e => e.to === id && changed.has(e.from)));
}
/** "If this rose": every downstream link, with the direction each reached node would move. */
export function whatIf(id: string, depth = 3): { pulses: NetPulse[]; reached: Map<string, 1 | -1> } {
  const reached = new Map<string, 1 | -1>([[id, 1]]), pulses: NetPulse[] = [], used = new Set<NetEdge>();
  let frontier = [id];
  for (let hop = 0; hop < depth && frontier.length; hop++) {
    const next: string[] = [];
    for (const e of EDGES) {
      if (used.has(e) || !frontier.includes(e.from) || e.to === id) continue;
      const effect = (reached.get(e.from)! * e.sign) as 1 | -1;
      used.add(e); pulses.push({ edge: e, hop, effect });
      if (!reached.has(e.to)) { reached.set(e.to, effect); next.push(e.to); }
    }
    frontier = next;
  }
  return { pulses, reached };
}
/** Variables one link downstream of the given ones. */
export const downstream = (ids: readonly string[]) => new Set(EDGES.filter(e => ids.includes(e.from)).map(e => e.to));
export const neighbours = (id: string) => ({ incoming: EDGES.filter(e => e.to === id), outgoing: EDGES.filter(e => e.from === id) });

/** Value text for a node: money in baht, counts with their unit. */
export function formatNode(node: NetNode, value: number, compact = false): string {
  if (node.kind === 'flag') return value ? 'พร้อม' : 'ขาด';
  const v = node.unit === '฿' ? value / 100 : value, a = Math.abs(v), sign = v < 0 ? '−' : '';
  const text = compact && a >= 1e6 ? `${sign}${(a / 1e6).toFixed(1).replace(/\.0$/, '')} ล้าน` : compact && a >= 1e4 ? `${sign}${(a / 1e3).toFixed(0)}K` : `${sign}${Math.round(a).toLocaleString('th-TH')}`;
  return `${text} ${node.unit}`.trim();
}
