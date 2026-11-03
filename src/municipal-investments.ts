import { EDUCATION_COST } from './education.ts';
import { PARK, PARK_STAFF } from './parks.ts';
import { PLANTS } from './utilities.ts';
import { treasurySpendable, type City } from './sim.ts';

/** These are shortcuts to existing placement tools, not automatic spending. */
export type MunicipalInvestmentTool = 'park' | 'power' | 'water' | 'school' | 'university';
export type MunicipalInvestment = { tool: MunicipalInvestmentTool; title: string; cost: number; upkeep: number; benefit: string; affordable: boolean };
export function municipalInvestments(city: City): MunicipalInvestment[] {
  const available = treasurySpendable(city);
  const rows: Omit<MunicipalInvestment, 'affordable'>[] = [
    { tool: 'park', title: 'สวนสาธารณะ', cost: PARK.cost, upkeep: PARK.upkeep,
      benefit: `สถานที่พักผ่อน ไม่มีโบนัสเศรษฐกิจหรือพื้นที่บริการจำลอง · มีงานได้สูงสุด ${PARK_STAFF.slots} คน เมื่อมีคนสมัครและงบค่าจ้าง (เต็มเดือน ${PARK_STAFF.monthlyWage / 100} ฿ เพิ่มจากค่าบำรุง)` },
    { tool: 'power', title: 'โรงไฟฟ้า', cost: PLANTS.power.cost, upkeep: PLANTS.power.upkeep, benefit: `เพิ่มกำลังไฟ ${PLANTS.power.capacity} หน่วย เมื่อต่อถนนถึงเครือข่าย` },
    { tool: 'water', title: 'โรงสูบน้ำ', cost: PLANTS.water.cost, upkeep: PLANTS.water.upkeep, benefit: `เพิ่มกำลังน้ำ ${PLANTS.water.capacity} หน่วย เมื่อต่อถนนถึงเครือข่าย` },
  ];
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
  note.textContent = `เงินที่ใช้ได้หลังกันค่าจ้าง ${baht(treasurySpendable(city))} · เลือกเครื่องมือแล้วเลือกตำแหน่งเอง ค่าใช้จ่ายเกิดเมื่อสร้างสำเร็จ`; section.append(note);
  const list = document.createElement('ul');
  for (const row of municipalInvestments(city)) {
    const item = document.createElement('li'), button = document.createElement('button'), detail = document.createElement('span');
    button.type = 'button'; button.className = 'dash-nav-chip'; button.dataset.investmentTool = row.tool; button.textContent = `เลือก ${row.title}`;
    button.disabled = !onSelectTool; button.addEventListener('click', () => onSelectTool?.(row.tool));
    detail.textContent = ` ก่อสร้าง ${baht(row.cost)} · บำรุง ${baht(row.upkeep)}/เดือน · ${row.benefit}${row.affordable ? '' : ' · เงินใช้ได้ตอนนี้ไม่พอ'}`;
    item.append(button, detail); list.append(item);
  }
  section.append(list);
  const caveat = document.createElement('p'); caveat.className = 'dash-note'; caveat.textContent = 'การสร้างยังขึ้นกับแปลง ถนน เครือข่าย และขีดจำกัดจริง เงินเหล่านี้ไม่ใช่ทุนโรงงานเอกชน'; section.append(caveat);
  return section;
}
