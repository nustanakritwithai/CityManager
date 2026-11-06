/** Read-only advice from current simulator gates; never predicts a successful construction. */
import { access, industryGrowthStatus, MAX_CITY_BUILDINGS, treasurySpendable, utilities, type City } from './sim.ts';
import { buildingNeed, MAX_PLANTS, PLANTS } from './utilities.ts';
import { guideState, type GuideTool } from './guide-steps.ts';
export type GrowthAdvice = { id: string; title: string; text: string; tool: GuideTool };
export function growthAdvice(city: City, requested = false): GrowthAdvice | null {
  const advice = (id: string, title: string, text: string, tool: GuideTool = null): GrowthAdvice => ({ id, title, text, tool });
  if (city.buildings.length >= MAX_CITY_BUILDINGS) return advice('building-cap', 'ถึงขีดจำกัดจำนวนอาคาร', `เมืองมีอาคาร ${city.buildings.length}/${MAX_CITY_BUILDINGS} แห่งแล้ว การวางโซนเพิ่มไม่เพิ่มขีดจำกัด แตะอาคารเดิมเพื่อตรวจเงื่อนไขยกระดับก่อน ไม่จำเป็นต้องรื้อทันที`);
  const svc = utilities(city);
  const disconnected = city.plants.find(p => !svc.online.has(p.id));
  if (disconnected) return advice('plant-road', 'โรงผลิตยังไม่เชื่อมเครือข่าย', `โรงผลิตที่ช่อง ${disconnected.cell + 1} ยังไม่จ่ายเข้าระบบ ต่อถนนข้างโรงผลิตให้เชื่อมประตูเมืองก่อนสร้างโรงใหม่`, 'road');
  for (const kind of ['power', 'water'] as const) {
    const shortage = city.buildings.some(b => access(city, b.cell) && (svc.need.get(b.id)?.[kind] ?? 0) > 0 && svc.served.get(b.id)?.[kind] === false);
    const pending = city.cells.some((c, i) => c.zone && c.building === null && access(city, i) && buildingNeed(c.zone, 1)[kind] > svc.spare[kind]);
    if (!shortage && !pending) continue;
    const label = kind === 'power' ? 'โรงไฟฟ้า' : 'โรงสูบน้ำ';
    const canBuild = city.plants.length < MAX_PLANTS && treasurySpendable(city) >= PLANTS[kind].cost;
    return advice(kind, `กำลัง${kind === 'power' ? 'ไฟฟ้า' : 'น้ำประปา'}ไม่พอ`, `สำรองเครือข่าย ${svc.spare[kind]} หน่วย ${shortage ? 'มีอาคารที่รับบริการไม่ครบ' : 'ยังไม่พอสำหรับโซนที่รอสร้าง'} ตรวจยกระดับโรงเดิม หรือสร้าง${label}ริมถนนที่เชื่อมประตูเมือง ราคา ${PLANTS[kind].cost / 100} เครดิต${canBuild ? '' : ' ขณะนี้เงินคลังที่ใช้ได้หลังกันค่าจ้างหรือจำนวนโรงผลิตไม่ผ่านเงื่อนไขสร้างใหม่'}`, canBuild ? kind : null);
  }
  if (!requested) return null;
  const tutorial = guideState(city).step;
  // Initial setup keeps the existing tutorial's language and tools.
  if (tutorial && ['road', 'homes', 'farm', 'factory', 'commerce', 'play'].includes(tutorial.id)) return tutorial;
  const growth = industryGrowthStatus(city);
  if (growth.code === 'growth.no-industrial-parcel') return advice(growth.code, 'เตรียมแปลงโรงงาน', 'ยังไม่มีแปลงโรงงานว่างที่เชื่อมประตูเมือง เลือกโรงงานแล้ววางข้างถนน การเปิดกิจการยังต้องผ่านทุน วัตถุดิบ และแรงงานด้วย', 'I');
  if (growth.code === 'growth.vacancies-remain') return advice(growth.code, 'เติมงานว่างเดิมก่อนขยายโรงงาน', `ยังมีงานว่างที่สำรองค่าจ้างได้ ${growth.fundedVacancies} ตำแหน่ง ระบบจะเติมงานเหล่านี้ก่อนเปิดโรงงานเพิ่ม ตรวจบ้านว่าง ถนน น้ำไฟ และคุณสมบัติแรงงานในแผงประชากรและงาน แล้วเดินเวลาต่อ ไม่ต้องเพิ่มโซนโรงงานเพื่อแก้เงื่อนไขนี้`);
  if (growth.code === 'growth.housing-unavailable') return advice(growth.code, 'เตรียมที่อยู่อาศัย', 'ยังไม่มีบ้านหรือแปลงบ้านที่พร้อมรองรับงานใหม่ และไม่มีแรงงานเดิมที่เข้าเกณฑ์ วางบ้านข้างถนนที่เชื่อมประตูเมือง หรือตรวจเงื่อนไขยกระดับบ้านเดิม', 'R');
  if (growth.code === 'growth.no-crop-buffer') return advice(growth.code, 'ตรวจวัตถุดิบก่อนเพิ่มโรงงาน', `พืชผลที่เข้าถึงได้ ${growth.cropAvailable}/8 ล็อต ตรวจฟาร์มเดิมให้มีแรงงาน น้ำ และถนน แล้วรอเก็บเกี่ยว ไม่จำเป็นต้องสร้างโรงงานเพิ่มตอนนี้`);
  if (growth.code === 'growth.saving-capital') return advice(growth.code, 'รอกิจการสะสมทุน', `โรงงานหมายเลข ${growth.sponsorFirmId} มีทุนขยายหลังกันเงินหมุนเวียน ${growth.availableCapital / 100}/${growth.requiredCapital / 100} เครดิต เงินนี้เป็นของกิจการ ไม่ใช่คลังเมือง ตรวจการขายและต้นทุนของโรงงานเดิมก่อนเพิ่มโซน`);
  if (growth.code === 'growth.no-profitable-sponsor') return advice(growth.code, 'ตรวจโรงงานเดิมก่อนขยาย', 'การขยายด้วยทุนกิจการต้องมีโรงงานที่เชื่อมถนน คนงานเต็ม มีวัตถุดิบและกำไรจริง แตะโรงงานเพื่อดูสิ่งที่ขาด การวางโซนเพิ่มอย่างเดียวไม่ทำให้กิจการเปิด');
  return tutorial ?? advice('overview', 'ตรวจเป้าหมายเมือง', 'เปิดภาพรวมเมืองดูเป้าหมายถัดไป และแตะอาคารที่มีป้ายปัญหาเพื่อตรวจข้อจำกัดจริงก่อนสร้างเพิ่ม');
}
