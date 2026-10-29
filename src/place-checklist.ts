/**
 * Growth checklist for a vacant zoned parcel, read from the simulator's own `explainCell`
 * blockers so it can never disagree with what growth actually checks. Presentation only.
 */
import { GATEWAY, SIZE, connectedRoads, explainCell, type City } from './sim.ts';
import { roadLinked } from './road-topology.ts';

export type ParcelCheck = { key: string; label: string; state: 'pass' | 'fail'; detail?: string };
type Rule = { key: string; label: string; zones: string; match: RegExp; detail: (reason: string) => string };

const RULES: readonly Rule[] = [
  { key: 'road', label: 'ถนนข้างแปลงเชื่อมประตูเมือง', zones: 'RCIF', match: /^No connected road frontage/, detail: () => 'ยังไม่มีถนนข้างแปลงที่เชื่อมถึงประตูภายนอก' },
  { key: 'power', label: 'ไฟฟ้าในเครือข่ายพอสำหรับอาคารใหม่', zones: 'RC', match: /^Not enough power:/, detail: () => 'เครือข่ายไฟไม่พอ อาคารใหม่ต้องใช้ไฟเพิ่ม สร้างโรงไฟฟ้าริมถนนที่เชื่อมประตูเมือง' },
  { key: 'water', label: 'น้ำในเครือข่ายพอสำหรับอาคารใหม่', zones: 'RCF', match: /^Not enough water:/, detail: () => 'เครือข่ายน้ำไม่พอ อาคารใหม่ต้องใช้น้ำเพิ่ม สร้างโรงสูบน้ำริมถนนที่เชื่อมประตูเมือง' },
  { key: 'ids', label: 'รหัสข้อมูลยังเหลือ', zones: '', match: /^Entity ID range exhausted/, detail: () => 'รหัสข้อมูลเต็ม ระบบไม่สร้างอาคารใหม่' },
  { key: 'building-limit', label: 'จำนวนอาคารไม่เกิน 192', zones: '', match: /^Prototype building limit/, detail: () => 'ถึงจำนวนอาคารสูงสุดที่ต้นแบบรองรับแล้ว' },
  { key: 'firm-limit', label: 'จำนวนกิจการไม่เกิน 64', zones: '', match: /^Firm limit/, detail: () => 'ถึงจำนวนกิจการสูงสุดที่ต้นแบบรองรับแล้ว' },
  { key: 'housing-demand', label: 'มีความต้องการบ้านเพิ่ม', zones: 'R', match: /^No housing demand/, detail: () => 'บ้านว่างที่มีอยู่รองรับผู้ย้ายเข้าและครัวเรือนไร้บ้านได้แล้ว' },
  { key: 'income', label: 'รายได้คาดหมายพอซื้อของและจ่ายค่าเช่า', zones: 'R', match: /^Expected income/, detail: () => 'รายได้คาดหมายยังไม่พอซื้อสินค้าและจ่ายค่าเช่า' },
  { key: 'crop-demand', label: 'มีผู้ซื้อพืชผลเพิ่ม', zones: 'F', match: /^No additional crop demand/, detail: () => 'ฟาร์มเดิมผลิตพอสำหรับโรงงานและครัวเรือนแล้ว' },
  { key: 'owner', label: 'มีครัวเรือนเจ้าของที่มีทุน 600 ฿ และแรงงานค้าปลีก', zones: 'C', match: /^Raw market needs a connected household owner/, detail: () => 'ยังไม่มีครัวเรือนที่เชื่อมถนน มีเงินทุนจริง 600 ฿ และสมาชิกทักษะทั่วไปหรือค้าปลีกว่าง' },
  { key: 'market-demand', label: 'มีฟาร์มและผู้ซื้อที่เข้าถึงได้', zones: 'C', match: /^Raw market needs an actual farm|^No retail demand/, detail: r => /^No retail/.test(r) ? 'ร้านค้าที่มีอยู่รองรับความต้องการแล้ว' : 'ตลาดต้องมีฟาร์มจริง ผู้ซื้อที่เข้าถึงได้ และเจ้าของที่มีทุน' },
  { key: 'industry', label: 'โอกาสลงทุนโรงงาน', zones: 'I', match: /^(?!No |Farm |Raw |Firm |Prototype |Entity |Expected )/, detail: r => /^A new factory needs /.test(r) ? 'เครือข่ายน้ำหรือไฟไม่พอสำหรับโรงงานใหม่ สร้างโรงไฟฟ้าหรือโรงสูบน้ำริมถนน' : 'ดูรายการตรวจทุนขยายโรงงานในภาพรวมเมือง' },
];

export type ParcelChecklist = { checks: ParcelCheck[]; eligible: boolean; nextReview: number; note: string };
export function parcelChecklist(city: City, cell: number): ParcelChecklist | null {
  const zone = city.cells[cell]?.zone;
  if (!zone || city.cells[cell].road || city.cells[cell].building !== null) return null;
  const lines = explainCell(city, cell);
  const shop = /^Shop site:.*\(in (\d+) day/.exec(lines[1] ?? '');
  if (shop) return {
    checks: [{ key: 'factory', label: 'มีโรงงานที่มีคนงานกำลังผลิต', state: 'pass' }, { key: 'buyers', label: 'มีครัวเรือนเชื่อมถนนพอสำหรับร้านค้า', state: 'pass' }],
    eligible: true, nextReview: Number(shop[1]),
    note: 'ร้านค้าเปิดด้วยทุนนักลงทุนภายนอก ซื้อสินค้าจากโรงงานในเมืองก่อนนำเข้า และจ้างแรงงานค้าปลีก ครัวเรือนจึงซื้อของที่เมืองผลิตเองได้',
  };
  const stopped = lines.slice(1, -2), checks: ParcelCheck[] = [];
  const used = new Set<string>();
  for (const rule of RULES) {
    if (rule.zones && !rule.zones.includes(zone)) continue;
    const reason = stopped.find(r => !used.has(r) && rule.match.test(r));
    if (reason) { used.add(reason); checks.push({ key: rule.key, label: rule.label, state: 'fail', detail: rule.detail(reason) }); }
    else if (rule.zones) checks.push({ key: rule.key, label: rule.label, state: 'pass' });
  }
  const note = zone === 'C'
    ? 'ตลาดเริ่มจากครัวเรือนเจ้าของลงทุนเงินจริง 600 ฿ ค่าก่อสร้าง 100 ฿ ที่เหลือเป็นเงินกิจการ และกันสมาชิก 1 คนไว้ทำงานเอง'
    : 'โรงงานแรกเปิดได้โดยยังไม่มีคนงาน และ 2 ครัวเรือนแรกย้ายเข้าได้แม้ยังไม่มีงาน ทุนและเงินติดตัวมาจากบัญชีภายนอกที่ระบุชื่อ';
  return { checks, eligible: stopped.length === 0, nextReview: 3 - city.tick % 3, note };
}

export type RoadFacts = { gateway: boolean; connected: boolean; stepsToGateway: number | null; frontage: number; buildings: number; network: number; connectedNetwork: number };
/** Facts about one road cell: route length to the west gateway and the parcels it fronts. */
export function roadFacts(city: City, cell: number): RoadFacts | null {
  if (!city.cells[cell]?.road) return null;
  const neighbours = (i: number) => [i - SIZE, i + SIZE, i % SIZE ? i - 1 : -1, (i + 1) % SIZE ? i + 1 : -1].filter(n => n >= 0 && n < city.cells.length);
  const steps = new Map<number, number>([[GATEWAY, 0]]), queue = city.cells[GATEWAY]?.road ? [GATEWAY] : [];
  for (let k = 0; k < queue.length; k++) for (const n of neighbours(queue[k])) if (roadLinked(city, queue[k], n) && !steps.has(n)) { steps.set(n, steps.get(queue[k])! + 1); queue.push(n); }
  const front = neighbours(cell).filter(n => !city.cells[n].road && city.cells[n].zone);
  const network = city.cells.filter(c => c.road).length, connected = connectedRoads(city);
  return { gateway: cell === GATEWAY, connected: connected.has(cell), stepsToGateway: steps.get(cell) ?? null, frontage: front.length, buildings: front.filter(n => city.cells[n].building !== null).length, network, connectedNetwork: connected.size };
}
