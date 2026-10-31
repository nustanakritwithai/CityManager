/** Read-only, current-state explanations shared by the map and the existing place panel. */
import { access, buildingEducationStatus, economicSignals, firmCapacity, firmWorkerCount, homeOccupancy, housingUpgradeStatus, isMarket, isRetail, marketConversionStatus, parkStaffingStatus, productionUpgradeStatus, retailGrowthStatus, reviewIsTomorrow, utilities, withRoadScope, withGrowthReviewScope, type City } from './sim.ts';
import { contextRevision } from './context-data.ts';
import { CROP_RECIPE, farmStockCapacity } from './agriculture.ts';
import { CROP_LABELS, RECIPE } from './goods.ts';
import { educationLevel, educationUtilityAvailability } from './education.ts';

export type IssueKind = 'no-road' | 'no-power' | 'no-water' | 'no-utilities' | 'no-workers' | 'no-input' | 'stock-cap' | 'no-buyer' | 'no-stock' | 'unsuitable-fertility' | 'empty-home' | 'importing' | 'broke' | 'paused' | 'education' | 'upgrade' | 'missing-data';
export type IssueTone = 'bad' | 'warn' | 'inactive' | 'upgrade';
export type IssueFact = { kind: IssueKind; text: string; detail: string; tone: IssueTone; current?: number; required?: number; unit?: string };
export type Issue = IssueFact & { cell: number; details: IssueFact[]; remaining: number };
/** Explicit deterministic priority: operational blockers, advisories, intentional inactivity, future growth. */
export const ISSUE_PRIORITY: readonly IssueKind[] = Object.freeze(['no-road', 'no-power', 'no-water', 'no-utilities', 'broke', 'no-workers', 'no-input', 'missing-data', 'unsuitable-fertility', 'stock-cap', 'no-stock', 'no-buyer', 'empty-home', 'importing', 'paused', 'education', 'upgrade']);
export const ISSUE_ICONS: Readonly<Record<IssueKind, string>> = Object.freeze({ 'no-road': 'road', 'no-power': 'power', 'no-water': 'water', 'no-utilities': 'power', 'no-workers': 'worker', 'no-input': 'crop', 'stock-cap': 'box', 'no-buyer': 'coin', 'no-stock': 'shop', 'unsuitable-fertility': 'F', 'empty-home': 'R', importing: 'import', broke: 'coin', paused: 'pause', education: 'education', upgrade: 'arrow-up', 'missing-data': 'help' });
export const ISSUE_TEXT: Readonly<Record<IssueKind, string>> = Object.freeze({
  'no-road': 'ไม่มีถนนเชื่อมประตูเมือง', 'no-power': 'ขาดไฟฟ้า', 'no-water': 'ขาดน้ำประปา', 'no-utilities': 'น้ำหรือไฟไม่พร้อม', 'no-workers': 'ไม่มีแรงงาน',
  'no-input': 'ขาดพืชผลวัตถุดิบ', 'stock-cap': 'คลังพืชผลเต็ม', 'no-buyer': 'ไม่มีผู้ซื้อ', 'no-stock': 'ไม่มีสินค้าขาย',
  'unsuitable-fertility': 'ดินไม่พอปลูก', 'empty-home': 'บ้านว่าง ยังไม่มีครัวเรือน', importing: 'มีการนำเข้าสินค้าล่าสุด',
  broke: 'เงินกิจการหมดและไม่มีคนงาน', paused: 'พักบริการ', education: 'เกณฑ์การศึกษาระดับถัดไป', upgrade: 'ยังไม่ผ่านเกณฑ์ระดับถัดไป', 'missing-data': 'ข้อมูลไม่ครบ',
});
const cache = new WeakMap<City, { revision: string; issues: Issue[] }>();
/** Covers same-tick commands too; camera frames never call the model. No saved-state field added. */
export function buildingIssueRevision(city: City): string {
  return JSON.stringify([contextRevision(city), city.cells.map(c => [c.road, c.zone, c.building]), city.plants, city.education, city.accounts.treasury]);
}
export function buildingIssues(city: City): Issue[] {
  const revision = buildingIssueRevision(city), hit = cache.get(city);
  if (hit?.revision === revision) return hit.issues;
  const issues = withRoadScope(city, () => withGrowthReviewScope(city, () => collect(city)));
  cache.set(city, { revision, issues }); return issues;
}
function collect(city: City): Issue[] {
  const groups = new Map<number, IssueFact[]>(), svc = utilities(city);
  const firms = new Map(city.firms.map(f => [f.building, f]));
  const signals = new Map(economicSignals(city).map(s => [s.firmId, s.reasonId]));
  const add = (cell: number, kind: IssueKind, detail: string, tone: IssueTone = 'bad', values: Pick<IssueFact, 'current' | 'required' | 'unit'> = {}) => {
    const rows = groups.get(cell) ?? []; if (!rows.some(row => row.kind === kind)) rows.push({ kind, text: ISSUE_TEXT[kind], detail, tone, ...values }); groups.set(cell, rows);
  };
  const numeric = (cell: number, kind: IssueKind, label: string, current: number, required: number, unit: string, advice: string, tone: IssueTone = 'bad') => add(cell, kind, `${label} ${current}/${required} ${unit} · ${advice}`, tone, { current, required, unit });
  for (const b of city.buildings) {
    const road = access(city, b.cell), need = svc.need.get(b.id), served = svc.served.get(b.id), f = firms.get(b.id);
    if (!road) add(b.cell, 'no-road', 'ต่อถนนข้างอาคารให้เชื่อมถึงประตูเมือง');
    // No resource-shortage claim when the actual blocker is a missing road or unknown service data.
    if (road && need && served) for (const kind of ['power', 'water'] as const) if (need[kind] > 0 && !served[kind]) {
      numeric(b.cell, kind === 'power' ? 'no-power' : 'no-water', kind === 'power' ? 'ไฟฟ้าที่ได้รับ' : 'น้ำที่ได้รับ', 0, need[kind], 'หน่วย', `สำรองเครือข่าย ${svc.spare[kind]} หน่วย · เพิ่มกำลังผลิต${kind === 'power' ? 'ไฟฟ้า' : 'น้ำ'}`);
    }
    if (b.zone === 'R') {
      if (b.age >= 2 && homeOccupancy(city, b.id).households === 0) add(b.cell, 'empty-home', 'ครัวเรือนในบ้าน 0 · ดูเงื่อนไขรับครัวเรือนในแผงอาคาร', 'warn');
    } else if (!f) add(b.cell, 'missing-data', 'ไม่พบกิจการของอาคาร จึงยังระบุแรงงานหรือวัตถุดิบไม่ได้', 'warn');
    else {
      const workers = firmWorkerCount(city, f.id), cash = city.accounts[f.wallet];
      if (cash === 0 && workers === 0) add(b.cell, 'broke', 'เงินกิจการ 0 เครดิต และคนทำงาน 0 คน · ดูเงินทุนและการรับช่วงกิจการในแผงอาคาร');
      if (workers === 0) numeric(b.cell, 'no-workers', 'คนทำงานจริง', workers, 1, 'คนขั้นต่ำ', isMarket(f) ? 'ต้องมีเจ้าของทำงานที่ตลาด' : `เต็มอัตรา ${firmCapacity(b)} คน · ตรวจแรงงานและเงินสำรองค่าจ้าง`);
      if (f.zone === 'I') {
        const recipe = f.recipe && RECIPE[f.recipe], have = recipe ? f.crops?.[recipe.crop] : undefined;
        if (!recipe || !Number.isFinite(have)) add(b.cell, 'missing-data', 'ไม่มีข้อมูลสูตรหรือพืชผลที่ใช้ จึงไม่เดาว่าขาดวัตถุดิบชนิดใด', 'warn');
        else if (have! < CROP_RECIPE.crop) numeric(b.cell, 'no-input', CROP_LABELS[recipe.crop], have!, CROP_RECIPE.crop, 'ล็อตต่อรอบผลิต', 'ตรวจฟาร์ม/ตลาดที่ส่งพืชผลชนิดนี้และเงินซื้อวัตถุดิบ');
      }
      if (f.zone === 'F' && f.cropInventory >= farmStockCapacity(b.level)) numeric(b.cell, 'stock-cap', 'พืชผลในคลัง', f.cropInventory, farmStockCapacity(b.level), 'ล็อต', 'ต้องระบายสต็อกก่อนเก็บเกี่ยวเพิ่ม', 'warn');
      if (isRetail(f)) {
        if (f.inventory === 0) numeric(b.cell, 'no-stock', 'สินค้าพร้อมขาย', 0, 1, 'หน่วยขั้นต่ำ', 'ตรวจเงินซื้อสินค้าและผู้ผลิต', 'warn');
        else if (city.goodsLedger.some(e => e.reason === 'Imported shop stock' && e.to === f.wallet && e.tick > city.tick - 3)) add(b.cell, 'importing', 'มีรายการนำเข้าสินค้าใน 3 วันที่ผ่านมา · เป็นประวัติการซื้อ ไม่ใช่หลักฐานว่าขณะนี้โรงงานหยุดผลิต', 'warn');
      } else if (isMarket(f)) {
        if (signals.get(f.id) === 'agriculture.no-buyer') add(b.cell, 'no-buyer', 'ตัวตรวจเศรษฐกิจปัจจุบันไม่พบผู้ซื้อที่เข้าถึงได้ · ตรวจผู้ซื้อและกำลังซื้อ', 'warn');
        if (f.cropInventory === 0) numeric(b.cell, 'no-stock', 'พืชผลพร้อมขาย', 0, 1, 'ล็อตขั้นต่ำ', 'ตรวจฟาร์มที่เข้าถึงได้และทุนซื้อพืชผล', 'warn');
      }
    }
    // These are the simulator's existing growth explanations, NOT new operation gates.
    // Young buildings are still settling in; don't cover the map with routine age countdowns.
    if (b.age >= 30) {
      let reasons: string[] = [];
      if (b.zone === 'R') { const status = housingUpgradeStatus(city, b); if (status.next) reasons = status.blocked; }
      else if (f?.zone === 'I' || f?.zone === 'F') { const status = productionUpgradeStatus(city, f); if (status.nextLevel !== null) reasons = status.reasons; }
      else if (f && isRetail(f)) { const status = retailGrowthStatus(city, f); if (status.next) reasons = status.reasons; }
      else if (f && isMarket(f)) reasons = marketConversionStatus(city, f).reasons;
      if (reasons.length && city.education) {
        const gate = buildingEducationStatus(city, b), educational = reasons.filter(reason => gate.blocked.includes(reason));
        if (educational.length) {
          const credentials = gate.have < gate.need;
          add(b.cell, 'education', `${reviewIsTomorrow(city) ? 'เกณฑ์รอบตรวจวันถัดไป' : 'เกณฑ์ระดับถัดไป'} (ไม่ใช่การหยุดทำงานวันนี้): ${educational.join(' · ')}`, 'upgrade', { current: credentials ? gate.have : gate.sustainDays, required: credentials ? gate.need : gate.requiredDays, unit: credentials ? 'คนที่ผ่านเกณฑ์' : 'วันตามเกณฑ์' });
          reasons = reasons.filter(reason => !gate.blocked.includes(reason));
        }
      }
      if (reasons.length) add(b.cell, 'upgrade', `${reviewIsTomorrow(city) && !(f && isMarket(f)) ? 'เงื่อนไขรอบตรวจวันถัดไป' : 'เงื่อนไขระดับถัดไป'} (ไม่ใช่การหยุดทำงานวันนี้): ${reasons.join(' · ')}`, 'upgrade');
    }
  }
  for (const p of city.plants) if (!svc.online.has(p.id)) add(p.cell, 'no-road', 'โรงผลิตยังไม่จ่ายเข้าเครือข่าย · ต่อถนนข้างแปลงให้เชื่อมประตูเมือง');
  for (const p of city.parks) {
    const staff = parkStaffingStatus(city, p);
    if (staff.employed < staff.slots) numeric(p.cell, 'no-workers', 'เจ้าหน้าที่สวน', staff.employed, staff.slots, 'คน', staff.status === 'inadequate-budget' ? 'งบค่าจ้างที่จัดสรรได้ไม่พอ' : 'รอแรงงานว่างที่จัดสรรได้ · สวนไม่ต้องใช้ถนนหรือน้ำไฟ', 'warn');
  }
  const campusUtilities = city.education ? educationUtilityAvailability(city.education, { road: cell => access(city, cell), sparePower: svc.spare.power, spareWater: svc.spare.water }) : new Map();
  for (const campus of city.education?.campuses ?? []) {
    if (!campus.open) { add(campus.cell, 'paused', 'ผู้เล่นพักบริการไว้ · เปิดบริการจากปุ่มเดิมในแผงสถานศึกษา (ไม่ใช่ขาดทรัพยากร)', 'inactive'); continue; }
    const road = access(city, campus.cell), level = educationLevel(campus.kind, campus.level);
    if (!road) add(campus.cell, 'no-road', 'สถานศึกษาต้องติดถนนที่เชื่อมถึงประตูเมือง');
    const available = campusUtilities.get(campus.id);
    if (road && available) for (const kind of ['power', 'water'] as const) {
      const current = kind === 'power' ? available.availablePower : available.availableWater;
      if (current < level[kind]) numeric(campus.cell, kind === 'power' ? 'no-power' : 'no-water', kind === 'power' ? 'ไฟฟ้าสำรองที่จัดสรรได้' : 'น้ำสำรองที่จัดสรรได้', current, level[kind], 'หน่วย', 'ใช้ตัวจัดสรรเดียวกับบริการการศึกษา · เพิ่มกำลังผลิต');
    }
    // Read actual role allocations, never report.requiredStaff (stale after upgrade).
    const role = campus.kind === 'school' ? 'teacher' : 'professor';
    const local = city.education!.people.filter(p => p.campusId === campus.id).reduce((n, p) => n + p[role], 0), staff = local + campus.contract;
    if (road && staff < level.staff) numeric(campus.cell, 'no-workers', campus.kind === 'school' ? 'ครูที่จัดสรรอยู่' : 'อาจารย์ที่จัดสรรอยู่', staff, level.staff, 'คน', `ในเมือง ${local} + สัญญาภายนอก ${campus.contract} · จัดสรรใหม่เมื่อเดินวันถัดไป`);
  }
  return [...groups].map(([cell, rows]) => {
    const details = rows.sort((a, b) => ISSUE_PRIORITY.indexOf(a.kind) - ISSUE_PRIORITY.indexOf(b.kind));
    return { cell, ...details[0], details, remaining: details.length - 1 };
  }).sort((a, b) => a.cell - b.cell);
}

/** Resolve from current city identity on activation; an old badge cannot select a deleted entity. */
export function issuePlaceRoute(city: City, cell: number): { page: 'place'; cell: number; buildingId: number | null } | null {
  return buildingIssues(city).some(issue => issue.cell === cell) ? { page: 'place', cell, buildingId: city.cells[cell]?.building ?? null } : null;
}
