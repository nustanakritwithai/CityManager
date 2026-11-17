import { EDUCATION_COST } from './education.ts';
import { PARK, PARK_STAFF } from './parks.ts';
import { PLANTS } from './utilities.ts';
import { treasurySpendable, type City } from './sim.ts';
import { CIVIC, CIVIC_KINDS, civicSpec, type CivicKind } from './civic/sites.ts';
const venueBenefit = (kind: CivicKind) => { const staff = civicSpec(kind).staff; return staff ? `จ้างคนในเมือง ${staff.slots} ตำแหน่ง ค่าจ้าง ${staff.dailyWage * 30 / 100} ฿/เดือนต่อคน · ครัวเรือนในระยะจ่ายค่าบริการ ${staff.fee / 100} ฿ ต่อครั้งเข้าคลัง · เปิดเมื่อมีพนักงาน · ` : ''; };

/** These are shortcuts to existing placement tools, not automatic spending. */
export type MunicipalInvestmentTool = 'park' | 'power' | 'water' | CivicKind | 'school' | 'university';
export type MunicipalInvestment = { tool: MunicipalInvestmentTool; title: string; cost: number; upkeep: number; benefit: string; affordable: boolean };
export function municipalInvestments(city: City): MunicipalInvestment[] {
  const available = treasurySpendable(city);
  const rows: Omit<MunicipalInvestment, 'affordable'>[] = [
    { tool: 'park', title: 'สวนสาธารณะ', cost: PARK.cost, upkeep: PARK.upkeep,
      benefit: `สถานที่พักผ่อน ไม่มีโบนัสเศรษฐกิจหรือพื้นที่บริการจำลอง · มีงานได้สูงสุด ${PARK_STAFF.slots} คน เมื่อมีคนสมัครและงบค่าจ้าง (เต็มเดือน ${PARK_STAFF.monthlyWage / 100} ฿ เพิ่มจากค่าบำรุง)` },
    { tool: 'power', title: 'โรงไฟฟ้า', cost: PLANTS.power.cost, upkeep: PLANTS.power.upkeep, benefit: `เพิ่มกำลังไฟ ${PLANTS.power.capacity} หน่วย เมื่อต่อถนนถึงเครือข่าย` },
    { tool: 'water', title: 'โรงสูบน้ำ', cost: PLANTS.water.cost, upkeep: PLANTS.water.upkeep, benefit: `เพิ่มกำลังน้ำ ${PLANTS.water.capacity} หน่วย เมื่อต่อถนนถึงเครือข่าย` },
  ];
  for (const kind of CIVIC_KINDS) rows.push({ tool: kind, title: CIVIC[kind].label, cost: CIVIC[kind].cost, upkeep: CIVIC[kind].upkeep, benefit: kind === 'airport' ? 'ใช้พื้นที่ 3×2 ช่องติดถนน · นักท่องเที่ยวจ่ายเข้าคลังทุกเดือน: ฐาน ' + CIVIC.airport.visitors.base / 100 + ' ฿ บวก ' + CIVIC.airport.visitors.perAttraction / 100 + ' ฿ ต่อสถานที่ท่องเที่ยว (สวน ห้องสมุด วัด สนามฟุตบอล)' : venueBenefit(kind) + `บ้านในระยะ ${CIVIC[kind].radius} ช่องได้ความสุข +${CIVIC[kind].points} · นับครั้งเดียวต่อชนิด ต้องติดถนนที่เชื่อมถึงประตูเมือง` });
  if (city.education) rows.push(
    { tool: 'school', title: 'โรงเรียน', cost: EDUCATION_COST.school.build, upkeep: EDUCATION_COST.school.upkeep, benefit: `สูงสุด ${EDUCATION_COST.school.levels[0].seats} ที่เรียน · มีค่าบุคลากรและค่าดำเนินงานแปรตามการใช้งานเพิ่ม ต้องมีบริการพร้อม` },
    { tool: 'university', title: 'มหาวิทยาลัย', cost: EDUCATION_COST.university.build, upkeep: EDUCATION_COST.university.upkeep, benefit: `สูงสุด ${EDUCATION_COST.university.levels[0].seats} ที่เรียน · มีค่าบุคลากรและค่าดำเนินงานแปรตามการใช้งานเพิ่ม ต้องมีผู้มีสิทธิเรียน` },
  );
  return rows.map(row => ({ ...row, affordable: available >= row.cost }));
}
const baht = (amount: number) => `${(amount / 100).toLocaleString('th-TH')} ฿`;
/** Purely presents existing game investments. Each button selects a tool; it never buys or places. */
export function renderMunicipalInvestments(city: City, onSelectTool?: (tool: MunicipalInvestmentTool) => void): HTMLElement {
  const section = document.createElement('section'); section.className = 'dash-investments'; section.dataset.municipalInvestments = 'true';
  const heading = document.createElement('h4'); heading.textContent = 'ใช้เงินคลังกับบริการเมือง'; section.append(heading);
  const note = document.createElement('p'); note.className = 'dash-note';
  note.textContent = `ใช้ได้ ${baht(treasurySpendable(city))} หลังกันค่าจ้าง · แตะชื่อแล้วเลือกตำแหน่ง จ่ายเมื่อสร้างสำเร็จ`; section.append(note);
  const list = document.createElement('ul'); list.className = 'dash-invest-list';
  // One row per service: what it is and what it costs. What it does folds into one disclosure below.
  const more = document.createElement('details'), summary = document.createElement('summary'); more.className = 'dash-invest-more'; summary.textContent = 'แต่ละบริการให้อะไร'; more.append(summary);
  for (const row of municipalInvestments(city)) {
    const item = document.createElement('li'), button = document.createElement('button'), detail = document.createElement('span');
    button.type = 'button'; button.className = 'dash-nav-chip'; button.dataset.investmentTool = row.tool; button.textContent = row.title; button.title = `เลือก ${row.title} แล้วเลือกตำแหน่งบนแผนที่`;
    button.disabled = !onSelectTool; button.addEventListener('click', () => onSelectTool?.(row.tool));
    detail.className = row.affordable ? 'dash-invest-cost' : 'dash-invest-cost short';
    detail.textContent = `สร้าง ${baht(row.cost)} · บำรุง ${baht(row.upkeep)}/เดือน${row.affordable ? '' : ' · เงินไม่พอ'}`;
    item.append(button, detail); list.append(item);
    const benefit = document.createElement('p'); benefit.className = 'dash-invest-benefit'; benefit.textContent = `${row.title}: ${row.benefit}`; more.append(benefit);
  }
  const caveat = document.createElement('p'); caveat.className = 'dash-invest-benefit'; caveat.textContent = 'การสร้างยังขึ้นกับแปลง ถนน เครือข่าย และขีดจำกัดจริง เงินเหล่านี้ไม่ใช่ทุนโรงงานเอกชน'; more.append(caveat);
  section.append(list, more);
  return section;
}
